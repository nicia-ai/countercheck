import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { sha256, validateManifest, type Pair } from "../types.js";
import { foldGroups, groupKey, contentKey } from "../iteration/calibrate.js";
import { loadTrainingPool, collectSelectedPairs, select } from "../iteration/prepare.js";
import { sampleBusinessGroups, envelopeGroups } from "../business/common.js";
import { parseContractNli, CONTRACT_NLI_MEMBER_SHA256 } from "../business/contractnli.js";
import { mnliPairs, MNLI_SOURCE } from "../business/mnli.js";
import { jsonLines } from "../datasets.js";
import { parseCheckRequest } from "../../src/contracts/index.js";
import { compileCheck } from "../../src/kernel/index.js";
import { providerFor } from "../../src/providers/catalog.js";
import { SUPPORTED_MODELS } from "../../src/contracts/models.js";
import { createFastinoProvider, FASTINO_GLIDE_MODEL } from "../fastino-provider.js";

export const ARCHIVE =
  "eval/results/hosted-models-with-glide-2026-11-05/observations.redacted.jsonl.gz";
export const DATASETS = ["vitaminc", "scifact", "contractnli", "mnli", "findver"] as const;
export const SEED = "separate-calibration-2026-11-05-v1";
export const MODELS = [...SUPPORTED_MODELS.map((model) => model.id), FASTINO_GLIDE_MODEL];
export type Archived = {
  model: string;
  dataset: string;
  row: {
    pair: Pair;
    prediction: {
      status: string;
      verdict?: string;
      raw_scores?: Record<string, number>;
    };
    text_provenance: { claim_sha256: string; evidence_sha256: string };
  };
};
export async function archivedRows(): Promise<Archived[]> {
  return gunzipSync(await readFile(ARCHIVE))
    .toString("utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as Archived);
}
export function missAnalysis(rows: Archived[]) {
  const positives = rows.filter(
    (r) =>
      DATASETS.includes(r.dataset as (typeof DATASETS)[number]) &&
      r.row.pair.gold === "contradiction",
  );
  const misses = positives.filter((r) => r.row.prediction.verdict !== "contradiction");
  const completed = misses.filter((r) => r.row.prediction.status === "ok");
  const categories: Record<string, number> = {},
    bins = { below_0_2: 0, from_0_2_to_0_5: 0, from_0_5_to_0_8: 0 };
  for (const r of completed) {
    const raw = r.row.prediction.raw_scores!;
    const top = Math.max(...Object.values(raw));
    const names = Object.keys(raw)
      .filter((key) => raw[key] === top)
      .sort()
      .join("+");
    categories[names] = (categories[names] ?? 0) + 1;
    const score = raw.contradiction!;
    bins[score < 0.2 ? "below_0_2" : score < 0.5 ? "from_0_2_to_0_5" : "from_0_5_to_0_8"]++;
  }
  const caught = new Set(
    positives.filter((r) => r.row.prediction.verdict === "contradiction").map((r) => r.row.pair.id),
  );
  const unique = new Map(positives.map((r) => [r.row.pair.id, r.row.pair]));
  const never = [...unique.values()]
    .filter((p) => !caught.has(p.id))
    .sort((a, b) => a.id.localeCompare(b.id));
  const thresholdSensitivity = [];
  for (const model of MODELS)
    for (const dataset of DATASETS.filter((d) => d !== "findver")) {
      const cohort = rows.filter((r) => r.model === model && r.dataset === dataset);
      const positives = cohort.filter((r) => r.row.pair.gold === "contradiction").length;
      if (!positives) continue;
      const grid = Array.from({ length: 99 }, (_, i) => {
        const threshold = (i + 1) / 100;
        const selected = cohort.filter(
          (r) =>
            r.row.prediction.status === "ok" &&
            r.row.prediction.raw_scores!.contradiction! >= threshold,
        );
        const tp = selected.filter((r) => r.row.pair.gold === "contradiction").length,
          fp = selected.length - tp;
        return { threshold, tp, fp, f1: (2 * tp) / (positives + tp + fp) };
      }).sort((a, b) => b.f1 - a.f1 || b.threshold - a.threshold);
      thresholdSensitivity.push({ model, dataset, ...grid[0]! });
    }
  return {
    retrospective_nonfinance_f1_grid: thresholdSensitivity,
    optimum_cutoffs_in_0_05_to_0_35: thresholdSensitivity.filter(
      (r) => r.threshold >= 0.05 && r.threshold <= 0.35,
    ).length,
    retrospective_sweep_scope:
      "0.01-to-0.99 grid on archived raw contradiction scores; same-label sensitivity only, not fit inputs or operating policies. No new finance threshold search.",
    parsed_rows_sha256: sha256(JSON.stringify(rows)),
    positive_observations: positives.length,
    distinct_native_positives: unique.size,
    total_missed_outcomes: misses.length,
    completed_misses: completed.length,
    provider_errors: misses.filter((r) => r.row.prediction.status === "error").length,
    top_raw_category_in_completed_misses: categories,
    raw_contradiction_bins_in_completed_misses: bins,
    by_model: Object.fromEntries(
      MODELS.map((model) => {
        const own = misses.filter((r) => r.model === model);
        return [
          model,
          {
            missed: own.length,
            uncertain: own.filter((r) => r.row.prediction.verdict === "uncertain").length,
            false_clears: own.filter((r) => r.row.prediction.verdict === "no_contradiction").length,
            errors: own.filter((r) => r.row.prediction.status === "error").length,
          },
        ];
      }),
    ),
    union_caught: caught.size,
    union_recall: caught.size / unique.size,
    never_caught_by_dataset: Object.fromEntries(
      DATASETS.map((d) => [d, never.filter((p) => p.dataset === d).length]),
    ),
    never_caught: never.map(({ id, dataset, group_id, native_label }) => ({
      id,
      dataset,
      group_id,
      native_label,
    })),
  };
}

const reverseKey = (pair: Pair) =>
  contentKey({ ...pair, claim: pair.evidence, evidence: pair.claim });
const shapeProviders = [
  ...SUPPORTED_MODELS.map(({ id }) =>
    providerFor(
      {
        TYPESAFE_API_KEY: "offline-shape-only",
        OPENAI_API_KEY: "offline-shape-only",
        OPENROUTER_API_KEY: "offline-shape-only",
        AI: {
          run: async () => {
            throw new Error("Offline only");
          },
        },
      },
      id,
    ),
  ),
  createFastinoProvider({ apiKey: "offline-shape-only" }),
];
export function fitsAllModels(pair: Pair) {
  try {
    for (const provider of shapeProviders) {
      const compiled = compileCheck(
        parseCheckRequest({
          claim: { id: "claim", text: pair.claim },
          against: [{ id: "against", text: pair.evidence }],
        }),
        provider.model,
      );
      provider.validateInput?.(compiled.payload);
    }
    return true;
  } catch {
    return false;
  }
}
export function excludeCollidingGroups(
  pairs: Pair[],
  published: Pair[],
  blockedContent: Set<string>,
) {
  const forbidden = new Set<string>();
  const publishedContent = new Set(published.flatMap((p) => [contentKey(p), reverseKey(p)]));
  const seen = new Map<string, string>();
  for (const p of pairs) {
    const g = groupKey(p),
      key = contentKey(p),
      reversed = reverseKey(p);
    if (
      publishedContent.has(key) ||
      blockedContent.has(sha256(JSON.stringify([p.claim, p.evidence])))
    )
      forbidden.add(g);
    const prior = seen.get(key) ?? seen.get(reversed);
    if (prior && prior !== g) {
      forbidden.add(prior);
      forbidden.add(g);
    }
    seen.set(key, g);
    if (!fitsAllModels(p)) forbidden.add(g);
  }
  return {
    pairs: pairs.filter((p) => !forbidden.has(groupKey(p))),
    excluded_groups: forbidden.size,
    excluded_pairs: pairs.filter((p) => forbidden.has(groupKey(p))).length,
  };
}
async function lockMetadata() {
  const iteration = new Set<string>(),
    groups = new Set<string>(),
    content = new Set<string>();
  const inventory: Record<string, string> = {};
  async function visit(dir: string) {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, e.name);
      if (e.isDirectory()) await visit(path);
      else if (/(?:index|source-lock|split-lock)\.json$/.test(e.name)) {
        const bytes = await readFile(path);
        const v = JSON.parse(bytes.toString("utf8")) as Record<string, unknown>;
        if (v.kind === "iteration-training-source-lock") {
          inventory[path] = sha256(bytes);
          const manifests = v.manifests as Record<string, { component_sha256: string[] }>;
          for (const [role, m] of Object.entries(manifests))
            if (/hold|validation/.test(role)) for (const h of m.component_sha256) iteration.add(h);
        } else if (v.kind === "decision-engineering-split-lock") {
          inventory[path] = sha256(bytes);
          const partitions = v.partitions as Record<
            string,
            {
              cases: {
                group_sha256: string;
                content_sha256: string;
                calibration_fold: string | null;
              }[];
            }
          >;
          for (const [role, m] of Object.entries(partitions))
            for (const c of m.cases)
              if (role === "holdout" || c.calibration_fold === "validation") {
                groups.add(c.group_sha256);
                content.add(c.content_sha256);
              }
        }
      }
    }
  }
  await visit("eval/data");
  await visit("eval/results");
  return { iteration, groups, content, inventory };
}
export async function buildCohort(published: Pair[]) {
  const blocked = await lockMetadata();
  const pool = await loadTrainingPool();
  const forbidden = new Set(
    [...pool.components.keys()].filter(
      (id) =>
        blocked.iteration.has(sha256(id)) ||
        ["vitaminc", "scifact"].some((d) =>
          blocked.groups.has(sha256(`${d}:iteration:${sha256(id)}`)),
        ),
    ),
  );
  const available = [...pool.components].filter(([id]) => !forbidden.has(id));
  const totals = available.reduce(
    (a, [, v]) => ({ vitaminc: a.vitaminc + v.vitaminc, scifact: a.scifact + v.scifact }),
    { vitaminc: 0, scifact: 0 },
  );
  const caps = {
    vitaminc: Math.min(1000, totals.vitaminc),
    scifact: Math.min(400, totals.scifact),
  };
  const selected = select(pool.components, SEED + ":source-candidates", caps, forbidden);
  const training = await collectSelectedPairs(pool, { candidate: selected.selected });
  const cnPath = "eval/data/business/contractnli/train.json",
    cnBytes = await readFile(cnPath);
  if (sha256(cnBytes) !== CONTRACT_NLI_MEMBER_SHA256.train)
    throw new Error("ContractNLI source changed");
  const contract = parseContractNli(JSON.parse(cnBytes.toString("utf8")), "train");
  const mnPath = MNLI_SOURCE.files.train.cache_path,
    mnBytes = await readFile(mnPath);
  if (sha256(mnBytes) !== MNLI_SOURCE.files.train.sha256) throw new Error("MNLI source changed");
  const mnRows: Record<string, unknown>[] = [];
  for await (const r of jsonLines(mnPath)) {
    const { pairID, promptID, genre, gold_label, sentence1, sentence2 } = r;
    mnRows.push({ pairID, promptID, genre, gold_label, sentence1, sentence2 });
  }
  const mnli = mnliPairs(mnRows, "train");
  const publishedGroups = new Set(published.map((p) => p.group_id));
  const publishedDocuments = new Set(
    published
      .filter((p) => p.dataset === "contractnli")
      .map((p) => p.source_metadata?.full_document_sha256),
  );
  const business = [...envelopeGroups(contract.pairs).pairs, ...mnli.pairs].filter(
    (p) =>
      !publishedGroups.has(p.group_id) &&
      !blocked.groups.has(sha256(`${p.dataset}:${p.group_id}`)) &&
      !publishedDocuments.has(p.source_metadata?.full_document_sha256),
  );
  const safe = excludeCollidingGroups(
    [...training.candidate, ...business],
    published,
    blocked.content,
  );
  const pairs = [
    ...safe.pairs.filter((p) => ["vitaminc", "scifact"].includes(p.dataset)),
    ...sampleBusinessGroups(
      safe.pairs.filter((p) => p.dataset === "contractnli"),
      800,
      SEED + ":contracts",
    ),
    ...sampleBusinessGroups(
      safe.pairs.filter((p) => p.dataset === "mnli"),
      1000,
      SEED + ":mnli",
    ),
  ];
  const fit: Pair[] = [],
    validation: Pair[] = [];
  for (const dataset of ["vitaminc", "scifact", "contractnli", "mnli"]) {
    const rows = pairs.filter((p) => p.dataset === dataset),
      folds = foldGroups(rows, SEED + ":" + dataset);
    const groups = new Set(folds.fit);
    for (const p of rows) (groups.has(groupKey(p)) ? fit : validation).push(p);
  }
  return {
    fit,
    validation,
    sources: { ...pool.hashes, [cnPath]: sha256(cnBytes), [mnPath]: sha256(mnBytes) },
    blocked_locks: blocked.inventory,
    exclusions: {
      previous_full_dev_sources: pool.excludedSeen,
      unsafe_source_components: pool.excludedEnvelope,
      existing_validation_and_locked_components: forbidden.size,
      duplicate_or_shape_collisions: safe.excluded_pairs,
      contract_train: contract.coverage,
      mnli_genre: mnli.excluded_genre,
      mnli_unlabeled: mnli.excluded_unlabeled,
      mnli_envelope: mnli.excluded_envelope_pairs,
    },
    eligible_training_source_counts: totals,
    selection_caps: { ...caps, contractnli: 800, mnli: 1000 },
  };
}
export async function publishedManifests() {
  const paths = [
    "eval/data/vitaminc-combined-dev-200.json",
    "eval/data/scifact-dev-200.json",
    "eval/data/business/contractnli-dev-200.json",
    "eval/data/business/mnli-nonfiction-dev-200.json",
    "eval/data/business/findver-testmini-ie-individual-82.json",
  ];
  const manifests = await Promise.all(
    paths.map(async (path) => ({
      path,
      manifest: validateManifest(JSON.parse(await readFile(path, "utf8"))),
    })),
  );
  return manifests;
}
