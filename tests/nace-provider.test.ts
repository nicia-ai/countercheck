import { describe, expect, it, vi } from "vitest";
import { createNaceProvider, naceModelSchema } from "../eval/nace-provider.js";
import { evaluationProvider } from "../eval/providers.js";
import type { DecisionPayload } from "../src/providers/types.js";

const payload: DecisionPayload = {
  model: "source-model",
  state: { claim: "SSO in all plans", evidence: "SSO only Enterprise" },
  questions: {
    pair: {
      type: "choice",
      instructions: { policy: "Retain structured instructions", nested: { qualifier: true } },
      criteria: { contradiction: "Conflict", consistent: "Compatible" },
    },
  },
};
const result = (model: string) => ({
  model,
  answers: {
    pair: {
      type: "choice",
      choice: "contradiction",
      probabilities: { contradiction: 0.9, consistent: 0.1 },
    },
  },
  usage: { input_tokens: 100, output_tokens: 40 },
  evaluation_time_ms: 12.5,
  request_id: "synthetic-request",
});
describe("Nace evaluation adapter", () => {
  it.each(naceModelSchema.options)("preserves the payload and pins %s", async (model) => {
    const send = vi.fn<typeof fetch>(async () => Response.json(result(model)));
    const provider = createNaceProvider({ apiKey: "test-key", model, fetch: send });
    expect(await provider.classify(payload, new AbortController().signal)).toEqual({
      model,
      answers: result(model).answers,
      usage: result(model).usage,
    });
    const [url, init] = send.mock.calls[0]!;
    expect(url).toBe("https://console.nace.ai/v1/systemone");
    expect(init?.redirect).toBe("manual");
    expect(JSON.parse(init?.body as string)).toEqual({ ...payload, model });
  });
  it.each(["drex-latest", "drex-v1.0", "drex-v2.0", "unexpected", undefined])(
    "rejects missing, forwarded or mismatched identity %s",
    async (model) => {
      const send = vi.fn<typeof fetch>(async () => Response.json(result(model as string)));
      await expect(
        createNaceProvider({ apiKey: "test", model: "drex-max", fetch: send }).classify(
          payload,
          new AbortController().signal,
        ),
      ).rejects.toMatchObject({ code: "provider_invalid_response" });
    },
  );
  it("rejects incomplete distributions, excess answers and oversized input", async () => {
    for (const bad of [
      {
        ...result("drex-max"),
        answers: { pair: { type: "choice", probabilities: { contradiction: 1 } } },
      },
      {
        ...result("drex-max"),
        answers: { ...result("drex-max").answers, extra: result("drex-max").answers.pair },
      },
    ]) {
      const provider = createNaceProvider({
        apiKey: "test",
        model: "drex-max",
        fetch: async () => Response.json(bad),
      });
      await expect(provider.classify(payload, new AbortController().signal)).rejects.toMatchObject({
        code: "provider_invalid_response",
      });
    }
    const provider = createNaceProvider({ apiKey: "test", model: "drex-max" });
    expect(() =>
      provider.validateInput?.({ ...payload, state: { text: "x".repeat(16384) } }),
    ).toThrow();
  });
  it("requires a credential and an explicit active model", async () => {
    await expect(evaluationProvider("nace", {}, "drex-max")).rejects.toThrow(
      "Missing NACE_API_KEY",
    );
    await expect(evaluationProvider("nace", { NACE_API_KEY: "test" })).rejects.toThrow();
    expect((await evaluationProvider("nace", { NACE_API_KEY: "test" }, "drex-max"))?.model).toBe(
      "drex-max",
    );
  });
  it("keeps HTTP error bodies private and never retries", async () => {
    const send = vi.fn<typeof fetch>(
      async () => new Response("secret upstream body", { status: 402 }),
    );
    await expect(
      createNaceProvider({ apiKey: "test", model: "drex-max", fetch: send }).classify(
        payload,
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: "provider_invalid_response" });
    expect(send).toHaveBeenCalledTimes(1);
  });
});
