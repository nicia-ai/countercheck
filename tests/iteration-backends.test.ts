import { describe, expect, it, vi } from "vitest";
import {
  BACKEND_IDS,
  BACKEND_MODELS,
  backendPayload,
  createBackend,
  modelReportedCompatible,
  normalizeBackendResponse,
  sendBackend,
  type BackendId,
} from "../eval/iteration/backends.js";
import type { CandidatePayload } from "../eval/iteration/profiles.js";
import { JEV_MODEL, JEV_URL } from "../src/providers/jev.js";
import { DECIDER_MODEL, DECIDER_URL } from "../src/providers/decider.js";
import { LIMITS } from "../src/contracts/limits.js";

const env = {
  TYPESAFE_API_KEY: "unit-jev-key",
  CLOUDFLARE_API_TOKEN: "unit-clef-token",
  CLOUDFLARE_ACCOUNT_ID: "a".repeat(32),
  OPENROUTER_API_KEY: "unit-decider-key",
};
function payload(id: BackendId): CandidatePayload {
  return {
    model: BACKEND_MODELS[id],
    state: { text: "Invented adapter fixture." },
    questions: {
      q_pick: { type: "choice", instructions: "Which?", criteria: { yes: "Yes", no: "No" } },
      q_flag: { type: "noul", instructions: "Is the flag present?" },
    },
  };
}
function response(id: BackendId) {
  return {
    model: id === "decider" ? "perplexity/pplx-decider-v1.2-20261016" : BACKEND_MODELS[id],
    model_revision: "opaque-revision",
    answers: {
      q_pick: {
        type: "choice",
        choice: "yes",
        probabilities: { yes: 0.9, no: 0.1 },
        confidence: 0.8,
      },
      q_flag: { type: "noul", noul: 0.87 },
    },
    usage: { input_tokens: 123, output_tokens: 0 },
  };
}
function envelope(id: BackendId, value: unknown = response(id)) {
  if (id === "clef") return { success: true, errors: [], messages: [], result: value };
  if (id === "decider")
    return {
      ...response(id),
      id: "private-router-id",
      provider: "Perplexity",
      usage: { ...response(id).usage, cost: 0.0001 },
      ...(value as object),
    };
  return value;
}
const signal = () => new AbortController().signal;

describe("explicit pinned iteration backends", () => {
  it("uses the supplied environment and only the explicitly selected route", () => {
    expect(createBackend("jev", env)).toMatchObject({
      id: "jev",
      model: JEV_MODEL,
      url: JEV_URL,
      apiKey: env.TYPESAFE_API_KEY,
    });
    expect(createBackend("decider", env)).toMatchObject({
      id: "decider",
      model: DECIDER_MODEL,
      url: DECIDER_URL,
      apiKey: env.OPENROUTER_API_KEY,
    });
    const clef = createBackend("clef", env);
    expect(clef.url).toBe(
      `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/ai/run/@cf/cloudflare/clef`,
    );
    expect(clef).toMatchObject({
      model: "clef",
      accountId: env.CLOUDFLARE_ACCOUNT_ID,
      apiKey: env.CLOUDFLARE_API_TOKEN,
    });
    expect(Object.isFrozen(clef)).toBe(true);
  });

  it.each(BACKEND_IDS)("never falls back from missing %s credentials", (id) => {
    const incomplete = { ...env };
    delete (incomplete as Record<string, string>)[
      id === "jev"
        ? "TYPESAFE_API_KEY"
        : id === "clef"
          ? "CLOUDFLARE_API_TOKEN"
          : "OPENROUTER_API_KEY"
    ];
    expect(() => createBackend(id, incomplete)).toThrow("configuration is unavailable");
    expect(() => createBackend(id, {})).toThrow("configuration is unavailable");
  });

  it.each(["", "nicia-ai", "a".repeat(31), `${"a".repeat(32)}/other`])(
    "rejects invalid explicit Cloudflare account %j",
    (accountId) => {
      expect(() => createBackend("clef", { ...env, CLOUDFLARE_ACCOUNT_ID: accountId })).toThrow(
        "configuration is unavailable",
      );
    },
  );

  it("rejects alternate URLs, latest models and caller-provided routing before a request", async () => {
    const config = createBackend("jev", env);
    const send = vi.fn<typeof fetch>(async () => Response.json(response("jev")));
    await expect(
      sendBackend({ ...config, url: "https://example.test" }, payload("jev"), signal(), send),
    ).rejects.toMatchObject({ code: "provider_configuration" });
    await expect(
      sendBackend({ ...config, model: "jev-latest" }, payload("jev"), signal(), send),
    ).rejects.toMatchObject({ code: "provider_configuration" });
    expect(() => backendPayload(config, { ...payload("jev"), model: "jev-latest" })).toThrow();
    expect(() =>
      backendPayload(createBackend("decider", env), {
        ...payload("decider"),
        provider: { allow_fallbacks: true },
      } as CandidatePayload),
    ).toThrow();
    expect(send).not.toHaveBeenCalled();
  });
});

describe("reviewed reported identity pins", () => {
  it.each([
    [JEV_MODEL, JEV_MODEL],
    ["clef", "clef"],
    [DECIDER_MODEL, DECIDER_MODEL],
    [DECIDER_MODEL, "perplexity/pplx-decider-v1.2-20261016"],
  ])("accepts requested %s and reported %s", (requested, reported) => {
    expect(modelReportedCompatible(requested, reported)).toBe(true);
  });
  it.each([
    [JEV_MODEL, "jev-latest"],
    [JEV_MODEL, "jev-1.14.1"],
    [JEV_MODEL, "jev-1.14.0-20261103"],
    ["clef", "clef-flash"],
    ["clef", "@cf/cloudflare/clef"],
    [DECIDER_MODEL, "perplexity/pplx-decider-latest"],
    [DECIDER_MODEL, "perplexity/pplx-decider-v1.2-20261017"],
    [DECIDER_MODEL, "perplexity/pplx-decider-flash-v1.2"],
    ["unknown-latest", "unknown-latest"],
  ])("rejects requested %s and reported %s", (requested, reported) => {
    expect(modelReportedCompatible(requested, reported)).toBe(false);
  });
});

describe("raw mixed Choice/Noul normalization", () => {
  it.each(BACKEND_IDS)("preserves full %s model/revision and mixed answers", async (id) => {
    const config = createBackend(id, env);
    const original = payload(id),
      before = JSON.stringify(original);
    const send = vi.fn<typeof fetch>(async () => Response.json(envelope(id)));
    const cancellation = signal();
    const result = await sendBackend(config, original, cancellation, send);
    expect(result).toEqual(response(id));
    expect(JSON.stringify(original)).toBe(before);
    expect(send).toHaveBeenCalledTimes(1);
    const [url, init] = send.mock.calls[0]!;
    expect(url).toBe(config.url);
    expect(init!.signal).toBe(cancellation);
    expect(init!.redirect).toBe("manual");
    expect(new Headers(init!.headers).get("authorization")).toBe(`Bearer ${config.apiKey}`);
    const actual = JSON.parse(init!.body as string);
    expect(actual).toEqual(backendPayload(config, original));
    if (id === "decider")
      expect(actual.provider).toEqual({ only: ["Perplexity"], allow_fallbacks: false });
    else expect(actual).not.toHaveProperty("provider");
  });

  it.each(BACKEND_IDS)(
    "keeps missing %s identity/usage unknown rather than inventing the requested model or zero",
    (id) => {
      const raw = { answers: response(id).answers };
      const result = normalizeBackendResponse(
        id,
        id === "clef" ? { success: true, errors: [], messages: [], result: raw } : raw,
      );
      expect(result).toEqual(raw);
      const nullUsage = { ...raw, usage: { input_tokens: null, output_tokens: null } };
      const unknown = normalizeBackendResponse(
        id,
        id === "clef" ? { success: true, errors: [], messages: [], result: nullUsage } : nullUsage,
      );
      expect(unknown.usage).toEqual({});
      expect(unknown).not.toHaveProperty("model");
    },
  );

  it("discards only approved router metadata and retains an explicit incompatible model for the parser to reject", () => {
    const raw = {
      ...response("decider"),
      model: "perplexity/pplx-decider-latest",
      id: "PRIVATE_ID",
      provider: "Perplexity",
      usage: { input_tokens: 20, output_tokens: null, cost: 0.5 },
    };
    const normalized = normalizeBackendResponse("decider", raw);
    expect(normalized).toMatchObject({ model: raw.model, usage: { input_tokens: 20 } });
    expect(JSON.stringify(normalized)).not.toMatch(/PRIVATE_ID|Perplexity|cost/);
    expect(modelReportedCompatible(DECIDER_MODEL, normalized.model!)).toBe(false);
  });

  it.each([
    { success: false, errors: [], messages: [], result: response("clef") },
    { success: true, errors: ["PRIVATE_ERROR"], messages: [], result: response("clef") },
    { success: true, errors: [], messages: [], result: { refusal: "PRIVATE_REFUSAL" } },
  ])("rejects unsuccessful or malformed Clef REST envelopes", (raw) => {
    expect(() => normalizeBackendResponse("clef", raw)).toThrow("invalid or incomplete response");
  });

  it("rejects an explicit non-Perplexity provider without revealing its identity", () => {
    expect(() =>
      normalizeBackendResponse("decider", {
        ...response("decider"),
        provider: "PRIVATE_OTHER_PROVIDER",
      }),
    ).toThrow("Unexpected inference provider route");
  });

  it.each([
    { ...response("jev"), refusal: "PRIVATE_REFUSAL" },
    { ...response("jev"), usage: { input_tokens: -1 } },
    { ...response("jev"), usage: { input_tokens: 0.5 } },
    { ...response("jev"), usage: { input_tokens: "unknown" } },
  ])("rejects unknown top-level fields or malformed token metadata", (raw) => {
    expect(() => normalizeBackendResponse("jev", raw)).toThrow("invalid or incomplete response");
  });
});

describe("bounded one-attempt backend transport", () => {
  it("counts the Decider routing envelope against the actual byte budget before dispatch", async () => {
    const config = createBackend("decider", env),
      request = payload("decider");
    request.state.text = "";
    const overhead = new TextEncoder().encode(
      JSON.stringify(backendPayload(config, request)),
    ).length;
    request.state.text = "x".repeat(LIMITS.compiledBytes - overhead + 1);
    expect(new TextEncoder().encode(JSON.stringify(request)).length).toBeLessThanOrEqual(
      LIMITS.compiledBytes,
    );
    const send = vi.fn<typeof fetch>(async () => Response.json(response("decider")));
    await expect(sendBackend(config, request, signal(), send)).rejects.toMatchObject({
      status: 422,
      code: "compiled_input_too_large",
    });
    expect(send).not.toHaveBeenCalled();
  });

  it.each(BACKEND_IDS)("does not dispatch an already cancelled %s request", async (id) => {
    const controller = new AbortController();
    controller.abort();
    const send = vi.fn<typeof fetch>(async () => Response.json(envelope(id)));
    await expect(
      sendBackend(createBackend(id, env), payload(id), controller.signal, send),
    ).rejects.toMatchObject({ status: 504 });
    expect(send).not.toHaveBeenCalled();
  });

  it.each([401, 429, 500])("never retries or changes provider after HTTP %i", async (status) => {
    const send = vi.fn<typeof fetch>(async () => new Response("PRIVATE_ERROR_BODY", { status }));
    await expect(
      sendBackend(createBackend("decider", env), payload("decider"), signal(), send),
    ).rejects.toMatchObject({ status: 503 });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("maps network exceptions safely and rejects duplicate raw JSON keys", async () => {
    const failed = vi.fn<typeof fetch>(async () => {
      throw new Error("PRIVATE_NETWORK_DETAILS");
    });
    await expect(
      sendBackend(createBackend("jev", env), payload("jev"), signal(), failed),
    ).rejects.toThrow("inference provider is unavailable");
    expect(failed).toHaveBeenCalledTimes(1);
    const duplicate = vi.fn<typeof fetch>(
      async () =>
        new Response('{"answers":{},"answers":{}}', {
          headers: { "content-type": "application/json" },
        }),
    );
    await expect(
      sendBackend(createBackend("jev", env), payload("jev"), signal(), duplicate),
    ).rejects.toMatchObject({ status: 502, code: "provider_invalid_response" });
  });
});
