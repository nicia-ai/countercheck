import { z } from "zod";
import { PROFILES } from "./freeze.js";
import { PROBES } from "./probes.js";
import { predictionSchema, type Prediction, type EvaluationVerdict } from "../types.js";
import { wilson } from "../metrics.js";
import { targetLabel, type EngineeringCase } from "./manifests.js";
import type { Profile } from "./freeze.js";

export type Observation = {
  sequence: number;
  case_id: string;
  profile: Profile;
  probe: string;
  prediction: Prediction;
  compiled_sha256: string | null;
  compiled_bytes: number | null;
};
export type Features = {
  semantic_positive: number;
  semantic_negative: number;
  numeric_positive: number;
  numeric_negative: number;
  unknown_mass: number;
  numeric_eligible: boolean;
  forced_uncertain: boolean;
};
export function features(prediction: Prediction, semantic?: Prediction): Features | null {
  if (prediction.status !== "ok" || (semantic && semantic.status !== "ok")) return null;
  const scores = semantic?.status === "ok" ? semantic.raw_scores : prediction.raw_scores;
  const signals = prediction.structured_signals;
  const selection = signals?.selection;
  const p = selection?.probabilities ?? {};
  const coverage = signals?.candidate_coverage;
  const numericEligible =
    !!signals?.selected_pair &&
    !!coverage &&
    [coverage.claim, coverage.against].every(
      (side) => side.recognized_spans > 0 && side.unsupported_spans === 0 && !side.overflow,
    );
  const forcedUncertain =
    !!signals &&
    (signals.numeric_reason === "incomplete_candidate_coverage" ||
      signals.selected_choice === "unknown" ||
      signals.selected_choice === "insufficient_context" ||
      (!!coverage &&
        [coverage.claim, coverage.against].some(
          (side) => side.unsupported_spans > 0 || side.overflow,
        )) ||
      (!!signals.selected_pair && !numericEligible));
  const selectedProbability = signals?.pair_probability ?? 0;
  return {
    semantic_positive: scores?.contradiction ?? p.contradiction ?? 0,
    semantic_negative: scores
      ? scores.consistent + scores.different_scope
      : (p.consistent ?? 0) + (p.different_scope ?? 0),
    numeric_positive:
      numericEligible && signals?.numeric_relation === "incompatible" ? selectedProbability : 0,
    numeric_negative: signals?.numeric_relation === "compatible" ? selectedProbability : 0,
    numeric_eligible: numericEligible,
    forced_uncertain: forcedUncertain,
    unknown_mass: Math.max(
      scores?.insufficient_context ?? 0,
      Math.min(1, (p.insufficient_context ?? 0) + (p.unknown ?? 0)),
    ),
  };
}
export type CompositionPolicy = {
  positive_threshold: number;
  negative_threshold: number;
  max_unknown: number;
  numeric_override: boolean;
};
export function policyVerdict(f: Features | null, p: CompositionPolicy): EvaluationVerdict | null {
  if (!f) return null;
  if (f.forced_uncertain || f.unknown_mass > p.max_unknown) return "uncertain";
  if (
    f.semantic_positive >= p.positive_threshold ||
    (p.numeric_override && f.numeric_positive >= p.positive_threshold)
  )
    return "contradiction";
  if (f.semantic_positive <= 0.2 && f.semantic_negative >= p.negative_threshold)
    return "no_contradiction";
  return "uncertain";
}
export const POLICY_GRID: CompositionPolicy[] = [0.5, 0.65, 0.8, 0.9].flatMap(
  (positive_threshold) =>
    [0.5, 0.8, 0.9].flatMap((negative_threshold) =>
      [0.2, 0.5].flatMap((max_unknown) =>
        [false, true].map((numeric_override) => ({
          positive_threshold,
          negative_threshold,
          max_unknown,
          numeric_override,
        })),
      ),
    ),
);
export type LabeledSignal = {
  item: EngineeringCase;
  label: EvaluationVerdict;
  features: Features | null;
  original: Prediction;
};
export function policyMetrics(
  rows: Pick<LabeledSignal, "label" | "features">[],
  policy: CompositionPolicy,
) {
  const binary = rows.filter((r) => r.label !== "uncertain");
  const positive = binary.filter((r) => r.label === "contradiction").length,
    negative = binary.length - positive;
  let tp = 0,
    fp = 0,
    tn = 0,
    definitiveFn = 0,
    uncertain = 0,
    errors = 0,
    correctExpected = 0;
  for (const row of rows) {
    const verdict = policyVerdict(row.features, policy);
    if (verdict === row.label) correctExpected++;
    if (!verdict) errors++;
    else if (verdict === "uncertain") uncertain++;
    if (row.label === "uncertain") continue;
    if (verdict === "contradiction") {
      if (row.label === "contradiction") tp++;
      else fp++;
    }
    if (verdict === "no_contradiction") {
      if (row.label === "no_contradiction") tn++;
      else definitiveFn++;
    }
  }
  return {
    labeled_cases: rows.length,
    binary_cases: binary.length,
    expected_uncertain: rows.length - binary.length,
    positive,
    negative,
    tp,
    fp,
    tn,
    definitive_fn: definitiveFn,
    positive_misses: positive - tp,
    errors,
    uncertain,
    precision: wilson(tp, tp + fp),
    recall: wilson(tp, positive),
    f1: 2 * tp + fp + positive - tp ? (2 * tp) / (2 * tp + fp + positive - tp) : null,
    clear_negative_coverage: wilson(tn, negative),
    false_positive_rate: wilson(fp, negative),
    expected_verdict_accuracy: wilson(correctExpected, rows.length),
  };
}
export function labeledSignals(
  cases: EngineeringCase[],
  observations: Observation[],
  profile: Profile,
  semanticProfile: Profile | null,
  labelSpace: "native" | "service-contract",
) {
  const byKey = new Map<string, Prediction>();
  const expected = new Set(cases.map((c) => c.pair.id));
  const parsedObservations = z
    .array(
      z.object({
        sequence: z.number().int().nonnegative(),
        case_id: z.string().min(1),
        profile: z.enum(PROFILES),
        probe: z.enum(PROBES),
        prediction: predictionSchema,
        compiled_sha256: z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .nullable(),
        compiled_bytes: z.number().int().nonnegative().max(16384).nullable(),
      }),
    )
    .parse(observations);
  for (const row of parsedObservations) {
    if (!expected.has(row.case_id))
      throw new Error("Unexpected/heldout case in calibration predictions.");
    if (
      row.prediction.pair_id !== row.case_id ||
      (row.prediction.status === "ok" &&
        (!row.compiled_sha256 || row.prediction.prompt_hash !== row.compiled_sha256))
    )
      throw new Error("Prediction attribution/payload hash mismatch.");
    if (!expected.has(row.case_id))
      throw new Error("Unexpected/heldout case in calibration predictions.");
  }
  for (const row of parsedObservations.filter((o) => o.probe === "clean")) {
    if (!expected.has(row.case_id))
      throw new Error("Unexpected/heldout case in calibration predictions.");
    const key = `${row.profile}\0${row.case_id}`;
    if (byKey.has(key)) throw new Error("Duplicate clean prediction.");
    byKey.set(key, predictionSchema.parse(row.prediction));
  }
  return cases.flatMap((item) => {
    const original = byKey.get(`${profile}\0${item.pair.id}`),
      semantic = semanticProfile ? byKey.get(`${semanticProfile}\0${item.pair.id}`) : undefined;
    if (!original || (semanticProfile && !semantic))
      throw new Error("Missing matched clean predictions.");
    const label = targetLabel(item, labelSpace);
    return label === null
      ? []
      : [{ item, label, features: features(original, semantic), original }];
  });
}
const cellId = (f: Features) =>
  [
    Math.max(f.semantic_positive, f.numeric_positive) >= 0.8,
    f.numeric_positive >= 0.8,
    f.unknown_mass > 0.2,
  ]
    .map(Number)
    .join("");
export function empiricalCells(rows: LabeledSignal[]) {
  const cells: Record<string, { positive: number; total: number; laplace_probability: number }> =
    {};
  for (const row of rows) {
    if (!row.features || row.label === "uncertain") continue;
    const key = cellId(row.features),
      cell = cells[key] ?? { positive: 0, total: 0, laplace_probability: 0.5 };
    cell.total++;
    if (row.label === "contradiction") cell.positive++;
    cell.laplace_probability = (cell.positive + 1) / (cell.total + 2);
    cells[key] = cell;
  }
  return cells;
}
export function calibrationMetrics(
  rows: LabeledSignal[],
  cells: ReturnType<typeof empiricalCells>,
) {
  const eligible = rows.filter((r) => r.features && r.label !== "uncertain");
  const errors = eligible.map((r) => {
    const value = cells[cellId(r.features!)]?.laplace_probability ?? 0.5;
    return (value - Number(r.label === "contradiction")) ** 2;
  });
  return {
    scored_cases: eligible.length,
    missing_signals: rows.filter((r) => !r.features).length,
    unseen_cells: eligible.filter((r) => !cells[cellId(r.features!)]).length,
    brier: errors.length ? errors.reduce((a, b) => a + b, 0) / errors.length : null,
  };
}
export function fitComposition(rows: LabeledSignal[]) {
  const tune = rows.filter((r) => r.item.calibration_fold === "tune"),
    validation = rows.filter((r) => r.item.calibration_fold === "validation");
  if (
    !tune.length ||
    !validation.length ||
    !["contradiction", "no_contradiction"].every((label) => tune.some((r) => r.label === label))
  )
    throw new Error(
      "Dev tuning requires both binary classes and a nonempty group-disjoint validation fold.",
    );
  const tuneGroups = new Set(tune.map((r) => r.item.group_sha256));
  if (validation.some((r) => tuneGroups.has(r.item.group_sha256)))
    throw new Error("Calibration group leakage.");
  const candidates = POLICY_GRID.map((policy, order) => ({
    policy,
    order,
    metrics: policyMetrics(tune, policy),
  }));
  const acceptable = candidates.filter(
    (c) => c.metrics.tp + c.metrics.fp > 0 && (c.metrics.precision.value ?? 0) >= 0.95,
  );
  const eligible = acceptable.length ? acceptable : candidates;
  eligible.sort((a, b) =>
    acceptable.length
      ? (b.metrics.recall.value ?? 0) - (a.metrics.recall.value ?? 0) ||
        (b.metrics.f1 ?? 0) - (a.metrics.f1 ?? 0) ||
        a.order - b.order
      : (b.metrics.f1 ?? 0) - (a.metrics.f1 ?? 0) || a.order - b.order,
  );
  const selected = eligible[0]!;
  const cells = empiricalCells(tune);
  return {
    selection_rule: acceptable.length
      ? "maximum-tune-recall-at-point-precision-at-least-0.95; F1 then frozen-grid-order ties"
      : "no-policy-met-precision; exploratory-best-tune-F1",
    grid_size: POLICY_GRID.length,
    policy: selected.policy,
    tune: selected.metrics,
    validation: policyMetrics(validation, selected.policy),
    joint_empirical_calibration: {
      method: empiricalMethod,
      cells,
      tune: calibrationMetrics(tune, cells),
      validation: calibrationMetrics(validation, cells),
    },
    gates: {
      human_500_and_locked_200: "unmet-unverified",
      production_qualification: "not_assessed",
      automatic_promotion: false,
    },
    selection_uses_validation: false,
    tuning_groups: tuneGroups.size,
    validation_groups: new Set(validation.map((r) => r.item.group_sha256)).size,
  };
}

const empiricalMethod =
  "three binary joint-feature cells; Laplace(1) dev-tune only; unseen cells use 0.5; not provider probabilities";
const policySchema = z
  .strictObject({
    positive_threshold: z.number().finite(),
    negative_threshold: z.number().finite(),
    max_unknown: z.number().finite(),
    numeric_override: z.boolean(),
  })
  .refine(
    (p) =>
      POLICY_GRID.some(
        (candidate) =>
          candidate.positive_threshold === p.positive_threshold &&
          candidate.negative_threshold === p.negative_threshold &&
          candidate.max_unknown === p.max_unknown &&
          candidate.numeric_override === p.numeric_override,
      ),
    "Policy must belong to the frozen composition grid.",
  );
const cellSchema = z
  .strictObject({
    positive: z.number().int().nonnegative(),
    total: z.number().int().positive(),
    laplace_probability: z.number().min(0).max(1),
  })
  .refine(
    (c) =>
      c.positive <= c.total &&
      Math.abs(c.laplace_probability - (c.positive + 1) / (c.total + 2)) < 1e-12,
    "Cell probability/counts must match Laplace(1).",
  );
export const calibrationSchema = z
  .object({
    kind: z.literal("decision-engineering-calibration"),
    freeze_sha256: z.string().regex(/^[a-f0-9]{64}$/),
    split_lock_sha256: z.string().regex(/^[a-f0-9]{64}$/),
    dev_run_sha256: z.string().regex(/^[a-f0-9]{64}$/),
    profile: z.enum(PROFILES),
    semantic_profile: z.enum(PROFILES).nullable(),
    label_space: z.enum(["native", "service-contract"]),
    selection_uses_validation: z.literal(false),
    grid_size: z
      .number()
      .int()
      .refine((n) => n === POLICY_GRID.length),
    policy: policySchema,
    joint_empirical_calibration: z
      .object({
        method: z.literal(empiricalMethod),
        cells: z.record(z.string().regex(/^[01]{3}$/), cellSchema),
      })
      .passthrough(),
    gates: z.object({
      human_500_and_locked_200: z.literal("unmet-unverified"),
      production_qualification: z.literal("not_assessed"),
      automatic_promotion: z.literal(false),
    }),
  })
  .passthrough();
export type FrozenCalibration = z.infer<typeof calibrationSchema>;
