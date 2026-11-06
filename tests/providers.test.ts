import { describe, expect, it, vi } from "vitest";
import { checkRequestSchema } from "../src/contracts/index.js";
import { compileCheck } from "../src/kernel/index.js";
import { createJevProvider, JEV_MODEL, JEV_URL } from "../src/providers/jev.js";
import {
  createClefProvider,
  createClefRestProvider,
  CLEF_BINDING_MODEL,
} from "../src/providers/clef.js";
import { createDeciderProvider, DECIDER_MODEL, DECIDER_URL } from "../src/providers/decider.js";
import {
  MAX_PROVIDER_RESPONSE_BYTES,
  parseProviderJson,
  readProviderJson,
} from "../src/providers/transport.js";

const payload = () =>
  compileCheck(
    checkRequestSchema.parse({
      claim: { id: "c", text: "Standard costs $49." },
      against: [{ id: "a", text: "Standard costs $79." }],
    }),
    JEV_MODEL,
  ).payload;
const output = () => ({
  model: JEV_MODEL,
  answers: {
    q_000: {
      type: "choice",
      choice: "contradiction",
      confidence: 0.9,
      probabilities: {
        contradiction: 0.97,
        consistent: 0.01,
        different_scope: 0.01,
        insufficient_context: 0.01,
      },
    },
  },
  usage: { input_tokens: 100, output_tokens: 20 },
});
const signal = () => new AbortController().signal;
const fakeFetch = (response: () => Response) => vi.fn<typeof fetch>(async () => response());

describe("Jev transport", () => {
  it.each([
    "jev-1.13.0",
    "jev-1.14.1",
    "jev-latest",
    "typesafe/jev-1.14.0",
    "jev-1.14.0-20261103",
    "JEV-1.14.0",
  ])("rejects explicit unqualified reported model %s without revealing it", async (model) => {
    const send = fakeFetch(() => Response.json({ ...output(), model, model_revision: JEV_MODEL }));
    await expect(
      createJevProvider({ apiKey: "synthetic-key", fetch: send }).classify(payload(), signal()),
    ).rejects.toMatchObject({
      status: 502,
      code: "provider_model_mismatch",
      retryable: false,
      message: "The inference provider reported an unexpected model.",
    });
    expect(send).toHaveBeenCalledOnce();
  });
  it("preserves a matching canonical identity and opaque revision without inventing metadata", async () => {
    const withRevision = { ...output(), model_revision: "opaque-provider-revision" };
    await expect(
      createJevProvider({
        apiKey: "synthetic-key",
        fetch: fakeFetch(() => Response.json(withRevision)),
      }).classify(payload(), signal()),
    ).resolves.toEqual(withRevision);
    const withoutModel = {
      answers: output().answers,
      usage: output().usage,
      model_revision: "opaque-provider-revision",
    };
    const unknown = await createJevProvider({
      apiKey: "synthetic-key",
      fetch: fakeFetch(() => Response.json(withoutModel)),
    }).classify(payload(), signal());
    expect(unknown).toEqual(withoutModel);
    expect(unknown).not.toHaveProperty("model");
    const withoutMetadata = { answers: output().answers, usage: output().usage };
    await expect(
      createJevProvider({
        apiKey: "synthetic-key",
        fetch: fakeFetch(() => Response.json(withoutMetadata)),
      }).classify(payload(), signal()),
    ).resolves.toEqual(withoutMetadata);
  });
  it("pins Jev 1.14, sends once with signal and refuses redirects/danger zones", async () => {
    const send = fakeFetch(() => Response.json(output()));
    const active = signal();
    const provider = createJevProvider({ apiKey: "synthetic-key", fetch: send });
    const result = await provider.classify(
      { ...payload(), model: "untrusted-other-model" },
      active,
    );
    expect(result).toEqual(output());
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![0]).toBe(JEV_URL);
    const init = send.mock.calls[0]![1]!;
    expect(init.signal).toBe(active);
    expect(init.redirect).toBe("manual");
    expect(JSON.parse(init.body as string)).toMatchObject({ model: JEV_MODEL });
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer synthetic-key");
    expect([...new Headers(init.headers).keys()].some((key) => key.includes("danger"))).toBe(false);
  });
  it.each([401, 402, 403, 429, 500, 502, 503])(
    "upstream %i never leaks the response body or misreports a clean result",
    async (status) => {
      const cancel = vi.fn();
      const body = new ReadableStream<Uint8Array>({ cancel });
      const response = new Response(body, { status, headers: { "retry-after": "7" } });
      const send = fakeFetch(() => response);
      const result = createJevProvider({ apiKey: "fake", fetch: send }).classify(
        payload(),
        signal(),
      );
      await expect(result).rejects.toMatchObject({ status: status === 402 ? 502 : 503 });
      await expect(result).rejects.not.toHaveProperty(
        "message",
        expect.stringContaining("private-upstream-text"),
      );
      expect(send).toHaveBeenCalledTimes(1);
      // No adapter .text()/.json() is called, even for an arbitrarily slow error body.
      expect(response.bodyUsed).toBe(true);
      expect(cancel).toHaveBeenCalledOnce();
    },
  );
  it("maps overload Retry-After to a bounded integer and maps provider timeout", async () => {
    const overloaded = createJevProvider({
      apiKey: "fake",
      fetch: fakeFetch(
        () => new Response("private", { status: 429, headers: { "retry-after": "99999" } }),
      ),
    });
    await expect(overloaded.classify(payload(), signal())).rejects.toMatchObject({
      status: 503,
      retryAfter: 3600,
    });
    const timeout = createJevProvider({
      apiKey: "fake",
      fetch: fakeFetch(() => new Response("private", { status: 504 })),
    });
    await expect(timeout.classify(payload(), signal())).rejects.toMatchObject({
      status: 504,
      code: "provider_timeout",
    });
  });
  it.each([401, 403])(
    "reports upstream %i as an operator access failure, without asking callers to retry",
    async (status) => {
      const cancel = vi.fn();
      const send = fakeFetch(
        () =>
          new Response(new ReadableStream<Uint8Array>({ cancel }), {
            status,
            headers: { "retry-after": "7" },
          }),
      );
      const result = createJevProvider({ apiKey: "synthetic-key", fetch: send }).classify(
        payload(),
        signal(),
      );
      await expect(result).rejects.toMatchObject({
        status: 503,
        code: "provider_auth_failed",
        message: "Inference provider access is unavailable.",
        retryable: false,
        retryAfter: undefined,
      });
      expect(send).toHaveBeenCalledOnce();
      expect(cancel).toHaveBeenCalledOnce();
    },
  );
  it("does not retry network errors or reveal exception text", async () => {
    const send = vi.fn<typeof fetch>(async () => {
      throw new Error("key-or-input");
    });
    await expect(
      createJevProvider({ apiKey: "fake", fetch: send }).classify(payload(), signal()),
    ).rejects.toMatchObject({ status: 503, message: "The inference provider is unavailable." });
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("rejects malformed/refused/missing answer bodies", async () => {
    for (const raw of [
      "{",
      JSON.stringify({ ...output(), refusal: "no" }),
      JSON.stringify({ ...output(), answers: {} }),
    ]) {
      const send = fakeFetch(
        () => new Response(raw, { headers: { "content-type": "application/json" } }),
      );
      await expect(
        createJevProvider({ apiKey: "fake", fetch: send }).classify(payload(), signal()),
      ).rejects.toMatchObject({ status: 502 });
    }
  });
  it("never dispatches an already aborted request", async () => {
    const controller = new AbortController();
    controller.abort();
    const send = fakeFetch(() => Response.json(output()));
    await expect(
      createJevProvider({ apiKey: "fake", fetch: send }).classify(payload(), controller.signal),
    ).rejects.toMatchObject({ status: 504 });
    expect(send).not.toHaveBeenCalled();
  });
});

describe("bounded response decoding", () => {
  it("accepts the exact decoded byte bound and counts streaming bytes regardless of headers", async () => {
    const json = JSON.stringify({ a: "x".repeat(MAX_PROVIDER_RESPONSE_BYTES - 8) });
    expect(new TextEncoder().encode(json).length).toBe(MAX_PROVIDER_RESPONSE_BYTES);
    expect(
      await readProviderJson(
        new Response(json, { headers: { "content-type": "application/json" } }),
        signal(),
      ),
    ).toEqual(JSON.parse(json));
    let canceled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(MAX_PROVIDER_RESPONSE_BYTES));
        controller.enqueue(new Uint8Array(1));
      },
      cancel() {
        canceled = true;
      },
    });
    await expect(
      readProviderJson(
        new Response(stream, {
          headers: { "content-type": "application/json", "content-length": "1" },
        }),
        signal(),
      ),
    ).rejects.toMatchObject({ status: 502 });
    expect(canceled).toBe(true);
  });
  it("rejects declared oversize before pulling the body and rejects wrong types and malformed UTF-8", async () => {
    await expect(
      readProviderJson(
        new Response("{}", {
          headers: {
            "content-type": "application/json",
            "content-length": `${MAX_PROVIDER_RESPONSE_BYTES + 1}`,
          },
        }),
        signal(),
      ),
    ).rejects.toMatchObject({ status: 502 });
    await expect(
      readProviderJson(new Response("{}", { headers: { "content-type": "text/plain" } }), signal()),
    ).rejects.toMatchObject({ status: 502 });
    await expect(
      readProviderJson(
        new Response(new Uint8Array([0xff]), { headers: { "content-type": "application/json" } }),
        signal(),
      ),
    ).rejects.toMatchObject({ status: 502 });
  });
  it.each([
    '{"answers":{"q_000":1,"q_000":2}}',
    '{"answers":{"q_000":1,"q_00\\u0030":2}}',
    '{"probabilities":{"contradiction":1,"contradiction":0}}',
    '{"a":[{"x":1,"x":2}]}',
  ])("rejects duplicate JSON object keys %j", (text) => {
    expect(() => parseProviderJson(text)).toThrow(expect.objectContaining({ status: 502 }));
  });
  it("allows repeated names in separate objects and escaped punctuation in strings", () => {
    const value = { a: [{ x: 'escaped " punctuation : , } \\ 😀' }, { x: "fine" }], b: [] };
    expect(parseProviderJson(JSON.stringify(value))).toEqual(value);
  });
  it("bounds nesting and discards an answer when aborted during a body read", async () => {
    expect(() => parseProviderJson("[".repeat(34) + "0" + "]".repeat(34))).toThrow(
      expect.objectContaining({ status: 502 }),
    );
    let canceled = false;
    const active = new AbortController();
    const stream = new ReadableStream<Uint8Array>({
      cancel() {
        canceled = true;
      },
    });
    const pending = readProviderJson(
      new Response(stream, { headers: { "content-type": "application/json" } }),
      active.signal,
    );
    active.abort();
    await expect(pending).rejects.toMatchObject({ status: 504 });
    expect(canceled).toBe(true);
  });
});

describe("explicit challenger adapters", () => {
  it.each(["clef-flash", "jev-1.14.0"])(
    "rejects an unexpected Clef identity %s without fallback",
    async (model) => {
      const raw = { ...output(), model };
      const run = vi.fn(async () => raw);
      await expect(createClefProvider({ run }).classify(payload(), signal())).rejects.toMatchObject(
        { status: 502, code: "provider_model_mismatch" },
      );
      expect(run).toHaveBeenCalledOnce();
      const send = fakeFetch(() =>
        Response.json({ success: true, result: raw, errors: [], messages: [] }),
      );
      await expect(
        createClefRestProvider({
          accountId: "a".repeat(32),
          apiToken: "synthetic",
          fetch: send,
        }).classify(payload(), signal()),
      ).rejects.toMatchObject({ status: 502, code: "provider_model_mismatch" });
      expect(send).toHaveBeenCalledOnce();
    },
  );
  it("calls full Clef binding once, with no HTTP dependencies", async () => {
    const run = vi.fn(async () => ({ ...output(), model: "clef" }));
    const result = await createClefProvider({ run }).classify(payload(), signal());
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0]).toEqual([CLEF_BINDING_MODEL, { ...payload(), model: "clef" }]);
    expect(result).toMatchObject({ model: "clef" });
  });
  it("maps binding failures safely and rejects late answers after cancellation", async () => {
    const broken = createClefProvider({
      run: async () => {
        throw new Error("sensitive binding message");
      },
    });
    await expect(broken.classify(payload(), signal())).rejects.toMatchObject({
      status: 503,
      message: "The inference provider is unavailable.",
    });
    const controller = new AbortController();
    const late = createClefProvider({
      run: async () => {
        controller.abort();
        return output();
      },
    });
    await expect(late.classify(payload(), controller.signal)).rejects.toMatchObject({
      status: 504,
    });
  });
  it("unwraps only a valid Cloudflare REST envelope and validates all answers", async () => {
    const send = fakeFetch(() =>
      Response.json({
        success: true,
        result: { ...output(), model: "clef" },
        errors: [],
        messages: [],
      }),
    );
    const rest = createClefRestProvider({
      accountId: "a".repeat(32),
      apiToken: "fake",
      fetch: send,
    });
    await expect(rest.classify(payload(), signal())).resolves.toMatchObject({ model: "clef" });
    expect(send.mock.calls[0]![0]).toBe(
      `https://api.cloudflare.com/client/v4/accounts/${"a".repeat(32)}/ai/run/${CLEF_BINDING_MODEL}`,
    );
    const bad = createClefRestProvider({
      accountId: "a".repeat(32),
      apiToken: "fake",
      fetch: fakeFetch(() => Response.json({ success: false, errors: [{ message: "sensitive" }] })),
    });
    await expect(bad.classify(payload(), signal())).rejects.toMatchObject({ status: 502 });
    expect(() => createClefRestProvider({ accountId: "../escape", apiToken: "fake" })).toThrow(
      expect.objectContaining({ status: 503 }),
    );
  });
  it("pins Decider with provider fallback disabled and normalizes router extras", async () => {
    const send = fakeFetch(() =>
      Response.json({
        ...output(),
        model: DECIDER_MODEL,
        id: "router-id",
        provider: "Perplexity",
        usage: { ...output().usage, cost: 0.0001 },
      }),
    );
    const result = await createDeciderProvider({ apiKey: "fake", fetch: send }).classify(
      payload(),
      signal(),
    );
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![0]).toBe(DECIDER_URL);
    expect(JSON.parse(send.mock.calls[0]![1]!.body as string)).toMatchObject({
      model: DECIDER_MODEL,
      provider: { only: ["Perplexity"], allow_fallbacks: false },
    });
    expect(result).toEqual({ ...output(), model: DECIDER_MODEL });
  });

  it("counts routing metadata in the actual provider input envelope before dispatch", async () => {
    const input = payload();
    const baseBytes = new TextEncoder().encode(
      JSON.stringify({ ...input, model: DECIDER_MODEL }),
    ).length;
    input.state.reserve = "x".repeat(16_384 - baseBytes - ',"reserve":""'.length);
    const send = fakeFetch(() => Response.json(output()));
    expect(
      new TextEncoder().encode(JSON.stringify({ ...input, model: DECIDER_MODEL })).length,
    ).toBe(16_384);
    await expect(
      createDeciderProvider({ apiKey: "fake", fetch: send }).classify(input, signal()),
    ).rejects.toMatchObject({ status: 422, code: "compiled_input_too_large" });
    expect(send).not.toHaveBeenCalled();
  });
});
