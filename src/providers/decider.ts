import { z } from "zod";
import {
  DECISION_ONE_MODEL_ID,
  DECIDER_MODEL_ID,
  DECIDER_FLASH_MODEL_ID,
} from "../contracts/models.js";
import {
  assertReportedModel,
  payloadResponseSchema,
  malformedProvider,
  validatePayloadResponse,
} from "./response.js";
import { assertDecisionBodyFits, sendDecision } from "./transport.js";
import type { DecisionPayload, DecisionProvider } from "./types.js";

export const DECIDER_MODEL = DECIDER_MODEL_ID;
export const DECIDER_URL = "https://openrouter.ai/api/alpha/decisions";
export type OpenRouterDecisionModel =
  typeof DECISION_ONE_MODEL_ID | typeof DECIDER_MODEL | typeof DECIDER_FLASH_MODEL_ID;
// Reviewed snapshots published by each model's official OpenRouter /endpoints catalog.
const reportedModelAliases: Record<OpenRouterDecisionModel, string> = {
  [DECISION_ONE_MODEL_ID]: "microsoft/microsoft-decision-1-20261009",
  [DECIDER_MODEL_ID]: "perplexity/pplx-decider-v1.2-20261016",
  [DECIDER_FLASH_MODEL_ID]: "perplexity/pplx-decider-flash-v1.2-20261016",
};
const routerResponseSchema = payloadResponseSchema.extend({
  id: z.string().optional(),
  provider: z.string().optional(),
  // Router billing metadata is not part of the decision contract. Strip extras here;
  // model identity, answers, probabilities and the token counts stay validated.
  usage: z
    .object({
      input_tokens: z.number().int().nonnegative(),
      output_tokens: z.number().int().nonnegative(),
      cost: z.number().nonnegative().optional(),
    })
    .optional(),
});

export function createOpenRouterProvider(config: {
  apiKey: string;
  model: OpenRouterDecisionModel;
  fetch?: typeof fetch;
}): DecisionProvider {
  const perplexity = config.model.startsWith("perplexity/");
  const requestBody = (payload: DecisionPayload) => ({
    ...payload,
    model: config.model,
    provider: { ...(perplexity && { only: ["Perplexity"] }), allow_fallbacks: false },
  });
  return {
    id: perplexity ? "openrouter-perplexity" : "openrouter-microsoft",
    model: config.model,
    validateInput(payload) {
      assertDecisionBodyFits(requestBody(payload));
    },
    async classify(payload, signal) {
      const raw = await sendDecision(
        config.fetch ?? fetch,
        DECIDER_URL,
        config.apiKey,
        requestBody(payload),
        signal,
      );
      const parsed = routerResponseSchema.safeParse(raw);
      if (!parsed.success) throw malformedProvider();
      if (parsed.data.model !== reportedModelAliases[config.model])
        assertReportedModel(parsed.data, config.model);
      // Discard router IDs and provider extras rather than returning/logging them.
      return validatePayloadResponse(
        {
          ...(parsed.data.model !== undefined && { model: parsed.data.model }),
          ...(parsed.data.model_revision !== undefined && {
            model_revision: parsed.data.model_revision,
          }),
          answers: parsed.data.answers,
          ...(parsed.data.usage !== undefined && {
            usage: {
              input_tokens: parsed.data.usage.input_tokens,
              output_tokens: parsed.data.usage.output_tokens,
            },
          }),
        },
        payload,
      );
    },
  };
}

/** Preserve the original evaluation adapter's model and call signature. */
export function createDeciderProvider(config: {
  apiKey: string;
  fetch?: typeof fetch;
}): DecisionProvider {
  return createOpenRouterProvider({ ...config, model: DECIDER_MODEL });
}
