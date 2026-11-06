import { describe, expect, it, vi } from "vitest";
import { createFastinoProvider, FASTINO_GLIDE_MODEL } from "../eval/fastino-provider.js";
import type { DecisionPayload } from "../src/providers/types.js";
const payload: DecisionPayload = {
  model: "source",
  state: { claim: "SSO in all plans", evidence: "SSO only Enterprise" },
  questions: {
    pair: {
      type: "choice",
      instructions: { policy: "Preserve all fields", qualifier: { nested: true } },
      criteria: { contradiction: "Conflict", consistent: "Compatible" },
    },
  },
};
const response = () => ({
  model: "glide",
  answers: {
    pair: {
      type: "choice",
      choice: "contradiction",
      confidence: 0.8,
      probabilities: { contradiction: 0.9, consistent: 0.1 },
    },
  },
  usage: { input_tokens: 100, output_tokens: 0 },
  token_usage: 100,
});
describe("Fastino evaluation comparator", () => {
  it("uses native System One with retention disabled, complete instructions and reported identity", async () => {
    const send = vi.fn<typeof fetch>(async () => Response.json(response()));
    const provider = createFastinoProvider({ apiKey: "test-key", fetch: send });
    const result = await provider.classify(payload, new AbortController().signal);
    expect(provider.model).toBe(FASTINO_GLIDE_MODEL);
    expect(result).toMatchObject({
      model: "glide",
      usage: { input_tokens: 100 },
      answers: { pair: { probabilities: { contradiction: 0.9 } } },
    });
    const [url, init] = send.mock.calls[0]!;
    expect(url).toBe("https://api.fastino.ai/v1/systemone");
    expect(init?.redirect).toBe("manual");
    expect(JSON.parse(init?.body as string)).toMatchObject({
      model: "fastino/GLiDE",
      store: false,
      thinking: false,
      state: payload.state,
      questions: { pair: { instructions: JSON.stringify(payload.questions.pair!.instructions) } },
    });
  });
  it("preserves the current live engine alias without fabricating a checkpoint revision", async () => {
    const send = vi.fn<typeof fetch>(async () =>
      Response.json({ ...response(), model: "glide_v2" }),
    );
    const result = await createFastinoProvider({ apiKey: "test", fetch: send }).classify(
      payload,
      new AbortController().signal,
    );
    expect(result).toMatchObject({ model: "glide_v2" });
  });
  it.each([undefined, "other", "glide-9b", "fastino/GLiDE"])(
    "rejects unexpected reported engine %s",
    async (model) => {
      const send = vi.fn<typeof fetch>(async () => Response.json({ ...response(), model }));
      await expect(
        createFastinoProvider({ apiKey: "test", fetch: send }).classify(
          payload,
          new AbortController().signal,
        ),
      ).rejects.toMatchObject({ code: "provider_invalid_response" });
    },
  );
  it("rejects incomplete distributions and excessive converted input", async () => {
    const bad = response();
    delete (bad.answers.pair.probabilities as Record<string, number>).consistent;
    const send = vi.fn<typeof fetch>(async () => Response.json(bad));
    const provider = createFastinoProvider({ apiKey: "test", fetch: send });
    await expect(provider.classify(payload, new AbortController().signal)).rejects.toMatchObject({
      code: "provider_invalid_response",
    });
    expect(() =>
      provider.validateInput?.({ ...payload, state: { text: "x".repeat(16384) } }),
    ).toThrow();
  });
});
