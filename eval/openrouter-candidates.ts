import { z } from "zod";
import { createOpenRouterRouteProvider, type OpenRouterRoute } from "../src/providers/decider.js";
import type { DecisionProvider } from "../src/providers/types.js";

// Evaluation only. Measuring a candidate here does not add it to the API catalog.
export const openRouterCandidateSchema = z.enum([
  "google/gemini-decision-1",
  "perplexity/pplx-decider-v1.3:free",
  "perplexity/pplx-decider-flash-v1.3:free",
  "liquid/d1.2",
  "liquid/d1.2-ultra",
]);
export type OpenRouterCandidate = z.infer<typeof openRouterCandidateSchema>;
export const OPENROUTER_CANDIDATE_ROUTES: Record<OpenRouterCandidate, OpenRouterRoute> = {
  "google/gemini-decision-1": {
    model: "google/gemini-decision-1",
    reportedSnapshot: "google/gemini-decision-1-20261111",
    providerId: "openrouter-google",
    only: ["Google AI Studio"],
  },
  // OpenRouter publishes v1.3 only as zero-priced :free variants of the same dated snapshot.
  "perplexity/pplx-decider-v1.3:free": {
    model: "perplexity/pplx-decider-v1.3:free",
    reportedSnapshot: "perplexity/pplx-decider-v1.3-20261112",
    providerId: "openrouter-perplexity",
    only: ["Perplexity"],
  },
  "perplexity/pplx-decider-flash-v1.3:free": {
    model: "perplexity/pplx-decider-flash-v1.3:free",
    reportedSnapshot: "perplexity/pplx-decider-flash-v1.3-20261112",
    providerId: "openrouter-perplexity",
    only: ["Perplexity"],
  },
  "liquid/d1.2": {
    model: "liquid/d1.2",
    reportedSnapshot: "liquid/d1.2-20261116",
    providerId: "openrouter-liquid",
    only: ["Liquid"],
  },
  "liquid/d1.2-ultra": {
    model: "liquid/d1.2-ultra",
    reportedSnapshot: "liquid/d1.2-ultra-20261116",
    providerId: "openrouter-liquid",
    only: ["Liquid"],
  },
};

export function createOpenRouterCandidateProvider(config: {
  apiKey: string;
  model: OpenRouterCandidate;
  fetch?: typeof fetch;
}): DecisionProvider {
  const model = openRouterCandidateSchema.parse(config.model);
  return createOpenRouterRouteProvider({ ...config, route: OPENROUTER_CANDIDATE_ROUTES[model] });
}
