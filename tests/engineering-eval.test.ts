import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  contentHash,
  createSplits,
  loadRole,
  partitionCases,
  targetLabel,
  validateIndex,
  contractLabelSchema,
  type EngineeringCase,
} from "../eval/engineering/manifests.js";
import { createFreeze, verifyFreeze, type Freeze } from "../eval/engineering/freeze.js";
import { executeRun, planRun, summarizeRun } from "../eval/engineering/runner.js";
import {
  features,
  fitComposition,
  labeledSignals,
  policyVerdict,
  type Features,
  type LabeledSignal,
} from "../eval/engineering/composition.js";
import { payloadForProbe } from "../eval/engineering/probes.js";
import { withPredictionCheckpoint } from "../eval/checkpoint.js";
import { compileCheck } from "../src/kernel/index.js";
import type { DecisionProvider } from "../src/providers/types.js";
import { sha256, type Manifest, type Pair, type Prediction } from "../eval/types.js";

const directories: string[] = [];
async function temporary() {
  const dir = await mkdtemp(join(tmpdir(), "engineering-eval-"));
  directories.push(dir);
  return dir;
}
afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
function pair(i: number, positive = i % 2 === 0): Pair {
  return {
    id: `case-${i}`,
    dataset: "synthetic-smoke",
    variant: "explicitly-synthetic-unit-fixture",
    split: "synthetic",
    source_id: `source-${i}`,
    group_id: `group-${Math.floor(i / 2)}`,
    claim: `Case ${i} office permits pets.`,
    evidence: `Case ${i} office ${positive ? "prohibits" : "permits"} pets.`,
    gold: positive ? "contradiction" : "non_contradiction",
    native_label: positive ? "CONTRADICTION" : "CONSISTENT",
  };
}
function item(i: number): EngineeringCase {
  const p = pair(i);
  return {
    pair: p,
    content_sha256: contentHash(p),
    group_sha256: sha256(p.group_id),
    source_manifest_sha256: "a".repeat(64),
    native_label: { label: p.native_label, binary_gold: p.gold, provenance: "synthetic-fixture" },
    service_contract: null,
    calibration_fold: null,
  };
}
function manifest(): Manifest {
  return {
    schema_version: 1,
    adapter_version: "countercheck-public-pairs-v1",
    purpose: "synthetic-smoke",
    sources: [
      {
        name: "Invented unit fixture",
        url: "local:invented",
        revision: "test-v1",
        sha256: "a".repeat(64),
        license: "CC0-1.0",
        license_url: "https://creativecommons.org/publicdomain/zero/1.0/",
      },
    ],
    sampling: {
      seed: "test",
      max_pairs: 40,
      method: "invented unit fixture",
      available_pairs: 40,
      selected_pairs: 40,
      excluded_unlabeled: 0,
      strata: {},
    },
    pairs: Array.from({ length: 40 }, (_, i) => pair(i)),
  };
}
const frozen: Freeze = {
  schema_version: 1,
  kind: "decision-engineering-freeze",
  split_lock_sha256: "a".repeat(64),
  profiles: ["balanced-v1"],
  backend: "jev",
  requested_model: "jev-1.14.0",
  files: {},
  probe_version: "paired-comparison-probes-v1",
  composition_grid: "joint-policy-grid-v1",
  production_qualification: "not_assessed",
};
const prediction = (positive: number): Prediction => ({
  pair_id: "x",
  pass: 1,
  status: "ok",
  verdict: positive >= 0.8 ? "contradiction" : positive <= 0.2 ? "no_contradiction" : "uncertain",
  raw_scores: {
    contradiction: positive,
    consistent: 1 - positive,
    different_scope: 0,
    insufficient_context: 0,
  },
  probabilities: {
    contradiction: positive,
    no_contradiction: 1 - positive,
    insufficient_context: 0,
  },
  latency_ms: 0,
});
const policy = {
  positive_threshold: 0.8,
  negative_threshold: 0.8,
  max_unknown: 0.2,
  numeric_override: true,
};

describe("engineering splits and provenance", () => {
  it("separates source groups and normalized duplicate content deterministically, including dev folds", () => {
    const cases = Array.from({ length: 40 }, (_, i) => item(i));
    cases[39]!.pair = {
      ...cases[0]!.pair,
      id: "duplicate",
      group_id: "other",
      claim: cases[0]!.pair.claim.toUpperCase(),
    };
    cases[39]!.content_sha256 = contentHash(cases[39]!.pair);
    const split = partitionCases(structuredClone(cases), "frozen-seed"),
      again = partitionCases(structuredClone(cases), "frozen-seed");
    expect(split).toEqual(again);
    const groups = new Map<string, string>();
    for (const [role, rows] of Object.entries(split))
      for (const row of rows) {
        const fold = role === "dev" ? `${role}-${row.calibration_fold}` : role;
        expect(groups.get(row.group_sha256) ?? fold).toBe(fold);
        groups.set(row.group_sha256, fold);
      }
    expect(
      Object.values(split)
        .find((rows) => rows.some((r) => r.pair.id === "case-0"))!
        .some((r) => r.pair.id === "duplicate"),
    ).toBe(true);
  });
  it("round-trips a lock, rejects source/content leaks, and refuses holdout before even opening a path", async () => {
    const dir = await temporary(),
      source = join(dir, "source.json");
    await writeFile(source, JSON.stringify(manifest()));
    const index = await createSplits([source], join(dir, "splits"), "seed");
    expect(validateIndex(index).seed).toBe("seed");
    const loaded = await loadRole(join(dir, "splits/split-lock.json"), "dev", "optimization");
    expect(loaded.manifest.cases.length).toBeGreaterThan(0);
    expect(targetLabel(loaded.manifest.cases[0]!, "service-contract")).toBeNull();
    await expect(loadRole("/nonexistent-lock", "holdout", "optimization")).rejects.toThrow(
      "forbidden",
    );
    const corrupt = structuredClone(index);
    corrupt.partitions.holdout.cases[0]!.group_sha256 =
      corrupt.partitions.train.cases[0]!.group_sha256;
    expect(() => validateIndex(corrupt)).toThrow("leak");
    await writeFile(join(dir, "splits/dev.json"), "{}");
    await expect(
      loadRole(join(dir, "splits/split-lock.json"), "dev", "optimization"),
    ).rejects.toThrow("differs");
  });
  it("rejects annotation text mismatch and never infers human adjudication", async () => {
    const p = pair(0),
      label = {
        pair_id: p.id,
        content_sha256: "b".repeat(64),
        verdict: "contradiction",
        provenance: {
          kind: "synthetic",
          source: "invented",
          method: "invented by test",
          annotators: [],
          adjudicator: null,
          real_source: false,
          authorization: "CC0",
        },
      };
    expect(contractLabelSchema.parse(label).provenance.kind).toBe("synthetic");
    expect(() =>
      contractLabelSchema.parse({
        ...label,
        provenance: { ...label.provenance, kind: "human-adjudicated" },
      }),
    ).toThrow();
    const dir = await temporary();
    await writeFile(join(dir, "source"), JSON.stringify(manifest()));
    await writeFile(join(dir, "labels"), JSON.stringify({ schema_version: 1, labels: [label] }));
    await expect(
      createSplits([join(dir, "source")], join(dir, "split"), "seed", join(dir, "labels")),
    ).rejects.toThrow("hash mismatch");
  });
  it("freezes complete selected source graph and rejects changed source bytes", async () => {
    const dir = await temporary();
    await writeFile(join(dir, "source"), JSON.stringify(manifest()));
    await createSplits([join(dir, "source")], join(dir, "split"), "seed");
    for (const sub of ["src/kernel", "eval/engineering", "scripts"])
      await mkdir(join(dir, sub), { recursive: true });
    for (const file of [
      "src/kernel/index.ts",
      "eval/engineering/test.ts",
      "eval/backends.ts",
      "eval/providers.ts",
      "eval/types.ts",
      "eval/checkpoint.ts",
      "eval/files.ts",
      "eval/args.ts",
      "eval/metrics.ts",
      "scripts/engineering-eval.ts",
      "package.json",
      "pnpm-lock.yaml",
    ])
      await writeFile(join(dir, file), "frozen");
    const index = join(dir, "split/split-lock.json"),
      file = join(dir, "freeze.json");
    await createFreeze(dir, index, ["balanced-v1"], "fake", file);
    await expect(verifyFreeze(dir, index, file)).resolves.toHaveProperty("sha256");
    await writeFile(join(dir, "eval/providers.ts"), "changed-factory");
    await expect(verifyFreeze(dir, index, file)).rejects.toThrow("sources differ");
    await writeFile(join(dir, "eval/providers.ts"), "frozen");
    await writeFile(join(dir, "src/kernel/index.ts"), "changed");
    await expect(verifyFreeze(dir, index, file)).rejects.toThrow("sources differ");
  });
});

describe("paired execution and checkpointing", () => {
  it("makes exactly one call per probe, retains only original target gold, and hashes actual sent field/criteria orders", async () => {
    const sent: string[] = [];
    const provider: DecisionProvider = {
      id: "test-no-network",
      model: "jev-1.14.0",
      async classify(payload) {
        sent.push(JSON.stringify(payload));
        return {
          model: "jev-1.14.0",
          answers: Object.fromEntries(
            Object.entries(payload.questions).map(([id, q]) => [
              id,
              {
                type: "choice",
                probabilities: Object.fromEntries(
                  Object.keys(q.criteria).map((k) => [k, k === "consistent" ? 1 : 0]),
                ),
              },
            ]),
          ),
        };
      },
    };
    const m = {
      schema_version: 1 as const,
      kind: "decision-engineering-split" as const,
      role: "dev" as const,
      seed: "s",
      sources: manifest().sources,
      cases: [item(1)],
    };
    const plan = planRun(
      m,
      frozen,
      ["clean", "repeat", "distractor", "order", "hostile", "criteria-order", "field-order"],
      7,
      0.01,
      0.07,
    );
    const checkpoint: Prediction[] = [];
    const rows = await executeRun(
      plan,
      async (p) => {
        checkpoint.push(...p);
      },
      { provider },
    );
    expect(sent).toHaveLength(7);
    expect(rows).toHaveLength(7);
    expect(new Set(rows.map((r) => r.case_id))).toEqual(new Set([m.cases[0]!.pair.id]));
    for (const [i, row] of rows.entries()) {
      expect(row.compiled_sha256).toBe(sha256(sent[i]!));
      expect(row.prediction.prompt_hash).toBe(row.compiled_sha256);
    }
    expect(rows[0]!.compiled_sha256).toBe(rows[1]!.compiled_sha256);
    expect(rows[0]!.compiled_sha256).not.toBe(rows[5]!.compiled_sha256);
    expect(rows[0]!.compiled_sha256).not.toBe(rows[6]!.compiled_sha256);
    expect(checkpoint[2]!.probe_comparisons).toHaveLength(2);
    expect(summarizeRun(m, rows).all_observations).toBe(7);
    expect(() => planRun(m, frozen, ["clean"], 0, 0.01, 1)).toThrow("limits");
    const publicCase = { ...item(0), pair: { ...pair(0), dataset: "vitaminc" as const } };
    expect(() =>
      planRun({ ...m, cases: [publicCase] }, { ...frozen, backend: "fake" }, ["clean"], 1, 0.01, 1),
    ).toThrow("synthetic");
  });
  it("preserves completed requests after a checkpoint failure and stops further paid dispatch", async () => {
    const dir = await temporary();
    let calls = 0;
    const provider: DecisionProvider = {
      id: "test",
      model: "jev-1.14.0",
      async classify(payload) {
        calls++;
        return {
          answers: Object.fromEntries(
            Object.keys(payload.questions).map((id) => [
              id,
              {
                type: "choice",
                probabilities: {
                  contradiction: 0,
                  consistent: 1,
                  different_scope: 0,
                  insufficient_context: 0,
                },
              },
            ]),
          ),
        };
      },
    };
    const m = {
      schema_version: 1 as const,
      kind: "decision-engineering-split" as const,
      role: "dev" as const,
      seed: "s",
      sources: manifest().sources,
      cases: [item(1)],
    };
    const path = join(dir, "predictions.jsonl");
    await expect(
      withPredictionCheckpoint(path, { manifest_sha256: "a".repeat(64) }, (append) =>
        executeRun(
          planRun(m, frozen, ["clean", "repeat"], 2, 0.01, 1),
          async (rows) => {
            await append(rows);
            throw new Error("disk summary failure");
          },
          { provider },
        ),
      ),
    ).rejects.toThrow("disk");
    expect(calls).toBe(1);
    expect((await readFile(path, "utf8")).trim().split("\n")).toHaveLength(1);
  });
  it("preserves candidate payload attribution and structured signal shape on all fake profiles", async () => {
    const m = {
      schema_version: 1 as const,
      kind: "decision-engineering-split" as const,
      role: "dev" as const,
      seed: "s",
      sources: manifest().sources,
      cases: [
        {
          ...item(0),
          pair: {
            ...pair(0),
            claim: "Atlas costs exactly $20 monthly.",
            evidence: "Atlas costs exactly $35 monthly.",
          },
        },
      ],
    };
    const rows = await executeRun(
      planRun(
        m,
        {
          ...frozen,
          backend: "fake",
          requested_model: "fake-no-model",
          profiles: ["balanced-v1", "semantic-v2", "structured-value-v1"],
        },
        ["clean"],
        3,
        0.01,
        1,
      ),
      async () => {},
    );
    expect(rows.every((r) => r.prediction.status === "ok")).toBe(true);
    const structured = rows.find((r) => r.profile === "structured-value-v1")!;
    expect(structured.prediction.structured_signals).toBeDefined();
    expect(structured.prediction.probabilities).toBeUndefined();
    const request = {
      model: "jev-1.14.0" as const,
      claim: { id: "c", text: m.cases[0]!.pair.claim },
      against: [{ id: "e", text: m.cases[0]!.pair.evidence }],
      profile: "structured-value-v1" as const,
    };
    const payload = compileCheck(request, "fake-no-model").payload;
    const reversed = payloadForProbe(payload, "criteria-order");
    expect(new Set(Object.keys(reversed.questions))).toEqual(
      new Set(Object.keys(payload.questions)),
    );
  });
});

describe("dev-only joint composition", () => {
  it("keeps numeric overlap uncertain and blocks incomplete extraction despite a strong semantic reference", () => {
    const f: Features = {
      semantic_positive: 0,
      semantic_negative: 0,
      numeric_positive: 0,
      numeric_negative: 0.99,
      unknown_mass: 0,
      numeric_eligible: true,
      forced_uncertain: false,
    };
    expect(policyVerdict(f, policy)).toBe("uncertain");
    const base = prediction(0.99);
    const structured: Prediction = {
      pair_id: "x",
      pass: 1,
      status: "ok",
      verdict: "uncertain",
      latency_ms: 0,
      structured_signals: {
        method: "candidate_pair_choice_v1",
        selected_choice: "contradiction",
        pair_probability: null,
        selection: { probabilities: { contradiction: 1 } },
        selected_pair: null,
        numeric_relation: null,
        numeric_reason: "incomplete_candidate_coverage",
        decision_basis: "uncertain",
        candidate_coverage: {
          claim: { recognized_spans: 1, unsupported_spans: 0, overflow: false },
          against: { recognized_spans: 0, unsupported_spans: 0, overflow: false },
        },
      },
    };
    expect(policyVerdict(features(structured, base), policy)).toBe("uncertain");
    expect(features(structured)?.numeric_eligible).toBe(false);
  });
  it("selects on tune only, reports validation separately, and rejects group leaks/unmatched predictions", () => {
    const rows: LabeledSignal[] = Array.from({ length: 8 }, (_, i) => {
      const c = {
        ...item(i),
        group_sha256: sha256(`unique-${i}`),
        calibration_fold: i < 4 ? ("tune" as const) : ("validation" as const),
      };
      return {
        item: c,
        label: i % 2 === 0 ? "contradiction" : "no_contradiction",
        features: features(prediction(i % 2 === 0 ? 0.85 : 0.1)),
        original: prediction(i % 2 === 0 ? 0.85 : 0.1),
      };
    });
    const first = fitComposition(rows);
    const second = fitComposition(
      rows.map((r) =>
        r.item.calibration_fold === "validation"
          ? {
              ...r,
              label:
                r.label === "contradiction"
                  ? ("no_contradiction" as const)
                  : ("contradiction" as const),
            }
          : r,
      ),
    );
    expect(first.policy).toEqual(second.policy);
    expect(first.validation).not.toEqual(second.validation);
    expect(first.selection_uses_validation).toBe(false);
    const leak = structuredClone(rows);
    leak[4]!.item.group_sha256 = leak[0]!.item.group_sha256;
    expect(() => fitComposition(leak)).toThrow("leakage");
    expect(() =>
      labeledSignals(
        [item(0)],
        [
          {
            sequence: 0,
            case_id: "holdout-pair",
            profile: "balanced-v1",
            probe: "clean",
            prediction: prediction(0.9),
            compiled_sha256: null,
            compiled_bytes: null,
          },
        ],
        "balanced-v1",
        null,
        "native",
      ),
    ).toThrow("heldout");
    expect(() => labeledSignals([item(0)], [], "balanced-v1", null, "native")).toThrow("Missing");
  });
  it("excludes the known synthetic unknown proxies from native binary quality and calibration", () => {
    const unknown: EngineeringCase = {
      ...item(1),
      group_sha256: sha256("unknown-validation-only"),
      pair: {
        ...pair(1),
        native_label: "uncertain",
        source_metadata: { expected_verdict: "uncertain" },
      },
      native_label: {
        label: "uncertain",
        binary_gold: "non_contradiction",
        provenance: "synthetic-fixture",
      },
      calibration_fold: "validation",
    };
    const p = { ...prediction(0.1), pair_id: unknown.pair.id, prompt_hash: "a".repeat(64) };
    const observations = [
      {
        sequence: 0,
        case_id: unknown.pair.id,
        profile: "balanced-v1" as const,
        probe: "clean",
        prediction: p,
        compiled_sha256: "a".repeat(64),
        compiled_bytes: 100,
      },
    ];
    expect(targetLabel(unknown, "native")).toBe("uncertain");
    const m = {
      schema_version: 1 as const,
      kind: "decision-engineering-split" as const,
      role: "dev" as const,
      seed: "s",
      sources: manifest().sources,
      cases: [unknown],
    };
    expect(summarizeRun(m, observations)).toMatchObject({
      by_profile: {
        "balanced-v1": {
          labels: {
            native: {
              binary: {
                denominator: 0,
                probability_denominator: 0,
                brier: null,
                confusion: { true_negative: 0 },
              },
              expected_uncertain_excluded_from_binary: 1,
            },
          },
        },
      },
    });
    const rows = labeledSignals([unknown], observations, "balanced-v1", null, "native");
    const positive: LabeledSignal = {
      item: { ...item(0), calibration_fold: "tune" },
      label: "contradiction",
      features: features(prediction(0.9)),
      original: prediction(0.9),
    };
    const negative: LabeledSignal = {
      item: { ...item(3), calibration_fold: "tune" },
      label: "no_contradiction",
      features: features(prediction(0.1)),
      original: prediction(0.1),
    };
    const fit = fitComposition([positive, negative, ...rows]);
    expect(fit.validation.binary_cases).toBe(0);
    expect(fit.validation.tn).toBe(0);
    expect(fit.joint_empirical_calibration.validation.scored_cases).toBe(0);
    expect(fit.joint_empirical_calibration.validation.brier).toBeNull();
    expect(
      targetLabel({ ...unknown, pair: { ...unknown.pair, dataset: "vitaminc" } }, "native"),
    ).toBe("no_contradiction");
  });
  it("has executable help with no credentials or model access", async () => {
    const result = await promisify(execFile)(
      process.execPath,
      ["--import", "tsx", "scripts/engineering-eval.ts", "--help"],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          TYPESAFE_API_KEY: "",
          CLOUDFLARE_API_TOKEN: "",
          OPENROUTER_API_KEY: "",
        },
      },
    );
    expect(result.stdout).toContain("calibrate");
    expect(result.stdout).toContain("Human500/locked200");
  });
});

describe("engineering CLI workflow", () => {
  it("runs split/freeze/fake/dev-calibration/one-shot-holdout without labels leaking into optimization", async () => {
    const dir = await temporary(),
      source = join(dir, "source.json"),
      split = join(dir, "splits"),
      index = join(split, "split-lock.json"),
      freeze = join(dir, "freeze.json"),
      dev = join(dir, "dev"),
      calibration = join(dir, "calibration.json"),
      holdout = join(dir, "holdout");
    await writeFile(source, JSON.stringify(manifest()));
    const cli = (args: string[]) =>
      promisify(execFile)(
        process.execPath,
        ["--import", "tsx", "scripts/engineering-eval.ts", ...args],
        {
          cwd: process.cwd(),
          env: {
            ...process.env,
            TYPESAFE_API_KEY: "",
            CLOUDFLARE_API_TOKEN: "",
            OPENROUTER_API_KEY: "",
          },
        },
      );
    await cli(["split", "--manifests", source, "--dir", split, "--seed", "full-smoke"]);
    await cli([
      "freeze",
      "--index",
      index,
      "--profiles",
      "balanced-v1,semantic-v2,structured-value-v1",
      "--backend",
      "fake",
      "--out",
      freeze,
    ]);
    const budget = ["--max-calls", "1000", "--cost-per-call-usd", "0.01", "--max-spend-usd", "10"];
    await cli([
      "run",
      "--index",
      index,
      "--freeze",
      freeze,
      "--role",
      "dev",
      "--out",
      dev,
      ...budget,
    ]);
    await cli([
      "calibrate",
      "--index",
      index,
      "--freeze",
      freeze,
      "--run",
      `${dev}.json`,
      "--profile",
      "structured-value-v1",
      "--semantic-profile",
      "semantic-v2",
      "--label-space",
      "native",
      "--out",
      calibration,
    ]);
    const malformed = JSON.parse(await readFile(calibration, "utf8")) as {
      policy: { positive_threshold: number };
    };
    malformed.policy.positive_threshold = 2;
    const malformedPath = join(dir, "malformed-calibration.json"),
      rejectedPrefix = join(dir, "rejected-holdout");
    await writeFile(malformedPath, JSON.stringify(malformed));
    await expect(
      cli([
        "holdout",
        "--index",
        index,
        "--freeze",
        freeze,
        "--calibration",
        malformedPath,
        "--out",
        rejectedPrefix,
        ...budget,
      ]),
    ).rejects.toThrow();
    await expect(readFile(`${rejectedPrefix}.predictions.jsonl`)).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(readFile(`${index}.holdout-opened.json`)).rejects.toMatchObject({
      code: "ENOENT",
    });
    await cli([
      "holdout",
      "--index",
      index,
      "--freeze",
      freeze,
      "--calibration",
      calibration,
      "--out",
      holdout,
      ...budget,
    ]);
    const report = JSON.parse(await readFile(`${holdout}.json`, "utf8")) as {
      role: string;
      observations: { probe: string }[];
      composition: { tuning: boolean };
    };
    expect(report.role).toBe("holdout");
    expect(report.composition.tuning).toBe(false);
    expect(report.observations.every((o) => o.probe === "clean")).toBe(true);
    await expect(
      cli([
        "holdout",
        "--index",
        index,
        "--freeze",
        freeze,
        "--calibration",
        calibration,
        "--out",
        join(dir, "another"),
        ...budget,
      ]),
    ).rejects.toThrow();
    await expect(
      cli([
        "calibrate",
        "--index",
        index,
        "--freeze",
        freeze,
        "--run",
        `${holdout}.json`,
        "--profile",
        "structured-value-v1",
        "--label-space",
        "native",
        "--out",
        join(dir, "forbidden"),
      ]),
    ).rejects.toThrow();
    await expect(cli(["holdout", "--role", "train"])).rejects.toThrow();
    await expect(cli(["calibrate", "--probes", "repeat"])).rejects.toThrow();
  }, 15000);
});
