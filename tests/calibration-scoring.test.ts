import { describe, expect, it } from "vitest";
import {
  calibrationFeatures,
  fitOperatingPolicy,
  matchedPredictions,
  remapPrediction,
  redactCalibrationRow,
} from "../eval/calibration-study/scoring.js";
import type { Pair, Prediction } from "../eval/types.js";
const pair = (id: string, positive: boolean): Pair => ({
  id,
  dataset: "scifact",
  variant: "public",
  split: "train",
  source_id: id,
  group_id: id,
  claim: "Synthetic assertion",
  evidence: "Synthetic comparison",
  gold: positive ? "contradiction" : "non_contradiction",
  native_label: positive ? "CONTRADICT" : "SUPPORT",
});
const prediction = (id: string, c: number): Prediction => ({
  pair_id: id,
  pass: 1,
  latency_ms: 1,
  status: "ok",
  verdict: "uncertain",
  model: "jev-1.14.0",
  raw_scores: { contradiction: c, consistent: 1 - c, different_scope: 0, insufficient_context: 0 },
  probabilities: { contradiction: c, no_contradiction: 1 - c, insufficient_context: 0 },
});
describe("separate operating-policy bridge", () => {
  it("uses max rather than summed negative support and preserves failed rows", () => {
    const p = prediction("a", 0.1);
    if (p.status !== "ok") throw Error();
    p.raw_scores = {
      contradiction: 0.1,
      consistent: 0.45,
      different_scope: 0.4,
      insufficient_context: 0.05,
    };
    expect(calibrationFeatures(p)?.negative).toBe(0.45);
    expect(
      remapPrediction(p, { positive: 0.8, negative_cut: 0.2, negative_support: 0.8 }).verdict,
    ).toBe("uncertain");
    const error: Prediction = {
      pair_id: "b",
      pass: 1,
      latency_ms: 3000,
      status: "error",
      error_code: "timeout",
    };
    expect(
      remapPrediction(error, { positive: 0.8, negative_cut: 0.2, negative_support: 0.8 }),
    ).toEqual(error);
  });
  it("does not fabricate error distributions while retaining selected counts", () => {
    const result = fitOperatingPolicy([
      { pair: pair("a", true), prediction: prediction("a", 0.6) },
      { pair: pair("b", false), prediction: prediction("b", 0.2) },
      {
        pair: pair("c", true),
        prediction: { pair_id: "c", pass: 1, latency_ms: 1, status: "error" },
      },
    ]);
    expect(result.selected_pairs).toBe(3);
    expect(result.observed_distributions).toBe(2);
    expect(result.missing_distributions).toBe(1);
    expect(result.policy.positive).toBe(0.6);
    expect(result.policy.negative_cut).toBe(0.2);
  });
  it("rejects incomplete, repeated, wrong-model and out-of-cohort predictions", () => {
    const a = pair("a", true),
      b = pair("b", false),
      p = prediction("a", 0.8);
    expect(() => matchedPredictions([p], [a, b], "jev-1.14.0")).toThrow();
    expect(() => matchedPredictions([p, p], [a], "jev-1.14.0")).toThrow();
    expect(() => matchedPredictions([p], [a], "clef")).toThrow();
    expect(() => matchedPredictions([p], [b], "jev-1.14.0")).toThrow();
  });
  it("whitelists public metadata and hashes texts", () => {
    const p = pair("a", true);
    p.source_metadata = { private_quote: "do not export" };
    const redacted = redactCalibrationRow(p, prediction("a", 0.8));
    expect(JSON.stringify(redacted)).not.toContain(p.claim);
    expect(JSON.stringify(redacted)).not.toContain("private_quote");
    expect(redacted.text_provenance.claim_sha256).toMatch(/^[a-f0-9]{64}$/);
  });
});
