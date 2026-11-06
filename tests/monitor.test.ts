import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runMonitor, type MonitorEvent } from "../src/control/monitor.js";
import type { Env } from "../src/env.js";
import type { CheckResponse } from "../src/contracts/index.js";

class MonitorStore {
  ops = new Map<string, string>();
  requests = 0;
  dispatches = 0;
  errors = 0;
  broken = false;
  usageReads = 0;
  prepare(sql: string) {
    let values: unknown[] = [];
    const first = async () => {
      if (this.broken) throw new Error("private database connection details");
      if (sql.includes("SUM(requests)")) {
        this.usageReads++;
        return { requests: this.requests, errors: this.errors };
      }
      if (sql.includes("SUM(dispatches)")) {
        this.usageReads++;
        return { attempts: this.dispatches, errors: this.errors };
      }
      if (sql.startsWith("INSERT INTO ops_state")) {
        const key = values[0] as string;
        const previous = this.ops.get(key);
        if (previous !== undefined && Number(previous) >= Number(values[2])) return null;
        this.ops.set(key, values[1] as string);
        return { name: key };
      }
      const key = sql.includes("retention_last_success")
        ? "retention_last_success"
        : "canary_failures";
      return this.ops.has(key) ? { value: this.ops.get(key) } : null;
    };
    const statement = {
      bind: (...input: unknown[]) => {
        values = input;
        return statement;
      },
      first,
      run: async () => {
        if (this.broken) throw new Error("private database connection details");
        expect(sql).toContain("'canary_failures'");
        this.ops.set("canary_failures", values[0] as string);
        return { success: true };
      },
    };
    return statement;
  }
}
function response(positive = true): CheckResponse {
  const verdict = positive ? "contradiction" : "no_contradiction_detected";
  return {
    request_id: "synthetic-monitor-request",
    status: "completed",
    claim_id: "claim",
    comparisons: [
      {
        against_id: "comparison",
        verdict,
        reason: positive ? "incompatible_assertions" : "jointly_satisfiable",
        evidence: { claim_id: "claim", against_id: "comparison", granularity: "submitted_text" },
        raw_scores: {
          contradiction: positive ? 0.97 : 0.01,
          consistent: positive ? 0.01 : 0.97,
          different_scope: 0.01,
          insufficient_context: 0.01,
        },
      },
    ],
    coverage: {
      scope: "claim_against_each_text",
      requested: 1,
      completed: 1,
      unassessed: 0,
      input_truncated: false,
    },
    usage: { provider_calls: 1, input_tokens: 100 },
    engine: {
      profile: "balanced-v1",
      engine_release: "synthetic",
      prompt_version: "synthetic",
      threshold_version: "synthetic",
      provider: "jev",
      requested_model: "jev-1.14.0",
      reported_model: null,
      model_revision: null,
    },
  };
}
function fixture(extra: Partial<Env> = {}) {
  const store = new MonitorStore();
  store.ops.set("retention_last_success", new Date().toISOString());
  const events: MonitorEvent[] = [];
  const env = {
    DB: store,
    BETTER_AUTH_URL: "https://countercheck.example",
    ...extra,
  } as unknown as Env;
  return {
    store,
    env,
    events,
    emit: (event: MonitorEvent) => {
      events.push(event);
    },
  };
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-04T12:00:00Z"));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("content-free operational monitoring", () => {
  it("does no inference without an optional canary key but keeps retention and traffic monitoring", async () => {
    const f = fixture();
    const send = vi.fn();
    f.store.requests = 20;
    f.store.errors = 1;
    await runMonitor(f.env, send as typeof fetch, f.emit);
    expect(send).not.toHaveBeenCalled();
    expect(f.events).toEqual([
      { outcome: "canary_not_configured" },
      { outcome: "alert_elevated_failure_rate" },
    ]);
    expect(f.store.usageReads).toBe(1);
    expect(f.store.ops.has("canary_failures")).toBe(false);
  });

  it.each([
    { requests: 100, dispatches: 20, errors: 2, alert: false },
    { requests: 100, dispatches: 20, errors: 3, alert: true },
    { requests: 20, dispatches: 0, errors: 20, alert: true },
    { requests: 50, dispatches: 0, errors: 1, alert: false },
    { requests: 50, dispatches: 0, errors: 2, alert: true },
    { requests: 19, dispatches: 19, errors: 19, alert: false },
    { requests: 0, dispatches: 0, errors: 0, alert: false },
  ])("uses all authenticated requests as the matching 5xx population: %j", async (counts) => {
    const f = fixture();
    Object.assign(f.store, counts);
    const send = vi.fn();
    await runMonitor(f.env, send as typeof fetch, f.emit);
    expect(f.events.some((event) => event.outcome === "alert_elevated_failure_rate")).toBe(
      counts.alert,
    );
    expect(f.store.usageReads).toBe(1);
    expect(send).not.toHaveBeenCalled();
  });

  it.each([undefined, "invalid-date", "2026-11-03T09:59:59.999Z", "2026-11-05T12:00:00Z"])(
    "treats missing, invalid, stale or implausibly future retention metadata as stale (%s)",
    async (value) => {
      const f = fixture();
      if (value === undefined) f.store.ops.delete("retention_last_success");
      else f.store.ops.set("retention_last_success", value);
      await runMonitor(f.env, vi.fn() as unknown as typeof fetch, f.emit);
      expect(f.events).toContainEqual({ outcome: "alert_retention_stale" });
    },
  );

  it("accepts the retention threshold and small concurrent-cleanup clock skew", async () => {
    for (const timestamp of [Date.now() - 26 * 3600000, Date.now() + 100]) {
      const f = fixture();
      f.store.ops.set("retention_last_success", new Date(timestamp).toISOString());
      await runMonitor(f.env, vi.fn() as unknown as typeof fetch, f.emit);
      expect(f.events).not.toContainEqual({ outcome: "alert_retention_stale" });
    }
  });

  it("alternates fixed positive and same-text negative canaries, resetting failures only for a complete attributed response", async () => {
    const f = fixture({ CANARY_API_KEY: "synthetic-canary-key" });
    f.store.ops.set("canary_failures", "2");
    for (const positive of [true, false]) {
      const send = vi.fn(async (url: unknown, options?: RequestInit) => {
        expect(url).toBe("https://countercheck.example/v1/check");
        expect(options?.redirect).toBe("manual");
        const payload = JSON.parse(options!.body as string);
        expect(payload.profile).toBe("balanced-v1");
        expect(payload.against[0].text === payload.claim.text).toBe(!positive);
        return Response.json(response(positive));
      });
      await runMonitor(f.env, send as typeof fetch, f.emit);
      expect(send).toHaveBeenCalledTimes(1);
      expect(f.store.ops.get("canary_failures")).toBe("0");
      vi.advanceTimersByTime(300000);
    }
    expect(f.events.filter((e) => e.outcome === "canary_passed")).toHaveLength(2);
    expect(JSON.stringify(f.events)).not.toContain("synthetic-canary-key");
    expect(JSON.stringify(f.events)).not.toContain("Starter");
  });

  it.each([
    { status: "completed" },
    { ...response(), claim_id: "different" },
    { ...response(), coverage: { ...response().coverage, completed: 0 } },
    { ...response(), comparisons: [{ ...response().comparisons[0], against_id: "different" }] },
    { ...response(), comparisons: [] },
    { ...response(), comparisons: [{ ...response().comparisons[0], verdict: "uncertain" }] },
  ])(
    "does not mistake incomplete or misattributed replies for a passing canary %#",
    async (value) => {
      const f = fixture({ CANARY_API_KEY: "synthetic" });
      await runMonitor(f.env, (async () => Response.json(value)) as typeof fetch, f.emit);
      expect(f.events).toContainEqual(
        expect.objectContaining({ outcome: "canary_failed", failures: 1 }),
      );
    },
  );

  it.each([
    { comparisons: [] },
    { comparisons: [{ ...response().comparisons[0], verdict: "no_contradiction_detected" }] },
  ])(
    "a legacy top-level verdict cannot hide missing or incorrect comparison verdicts (%j)",
    async ({ comparisons }) => {
      const f = fixture({ CANARY_API_KEY: "synthetic" });
      const legacy = { ...response(), verdict: "contradiction", comparisons };
      await runMonitor(f.env, (async () => Response.json(legacy)) as typeof fetch, f.emit);
      expect(f.events).toContainEqual(
        expect.objectContaining({ outcome: "canary_failed", failures: 1 }),
      );
      expect(f.events.some((event) => event.outcome === "canary_passed")).toBe(false);
    },
  );

  it("counts streamed bytes before parsing, cancels overflow and never uses Response.text()", async () => {
    const f = fixture({ CANARY_API_KEY: "synthetic" });
    let pulls = 0,
      cancellations = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls++;
        controller.enqueue(new Uint8Array(32768).fill(65));
      },
      cancel() {
        cancellations++;
      },
    });
    const result = new Response(body, { headers: { "content-type": "application/json" } });
    const text = vi.spyOn(result, "text");
    await runMonitor(f.env, (async () => result) as typeof fetch, f.emit);
    expect(pulls).toBeLessThan(8);
    expect(cancellations).toBe(1);
    expect(text).not.toHaveBeenCalled();
    expect(f.store.ops.get("canary_failures")).toBe("1");
  });

  it("rejects duplicate JSON fields, invalid UTF-8 and redirects without logging payloads", async () => {
    for (const result of [
      new Response(
        JSON.stringify(response()).replace(
          '"status":"completed"',
          '"status":"error","status":"completed"',
        ),
        { headers: { "content-type": "application/json" } },
      ),
      new Response(new Uint8Array([0xff]), { headers: { "content-type": "application/json" } }),
      new Response("private response body", {
        status: 302,
        headers: { location: "https://other.invalid" },
      }),
    ]) {
      const f = fixture({ CANARY_API_KEY: "private-canary-credential" });
      const send = vi.fn(async () => result);
      await runMonitor(f.env, send as typeof fetch, f.emit);
      expect(send).toHaveBeenCalledTimes(1);
      expect(f.store.ops.get("canary_failures")).toBe("1");
      expect(JSON.stringify(f.events)).not.toMatch(/private|other\.invalid/);
    }
  });

  it("aborts a stalled response read and records a controlled failure", async () => {
    const f = fixture({ CANARY_API_KEY: "synthetic" });
    vi.spyOn(AbortSignal, "timeout").mockImplementation(() => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 5);
      return controller.signal;
    });
    let cancelled = false;
    const result = new Response(
      new ReadableStream({
        cancel() {
          cancelled = true;
        },
      }),
      { headers: { "content-type": "application/json" } },
    );
    const running = runMonitor(f.env, (async () => result) as typeof fetch, f.emit);
    await vi.advanceTimersByTimeAsync(10);
    await running;
    expect(cancelled).toBe(true);
    expect(f.store.ops.get("canary_failures")).toBe("1");
  });

  it("continues traffic monitoring after invalid canary configuration without sending credentials", async () => {
    const f = fixture({
      CANARY_API_KEY: "private-canary",
      BETTER_AUTH_URL: "https://user:secret@countercheck.example",
    });
    f.store.requests = 20;
    f.store.errors = 1;
    const send = vi.fn();
    await runMonitor(f.env, send as typeof fetch, f.emit);
    expect(send).not.toHaveBeenCalled();
    expect(f.events).toEqual([
      { outcome: "canary_configuration_invalid" },
      { outcome: "alert_elevated_failure_rate" },
    ]);
  });

  it("alerts after three consecutive failures, throttles delivery attempts and exposes no upstream errors", async () => {
    const f = fixture({
      CANARY_API_KEY: "private-canary",
      ALERT_WEBHOOK_URL: "https://alerts.example/hook?secret=private-webhook",
    });
    const send = vi.fn(async (url: unknown, options?: RequestInit) => {
      if (String(url).includes("/v1/check"))
        return new Response("private upstream text", { status: 503 });
      expect(options?.redirect).toBe("manual");
      expect(options?.headers).toEqual({ "content-type": "application/json" });
      expect(JSON.parse(options!.body as string)).toEqual({
        service: "countercheck",
        event: "canary_failed",
        time: new Date().toISOString(),
      });
      throw new Error("private webhook failure details");
    });
    for (let i = 0; i < 4; i++) await runMonitor(f.env, send as typeof fetch, f.emit);
    expect(send.mock.calls.filter(([url]) => !String(url).includes("/v1/check"))).toHaveLength(1);
    expect(f.events.filter((e) => e.outcome === "alert_delivery_failed")).toHaveLength(1);
    expect(f.store.ops.get("canary_failures")).toBe("4");
    expect(JSON.stringify(f.events)).not.toMatch(/private|secret|Starter|alerts\.example/);
  });

  it("rejects insecure alert URLs, handles corrupt failure counts, and fails safely when D1 is unavailable", async () => {
    const f = fixture({ CANARY_API_KEY: "synthetic", ALERT_WEBHOOK_URL: "http://alerts.example" });
    f.store.ops.set("canary_failures", "-20");
    await runMonitor(
      f.env,
      (async () => new Response(null, { status: 500 })) as typeof fetch,
      f.emit,
    );
    expect(f.store.ops.get("canary_failures")).toBe("1");
    f.store.ops.delete("retention_last_success");
    delete f.env.CANARY_API_KEY;
    const send = vi.fn();
    await runMonitor(f.env, send as typeof fetch, f.emit);
    expect(send).not.toHaveBeenCalled();
    expect(f.events).toContainEqual({ outcome: "alert_configuration_invalid" });
    f.store.broken = true;
    await expect(runMonitor(f.env, send as typeof fetch, f.emit)).rejects.toThrow(
      "Operational monitoring failed.",
    );
    expect(f.events.at(-1)).toEqual({ outcome: "monitor_failed" });
    expect(JSON.stringify(f.events)).not.toContain("private database");
  });
});
