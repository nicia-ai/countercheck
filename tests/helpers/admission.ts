import { vi } from "vitest";
import {
  AdmissionCoordinator,
  type AdmissionRepository,
  type AdmissionService,
  type AdmissionState,
  type AdmissionTransaction,
  type Reservation,
} from "../../src/control/admission.js";

/** Test storage for the real quota state machine; never imported by production. */
export function testAdmission(tenantIds: string[] = []) {
  let state: AdmissionState | undefined;
  const reservations = new Map<string, Reservation>();
  const repository: AdmissionRepository = {
    transaction<T>(operation: (transaction: AdmissionTransaction) => T): T {
      let pendingState = structuredClone(state);
      const pendingReservations = structuredClone(reservations);
      const result = operation({
        getState: () => structuredClone(pendingState),
        putState: (value) => {
          pendingState = structuredClone(value);
        },
        findRequest: (id) =>
          structuredClone([...pendingReservations.values()].find((r) => r.requestId === id)),
        getReservation: (id) => structuredClone(pendingReservations.get(id)),
        putReservation: (r) => {
          pendingReservations.set(r.reservationId, structuredClone(r));
        },
        pruneReservations: (oldest) => {
          for (const [id, r] of pendingReservations)
            if (r.day < oldest) pendingReservations.delete(id);
        },
      });
      state = pendingState;
      reservations.clear();
      for (const [id, r] of pendingReservations) reservations.set(id, r);
      return result;
    },
  };
  const coordinator = new AdmissionCoordinator(
    repository,
    () => Date.now(),
    () => crypto.randomUUID(),
  );
  for (const tenantId of tenantIds) coordinator.enroll({ tenantId });
  const service = {
    enroll: vi.fn(async (input) => coordinator.enroll(input)),
    admit: vi.fn(async (input) => coordinator.admit(input)),
    complete: vi.fn(async (input) => coordinator.complete(input)),
    getUsage: vi.fn(async (id) => coordinator.getUsage(id)),
    getGlobalUsage: vi.fn(async () => coordinator.getGlobalUsage()),
    setTenant: vi.fn(async (input) => coordinator.setTenant(input)),
    setGlobalPause: vi.fn(async (input) => coordinator.setGlobalPause(input)),
  } satisfies AdmissionService;
  return { service, coordinator, reservations };
}
