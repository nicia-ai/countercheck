import { DurableObject } from "cloudflare:workers";
import {
  AdmissionCoordinator,
  admissionReply,
  admissionUnavailable,
  type AdmissionReply,
  type AdmissionRepository,
  type AdmissionState,
  type AdmitInput,
  type CompleteInput,
  type Reservation,
  type SetTenantInput,
} from "./admission.js";

/** One named instance owns every beta tenant. No public fetch/admin surface. */
export class AdmissionDO extends DurableObject<unknown> {
  private readonly coordinator: AdmissionCoordinator;

  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env);
    const sql = ctx.storage.sql;
    sql.exec(
      "CREATE TABLE IF NOT EXISTS admission_state (singleton INTEGER PRIMARY KEY CHECK (singleton = 1), payload TEXT NOT NULL)",
    );
    sql.exec(
      "CREATE TABLE IF NOT EXISTS admission_reservations (id TEXT PRIMARY KEY, request_id TEXT NOT NULL UNIQUE, day TEXT NOT NULL, payload TEXT NOT NULL)",
    );
    sql.exec("CREATE INDEX IF NOT EXISTS admission_reservation_day ON admission_reservations(day)");
    function reservation(query: string, id: string): Reservation | undefined {
      const row = sql.exec<{ payload: string }>(query, id).toArray()[0];
      return row ? (JSON.parse(row.payload) as Reservation) : undefined;
    }
    const repository: AdmissionRepository = {
      transaction: (operation) =>
        ctx.storage.transactionSync(() =>
          operation({
            getState: () => {
              const row = sql
                .exec<{ payload: string }>(
                  "SELECT payload FROM admission_state WHERE singleton = 1",
                )
                .toArray()[0];
              return row ? (JSON.parse(row.payload) as AdmissionState) : undefined;
            },
            putState: (state) => {
              sql.exec(
                "INSERT INTO admission_state(singleton,payload) VALUES (1,?) ON CONFLICT(singleton) DO UPDATE SET payload=excluded.payload",
                JSON.stringify(state),
              );
            },
            findRequest: (id) =>
              reservation("SELECT payload FROM admission_reservations WHERE request_id = ?", id),
            getReservation: (id) =>
              reservation("SELECT payload FROM admission_reservations WHERE id = ?", id),
            putReservation: (value) => {
              sql.exec(
                "INSERT INTO admission_reservations(id,request_id,day,payload) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload",
                value.reservationId,
                value.requestId,
                value.day,
                JSON.stringify(value),
              );
            },
            pruneReservations: (oldest) => {
              sql.exec("DELETE FROM admission_reservations WHERE day < ?", oldest);
            },
          }),
        ),
    };
    this.coordinator = new AdmissionCoordinator(repository);
  }

  private async execute<T>(operation: () => T): Promise<AdmissionReply<T>> {
    const reply = admissionReply(operation);
    if (!reply.ok) return reply;
    try {
      await this.ctx.storage.setAlarm((Math.floor(Date.now() / 86400000) + 1) * 86400000);
      return reply;
    } catch {
      return admissionReply(() => {
        throw admissionUnavailable();
      });
    }
  }

  async enroll(input: { tenantId: string }) {
    return this.execute(() => this.coordinator.enroll(input));
  }
  async admit(input: AdmitInput) {
    return this.execute(() => this.coordinator.admit(input));
  }
  async complete(input: CompleteInput) {
    return this.execute(() => this.coordinator.complete(input));
  }
  async getUsage(tenantId: string) {
    return this.execute(() => this.coordinator.getUsage(tenantId));
  }
  async getGlobalUsage() {
    return this.execute(() => this.coordinator.getGlobalUsage());
  }
  async setTenant(input: SetTenantInput) {
    return this.execute(() => this.coordinator.setTenant(input));
  }
  async setGlobalPause(input: { paused: boolean }) {
    return this.execute(() => this.coordinator.setGlobalPause(input));
  }
  async alarm() {
    const result = await this.execute(() => this.coordinator.prune());
    if (!result.ok) throw admissionUnavailable();
  }
}
