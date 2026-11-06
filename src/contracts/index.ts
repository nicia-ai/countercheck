import { z } from "zod";
import { LIMITS } from "./limits.js";
import { ServiceError } from "./errors.js";
import { DEFAULT_MODEL, MODEL_IDS } from "./models.js";
export { DEFAULT_MODEL, SUPPORTED_MODELS, type Model } from "./models.js";
export const modelSchema = z
  .enum(MODEL_IDS)
  .describe("Hosted inference model. Omit to use pinned Jev 1.14. No automatic model fallback.");

export function hasUnpairedSurrogate(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
    } else if (code >= 0xdc00 && code <= 0xdfff) return true;
  }
  return false;
}

export const utf8Bytes = (text: string): number => new TextEncoder().encode(text).byteLength;
const idSchema = z
  .string()
  .regex(/^[A-Za-z0-9._:-]{1,128}$/)
  .describe("Caller-defined, case-sensitive ASCII ID. Unique across claim and every comparison.");
const textSchema = (bytes: number) =>
  z
    .string()
    .min(1)
    .max(bytes)
    .superRefine((text, ctx) => {
      if (!text.trim()) ctx.addIssue({ code: "custom", message: "Text must not be blank." });
      if (hasUnpairedSurrogate(text))
        ctx.addIssue({ code: "custom", message: "Text contains invalid Unicode." });
      if (utf8Bytes(text) > bytes)
        ctx.addIssue({ code: "custom", message: "Text exceeds the UTF-8 byte limit." });
    })
    .describe(
      `Nonblank Unicode text, at most ${bytes} UTF-8 bytes. Unpaired surrogates are invalid. Text is preserved exactly without trimming or normalization.`,
    );

export const profileSchema = z
  .enum(["balanced-v1", "semantic-v2", "structured-value-v1"])
  .describe(
    "balanced-v1 is the unchanged default. semantic-v2 and structured-value-v1 are explicitly selected, unqualified experimental profiles.",
  );
export type Profile = z.infer<typeof profileSchema>;
export const checkRequestSchema = z
  .strictObject({
    model: modelSchema.default(DEFAULT_MODEL),
    claim: z.strictObject({ id: idSchema, text: textSchema(LIMITS.claimBytes) }),
    against: z
      .array(z.strictObject({ id: idSchema, text: textSchema(LIMITS.comparisonBytes) }))
      .min(1)
      .max(LIMITS.comparisons),
    profile: profileSchema.default("balanced-v1"),
  })
  .superRefine((request, ctx) => {
    const ids = [request.claim.id, ...request.against.map((item) => item.id)];
    if (new Set(ids).size !== ids.length)
      ctx.addIssue({ code: "custom", message: "All snippet IDs must be unique." });
  })
  .describe(
    "One claim against 1–20 snippets. All IDs must be unique across both roles. English-only evaluation preview; no profile is production-qualified. The full compiled provider payload must also fit 16 KiB; individual text maxima cannot all be used together. No input is truncated.",
  );

export const scoreLabels = [
  "contradiction",
  "consistent",
  "different_scope",
  "insufficient_context",
] as const;
export const probabilitySchema = z.number().min(0).max(1);
export const rawScoresSchema = z
  .strictObject({
    contradiction: probabilitySchema,
    consistent: probabilitySchema,
    different_scope: probabilitySchema,
    insufficient_context: probabilitySchema,
  })
  .refine((scores) => Math.abs(Object.values(scores).reduce((sum, p) => sum + p, 0) - 1) <= 0.001, {
    message: "Probabilities must sum to one within 0.001.",
  })
  .describe(
    "Unmodified provider choice probabilities in [0,1], summing to one within 0.001. These are not independently calibrated truth probabilities.",
  );
export const verdictSchema = z.enum(["contradiction", "no_contradiction_detected", "uncertain"]);
const count = z.number().int().nonnegative();
const candidateCoverageSchema = z.strictObject({
  recognized_spans: count,
  unsupported_spans: count,
  overflow: z.boolean(),
});
export const valueEvidenceSchema = z.strictObject({
  id: z.string().min(1),
  kind: z.enum(["quantity", "date"]),
  span: z.strictObject({
    start: count.describe("Inclusive UTF-16 code-unit offset in the submitted JavaScript string."),
    end: count.describe(
      "Exclusive UTF-16 code-unit offset; [start,end) indexes the submitted string, not UTF-8 bytes.",
    ),
    text: z.string().min(1),
  }),
  operator: z.enum(["eq", "lt", "lte", "gt", "gte", "interval"]),
  lower: z.string().nullable(),
  upper: z.string().nullable(),
  lower_inclusive: z.boolean(),
  upper_inclusive: z.boolean(),
  unit: z.string().nullable(),
  dimension: z.string().nullable(),
});
export const structuredSignalsSchema = z
  .strictObject({
    method: z.literal("candidate_pair_choice_v1"),
    selection: z
      .strictObject({
        probabilities: z
          .record(z.string(), probabilitySchema)
          .refine(
            (p) =>
              Object.keys(p).length > 0 &&
              Object.keys(p).length <= 21 &&
              Math.abs(Object.values(p).reduce((sum, n) => sum + n, 0) - 1) <= 0.001,
          ),
        choice: z.string().optional(),
        confidence: probabilitySchema.optional(),
      })
      .refine(
        (answer) =>
          answer.choice === undefined ||
          (Object.hasOwn(answer.probabilities, answer.choice) &&
            Math.max(...Object.values(answer.probabilities)) -
              answer.probabilities[answer.choice]! <=
              0.001),
      ),
    selected_choice: z.string().min(1),
    pair_probability: probabilitySchema.nullable(),
    selected_pair: z
      .strictObject({ claim: valueEvidenceSchema, against: valueEvidenceSchema })
      .nullable(),
    numeric_relation: z.enum(["incompatible", "compatible", "unknown"]).nullable(),
    numeric_reason: z.string().nullable(),
    decision_basis: z.enum(["semantic", "deterministic_numeric", "uncertain"]),
    candidate_coverage: z.strictObject({
      claim: candidateCoverageSchema,
      against: candidateCoverageSchema,
    }),
  })
  .describe(
    "Experimental model selection probabilities and deterministic diagnostics, not calibrated verdict probabilities. Numeric overlap never proves whole-pair consistency.",
  );
const comparisonShape = {
  against_id: idSchema,
  verdict: verdictSchema,
  reason: z.enum([
    "incompatible_assertions",
    "jointly_satisfiable",
    "different_scope",
    "insufficient_confidence_or_context",
  ]),
  evidence: z.strictObject({
    claim_id: idSchema,
    against_id: idSchema,
    granularity: z.literal("submitted_text"),
  }),
};
const relationComparisonSchema = z.strictObject({
  ...comparisonShape,
  raw_scores: rawScoresSchema,
  structured_signals: z.never().optional(),
});
const structuredComparisonSchema = z.strictObject({
  ...comparisonShape,
  raw_scores: z.never().optional(),
  structured_signals: structuredSignalsSchema,
});
const responseShape = {
  request_id: z.string().min(1),
  status: z.literal("completed"),
  claim_id: idSchema,
  coverage: z.strictObject({
    scope: z.literal("claim_against_each_text"),
    requested: count,
    completed: count,
    unassessed: z.literal(0),
    input_truncated: z.literal(false),
  }),
  usage: z.strictObject({ provider_calls: z.literal(1), input_tokens: count.nullable() }),
};
const engineShape = {
  engine_release: z.string().min(1),
  prompt_version: z.string().min(1),
  threshold_version: z.string().min(1),
  provider: z.string().min(1),
  requested_model: z.string().min(1),
  reported_model: z.string().min(1).nullable(),
  model_revision: z.string().min(1).nullable(),
};
export const checkResponseSchema = z.union([
  z.strictObject({
    ...responseShape,
    comparisons: z.array(relationComparisonSchema).min(1).max(LIMITS.comparisons),
    engine: z.strictObject({
      profile: z.literal("balanced-v1"),
      ...engineShape,
      experimental: z.never().optional(),
    }),
  }),
  z.strictObject({
    ...responseShape,
    comparisons: z.array(relationComparisonSchema).min(1).max(LIMITS.comparisons),
    engine: z.strictObject({
      profile: z.literal("semantic-v2"),
      ...engineShape,
      experimental: z.literal(true),
    }),
  }),
  z.strictObject({
    ...responseShape,
    comparisons: z.array(structuredComparisonSchema).min(1).max(LIMITS.comparisons),
    engine: z.strictObject({
      profile: z.literal("structured-value-v1"),
      ...engineShape,
      experimental: z.literal(true),
    }),
  }),
]);

export const errorResponseSchema = z.strictObject({
  error: z.strictObject({
    code: z.string().min(1),
    message: z.string().min(1),
    retryable: z.boolean(),
  }),
  request_id: z.string().min(1),
});
export type CheckRequest = z.infer<typeof checkRequestSchema>;
export type CheckResponse = z.infer<typeof checkResponseSchema>;
export type Verdict = z.infer<typeof verdictSchema>;
export type RawScores = z.infer<typeof rawScoresSchema>;

export function parseCheckRequest(value: unknown): CheckRequest {
  const parsed = checkRequestSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  const input = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const snippets = [input.claim, ...(Array.isArray(input.against) ? input.against : [])];
  const invalidUnicode = snippets.some((snippet: unknown) => {
    if (!snippet || typeof snippet !== "object" || !("text" in snippet)) return false;
    return typeof snippet.text === "string" && hasUnpairedSurrogate(snippet.text);
  });
  throw new ServiceError(
    invalidUnicode ? 400 : 422,
    invalidUnicode ? "invalid_unicode" : "invalid_request",
    invalidUnicode
      ? "Input contains invalid Unicode."
      : "Input does not match the check request contract.",
  );
}
