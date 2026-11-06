import { describe, expect, it } from "vitest";
import {
  ADMISSION_LIMITS,
  AdmissionCoordinator,
  admissionReply,
  getAdmissionService,
  type AdmissionNamespace,
  type AdmissionRepository,
  type AdmissionRpc,
  type AdmissionState,
  type AdmissionTransaction,
  type AdmitInput,
  type Reservation,
} from "../src/control/admission.js";
import { ServiceError } from "../src/contracts/errors.js";

const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
class MemoryRepository implements AdmissionRepository {
  state: AdmissionState | undefined;
  reservations = new Map<string, Reservation>();
  failCommit = false;
  transaction<T>(operation: (transaction: AdmissionTransaction) => T): T {
    let state = structuredClone(this.state);
    const reservations = structuredClone(this.reservations);
    const result = operation({
      getState: () => structuredClone(state),
      putState: (value) => {
        state = structuredClone(value);
      },
      getReservation: (id) => structuredClone(reservations.get(id)),
      findRequest: (id) =>
        structuredClone([...reservations.values()].find((r) => r.requestId === id)),
      putReservation: (value) => {
        reservations.set(value.reservationId, structuredClone(value));
      },
      pruneReservations: (oldest) => {
        for (const [id, r] of reservations) if (r.day < oldest) reservations.delete(id);
      },
    });
    if (this.failCommit) throw new Error("Synthetic storage failure; private details");
    this.state = state;
    this.reservations = reservations;
    return result;
  }
}
function fixture() {
  const repo = new MemoryRepository();
  let now = Date.parse("2026-11-04T12:00:00Z"),
    next = 1,
    reservation = 10000;
  const coordinator = new AdmissionCoordinator(
    repo,
    () => now,
    () => uuid(reservation++),
  );
  const input = (overrides: Partial<AdmitInput> = {}): AdmitInput => ({
    tenantId: "tenant_a",
    keyId: "key_a",
    requestId: uuid(next++),
    comparisons: 1,
    compiledBytes: 1200,
    profile: "balanced-v1",
    channel: "api",
    ...overrides,
  });
  const finish = (id: string) =>
    coordinator.complete({
      reservationId: id,
      outcome: "completed",
      inputTokens: 100,
      durationMs: 5,
    });
  coordinator.enroll({ tenantId: "tenant_a" });
  return {
    repo,
    coordinator,
    input,
    finish,
    advance: (ms: number) => {
      now += ms;
    },
    setNow: (ms: number) => {
      now = ms;
    },
  };
}
function status(operation: () => unknown, code: string, expectedStatus: number) {
  expect(operation).toThrowError(expect.objectContaining({ code, status: expectedStatus }));
}

describe("authoritative beta reservation ledger", () => {
  it("enrolls exactly ten tenants atomically and idempotently without evicting paused tenants", () => {
    const f = fixture();
    for (let i = 1; i < 10; i++) f.coordinator.enroll({ tenantId: `tenant_${i}` });
    f.coordinator.setTenant({ tenantId: "tenant_a", paused: true });
    f.coordinator.setTenant({ tenantId: "tenant_a" });
    expect(f.coordinator.enroll({ tenantId: "tenant_a" })).toEqual({ enrolled: true });
    expect(f.coordinator.getGlobalUsage().enrolledTenants).toBe(10);
    status(() => f.coordinator.enroll({ tenantId: "eleventh" }), "beta_full", 429);
    expect(f.coordinator.getUsage("tenant_a").paused).toBe(true);
    status(() => f.coordinator.admit(f.input({ tenantId: "unknown" })), "tenant_not_enrolled", 403);
  });

  it("uses one rolling-minute rate across keys and API/dashboard channels", () => {
    const f = fixture();
    for (let i = 0; i < 10; i++)
      f.finish(
        f.coordinator.admit(f.input({ keyId: `key_${i}`, channel: i % 2 ? "api" : "dashboard" }))
          .reservationId,
      );
    status(() => f.coordinator.admit(f.input()), "tenant_rate_limited", 429);
    expect(f.coordinator.getUsage("tenant_a").today.attempts).toBe(10);
    f.advance(59999);
    status(() => f.coordinator.admit(f.input()), "tenant_rate_limited", 429);
    f.advance(1);
    expect(f.coordinator.admit(f.input()).reservationId).toBeTruthy();
    expect(f.coordinator.getUsage("tenant_a").today.attempts).toBe(11);
  });

  it("enforces two tenant and four global leases and releases settled completions", () => {
    const f = fixture();
    f.coordinator.enroll({ tenantId: "tenant_b" });
    f.coordinator.enroll({ tenantId: "tenant_c" });
    const a = f.coordinator.admit(f.input());
    f.coordinator.admit(f.input({ keyId: "different", channel: "dashboard" }));
    status(() => f.coordinator.admit(f.input()), "inflight_limit", 429);
    f.coordinator.admit(f.input({ tenantId: "tenant_b" }));
    f.coordinator.admit(f.input({ tenantId: "tenant_b" }));
    status(() => f.coordinator.admit(f.input({ tenantId: "tenant_c" })), "inflight_limit", 429);
    expect(f.coordinator.getGlobalUsage().today.attempts).toBe(4);
    f.finish(a.reservationId);
    f.coordinator.admit(f.input({ tenantId: "tenant_c" }));
    expect(f.coordinator.getGlobalUsage().inflight).toBe(4);
  });

  it.each(["failed", "timeout", "aborted"] as const)(
    "retains conservative leases for %s without refunding attempts or comparisons",
    (outcome) => {
      const f = fixture();
      const first = f.coordinator.admit(f.input({ comparisons: 20 }));
      f.coordinator.complete({ ...first, outcome, inputTokens: null, durationMs: 2500 });
      f.coordinator.admit(f.input()); // Simulated crash: no completion arrives.
      status(() => f.coordinator.admit(f.input()), "inflight_limit", 429);
      f.advance(ADMISSION_LIMITS.leaseMs);
      const usage = f.coordinator.getUsage("tenant_a");
      expect(usage.inflight).toBe(0);
      expect(usage.today).toMatchObject({
        attempts: 2,
        comparisons: 21,
        pending: 1,
        unknownInputTokenAttempts: 2,
        [outcome]: 1,
      });
      f.coordinator.admit(f.input());
      expect(f.coordinator.getUsage("tenant_a").today.attempts).toBe(3);
    },
  );

  it("releases an explicitly settled provider failure and applies completion at most once", () => {
    const f = fixture();
    const r = f.coordinator.admit(f.input());
    f.coordinator.complete({
      ...r,
      outcome: "failed",
      providerSettled: true,
      inputTokens: 0,
      durationMs: 1.5,
    });
    f.coordinator.complete({ ...r, outcome: "completed", inputTokens: 999, durationMs: 1000 });
    expect(f.coordinator.getUsage("tenant_a")).toMatchObject({
      inflight: 0,
      today: {
        attempts: 1,
        failed: 1,
        completed: 0,
        pending: 0,
        knownInputTokens: 0,
        unknownInputTokenAttempts: 0,
        totalDurationMs: 1.5,
      },
    });
  });

  it.each([
    ["tenant attempts", "tenant", "attempts", 1000],
    ["global attempts", "global", "attempts", 10000],
    ["tenant comparisons", "tenant", "comparisons", 10000],
    ["global comparisons", "global", "comparisons", 100000],
  ] as const)(
    "enforces the exact %s boundary before inference",
    (_label, scope, field, maximum) => {
      const f = fixture();
      f.finish(f.coordinator.admit(f.input()).reservationId);
      const day = f.repo.state!.days["2026-11-04"]!;
      const counter = scope === "global" ? day.global : day.tenants.tenant_a!;
      counter[field] = maximum - 1;
      const final = f.coordinator.admit(f.input());
      f.finish(final.reservationId);
      status(() => f.coordinator.admit(f.input()), "daily_quota_exceeded", 429);
      const persisted = f.repo.state!.days["2026-11-04"]!;
      expect((scope === "global" ? persisted.global : persisted.tenants.tenant_a!)[field]).toBe(
        maximum,
      );
    },
  );

  it("does not admit a comparison batch that crosses the remaining budget", () => {
    const f = fixture();
    f.finish(f.coordinator.admit(f.input()).reservationId);
    f.repo.state!.days["2026-11-04"]!.tenants.tenant_a!.comparisons = 9999;
    status(() => f.coordinator.admit(f.input({ comparisons: 2 })), "daily_quota_exceeded", 429);
    expect(f.coordinator.getUsage("tenant_a").today.comparisons).toBe(9999);
  });

  it("charges the admission UTC date when completion crosses midnight", () => {
    const f = fixture();
    f.setNow(Date.parse("2026-11-04T23:59:59Z"));
    const r = f.coordinator.admit(f.input());
    f.advance(2000);
    f.finish(r.reservationId);
    const usage = f.coordinator.getUsage("tenant_a");
    expect(usage.today.attempts).toBe(0);
    expect(usage.history[1]).toMatchObject({
      day: "2026-11-04",
      attempts: 1,
      completed: 1,
      knownInputTokens: 100,
    });
    f.coordinator.admit(f.input());
    expect(f.coordinator.getUsage("tenant_a").today.attempts).toBe(1);
  });

  it("retains exactly thirty dates and prunes old reservation metadata without quota refunds", () => {
    const f = fixture();
    const initial = f.coordinator.admit(f.input());
    f.finish(initial.reservationId);
    for (let day = 0; day < 30; day++) {
      f.advance(86400000);
      f.finish(f.coordinator.admit(f.input()).reservationId);
    }
    const usage = f.coordinator.getUsage("tenant_a");
    expect(usage.history).toHaveLength(30);
    expect(usage.history.every((d) => d.attempts === 1)).toBe(true);
    expect(f.repo.reservations.has(initial.reservationId)).toBe(false);
    expect(Object.keys(f.repo.state!.days)).toHaveLength(30);
  });

  it("does not reset admission windows or days when the clock moves backwards", () => {
    const f = fixture();
    for (let i = 0; i < 10; i++) f.finish(f.coordinator.admit(f.input()).reservationId);
    f.advance(-86400000);
    status(() => f.coordinator.admit(f.input()), "tenant_rate_limited", 429);
    expect(f.coordinator.getUsage("tenant_a").day).toBe("2026-11-04");
  });

  it("rejects duplicate request UUIDs, including after completion and from other tenants", () => {
    const f = fixture();
    const request = f.input();
    f.finish(f.coordinator.admit(request).reservationId);
    status(() => f.coordinator.admit(request), "duplicate_request", 409);
    f.coordinator.enroll({ tenantId: "tenant_b" });
    status(
      () => f.coordinator.admit({ ...request, tenantId: "tenant_b" }),
      "duplicate_request",
      409,
    );
    expect(f.coordinator.getGlobalUsage().today.attempts).toBe(1);
  });

  it("pauses admission without destroying usage or silently enrolling a legacy key", () => {
    const f = fixture();
    f.coordinator.setGlobalPause({ paused: true });
    status(() => f.coordinator.admit(f.input()), "admission_paused", 503);
    expect(f.coordinator.getUsage("tenant_a").globalPaused).toBe(true);
    f.coordinator.setGlobalPause({ paused: false });
    f.coordinator.setTenant({ tenantId: "tenant_a", paused: true });
    status(() => f.coordinator.admit(f.input()), "admission_paused", 503);
    status(
      () => f.coordinator.setTenant({ tenantId: "legacy", paused: false }),
      "tenant_not_enrolled",
      403,
    );
  });

  it("rolls back quota and reservation together when persistence fails", () => {
    const f = fixture();
    f.repo.failCommit = true;
    expect(admissionReply(() => f.coordinator.admit(f.input()))).toMatchObject({
      ok: false,
      error: { status: 503, code: "admission_unavailable" },
    });
    f.repo.failCommit = false;
    expect(f.coordinator.getUsage("tenant_a").today.attempts).toBe(0);
    expect(f.repo.reservations.size).toBe(0);
  });

  it("accepts only content-free metadata and never exposes key/request IDs in usage", () => {
    const f = fixture();
    for (const input of [
      f.input({ comparisons: 0 }),
      f.input({ compiledBytes: 16385 }),
      { ...f.input(), claim: "private customer text" },
    ])
      status(() => f.coordinator.admit(input as AdmitInput), "invalid_admission", 400);
    f.coordinator.admit(f.input({ keyId: "private_key_id", requestId: uuid(777) }));
    const usage = JSON.stringify(f.coordinator.getGlobalUsage());
    expect(usage).not.toContain("private_key_id");
    expect(usage).not.toContain(uuid(777));
    f.repo.state!.version = 2 as 1;
    expect(admissionReply(() => f.coordinator.getUsage("tenant_a"))).toMatchObject({
      ok: false,
      error: { code: "admission_unavailable" },
    });
  });
});

describe("safe admission RPC client", () => {
  it("fails closed when a binding is absent or RPC fails, without forwarding private errors", async () => {
    await expect(getAdmissionService({}).getUsage("tenant_a")).rejects.toMatchObject({
      status: 503,
      code: "admission_unavailable",
    });
    const namespace = {
      idFromName: () => {
        throw new Error("private infrastructure details");
      },
      get: () => ({}),
    } as unknown as AdmissionNamespace;
    await expect(
      getAdmissionService({ ADMISSION: namespace }).getUsage("tenant_a"),
    ).rejects.toThrow("Request admission is temporarily unavailable.");
  });
  it("uses the singleton and reconstructs retry metadata across serialized replies", async () => {
    const rpc = {
      getUsage: async () =>
        JSON.parse(
          JSON.stringify(
            admissionReply(() => {
              throw new ServiceError(
                429,
                "inflight_limit",
                "Concurrent request capacity is currently full.",
                true,
                60,
              );
            }),
          ),
        ),
    } as unknown as AdmissionRpc;
    const namespace = {
      idFromName: (name: string) => {
        expect(name).toBe("global-v1");
        return "opaque";
      },
      get: (id: string) => {
        expect(id).toBe("opaque");
        return rpc;
      },
    } as unknown as AdmissionNamespace;
    await expect(
      getAdmissionService({ ADMISSION: namespace }).getUsage("tenant_a"),
    ).rejects.toMatchObject({ status: 429, retryAfter: 60, retryable: true });
  });
});
