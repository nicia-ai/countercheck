import { z } from "zod";
import { probabilitySchema } from "../contracts/index.js";
import { OPENAI_MODEL_ID } from "../contracts/models.js";
import { assertReportedModel, malformedProvider, validatePayloadResponse } from "./response.js";
import { assertDecisionBodyFits, sendDecision } from "./transport.js";
import type { DecisionPayload, DecisionProvider, EntryValue } from "./types.js";

export const OPENAI_DECISIONS_MODEL = OPENAI_MODEL_ID;
export const OPENAI_DECISIONS_URL = "https://api.openai.com/v1/decisions";

const nativeAnswerSchema = z.strictObject({
  type: z.literal("choice"),
  name: z.string(),
  choice: z.string(),
  confidence: probabilitySchema,
  probabilities: z.array(z.strictObject({ value: z.string(), probability: probabilitySchema })),
});
const nativeResponseSchema = z.strictObject({
  model: z.string().min(1).max(256).optional(),
  answers: z.array(nativeAnswerSchema),
  usage: z
    .object({
      input_tokens: z.number().int().nonnegative().nullable().optional(),
      output_tokens: z.number().int().nonnegative().nullable().optional(),
    })
    .nullable()
    .optional(),
});

// Preserve complete structured instructions and criteria, including unfamiliar fields.
const entryText = (value: EntryValue): string =>
  typeof value === "string" ? value : JSON.stringify(value);
function requestBody(payload: DecisionPayload) {
  return {
    model: OPENAI_DECISIONS_MODEL,
    input: JSON.stringify(payload.state),
    questions: Object.entries(payload.questions).map(([name, question]) => ({
      name,
      type: question.type,
      instructions: entryText(question.instructions),
      choices: Object.entries(question.criteria).map(([value, criterion]) => ({
        value,
        description: entryText(criterion),
      })),
    })),
  };
}

/** Native Decisions arrays are accepted only when every expected name and label occurs once. */
export function createOpenAIDecisionsProvider(config: {
  apiKey: string;
  fetch?: typeof fetch;
}): DecisionProvider {
  return {
    id: "openai-decisions",
    model: OPENAI_DECISIONS_MODEL,
    validateInput(payload: DecisionPayload) {
      assertDecisionBodyFits(requestBody(payload));
    },
    async classify(payload, signal) {
      const raw = await sendDecision(
        config.fetch ?? fetch,
        OPENAI_DECISIONS_URL,
        config.apiKey,
        requestBody(payload),
        signal,
      );
      const parsed = nativeResponseSchema.safeParse(raw);
      if (!parsed.success) throw malformedProvider();
      assertReportedModel(parsed.data, OPENAI_DECISIONS_MODEL);
      const expected = Object.keys(payload.questions);
      const seen = new Set<string>();
      if (parsed.data.answers.length !== expected.length) throw malformedProvider();
      const answers = Object.fromEntries(
        parsed.data.answers.map((answer) => {
          if (!Object.hasOwn(payload.questions, answer.name) || seen.has(answer.name))
            throw malformedProvider();
          seen.add(answer.name);
          const labels = Object.keys(payload.questions[answer.name]!.criteria);
          const labelSet = new Set<string>();
          if (answer.probabilities.length !== labels.length) throw malformedProvider();
          const probabilities = Object.fromEntries(
            answer.probabilities.map(({ value, probability }) => {
              if (!labels.includes(value) || labelSet.has(value)) throw malformedProvider();
              labelSet.add(value);
              return [value, probability];
            }),
          );
          return [
            answer.name,
            {
              type: answer.type,
              choice: answer.choice,
              confidence: answer.confidence,
              probabilities,
            },
          ];
        }),
      );
      return validatePayloadResponse(
        {
          ...(parsed.data.model !== undefined && { model: parsed.data.model }),
          answers,
          ...(parsed.data.usage != null && {
            usage: {
              ...(parsed.data.usage.input_tokens != null && {
                input_tokens: parsed.data.usage.input_tokens,
              }),
              ...(parsed.data.usage.output_tokens != null && {
                output_tokens: parsed.data.usage.output_tokens,
              }),
            },
          }),
        },
        payload,
      );
    },
  };
}
