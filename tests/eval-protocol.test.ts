import { describe, expect, it, vi } from "vitest";
import { evaluationTiming, measurementProtocol, packingProtocol } from "../eval/protocol.js";
import { runPairs, makeRequest } from "../eval/backends.js";
import { evaluateCheck } from "../src/kernel/index.js";
import type { Pair } from "../eval/types.js";
import type { DecisionProvider } from "../src/providers/types.js";

const pair = (id: string): Pair => ({
  id,
  dataset: "synthetic-smoke",
  variant: "protocol-fixture",
  split: "synthetic",
  source_id: id,
  group_id: id,
  claim: "A",
  evidence: "B",
  gold: "non_contradiction",
  native_label: "fixture",
});
const provider: DecisionProvider = {
  id: "local-fixture",
  model: "local-fixture",
  async classify(payload) {
    return {
      answers: Object.fromEntries(
        Object.keys(payload.questions).map((id) => [
          id,
          {
            type: "choice",
            probabilities: {
              contradiction: 0,
              consistent: 1,
              different_scope: 0,
              insufficient_context: 0,
            },
          },
        ]),
      ),
    };
  },
};

describe("explicit measurement and packing protocol", () => {
  it("keeps public development and locked tests distinct without asserting production qualification", () => {
    expect(measurementProtocol("development")).toEqual({
      public_dataset: true,
      measurement_stage: "public_development",
      production_qualification: "not_assessed",
    });
    expect(measurementProtocol("locked-test")).toEqual({
      public_dataset: true,
      measurement_stage: "public_locked_test",
      production_qualification: "not_assessed",
    });
    expect(measurementProtocol("synthetic-smoke").public_dataset).toBe(false);
  });
  it("declares whole-batch envelope stress instead of silently repacking individually valid pairs", async () => {
    const classify = vi.spyOn(provider, "classify");
    try {
      const valid = pair("good");
      const oversized = { ...pair("oversized"), evidence: "x".repeat(2049) };
      const rows = await runPairs([valid, oversized], {
        pass: 1,
        timeoutMs: 100,
        presentation: "original",
        provider,
      });
      expect(rows).toHaveLength(2);
      expect(
        rows.every(
          (row) => row.status === "excluded" && row.error_code === "service_input_envelope",
        ),
      ).toBe(true);
      expect(classify).not.toHaveBeenCalled();
      expect(
        (
          await runPairs([valid], { pass: 1, timeoutMs: 100, presentation: "original", provider })
        )[0]?.status,
      ).toBe("ok");
      expect(packingProtocol("jev", 2)).toMatchObject({
        assessment: "atomic_batch_envelope_stress",
        envelope_failure: "exclude_entire_submitted_batch",
        automatic_repacking: false,
      });
      expect(packingProtocol("replay", 1)).toMatchObject({
        assessment: "recorded_predictions",
        envelope_failure: "as_recorded",
      });
    } finally {
      classify.mockRestore();
    }
  });
});

describe("route-specific evaluation deadlines", () => {
  it("allows server body plus application budgets and network margin, while preserving explicit stress overrides", () => {
    expect(evaluationTiming("service")).toMatchObject({
      timeout_ms: 6000,
      timeout_policy: "route_default",
      timeout_scope: "client_upload_network_and_server_total",
      service_deadline_budgets: {
        body_read_ms: 2000,
        application_ms: 3000,
        provider_within_application_ms: 2500,
        default_network_margin_ms: 1000,
      },
    });
    expect(evaluationTiming("jev").timeout_ms).toBe(3000);
    expect(evaluationTiming("service", "3000")).toMatchObject({
      timeout_ms: 3000,
      timeout_policy: "operator_override",
    });
    expect(evaluationTiming("replay").timeout_scope).toBe("not_applied_replay");
    expect(evaluationTiming("replay").timeout_ms).toBeNull();
    expect(evaluationTiming("jev").production_deadline_equivalence).toBe(
      "not_equivalent_provider_has_kernel_budget",
    );
    expect(() => evaluationTiming("service", "0")).toThrow();
  });
  it.each([undefined, "3000"])(
    "waits for a 4.5-second valid service response only when the selected budget permits (%s)",
    async (override) => {
      const p = pair("timed");
      const response = await evaluateCheck(makeRequest(p), provider, {
        requestId: "req_local_timed_fixture",
        signal: new AbortController().signal,
      });
      vi.useFakeTimers();
      vi.stubGlobal(
        "fetch",
        vi.fn<typeof fetch>(async () => {
          await new Promise<void>((resolve) => setTimeout(resolve, 4500));
          return Response.json(response);
        }),
      );
      try {
        const pending = runPairs([p], {
          pass: 1,
          timeoutMs: evaluationTiming("service", override).timeout_ms!,
          presentation: "original",
          serviceUrl: "https://example.invalid",
          serviceKey: "local-fixture-key",
        });
        await vi.advanceTimersByTimeAsync(4500);
        const [row] = await pending;
        expect(row?.status).toBe(override === undefined ? "ok" : "error");
        if (row?.status === "error") expect(row.error_code).toBe("deadline_exceeded");
      } finally {
        vi.clearAllTimers();
        vi.unstubAllGlobals();
        vi.useRealTimers();
      }
    },
  );
});
