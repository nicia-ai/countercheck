import { z } from "zod";
import { auc, wilson } from "../metrics.js";
import { isUncertainFixture, sha256, type Pair } from "../types.js";
import {
  calibrationMetrics,
  assertDisjointFromTraining,
  contentKey,
  foldGroups,
  groupKey,
  type CalibrationInput,
  type CalibrationRow,
} from "./calibrate.js";
import { CANDIDATE_IDS, type CandidateId } from "./profiles.js";

export const REGULARIZATION_GRID = [1, 10, 100] as const;
type L2 = (typeof REGULARIZATION_GRID)[number];
export type RegularizationMode = "fixed" | "group-cv";
const l2Schema = z.union([z.literal(1), z.literal(10), z.literal(100)]);
const STEPS = 1200;
const EPSILON = 0.001;
const fields = [
  "conflict",
  "logit_conflict",
  "negative",
  "logit_negative",
  "unknown",
  "scope",
  "applicability",
  "applicability_missing",
  "determinable",
  "determinable_missing",
  "quantitative_decisive",
  "quantitative_missing",
  "numeric_probability",
  "numeric_missing",
  "numeric_incompatible",
  "numeric_compatible",
  "numeric_available",
  "nli_entailment",
  "nli_neutral",
] as const;
const logit = (p: number) =>
  Math.log(
    Math.max(EPSILON, Math.min(1 - EPSILON, p)) / (1 - Math.max(EPSILON, Math.min(1 - EPSILON, p))),
  );
const sigmoid = (x: number) => (x >= 0 ? 1 / (1 + Math.exp(-x)) : Math.exp(x) / (1 + Math.exp(x)));
type MatchedCase = { pair: Pair; rows: CalibrationRow[]; x: number[] };
function vector(row: CalibrationRow): number[] {
  const f = row.features;
  const relation = row.raw_answers.q_0_relation as
    { probabilities?: Record<string, number> } | undefined;
  const p = relation?.probabilities ?? {},
    sum = Object.values(p).reduce((a, b) => a + b, 0) || 1;
  return [
    f.conflict,
    logit(f.conflict),
    f.negative,
    logit(f.negative),
    f.unknown,
    f.scope,
    f.applicability ?? 0,
    Number(f.applicability === null),
    f.determinable ?? 0,
    Number(f.determinable === null),
    f.quantitative_decisive ?? 0,
    Number(f.quantitative_decisive === null),
    f.numeric_probability ?? 0,
    Number(f.numeric_probability === null),
    Number(f.numeric_relation === "incompatible"),
    Number(f.numeric_relation === "compatible"),
    Number(f.numeric_available),
    (p.entailment ?? 0) / sum,
    (p.neutral ?? 0) / sum,
  ];
}
function matchedCases(input: CalibrationInput, profiles: readonly CandidateId[]): MatchedCase[] {
  const expected = input.manifest.pairs.length * profiles.length;
  if (
    input.rows.length !== expected ||
    profiles.length < 2 ||
    new Set(profiles).size !== profiles.length
  )
    throw new Error("Fusion requires complete matched multi-candidate cases.");
  const index = new Map<string, CalibrationRow>();
  for (const row of input.rows) {
    const key = JSON.stringify([row.pair.id, row.profile]);
    if (index.has(key)) throw new Error("Duplicate fusion row.");
    index.set(key, row);
  }
  return input.manifest.pairs.map((pair) => {
    const rows = profiles.map((profile) => {
      const row = index.get(JSON.stringify([pair.id, profile]));
      if (!row || contentKey(row.pair) !== contentKey(pair))
        throw new Error("Unmatched fusion case identity.");
      return row;
    });
    return { pair, rows, x: rows.flatMap(vector) };
  });
}
const logisticSchema = z.strictObject({
  intercept: z.number().finite(),
  coefficients: z.array(z.number().finite()),
  mean: z.array(z.number().finite()),
  scale: z.array(z.number().finite().positive()),
  l2: l2Schema,
  objective: z.literal("sum_log_loss_plus_half_l2_weights"),
  iterations: z.number().int().positive().max(STEPS),
  training_cases: z.number().int().positive(),
});
export type LogisticModel = z.infer<typeof logisticSchema>;
function train(cases: readonly MatchedCase[], l2: L2 = 1): LogisticModel {
  const binary = cases.filter((c) => !isUncertainFixture(c.pair)),
    n = binary.length,
    d = binary[0]?.x.length ?? 0;
  if (
    !binary.some((c) => c.pair.gold === "contradiction") ||
    !binary.some((c) => c.pair.gold === "non_contradiction")
  )
    throw new Error("Fusion fitting needs both binary labels.");
  const mean = Array.from({ length: d }, (_, j) => binary.reduce((a, c) => a + c.x[j]!, 0) / n);
  const scale = mean.map(
    (m, j) => Math.sqrt(binary.reduce((a, c) => a + (c.x[j]! - m) ** 2, 0) / n) || 1,
  );
  const x = binary.map((c) => c.x.map((v, j) => (v - mean[j]!) / scale[j]!));
  const y = binary.map((c) => Number(c.pair.gold === "contradiction"));
  let intercept = logit(y.reduce((a, b) => a + b, 0) / n),
    iterations = 0;
  const coefficients = Array<number>(d).fill(0);
  // A trace bound on the Hessian makes this fixed step safe without tuning on labels.
  const step =
    1 / (0.25 * (1 + x.reduce((a, row) => a + row.reduce((b, v) => b + v * v, 0), 0) / n) + l2 / n);
  for (let iteration = 0; iteration < STEPS; iteration++) {
    const gradient = coefficients.map((w) => (l2 * w) / n);
    let bias = 0;
    for (let i = 0; i < n; i++) {
      const row = x[i]!,
        delta = sigmoid(intercept + row.reduce((a, v, j) => a + v * coefficients[j]!, 0)) - y[i]!;
      bias += delta / n;
      for (let j = 0; j < d; j++) gradient[j]! += (delta * row[j]!) / n;
    }
    intercept -= step * bias;
    for (let j = 0; j < d; j++) coefficients[j]! -= step * gradient[j]!;
    iterations = iteration + 1;
    if (Math.max(Math.abs(bias), ...gradient.map(Math.abs)) < 1e-7) break;
  }
  return {
    intercept,
    coefficients,
    mean,
    scale,
    l2,
    objective: "sum_log_loss_plus_half_l2_weights",
    iterations,
    training_cases: n,
  };
}
export function predictFusion(model: LogisticModel, x: readonly number[]): number {
  if (
    x.length !== model.coefficients.length ||
    model.mean.length !== x.length ||
    model.scale.length !== x.length ||
    x.some((v) => !Number.isFinite(v))
  )
    throw new Error("Invalid fusion feature dimensions.");
  return sigmoid(
    model.intercept +
      x.reduce(
        (a, v, j) => a + ((v - model.mean[j]!) / model.scale[j]!) * model.coefficients[j]!,
        0,
      ),
  );
}
type ScoredCase = { item: MatchedCase; score: number };
type FusionPolicy = { positive: number; negative_cut: number };
const scoreCases = (cases: readonly MatchedCase[], model: LogisticModel) =>
  cases.map((item) => ({ item, score: predictFusion(model, item.x) }));
function metrics(rows: readonly ScoredCase[], policy: FusionPolicy) {
  const projected = rows.map(
    ({ item, score }) =>
      ({
        pair: item.pair,
        profile: item.rows[0]!.profile,
        raw_answers: {},
        features: {
          conflict: score,
          negative: 1 - score,
          unknown: 0,
          scope: 0,
          applicability: null,
          determinable: null,
          quantitative_decisive: null,
          numeric_probability: null,
          numeric_relation: null,
          numeric_available: false,
        },
      }) satisfies CalibrationRow,
  );
  const base = calibrationMetrics(projected, { ...policy, negative_support: 0 });
  const binary = rows.filter((r) => !isUncertainFixture(r.item.pair));
  return {
    ...base,
    npv: wilson(base.tn, base.tn + base.false_clears),
    ...auc(binary.map((r) => ({ y: r.item.pair.gold === "contradiction", score: r.score }))),
    brier: binary.length
      ? binary.reduce(
          (a, r) => a + (r.score - Number(r.item.pair.gold === "contradiction")) ** 2,
          0,
        ) / binary.length
      : null,
  };
}
function selectPolicies(rows: readonly ScoredCase[]) {
  const values = [
    ...new Set([
      0,
      ...Array.from({ length: 101 }, (_, i) => i / 100),
      ...rows.map((r) => r.score),
      1.000001,
    ]),
  ].sort((a, b) => a - b);
  const positiveFrontier = values.map((threshold) => {
    const m = metrics(rows, { positive: threshold, negative_cut: -1 });
    return { threshold, tp: m.tp, fp: m.fp, precision: m.precision.value, recall: m.recall.value };
  });
  const eligible = positiveFrontier
    .filter((m) => m.tp > 0 && (m.precision ?? 0) >= 0.95)
    .sort((a, b) => b.tp - a.tp || b.precision! - a.precision! || b.threshold - a.threshold);
  const positive = eligible[0]?.threshold ?? 1.000001;
  const negativeFrontier = [-1, ...values.filter((v) => v < positive && v <= 1)].map((cut) => {
    const m = metrics(rows, { positive, negative_cut: cut });
    return {
      cut,
      tn: m.tn,
      false_clears: m.false_clears,
      npv: m.npv.value,
      coverage: m.clear_negative_coverage.value,
    };
  });
  const best = (npv: boolean) =>
    negativeFrontier
      .filter((m) => (npv ? (m.npv ?? 0) >= 0.95 : m.false_clears === 0))
      .sort((a, b) => b.tn - a.tn || a.false_clears - b.false_clears || a.cut - b.cut)[0]?.cut ??
    -1;
  return {
    positive_precision_target_met: eligible.length > 0,
    policies: {
      zero_false_clears: { positive, negative_cut: best(false) },
      npv95: { positive, negative_cut: best(true) },
    },
    positive_frontier: positiveFrontier,
    negative_frontier: negativeFrontier,
  };
}
const cvFoldSchema = z.strictObject({
  index: z.number().int().min(0).max(2),
  fit_groups: z.array(z.string()).min(1),
  check_groups: z.array(z.string()).min(1),
  fit_groups_sha256: z.string(),
  check_groups_sha256: z.string(),
});
const crossValidationSchema = z.strictObject({
  method: z.literal("three_source_group_folds_minimum_oof_log_loss"),
  l2_candidates: z.tuple([z.literal(1), z.literal(10), z.literal(100)]),
  selected_l2: l2Schema,
  folds: z.array(cvFoldSchema).length(3),
  losses: z
    .array(
      z.strictObject({
        l2: l2Schema,
        log_loss: z.number().finite().nonnegative(),
        binary_cases: z.number().int().positive(),
        fold_log_loss: z.array(z.number().finite().nonnegative()).length(3),
      }),
    )
    .length(3),
  oof_predictions: z
    .array(
      z.strictObject({
        pair_id: z.string(),
        group: z.string(),
        fold: z.number().int().min(0).max(2),
        score: z.number().finite().min(0).max(1),
      }),
    )
    .min(1),
});
type CrossValidation = z.infer<typeof crossValidationSchema>;
function logLoss(rows: readonly ScoredCase[]): number {
  const binary = rows.filter((r) => !isUncertainFixture(r.item.pair));
  if (!binary.length) throw new Error("Cross-validation fold lacks binary labels.");
  return (
    binary.reduce((sum, r) => {
      const p = Math.max(1e-15, Math.min(1 - 1e-15, r.score));
      return sum - (r.item.pair.gold === "contradiction" ? Math.log(p) : Math.log1p(-p));
    }, 0) / binary.length
  );
}
function crossValidate(cases: readonly MatchedCase[], groups: readonly string[], seed: string) {
  if (groups.length < 3) throw new Error("Regularization CV needs at least three source groups.");
  const ordered = [...groups].sort((a, b) =>
    sha256(`${seed}:fusion-cv:${a}`).localeCompare(sha256(`${seed}:fusion-cv:${b}`)),
  );
  const folds = Array.from({ length: 3 }, (_, index) => {
    const check_groups = ordered.filter((_, i) => i % 3 === index),
      fit_groups = ordered.filter((_, i) => i % 3 !== index);
    return {
      index,
      fit_groups,
      check_groups,
      fit_groups_sha256: sha256(JSON.stringify(fit_groups)),
      check_groups_sha256: sha256(JSON.stringify(check_groups)),
    };
  });
  const runs = REGULARIZATION_GRID.map((l2) => {
    const parts = folds.map((fold) => {
      const fit = new Set(fold.fit_groups),
        check = new Set(fold.check_groups);
      const model = train(
        cases.filter((c) => fit.has(groupKey(c.pair))),
        l2,
      );
      const scores = scoreCases(
        cases.filter((c) => check.has(groupKey(c.pair))),
        model,
      );
      return { fold: fold.index, scores, log_loss: logLoss(scores) };
    });
    const scores = parts.flatMap((p) => p.scores);
    return { l2, scores, parts, log_loss: logLoss(scores) };
  });
  const best = [...runs].sort((a, b) =>
    Math.abs(a.log_loss - b.log_loss) <= 1e-12 ? b.l2 - a.l2 : a.log_loss - b.log_loss,
  )[0]!;
  const record: CrossValidation = {
    method: "three_source_group_folds_minimum_oof_log_loss",
    l2_candidates: [...REGULARIZATION_GRID],
    selected_l2: best.l2,
    folds,
    losses: runs.map((r) => ({
      l2: r.l2,
      log_loss: r.log_loss,
      binary_cases: r.scores.filter((s) => !isUncertainFixture(s.item.pair)).length,
      fold_log_loss: r.parts.map((p) => p.log_loss),
    })),
    oof_predictions: best.parts.flatMap((p) =>
      p.scores.map((r) => ({
        pair_id: r.item.pair.id,
        group: groupKey(r.item.pair),
        fold: p.fold,
        score: r.score,
      })),
    ),
  };
  return { record, scores: best.scores };
}
function fitted(
  cases: readonly MatchedCase[],
  groups: readonly string[],
  seed: string,
  mode: RegularizationMode,
) {
  const cv = mode === "group-cv" ? crossValidate(cases, groups, seed) : null;
  const model = train(cases, cv?.record.selected_l2 ?? 1),
    scores = scoreCases(cases, model);
  const selection = selectPolicies(cv?.scores ?? scores);
  return { model, scores, selection, cv };
}
const policySchema = z.strictObject({
  positive: z.number().min(0).max(1.000001),
  negative_cut: z.number().min(-1).max(1),
});
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const fusionModelSchema = z
  .object({
    schema_version: z.literal(1),
    kind: z.enum(["iteration-logistic-fusion", "iteration-logistic-fusion-diagnostic"]),
    qualification: z.literal("not_assessed"),
    estimate_interpretation: z.literal(
      "fitted binary contradiction estimate; independent calibration unverified",
    ),
    profiles: z.array(z.enum(CANDIDATE_IDS)).min(2),
    feature_names: z.array(z.string()),
    candidate_source_sha256: hash,
    training_manifest_sha256: hash,
    training_run_sha256: hash,
    training_groups: z.array(z.string()),
    training_sources: z.array(z.string()),
    training_content: z.array(hash),
    training_groups_sha256: hash,
    seed: z.string().min(1),
    regularization_mode: z.enum(["fixed", "group-cv"]).optional(),
    threshold_source: z.enum(["in_sample_fixed_l2", "pooled_group_oof"]).optional(),
    cross_validation: crossValidationSchema.optional(),
    inner: z
      .object({
        folds: z.strictObject({
          fit: z.array(z.string()).min(1),
          check: z.array(z.string()).min(1),
        }),
        model: logisticSchema.optional(),
        cross_validation: crossValidationSchema.optional(),
      })
      .passthrough(),
    model: logisticSchema,
    selection: z
      .object({
        policies: z.strictObject({ zero_false_clears: policySchema, npv95: policySchema }),
      })
      .passthrough(),
  })
  .passthrough()
  .superRefine((value, ctx) => {
    const expected = value.profiles.flatMap((p) => fields.map((f) => `${p}:${f}`));
    const fit = value.inner.folds.fit,
      check = value.inner.folds.check,
      groups = value.training_groups;
    const orderedProfiles = [...new Set(value.profiles)].sort();
    const dimensions = (m: LogisticModel) =>
      m.coefficients.length === expected.length &&
      m.mean.length === expected.length &&
      m.scale.length === expected.length;
    if (
      JSON.stringify(orderedProfiles) !== JSON.stringify(value.profiles) ||
      JSON.stringify(expected) !== JSON.stringify(value.feature_names) ||
      !dimensions(value.model) ||
      (value.inner.model && !dimensions(value.inner.model))
    )
      ctx.addIssue({
        code: "custom",
        message: "Fusion profile, feature or coefficient dimensions disagree.",
      });
    if (
      new Set(groups).size !== groups.length ||
      new Set(fit).size !== fit.length ||
      new Set(check).size !== check.length ||
      fit.some((g) => check.includes(g)) ||
      JSON.stringify([...fit, ...check].sort()) !== JSON.stringify([...groups].sort()) ||
      sha256(JSON.stringify(groups)) !== value.training_groups_sha256
    )
      ctx.addIssue({ code: "custom", message: "Fusion source-group folds or hash disagree." });
    const validCv = (
      cv: CrossValidation,
      allowed: readonly string[],
      l2: number,
      binaryCases: number,
    ) => {
      const memberships = cv.folds.flatMap((f) => f.check_groups);
      const losses = [...cv.losses].sort((a, b) =>
        Math.abs(a.log_loss - b.log_loss) <= 1e-12 ? b.l2 - a.l2 : a.log_loss - b.log_loss,
      );
      return (
        cv.selected_l2 === l2 &&
        cv.oof_predictions.length >= binaryCases &&
        cv.losses.every((loss) => loss.binary_cases === binaryCases) &&
        losses[0]?.l2 === l2 &&
        JSON.stringify(cv.losses.map((v) => v.l2)) === JSON.stringify(REGULARIZATION_GRID) &&
        new Set(memberships).size === memberships.length &&
        JSON.stringify([...memberships].sort()) === JSON.stringify([...allowed].sort()) &&
        cv.folds.every(
          (f, i) =>
            f.index === i &&
            new Set(f.fit_groups).size === f.fit_groups.length &&
            new Set(f.check_groups).size === f.check_groups.length &&
            !f.fit_groups.some((g) => f.check_groups.includes(g)) &&
            JSON.stringify([...f.fit_groups, ...f.check_groups].sort()) ===
              JSON.stringify([...allowed].sort()) &&
            f.fit_groups_sha256 === sha256(JSON.stringify(f.fit_groups)) &&
            f.check_groups_sha256 === sha256(JSON.stringify(f.check_groups)),
        ) &&
        new Set(cv.oof_predictions.map((p) => p.pair_id)).size === cv.oof_predictions.length &&
        allowed.every((g) => cv.oof_predictions.some((p) => p.group === g)) &&
        cv.oof_predictions.every((p) => cv.folds[p.fold]!.check_groups.includes(p.group))
      );
    };
    if (value.regularization_mode === "group-cv") {
      if (
        value.threshold_source !== "pooled_group_oof" ||
        !value.cross_validation ||
        !value.inner.cross_validation ||
        !value.inner.model ||
        !validCv(value.cross_validation, groups, value.model.l2, value.model.training_cases) ||
        !validCv(
          value.inner.cross_validation,
          fit,
          value.inner.model.l2,
          value.inner.model.training_cases,
        )
      )
        ctx.addIssue({
          code: "custom",
          message: "Fusion group-CV provenance or selected regularization disagrees.",
        });
    } else if (
      value.model.l2 !== 1 ||
      (value.inner.model !== undefined && value.inner.model.l2 !== 1) ||
      value.cross_validation ||
      value.inner.cross_validation ||
      (value.threshold_source !== undefined && value.threshold_source !== "in_sample_fixed_l2")
    )
      ctx.addIssue({ code: "custom", message: "Fixed fusion regularization metadata disagrees." });
  });
function reports(rows: readonly ScoredCase[], policies: Record<string, FusionPolicy>) {
  return Object.fromEntries(
    Object.entries(policies).map(([name, policy]) => [
      name,
      {
        policy,
        metrics: metrics(rows, policy),
        by_dataset: Object.fromEntries(
          [...new Set(rows.map((r) => r.item.pair.dataset))].map((d) => [
            d,
            metrics(
              rows.filter((r) => r.item.pair.dataset === d),
              policy,
            ),
          ]),
        ),
      },
    ]),
  );
}
export function fitFusion(
  input: CalibrationInput,
  options: { seed: string; diagnostic?: boolean; regularization?: RegularizationMode },
) {
  if (
    input.purpose !== "tune" ||
    input.manifest.purpose !== "development" ||
    input.manifest.pairs.some((p) => p.split !== "train")
  )
    throw new Error("Fusion fit requires tune purpose and original train pairs.");
  if (!options.seed) throw new Error("Fusion fit requires a source-group split seed.");
  const profiles = [...input.profiles].sort(),
    cases = matchedCases(input, profiles),
    folds = foldGroups(input.manifest.pairs, options.seed),
    fit = new Set(folds.fit),
    check = new Set(folds.check);
  const innerFit = cases.filter((c) => fit.has(groupKey(c.pair))),
    innerCheck = cases.filter((c) => check.has(groupKey(c.pair)));
  const mode = options.regularization ?? "fixed";
  if (mode !== "fixed" && mode !== "group-cv") throw new Error("Unknown regularization mode.");
  const groups = [...new Set(input.manifest.pairs.map(groupKey))].sort();
  const inner = fitted(innerFit, folds.fit, `${options.seed}:inner`, mode),
    final = fitted(cases, groups, options.seed, mode);
  const { model, scores, selection } = final;
  return {
    schema_version: 1 as const,
    kind: options.diagnostic
      ? ("iteration-logistic-fusion-diagnostic" as const)
      : ("iteration-logistic-fusion" as const),
    qualification: "not_assessed" as const,
    estimate_interpretation:
      "fitted binary contradiction estimate; independent calibration unverified" as const,
    profiles,
    feature_names: profiles.flatMap((p) => fields.map((f) => `${p}:${f}`)),
    candidate_source_sha256: input.source_sha256,
    training_manifest_sha256: input.manifest_sha256,
    training_run_sha256: input.run_sha256,
    training_groups: groups,
    training_sources: [
      ...new Set(input.manifest.pairs.map((p) => `${p.dataset}:${p.source_id}`)),
    ].sort(),
    training_content: [...new Set(input.manifest.pairs.map(contentKey))].sort(),
    training_groups_sha256: sha256(JSON.stringify(groups)),
    seed: options.seed,
    first_pass_only: true,
    ignored_repeat_passes: input.passes - 1,
    regularization_mode: mode,
    threshold_source:
      mode === "group-cv" ? ("pooled_group_oof" as const) : ("in_sample_fixed_l2" as const),
    regularization_selection:
      mode === "group-cv"
        ? "preregistered_1_10_100_minimum_training_group_oof_log_loss"
        : "fixed_in_source_no_hyperparameter_search",
    ...(final.cv && {
      cross_validation: final.cv.record,
      oof: reports(final.cv.scores, selection.policies),
    }),
    model,
    selection,
    inner: {
      folds,
      model: inner.model,
      selection: inner.selection,
      ...(inner.cv && {
        cross_validation: inner.cv.record,
        oof: reports(inner.cv.scores, inner.selection.policies),
      }),
      fit: reports(inner.scores, inner.selection.policies),
      check: reports(scoreCases(innerCheck, inner.model), inner.selection.policies),
    },
    training: reports(scores, selection.policies),
  };
}
export function evaluateFusion(modelValue: unknown, input: CalibrationInput) {
  const frozen = fusionModelSchema.parse(modelValue);
  if (frozen.kind !== "iteration-logistic-fusion")
    throw new Error("Diagnostic fusion cannot be used as a frozen model.");
  if (!["validation", "regression"].includes(input.purpose))
    throw new Error("Frozen fusion evaluation requires independent validation/regression purpose.");
  if (
    frozen.candidate_source_sha256 !== input.source_sha256 ||
    JSON.stringify([...input.profiles].sort()) !== JSON.stringify(frozen.profiles)
  )
    throw new Error("Fusion candidate formulation/profile mismatch.");
  assertDisjointFromTraining(input.manifest.pairs, frozen);
  const expected = frozen.profiles.flatMap((p) => fields.map((f) => `${p}:${f}`));
  if (JSON.stringify(expected) !== JSON.stringify(frozen.feature_names))
    throw new Error("Fusion feature identity mismatch.");
  const scores = scoreCases(matchedCases(input, frozen.profiles), frozen.model);
  return {
    kind: "iteration-frozen-fusion-validation",
    qualification: "not_assessed",
    model_sha256: sha256(JSON.stringify(modelValue)),
    manifest_sha256: input.manifest_sha256,
    run_sha256: input.run_sha256,
    policies: reports(scores, frozen.selection.policies),
    observations: scores.map(({ item, score }) => ({
      pair_id: item.pair.id,
      calibrated_estimate: { contradiction: score, no_contradiction: 1 - score },
      estimate_interpretation: frozen.estimate_interpretation,
      raw_candidates: item.rows.map((r) => ({
        profile: r.profile,
        features: r.features,
        raw_answers: r.raw_answers,
      })),
    })),
  };
}
