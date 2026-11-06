import { describe, expect, it } from "vitest";
import { fitNegativePolicy } from "../eval/calibration-study/negative-policy.js";
import { remapPrediction } from "../eval/calibration-study/scoring.js";
import type { Prediction } from "../eval/types.js";
const row = (id: string, positive: boolean, c: number) => ({
  pair: { gold: positive ? ("contradiction" as const) : ("non_contradiction" as const) },
  prediction: {
    pair_id: id,
    pass: 1,
    latency_ms: 1,
    status: "ok",
    verdict: "uncertain",
    raw_scores: {
      contradiction: c,
      consistent: 1 - c,
      different_scope: 0,
      insufficient_context: 0,
    },
    probabilities: { contradiction: c, no_contradiction: 1 - c, insufficient_context: 0 },
  } satisfies Prediction,
});
describe("fixed-positive negative budget fitting", () => {
  it("permits an explicit count of false clears and maximizes native clear negatives", () => {
    const rows = [
      row("p", true, 0.1),
      row("n1", false, 0.1),
      row("n2", false, 0.2),
      row("p2", true, 0.9),
    ];
    const zero = fitNegativePolicy(rows, 0.8, 0),
      one = fitNegativePolicy(rows, 0.8, 1);
    expect(
      rows.filter(
        (r) =>
          r.pair.gold === "non_contradiction" &&
          remapPrediction(r.prediction, zero).verdict === "no_contradiction",
      ),
    ).toHaveLength(0);
    expect(one).toEqual({ positive: 0.8, negative_cut: 0.2, negative_support: 0 });
    expect(
      rows.filter(
        (r) =>
          r.pair.gold === "contradiction" &&
          remapPrediction(r.prediction, one).verdict === "no_contradiction",
      ),
    ).toHaveLength(1);
    for (const r of rows)
      expect(remapPrediction(r.prediction, zero).verdict === "contradiction").toBe(
        remapPrediction(r.prediction, one).verdict === "contradiction",
      );
  });
  it("never fabricates features for failures", () => {
    const rows = [row("p", true, 0.7), row("n", false, 0.1)];
    const failed = {
      pair: { gold: "contradiction" as const },
      prediction: { pair_id: "e", pass: 1, status: "error", latency_ms: 1 } satisfies Prediction,
    };
    expect(fitNegativePolicy([...rows, failed], 0.8, 0)).toEqual(fitNegativePolicy(rows, 0.8, 0));
  });
  it("rejects invalid budgets", () => {
    expect(() => fitNegativePolicy([], 0.8, -1)).toThrow();
    expect(() => fitNegativePolicy([], 0.8, 0.5)).toThrow();
  });
});
