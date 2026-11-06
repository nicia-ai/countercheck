import type { Pair, Prediction } from "./types.js";

export type Scored = { pair: Pair; prediction: Prediction };
const ratio = (n: number, d: number): number | null => (d ? n / d : null);
export function wilson(
  n: number,
  d: number,
): { value: number | null; denominator: number; ci95: [number, number] | null } {
  if (!d) return { value: null, denominator: 0, ci95: null };
  const z = 1.959963984540054;
  const p = n / d;
  const center = (p + (z * z) / (2 * d)) / (1 + (z * z) / d);
  const half = (z * Math.sqrt((p * (1 - p)) / d + (z * z) / (4 * d * d))) / (1 + (z * z) / d);
  return {
    value: p,
    denominator: d,
    ci95: [Math.max(0, center - half), Math.min(1, center + half)],
  };
}
export function auc(rows: { y: boolean; score: number }[]): {
  auroc: number | null;
  pr_auc_average_precision: number | null;
} {
  const positives = rows.filter((r) => r.y).length;
  const negatives = rows.length - positives;
  const ordered = [...rows].sort((a, b) => b.score - a.score);
  let tp = 0;
  let fp = 0;
  let roc = 0;
  let ap = 0;
  for (let i = 0; i < ordered.length;) {
    const score = ordered[i]?.score;
    let p = 0;
    let n = 0;
    while (i < ordered.length && ordered[i]?.score === score) {
      if (ordered[i]?.y) p++;
      else n++;
      i++;
    }
    // Ties enter together. ROC is trapezoidal; PR is tie-aware average precision.
    roc += n * (tp + p / 2);
    tp += p;
    fp += n;
    ap += (p * tp) / (tp + fp);
  }
  return {
    auroc: positives && negatives ? roc / (positives * negatives) : null,
    pr_auc_average_precision: positives ? ap / positives : null,
  };
}
function quantile(values: number[], q: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1)))] ?? null;
}
function tokenUsage(rows: Scored[]) {
  type Usage = { input_tokens: number | null; output_tokens: number | null };
  const observations: Usage[] = [];
  const requests = new Map<string, Usage>();
  for (const { prediction } of rows) {
    if (prediction.status === "excluded") continue;
    if (prediction.request_usage) {
      const key = `${prediction.pass}\0${prediction.request_id}`;
      const previous = requests.get(key);
      if (
        previous &&
        (previous.input_tokens !== prediction.request_usage.input_tokens ||
          previous.output_tokens !== prediction.request_usage.output_tokens)
      )
        throw new Error("Inconsistent usage for the same request");
      if (!previous) {
        requests.set(key, prediction.request_usage);
        observations.push(prediction.request_usage);
      }
    } else
      observations.push({
        input_tokens: prediction.input_tokens ?? null,
        output_tokens: prediction.output_tokens ?? null,
      });
  }
  const summarize = (field: keyof Usage) => {
    const known = observations.flatMap((usage) => (usage[field] === null ? [] : [usage[field]]));
    return {
      known_subtotal: known.reduce((sum, n) => sum + n, 0),
      known_observations: known.length,
      unknown_observations: observations.length - known.length,
    };
  };
  return {
    scope: "deduplicated_requests_and_legacy_pair_observations",
    observations: observations.length,
    input: summarize("input_tokens"),
    output: summarize("output_tokens"),
  };
}
function scalarMetrics(rows: Scored[]) {
  const ok = rows.filter((r) => r.prediction.status === "ok");
  const definitive = ok.filter((r) => r.prediction.verdict !== "uncertain");
  const positive = rows.filter((r) => r.pair.gold === "contradiction").length;
  const negative = rows.length - positive;
  const tp = definitive.filter(
    (r) => r.prediction.verdict === "contradiction" && r.pair.gold === "contradiction",
  ).length;
  const fp = definitive.filter(
    (r) => r.prediction.verdict === "contradiction" && r.pair.gold !== "contradiction",
  ).length;
  const tn = definitive.filter(
    (r) => r.prediction.verdict === "no_contradiction" && r.pair.gold !== "contradiction",
  ).length;
  const fnDefinitive = definitive.filter(
    (r) => r.prediction.verdict === "no_contradiction" && r.pair.gold === "contradiction",
  ).length;
  const scores = ok
    .filter((r) => r.prediction.probabilities)
    .map((r) => ({
      y: r.pair.gold === "contradiction",
      score: r.prediction.probabilities?.contradiction ?? 0,
    }));
  const brier = ratio(
    scores.reduce((sum, r) => sum + (r.score - Number(r.y)) ** 2, 0),
    scores.length,
  );
  return {
    ok,
    definitive,
    scores,
    counts: { positive, negative, tp, fp, tn, fnDefinitive },
    statistics: {
      precision: wilson(tp, tp + fp),
      recall: wilson(tp, positive),
      f1: ratio(2 * tp, positive + tp + fp),
      false_positive_rate: wilson(fp, negative),
      clear_negative_coverage: wilson(tn, negative),
      coverage: wilson(definitive.length, rows.length),
      ...auc(scores),
      brier,
    },
  };
}
export function metrics(rows: Scored[]) {
  const {
    ok,
    definitive,
    scores,
    counts: { positive, negative, tp, fp, tn, fnDefinitive },
    statistics,
  } = scalarMetrics(rows);
  const bins = Array.from({ length: 10 }, (_, i) => {
    const bin = scores.filter((r) => Math.min(9, Math.floor(r.score * 10)) === i);
    return {
      lower: i / 10,
      upper: (i + 1) / 10,
      count: bin.length,
      mean_score: ratio(
        bin.reduce((s, r) => s + r.score, 0),
        bin.length,
      ),
      observed_positive: ratio(bin.filter((r) => r.y).length, bin.length),
    };
  });
  const ece = ratio(
    bins.reduce(
      (sum, b) => sum + b.count * Math.abs((b.mean_score ?? 0) - (b.observed_positive ?? 0)),
      0,
    ),
    scores.length,
  );
  const ranked = ok
    .filter((r) => r.prediction.probabilities)
    .sort((a, b) => {
      const confidence = (r: Scored) =>
        Math.max(
          r.prediction.probabilities?.contradiction ?? 0,
          1 - (r.prediction.probabilities?.contradiction ?? 0),
        );
      return confidence(b) - confidence(a) || a.pair.id.localeCompare(b.pair.id);
    });
  const riskCoverage = Array.from({ length: 10 }, (_, i) => {
    const selected = ranked.slice(0, Math.ceil((ranked.length * (i + 1)) / 10));
    const mistakes = selected.filter(
      (r) =>
        (r.prediction.probabilities?.contradiction ?? 0) >= 0.5 !==
        (r.pair.gold === "contradiction"),
    ).length;
    return {
      coverage: ratio(selected.length, rows.length),
      risk: ratio(mistakes, selected.length),
      count: selected.length,
    };
  });
  const forcedTp = scores.filter((r) => r.y && r.score >= 0.5).length;
  const forcedFp = scores.filter((r) => !r.y && r.score >= 0.5).length;
  const knownCost = rows.filter((r) => r.prediction.cost_usd !== undefined);
  const usage = tokenUsage(rows);
  return {
    denominator: rows.length,
    positive,
    negative,
    confusion: {
      true_positive: tp,
      false_positive: fp,
      true_negative: tn,
      definitive_false_negative: fnDefinitive,
      positive_misses_including_uncertain_errors_exclusions: positive - tp,
    },
    precision: statistics.precision,
    recall: statistics.recall,
    f1: statistics.f1,
    false_positive_rate: statistics.false_positive_rate,
    clear_negative_coverage: statistics.clear_negative_coverage,
    coverage: statistics.coverage,
    uncertainty: wilson(ok.length - definitive.length, rows.length),
    completion: wilson(ok.length, rows.length),
    errors: rows.filter((r) => r.prediction.status === "error").length,
    excluded: rows.filter((r) => r.prediction.status === "excluded").length,
    probability_denominator: scores.length,
    prevalence_in_scored_subset: ratio(scores.filter((r) => r.y).length, scores.length),
    auroc: statistics.auroc,
    pr_auc_average_precision: statistics.pr_auc_average_precision,
    brier: statistics.brier,
    expected_calibration_error_10_bins: ece,
    calibration_bins: bins,
    forced_binary_at_0_5: {
      denominator: scores.length,
      precision: ratio(forcedTp, forcedTp + forcedFp),
      recall: scores.length ? ratio(forcedTp, positive) : null,
      f1: scores.length ? ratio(2 * forcedTp, positive + forcedTp + forcedFp) : null,
    },
    risk_coverage_forced_binary: riskCoverage,
    latency_ms: {
      attempted: rows.filter((r) => r.prediction.status !== "excluded").length,
      completed: ok.length,
      completed_p50: quantile(
        ok.map((r) => r.prediction.latency_ms),
        0.5,
      ),
      completed_p95: quantile(
        ok.map((r) => r.prediction.latency_ms),
        0.95,
      ),
      completed_p99: quantile(
        ok.map((r) => r.prediction.latency_ms),
        0.99,
      ),
      all_attempts_p95: quantile(
        rows.filter((r) => r.prediction.status !== "excluded").map((r) => r.prediction.latency_ms),
        0.95,
      ),
    },
    cost: {
      known_rows: knownCost.length,
      unknown_rows: rows.length - knownCost.length,
      known_total_usd: knownCost.reduce((sum, r) => sum + (r.prediction.cost_usd ?? 0), 0),
      input_tokens: usage.input.unknown_observations ? null : usage.input.known_subtotal,
      output_tokens: usage.output.unknown_observations ? null : usage.output.known_subtotal,
      token_usage: usage,
    },
  };
}
export function bootstrapIntervals(rows: Scored[], iterations = 200) {
  // Cluster bootstrap keeps all rationale sets, contrast pairs and repeated passes together.
  const groups = new Map<string, Scored[]>();
  for (const row of rows)
    groups.set(row.pair.group_id, [...(groups.get(row.pair.group_id) ?? []), row]);
  const values = [...groups.values()];
  if (values.length < 2)
    return {
      clusters: values.length,
      iterations: 0,
      method: "insufficient independent claim groups",
      ci95: null,
    };
  let state = 20261103;
  const random = () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  const samples: Record<string, number[]> = {
    f1: [],
    auroc: [],
    pr_auc_average_precision: [],
    brier: [],
    precision: [],
    recall: [],
    false_positive_rate: [],
    clear_negative_coverage: [],
    coverage: [],
  };
  for (let i = 0; i < iterations; i++) {
    const sample: Scored[] = [];
    for (let j = 0; j < values.length; j++)
      sample.push(...(values[Math.floor(random() * values.length)] ?? []));
    const m = scalarMetrics(sample).statistics;
    for (const key of ["f1", "auroc", "pr_auc_average_precision", "brier"] as const)
      if (m[key] !== null) samples[key]?.push(m[key]);
    for (const key of [
      "precision",
      "recall",
      "false_positive_rate",
      "clear_negative_coverage",
      "coverage",
    ] as const) {
      const value = m[key].value;
      if (value !== null) samples[key]?.push(value);
    }
  }
  return {
    clusters: values.length,
    iterations,
    method:
      "deterministic claim-group percentile bootstrap; Wilson intervals above assume independent Bernoulli observations",
    ci95: Object.fromEntries(
      Object.entries(samples).map(([k, v]) => [k, [quantile(v, 0.025), quantile(v, 0.975)]]),
    ),
  };
}
export function summarize(rows: Scored[]) {
  const by = (key: (r: Scored) => string) =>
    Object.fromEntries(
      [...new Set(rows.map(key))].sort().map((k) => [k, metrics(rows.filter((r) => key(r) === k))]),
    );
  return {
    overall: metrics(rows),
    intervals: bootstrapIntervals(rows),
    by_dataset: by((r) => `${r.pair.dataset}/${r.pair.variant}/${r.pair.split}`),
    by_native_label: by((r) => `${r.pair.dataset}/${r.pair.variant}/${r.pair.native_label}`),
    by_pass: by((r) => String(r.prediction.pass)),
  };
}
