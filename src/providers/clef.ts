import { CLEF_MODEL_ID } from "../contracts/models.js";
import { ServiceError } from "../contracts/errors.js";
import { assertReportedModel, validatePayloadResponse } from "./response.js";
import type { DecisionPayload, DecisionProvider } from "./types.js";
import { assertDecisionBodyFits, sendDecision } from "./transport.js";
import { z } from "zod";
import { malformedProvider } from "./response.js";

export interface ClefBinding {
  run(model: string, input: unknown): Promise<unknown>;
}
export const CLEF_MODEL = CLEF_MODEL_ID;
export const CLEF_BINDING_MODEL = "@cf/cloudflare/clef";
export type ClefModel = "clef" | "clef-flash" | "clef-omni";

/** The binding cannot cancel GPU work: HTTP owns its race and discards late answers. */
export function createClefProvider(
  binding: ClefBinding,
  model: ClefModel = CLEF_MODEL,
): DecisionProvider {
  const requestBody = (payload: DecisionPayload) => ({ ...payload, model });
  return {
    id: "cloudflare-workers-ai",
    model,
    validateInput(payload) {
      assertDecisionBodyFits(requestBody(payload));
    },
    async classify(payload, signal) {
      const body = requestBody(payload);
      assertDecisionBodyFits(body);
      if (signal.aborted)
        throw new ServiceError(504, "deadline_exceeded", "The check deadline was exceeded.", true);
      let result: unknown;
      try {
        result = await binding.run(`@cf/cloudflare/${model}`, body);
      } catch {
        if (signal.aborted)
          throw new ServiceError(
            504,
            "deadline_exceeded",
            "The check deadline was exceeded.",
            true,
          );
        throw new ServiceError(
          503,
          "provider_unavailable",
          "The inference provider is unavailable.",
          true,
        );
      }
      if (signal.aborted)
        throw new ServiceError(504, "deadline_exceeded", "The check deadline was exceeded.", true);
      const response = validatePayloadResponse(result, payload);
      assertReportedModel(response, model);
      return response;
    },
  };
}

const restEnvelopeSchema = z.strictObject({
  success: z.literal(true),
  result: z.unknown(),
  errors: z.array(z.unknown()).max(0),
  messages: z.array(z.unknown()),
});

/** Explicit evaluation route only; production uses the native binding above. */
export function createClefRestProvider(config: {
  accountId: string;
  apiToken: string;
  fetch?: typeof fetch;
}): DecisionProvider {
  if (!/^[a-fA-F0-9]{32}$/.test(config.accountId))
    throw new ServiceError(
      503,
      "provider_configuration",
      "The inference provider configuration is unavailable.",
    );
  return {
    id: "cloudflare-rest",
    model: CLEF_MODEL,
    async classify(payload, signal) {
      const raw = await sendDecision(
        config.fetch ?? fetch,
        `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/ai/run/${CLEF_BINDING_MODEL}`,
        config.apiToken,
        { ...payload, model: CLEF_MODEL },
        signal,
      );
      const envelope = restEnvelopeSchema.safeParse(raw);
      if (!envelope.success) throw malformedProvider();
      const response = validatePayloadResponse(envelope.data.result, payload);
      assertReportedModel(response, CLEF_MODEL);
      return response;
    },
  };
}
