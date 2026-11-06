import {
  selectThresholds,
  verdictFor,
  type CalibrationRow,
  type ThresholdPolicy,
} from "../iteration/calibrate.js";
import type { Features } from "../iteration/runner.js";
import { predictionSchema, sha256, type Pair, type Prediction } from "../types.js";

/** Preserve raw four-way scores; match the shipped max-category negative support. */
export function calibrationFeatures(prediction: Prediction): Features | null {
  if (prediction.status !== "ok") return null;
  const raw = prediction.raw_scores;
  if (!raw) throw new Error("Successful calibration row requires four-way raw scores");
  return {
    conflict: raw.contradiction,
    negative: Math.max(raw.consistent, raw.different_scope),
    unknown: raw.insufficient_context,
    scope: raw.different_scope,
    applicability: null,
    determinable: null,
    quantitative_decisive: null,
    numeric_probability: null,
    numeric_relation: null,
    numeric_available: false,
  };
}

export function matchedPredictions(values: unknown[], pairs: Pair[], model: string) {
  const expected = new Map(pairs.map((p) => [p.id, p]));
  const seen = new Set<string>();
  const rows = values.map((value) => {
    const prediction = predictionSchema.parse(value);
    const pair = expected.get(prediction.pair_id);
    if (!pair || seen.has(pair.id) || prediction.pass !== 1)
      throw new Error("Unmatched, duplicate, or repeated calibration prediction");
    if (prediction.status === "ok" && prediction.model !== model)
      throw new Error("Calibration model mismatch");
    calibrationFeatures(prediction);
    seen.add(pair.id);
    return { pair, prediction };
  });
  if (seen.size !== expected.size) throw new Error("Incomplete calibration coverage");
  return rows;
}

export function fitOperatingPolicy(rows: { pair: Pair; prediction: Prediction }[]) {
  const observed: CalibrationRow[] = rows.flatMap(({ pair, prediction }) => {
    const features = calibrationFeatures(prediction);
    // The reused selector reads only pair/feature fields. This adapter tag is not inference provenance.
    return features ? [{ pair, profile: "rich-control" as const, features, raw_answers: {} }] : [];
  });
  const selected = selectThresholds(observed, 0.95);
  return {
    ...selected,
    selected_pairs: rows.length,
    observed_distributions: observed.length,
    missing_distributions: rows.length - observed.length,
    denominator_policy:
      "Failures remain misses; no probabilities imputed; cutoff search uses observed distributions only",
  };
}

export function remapPrediction(prediction: Prediction, policy: ThresholdPolicy): Prediction {
  if (prediction.status !== "ok") return prediction;
  const features = calibrationFeatures(prediction);
  return features
    ? {
        ...prediction,
        verdict: verdictFor(features, policy),
        threshold_version: "separate-calibration-v1",
      }
    : prediction;
}

export function redactCalibrationRow(pair: Pair, prediction: Prediction) {
  // Whitelist metadata: a future dataset adapter must not accidentally export source text.
  return {
    pair: {
      id: pair.id,
      dataset: pair.dataset,
      variant: pair.variant,
      split: pair.split,
      source_id: pair.source_id,
      group_id: pair.group_id,
      gold: pair.gold,
      native_label: pair.native_label,
      claim: "[not archived: input text hashes below]",
      evidence: "[not archived: input text hashes below]",
    },
    prediction,
    text_provenance: {
      claim_sha256: sha256(pair.claim),
      evidence_sha256: sha256(pair.evidence),
    },
  };
}
