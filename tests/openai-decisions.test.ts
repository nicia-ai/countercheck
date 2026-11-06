import { describe, expect, it, vi } from "vitest";
import { checkRequestSchema } from "../src/contracts/index.js";
import { LIMITS } from "../src/contracts/limits.js";
import { compileCheck } from "../src/kernel/index.js";
import {
  createOpenAIDecisionsProvider,
  OPENAI_DECISIONS_MODEL,
  OPENAI_DECISIONS_URL,
} from "../src/providers/openai-decisions.js";
import type { DecisionPayload } from "../src/providers/types.js";

const signal = () => new AbortController().signal;
const payload = (): DecisionPayload =>
  compileCheck(
    checkRequestSchema.parse({
      claim: { id: "c", text: "Standard costs $49." },
      against: [{ id: "a", text: "Standard costs $79." }],
    }),
    OPENAI_DECISIONS_MODEL,
  ).payload;
const nativeAnswer = (name = "q_000") => ({
  type: "choice",
  name,
  choice: "contradiction",
  confidence: 0.93,
  probabilities: [
    { value: "contradiction", probability: 0.97 },
    { value: "consistent", probability: 0.01 },
    { value: "different_scope", probability: 0.01 },
    { value: "insufficient_context", probability: 0.01 },
  ],
});
const output = () => ({
  model: OPENAI_DECISIONS_MODEL,
  answers: [nativeAnswer()],
  usage: {
    input_tokens: 100,
    output_tokens: 0,
    input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
    output_tokens_details: { reasoning_tokens: 0 },
    total_tokens: 100,
  },
});
const fakeFetch = (value: unknown) => vi.fn<typeof fetch>(async () => Response.json(value));
const provider = (value: unknown) =>
  createOpenAIDecisionsProvider({ apiKey: "synthetic-key", fetch: fakeFetch(value) });

describe("OpenAI Decisions adapter", () => {
  it("pins Luna and faithfully converts default instructions/state/criteria in one bounded HTTP request", async () => {
    const input = payload();
    const before = structuredClone(input);
    const send = fakeFetch(output());
    const selected = createOpenAIDecisionsProvider({ apiKey: "synthetic-key", fetch: send });
    expect(selected.id).toBe("openai-decisions");
    expect(selected.model).toBe(OPENAI_DECISIONS_MODEL);
    const active = signal();
    const response = await selected.classify({ ...input, model: "untrusted-model" }, active);
    expect(input).toEqual(before);
    expect(response).toEqual({
      model: OPENAI_DECISIONS_MODEL,
      answers: {
        q_000: {
          type: "choice",
          choice: "contradiction",
          confidence: 0.93,
          probabilities: Object.fromEntries(
            nativeAnswer().probabilities.map((p) => [p.value, p.probability]),
          ),
        },
      },
      usage: { input_tokens: 100, output_tokens: 0 },
    });
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0]![0]).toBe(OPENAI_DECISIONS_URL);
    const init = send.mock.calls[0]![1]!;
    expect(init.redirect).toBe("manual");
    expect(init.signal).toBe(active);
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer synthetic-key");
    const wire = JSON.parse(init.body as string);
    expect(wire).toEqual({
      model: OPENAI_DECISIONS_MODEL,
      input: JSON.stringify(input.state),
      questions: [
        {
          name: "q_000",
          type: "choice",
          instructions: input.questions.q_000!.instructions,
          choices: Object.entries(input.questions.q_000!.criteria).map(([value, description]) => ({
            value,
            description,
          })),
        },
      ],
    });
  });

  it("preserves every structured instruction/criterion field and arbitrary dynamic labels", async () => {
    const input: DecisionPayload = {
      model: "ignored",
      state: { text: "Text is data", nested: [null, true, { amount: 42 }] },
      questions: {
        dynamic: {
          type: "choice",
          instructions: {
            task: "Keep every field",
            constraints: ["pair-only", { priority: 1 }],
            extra: null,
          },
          criteria: {
            candidate_0: {
              what: "same unit",
              not_for: "another unit",
              examples: ["a", "b"],
              additional: { keep: true },
            },
            candidate_1: ["different", { values: [1, null] }],
            unknown: null,
          },
        },
      },
    };
    const send = fakeFetch({
      answers: [
        {
          name: "dynamic",
          type: "choice",
          choice: "candidate_1",
          confidence: 0.7,
          probabilities: [
            { value: "candidate_0", probability: 0.1 },
            { value: "candidate_1", probability: 0.8 },
            { value: "unknown", probability: 0.1 },
          ],
        },
      ],
    });
    const result = await createOpenAIDecisionsProvider({
      apiKey: "synthetic",
      fetch: send,
    }).classify(input, signal());
    expect(result).toMatchObject({
      answers: {
        dynamic: {
          choice: "candidate_1",
          confidence: 0.7,
          probabilities: { candidate_0: 0.1, candidate_1: 0.8, unknown: 0.1 },
        },
      },
    });
    const wire = JSON.parse(send.mock.calls[0]![1]!.body as string);
    expect(JSON.parse(wire.input)).toEqual(input.state);
    expect(wire.questions[0].instructions).toBe(
      JSON.stringify(input.questions.dynamic!.instructions),
    );
    expect(wire.questions[0].choices).toEqual(
      Object.entries(input.questions.dynamic!.criteria).map(([value, criterion]) => ({
        value,
        description: JSON.stringify(criterion),
      })),
    );
  });

  it("maps questions by exact names even when the answer array is reordered", async () => {
    const input = payload();
    input.questions.q_001 = input.questions.q_000!;
    const result = await provider({
      answers: [nativeAnswer("q_001"), nativeAnswer("q_000")],
    }).classify(input, signal());
    expect(result).toHaveProperty("answers.q_000.choice", "contradiction");
    expect(result).toHaveProperty("answers.q_001.choice", "contradiction");
  });

  it.each([
    ["missing answer", []],
    ["extra answer", [nativeAnswer(), nativeAnswer("extra")]],
    ["unknown question", [nativeAnswer("extra")]],
    ["unnamed answer", [{ ...nativeAnswer(), name: null }]],
    ["refusal", [{ type: "refusal", name: "q_000" }]],
    ["wrong type", [{ ...nativeAnswer(), type: "score" }]],
    ["missing probabilities", [{ ...nativeAnswer(), probabilities: undefined }]],
    ["missing choice", [{ ...nativeAnswer(), choice: undefined }]],
    ["unknown choice", [{ ...nativeAnswer(), choice: "extra" }]],
    ["nonmaximal choice", [{ ...nativeAnswer(), choice: "consistent" }]],
    ["boolean choice", [{ ...nativeAnswer(), choice: true }]],
    ["missing confidence", [{ ...nativeAnswer(), confidence: undefined }]],
    ["bad confidence", [{ ...nativeAnswer(), confidence: 1.01 }]],
    ["null confidence", [{ ...nativeAnswer(), confidence: null }]],
    ["refusal extra", [{ ...nativeAnswer(), refusal: "private refusal" }]],
    [
      "missing label",
      [{ ...nativeAnswer(), probabilities: nativeAnswer().probabilities.slice(1) }],
    ],
    [
      "duplicate label",
      [
        {
          ...nativeAnswer(),
          probabilities: nativeAnswer().probabilities.map((p) => ({
            ...p,
            value: "contradiction",
          })),
        },
      ],
    ],
    [
      "unexpected label",
      [
        {
          ...nativeAnswer(),
          probabilities: nativeAnswer().probabilities.map((p, i) => ({
            ...p,
            value: i === 0 ? "extra" : p.value,
          })),
        },
      ],
    ],
    [
      "typed label mismatch",
      [
        {
          ...nativeAnswer(),
          probabilities: nativeAnswer().probabilities.map((p, i) => ({
            ...p,
            value: i === 0 ? true : p.value,
          })),
        },
      ],
    ],
    [
      "negative probability",
      [
        {
          ...nativeAnswer(),
          probabilities: nativeAnswer().probabilities.map((p) => ({ ...p, probability: -0.1 })),
        },
      ],
    ],
    [
      "over-one probability",
      [
        {
          ...nativeAnswer(),
          probabilities: nativeAnswer().probabilities.map((p) => ({ ...p, probability: 1.1 })),
        },
      ],
    ],
    [
      "nonfinite probability",
      [
        {
          ...nativeAnswer(),
          probabilities: nativeAnswer().probabilities.map((p) => ({ ...p, probability: Infinity })),
        },
      ],
    ],
    [
      "string probability",
      [
        {
          ...nativeAnswer(),
          probabilities: nativeAnswer().probabilities.map((p) => ({ ...p, probability: "0.25" })),
        },
      ],
    ],
    [
      "unnormalized probabilities",
      [
        {
          ...nativeAnswer(),
          probabilities: nativeAnswer().probabilities.map((p) => ({ ...p, probability: 0.2 })),
        },
      ],
    ],
  ])("rejects %s without returning partial or fabricated results", async (_name, answers) => {
    await expect(provider({ answers }).classify(payload(), signal())).rejects.toMatchObject({
      status: 502,
      code: "provider_invalid_response",
    });
  });

  it("rejects duplicate question names even when the expected count matches", async () => {
    const input = payload();
    input.questions.q_001 = input.questions.q_000!;
    await expect(
      provider({ answers: [nativeAnswer(), nativeAnswer()] }).classify(input, signal()),
    ).rejects.toMatchObject({ status: 502 });
  });

  it.each(["gpt-6-luna-preview", "gpt-6-luna-2026-11-05", "other-model"])(
    "rejects a reported model mismatch %s",
    async (model) => {
      const result = provider({ ...output(), model }).classify(payload(), signal());
      await expect(result).rejects.toMatchObject({ status: 502, code: "provider_model_mismatch" });
      await expect(result).rejects.not.toHaveProperty("message", expect.stringContaining(model));
    },
  );

  it.each([
    [{ answers: [nativeAnswer()] }, undefined],
    [{ answers: [nativeAnswer()], usage: null }, undefined],
    [{ answers: [nativeAnswer()], usage: {} }, {}],
    [{ answers: [nativeAnswer()], usage: { input_tokens: null, output_tokens: null } }, {}],
    [
      { answers: [nativeAnswer()], usage: { input_tokens: 0, output_tokens: null } },
      { input_tokens: 0 },
    ],
  ])(
    "preserves missing identity and unknown usage instead of inventing zero",
    async (raw, usage) => {
      const result = await provider(raw).classify(payload(), signal());
      expect(result).not.toHaveProperty("model");
      if (usage === undefined) expect(result).not.toHaveProperty("usage");
      else expect(result).toHaveProperty("usage", usage);
    },
  );

  it.each([-1, 0.5, "42"])("rejects invalid token usage %s", async (input_tokens) => {
    await expect(
      provider({ answers: [nativeAnswer()], usage: { input_tokens } }).classify(
        payload(),
        signal(),
      ),
    ).rejects.toMatchObject({ status: 502 });
  });

  it("rejects nonfinite JSON numeric usage instead of treating it as null", async () => {
    const send = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({ answers: [nativeAnswer()] }).slice(0, -1) +
            ',"usage":{"input_tokens":1e309}}',
          { headers: { "content-type": "application/json" } },
        ),
    );
    await expect(
      createOpenAIDecisionsProvider({ apiKey: "synthetic", fetch: send }).classify(
        payload(),
        signal(),
      ),
    ).rejects.toMatchObject({ status: 502 });
  });

  it("preflights the exact converted envelope at 16 KiB and refuses one extra byte before dispatch", async () => {
    const input = payload();
    input.state.reserve = "";
    const send = fakeFetch(output());
    const selected = createOpenAIDecisionsProvider({ apiKey: "synthetic", fetch: send });
    await selected.classify(input, signal());
    const baseline = new TextEncoder().encode(send.mock.calls[0]![1]!.body as string).byteLength;
    input.state.reserve = "x".repeat(LIMITS.compiledBytes - baseline);
    expect(() => selected.validateInput!(input)).not.toThrow();
    send.mockClear();
    await selected.classify(input, signal());
    expect(new TextEncoder().encode(send.mock.calls[0]![1]!.body as string).byteLength).toBe(
      LIMITS.compiledBytes,
    );
    input.state.reserve += "x";
    send.mockClear();
    expect(() => selected.validateInput!(input)).toThrow(
      expect.objectContaining({ status: 422, code: "compiled_input_too_large" }),
    );
    await expect(selected.classify(input, signal())).rejects.toMatchObject({ status: 422 });
    expect(send).not.toHaveBeenCalled();
  });

  it("measures JSON escaping and UTF-8 in preflight, beyond the original Countercheck payload size", () => {
    const input = payload();
    input.state.reserve = '\\"😀'.repeat(1700);
    expect(new TextEncoder().encode(JSON.stringify(input)).byteLength).toBeLessThan(
      LIMITS.compiledBytes,
    );
    expect(() => provider(output()).validateInput!(input)).toThrow(
      expect.objectContaining({ status: 422, code: "compiled_input_too_large" }),
    );
  });

  it.each([302, 401, 403, 408, 429, 500, 504])(
    "does not follow or retry HTTP %s and does not expose private error bodies",
    async (status) => {
      const cancel = vi.fn();
      const send = vi.fn<typeof fetch>(
        async () =>
          new Response(new ReadableStream({ cancel }), {
            status,
            headers: { location: "https://private.example/", "retry-after": "7" },
          }),
      );
      const result = createOpenAIDecisionsProvider({ apiKey: "synthetic", fetch: send }).classify(
        payload(),
        signal(),
      );
      await expect(result).rejects.toMatchObject({
        status: status === 302 ? 502 : [408, 504].includes(status) ? 504 : 503,
      });
      await expect(result).rejects.not.toHaveProperty(
        "message",
        expect.stringContaining("private"),
      );
      expect(send).toHaveBeenCalledOnce();
      expect(send.mock.calls[0]![1]!.redirect).toBe("manual");
      expect(cancel).toHaveBeenCalledOnce();
    },
  );

  it("sanitizes network errors without retrying and honors already-expired deadlines", async () => {
    const send = vi.fn<typeof fetch>(async () => {
      throw new Error("private-input-and-key");
    });
    await expect(
      createOpenAIDecisionsProvider({ apiKey: "synthetic", fetch: send }).classify(
        payload(),
        signal(),
      ),
    ).rejects.toMatchObject({ status: 503, message: "The inference provider is unavailable." });
    expect(send).toHaveBeenCalledOnce();
    const controller = new AbortController();
    controller.abort();
    send.mockClear();
    await expect(
      createOpenAIDecisionsProvider({ apiKey: "synthetic", fetch: send }).classify(
        payload(),
        controller.signal,
      ),
    ).rejects.toMatchObject({ status: 504, code: "deadline_exceeded" });
    expect(send).not.toHaveBeenCalled();
  });

  it("cancels response-body reads at the deadline and rejects malformed JSON/content types", async () => {
    const controller = new AbortController();
    const cancel = vi.fn();
    const send = vi.fn<typeof fetch>(
      async () =>
        new Response(new ReadableStream({ cancel }), {
          headers: { "content-type": "application/json" },
        }),
    );
    const pending = createOpenAIDecisionsProvider({ apiKey: "synthetic", fetch: send }).classify(
      payload(),
      controller.signal,
    );
    await Promise.resolve();
    controller.abort();
    await expect(pending).rejects.toMatchObject({ status: 504 });
    expect(cancel).toHaveBeenCalledOnce();
    for (const [body, contentType] of [
      ["{", "application/json"],
      ["{}", "text/html"],
    ]) {
      const malformed = vi.fn<typeof fetch>(
        async () => new Response(body, { headers: { "content-type": contentType! } }),
      );
      await expect(
        createOpenAIDecisionsProvider({ apiKey: "synthetic", fetch: malformed }).classify(
          payload(),
          signal(),
        ),
      ).rejects.toMatchObject({ status: 502 });
    }
  });
});
