import { MODEL_ROUTE_IDS } from "../contracts/models.js";
import { z } from "zod";
import type { DurableObjectId } from "@cloudflare/workers-types";
import { profileSchema } from "../contracts/index.js";
import { ServiceError } from "../contracts/errors.js";

export const ADMISSION_LIMITS = {
  maxTenants: 10,
  requestsPerMinute: 10,
  tenantInflight: 2,
  globalInflight: 4,
  tenantAttemptsPerDay: 1000,
  globalAttemptsPerDay: 10000,
  tenantComparisonsPerDay: 10000,
  globalComparisonsPerDay: 100000,
  leaseMs: 60000,
  retainedDays: 30,
} as const;
export type AdmissionLimits = typeof ADMISSION_LIMITS;
const DAY = 86400000;
const identity = z.string().regex(/^[A-Za-z0-9_.:-]{1,128}$/);
const daySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const count = z.number().int().nonnegative().safe();
const outcomeSchema = z.enum(["completed", "failed", "timeout", "aborted"]);
const admitSchema = z.strictObject({
  tenantId: identity,
  keyId: identity,
  requestId: z.string().uuid(),
  comparisons: z.number().int().min(1).max(20),
  compiledBytes: z.number().int().min(1).max(16384),
  profile: profileSchema,
  channel: z.enum(["api", "dashboard"]),
  route: z.enum(MODEL_ROUTE_IDS).default("jev"),
  release: z
    .string()
    .regex(/^[A-Za-z0-9_.:-]{1,128}$/)
    .default("countercheck-evaluation-v1"),
});
export type AdmitInput = z.input<typeof admitSchema>;
const completeSchema = z.strictObject({
  reservationId: z.string().uuid(),
  outcome: outcomeSchema,
  inputTokens: z.number().int().nonnegative().max(1_000_000_000).nullable(),
  durationMs: z.number().finite().min(0).max(3600000),
  providerSettled: z.boolean().optional(),
});
export type CompleteInput = z.infer<typeof completeSchema>;
export type SetTenantInput = { tenantId: string; paused?: boolean };

const dailySchema = z.strictObject({
  day: daySchema,
  attempts: count,
  comparisons: count,
  completed: count,
  failed: count,
  timeout: count,
  aborted: count,
  pending: count,
  knownInputTokens: count,
  unknownInputTokenAttempts: count,
  totalDurationMs: z.number().finite().nonnegative(),
});
export type DailyUsage = z.infer<typeof dailySchema>;
const tenantSchema = z.strictObject({
  paused: z.boolean(),
  enrolledAt: count,
  starts: z.array(count).max(10),
});
export const admissionStateSchema = z.strictObject({
  version: z.literal(1),
  paused: z.boolean(),
  lastNow: count,
  tenants: z.record(identity, tenantSchema),
  days: z.record(
    daySchema,
    z.strictObject({ global: dailySchema, tenants: z.record(identity, dailySchema) }),
  ),
  active: z.record(z.string().uuid(), z.strictObject({ tenantId: identity, expiresAt: count })),
});
export type AdmissionState = z.infer<typeof admissionStateSchema>;
export type Reservation = z.output<typeof admitSchema> & {
  reservationId: string;
  day: string;
  admittedAt: number;
  leaseExpiresAt: number;
  completion?: CompleteInput;
};
export interface AdmissionTransaction {
  getState(): AdmissionState | undefined;
  putState(state: AdmissionState): void;
  findRequest(requestId: string): Reservation | undefined;
  getReservation(reservationId: string): Reservation | undefined;
  putReservation(reservation: Reservation): void;
  pruneReservations(oldestDay: string): void;
}
export interface AdmissionRepository {
  transaction<T>(operation: (transaction: AdmissionTransaction) => T): T;
}
export type UsageSnapshot = {
  tenantId: string;
  day: string;
  paused: boolean;
  globalPaused: boolean;
  limits: AdmissionLimits;
  today: DailyUsage;
  inflight: number;
  history: DailyUsage[];
};
export type GlobalUsageSnapshot = {
  day: string;
  paused: boolean;
  limits: AdmissionLimits;
  enrolledTenants: number;
  today: DailyUsage;
  inflight: number;
  history: DailyUsage[];
  tenants: UsageSnapshot[];
};
export interface AdmissionService {
  admit(input: AdmitInput): Promise<{ reservationId: string }>;
  complete(input: CompleteInput): Promise<void>;
  enroll(input: { tenantId: string }): Promise<{ enrolled: true }>;
  getUsage(tenantId: string): Promise<UsageSnapshot>;
  getGlobalUsage(): Promise<GlobalUsageSnapshot>;
  setTenant(input: SetTenantInput): Promise<void>;
  setGlobalPause(input: { paused: boolean }): Promise<void>;
}
export type AdmissionReply<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      error: {
        status: number;
        code: string;
        message: string;
        retryable: boolean;
        retryAfter?: number;
      };
    };
export type AdmissionRpc = {
  [K in keyof AdmissionService]: (
    ...args: Parameters<AdmissionService[K]>
  ) => Promise<AdmissionReply<Awaited<ReturnType<AdmissionService[K]>>>>;
};
export interface AdmissionNamespace {
  idFromName(name: string): DurableObjectId;
  get(id: DurableObjectId): AdmissionRpc;
}
export const admissionUnavailable = () =>
  new ServiceError(
    503,
    "admission_unavailable",
    "Request admission is temporarily unavailable.",
    true,
  );

/** RPC serializes this safe envelope, rather than relying on custom Error properties. */
export function admissionReply<T>(operation: () => T): AdmissionReply<T> {
  try {
    return { ok: true, value: operation() };
  } catch (error) {
    const safe = error instanceof ServiceError ? error : admissionUnavailable();
    return {
      ok: false,
      error: {
        status: safe.status,
        code: safe.code,
        message: safe.message,
        retryable: safe.retryable,
        ...(safe.retryAfter !== undefined && { retryAfter: safe.retryAfter }),
      },
    };
  }
}

export function getAdmissionService(env: { ADMISSION?: AdmissionNamespace }): AdmissionService {
  async function invoke<T>(
    operation: (rpc: AdmissionRpc) => Promise<AdmissionReply<T>>,
  ): Promise<T> {
    try {
      if (!env.ADMISSION) throw admissionUnavailable();
      const reply = await operation(env.ADMISSION.get(env.ADMISSION.idFromName("global-v1")));
      if (!reply.ok)
        throw new ServiceError(
          reply.error.status,
          reply.error.code,
          reply.error.message,
          reply.error.retryable,
          reply.error.retryAfter,
        );
      return reply.value;
    } catch (error) {
      if (error instanceof ServiceError) throw error;
      throw admissionUnavailable();
    }
  }
  return {
    admit: (input) => invoke((rpc) => rpc.admit(input)),
    complete: (input) => invoke((rpc) => rpc.complete(input)),
    enroll: (input) => invoke((rpc) => rpc.enroll(input)),
    getUsage: (tenantId) => invoke((rpc) => rpc.getUsage(tenantId)),
    getGlobalUsage: () => invoke((rpc) => rpc.getGlobalUsage()),
    setTenant: (input) => invoke((rpc) => rpc.setTenant(input)),
    setGlobalPause: (input) => invoke((rpc) => rpc.setGlobalPause(input)),
  };
}

const dayAt = (now: number) => new Date(now).toISOString().slice(0, 10);
const emptyDaily = (day: string): DailyUsage => ({
  day,
  attempts: 0,
  comparisons: 0,
  completed: 0,
  failed: 0,
  timeout: 0,
  aborted: 0,
  pending: 0,
  knownInputTokens: 0,
  unknownInputTokenAttempts: 0,
  totalDurationMs: 0,
});
const emptyState = (): AdmissionState => ({
  version: 1,
  paused: false,
  lastNow: 0,
  tenants: {},
  days: {},
  active: {},
});
function parsed<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success)
    throw new ServiceError(400, "invalid_admission", "Invalid request admission metadata.");
  return result.data;
}
function tenant(state: AdmissionState, id: string) {
  if (!Object.hasOwn(state.tenants, id))
    throw new ServiceError(403, "tenant_not_enrolled", "This account is not enrolled in the beta.");
  return state.tenants[id]!;
}

/** Transactional business logic; the repository must commit all writes atomically or roll back. */
export class AdmissionCoordinator {
  constructor(
    private readonly repository: AdmissionRepository,
    private readonly clock = Date.now,
    private readonly uuid: () => string = () => crypto.randomUUID(),
  ) {}

  private run<T>(
    operation: (state: AdmissionState, transaction: AdmissionTransaction, now: number) => T,
  ): T {
    return this.repository.transaction((transaction) => {
      const raw = transaction.getState();
      const state = raw === undefined ? emptyState() : admissionStateSchema.parse(raw);
      const now = Math.max(state.lastNow, this.clock());
      if (!Number.isSafeInteger(now) || now < 0 || now > 8640000000000000)
        throw admissionUnavailable();
      state.lastNow = now;
      const oldest = dayAt(now - (ADMISSION_LIMITS.retainedDays - 1) * DAY);
      for (const day of Object.keys(state.days)) if (day < oldest) delete state.days[day];
      for (const [id, lease] of Object.entries(state.active))
        if (lease.expiresAt <= now) delete state.active[id];
      for (const entry of Object.values(state.tenants))
        entry.starts = entry.starts.filter((start) => start > now - 60000);
      transaction.pruneReservations(oldest);
      const value = operation(state, transaction, now);
      transaction.putState(state);
      return value;
    });
  }

  enroll(input: { tenantId: string }): { enrolled: true } {
    const { tenantId } = parsed(z.strictObject({ tenantId: identity }), input);
    return this.run((state, _transaction, now) => {
      if (!Object.hasOwn(state.tenants, tenantId)) {
        if (Object.keys(state.tenants).length >= ADMISSION_LIMITS.maxTenants)
          throw new ServiceError(
            429,
            "beta_full",
            "The beta is currently at capacity.",
            true,
            86400,
          );
        state.tenants[tenantId] = { paused: false, enrolledAt: now, starts: [] };
      }
      return { enrolled: true };
    });
  }

  admit(input: AdmitInput): { reservationId: string } {
    const request = parsed(admitSchema, input);
    return this.run((state, transaction, now) => {
      const entry = tenant(state, request.tenantId);
      if (state.paused || entry.paused)
        throw new ServiceError(
          503,
          "admission_paused",
          "Request admission is temporarily paused.",
          true,
          60,
        );
      if (transaction.findRequest(request.requestId))
        throw new ServiceError(409, "duplicate_request", "This request was already reserved.");
      const day = dayAt(now);
      const record = (state.days[day] ??= { global: emptyDaily(day), tenants: {} });
      const own = (record.tenants[request.tenantId] ??= emptyDaily(day));
      const nextDay = Math.ceil((Date.parse(day) + DAY - now) / 1000);
      if (
        own.attempts >= ADMISSION_LIMITS.tenantAttemptsPerDay ||
        record.global.attempts >= ADMISSION_LIMITS.globalAttemptsPerDay ||
        own.comparisons + request.comparisons > ADMISSION_LIMITS.tenantComparisonsPerDay ||
        record.global.comparisons + request.comparisons > ADMISSION_LIMITS.globalComparisonsPerDay
      )
        throw new ServiceError(
          429,
          "daily_quota_exceeded",
          "Daily request budget exhausted.",
          true,
          Math.max(1, nextDay),
        );
      if (entry.starts.length >= ADMISSION_LIMITS.requestsPerMinute)
        throw new ServiceError(
          429,
          "tenant_rate_limited",
          "Account request rate limit exceeded.",
          true,
          Math.max(1, Math.ceil((entry.starts[0]! + 60000 - now) / 1000)),
        );
      const active = Object.values(state.active);
      const ownLeases = active.filter((lease) => lease.tenantId === request.tenantId);
      if (
        ownLeases.length >= ADMISSION_LIMITS.tenantInflight ||
        active.length >= ADMISSION_LIMITS.globalInflight
      ) {
        const blocked = ownLeases.length >= ADMISSION_LIMITS.tenantInflight ? ownLeases : active;
        throw new ServiceError(
          429,
          "inflight_limit",
          "Concurrent request capacity is currently full.",
          true,
          Math.max(
            1,
            Math.ceil((Math.min(...blocked.map((lease) => lease.expiresAt)) - now) / 1000),
          ),
        );
      }
      const reservationId = this.uuid();
      if (
        !z.string().uuid().safeParse(reservationId).success ||
        transaction.getReservation(reservationId)
      )
        throw admissionUnavailable();
      const leaseExpiresAt = now + ADMISSION_LIMITS.leaseMs;
      for (const usage of [own, record.global]) {
        usage.attempts++;
        usage.comparisons += request.comparisons;
        usage.pending++;
        usage.unknownInputTokenAttempts++;
      }
      entry.starts.push(now);
      state.active[reservationId] = { tenantId: request.tenantId, expiresAt: leaseExpiresAt };
      transaction.putReservation({
        ...request,
        reservationId,
        day,
        admittedAt: now,
        leaseExpiresAt,
      });
      return { reservationId };
    });
  }

  complete(input: CompleteInput): void {
    const completion = parsed(completeSchema, input);
    this.run((state, transaction) => {
      const reservation = transaction.getReservation(completion.reservationId);
      if (!reservation)
        throw new ServiceError(404, "reservation_not_found", "Request reservation was not found.");
      if (reservation.completion) return;
      const record = state.days[reservation.day];
      const own = record?.tenants[reservation.tenantId];
      if (!record || !own) throw admissionUnavailable();
      for (const usage of [own, record.global]) {
        usage.pending--;
        usage[completion.outcome]++;
        usage.totalDurationMs += completion.durationMs;
        if (completion.inputTokens !== null) {
          usage.knownInputTokens += completion.inputTokens;
          usage.unknownInputTokenAttempts--;
        }
      }
      reservation.completion = completion;
      transaction.putReservation(reservation);
      // Timeout/abort and unknown failures retain their API lease. Expiry never proves GPU cancellation.
      if (
        completion.outcome === "completed" ||
        (completion.outcome === "failed" && completion.providerSettled === true)
      )
        delete state.active[reservation.reservationId];
    });
  }

  setTenant(input: SetTenantInput): void {
    const request = parsed(
      z.strictObject({ tenantId: identity, paused: z.boolean().optional() }),
      input,
    );
    this.run((state) => {
      const entry = tenant(state, request.tenantId);
      if (request.paused !== undefined) entry.paused = request.paused;
    });
  }
  setGlobalPause(input: { paused: boolean }): void {
    const request = parsed(z.strictObject({ paused: z.boolean() }), input);
    this.run((state) => {
      state.paused = request.paused;
    });
  }
  private usage(state: AdmissionState, tenantId: string, now: number): UsageSnapshot {
    const entry = tenant(state, tenantId);
    const history = Array.from({ length: ADMISSION_LIMITS.retainedDays }, (_, index) => {
      const day = dayAt(now - index * DAY);
      return state.days[day]?.tenants[tenantId] ?? emptyDaily(day);
    });
    return {
      tenantId,
      day: dayAt(now),
      paused: entry.paused,
      globalPaused: state.paused,
      limits: ADMISSION_LIMITS,
      today: history[0]!,
      inflight: Object.values(state.active).filter((lease) => lease.tenantId === tenantId).length,
      history,
    };
  }
  getUsage(tenantId: string): UsageSnapshot {
    const id = parsed(identity, tenantId);
    return this.run((state, _transaction, now) => this.usage(state, id, now));
  }
  getGlobalUsage(): GlobalUsageSnapshot {
    return this.run((state, _transaction, now) => {
      const history = Array.from({ length: ADMISSION_LIMITS.retainedDays }, (_, index) => {
        const day = dayAt(now - index * DAY);
        return state.days[day]?.global ?? emptyDaily(day);
      });
      return {
        day: dayAt(now),
        paused: state.paused,
        limits: ADMISSION_LIMITS,
        enrolledTenants: Object.keys(state.tenants).length,
        today: history[0]!,
        inflight: Object.keys(state.active).length,
        history,
        tenants: Object.keys(state.tenants)
          .sort()
          .map((id) => this.usage(state, id, now)),
      };
    });
  }
  prune(): void {
    this.run(() => undefined);
  }
}
