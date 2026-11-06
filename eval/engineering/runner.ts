import { type CheckRequest } from "../../src/contracts/index.js";
import { runPairs } from "../backends.js";
import { metrics } from "../metrics.js";
import type { DecisionProvider } from "../../src/providers/types.js";
import { sha256, type Prediction } from "../types.js";
import { targetLabel, type SplitManifest } from "./manifests.js";
import { probeComparisons, payloadForProbe, type Probe } from "./probes.js";
import { MODELS, type Freeze, type Profile } from "./freeze.js";
import type { Observation } from "./composition.js";

export type Plan = {
  manifest: SplitManifest;
  profiles: Profile[];
  probes: Probe[];
  planned_calls: number;
  reservation_usd: number;
  reservation_per_call_usd: number;
  frozen: Freeze;
};
export function planRun(
  manifest: SplitManifest,
  frozen: Freeze,
  probes: Probe[],
  maxCalls: number,
  costPerCall: number,
  maxSpend: number,
): Plan {
  if (frozen.backend === "fake" && manifest.cases.some((c) => c.pair.dataset !== "synthetic-smoke"))
    throw new Error("Fake execution is restricted to explicitly synthetic fixtures.");
  if (!probes.includes("clean") || new Set(probes).size !== probes.length)
    throw new Error("Unique probes including clean are required.");
  const planned = manifest.cases.length * frozen.profiles.length * probes.length;
  if (
    !Number.isSafeInteger(maxCalls) ||
    maxCalls < planned ||
    ![costPerCall, maxSpend].every((n) => Number.isFinite(n) && n > 0) ||
    planned * costPerCall > maxSpend
  )
    throw new Error("Planned calls exceed explicit call/spend reservation limits.");
  return {
    manifest,
    profiles: frozen.profiles,
    probes,
    planned_calls: planned,
    reservation_usd: planned * costPerCall,
    reservation_per_call_usd: costPerCall,
    frozen,
  };
}
export async function executeRun(
  plan: Plan,
  append: (rows: readonly Prediction[]) => Promise<void>,
  options: { provider?: DecisionProvider; beforeDispatch?: () => Promise<void> } = {},
) {
  if (
    plan.frozen.backend !== "fake" &&
    (!options.provider || options.provider.model !== MODELS[plan.frozen.backend])
  )
    throw new Error("Frozen provider/model required.");
  const fake: DecisionProvider = {
    id: "fake",
    model: MODELS.fake,
    async classify(payload) {
      return {
        answers: Object.fromEntries(
          Object.entries(payload.questions).map(([id, q]) => [
            id,
            {
              type: "choice",
              probabilities: Object.fromEntries(
                Object.keys(q.criteria).map((label) => [label, 1 / Object.keys(q.criteria).length]),
              ),
            },
          ]),
        ),
      };
    },
  };
  const baseProvider = options.provider ?? fake;
  const observations: Observation[] = [];
  let sequence = 0;
  // Intentional sequential queue bounds cost/deadlines and keeps paired probe attribution explicit.
  for (const profile of plan.profiles)
    for (const item of plan.manifest.cases)
      for (const probe of plan.probes) {
        await options.beforeDispatch?.();
        const { pairs, presentation } = probeComparisons(item.pair, probe);
        let compiledHash: string | null = null,
          compiledBytes: number | null = null;
        const provider: DecisionProvider = {
          id: baseProvider.id,
          model: baseProvider.model,
          async classify(payload, signal) {
            const sent = payloadForProbe(payload, probe);
            const serialized = JSON.stringify(sent);
            compiledHash = sha256(serialized);
            compiledBytes = new TextEncoder().encode(serialized).byteLength;
            return baseProvider.classify(sent, signal);
          },
        };
        const predictions = await runPairs(pairs, {
          pass: sequence + 1,
          profile: profile as CheckRequest["profile"],
          timeoutMs: 3000,
          presentation,
          provider,
        });
        const target = predictions.find((p) => p.pair_id === item.pair.id);
        if (!target) throw new Error("Missing target comparison.");
        if (compiledHash) target.prompt_hash = compiledHash;
        if (plan.frozen.backend === "fake") target.cost_usd = 0;
        const observation: Observation = {
          sequence: sequence++,
          case_id: item.pair.id,
          profile,
          probe,
          prediction: target,
          compiled_sha256: compiledHash,
          compiled_bytes: compiledBytes,
        };
        await append([
          {
            ...target,
            engineering: {
              sequence: observation.sequence,
              profile,
              probe,
              case_id: item.pair.id,
              content_sha256: item.content_sha256,
              compiled_sha256: compiledHash,
              compiled_bytes: compiledBytes,
            },
            probe_comparisons: predictions.filter((p) => p.pair_id !== item.pair.id),
          },
        ]);
        observations.push(observation);
      }
  return observations;
}
export function summarizeRun(manifest: SplitManifest, observations: Observation[]) {
  const byProfile: Record<string, unknown> = {};
  const observationByKey = new Map(
    observations.map((o) => [`${o.profile}\0${o.case_id}\0${o.probe}`, o]),
  );
  const byId = new Map(manifest.cases.map((c) => [c.pair.id, c]));
  for (const profile of [...new Set(observations.map((o) => o.profile))]) {
    const clean = observations.filter((o) => o.profile === profile && o.probe === "clean");
    const labelSpaces: Record<string, unknown> = {};
    for (const space of ["native", "service-contract"] as const) {
      const binary = clean.flatMap((o) => {
        const item = byId.get(o.case_id)!;
        const label = targetLabel(item, space);
        return !label || label === "uncertain"
          ? []
          : [
              {
                pair: {
                  ...item.pair,
                  gold:
                    label === "contradiction"
                      ? ("contradiction" as const)
                      : ("non_contradiction" as const),
                },
                prediction: o.prediction,
              },
            ];
      });
      const expected = clean.filter((o) => targetLabel(byId.get(o.case_id)!, space) !== null);
      labelSpaces[space] = {
        binary: metrics(binary),
        labeled_cases: expected.length,
        expected_uncertain_excluded_from_binary: expected.length - binary.length,
        expected_verdict_correct: expected.filter(
          (o) =>
            o.prediction.status === "ok" &&
            o.prediction.verdict === targetLabel(byId.get(o.case_id)!, space),
        ).length,
        by_dataset: Object.fromEntries(
          [...new Set(binary.map((r) => r.pair.dataset))].map((dataset) => [
            dataset,
            metrics(binary.filter((r) => r.pair.dataset === dataset)),
          ]),
        ),
      };
    }
    const cleanById = new Map(clean.map((o) => [o.case_id, o]));
    const variations = Object.fromEntries(
      [...new Set(observations.map((o) => o.probe))]
        .filter((p) => p !== "clean")
        .map((probe) => {
          const rows = observations.filter((o) => o.profile === profile && o.probe === probe);
          let paired = 0,
            changes = 0,
            errors = 0,
            samePayload = 0;
          for (const row of rows) {
            // Order is paired against the same distractor batch, not the isolated baseline.
            const reference =
              probe === "order"
                ? observationByKey.get(`${profile}\0${row.case_id}\0distractor`)
                : cleanById.get(row.case_id);
            if (
              !reference ||
              reference.prediction.status !== "ok" ||
              row.prediction.status !== "ok"
            ) {
              errors++;
              continue;
            }
            paired++;
            if (row.prediction.verdict !== reference.prediction.verdict) changes++;
            if (row.compiled_sha256 === reference.compiled_sha256) samePayload++;
          }
          return [
            probe,
            {
              reference: probe === "order" ? "distractor" : "clean",
              matched_completed_pairs: paired,
              verdict_changes: changes,
              failed_or_missing_pairs: errors,
              identical_payload_hashes: samePayload,
            },
          ];
        }),
    );
    byProfile[profile] = { labels: labelSpaces, paired_variation: variations };
  }
  return {
    all_observations: observations.length,
    completed: observations.filter((o) => o.prediction.status === "ok").length,
    errors: observations.filter((o) => o.prediction.status === "error").length,
    excluded: observations.filter((o) => o.prediction.status === "excluded").length,
    by_profile: byProfile,
    gates: {
      human_500_and_locked_200: "unmet-unverified",
      production_qualification: "not_assessed",
      automatic_promotion: false,
    },
    label_policy:
      "Native dataset labels and explicit service-contract annotations are separate targets; missing contract labels remain unscored. Synthetic or asserted annotation provenance is not independently human-verified.",
  };
}
