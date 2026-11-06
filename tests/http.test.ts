import { describe, expect, it, vi } from "vitest";
import { createApp, type Metric } from "../src/http/app.js";
import { hashKey } from "../src/control/auth.js";
import type { Env } from "../src/env.js";
import type { DecisionProvider } from "../src/providers/types.js";
import { withDeadline } from "../src/http/deadline.js";
import { ServiceError } from "../src/contracts/errors.js";
import { checkResponseSchema, errorResponseSchema } from "../src/contracts/index.js";
import type { openApiDocument } from "../src/http/openapi.js";
import { testAdmission } from "./helpers/admission.js";

const key = `cck_${"a".repeat(43)}`;
const body = {
  claim: { id: "new-policy", text: "Starter includes SSO." },
  against: [
    { id: "z-policy", text: "Starter excludes SSO." },
    { id: "a-policy", text: "Enterprise includes SSO." },
  ],
};

function harness() {
  let revoked = false;
  let authFailure = false;
  const queries: { sql: string; values: unknown[] }[] = [];
  const db = {
    withSession: vi.fn(() => db),
    prepare(sql: string) {
      const entry = { sql, values: [] as unknown[] };
      queries.push(entry);
      return {
        bind(...values: unknown[]) {
          entry.values = values;
          return this;
        },
        async first() {
          if (authFailure) throw new Error("database private details");
          return revoked || entry.values[0] !== (await hashKey(key))
            ? null
            : { id: "internal-key", tenant_id: "tenant" };
        },
      };
    },
    batch: vi.fn(async () => []),
  };
  const limiter = { limit: vi.fn(async () => ({ success: true })) };
  const ingress = { limit: vi.fn(async () => ({ success: true })) };
  const env = { DB: db, RATE_LIMITER: limiter, INGRESS_LIMITER: ingress } as unknown as Env;
  const provider: DecisionProvider = {
    id: "jev",
    model: "test",
    classify: vi.fn(async (payload) => ({
      model: "test",
      answers: Object.fromEntries(
        Object.keys(payload.questions).map((id) => [
          id,
          {
            type: "choice",
            choice: "contradiction",
            probabilities: {
              contradiction: 0.97,
              consistent: 0.01,
              different_scope: 0.01,
              insufficient_context: 0.01,
            },
          },
        ]),
      ),
      usage: { input_tokens: 100 },
    })),
  };
  const metrics: Metric[] = [];
  const tasks: Promise<unknown>[] = [];
  const admission = testAdmission(["tenant"]);
  const app = createApp({
    provider,
    admission: admission.service,
    metric: (metric) => metrics.push(metric),
    background: { waitUntil: (task) => tasks.push(task) },
  });
  const check = (input: unknown = body, headers: Record<string, string> = {}) =>
    app.request(
      "/v1/check",
      {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json", ...headers },
        body: JSON.stringify(input),
      },
      env,
    );
  return {
    app,
    env,
    db,
    limiter,
    ingress,
    provider,
    admission,
    metrics,
    tasks,
    queries,
    check,
    revoke: () => {
      revoked = true;
    },
    failAuth: () => {
      authFailure = true;
    },
  };
}

describe("HTTP contract", () => {
  it.each(["semantic-v2", "structured-value-v1"] as const)(
    "serves explicit experimental %s with the right signal representation",
    async (profile) => {
      const h = harness();
      vi.mocked(h.provider.classify).mockImplementation(async (payload) => ({
        model: "test",
        answers: Object.fromEntries(
          Object.entries(payload.questions).map(([id, question]) => [
            id,
            {
              type: "choice",
              choice: "consistent",
              probabilities: Object.fromEntries(
                Object.keys(question.criteria).map((label) => [
                  label,
                  label === "consistent" ? 1 : 0,
                ]),
              ),
            },
          ]),
        ),
      }));
      const response = await h.check({ ...body, profile });
      expect(response.status).toBe(200);
      const result = checkResponseSchema.parse(await response.json());
      expect(result.engine.profile).toBe(profile);
      expect(result.engine).toHaveProperty("experimental", true);
      expect(result.coverage.completed).toBe(2);
      expect(h.provider.classify).toHaveBeenCalledTimes(1);
      for (const comparison of result.comparisons) {
        if (profile === "structured-value-v1") {
          expect(comparison.structured_signals).toBeDefined();
          expect(comparison.raw_scores).toBeUndefined();
        } else expect(comparison.raw_scores).toBeDefined();
      }
    },
  );

  it("limits anonymous IP traffic before parsing or looking up keys", async () => {
    const h = harness();
    h.ingress.limit.mockResolvedValue({ success: false });
    const response = await h.check(body, {
      authorization: "",
      "content-type": "text/plain",
      "cf-connecting-ip": "203.0.113.9",
      "x-forwarded-for": "198.51.100.8",
    });
    expect(response.status).toBe(429);
    expect(h.ingress.limit).toHaveBeenCalledWith({ key: "203.0.113.9" });
    expect(h.queries).toHaveLength(0);
    expect(h.provider.classify).not.toHaveBeenCalled();
    const readiness = await h.app.request("/internal/ready", {}, h.env);
    expect(readiness.status).toBe(429);
    expect(h.queries).toHaveLength(0);
    expect(JSON.stringify(h.metrics)).not.toContain("203.0.113.9");
  });

  it("fails closed before D1 if the ingress binding fails or is absent", async () => {
    const h = harness();
    h.ingress.limit.mockRejectedValue(new Error("private ingress detail"));
    const failed = await h.check();
    expect(failed.status).toBe(503);
    expect(await failed.text()).not.toContain("private ingress detail");
    delete (h.env as unknown as Record<string, unknown>).INGRESS_LIMITER;
    expect((await h.check()).status).toBe(503);
    expect(h.queries).toHaveLength(0);
    expect(h.provider.classify).not.toHaveBeenCalled();
  });

  it("includes ingress in the existing body budget and ignores late admission", async () => {
    vi.useFakeTimers();
    try {
      const h = harness();
      let release: (value: { success: boolean }) => void = () => undefined;
      h.ingress.limit.mockImplementation(
        () =>
          new Promise((resolve) => {
            release = resolve;
          }),
      );
      const pending = h.check();
      await vi.advanceTimersByTimeAsync(2100);
      expect((await pending).status).toBe(408);
      release({ success: true });
      await vi.advanceTimersByTimeAsync(0);
      expect(h.queries).toHaveLength(0);
      expect(h.provider.classify).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("completes every pair with original order and safe evidence, one provider call", async () => {
    const h = harness();
    const response = await h.check();
    expect(response.status).toBe(200);
    const result = checkResponseSchema.parse(await response.json());
    expect(result.comparisons.map((item: { against_id: string }) => item.against_id)).toEqual([
      "z-policy",
      "a-policy",
    ]);
    expect(result.coverage).toMatchObject({ completed: 2, unassessed: 0, input_truncated: false });
    expect(result.comparisons[0]!.evidence).toEqual({
      claim_id: "new-policy",
      against_id: "z-policy",
      granularity: "submitted_text",
    });
    expect(h.provider.classify).toHaveBeenCalledTimes(1);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("server-timing")).toContain("provider;dur=");
    expect(response.headers.get("x-request-id")).toBe(result.request_id);
    await Promise.all(h.tasks);
    expect(h.db.withSession).toHaveBeenCalledWith("first-primary");
    expect(h.db.batch).toHaveBeenCalledTimes(2);
    const persisted = JSON.stringify(h.queries);
    const telemetry = JSON.stringify(h.metrics);
    for (const sensitive of [
      "Starter includes",
      "Starter excludes",
      "new-policy",
      "z-policy",
      key,
    ]) {
      expect(persisted).not.toContain(sensitive);
      expect(telemetry).not.toContain(sensitive);
    }
    expect(telemetry).not.toContain("contradiction");
  });

  it("rejects absent, wrong, and immediately revoked keys without inference", async () => {
    const h = harness();
    expect((await h.check(body, { authorization: "" })).status).toBe(401);
    expect((await h.check(body, { authorization: `Bearer cck_${"b".repeat(43)}` })).status).toBe(
      401,
    );
    expect((await h.check()).status).toBe(200);
    h.revoke();
    expect((await h.check()).status).toBe(401);
    expect(h.provider.classify).toHaveBeenCalledTimes(1);
  });

  it("fails closed on storage and rate-limit failures without leaking details", async () => {
    const h = harness();
    h.failAuth();
    const response = await h.check();
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private");
    expect(h.provider.classify).not.toHaveBeenCalled();
    const limited = harness();
    limited.limiter.limit.mockResolvedValue({ success: false });
    const throttled = await limited.check();
    expect(throttled.status).toBe(429);
    expect(throttled.headers.get("retry-after")).toBe("60");
    expect(limited.provider.classify).not.toHaveBeenCalled();
  });

  it("accepts case-insensitive Bearer schemes without changing key bytes", async () => {
    const h = harness();
    expect((await h.check(body, { authorization: `bEaReR ${key}` })).status).toBe(200);
    expect((await h.check(body, { authorization: `bearer ${key.toUpperCase()}` })).status).toBe(
      401,
    );
  });

  it("classifies client cancellation separately from an internal failure", async () => {
    const h = harness();
    const controller = new AbortController();
    controller.abort(new DOMException("private abort reason", "AbortError"));
    const response = await h.app.request(
      "/v1/check",
      {
        method: "POST",
        signal: controller.signal,
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify(body),
      },
      h.env,
    );
    expect(response.status).toBe(408);
    const result = await response.text();
    expect(result).toContain("request_aborted");
    expect(result).not.toContain("private abort reason");
    expect(h.provider.classify).not.toHaveBeenCalled();
    expect(h.metrics.some((metric) => metric.outcome === "internal_error")).toBe(false);
  });

  it("rejects duplicate IDs, unknown fields, empty sets and invalid Unicode", async () => {
    const h = harness();
    for (const input of [
      { ...body, context: "unrequested evidence" },
      { ...body, against: [] },
      { ...body, against: [{ id: body.claim.id, text: "same" }] },
    ])
      expect((await h.check(input)).status).toBe(422);
    expect((await h.check({ ...body, claim: { ...body.claim, text: "\ud800" } })).status).toBe(400);
    expect(h.provider.classify).not.toHaveBeenCalled();
  });

  it("distinguishes malformed JSON and unsupported content from schema errors", async () => {
    const h = harness();
    const malformed = await h.app.request(
      "/v1/check",
      { method: "POST", headers: { "content-type": "application/json" }, body: "{" },
      h.env,
    );
    expect(malformed.status).toBe(400);
    expect((await h.check(body, { "content-type": "text/plain" })).status).toBe(415);
    expect((await h.check(body, { "content-encoding": "gzip" })).status).toBe(415);
    expect((await h.check(body, { "content-length": "65537" })).status).toBe(413);
  });

  it("never returns a clean result for incomplete or failing providers", async () => {
    const h = harness();
    vi.mocked(h.provider.classify).mockResolvedValue({ answers: {} });
    expect((await h.check()).status).toBe(502);
    vi.mocked(h.provider.classify).mockRejectedValue(new Error("secret upstream text"));
    const response = await h.check();
    expect(response.status).toBe(503);
    const json = errorResponseSchema.parse(await response.json());
    expect("verdict" in json).toBe(false);
    expect(JSON.stringify(json)).not.toContain("secret");
  });

  it("rejects duplicate caller JSON keys including escaped aliases before dispatch", async () => {
    const h = harness();
    for (const raw of [
      '{"claim":{"id":"a","text":"first","text":"second"},"against":[{"id":"b","text":"other"}]}',
      '{"claim":{"id":"a","text":"first","te\\u0078t":"second"},"against":[{"id":"b","text":"other"}]}',
    ]) {
      const response = await h.app.request(
        "/v1/check",
        {
          method: "POST",
          headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
          body: raw,
        },
        h.env,
      );
      expect(response.status).toBe(400);
      expect(await response.text()).toContain("invalid_json");
    }
    expect(h.provider.classify).not.toHaveBeenCalled();
  });

  it("publishes the canonical OpenAPI schemas without credentials", async () => {
    const h = harness();
    const response = await h.app.request("/openapi.json", {}, h.env);
    expect(response.status).toBe(200);
    const document = (await response.json()) as ReturnType<typeof openApiDocument>;
    expect(document.openapi).toBe("3.1.0");
    expect(document.paths["/v1/check"].post.security).toEqual([{ apiKey: [] }]);
    expect(document.components.schemas.CheckRequest.additionalProperties).toBe(false);
    expect(document.components.schemas.CheckResponse.anyOf).toHaveLength(3);
    for (const variant of document.components.schemas.CheckResponse.anyOf ?? []) {
      expect(variant.properties).not.toHaveProperty("verdict");
      expect(variant.required).not.toContain("verdict");
      expect(variant.properties).toMatchObject({
        comparisons: { items: { required: expect.arrayContaining(["verdict"]) } },
      });
    }
    expect(JSON.stringify(document)).not.toContain(key);
    expect((await h.app.request("/health", {}, h.env)).status).toBe(200);
  });
});

describe("deadline ownership", () => {
  it("rejects an uncancellable operation and ignores its late result", async () => {
    const error = new ServiceError(504, "timeout", "Timed out.", true);
    let resolve: (value: string) => void = () => undefined;
    const result = withDeadline(
      () =>
        new Promise<string>((done) => {
          resolve = done;
        }),
      5,
      error,
    );
    await expect(result).rejects.toBe(error);
    resolve("late");
  });

  it("does not dispatch a task for an already aborted parent", async () => {
    const controller = new AbortController();
    const error = new ServiceError(504, "timeout", "Timed out.", true);
    controller.abort(error);
    const task = vi.fn(async () => "should not run");
    await expect(withDeadline(task, 100, error, controller.signal)).rejects.toBe(error);
    expect(task).not.toHaveBeenCalled();
  });
});
