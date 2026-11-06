import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, type Metric } from "../src/http/app.js";
import {
  DEFAULT_MODEL,
  SUPPORTED_MODELS,
  MODEL_IDS,
  MODEL_ROUTES,
  type Model,
} from "../src/contracts/models.js";
import { checkRequestSchema, checkResponseSchema } from "../src/contracts/index.js";
import { hashKey } from "../src/control/auth.js";
import type { Env } from "../src/env.js";
import { compileCheck } from "../src/kernel/index.js";
import { LIMITS } from "../src/contracts/limits.js";
import { ADMISSION_LIMITS } from "../src/control/admission.js";
import type { DecisionPayload, DecisionProvider } from "../src/providers/types.js";
import { testAdmission } from "./helpers/admission.js";

const key = `cck_${"m".repeat(43)}`;
const body = {
  claim: { id: "claim", text: "The plan includes SSO." },
  against: [{ id: "evidence", text: "The plan excludes SSO." }],
};
function decision(payload: DecisionPayload) {
  return {
    model: payload.model,
    answers: Object.fromEntries(
      Object.keys(payload.questions).map((id) => [
        id,
        {
          type: "choice",
          probabilities: {
            contradiction: 0.97,
            consistent: 0.01,
            different_scope: 0.01,
            insufficient_context: 0.01,
          },
        },
      ]),
    ),
    usage: { input_tokens: 42, output_tokens: 0 },
  };
}
async function fixture(
  extra: { [K in keyof Env]?: Env[K] | undefined } & { PROVIDER?: string } = {},
  provider?: DecisionProvider,
) {
  const expected = await hashKey(key);
  const first = vi.fn(async (hash: unknown) =>
    hash === expected ? { id: "internal-routing-key", tenant_id: "routing-tenant" } : null,
  );
  const db = {
    withSession: vi.fn(() => db),
    prepare: () => ({ bind: (...values: unknown[]) => ({ first: () => first(values[0]) }) }),
    batch: vi.fn(async () => []),
  };
  const run = vi.fn(async (model: string, payload: unknown) => {
    expect(model).toBe(`@cf/cloudflare/${(payload as DecisionPayload).model}`);
    return decision(payload as DecisionPayload);
  });
  const send = vi.fn(async (url: unknown, input?: RequestInit) => {
    expect(input?.redirect).toBe("manual");
    const wire = JSON.parse(input!.body as string);
    if (String(url) === "https://api.openai.com/v1/decisions") {
      expect(input?.headers).toMatchObject({ authorization: "Bearer synthetic-openai-credential" });
      expect(wire.model).toBe("gpt-6-luna");
      return Response.json({
        model: wire.model,
        answers: wire.questions.map((question: { name: string; choices: { value: string }[] }) => ({
          name: question.name,
          type: "choice",
          choice: "contradiction",
          confidence: 0.93,
          probabilities: question.choices.map(({ value }) => ({
            value,
            probability: value === "contradiction" ? 0.97 : 0.01,
          })),
        })),
        usage: { input_tokens: 42, output_tokens: 0 },
      });
    }
    if (String(url) === "https://openrouter.ai/api/alpha/decisions") {
      expect(input?.headers).toMatchObject({
        authorization: "Bearer synthetic-openrouter-credential",
      });
      expect(wire.provider.allow_fallbacks).toBe(false);
      if (wire.model.startsWith("perplexity/")) expect(wire.provider.only).toEqual(["Perplexity"]);
      else expect(wire.provider.only).toBeUndefined();
      return Response.json(decision(wire as DecisionPayload));
    }
    expect(String(url)).toBe("https://api.typesafe.ai/v1/systemone");
    expect(input?.headers).toMatchObject({ authorization: "Bearer synthetic-typesafe-credential" });
    return Response.json(decision(wire as DecisionPayload));
  });
  vi.stubGlobal("fetch", send);
  const env = {
    DB: db,
    RATE_LIMITER: { limit: async () => ({ success: true }) },
    INGRESS_LIMITER: { limit: async () => ({ success: true }) },
    TYPESAFE_API_KEY: "synthetic-typesafe-credential",
    OPENAI_API_KEY: "synthetic-openai-credential",
    OPENROUTER_API_KEY: "synthetic-openrouter-credential",
    AI: { run },
    ...extra,
  } as unknown as Env;
  const admission = testAdmission(["routing-tenant"]),
    tasks: Promise<unknown>[] = [],
    metrics: Metric[] = [];
  const app = createApp({
    ...(provider && { provider }),
    admission: admission.service,
    metric: (entry) => {
      metrics.push(entry);
    },
    background: {
      waitUntil: (task) => {
        tasks.push(task);
      },
    },
  });
  const request = async (input: unknown = body) => {
    const response = await app.request(
      "/v1/check",
      {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify(input),
      },
      env,
    );
    await Promise.all(tasks);
    return response;
  };
  return { env, app, admission, send, run, first, metrics, request };
}
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("explicit hosted model routing", () => {
  it("publishes all eight configured flags without inference, authentication, or credential disclosure", async () => {
    const run = vi.fn(),
      metric = vi.fn(),
      send = vi.fn();
    vi.stubGlobal("fetch", send);
    const app = createApp({ metric });
    const response = await app.request("/v1/models", {}, {
      TYPESAFE_API_KEY: "private-typesafe-credential",
      AI: { run },
    } as unknown as Env);
    expect(response.status).toBe(200);
    const catalog = await response.json();
    expect(catalog).toEqual({
      default: DEFAULT_MODEL,
      models: SUPPORTED_MODELS.map((model) => ({
        ...model,
        configured: ["jev", "clef"].includes(MODEL_ROUTES[model.id]),
      })),
    });
    expect((catalog as { models: { id: string }[] }).models.map(({ id }) => id)).toEqual([
      "jev-1.14.0",
      "clef",
      "clef-flash",
      "clef-omni",
      "gpt-6-luna",
      "microsoft/microsoft-decision-1",
      "perplexity/pplx-decider-v1.2",
      "perplexity/pplx-decider-flash-v1.2",
    ]);
    expect(JSON.stringify(catalog)).not.toMatch(/private-typesafe|credential|available|kev/);
    expect(run).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(metric).not.toHaveBeenCalled();
  });

  it.each([
    { env: {}, configured: [] },
    {
      env: { TYPESAFE_API_KEY: "  ", OPENAI_API_KEY: "  ", OPENROUTER_API_KEY: "  " },
      configured: [],
    },
    { env: { OPENAI_API_KEY: "private-openai-key" }, configured: ["gpt-6-luna"] },
    {
      env: { OPENROUTER_API_KEY: "private-router-key" },
      configured: [
        "microsoft/microsoft-decision-1",
        "perplexity/pplx-decider-v1.2",
        "perplexity/pplx-decider-flash-v1.2",
      ],
    },
  ])(
    "catalog configured is local configuration rather than a provider probe (%j)",
    async ({ env, configured }) => {
      const send = vi.fn();
      vi.stubGlobal("fetch", send);
      const response = await createApp({ metric: () => {} }).request(
        "/v1/models",
        {},
        env as unknown as Env,
      );
      const catalog = (await response.json()) as { models: { id: string; configured: boolean }[] };
      expect(catalog.models.filter((entry) => entry.configured).map((entry) => entry.id)).toEqual(
        configured,
      );
      expect(JSON.stringify(catalog)).not.toMatch(/private-openai|private-router/);
      expect(send).not.toHaveBeenCalled();
    },
  );

  it.each([undefined, ...MODEL_IDS] as const)(
    "routes selected %s through its real provider adapter once",
    async (model) => {
      const h = await fixture();
      const response = await h.request({ ...body, ...(model !== undefined && { model }) });
      expect(response.status).toBe(200);
      const result = checkResponseSchema.parse(await response.json());
      const selected = model ?? DEFAULT_MODEL;
      expect(result.engine.requested_model).toBe(selected);
      expect(result.engine.provider).toBe(
        SUPPORTED_MODELS.find(({ id }) => id === selected)!.provider,
      );
      expect(result.usage.provider_calls).toBe(1);
      expect(h.send).toHaveBeenCalledTimes(MODEL_ROUTES[selected] === "clef" ? 0 : 1);
      expect(h.run).toHaveBeenCalledTimes(MODEL_ROUTES[selected] === "clef" ? 1 : 0);
      expect(h.admission.service.admit).toHaveBeenCalledWith(
        expect.objectContaining({ route: MODEL_ROUTES[selected] }),
      );
      expect([...h.admission.reservations.values()]).toHaveLength(1);
    },
  );

  it("keeps omitted-model requests on pinned Jev even when an old runtime PROVIDER variable selects Clef", async () => {
    const h = await fixture({ PROVIDER: "clef" });
    expect((await h.request()).status).toBe(200);
    expect(h.send).toHaveBeenCalledTimes(1);
    expect(h.run).not.toHaveBeenCalled();
    const payload = JSON.parse(h.send.mock.calls[0]![1]!.body as string);
    expect(payload.model).toBe(DEFAULT_MODEL);
    expect(h.admission.service.admit).toHaveBeenCalledWith(
      expect.objectContaining({ route: "jev" }),
    );
  });

  it.each(MODEL_IDS)(
    "fails closed when credentials for selected %s are missing despite other configured providers",
    async (model) => {
      const route = MODEL_ROUTES[model];
      const missing = {
        jev: { TYPESAFE_API_KEY: undefined },
        clef: { AI: undefined },
        "openai-decisions": { OPENAI_API_KEY: undefined },
        openrouter: { OPENROUTER_API_KEY: undefined },
      }[route];
      const h = await fixture(missing);
      const response = await h.request({ ...body, model });
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ error: { code: "provider_not_configured" } });
      expect(h.send).not.toHaveBeenCalled();
      expect(h.run).not.toHaveBeenCalled();
      expect(h.admission.service.admit).not.toHaveBeenCalled();
    },
  );

  it.each([
    { model: DEFAULT_MODEL, config: { TYPESAFE_API_KEY: "   " } },
    { model: "gpt-6-luna", config: { OPENAI_API_KEY: "   " } },
    { model: "microsoft/microsoft-decision-1", config: { OPENROUTER_API_KEY: "   " } },
    { model: undefined, config: { TYPESAFE_API_KEY: undefined, PROVIDER: "clef" } },
  ])(
    "does not treat blank keys or an old default override as available (%j)",
    async ({ model, config }) => {
      const h = await fixture(config);
      expect((await h.request({ ...body, ...(model !== undefined && { model }) })).status).toBe(
        503,
      );
      expect(h.send).not.toHaveBeenCalled();
      expect(h.run).not.toHaveBeenCalled();
      expect(h.admission.service.admit).not.toHaveBeenCalled();
    },
  );

  it.each(["unknown", "Jev 1.14", "clef ", "kev", "kev-latest", "gpt-6-luna-preview", null, {}])(
    "rejects unsupported model %j before authentication or reservation",
    async (model) => {
      const h = await fixture();
      const response = await h.request({ ...body, model });
      expect(response.status).toBe(422);
      expect(h.first).not.toHaveBeenCalled();
      expect(h.admission.service.admit).not.toHaveBeenCalled();
      expect(h.send).not.toHaveBeenCalled();
      expect(h.run).not.toHaveBeenCalled();
    },
  );

  it.each(MODEL_IDS)("does not retry or switch providers when %s fails", async (model) => {
    const h = await fixture();
    h.send.mockResolvedValue(new Response("private upstream response", { status: 503 }));
    h.run.mockRejectedValue(new Error("private binding details"));
    const response = await h.request({ ...body, model });
    expect(response.status).toBe(503);
    expect(await response.text()).not.toMatch(/private upstream|private binding/);
    expect(h.send).toHaveBeenCalledTimes(MODEL_ROUTES[model] === "clef" ? 0 : 1);
    expect(h.run).toHaveBeenCalledTimes(MODEL_ROUTES[model] === "clef" ? 1 : 0);
    expect(h.admission.coordinator.getUsage("routing-tenant").today.attempts).toBe(1);
  });

  it.each(MODEL_IDS)(
    "retains test provider injection while reserving the requested %s route",
    async (model: Model) => {
      const injected: DecisionProvider = {
        id: model === "clef" ? "typesafe" : "cloudflare-workers-ai",
        model: "synthetic-override",
        classify: vi.fn(async (payload) => decision(payload)),
      };
      const h = await fixture({ AI: undefined, TYPESAFE_API_KEY: undefined }, injected);
      expect((await h.request({ ...body, model })).status).toBe(200);
      expect(injected.classify).toHaveBeenCalledTimes(1);
      expect(h.send).not.toHaveBeenCalled();
      expect(h.run).not.toHaveBeenCalled();
      expect(h.admission.service.admit).toHaveBeenCalledWith(
        expect.objectContaining({ route: MODEL_ROUTES[model] }),
      );
    },
  );

  it("rejects an oversized converted Luna wire payload before charging admission or dispatching", async () => {
    const h = await fixture();
    const input = {
      model: "gpt-6-luna",
      claim: { id: "claim", text: '"\\'.repeat(2000) },
      against: [{ id: "evidence", text: '"\\'.repeat(1000) }],
    };
    const compiled = compileCheck(checkRequestSchema.parse(input), "gpt-6-luna");
    expect(compiled.compiledBytes).toBeLessThan(LIMITS.compiledBytes);
    const response = await h.request(input);
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: { code: "compiled_input_too_large" } });
    expect(h.first).toHaveBeenCalledOnce();
    expect(h.send).not.toHaveBeenCalled();
    expect(h.run).not.toHaveBeenCalled();
    expect(h.admission.service.admit).not.toHaveBeenCalled();
    expect(h.admission.reservations.size).toBe(0);
    expect(h.admission.coordinator.getUsage("routing-tenant").today.attempts).toBe(0);
    expect((await h.request({ ...input, model: DEFAULT_MODEL })).status).toBe(200);
    expect(h.admission.coordinator.getUsage("routing-tenant").today.attempts).toBe(1);
  });

  it("shares one tenant allowance across every model and blocks model switching after the rate limit", async () => {
    const h = await fixture();
    for (let index = 0; index < ADMISSION_LIMITS.requestsPerMinute; index++) {
      const model = MODEL_IDS[index % MODEL_IDS.length]!;
      expect((await h.request({ ...body, model })).status).toBe(200);
    }
    const usage = h.admission.coordinator.getUsage("routing-tenant");
    expect(usage.today.attempts).toBe(ADMISSION_LIMITS.requestsPerMinute);
    expect(usage.today.knownInputTokens).toBe(ADMISSION_LIMITS.requestsPerMinute * 42);
    const dispatches = h.send.mock.calls.length + h.run.mock.calls.length;
    const denied = await h.request({ ...body, model: "gpt-6-luna" });
    expect(denied.status).toBe(429);
    expect(await denied.json()).toMatchObject({ error: { code: "tenant_rate_limited" } });
    expect(h.send.mock.calls.length + h.run.mock.calls.length).toBe(dispatches);
    expect(h.admission.reservations.size).toBe(ADMISSION_LIMITS.requestsPerMinute);
  });

  it("checks default Jev configuration for readiness without using another model or making an inference call", async () => {
    const h = await fixture({ TYPESAFE_API_KEY: undefined, PROVIDER: "clef" });
    const unavailable = await h.app.request(
      "/internal/ready",
      { headers: { authorization: `Bearer ${key}` } },
      h.env,
    );
    expect(unavailable.status).toBe(503);
    expect(await unavailable.json()).toMatchObject({ error: { code: "provider_not_configured" } });
    expect(h.admission.service.getGlobalUsage).not.toHaveBeenCalled();
    h.env.TYPESAFE_API_KEY = "synthetic-typesafe-credential";
    expect(
      (
        await h.app.request(
          "/internal/ready",
          { headers: { authorization: `Bearer ${key}` } },
          h.env,
        )
      ).status,
    ).toBe(200);
    expect(h.admission.service.getGlobalUsage).toHaveBeenCalledTimes(1);
    expect(h.send).not.toHaveBeenCalled();
    expect(h.run).not.toHaveBeenCalled();
  });
});
