import type { DecisionProvider } from "./types.js";
import { assertReportedModel, validatePayloadResponse } from "./response.js";
import { sendDecision } from "./transport.js";
import { JEV_MODEL_ID } from "../contracts/models.js";

export const JEV_MODEL = JEV_MODEL_ID;
export const JEV_URL = "https://api.typesafe.ai/v1/systemone";

/**
 * Direct TypeSafe HTTPS. No retries, danger-zone headers, or alternate routes.
 * Only the documented canonical model name is accepted when reported. Missing identity is
 * accepted as unknown (reported_model stays null), never inferred from the pin.
 * model_revision is opaque provenance, not a substitute model identifier.
 */
export function createJevProvider(config: {
  apiKey: string;
  fetch?: typeof fetch;
}): DecisionProvider {
  const send = config.fetch ?? fetch;
  return {
    id: "typesafe",
    model: JEV_MODEL,
    async classify(payload, signal) {
      const result = await sendDecision(
        send,
        JEV_URL,
        config.apiKey,
        { ...payload, model: JEV_MODEL },
        signal,
      );
      const response = validatePayloadResponse(result, payload);
      assertReportedModel(response, JEV_MODEL);
      return response;
    },
  };
}
