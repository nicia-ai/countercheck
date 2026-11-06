import { describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  fitFusion,
  evaluateFusion,
  fusionModelSchema,
  predictFusion,
} from "../eval/iteration/fusion.js";
import {
  fitCalibration,
  loadCalibrationInput,
  type CalibrationInput,
} from "../eval/iteration/calibrate.js";
import { compileCandidate, type CandidateId } from "../eval/iteration/profiles.js";
import { sha256, type Manifest, type Pair } from "../eval/types.js";
import { main as fusionCli } from "../scripts/fuse-iteration.js";

function fixture(prefix = "train", purpose: CalibrationInput["purpose"] = "tune", noisy = false) {
  const n = noisy ? 120 : 40;
  const pairs: Pair[] = Array.from({ length: n }, (_, i) => {
    const positive = noisy ? i % 3 === 0 : i % 4 < 2;
    return {
      id: `${prefix}-${i}`,
      dataset: "vitaminc",
      variant: "fixture",
      split: "train",
      source_id: `${prefix}-source-${Math.floor(i / (noisy ? 3 : 4))}`,
      group_id: `${prefix}-group-${Math.floor(i / (noisy ? 3 : 4))}`,
      claim: `${prefix} claim ${i}`,
      evidence: `${prefix} evidence ${i}`,
      gold: positive ? "contradiction" : "non_contradiction",
      native_label: positive ? "REFUTES" : "SUPPORTS",
    };
  });
  const manifest: Manifest = {
    schema_version: 1,
    adapter_version: "countercheck-public-pairs-v1",
    purpose: "development",
    sources: [
      {
        name: "fixture",
        url: "https://example.test",
        revision: "1",
        sha256: "a".repeat(64),
        license: "CC0",
        license_url: "https://example.test/license",
      },
    ],
    sampling: {
      seed: "fixture",
      max_pairs: n,
      method: "fixture",
      available_pairs: n,
      selected_pairs: n,
      excluded_unlabeled: 0,
      strata: {},
    },
    pairs,
  };
  const profiles: CandidateId[] = ["local-mini", "literal-contract"];
  const observations = profiles.flatMap((profile, j) =>
    pairs.map((pair, i) => {
      const f = noisy
        ? pair.gold === "non_contradiction" || i === 0
          ? 0.1
          : j === 0
            ? 0.9
            : 0.6
        : j === 0
          ? [0.9, 0.3, 0.6, 0.1][i % 4]!
          : [0.3, 0.9, 0.1, 0.6][i % 4]!;
      const compiled = compileCandidate(profile, pair),
        prompt = sha256(JSON.stringify(compiled.payload));
      const probabilities = {
        contradiction: f,
        consistent: 1 - f,
        different_scope: 0,
        insufficient_context: 0,
      };
      return {
        profile,
        pair_id: pair.id,
        pass: 1,
        prompt_sha256: prompt,
        features: {
          conflict: f,
          negative: 1 - f,
          unknown: 0,
          scope: 0,
          applicability: null,
          determinable: null,
          quantitative_decisive: null,
          numeric_probability: null,
          numeric_relation: null,
          numeric_available: false,
        },
        raw_answers: { q_0_relation: { type: "choice", probabilities } },
        prediction: {
          pair_id: pair.id,
          pass: 1,
          prompt_version: profile,
          prompt_hash: prompt,
          status: "ok",
          verdict: "uncertain",
          probabilities: { contradiction: f, no_contradiction: 1 - f, insufficient_context: 0 },
          latency_ms: 1,
        },
      };
    }),
  );
  const manifestHash = sha256(JSON.stringify(manifest)),
    run = {
      kind: "decision-quality-iteration",
      source_stable: true,
      freeze: {
        manifest_sha256: manifestHash,
        purpose,
        profiles,
        passes: 1,
        source_files: { "eval/iteration/profiles.ts": "b".repeat(64) },
      },
      observations,
    };
  return {
    manifest,
    run,
    input: () => loadCalibrationInput(run, manifest, manifestHash, sha256(JSON.stringify(run))),
  };
}

describe("fixed regularized matched-candidate fusion", () => {
  it("learns complementary candidate rankings under fixed L2 without dataset features", () => {
    const input = fixture().input(),
      scalar = fitCalibration(input, { seed: "fusion" }),
      model = fitFusion(input, { seed: "fusion" });
    expect(scalar.profiles["local-mini"]!.training_metrics.recall.value).toBe(0.5);
    expect(scalar.profiles["literal-contract"]!.training_metrics.recall.value).toBe(0.5);
    expect(model.training.zero_false_clears!.metrics.recall.value).toBe(1);
    expect(model.training.zero_false_clears!.metrics.precision.value).toBe(1);
    expect(model.training.zero_false_clears!.metrics.clear_negative_coverage.value).toBe(1);
    expect(model.model.l2).toBe(1);
    expect(model.feature_names.some((f) => /dataset|source_id|group_id|vitaminc/.test(f))).toBe(
      false,
    );
    expect(model.inner.folds.fit.some((g) => model.inner.folds.check.includes(g))).toBe(false);
    expect(model.inner.check.zero_false_clears!.metrics.recall.value).toBe(1);
    expect(fusionModelSchema.safeParse(model).success).toBe(true);
    expect(fitFusion(input, { seed: "fusion" }).model).toEqual(model.model);
  });
  it("keeps zero-false-clear and95NPV frontiers distinct rather than silently weakening safety", () => {
    const model = fitFusion(fixture("train", "tune", true).input(), { seed: "fusion" });
    expect(model.training.zero_false_clears!.metrics.false_clears).toBe(0);
    expect(model.training.zero_false_clears!.metrics.clear_negative_coverage.value).toBe(0);
    expect(model.training.npv95!.metrics.false_clears).toBe(1);
    expect(model.training.npv95!.metrics.npv.value).toBeGreaterThanOrEqual(0.95);
    expect(model.training.npv95!.metrics.npv.ci95).not.toBeNull();
    expect(model.training.npv95!.metrics.clear_negative_coverage.value).toBe(1);
  });
  it("evaluates independent frozen coefficients/policies while retaining native raw answers", () => {
    const model = fitFusion(fixture().input(), { seed: "fusion" }),
      before = JSON.stringify(model),
      input = fixture("validation", "validation").input();
    const report = evaluateFusion(model, input);
    expect(report.policies.zero_false_clears!.metrics.recall.value).toBe(1);
    expect(report.policies.zero_false_clears!.policy).toEqual(
      model.selection.policies.zero_false_clears,
    );
    expect(report.policies.zero_false_clears!.metrics.brier).toBeLessThan(0.25);
    expect(report.observations[0]!.raw_candidates[0]!.raw_answers).toEqual(
      input.rows.find((r) => r.pair.id === "validation-0" && r.profile === model.profiles[0])!
        .raw_answers,
    );
    expect(
      report.observations[0]!.calibrated_estimate.contradiction +
        report.observations[0]!.calibrated_estimate.no_contradiction,
    ).toBe(1);
    expect(report.observations[0]!.estimate_interpretation).toContain("unverified");
    expect(JSON.stringify(model)).toBe(before);
  });
  it("rejects wrong roles, diagnostic-as-model, missing matched rows, changed source and overlap", () => {
    const train = fixture().input(),
      model = fitFusion(train, { seed: "fusion" });
    expect(() =>
      fitFusion(fixture("validation", "validation").input(), { seed: "fusion" }),
    ).toThrow("tune");
    const dev = fixture().input();
    dev.manifest.pairs[0]!.split = "dev";
    expect(() => fitFusion(dev, { seed: "fusion" })).toThrow("original train");
    const missing = fixture().input();
    missing.rows.pop();
    expect(() => fitFusion(missing, { seed: "fusion" })).toThrow("complete matched");
    expect(() =>
      evaluateFusion(
        fitFusion(train, { seed: "fusion", diagnostic: true }),
        fixture("validation", "validation").input(),
      ),
    ).toThrow("Diagnostic");
    expect(() => evaluateFusion(model, train)).toThrow("independent");
    const overlap = fixture("validation", "validation").input();
    overlap.manifest.pairs[0]!.group_id = "train-group-0";
    expect(() => evaluateFusion(model, overlap)).toThrow("overlap");
    const changed = fixture("validation", "validation").input();
    changed.source_sha256 = "d".repeat(64);
    expect(() => evaluateFusion(model, changed)).toThrow("mismatch");
    const tampered = structuredClone(model);
    tampered.feature_names.reverse();
    expect(() => evaluateFusion(tampered, fixture("validation", "validation").input())).toThrow(
      "dimensions disagree",
    );
  });
  it("rejects reversed normalized training content before frozen fusion evaluation", () => {
    const model = fitFusion(fixture().input(), { seed: "fusion" }),
      input = fixture("validation", "validation").input();
    Object.assign(input.manifest.pairs[0]!, {
      claim: " TRAIN evidence 0 ",
      evidence: "train CLAIM 0",
    });
    expect(() => evaluateFusion(model, input)).toThrow("overlaps fitted training");
  });
  it("rejects corrupted frozen dimensions, folds and group hashes before access", () => {
    const model = fitFusion(fixture().input(), { seed: "fusion" });
    const dimensions = structuredClone(model);
    dimensions.model.coefficients.pop();
    expect(fusionModelSchema.safeParse(dimensions).success).toBe(false);
    const overlap = structuredClone(model);
    overlap.inner.folds.check.push(overlap.inner.folds.fit[0]!);
    expect(fusionModelSchema.safeParse(overlap).success).toBe(false);
    const hash = structuredClone(model);
    hash.training_groups_sha256 = "f".repeat(64);
    expect(fusionModelSchema.safeParse(hash).success).toBe(false);
  });
  it("selects preregistered regularization using group-OOF log loss and calibrates only pooled OOF scores", () => {
    const input = fixture().input(),
      model = fitFusion(input, { seed: "cv", regularization: "group-cv" });
    expect(model.regularization_mode).toBe("group-cv");
    expect(model.threshold_source).toBe("pooled_group_oof");
    const cv = model.cross_validation!;
    expect(cv.l2_candidates).toEqual([1, 10, 100]);
    expect(cv.folds).toHaveLength(3);
    expect(cv.oof_predictions).toHaveLength(input.manifest.pairs.length);
    expect(new Set(cv.oof_predictions.map((p) => p.pair_id)).size).toBe(
      input.manifest.pairs.length,
    );
    for (const fold of cv.folds) {
      expect(fold.fit_groups.some((g) => fold.check_groups.includes(g))).toBe(false);
      expect(fold.fit_groups_sha256).toBe(sha256(JSON.stringify(fold.fit_groups)));
      expect(
        cv.oof_predictions
          .filter((p) => p.fold === fold.index)
          .every((p) => fold.check_groups.includes(p.group)),
      ).toBe(true);
    }
    const minLoss = Math.min(...cv.losses.map((l) => l.log_loss));
    expect(cv.losses.find((l) => l.l2 === cv.selected_l2)!.log_loss).toBeCloseTo(minLoss, 12);
    expect(model.model.l2).toBe(cv.selected_l2);
    expect(
      model.inner.cross_validation!.oof_predictions.every((p) =>
        model.inner.folds.fit.includes(p.group),
      ),
    ).toBe(true);
    expect(
      model.inner.cross_validation!.oof_predictions.some((p) =>
        model.inner.folds.check.includes(p.group),
      ),
    ).toBe(false);
    const byId = new Map(input.manifest.pairs.map((p) => [p.id, p]));
    for (const point of model.selection.positive_frontier) {
      const positive = cv.oof_predictions.filter((p) => p.score >= point.threshold);
      expect(point.tp).toBe(
        positive.filter((p) => byId.get(p.pair_id)!.gold === "contradiction").length,
      );
      expect(point.fp).toBe(
        positive.filter((p) => byId.get(p.pair_id)!.gold === "non_contradiction").length,
      );
    }
    expect(model.oof!.zero_false_clears!.metrics.cases).toBe(40);
    expect(fusionModelSchema.safeParse(model).success).toBe(true);
    const report = evaluateFusion(model, fixture("validation", "validation").input());
    expect(report.policies.zero_false_clears!.policy).toEqual(
      model.selection.policies.zero_false_clears,
    );
  });
  it("prefers stronger regularization on equal OOF log loss and rejects inconsistent CV metadata", () => {
    const input = fixture().input();
    for (const row of input.rows) {
      row.features = { ...row.features, conflict: 0.5, negative: 0.5 };
      row.raw_answers = {
        q_0_relation: {
          type: "choice",
          probabilities: {
            contradiction: 0.5,
            consistent: 0.5,
            different_scope: 0,
            insufficient_context: 0,
          },
        },
      };
    }
    const model = fitFusion(input, { seed: "cv", regularization: "group-cv" });
    expect(model.cross_validation!.selected_l2).toBe(100);
    expect(model.model.l2).toBe(100);
    expect(model.selection.positive_precision_target_met).toBe(false);
    const badLoss = structuredClone(model);
    badLoss.cross_validation!.losses[0]!.log_loss = 0;
    expect(fusionModelSchema.safeParse(badLoss).success).toBe(false);
    const badFold = structuredClone(model);
    badFold.cross_validation!.folds[0]!.check_groups.push("unseen");
    expect(fusionModelSchema.safeParse(badFold).success).toBe(false);
    const duplicate = structuredClone(model);
    duplicate.cross_validation!.oof_predictions.push(
      duplicate.cross_validation!.oof_predictions[0]!,
    );
    expect(fusionModelSchema.safeParse(duplicate).success).toBe(false);
    const mislabeled = structuredClone(model);
    mislabeled.threshold_source = "in_sample_fixed_l2";
    expect(fusionModelSchema.safeParse(mislabeled).success).toBe(false);
  });
  it("keeps legacy fixed-L2 artifacts parsable", () => {
    const model = fitFusion(fixture().input(), { seed: "fusion" });
    const legacy: Record<string, unknown> = structuredClone(model);
    delete legacy.regularization_mode;
    delete legacy.threshold_source;
    expect(fusionModelSchema.safeParse(legacy).success).toBe(true);
    expect(model.model.l2).toBe(1);
    expect(model.threshold_source).toBe("in_sample_fixed_l2");
  });
  it("bounds predictions and rejects malformed coefficient/feature shapes", () => {
    const model = fitFusion(fixture().input(), { seed: "fusion" }).model;
    expect(() => predictFusion(model, [0])).toThrow("dimensions");
    const score = predictFusion(model, Array<number>(model.coefficients.length).fill(0));
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
    expect(() =>
      predictFusion(model, Array<number>(model.coefficients.length).fill(Number.NaN)),
    ).toThrow("dimensions");
  });
  it("CLI performs offline fit/evaluate and never overwrites frozen output", async () => {
    const dir = await mkdtemp(join(tmpdir(), "countercheck-fusion-")),
      log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const f = fixture(),
        r = join(dir, "run.json"),
        m = join(dir, "manifest"),
        out = join(dir, "model.json");
      await writeFile(r, JSON.stringify(f.run));
      await writeFile(m, JSON.stringify(f.manifest));
      const args = ["--mode", "fit", "--run", r, "--manifest", m, "--out", out, "--seed", "fusion"];
      await fusionCli(args);
      await expect(fusionCli(args)).rejects.toMatchObject({ code: "EEXIST" });
      const v = fixture("validation", "validation");
      await writeFile(r, JSON.stringify(v.run));
      await writeFile(m, JSON.stringify(v.manifest));
      const report = join(dir, "report.json");
      await fusionCli([
        "--mode",
        "evaluate",
        "--run",
        r,
        "--manifest",
        m,
        "--out",
        report,
        "--model",
        out,
      ]);
      expect(
        JSON.parse(await readFile(report, "utf8")).policies.zero_false_clears.metrics.recall.value,
      ).toBe(1);
      await expect(
        fusionCli([
          "--mode",
          "evaluate",
          "--run",
          r,
          "--manifest",
          m,
          "--out",
          join(dir, "bad.json"),
          "--model",
          out,
          "--regularization",
          "group-cv",
        ]),
      ).rejects.toThrow("forbids");
      await writeFile(r, JSON.stringify(f.run));
      await writeFile(m, JSON.stringify(f.manifest));
      const cvPath = join(dir, "group-cv.json");
      await fusionCli([
        "--mode",
        "fit",
        "--run",
        r,
        "--manifest",
        m,
        "--out",
        cvPath,
        "--seed",
        "cv",
        "--regularization",
        "group-cv",
      ]);
      expect(JSON.parse(await readFile(cvPath, "utf8")).threshold_source).toBe("pooled_group_oof");
    } finally {
      log.mockRestore();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
