import { z } from "zod";
import { probabilitySchema, parseCheckRequest, utf8Bytes } from "../../src/contracts/index.js";
import { ServiceError } from "../../src/contracts/errors.js";
import { compareValueCandidates } from "../../src/kernel/values.js";
import {
  createBackend,
  sendBackend,
  backendPayload,
  modelReportedCompatible,
  type BackendConfig,
} from "./backends.js";
import { malformedProvider } from "../../src/providers/response.js";
import { withDeadline } from "../../src/http/deadline.js";
import {
  sha256,
  predictionSchema,
  projectScores,
  projectNliScores,
  type Pair,
  type Prediction,
} from "../types.js";
import type { RawScores } from "../../src/contracts/index.js";
import { compileCandidate, type CandidateId, type CompiledCandidate } from "./profiles.js";

const choice = z.strictObject({
  type: z.literal("choice"),
  probabilities: z.record(z.string(), probabilitySchema),
  choice: z.string().optional(),
  confidence: probabilitySchema.optional(),
});
const noul = z.strictObject({ type: z.literal("noul"), noul: probabilitySchema });
const responseSchema = z.strictObject({
  model: z.string().min(1).max(256).optional(),
  model_revision: z.string().min(1).max(256).optional(),
  answers: z.record(z.string(), z.discriminatedUnion("type", [choice, noul])),
  usage: z
    .strictObject({
      input_tokens: z.number().int().nonnegative().optional(),
      output_tokens: z.number().int().nonnegative().optional(),
    })
    .optional(),
});
export function parseResponse(raw: unknown, compiled: CompiledCandidate) {
  const result = responseSchema.safeParse(raw);
  if (!result.success) throw malformedProvider();
  const response = result.data;
  if (
    response.model !== undefined &&
    !modelReportedCompatible(compiled.payload.model, response.model)
  )
    throw new ServiceError(502, "provider_model_mismatch", "Unexpected inference model.");
  const ids = Object.keys(compiled.payload.questions);
  if (Object.keys(response.answers).length !== ids.length) throw malformedProvider();
  for (const id of ids) {
    const expected = compiled.payload.questions[id]!;
    const answer = response.answers[id];
    if (!answer || answer.type !== expected.type) throw malformedProvider();
    if (expected.type === "choice" && answer.type === "choice") {
      const labels = Object.keys(expected.criteria);
      const p = answer.probabilities;
      if (
        Object.keys(p).length !== labels.length ||
        labels.some((label) => !Object.hasOwn(p, label)) ||
        Math.abs(Object.values(p).reduce((a, b) => a + b, 0) - 1) > 0.001 ||
        (answer.choice !== undefined &&
          (!Object.hasOwn(p, answer.choice) ||
            Math.max(...Object.values(p)) - p[answer.choice]! > 0.001))
      )
        throw malformedProvider();
    }
  }
  return response;
}
export type Features = {
  conflict: number;
  negative: number;
  unknown: number;
  scope: number;
  applicability: number | null;
  determinable: number | null;
  quantitative_decisive: number | null;
  numeric_probability: number | null;
  numeric_relation: "incompatible" | "compatible" | "unknown" | null;
  numeric_available: boolean;
};
export type Policy = {
  positive: number;
  negative_cut: number;
  negative_support: number;
  unknown_max: number;
  scope_negative: boolean;
  quantitative_gate: boolean;
  numeric_override: boolean;
};
export const DEFAULT_POLICY: Policy = {
  positive: 0.8,
  negative_cut: 0.2,
  negative_support: 0.8,
  unknown_max: 1,
  scope_negative: false,
  quantitative_gate: true,
  numeric_override: true,
};
export function extractFeatures(
  response: ReturnType<typeof parseResponse>,
  compiled: CompiledCandidate,
): Features {
  const role = compiled.signal_questions;
  const relation = role.relation ? response.answers[role.relation] : undefined;
  const rawProbs = relation?.type === "choice" ? relation.probabilities : {};
  const total = Object.values(rawProbs).reduce((a, b) => a + b, 0);
  const probs = Object.fromEntries(
    Object.entries(rawProbs).map(([label, value]) => [label, value / total]),
  );
  const yes = (id?: string) =>
    id && response.answers[id]?.type === "noul" ? response.answers[id].noul : null;
  const conflict = yes(role.conflict) ?? probs.contradiction ?? 0;
  const isNli = Object.hasOwn(probs, "entailment");
  const negative = relation
    ? isNli
      ? (probs.entailment ?? 0) + (probs.neutral ?? 0)
      : (probs.consistent ?? 0) + (probs.different_scope ?? 0)
    : 1 - conflict;
  const numeric = role.numeric_selection ? response.answers[role.numeric_selection] : undefined;
  let numericProbability: number | null = null,
    numericRelation: Features["numeric_relation"] = null;
  if (numeric?.type === "choice") {
    const selected =
      numeric.choice ??
      Object.entries(numeric.probabilities).reduce((a, b) => (b[1] > a[1] ? b : a))[0];
    const pair = compiled.numeric_context?.pairs.get(selected);
    if (pair && compiled.numeric_context?.available) {
      numericProbability = numeric.probabilities[selected]!;
      numericRelation = compareValueCandidates(pair[0], pair[1]).relation;
    }
  }
  return {
    conflict,
    negative,
    unknown: probs.insufficient_context ?? 0,
    scope: probs.different_scope ?? 0,
    applicability: yes(role.applicability),
    determinable: yes(role.determinable),
    quantitative_decisive: yes(role.quantitative_decisive),
    numeric_probability: numericProbability,
    numeric_relation: numericRelation,
    numeric_available: compiled.numeric_context?.available ?? false,
  };
}
export function compose(
  f: Features,
  policy: Policy,
): "contradiction" | "no_contradiction" | "uncertain" {
  if (f.unknown > policy.unknown_max) return "uncertain";
  const quantitative = (f.quantitative_decisive ?? 0) >= 0.8;
  if (
    policy.numeric_override &&
    quantitative &&
    f.numeric_available &&
    (f.numeric_probability ?? 0) >= 0.8 &&
    f.numeric_relation === "incompatible"
  )
    return "contradiction";
  // Only a judgment that unresolved arithmetic is decisive may veto semantics.
  if (
    policy.quantitative_gate &&
    quantitative &&
    (!f.numeric_available ||
      (f.numeric_probability ?? 0) < 0.8 ||
      f.numeric_relation === "unknown" ||
      f.numeric_relation === null)
  )
    return "uncertain";
  // An eligible, decisive interval comparison must not be overruled by guessed arithmetic.
  // Overlap still cannot establish whole-pair compatibility.
  if (
    quantitative &&
    f.numeric_available &&
    (f.numeric_probability ?? 0) >= 0.8 &&
    f.numeric_relation === "compatible" &&
    f.conflict >= policy.positive
  )
    return "uncertain";
  if (f.conflict >= policy.positive) return "contradiction";
  if (policy.scope_negative && f.applicability !== null && f.applicability <= 0.2)
    return "no_contradiction";
  if (
    f.conflict <= policy.negative_cut &&
    f.negative >= policy.negative_support &&
    (f.determinable === null || f.determinable >= 0.8)
  )
    return "no_contradiction";
  return "uncertain";
}
export type Observation = {
  profile: CandidateId;
  pair_id: string;
  pass: number;
  prompt_sha256: string | null;
  compiled_bytes: number | null;
  provider_calls: 0 | 1;
  features: Features | null;
  raw_answers: ReturnType<typeof parseResponse>["answers"] | null;
  prediction: Prediction;
};
export async function runPair(
  profile: CandidateId,
  pair: Pair,
  pass: number,
  options: {
    apiKey: string;
    sequence: number;
    fetch?: typeof fetch;
    fake?: boolean;
    backend?: BackendConfig;
  },
): Promise<Observation> {
  const start = performance.now();
  const backend =
    options.backend ??
    createBackend("jev", { TYPESAFE_API_KEY: options.apiKey || (options.fake ? "fake" : "") });
  let compiled: CompiledCandidate | undefined,
    hash: string | null = null,
    calls: 0 | 1 = 0,
    features: Features | null = null,
    rawAnswers: Observation["raw_answers"] = null;
  const common = {
    pair_id: pair.id,
    pass,
    request_id: `iteration-${options.sequence}`,
    model: backend.model,
    provider: options.fake ? "fake" : backend.id,
    engine_release: "decision-iteration-v1",
    prompt_version: profile,
    threshold_version: "iteration-fixed-0.8-v1",
  };
  let prediction: Prediction;
  try {
    prediction = await withDeadline(
      async (signal) => {
        parseCheckRequest({
          claim: { id: "claim", text: pair.claim },
          against: [{ id: "comparison", text: pair.evidence }],
        });
        compiled = compileCandidate(profile, { claim: pair.claim, evidence: pair.evidence });
        compiled.payload.model = backend.model;
        const wire = JSON.stringify(backendPayload(backend, compiled.payload));
        hash = sha256(wire);
        compiled.compiled_bytes = utf8Bytes(wire);
        if (compiled.compiled_bytes > 16384)
          throw new ServiceError(422, "compiled_input_too_large", "Compiled input exceeds budget.");
        let raw: unknown;
        if (options.fake)
          raw = {
            model: backend.model,
            answers: Object.fromEntries(
              Object.entries(compiled.payload.questions).map(([id, q]) => [
                id,
                q.type === "noul"
                  ? { type: "noul", noul: 0.5 }
                  : {
                      type: "choice",
                      probabilities: Object.fromEntries(
                        Object.keys(q.criteria).map((label) => [
                          label,
                          1 / Object.keys(q.criteria).length,
                        ]),
                      ),
                    },
              ]),
            ),
          };
        else {
          calls = 1;
          raw = await sendBackend(backend, compiled.payload, signal, options.fetch ?? fetch);
        }
        if (signal.aborted) throw signal.reason;
        const response = parseResponse(raw, compiled);
        rawAnswers = response.answers;
        features = extractFeatures(response, compiled);
        return headPrediction(
          compiled,
          response,
          features,
          common,
          hash,
          performance.now() - start,
          !!options.fake,
        );
      },
      3000,
      new ServiceError(504, "deadline_exceeded", "Iteration deadline exceeded."),
    );
  } catch (error) {
    prediction = predictionSchema.parse({
      ...common,
      status: error instanceof ServiceError && error.status === 422 ? "excluded" : "error",
      error_code: error instanceof ServiceError ? error.code : "iteration_failure",
      latency_ms: performance.now() - start,
    });
  }
  return {
    profile,
    pair_id: pair.id,
    pass,
    prompt_sha256: hash,
    compiled_bytes: compiled?.compiled_bytes ?? null,
    provider_calls: calls,
    features,
    raw_answers: rawAnswers,
    prediction,
  };
}

export function headPrediction(
  compiled: CompiledCandidate,
  response: ReturnType<typeof parseResponse>,
  features: Features,
  common: Record<string, unknown>,
  hash: string | null,
  latency: number,
  fake: boolean,
): Prediction {
  const rel = compiled.signal_questions.relation
    ? response.answers[compiled.signal_questions.relation]
    : undefined;
  const p = rel?.type === "choice" ? rel.probabilities : {};
  const isFour = Object.hasOwn(p, "consistent");
  const probabilities = isFour
    ? projectScores(p as RawScores)
    : Object.hasOwn(p, "entailment")
      ? projectNliScores({
          contradiction: p.contradiction!,
          entailment: p.entailment!,
          neutral: p.neutral!,
        })
      : {
          contradiction: features.conflict,
          no_contradiction: features.negative,
          insufficient_context: features.unknown,
        };
  return predictionSchema.parse({
    ...common,
    status: "ok",
    verdict: compose(features, DEFAULT_POLICY),
    probabilities,
    ...(isFour ? { raw_scores: p } : {}),
    latency_ms: latency,
    prompt_hash: hash,
    reported_model: response.model ?? null,
    model_revision: response.model_revision ?? null,
    request_usage: {
      input_tokens: response.usage?.input_tokens ?? null,
      output_tokens: response.usage?.output_tokens ?? null,
    },
    probability_interpretation: isFour
      ? "semantic choice only; not a calibrated composed verdict"
      : rel
        ? "native NLI projection"
        : "binary Noul marginal; no joint three-way calibration",
    ...(fake ? { cost_usd: 0 } : {}),
  });
}
