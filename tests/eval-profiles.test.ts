import { describe, expect, it } from "vitest";
import { makeRequest, runPairs, fromResponse } from "../eval/backends.js";
import { metrics } from "../eval/metrics.js";
import { evaluateCheck } from "../src/kernel/index.js";
import type { DecisionProvider } from "../src/providers/types.js";
import type { Pair } from "../eval/types.js";

const pair: Pair = {
  id: "profile-probe",
  claim: "The limit is 10 kg.",
  evidence: "The limit is 20 kg.",
  gold: "contradiction",
  group_id: "g",
  dataset: "synthetic-smoke",
  variant: "synthetic-v1",
  source_id: "profile-probe",
  split: "dev",
  native_label: "contradiction",
  source_metadata: {},
};

describe("evaluation profile identity", () => {
  it.each(["semantic-v2", "structured-value-v1"] as const)(
    "dispatches %s through the real kernel in fake smoke",
    async (profile) => {
      const rows = await runPairs([pair], {
        profile,
        fake: true,
        pass: 1,
        timeoutMs: 3000,
        presentation: "original",
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]!.status).toBe("ok");
      expect(rows[0]!.verdict).toBe("uncertain");
      expect(rows[0]!.prompt_version).not.toBe("pair-relation-v1");
    },
  );
  it("counts structured completion without fabricating probabilistic metrics", async () => {
    const [prediction] = await runPairs([pair], {
      profile: "structured-value-v1",
      fake: true,
      pass: 1,
      timeoutMs: 3000,
      presentation: "original",
    });
    const measured = metrics([{ pair, prediction: prediction! }]);
    expect(measured.completion.value).toBe(1);
    expect(measured.uncertainty.value).toBe(1);
    expect(measured.probability_denominator).toBe(0);
    expect(measured.brier).toBeNull();
    expect(measured.forced_binary_at_0_5.recall).toBeNull();
  });
  it("scores a deterministic contradiction without a fabricated probability", async () => {
    const request = makeRequest(pair, [pair], "structured-value-v1");
    const provider: DecisionProvider = {
      id: "fake",
      model: "fake",
      async classify(payload) {
        return {
          answers: Object.fromEntries(
            Object.entries(payload.questions).map(([id, question]) => [
              id,
              {
                type: "choice",
                choice: "p_0_0",
                probabilities: Object.fromEntries(
                  Object.keys(question.criteria).map((label) => [label, label === "p_0_0" ? 1 : 0]),
                ),
              },
            ]),
          ),
        };
      },
    };
    const response = await evaluateCheck(request, provider, {
      requestId: "numeric-metrics",
      signal: new AbortController().signal,
    });
    const [prediction] = fromResponse(response, [pair], request, 1, 0, "original");
    const measured = metrics([{ pair, prediction: prediction! }]);
    expect(measured.confusion.true_positive).toBe(1);
    expect(measured.recall.value).toBe(1);
    expect(measured.coverage.value).toBe(1);
    expect(measured.probability_denominator).toBe(0);
  });
  it("rejects response attribution to a different profile", async () => {
    const request = makeRequest(pair);
    const provider: DecisionProvider = {
      id: "fake",
      model: "fake",
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
    const response = await evaluateCheck(request, provider, {
      requestId: "test",
      signal: new AbortController().signal,
    });
    expect(() =>
      fromResponse(response, [pair], { ...request, profile: "semantic-v2" }, 1, 0, "original"),
    ).toThrow("Invalid response coverage");
  });
});
