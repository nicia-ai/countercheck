import type { Pair, Prediction } from "../types.js";
import { metrics, type Scored } from "../metrics.js";
import { fitOperatingPolicy, remapPrediction } from "./scoring.js";
import { fitNegativePolicy } from "./negative-policy.js";

export const NACE_CALIBRATION_MODELS = ["drex-max", "drex-max-finance"] as const;
export const NACE_SENSITIVITY_RATES = [0, 0.005, 0.01, 0.02, 0.05] as const;

export function calibrationSummary(rows: Scored[]) {
  const m = metrics(rows);
  return {
    selected: m.denominator,
    completed: m.denominator - m.errors - m.excluded,
    positive: m.positive,
    negative: m.negative,
    tp: m.confusion.true_positive,
    fp: m.confusion.false_positive,
    tn: m.confusion.true_negative,
    false_clears: m.confusion.definitive_false_negative,
    errors: m.errors,
    excluded: m.excluded,
    uncertain: rows.filter(
      (r) => r.prediction.status === "ok" && r.prediction.verdict === "uncertain",
    ).length,
    precision: m.precision.value,
    recall: m.recall.value,
    f1: m.f1,
    clear_negative_coverage: m.clear_negative_coverage.value,
    false_clear_rate: m.positive ? m.confusion.definitive_false_negative / m.positive : null,
  };
}

/** Takes fit rows only. The primary budget is that model's shipped fit false-clear count. */
export function fitNacePolicies(rows: { pair: Pair; prediction: Prediction }[]) {
  const zero = fitOperatingPolicy(rows);
  const shipped = calibrationSummary(rows);
  const budgets = {
    primary: shipped.false_clears,
    ...Object.fromEntries(
      NACE_SENSITIVITY_RATES.map((rate) => [`rate_${rate}`, Math.floor(rate * shipped.positive)]),
    ),
  };
  const variants = Object.fromEntries(
    Object.entries(budgets).map(([variant, budget]) => [
      variant,
      {
        allowed_fit_false_clears: budget,
        policy: fitNegativePolicy(rows, zero.policy.positive, budget),
      },
    ]),
  );
  if (JSON.stringify(variants.rate_0!.policy) !== JSON.stringify(zero.policy))
    throw new Error("Zero-budget control differs from the original fitter");
  for (const { policy, allowed_fit_false_clears } of Object.values(variants)) {
    const scored = calibrationSummary(
      rows.map((r) => ({ ...r, prediction: remapPrediction(r.prediction, policy) })),
    );
    if (scored.false_clears > allowed_fit_false_clears)
      throw new Error("Fit false-clear allowance exceeded");
  }
  return {
    selected_pairs: rows.length,
    positive_fit_pairs: shipped.positive,
    primary_budget: shipped.false_clears,
    positive: zero.policy.positive,
    precision_target_met: zero.precision_target_met,
    variants,
  };
}

export function accountRejection(status: unknown): boolean {
  return typeof status === "number" && [401, 402, 403, 429].includes(status);
}
