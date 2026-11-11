import { z } from "zod";
import { createOpenRouterRouteProvider, type OpenRouterRoute } from "../src/providers/decider.js";
import type { DecisionProvider } from "../src/providers/types.js";

// Evaluation only. Measuring a candidate here does not add it to the API catalog.
export const openRouterCandidateSchema = z.enum(["google/gemini-decision-1"]);
export type OpenRouterCandidate = z.infer<typeof openRouterCandidateSchema>;
export const OPENROUTER_CANDIDATE_ROUTES: Record<OpenRouterCandidate, OpenRouterRoute> = {
  "google/gemini-decision-1": {
    model: "google/gemini-decision-1",
    reportedSnapshot: "google/gemini-decision-1-20261111",
    providerId: "openrouter-google",
    only: ["Google AI Studio"],
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
