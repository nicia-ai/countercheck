import { readFile, writeFile, mkdir, access, realpath } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, positiveInteger } from "../eval/args.js";
import { sha256, isUncertainFixture, type Prediction } from "../eval/types.js";
import { summarize } from "../eval/metrics.js";
import { withPredictionCheckpoint } from "../eval/checkpoint.js";
import { sourceFingerprint } from "../eval/iteration/fingerprint.js";
import type { CandidateId } from "../eval/iteration/profiles.js";
import type { Observation } from "../eval/iteration/runner.js";
import type { IterationPurpose } from "../eval/iteration/access.js";
const ROOT = fileURLToPath(new URL("..", import.meta.url));
async function main() {
  const args = parseArgs(
    process.argv.slice(2),
    [
      "help",
      "manifest",
      "profiles",
      "out",
      "live",
      "fake",
      "purpose",
      "passes",
      "max-calls",
      "max-spend-usd",
      "cost-per-call-usd",
      "locked-policy",
      "bundle",
      "backend",
    ],
    ["help", "live", "fake", "bundle"],
  );
  if (args.help) {
    console.log(
      "Usage: tsx scripts/iterate.ts --manifest FILE --profiles CSV --out PREFIX --purpose tune|validation|regression [--live|--fake] --max-calls N --cost-per-call-usd USD --max-spend-usd USD [--passes N] [--locked-policy FITTED.json]. Tune requires screen/fit; validation requires validation/locked-holdout. Locked holdout requires a current fitted policy and exclusive one-shot marker. Unassigned public-dev/synthetic manifests permit regression only. [--backend jev|clef|decider] [--bundle] (one provider call for all selected heads). Two concurrent requests maximum; 3000ms deadline; no retries. Fake synthetic only. Fresh outputs required.",
    );
    return;
  }
  if (
    !args.manifest ||
    !args.profiles ||
    !args.out ||
    !["tune", "validation", "regression"].includes(args.purpose ?? "") ||
    !!args.live === !!args.fake
  )
    throw new Error("Invalid explicit run configuration");
  const manifestPath = await realpath(args.manifest);
  const bytes = await readFile(manifestPath);
  const manifestValue: unknown = JSON.parse(bytes.toString("utf8"));
  const before = await sourceFingerprint(ROOT);
  const { authorizeIterationManifest, consumeLockedManifest } =
    await import("../eval/iteration/access.js");
  const profiles = args.profiles.split(",") as CandidateId[];
  const { CANDIDATE_IDS } = await import("../eval/iteration/profiles.js");
  if (profiles.some((p) => !CANDIDATE_IDS.includes(p))) throw new Error("Unknown candidate");
  const { createBackend, BACKEND_IDS } = await import("../eval/iteration/backends.js");
  const backendId = args.backend ?? "jev";
  if (!BACKEND_IDS.includes(backendId as (typeof BACKEND_IDS)[number]))
    throw new Error("Unknown backend");
  const backend = createBackend(
    backendId as (typeof BACKEND_IDS)[number],
    args.fake
      ? {
          TYPESAFE_API_KEY: "fake",
          OPENROUTER_API_KEY: "fake",
          CLOUDFLARE_API_TOKEN: "fake",
          CLOUDFLARE_ACCOUNT_ID: "a".repeat(32),
        }
      : process.env,
  );
  const execution = {
    compiler_mode: args.bundle ? ("bundle" as const) : ("isolated" as const),
    backend: backend.id,
    model: backend.model,
  };
  const policyBytes = args["locked-policy"] ? await readFile(args["locked-policy"]) : undefined;
  const authorized = authorizeIterationManifest(manifestValue, {
    purpose: args.purpose as IterationPurpose,
    profiles,
    sourceFiles: before,
    execution,
    ...(policyBytes && { lockedPolicy: JSON.parse(policyBytes.toString("utf8")) as unknown }),
  });
  const manifest = authorized.manifest;
  if (args.fake && manifest.purpose !== "synthetic-smoke")
    throw new Error("Fake is synthetic only");
  const passes = positiveInteger(args.passes, 1, "passes");
  const planned = (args.bundle ? 1 : profiles.length) * manifest.pairs.length * passes;
  const maxCalls = positiveInteger(args["max-calls"], 0, "max-calls");
  const per = Number(args["cost-per-call-usd"]),
    cap = Number(args["max-spend-usd"]);
  if (
    planned > maxCalls ||
    ![per, cap].every((n) => Number.isFinite(n) && n > 0) ||
    planned * per > cap ||
    new Set(profiles).size !== profiles.length
  )
    throw new Error("Run exceeds explicit budget");
  const prefix = resolve(args.out);
  await mkdir(dirname(prefix), { recursive: true });
  for (const ext of [
    ".json",
    ".predictions.jsonl",
    ".predictions.jsonl.metadata.json",
    ".freeze.json",
    ".sources.json.gz",
    ".locked-policy.json",
  ]) {
    let exists = false;
    try {
      await access(prefix + ext);
      exists = true;
    } catch {
      /* Exclusive writers remain authoritative. */
    }
    if (exists) throw new Error("Choose fresh outputs");
  }
  const { runPair } = await import("../eval/iteration/runner.js");
  const { runBundledPair } = await import("../eval/iteration/bundled-runner.js");
  if (JSON.stringify(before) !== JSON.stringify(await sourceFingerprint(ROOT)))
    throw new Error("Sources changed while loading");
  const freeze = {
    source_files: before,
    execution,
    manifest_sha256: sha256(bytes),
    profiles,
    passes,
    purpose: args.purpose,
    iteration_protocol: authorized.protocol,
    locked_policy_kind: authorized.locked_policy_kind,
    locked_policy_sha256: policyBytes ? sha256(policyBytes) : null,
    planned_calls: planned,
    max_concurrency: 2,
    deadline_ms: 3000,
    retries: 0,
    per_call_reservation_usd: per,
    max_reserved_usd: planned * per,
    qualification: "not_assessed",
    created_at: new Date().toISOString(),
  };
  await writeFile(prefix + ".freeze.json", JSON.stringify(freeze, null, 2) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
  if (policyBytes)
    await writeFile(prefix + ".locked-policy.json", policyBytes, { flag: "wx", mode: 0o600 });
  const sources = Object.fromEntries(
    await Promise.all(
      Object.keys(before).map(async (file) => [file, await readFile(resolve(ROOT, file), "utf8")]),
    ),
  );
  await writeFile(prefix + ".sources.json.gz", gzipSync(Buffer.from(JSON.stringify(sources))), {
    flag: "wx",
    mode: 0o600,
  });
  if (JSON.stringify(before) !== JSON.stringify(await sourceFingerprint(ROOT)))
    throw new Error("Sources changed before dispatch");
  const jobs = args.bundle
    ? Array.from({ length: passes }, (_, p) =>
        manifest.pairs.map((pair) => ({ profile: profiles[0]!, pair, pass: p + 1 })),
      ).flat()
    : profiles.flatMap((profile) =>
        Array.from({ length: passes }, (_, p) =>
          manifest.pairs.map((pair) => ({ profile, pair, pass: p + 1 })),
        ).flat(),
      );
  const observations: Observation[] = [];
  let cursor = 0;
  let appendQueue = Promise.resolve();
  await withPredictionCheckpoint(
    prefix + ".predictions.jsonl",
    {
      manifest_sha256: sha256(bytes),
      freeze_sha256: sha256(JSON.stringify(freeze)),
      protocol: freeze,
    },
    async (append) => {
      if (authorized.locked) {
        if (!policyBytes) throw new Error("Locked fitted policy is required.");
        await consumeLockedManifest(manifestPath, {
          manifest_sha256: sha256(bytes),
          locked_policy_sha256: sha256(policyBytes),
          freeze_sha256: sha256(JSON.stringify(freeze)),
          profiles,
        });
      }
      await Promise.all(
        [0, 1].map(async () => {
          while (cursor < jobs.length) {
            const sequence = cursor++;
            const job = jobs[sequence]!;
            const batch = args.bundle
              ? await runBundledPair(profiles, job.pair, job.pass, {
                  backend,
                  sequence,
                  fake: !!args.fake,
                })
              : [
                  await runPair(job.profile, job.pair, job.pass, {
                    apiKey: backend.apiKey,
                    backend,
                    sequence,
                    fake: !!args.fake,
                  }),
                ];
            batch.forEach((observation, index) => {
              observations[args.bundle ? sequence * profiles.length + index : sequence] =
                observation;
            });
            appendQueue = appendQueue.then(() =>
              append(
                batch.map(
                  (observation) =>
                    ({
                      ...observation.prediction,
                      iteration: {
                        profile: observation.profile,
                        pair_id: job.pair.id,
                        pass: job.pass,
                        sequence,
                        features: observation.features,
                        raw_answers: observation.raw_answers,
                        provider_calls: observation.provider_calls,
                        compiled_bytes: observation.compiled_bytes,
                      },
                    }) as Prediction,
                ),
              ),
            );
            await appendQueue;
          }
        }),
      );
    },
  );
  const after = await sourceFingerprint(ROOT);
  const stable = JSON.stringify(before) === JSON.stringify(after);
  const byPair = new Map(manifest.pairs.map((p) => [p.id, p]));
  const summaries = Object.fromEntries(
    profiles.map((profile) => {
      const rows = observations
        .filter((o) => o.profile === profile)
        .map((o) => ({ pair: byPair.get(o.pair_id)!, prediction: o.prediction }));
      const expected = rows.filter((r) => r.pair.source_metadata?.expected_verdict);
      return [
        profile,
        {
          binary: summarize(rows.filter((r) => !isUncertainFixture(r.pair))),
          execution_observations: rows.length,
          expected_verdict_cases: expected.length,
          expected_verdict_correct: expected.filter(
            (r) =>
              r.prediction.status === "ok" &&
              r.prediction.verdict ===
                (r.pair.source_metadata?.expected_verdict === "no_contradiction_detected"
                  ? "no_contradiction"
                  : r.pair.source_metadata?.expected_verdict),
          ).length,
        },
      ];
    }),
  );
  await writeFile(
    prefix + ".json",
    JSON.stringify(
      {
        kind: "decision-quality-iteration",
        freeze,
        source_stable: stable,
        observations,
        summaries,
      },
      null,
      2,
    ) + "\n",
    { flag: "wx", mode: 0o600 },
  );
  if (!stable) throw new Error("Sources changed during run; evidence retained but invalidated");
  console.log(
    JSON.stringify({
      observations: observations.length,
      calls: observations.reduce((n, o) => n + o.provider_calls, 0),
      errors: observations.filter((o) => o.prediction.status === "error").length,
      excluded: observations.filter((o) => o.prediction.status === "excluded").length,
    }),
  );
}
main().catch(() => {
  console.error(
    "Iteration stopped. Check explicit opt-in, budgets, frozen sources and fresh outputs. Completed checkpoints are retained; no retries.",
  );
  process.exitCode = 1;
});
