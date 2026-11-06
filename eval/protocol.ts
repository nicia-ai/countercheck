import { LIMITS } from "../src/contracts/limits.js";
import { positiveInteger } from "./args.js";
import type { Manifest } from "./types.js";

const NETWORK_MARGIN_MS = 1000;

export function evaluationTiming(backend: string, override?: string) {
  const service = backend === "service";
  const defaultMs = service
    ? LIMITS.bodyReadMs + LIMITS.requestMs + NETWORK_MARGIN_MS
    : LIMITS.requestMs;
  return {
    timeout_ms: backend === "replay" ? null : positiveInteger(override, defaultMs, "timeout-ms"),
    timeout_policy:
      backend === "replay"
        ? "not_applied_replay"
        : override === undefined
          ? "route_default"
          : "operator_override",
    timeout_scope:
      backend === "replay"
        ? "not_applied_replay"
        : service
          ? "client_upload_network_and_server_total"
          : "kernel_compilation_and_provider_total",
    transport_route: backend === "replay" ? null : service ? "http_service" : "kernel_to_provider",
    production_deadline_equivalence:
      backend === "replay"
        ? "not_applied_replay"
        : service
          ? "server_enforced"
          : "not_equivalent_provider_has_kernel_budget",
    service_deadline_budgets: service
      ? {
          body_read_ms: LIMITS.bodyReadMs,
          application_ms: LIMITS.requestMs,
          provider_within_application_ms: LIMITS.providerMs,
          default_network_margin_ms: NETWORK_MARGIN_MS,
        }
      : null,
  };
}

export function measurementProtocol(purpose: Manifest["purpose"]) {
  return {
    public_dataset: purpose !== "synthetic-smoke",
    measurement_stage:
      purpose === "development"
        ? "public_development"
        : purpose === "locked-test"
          ? "public_locked_test"
          : "synthetic_smoke",
    production_qualification: "not_assessed",
  };
}

export function packingProtocol(backend: string, batchSize: number) {
  return {
    method: backend === "replay" ? "replay_without_dispatch" : "fixed_identical_claim_groups",
    requested_max_comparisons: backend === "replay" ? null : batchSize,
    assessment:
      backend === "replay"
        ? "recorded_predictions"
        : batchSize === 1
          ? "pair_isolation"
          : "atomic_batch_envelope_stress",
    envelope_failure: backend === "replay" ? "as_recorded" : "exclude_entire_submitted_batch",
    automatic_repacking: false,
  };
}
