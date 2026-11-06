import { z } from "zod";
import type { DecisionPayload, DecisionProvider } from "../src/providers/types.js";
import { assertDecisionBodyFits, sendDecision } from "../src/providers/transport.js";
import {
  malformedProvider,
  payloadResponseSchema,
  validatePayloadResponse,
} from "../src/providers/response.js";

// Evaluation only. Aliases and retired IDs must not enter model comparisons.
export const naceModelSchema = z.enum([
  "drex-v1.5",
  "drex-v2.0",
  "drex-max",
  "drex-max-v1.1",
  "drex-max-finance",
]);
export type NaceModel = z.infer<typeof naceModelSchema>;
export const NACE_SYSTEMONE_URL = "https://console.nace.ai/v1/systemone";
const responseSchema = payloadResponseSchema.extend({
  model: naceModelSchema,
  evaluation_time_ms: z.number().finite().nonnegative().optional(),
  request_id: z.string().optional(),
});

export function createNaceProvider(config: {
  apiKey: string;
  model: NaceModel;
  fetch?: typeof fetch;
}): DecisionProvider {
  const model = naceModelSchema.parse(config.model);
  const body = (payload: DecisionPayload) => ({ ...payload, model });
  return {
    id: "nace",
    model,
    validateInput(payload) {
      assertDecisionBodyFits(body(payload));
    },
    async classify(payload, signal) {
      const raw = await sendDecision(
        config.fetch ?? fetch,
        NACE_SYSTEMONE_URL,
        config.apiKey,
        body(payload),
        signal,
      );
      const parsed = responseSchema.safeParse(raw);
      if (!parsed.success || parsed.data.model !== model) throw malformedProvider();
      const { evaluation_time_ms, request_id, ...response } = parsed.data;
      void evaluation_time_ms;
      void request_id;
      return validatePayloadResponse(response, payload);
    },
  };
}
