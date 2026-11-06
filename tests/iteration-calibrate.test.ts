import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main as calibrateCli } from "../scripts/calibrate-iteration.js";
import { describe, expect, it, vi } from "vitest";
import {
  loadCalibrationInput,
  fitCalibration,
  evaluateCalibration,
  calibrationMetrics,
  verdictFor,
  groupKey,
  foldGroups,
} from "../eval/iteration/calibrate.js";
import { compileCandidate } from "../eval/iteration/profiles.js";
import { extractFeatures, parseResponse } from "../eval/iteration/runner.js";
import { sha256, type Pair, type Manifest } from "../eval/types.js";

function fixture(
  prefix = "train",
  purpose: "tune" | "validation" | "regression" = "tune",
  passes = 1,
) {
  const pairs: Pair[] = Array.from({ length: 20 }, (_, i) => ({
    id: `${prefix}-${i}`,
    dataset: "vitaminc",
    variant: "test",
    split: "train",
    source_id: `${prefix}-source-${i >> 1}`,
    group_id: `${prefix}-group-${i >> 1}`,
    claim: `${prefix} claim ${i}`,
    evidence: `${prefix} evidence ${i}`,
    gold: i % 2 ? "non_contradiction" : "contradiction",
    native_label: i % 2 ? "SUPPORTS" : "REFUTES",
  }));
  const manifest: Manifest = {
    schema_version: 1,
    adapter_version: "countercheck-public-pairs-v1",
    purpose: "development",
    sources: [
      {
        name: "test",
        url: "https://example.test",
        revision: "fixture",
        sha256: "a".repeat(64),
        license: "CC0",
        license_url: "https://example.test/license",
      },
    ],
    sampling: {
      seed: "fixture",
      max_pairs: 20,
      method: "fixture",
      available_pairs: 20,
      selected_pairs: 20,
      excluded_unlabeled: 0,
      strata: {},
    },
    pairs,
  };
  const manifestHash = sha256(JSON.stringify(manifest));
  const observations = Array.from({ length: passes }, (_, pass) =>
    pairs.map((pair, i) => {
      const compiled = compileCandidate("local-mini", pair);
      const conflict = i % 2 ? 0.08 : 0.24;
      const raw = {
        answers: {
          q_0_relation: {
            type: "choice",
            probabilities: {
              contradiction: conflict,
              consistent: 1 - conflict,
              different_scope: 0,
              insufficient_context: 0,
            },
          },
        },
      };
      const features = extractFeatures(parseResponse(raw, compiled), compiled),
        promptHash = sha256(JSON.stringify(compiled.payload));
      return {
        profile: "local-mini",
        pair_id: pair.id,
        pass: pass + 1,
        prompt_sha256: promptHash,
        features,
        raw_answers: raw.answers,
        prediction: {
          pair_id: pair.id,
          pass: pass + 1,
          status: "ok",
          verdict: "uncertain",
          probabilities: {
            contradiction: conflict,
            no_contradiction: 1 - conflict,
            insufficient_context: 0,
          },
          latency_ms: 1,
          prompt_version: "local-mini",
          prompt_hash: promptHash,
        },
      };
    }),
  ).flat();
  const run = {
    kind: "decision-quality-iteration",
    source_stable: true,
    freeze: {
      manifest_sha256: manifestHash,
      profiles: ["local-mini"],
      passes,
      purpose,
      source_files: { "eval/iteration/profiles.ts": "b".repeat(64) },
    },
    observations,
  };
  const input = () =>
    loadCalibrationInput(run, manifest, manifestHash, sha256(JSON.stringify(run)));
  return { run, manifest, manifestHash, input };
}

describe("offline group-disjoint calibration", () => {
  it("finds the low native-score frontier and freezes one global policy", () => {
    const f = fixture(),
      model = fitCalibration(f.input(), { seed: "seed" });
    const result = model.profiles["local-mini"]!;
    expect(result.policy.positive).toBe(0.24);
    expect(result.precision_target_met).toBe(true);
    expect(result.training_metrics.precision.value).toBe(1);
    expect(result.training_metrics.recall.value).toBe(1);
    expect(result.training_metrics.clear_negative_coverage.value).toBe(1);
    expect(result.training_metrics.false_clears).toBe(0);
    expect(result.frontier.some((p) => p.threshold === 0.18)).toBe(true);
    expect(model.inner_folds.fit.some((g) => model.inner_folds.check.includes(g))).toBe(false);
    expect(result.inner.check_metrics.binary_cases).toBeGreaterThan(0);
    expect(model).not.toHaveProperty("probabilities");
    expect(model).toEqual(fitCalibration(f.input(), { seed: "seed" }));
  });

  it("evaluates independent validation with frozen thresholds and preserves raw signals", () => {
    const model = fitCalibration(fixture().input(), { seed: "seed" });
    const validation = fixture("validation", "validation").input();
    const before = JSON.stringify(model),
      report = evaluateCalibration(model, validation);
    expect(report.profiles["local-mini"]!.policy).toEqual(model.profiles["local-mini"]!.policy);
    expect(report.profiles["local-mini"]!.metrics.recall.value).toBe(1);
    expect(report.profiles["local-mini"]!.by_dataset.vitaminc!.precision.ci95).not.toBeNull();
    expect(report.profiles["local-mini"]!.rows[0]).toMatchObject({
      features: validation.rows[0]!.features,
      raw_answers: validation.rows[0]!.raw_answers,
      calibrated_estimate: null,
    });
    expect(JSON.stringify(model)).toBe(before);
  });

  it("reports failure honestly when no nonempty threshold meets precision", () => {
    const input = fixture().input();
    for (const row of input.rows) row.features = { ...row.features, conflict: 0.5, negative: 0.5 };
    const model = fitCalibration(input, { seed: "seed" });
    expect(model.profiles["local-mini"]!.precision_target_met).toBe(false);
    expect(model.profiles["local-mini"]!.training_metrics.precision.value).toBeNull();
    expect(model.profiles["local-mini"]!.training_metrics.recall.value).toBe(0);
    expect(model.profiles["local-mini"]!.training_metrics.false_clears).toBe(0);
  });

  it.each(["validation", "regression"] as const)("never fits %s run purpose", (purpose) => {
    expect(() => fitCalibration(fixture("bad", purpose).input(), { seed: "seed" })).toThrow(
      "explicit tune",
    );
  });
  it("never fits native dev/test or locked-test data", () => {
    for (const split of ["dev", "test"] as const) {
      const input = fixture().input();
      input.manifest.pairs.forEach((p) => (p.split = split));
      expect(() => fitCalibration(input, { seed: "seed" })).toThrow("original train");
    }
    const input = fixture().input();
    input.manifest.purpose = "locked-test";
    expect(() => fitCalibration(input, { seed: "seed" })).toThrow("explicit tune");
  });
  it("cannot treat diagnostic searches as frozen models", () => {
    const model = fitCalibration(fixture().input(), { seed: "seed", diagnostic: true });
    expect(() => evaluateCalibration(model, fixture("validation", "validation").input())).toThrow(
      "Diagnostic searches",
    );
  });

  it("rejects incomplete, duplicated, failed, feature-tampered or mismatched observations", () => {
    const mutations = [
      (f: ReturnType<typeof fixture>) => {
        f.run.observations.pop();
      },
      (f: ReturnType<typeof fixture>) => {
        f.run.observations.push(f.run.observations[0]!);
      },
      (f: ReturnType<typeof fixture>) => {
        f.run.observations[0]!.prediction.status = "error";
      },
      (f: ReturnType<typeof fixture>) => {
        f.run.observations[0]!.features.conflict = 0.9;
      },
      (f: ReturnType<typeof fixture>) => {
        f.run.observations[0]!.raw_answers.q_0_relation.probabilities.consistent = 0;
      },
      (f: ReturnType<typeof fixture>) => {
        f.run.observations[0]!.prediction.prompt_version = "other-profile";
      },
      (f: ReturnType<typeof fixture>) => {
        f.run.freeze.manifest_sha256 = "c".repeat(64);
      },
      (f: ReturnType<typeof fixture>) => {
        f.run.source_stable = false;
      },
    ];
    for (const mutate of mutations) {
      const f = fixture();
      mutate(f);
      expect(() => f.input()).toThrow();
    }
  });
  it("validates all repeat passes but never counts them as independent cases", () => {
    const input = fixture("train", "tune", 2).input();
    expect(input.rows).toHaveLength(20);
    const model = fitCalibration(input, { seed: "seed" });
    expect(model.ignored_repeat_passes).toBe(1);
    expect(model.profiles["local-mini"]!.training_metrics.cases).toBe(20);
  });
  it("rejects train/validation group, content, candidate source or profile mismatch", () => {
    const model = fitCalibration(fixture().input(), { seed: "seed" });
    const a = fixture("validation", "validation").input();
    a.manifest.pairs[0]!.group_id = "train-group-0";
    expect(() => evaluateCalibration(model, a)).toThrow("overlap");
    const b = fixture("validation", "validation").input();
    Object.assign(b.manifest.pairs[0]!, { claim: "train claim 0", evidence: "train evidence 0" });
    expect(() => evaluateCalibration(model, b)).toThrow("overlap");
    const c = fixture("validation", "validation").input();
    c.source_sha256 = "d".repeat(64);
    expect(() => evaluateCalibration(model, c)).toThrow("source changed");
    const d = fixture("validation", "validation").input();
    d.profiles = ["nli-three-way"];
    expect(() => evaluateCalibration(model, d)).toThrow("coverage mismatch");
  });
  it("rejects duplicate normalized content split across source groups", () => {
    const input = fixture().input();
    Object.assign(input.manifest.pairs[2]!, {
      claim: input.manifest.pairs[0]!.claim,
      evidence: input.manifest.pairs[0]!.evidence,
    });
    expect(() => fitCalibration(input, { seed: "seed" })).toThrow("crosses source groups");
  });
  it("reports false clears separately and excludes synthetic uncertain proxy gold", () => {
    const input = fixture().input();
    const extra = {
      ...input.rows[0]!,
      pair: {
        ...input.rows[0]!.pair,
        dataset: "synthetic-smoke" as const,
        native_label: "uncertain",
        source_metadata: { expected_verdict: "uncertain" },
      },
    };
    const rows = [...input.rows, extra];
    const report = calibrationMetrics(rows, {
      positive: 1.000001,
      negative_cut: 1,
      negative_support: 0,
    });
    expect(report.false_clears).toBe(10);
    expect(report.false_clear_rate.value).toBe(1);
    expect(report.binary_cases).toBe(20);
    expect(report.contract_diagnostics).toEqual({
      expected_uncertain: 1,
      correct_uncertain: 0,
      binary_proxy_labels_excluded: 1,
    });
  });
  it("calibrates actual composition including quantitative safety and negative-only determinability", () => {
    const base = fixture().input().rows[0]!.features,
      policy = { positive: 0.2, negative_cut: 0.1, negative_support: 0.8 };
    expect(
      verdictFor(
        { ...base, conflict: 0.99, quantitative_decisive: 0.9, numeric_available: false },
        policy,
      ),
    ).toBe("uncertain");
    expect(
      verdictFor(
        {
          ...base,
          conflict: 0.01,
          quantitative_decisive: 0.9,
          numeric_available: true,
          numeric_probability: 0.9,
          numeric_relation: "incompatible",
        },
        policy,
      ),
    ).toBe("contradiction");
    expect(verdictFor({ ...base, conflict: 0.01, negative: 0.99, determinable: 0.1 }, policy)).toBe(
      "uncertain",
    );
    expect(verdictFor({ ...base, conflict: 0.99, determinable: 0.1 }, policy)).toBe(
      "contradiction",
    );
    expect(fitCalibration(fixture().input(), { seed: "seed" }).composition_method).toBe(
      "runner_compose_default_policy_with_three_calibrated_cutoffs",
    );
  });
  it("binds calibration identity to all runtime source files, including round-two formulations", () => {
    const a = fixture(),
      b = fixture();
    Object.assign(a.run.freeze.source_files, { "eval/iteration/round-two.ts": "c".repeat(64) });
    Object.assign(b.run.freeze.source_files, { "eval/iteration/round-two.ts": "d".repeat(64) });
    expect(a.input().source_sha256).not.toBe(b.input().source_sha256);
  });
  it("reads legacy missing determinability as null without rewriting raw answers", () => {
    const f = fixture(),
      before = JSON.stringify(f.run.observations[0]!.raw_answers);
    for (const o of f.run.observations) {
      const { determinable: discarded, ...legacy } = o.features;
      void discarded;
      o.features = legacy as typeof o.features;
    }
    expect(f.input().rows[0]!.features.determinable).toBeNull();
    expect(JSON.stringify(f.run.observations[0]!.raw_answers)).toBe(before);
  });
  it("rejects reversed normalized training content under new evaluation identities", () => {
    const model = fitCalibration(fixture().input(), { seed: "seed" }),
      input = fixture("validation", "validation").input();
    Object.assign(input.manifest.pairs[0]!, {
      claim: "  TRAIN evidence 0 ",
      evidence: "TRAIN claim 0",
    });
    expect(() => evaluateCalibration(model, input)).toThrow("overlaps fitted training");
  });
  it("keeps prepared cross-dataset components together for forward and reversed duplicates", () => {
    for (const reverse of [false, true]) {
      const input = fixture().input(),
        component = "a".repeat(64),
        original = input.manifest.pairs[0]!;
      const a: Pair = {
        ...original,
        group_id: `iteration:${component}`,
        source_metadata: { iteration_component_sha256: component },
      };
      const b: Pair = {
        ...a,
        id: "scifact-linked",
        dataset: "scifact",
        source_id: "scifact-linked",
        native_label: "CONTRADICT",
        claim: reverse ? a.evidence : a.claim,
        evidence: reverse ? a.claim : a.evidence,
        rationale: { document_id: "1", sentence_indices: [0], set_index: 0 },
      };
      expect(groupKey(a)).toBe(groupKey(b));
      const folds = foldGroups([a, b, ...input.manifest.pairs.slice(2)], "0");
      expect(
        [...folds.fit, ...folds.check].filter((g) => g === `iteration:${component}`),
      ).toHaveLength(1);
      expect(folds.fit.includes(groupKey(a))).toBe(folds.fit.includes(groupKey(b)));
    }
    const raw = fixture().manifest.pairs[0]!;
    expect(groupKey(raw)).toBe(`vitaminc:${raw.group_id}`);
    expect(() =>
      groupKey({
        ...raw,
        group_id: `iteration:${"b".repeat(64)}`,
        source_metadata: { iteration_component_sha256: "a".repeat(64) },
      }),
    ).toThrow("canonical");
    expect(() => groupKey({ ...raw, group_id: `iteration:${"a".repeat(64)}` })).toThrow(
      "canonical",
    );
  });
  it("CLI writes a fresh offline model, refuses overwrite and evaluates frozen parameters", async () => {
    const dir = await mkdtemp(join(tmpdir(), "countercheck-calibration-"));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const train = fixture(),
        validation = fixture("validation", "validation");
      const run = join(dir, "train.json"),
        manifest = join(dir, "train.manifest"),
        model = join(dir, "model.json");
      await writeFile(run, JSON.stringify(train.run));
      await writeFile(manifest, JSON.stringify(train.manifest));
      const args = [
        "--mode",
        "fit",
        "--run",
        run,
        "--manifest",
        manifest,
        "--out",
        model,
        "--seed",
        "seed",
      ];
      await calibrateCli(args);
      expect(JSON.parse(await readFile(model, "utf8")).kind).toBe("iteration-threshold-model");
      await expect(calibrateCli(args)).rejects.toMatchObject({ code: "EEXIST" });
      const validationRun = join(dir, "validation.json"),
        validationManifest = join(dir, "validation.manifest"),
        report = join(dir, "report.json");
      await writeFile(validationRun, JSON.stringify(validation.run));
      await writeFile(validationManifest, JSON.stringify(validation.manifest));
      await calibrateCli([
        "--mode",
        "evaluate",
        "--run",
        validationRun,
        "--manifest",
        validationManifest,
        "--model",
        model,
        "--out",
        report,
      ]);
      expect(
        JSON.parse(await readFile(report, "utf8")).profiles["local-mini"].metrics.recall.value,
      ).toBe(1);
    } finally {
      log.mockRestore();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
