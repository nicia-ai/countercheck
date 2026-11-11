import { describe, expect, it, vi } from "vitest";
import {
  OPENROUTER_CANDIDATE_ROUTES,
  createOpenRouterCandidateProvider,
  openRouterCandidateSchema,
} from "../eval/openrouter-candidates.js";
import { evaluationProvider } from "../eval/providers.js";
import { MODEL_IDS } from "../src/contracts/models.js";
import type { DecisionPayload } from "../src/providers/types.js";

const payload = (): DecisionPayload => ({
  model: "caller-model-is-replaced",
  state: { claim: "Standard costs $49.", evidence: "Standard costs $79." },
  questions: {
    pair: {
      type: "choice",
      instructions: "Do they conflict?",
      criteria: { yes: "Conflict", no: "Compatible" },
    },
  },
});
const output = (model: string) => ({
  model,
  answers: { pair: { type: "choice", choice: "yes", probabilities: { yes: 0.9, no: 0.1 } } },
  usage: { input_tokens: 32, output_tokens: 2 },
});
const signal = () => new AbortController().signal;
const candidates = openRouterCandidateSchema.options;

describe("evaluation-only OpenRouter candidates", () => {
  it.each(candidates)("keeps %s out of the API catalog", (model) => {
    expect(MODEL_IDS as readonly string[]).not.toContain(model);
  });

  it.each(candidates)(
    "pins %s to its reviewed endpoint and snapshot with fallback disabled",
    async (model) => {
      const route = OPENROUTER_CANDIDATE_ROUTES[model];
      const send = vi.fn<typeof fetch>(async () => Response.json(output(route.reportedSnapshot)));
      const provider = createOpenRouterCandidateProvider({
        apiKey: "synthetic",
        model,
        fetch: send,
      });
      expect(provider).toMatchObject({ id: route.providerId, model });
      await expect(provider.classify(payload(), signal())).resolves.toEqual(
        output(route.reportedSnapshot),
      );
      const [url, init] = send.mock.calls[0]!;
      expect(url).toBe("https://openrouter.ai/api/alpha/decisions");
      expect(JSON.parse(init!.body as string)).toEqual({
        ...payload(),
        model,
        provider: { only: route.only, allow_fallbacks: false },
      });
      for (const identity of [
        route.reportedSnapshot.replace(/\d{8}$/, "20270101"),
        `${model}-latest`,
        "perplexity/pplx-decider-v1.2",
      ]) {
        send.mockResolvedValueOnce(Response.json(output(identity)));
        await expect(provider.classify(payload(), signal())).rejects.toMatchObject({
          code: "provider_model_mismatch",
        });
      }
    },
  );

  it("is selected only by its explicit backend, model and credential", async () => {
    const model = "google/gemini-decision-1";
    const provider = await evaluationProvider(
      "openrouter-candidate",
      { OPENROUTER_API_KEY: "synthetic" },
      model,
    );
    expect(provider).toMatchObject({ id: "openrouter-google", model });
    await expect(evaluationProvider("openrouter-candidate", {}, model)).rejects.toThrow(
      "OPENROUTER_API_KEY",
    );
    await expect(
      evaluationProvider("openrouter-candidate", { OPENROUTER_API_KEY: "synthetic" }),
    ).rejects.toThrow();
    await expect(
      evaluationProvider("hosted", { OPENROUTER_API_KEY: "synthetic" }, model),
    ).rejects.toThrow();
  });
});
