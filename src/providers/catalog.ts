import { DEFAULT_MODEL, MODEL_ROUTES, SUPPORTED_MODELS, type Model } from "../contracts/models.js";
import { ServiceError } from "../contracts/errors.js";
import type { Env } from "../env.js";
import { createJevProvider } from "./jev.js";
import { createClefProvider, type ClefModel } from "./clef.js";
import { createOpenAIDecisionsProvider } from "./openai-decisions.js";
import { createOpenRouterProvider, type OpenRouterDecisionModel } from "./decider.js";
import type { DecisionProvider } from "./types.js";

export type ProviderEnv = Pick<
  Env,
  "TYPESAFE_API_KEY" | "OPENAI_API_KEY" | "OPENROUTER_API_KEY" | "AI"
>;

export function providerFor(env: ProviderEnv, model: Model = DEFAULT_MODEL): DecisionProvider {
  const route = MODEL_ROUTES[model];
  switch (route) {
    case "jev":
      if (env.TYPESAFE_API_KEY?.trim()) return createJevProvider({ apiKey: env.TYPESAFE_API_KEY });
      break;
    case "clef":
      if (env.AI) return createClefProvider(env.AI, model as ClefModel);
      break;
    case "openai-decisions":
      if (env.OPENAI_API_KEY?.trim())
        return createOpenAIDecisionsProvider({ apiKey: env.OPENAI_API_KEY });
      break;
    case "openrouter":
      if (env.OPENROUTER_API_KEY?.trim())
        return createOpenRouterProvider({
          apiKey: env.OPENROUTER_API_KEY,
          model: model as OpenRouterDecisionModel,
        });
      break;
  }
  throw new ServiceError(503, "provider_not_configured", "Inference is not configured.", false);
}

/** Configuration only: no inference, credential validation, or quality qualification. */
export function configuredModelCatalog(env: ProviderEnv) {
  return SUPPORTED_MODELS.map((entry) => {
    let configured = false;
    try {
      providerFor(env, entry.id);
      configured = true;
    } catch (error) {
      if (!(error instanceof ServiceError) || error.code !== "provider_not_configured") throw error;
    }
    return { ...entry, configured };
  });
}
