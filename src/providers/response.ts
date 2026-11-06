import { z } from "zod";
import { probabilitySchema, rawScoresSchema, scoreLabels } from "../contracts/index.js";
import { ServiceError } from "../contracts/errors.js";
import type { DecisionPayload } from "./types.js";

const answerSchema = z
  .strictObject({
    type: z.literal("choice"),
    choice: z.enum(scoreLabels).optional(),
    confidence: probabilitySchema.optional(),
    probabilities: rawScoresSchema,
  })
  .refine(
    (answer) =>
      answer.choice === undefined ||
      Math.max(...Object.values(answer.probabilities)) - answer.probabilities[answer.choice] <=
        0.001,
    { message: "Selected choice must maximize its distribution." },
  );

export const decisionResponseSchema = z.strictObject({
  model: z.string().min(1).max(256).optional(),
  model_revision: z.string().min(1).max(256).optional(),
  answers: z.record(z.string(), answerSchema),
  usage: z
    .strictObject({
      input_tokens: z.number().int().nonnegative().optional(),
      output_tokens: z.number().int().nonnegative().optional(),
    })
    .optional(),
});

export const malformedProvider = (): ServiceError =>
  new ServiceError(
    502,
    "provider_invalid_response",
    "The inference provider returned an invalid or incomplete response.",
  );

export function assertReportedModel(
  response: { model?: string | undefined },
  expected: string,
): void {
  if (response.model !== undefined && response.model !== expected)
    throw new ServiceError(
      502,
      "provider_model_mismatch",
      "The inference provider reported an unexpected model.",
    );
}

export function validateDecisionResponse(value: unknown, questionIds: readonly string[]) {
  const parsed = decisionResponseSchema.safeParse(value);
  if (!parsed.success) throw malformedProvider();
  const actual = Object.keys(parsed.data.answers);
  if (
    actual.length !== questionIds.length ||
    questionIds.some((id) => !Object.hasOwn(parsed.data.answers, id))
  )
    throw malformedProvider();
  return parsed.data;
}

const payloadAnswerSchema = z
  .strictObject({
    type: z.literal("choice"),
    choice: z.string().min(1).optional(),
    confidence: probabilitySchema.optional(),
    probabilities: z.record(z.string(), probabilitySchema),
  })
  .refine((answer) => {
    const probabilities = Object.values(answer.probabilities);
    return (
      probabilities.length > 0 &&
      Math.abs(probabilities.reduce((sum, n) => sum + n, 0) - 1) <= 0.001 &&
      (answer.choice === undefined ||
        (Object.hasOwn(answer.probabilities, answer.choice) &&
          Math.max(...probabilities) - answer.probabilities[answer.choice]! <= 0.001))
    );
  });
export const payloadResponseSchema = decisionResponseSchema.extend({
  answers: z.record(z.string(), payloadAnswerSchema),
});

/** Dynamic candidate labels remain choice outputs, never relation RawScores. */
export function validatePayloadResponse(value: unknown, payload: DecisionPayload) {
  const questions = Object.keys(payload.questions);
  const relationOnly = questions.every((id) => {
    const labels = Object.keys(payload.questions[id]!.criteria);
    return (
      labels.length === scoreLabels.length && scoreLabels.every((label) => labels.includes(label))
    );
  });
  if (relationOnly) return validateDecisionResponse(value, questions);
  const parsed = payloadResponseSchema.safeParse(value);
  if (!parsed.success || Object.keys(parsed.data.answers).length !== questions.length)
    throw malformedProvider();
  for (const id of questions) {
    const answer = parsed.data.answers[id];
    const labels = Object.keys(payload.questions[id]!.criteria);
    if (
      !answer ||
      Object.keys(answer.probabilities).length !== labels.length ||
      labels.some((label) => !Object.hasOwn(answer.probabilities, label))
    )
      throw malformedProvider();
  }
  return parsed.data;
}
