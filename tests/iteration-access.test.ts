import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import {
  authorizeIterationManifest,
  consumeLockedManifest,
  type IterationPurpose,
} from "../eval/iteration/access.js";
import { fitCalibration } from "../eval/iteration/calibrate.js";
import { fitFusion } from "../eval/iteration/fusion.js";
import { candidateSourceHash, type ExecutionIdentity } from "../eval/iteration/fingerprint.js";
import { sha256, type Manifest, type Pair } from "../eval/types.js";
import type { Features } from "../eval/iteration/runner.js";

const execute = promisify(execFile);
const sourceFiles = {
  "eval/iteration/profiles.ts": "b".repeat(64),
  "eval/iteration/round-two.ts": "e".repeat(64),
  "eval/iteration/runner.ts": "f".repeat(64),
};
const directories: string[] = [];
type Role = "screen" | "fit" | "validation" | "locked-holdout";
function manifest(role?: Role, prefix = "holdout") {
  const pairs: Pair[] = Array.from({ length: 20 }, (_, index) => ({
    id: `${prefix}-${index}`,
    dataset: "vitaminc",
    variant: "invented-access-test",
    split: "train",
    source_id: `${prefix}-source-${index >> 1}`,
    group_id: `${prefix}-group-${index >> 1}`,
    claim: `${prefix} claim ${index}`,
    evidence: `${prefix} evidence ${index}`,
    gold: index % 2 ? "non_contradiction" : "contradiction",
    native_label: index % 2 ? "SUPPORTS" : "REFUTES",
  }));
  const result: Manifest & { iteration_protocol?: Record<string, unknown> } = {
    schema_version: 1,
    adapter_version: "countercheck-public-pairs-v1",
    purpose: "development",
    sources: [
      {
        name: "invented",
        url: "https://example.test",
        revision: "invented",
        sha256: "a".repeat(64),
        license: "CC0",
        license_url: "https://example.test/license",
      },
    ],
    sampling: {
      seed: "invented",
      max_pairs: 20,
      method: "invented",
      available_pairs: 20,
      selected_pairs: 20,
      excluded_unlabeled: 0,
      strata: {},
    },
    pairs,
  };
  if (role)
    result.iteration_protocol = {
      role,
      original_split: "train",
      optimization_allowed: ["screen", "fit"].includes(role),
      locked_until_candidate_and_policy_frozen: role === "locked-holdout",
    };
  return result;
}
function fitted(diagnostic = false, execution?: ExecutionIdentity) {
  const train = manifest("fit", "train");
  return fitCalibration(
    {
      manifest: train,
      manifest_sha256: sha256(JSON.stringify(train)),
      run_sha256: "c".repeat(64),
      source_sha256: candidateSourceHash(sourceFiles, execution),
      profiles: ["local-mini"],
      purpose: "tune",
      passes: 1,
      rows: train.pairs.map((pair, index) => ({
        pair,
        profile: "local-mini",
        raw_answers: {},
        features: {
          conflict: index % 2 ? 0.1 : 0.9,
          negative: index % 2 ? 0.9 : 0.1,
          unknown: 0,
          scope: 0,
          applicability: null,
          determinable: null,
          quantitative_decisive: null,
          numeric_probability: null,
          numeric_relation: null,
          numeric_available: false,
        } satisfies Features,
      })),
    },
    { seed: "seed", diagnostic },
  );
}
function fittedFusion(execution?: ExecutionIdentity) {
  const train = manifest("fit", "train");
  const profiles = ["local-mini", "noul-conflict"] as const;
  return fitFusion(
    {
      manifest: train,
      manifest_sha256: sha256(JSON.stringify(train)),
      run_sha256: "c".repeat(64),
      source_sha256: candidateSourceHash(sourceFiles, execution),
      profiles: [...profiles],
      purpose: "tune",
      passes: 1,
      rows: train.pairs.flatMap((pair, index) =>
        profiles.map((profile) => ({
          pair,
          profile,
          raw_answers: {},
          features: {
            conflict: index % 2 ? 0.1 : 0.9,
            negative: index % 2 ? 0.9 : 0.1,
            unknown: 0,
            scope: 0,
            applicability: null,
            determinable: null,
            quantitative_decisive: null,
            numeric_probability: null,
            numeric_relation: null,
            numeric_available: false,
          } satisfies Features,
        })),
      ),
    },
    { seed: "seed" },
  );
}
const options = (purpose: IterationPurpose = "validation") => ({
  purpose,
  profiles: ["local-mini"] as const,
  sourceFiles,
});
async function directory() {
  const path = await mkdtemp(join(tmpdir(), "countercheck-iteration-access-"));
  directories.push(path);
  return path;
}
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("iteration role admission", () => {
  it.each(["screen", "fit"] as const)(
    "allows %s for tuning without changing original split",
    (role) => {
      const value = manifest(role);
      const result = authorizeIterationManifest(value, options("tune"));
      expect(result.manifest.pairs.every((pair) => pair.split === "train")).toBe(true);
      expect(result.protocol!.role).toBe(role);
      expect(result.locked).toBe(false);
    },
  );

  it.each(["validation", "locked-holdout"] as const)(
    "refuses tuning or regression of %s",
    (role) => {
      for (const purpose of ["tune", "regression"] as const)
        expect(() => authorizeIterationManifest(manifest(role), options(purpose))).toThrow(
          "purpose",
        );
    },
  );

  it.each(["screen", "fit"] as const)("never calls %s independent validation", (role) => {
    expect(() => authorizeIterationManifest(manifest(role), options())).toThrow("purpose");
  });

  it("allows the explicit validation role but never treats it as optimization data", () => {
    const result = authorizeIterationManifest(manifest("validation"), options());
    expect(result.protocol!.optimization_allowed).toBe(false);
    expect(result.locked).toBe(false);
  });

  it("allows unassigned original public-dev or synthetic regression, but forbids train/tune/validation bypass", async () => {
    const dev = manifest();
    dev.pairs.forEach((pair) => {
      pair.split = "dev";
    });
    expect(authorizeIterationManifest(dev, options("regression")).manifest).toBe(dev);
    for (const purpose of ["tune", "validation"] as const)
      expect(() => authorizeIterationManifest(dev, options(purpose))).toThrow("purpose");
    expect(() => authorizeIterationManifest(manifest(), options("regression"))).toThrow(
      "Unassigned",
    );
    const synthetic: unknown = JSON.parse(
      await readFile(resolve("eval/fixtures/synthetic-smoke.json"), "utf8"),
    );
    expect(authorizeIterationManifest(synthetic, options("regression")).manifest.purpose).toBe(
      "synthetic-smoke",
    );
  });

  it("rejects contradictory role flags, unknown roles and relabeled source splits", () => {
    for (const mutation of [
      { optimization_allowed: true },
      { locked_until_candidate_and_policy_frozen: true },
      { role: "pretend-validation" },
    ]) {
      const value = manifest("validation");
      Object.assign(value.iteration_protocol!, mutation);
      expect(() => authorizeIterationManifest(value, options())).toThrow();
    }
    const value = manifest("validation");
    value.pairs[0]!.split = "dev";
    expect(() => authorizeIterationManifest(value, options())).toThrow("original train");
  });
});

describe("locked fitted policy binding", () => {
  it("binds scalar and fusion models to compiler mode, backend and requested model before locked pairs are inspected", () => {
    const identities: ExecutionIdentity[] = [
      { compiler_mode: "isolated", backend: "jev", model: "jev-1.14.0" },
      { compiler_mode: "bundle", backend: "jev", model: "jev-1.14.0" },
      { compiler_mode: "bundle", backend: "clef", model: "clef" },
      { compiler_mode: "bundle", backend: "decider", model: "perplexity/pplx-decider-v1.2" },
    ];
    for (const execution of identities) {
      const scalar = fitted(false, execution),
        fusion = fittedFusion(execution);
      for (const model of [scalar, fusion]) {
        const profiles = Array.isArray(model.profiles) ? model.profiles : (["local-mini"] as const);
        expect(
          authorizeIterationManifest(manifest("locked-holdout"), {
            ...options(),
            profiles,
            execution,
            lockedPolicy: model,
          }).locked,
        ).toBe(true);
        for (const other of identities.filter((candidate) => candidate !== execution)) {
          const locked = {
            iteration_protocol: manifest("locked-holdout").iteration_protocol,
            get pairs(): never {
              throw new Error("locked pairs were inspected");
            },
          };
          expect(() =>
            authorizeIterationManifest(locked, {
              ...options(),
              profiles,
              execution: other,
              lockedPolicy: model,
            }),
          ).toThrow("compiler/runtime");
        }
      }
    }
  });
  it("binds the complete runtime map, including imported prompts and feature extraction, independent of key order", () => {
    const reversed = Object.fromEntries(Object.entries(sourceFiles).reverse());
    expect(candidateSourceHash(reversed)).toBe(candidateSourceHash(sourceFiles));
    for (const file of ["eval/iteration/round-two.ts", "eval/iteration/runner.ts"]) {
      const changed = { ...sourceFiles, [file]: "d".repeat(64) };
      expect(changed["eval/iteration/profiles.ts"]).toBe(sourceFiles["eval/iteration/profiles.ts"]);
      expect(() =>
        authorizeIterationManifest(manifest("locked-holdout"), {
          ...options(),
          lockedPolicy: fitted(),
          sourceFiles: changed,
        }),
      ).toThrow("compiler/runtime");
    }
  });
  it("accepts a frozen fitted fusion with both policies intact and rejects diagnostics or profile changes", () => {
    const model = fittedFusion();
    const value = manifest("locked-holdout");
    const opts = {
      ...options(),
      profiles: ["local-mini", "noul-conflict"] as const,
      lockedPolicy: model,
    };
    const before = JSON.stringify(model);
    expect(authorizeIterationManifest(value, opts).locked_policy_kind).toBe(
      "iteration-logistic-fusion",
    );
    expect(JSON.stringify(model)).toBe(before);
    expect(() =>
      authorizeIterationManifest(value, {
        ...opts,
        lockedPolicy: { ...model, kind: "iteration-logistic-fusion-diagnostic" },
      }),
    ).toThrow("diagnostic");
    expect(() => authorizeIterationManifest(value, { ...opts, profiles: ["local-mini"] })).toThrow(
      "coverage",
    );
    const corrupt = structuredClone(model);
    corrupt.model.coefficients.pop();
    expect(() => authorizeIterationManifest(value, { ...opts, lockedPolicy: corrupt })).toThrow();
  });
  it("opens only with an actual fitted artifact, current compiler and exact profiles", () => {
    const value = manifest("locked-holdout");
    expect(authorizeIterationManifest(value, { ...options(), lockedPolicy: fitted() }).locked).toBe(
      true,
    );
    expect(() => authorizeIterationManifest(value, options())).toThrow();
    expect(() =>
      authorizeIterationManifest(value, { ...options(), lockedPolicy: fitted(true) }),
    ).toThrow("diagnostic");
    expect(() =>
      authorizeIterationManifest(value, {
        ...options(),
        lockedPolicy: fitted(),
        sourceFiles: { "eval/iteration/profiles.ts": "d".repeat(64) },
      }),
    ).toThrow("compiler");
    expect(() =>
      authorizeIterationManifest(value, {
        ...options(),
        lockedPolicy: fitted(),
        profiles: ["nli-three-way"],
      }),
    ).toThrow("coverage");
    expect(() =>
      authorizeIterationManifest(value, {
        ...options(),
        lockedPolicy: { kind: "iteration-threshold-model" },
      }),
    ).toThrow();
    expect(() =>
      authorizeIterationManifest(manifest("validation"), { ...options(), lockedPolicy: fitted() }),
    ).toThrow("reserved");
  });

  it("rejects a diagnostic artifact before accessing any locked pairs", () => {
    const value = {
      iteration_protocol: manifest("locked-holdout").iteration_protocol,
      get pairs(): never {
        throw new Error("locked pairs were accessed");
      },
    };
    expect(() =>
      authorizeIterationManifest(value, { ...options(), lockedPolicy: fitted(true) }),
    ).toThrow("diagnostic");
  });

  it("requires coherent group hashes and complete disjoint inner-fold membership", () => {
    const badHash = fitted();
    badHash.training_groups_sha256 = "d".repeat(64);
    expect(() =>
      authorizeIterationManifest(manifest("locked-holdout"), {
        ...options(),
        lockedPolicy: badHash,
      }),
    ).toThrow("provenance");
    const badFold = fitted();
    badFold.inner_folds.check.push(badFold.inner_folds.fit[0]!);
    expect(() =>
      authorizeIterationManifest(manifest("locked-holdout"), {
        ...options(),
        lockedPolicy: badFold,
      }),
    ).toThrow("provenance");
  });

  it.each(["group", "source", "content", "reversed content"] as const)(
    "rejects fitted training %s overlap",
    (kind) => {
      const value = manifest("locked-holdout");
      const first = manifest("fit", "train").pairs[0]!;
      if (kind === "group") value.pairs[0]!.group_id = first.group_id;
      else if (kind === "source") value.pairs[0]!.source_id = first.source_id;
      else
        Object.assign(value.pairs[0]!, {
          claim: `  ${(kind === "reversed content" ? first.evidence : first.claim).toUpperCase()}  `,
          evidence: (kind === "reversed content" ? first.claim : first.evidence).replace(
            / /g,
            "  ",
          ),
        });
      expect(() =>
        authorizeIterationManifest(value, { ...options(), lockedPolicy: fitted() }),
      ).toThrow("overlaps");
    },
  );
});

describe("exclusive pre-inference consumption", () => {
  it("permits only one concurrent opening and binds policy/manifest/freeze hashes", async () => {
    const path = join(await directory(), "holdout.json");
    await writeFile(path, JSON.stringify(manifest("locked-holdout")));
    const binding = {
      manifest_sha256: "a".repeat(64),
      locked_policy_sha256: "b".repeat(64),
      freeze_sha256: "c".repeat(64),
      profiles: ["local-mini"] as const,
    };
    const results = await Promise.allSettled([
      consumeLockedManifest(path, binding),
      consumeLockedManifest(path, binding),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(JSON.parse(await readFile(path + ".opened.json", "utf8"))).toMatchObject(binding);
    expect((await stat(path + ".opened.json")).mode & 0o777).toBe(0o600);
    const alias = join(await directory(), "alias.json");
    await symlink(path, alias);
    await expect(consumeLockedManifest(alias, binding)).rejects.toMatchObject({ code: "EEXIST" });
  });

  it("CLI denies tune access to validation before creating output or opening markers", async () => {
    const dir = await directory();
    const path = join(dir, "validation.json"),
      prefix = join(dir, "run");
    await writeFile(path, JSON.stringify(manifest("validation")));
    await expect(
      execute(
        process.execPath,
        [
          resolve("node_modules/tsx/dist/cli.mjs"),
          resolve("scripts/iterate.ts"),
          "--manifest",
          path,
          "--profiles",
          "local-mini",
          "--out",
          prefix,
          "--purpose",
          "tune",
          "--live",
          "--max-calls",
          "20",
          "--cost-per-call-usd",
          ".001",
          "--max-spend-usd",
          ".02",
        ],
        { timeout: 15000, env: { ...process.env, TYPESAFE_API_KEY: "" } },
      ),
    ).rejects.toThrow();
    await expect(readFile(prefix + ".freeze.json")).rejects.toThrow();
    await expect(readFile(path + ".opened.json")).rejects.toThrow();
  });
});
