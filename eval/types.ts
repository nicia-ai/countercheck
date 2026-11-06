import { createHash } from "node:crypto";
import { z } from "zod";
import {
  probabilitySchema,
  rawScoresSchema,
  structuredSignalsSchema,
  type RawScores,
  type Verdict,
} from "../src/contracts/index.js";

export type Gold = "contradiction" | "non_contradiction";
export type Probabilities = {
  contradiction: number;
  no_contradiction: number;
  insufficient_context: number;
};
export type EvaluationVerdict = "contradiction" | "no_contradiction" | "uncertain";
export const evaluationVerdict = (verdict: Verdict): EvaluationVerdict =>
  verdict === "no_contradiction_detected" ? "no_contradiction" : verdict;
export function projectScores(scores: RawScores): Probabilities {
  const total = Object.values(scores).reduce((sum, p) => sum + p, 0);
  return {
    contradiction: scores.contradiction / total,
    no_contradiction: (scores.consistent + scores.different_scope) / total,
    insufficient_context: scores.insufficient_context / total,
  };
}
export function projectNliScores(scores: {
  contradiction: number;
  entailment: number;
  neutral: number;
}): Probabilities {
  const total = scores.contradiction + scores.entailment + scores.neutral;
  return {
    contradiction: scores.contradiction / total,
    no_contradiction: (scores.entailment + scores.neutral) / total,
    insufficient_context: 0,
  };
}
const probabilitiesSchema = z
  .strictObject({
    contradiction: probabilitySchema,
    no_contradiction: probabilitySchema,
    insufficient_context: probabilitySchema,
  })
  .refine((p) => Math.abs(Object.values(p).reduce((sum, n) => sum + n, 0) - 1) <= 0.001);
const nliProbabilitiesSchema = z
  .strictObject({
    contradiction: probabilitySchema,
    entailment: probabilitySchema,
    neutral: probabilitySchema,
  })
  .refine((p) => Math.abs(Object.values(p).reduce((sum, n) => sum + n, 0) - 1) <= 0.001);
const predictionMetadataSchema = z
  .object({
    pair_id: z.string().min(1),
    pass: z.number().int().positive(),
    latency_ms: z.number().nonnegative(),
    presentation: z.string().optional(),
    request_id: z.string().optional(),
    prompt_hash: z.string().optional(),
    error_code: z.string().optional(),
    cost_usd: z.number().nonnegative().optional(),
    input_tokens: z.number().int().nonnegative().optional(),
    output_tokens: z.number().int().nonnegative().optional(),
    request_usage: z
      .strictObject({
        input_tokens: z.number().int().nonnegative().nullable(),
        output_tokens: z.number().int().nonnegative().nullable(),
      })
      .optional(),
    model: z.string().optional(),
    engine_release: z.string().optional(),
    provider: z.string().optional(),
    reported_model: z.string().nullable().optional(),
    model_revision: z.string().nullable().optional(),
    prompt_version: z.string().optional(),
    threshold_version: z.string().optional(),
  })
  .passthrough();
const failedPrediction = predictionMetadataSchema.extend({
  status: z.enum(["error", "excluded"]),
  verdict: z.never().optional(),
  probabilities: z.never().optional(),
  raw_scores: z.never().optional(),
  structured_signals: z.never().optional(),
  nli_probabilities: z.never().optional(),
  forced_nli_verdict: z.never().optional(),
});
export const predictionSchema = z
  .discriminatedUnion("status", [
    predictionMetadataSchema.extend({
      status: z.literal("ok"),
      verdict: z.enum(["contradiction", "no_contradiction", "uncertain"]),
      probabilities: probabilitiesSchema.optional(),
      structured_signals: structuredSignalsSchema.optional(),
      raw_scores: rawScoresSchema.optional(),
      nli_probabilities: nliProbabilitiesSchema.optional(),
      forced_nli_verdict: z.enum(["contradiction", "no_contradiction", "uncertain"]).optional(),
    }),
    failedPrediction,
  ])
  .superRefine((row, ctx) => {
    if (row.request_usage && !row.request_id)
      ctx.addIssue({ code: "custom", message: "Request-level usage requires a request ID." });
    if (row.status !== "ok") return;
    if (!row.probabilities && !row.structured_signals)
      ctx.addIssue({
        code: "custom",
        message: "Successful rows require probabilities or structured signals.",
      });
    if (row.probabilities && row.structured_signals)
      ctx.addIssue({
        code: "custom",
        message: "Structured choice signals have no calibrated three-way projection.",
      });
    const projections: Probabilities[] = [];
    if (row.raw_scores) projections.push(projectScores(row.raw_scores));
    if (row.nli_probabilities) projections.push(projectNliScores(row.nli_probabilities));
    if (
      projections.some((p) =>
        (Object.keys(p) as (keyof Probabilities)[]).some(
          (key) => !row.probabilities || Math.abs(p[key] - row.probabilities[key]) > 0.001,
        ),
      )
    )
      ctx.addIssue({
        code: "custom",
        message: "Raw distributions disagree with scored probabilities.",
      });
  });

export type Prediction = z.infer<typeof predictionSchema>;

const replayMetadataSchema = z
  .object({ manifest_sha256: z.string().regex(/^[a-f0-9]{64}$/) })
  .passthrough();
export type ReplayMetadata = z.infer<typeof replayMetadataSchema>;
export function validateReplayMetadata(value: unknown, expectedHash: string): ReplayMetadata {
  const metadata = replayMetadataSchema.parse(value);
  if (metadata.manifest_sha256 !== expectedHash) throw new Error("Replay manifest hash mismatch");
  return metadata;
}
export const PAIR_DATASETS = [
  "vitaminc",
  "scifact",
  "contractnli",
  "mnli",
  "findver",
  "synthetic-smoke",
] as const;
export type Pair = {
  id: string;
  dataset: (typeof PAIR_DATASETS)[number];
  variant: string;
  split: "train" | "dev" | "test" | "synthetic";
  source_id: string;
  group_id: string;
  claim: string;
  evidence: string;
  gold: Gold;
  native_label: string;
  source_metadata?: Record<string, string> | undefined;
  rationale?: { document_id: string; sentence_indices: number[]; set_index: number };
};
/** Synthetic uncertain fixtures have a schema-only binary proxy, never clear-negative truth. */
export function isUncertainFixture(pair: Pair): boolean {
  return (
    pair.dataset === "synthetic-smoke" &&
    pair.native_label === "uncertain" &&
    pair.source_metadata?.expected_verdict === "uncertain"
  );
}
export type Source = {
  name: string;
  url: string;
  revision: string;
  sha256: string;
  license: string;
  license_url: string;
};
export type GroupStatistics = {
  pairs: number;
  groups: number;
  group_size_counts: Record<string, number>;
  mean_group_size: number | null;
  max_group_size: number | null;
  mixed_native_label_groups: number;
  mixed_native_label_group_fraction: number | null;
};
export type Manifest = {
  schema_version: 1;
  adapter_version: "countercheck-public-pairs-v1";
  purpose: "development" | "locked-test" | "synthetic-smoke";
  sources: Source[];
  sampling: {
    seed: string;
    max_pairs: number;
    method: string;
    available_pairs: number;
    selected_pairs: number;
    excluded_unlabeled: number;
    strata: Record<string, number>;
    group_diagnostics?: {
      population: GroupStatistics;
      selected: GroupStatistics;
      bias_disclosure: string;
    };
  };
  pairs: Pair[];
};
export function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
const allowedSplits: Record<Manifest["purpose"], readonly Pair["split"][]> = {
  development: ["train", "dev"],
  "locked-test": ["test"],
  "synthetic-smoke": ["synthetic"],
};
export function validateManifest(value: unknown): Manifest {
  const m = value as Manifest;
  if (
    m?.schema_version !== 1 ||
    m.adapter_version !== "countercheck-public-pairs-v1" ||
    !Array.isArray(m.pairs) ||
    !m.pairs.length ||
    !m.sources?.length ||
    !m.sampling
  )
    throw new Error("Invalid pair manifest");
  if (!["development", "locked-test", "synthetic-smoke"].includes(m.purpose))
    throw new Error("Invalid manifest purpose");
  if (
    typeof m.sampling.seed !== "string" ||
    !m.sampling.seed ||
    m.sampling.selected_pairs !== m.pairs.length ||
    !Number.isSafeInteger(m.sampling.available_pairs) ||
    m.sampling.available_pairs < m.pairs.length ||
    !Number.isSafeInteger(m.sampling.excluded_unlabeled) ||
    m.sampling.excluded_unlabeled < 0
  )
    throw new Error("Invalid sampling provenance");
  const ids = new Set<string>();
  for (const p of m.pairs) {
    if (
      !p.id ||
      ids.has(p.id) ||
      !p.group_id ||
      !p.source_id ||
      !p.claim?.trim() ||
      !p.evidence?.trim() ||
      !["contradiction", "non_contradiction"].includes(p.gold) ||
      !PAIR_DATASETS.includes(p.dataset)
    )
      throw new Error("Invalid or duplicate manifest pair");
    if (
      p.dataset === "vitaminc" &&
      (!["SUPPORTS", "REFUTES", "NOT ENOUGH INFO"].includes(p.native_label) ||
        (p.native_label === "REFUTES") !== (p.gold === "contradiction"))
    )
      throw new Error("Invalid VitaminC gold mapping");
    if (
      p.dataset === "scifact" &&
      (!["SUPPORT", "CONTRADICT"].includes(p.native_label) ||
        (p.native_label === "CONTRADICT") !== (p.gold === "contradiction") ||
        !p.rationale?.sentence_indices.length)
    )
      throw new Error("Invalid SciFact gold rationale mapping");
    if (
      p.dataset === "contractnli" &&
      (!["Entailment", "Contradiction"].includes(p.native_label) ||
        (p.native_label === "Contradiction") !== (p.gold === "contradiction"))
    )
      throw new Error("Invalid ContractNLI oracle-evidence gold mapping");
    if (
      p.dataset === "mnli" &&
      (!["entailment", "contradiction", "neutral"].includes(p.native_label) ||
        (p.native_label === "contradiction") !== (p.gold === "contradiction"))
    )
      throw new Error("Invalid MultiNLI gold mapping");
    if (
      p.dataset === "findver" &&
      (!["entailed", "refuted"].includes(p.native_label) ||
        (p.native_label === "refuted") !== (p.gold === "contradiction"))
    )
      throw new Error("Invalid FinDVer gold mapping");
    if (!["train", "dev", "test", "synthetic"].includes(p.split))
      throw new Error("Invalid original split");
    if (!allowedSplits[m.purpose].includes(p.split))
      throw new Error("Manifest purpose does not match original split");
    if ((m.purpose === "synthetic-smoke") !== (p.dataset === "synthetic-smoke"))
      throw new Error("Synthetic smoke must remain separate from public datasets");
    ids.add(p.id);
  }
  for (const s of m.sources)
    if (!/^[a-f0-9]{64}$/.test(s.sha256) || !s.url || !s.revision || !s.license || !s.license_url)
      throw new Error("Missing pinned source provenance");
  return m;
}
