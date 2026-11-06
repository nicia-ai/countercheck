import { z } from "zod";
import type { DecisionPayload, DecisionProvider } from "../src/providers/types.js";
import { assertDecisionBodyFits, sendDecision } from "../src/providers/transport.js";
import {
  payloadResponseSchema,
  malformedProvider,
  validatePayloadResponse,
} from "../src/providers/response.js";

// Evaluation comparator only: not an exposed Countercheck API model.
export const FASTINO_GLIDE_MODEL = "fastino/GLiDE";
export const FASTINO_SYSTEMONE_URL = "https://api.fastino.ai/v1/systemone";
const responseSchema = payloadResponseSchema.extend({
  model: z.enum(["glide", "glide_v2"]),
  token_usage: z.number().int().nonnegative(),
});

export function createFastinoProvider(config: {
  apiKey: string;
  fetch?: typeof fetch;
}): DecisionProvider {
  const body = (payload: DecisionPayload) => ({
    ...payload,
    model: FASTINO_GLIDE_MODEL,
    store: false,
    thinking: false,
    questions: Object.fromEntries(
      Object.entries(payload.questions).map(([id, question]) => [
        id,
        {
          ...question,
          instructions:
            typeof question.instructions === "string"
              ? question.instructions
              : JSON.stringify(question.instructions),
        },
      ]),
    ),
  });
  return {
    id: "fastino",
    model: FASTINO_GLIDE_MODEL,
    validateInput(payload) {
      assertDecisionBodyFits(body(payload));
    },
    async classify(payload, signal) {
      const raw = await sendDecision(
        config.fetch ?? fetch,
        FASTINO_SYSTEMONE_URL,
        config.apiKey,
        body(payload),
        signal,
      );
      const parsed = responseSchema.safeParse(raw);
      if (!parsed.success) throw malformedProvider();
      // The documented response uses the unprefixed engine name; preserve it as reported.

      const { token_usage, ...response } = parsed.data;
      void token_usage;
      return validatePayloadResponse(response, payload);
    },
  };
}
