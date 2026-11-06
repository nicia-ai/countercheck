import { describe, expect, it } from "vitest";
import {
  fitNacePolicies,
  calibrationSummary,
  accountRejection,
} from "../eval/calibration-study/nace.js";
import { remapPrediction } from "../eval/calibration-study/scoring.js";
import type { Pair, Prediction } from "../eval/types.js";

function row(id: string, positive: boolean, c: number) {
  const pair: Pair = {
    id,
    dataset: "scifact",
    variant: "public",
    split: "train",
    source_id: id,
    group_id: id,
    claim: "Synthetic claim",
    evidence: "Synthetic comparison",
    gold: positive ? "contradiction" : "non_contradiction",
    native_label: positive ? "CONTRADICT" : "SUPPORT",
  };
  const prediction: Prediction = {
    pair_id: id,
    pass: 1,
    latency_ms: 1,
    status: "ok",
    verdict: "uncertain",
    model: "drex-max",
    raw_scores: {
      contradiction: c,
      consistent: 1 - c,
      different_scope: 0,
      insufficient_context: 0,
    },
    probabilities: { contradiction: c, no_contradiction: 1 - c, insufficient_context: 0 },
  };
  return {
    pair,
    prediction: remapPrediction(prediction, {
      positive: 0.8,
      negative_cut: 0.2,
      negative_support: 0.8,
    }),
  };
}

describe("Nace calibration primary and frozen positive gate", () => {
  it("uses shipped fit false clears as the primary budget and preserves zero controls", () => {
    const rows = [
      row("p1", true, 0.9),
      row("p2", true, 0.1),
      row("n1", false, 0.1),
      row("n2", false, 0.3),
    ];
    const fit = fitNacePolicies(rows);
    expect(fit.primary_budget).toBe(1);
    expect(fit.positive).toBe(0.9);
    expect(Object.keys(fit.variants)).toEqual([
      "primary",
      "rate_0",
      "rate_0.005",
      "rate_0.01",
      "rate_0.02",
      "rate_0.05",
    ]);
    const primary = calibrationSummary(
      rows.map((r) => ({
        ...r,
        prediction: remapPrediction(r.prediction, fit.variants.primary!.policy),
      })),
    );
    const zero = calibrationSummary(
      rows.map((r) => ({
        ...r,
        prediction: remapPrediction(r.prediction, fit.variants.rate_0!.policy),
      })),
    );
    expect(primary.false_clears).toBe(1);
    expect(primary.tn).toBe(2);
    expect(zero.false_clears).toBe(0);
    expect(zero.tn).toBe(0);
    for (const variant of Object.values(fit.variants))
      expect(variant.policy.positive).toBe(fit.positive);
  });
  it("keeps failed positives in recall without inventing scores or a false-clear budget", () => {
    const failed = row("failure", true, 0.9);
    failed.prediction = {
      pair_id: "failure",
      pass: 1,
      latency_ms: 3000,
      status: "error",
      error_code: "deadline_exceeded",
    };
    const rows = [row("p", true, 0.9), row("n", false, 0.1), failed];
    const fit = fitNacePolicies(rows);
    expect(fit.primary_budget).toBe(0);
    expect(fit.positive_fit_pairs).toBe(2);
    const summary = calibrationSummary(
      rows.map((r) => ({
        ...r,
        prediction: remapPrediction(r.prediction, fit.variants.primary!.policy),
      })),
    );
    expect(summary.errors).toBe(1);
    expect(summary.recall).toBe(0.5);
    expect(summary.completed).toBe(2);
  });
  it("distinguishes account/rate rejections from model or transport outcomes", () => {
    for (const status of [401, 402, 403, 429]) expect(accountRejection(status)).toBe(true);
    for (const status of [200, 422, 500, 529, null, undefined, "402"])
      expect(accountRejection(status)).toBe(false);
  });
});
