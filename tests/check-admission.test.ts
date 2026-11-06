import { describe, expect, it, vi } from "vitest";
import { createApp, type Metric } from "../src/http/app.js";
import { ServiceError } from "../src/contracts/errors.js";
import { hashKey } from "../src/control/auth.js";
import type { Env } from "../src/env.js";
import type { DecisionProvider } from "../src/providers/types.js";
import { testAdmission } from "./helpers/admission.js";

const body = {
  claim: { id: "private-client-claim", text: "A private plan includes SSO." },
  against: [{ id: "private-client-evidence", text: "A private plan excludes SSO." }],
};
async function fixture(inject = true) {
  const keys = [`cck_${"c".repeat(43)}`, `cck_${"d".repeat(43)}`];
  const hashes = await Promise.all(keys.map(hashKey));
  const db = {
    withSession: () => db,
    prepare: () => ({
      bind(...values: unknown[]) {
        return {
          first: async () => {
            const index = hashes.indexOf(String(values[0]));
            return index < 0 ? null : { id: `internal-${index}`, tenant_id: "shared-tenant" };
          },
        };
      },
    }),
    batch: vi.fn(async () => []),
  };
  const env = {
    DB: db,
    RATE_LIMITER: { limit: async () => ({ success: true }) },
    INGRESS_LIMITER: { limit: async () => ({ success: true }) },
  } as unknown as Env;
  const provider: DecisionProvider = {
    id: "jev",
    model: "synthetic-test",
    classify: vi.fn(async (payload) => ({
      model: "synthetic-test",
      answers: Object.fromEntries(
        Object.keys(payload.questions).map((id) => [
          id,
          {
            type: "choice",
            probabilities: {
              contradiction: 1,
              consistent: 0,
              different_scope: 0,
              insufficient_context: 0,
            },
          },
        ]),
      ),
    })),
  };
  const admission = testAdmission(["shared-tenant"]),
    tasks: Promise<unknown>[] = [],
    metrics: Metric[] = [];
  const app = createApp({
    provider,
    ...(inject && { admission: admission.service }),
    background: { waitUntil: (task) => tasks.push(task) },
    metric: (metric) => metrics.push(metric),
  });
  const check = (input: unknown = body, key = keys[0]!, signal?: AbortSignal) =>
    app.request(
      "/v1/check",
      {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify(input),
        ...(signal && { signal }),
      },
      env,
    );
  return { app, provider, admission, env, db, metrics, tasks, check, keys };
}

describe("HTTP admission boundaries", () => {
  it("reports readiness unavailable when the required admission controller is absent", async () => {
    const h = await fixture(false);
    h.env.TYPESAFE_API_KEY = "synthetic-test-credential";
    const response = await h.app.request(
      "/internal/ready",
      { headers: { authorization: `Bearer ${h.keys[0]!}` } },
      h.env,
    );
    expect(response.status).toBe(503);
    expect(h.provider.classify).not.toHaveBeenCalled();
  });
  it.each(["timeout", "aborted"] as const)(
    "reports %s after dispatch without claiming provider cancellation",
    async (outcome) => {
      const h = await fixture();
      let started: () => void = () => {};
      const dispatched = new Promise<void>((resolve) => {
        started = resolve;
      });
      vi.mocked(h.provider.classify).mockImplementation(async () => {
        started();
        return new Promise(() => {});
      });
      const controller = new AbortController();
      vi.useFakeTimers();
      try {
        const pending = h.check(body, h.keys[0]!, controller.signal);
        await dispatched;
        if (outcome === "timeout") await vi.advanceTimersByTimeAsync(2600);
        else controller.abort(new DOMException("private abort cause", "AbortError"));
        const response = await pending;
        expect(response.status).toBe(outcome === "timeout" ? 504 : 408);
        expect(await response.text()).not.toContain("private abort cause");
        await Promise.all(h.tasks);
        expect(h.admission.service.complete).toHaveBeenCalledWith(
          expect.objectContaining({ outcome, inputTokens: null }),
        );
        expect(h.admission.coordinator.getUsage("shared-tenant").today[outcome]).toBe(1);
        expect(h.admission.coordinator.getUsage("shared-tenant").inflight).toBe(1);
      } finally {
        vi.useRealTimers();
      }
    },
  );
  it("fails closed when control is missing, paused, or throws without dispatch", async () => {
    const missing = await fixture(false);
    expect((await missing.check()).status).toBe(503);
    expect(missing.provider.classify).not.toHaveBeenCalled();
    const paused = await fixture();
    paused.admission.coordinator.setGlobalPause({ paused: true });
    expect((await paused.check()).status).toBe(503);
    expect(paused.provider.classify).not.toHaveBeenCalled();
    const failed = await fixture();
    failed.admission.service.admit.mockRejectedValue(
      new ServiceError(
        503,
        "admission_unavailable",
        "Request admission is temporarily unavailable.",
        true,
      ),
    );
    expect((await failed.check()).status).toBe(503);
    expect(failed.provider.classify).not.toHaveBeenCalled();
  });

  it("never charges a compiled-envelope rejection and binds admission to internal identities", async () => {
    const h = await fixture();
    const huge = {
      claim: { id: "claim", text: "x".repeat(4096) },
      against: Array.from({ length: 20 }, (_, i) => ({ id: `e${i}`, text: "x".repeat(2048) })),
    };
    const rejected = await h.check(huge);
    expect(rejected.status).toBe(422);
    expect(await rejected.text()).toContain("compiled_input_too_large");
    expect(h.admission.service.admit).not.toHaveBeenCalled();
    expect(h.provider.classify).not.toHaveBeenCalled();
    expect((await h.check()).status).toBe(200);
    await Promise.all(h.tasks);
    const admitted = h.admission.service.admit.mock.calls[0]![0];
    expect(admitted).toMatchObject({
      tenantId: "shared-tenant",
      keyId: "internal-0",
      channel: "api",
      comparisons: 1,
      profile: "balanced-v1",
    });
    expect(admitted.requestId).toMatch(/^[a-f0-9-]{36}$/);
    expect(admitted.compiledBytes).toBeGreaterThan(1000);
    const telemetry = JSON.stringify(h.metrics);
    for (const secret of [
      body.claim.id,
      body.against[0]!.id,
      body.claim.text,
      body.against[0]!.text,
      h.keys[0]!,
      "probabilities",
      "raw_scores",
    ])
      expect(telemetry).not.toContain(secret);
  });

  it("shares the tenant minute quota across different API keys", async () => {
    const h = await fixture();
    for (let i = 0; i < 10; i++) {
      expect((await h.check(body, h.keys[i % 2]!)).status).toBe(200);
      await Promise.all(h.tasks);
    }
    expect((await h.check(body, h.keys[1]!)).status).toBe(429);
    expect(h.provider.classify).toHaveBeenCalledTimes(10);
    expect(h.admission.coordinator.getUsage("shared-tenant").today.attempts).toBe(10);
  });

  it("does not dispatch after a late admission result outlives the provider deadline", async () => {
    const h = await fixture();
    let release: (value: { reservationId: string }) => void = () => {};
    let entered: () => void = () => {};
    const reached = new Promise<void>((resolve) => {
      entered = resolve;
    });
    h.admission.service.admit.mockImplementation(async () => {
      entered();
      return new Promise((resolve) => {
        release = resolve;
      });
    });
    vi.useFakeTimers();
    try {
      const pending = h.check();
      await reached;
      await vi.advanceTimersByTimeAsync(2600);
      expect((await pending).status).toBe(504);
      release({ reservationId: crypto.randomUUID() });
      await vi.advanceTimersByTimeAsync(0);
      expect(h.provider.classify).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("records unknown tokens as a successful completion and leaves advisory write failures out of the response", async () => {
    const h = await fixture();
    h.db.batch.mockRejectedValue(new Error("private usage details"));
    const response = await h.check();
    expect(response.status).toBe(200);
    expect(
      ((await response.json()) as { usage: { input_tokens: null } }).usage.input_tokens,
    ).toBeNull();
    await Promise.all(h.tasks);
    expect(h.admission.service.complete).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "completed", inputTokens: null }),
    );
    expect(JSON.stringify(h.metrics)).not.toContain("private usage details");
  });

  it("retains real elapsed duration on provider failures", async () => {
    const h = await fixture();
    vi.mocked(h.provider.classify).mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      throw new Error("private provider failure");
    });
    const response = await h.check();
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private provider failure");
    await Promise.all(h.tasks);
    expect(h.admission.service.complete).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "failed", inputTokens: null }),
    );
    expect(h.admission.service.complete.mock.calls[0]![0].durationMs).toBeGreaterThanOrEqual(15);
    expect(h.metrics.some((m) => m.outcome === "provider_unavailable" && m.duration_ms >= 15)).toBe(
      true,
    );
  });
});
