import type { Pair, Prediction } from "../types.js";
import type { ThresholdPolicy } from "../iteration/calibrate.js";
import { calibrationFeatures } from "./scoring.js";

const SUPPORTS = [0, 0.2, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95, 1, 1.001];

/** Same frozen grid/order as the original fitter, with a fixed positive gate and explicit budget. */
export function fitNegativePolicy(
  rows: { pair: Pick<Pair, "gold">; prediction: Prediction }[],
  positive: number,
  budget: number,
): ThresholdPolicy {
  if (!Number.isFinite(positive) || positive < 0 || !Number.isInteger(budget) || budget < 0)
    throw new Error("Invalid frozen positive cutoff or false-clear budget");
  const points = rows.flatMap(({ pair, prediction }) => {
    const f = calibrationFeatures(prediction);
    return f ? [{ c: f.conflict, n: f.negative, y: Number(pair.gold === "contradiction") }] : [];
  });
  const cuts = [
    ...new Set([
      0,
      ...Array.from({ length: 101 }, (_, i) => i / 100),
      ...points.map((p) => p.c),
      1.000001,
    ]),
  ]
    .sort((a, b) => a - b)
    .filter((c) => c < positive && c <= 1);
  const supports = SUPPORTS.map((support) => {
    const selected = points
      .filter((p) => p.c < positive && p.n >= support)
      .sort((a, b) => a.c - b.c);
    const prefix = [0];
    for (const p of selected) prefix.push(prefix[prefix.length - 1]! + p.y);
    return { support, scores: selected.map((p) => p.c), prefix };
  });
  let best = -1;
  let policy: ThresholdPolicy = { positive, negative_cut: 0, negative_support: 1.001 };
  for (const cut of cuts) {
    for (const { support, scores, prefix } of supports) {
      let lower = 0,
        upper = scores.length;
      while (lower < upper) {
        const middle = Math.floor((lower + upper) / 2);
        if (scores[middle]! <= cut) lower = middle + 1;
        else upper = middle;
      }
      const falseClears = prefix[lower]!,
        trueNegatives = lower - falseClears;
      if (falseClears <= budget && trueNegatives > best) {
        best = trueNegatives;
        policy = { positive, negative_cut: cut, negative_support: support };
      }
    }
  }
  return policy;
}
