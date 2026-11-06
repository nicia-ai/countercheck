import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { sha256 } from "../types.js";
import { exclusiveJson, readJson, validateIndex } from "./manifests.js";

export const PROFILES = ["balanced-v1", "semantic-v2", "structured-value-v1"] as const;
export type Profile = (typeof PROFILES)[number];
export const BACKENDS = ["fake", "jev", "clef", "decider"] as const;
export type Backend = (typeof BACKENDS)[number];
export const MODELS: Record<Backend, string> = {
  fake: "fake-no-model",
  jev: "jev-1.14.0",
  clef: "clef",
  decider: "perplexity/pplx-decider-v1.2",
};
export type Freeze = {
  schema_version: 1;
  kind: "decision-engineering-freeze";
  split_lock_sha256: string;
  profiles: Profile[];
  backend: Backend;
  requested_model: string;
  files: Record<string, string>;
  probe_version: "paired-comparison-probes-v1";
  composition_grid: "joint-policy-grid-v1";
  production_qualification: "not_assessed";
};
async function sourceFiles(root: string, directory: string): Promise<string[]> {
  const entries = await readdir(join(root, directory), { withFileTypes: true });
  const result: string[] = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...(await sourceFiles(root, path)));
    else if (entry.isFile() && path.endsWith(".ts")) result.push(path);
  }
  return result;
}
export async function sourceHashes(root: string) {
  // Include the complete portable compiler/provider graph and evaluation runtime.
  const files = [
    ...(await sourceFiles(root, "src")),
    ...(await sourceFiles(root, "eval/engineering")),
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
  ].sort();
  return Object.fromEntries(
    await Promise.all(files.map(async (file) => [file, sha256(await readFile(join(root, file)))])),
  );
}
export async function createFreeze(
  root: string,
  indexPath: string,
  profiles: Profile[],
  backend: Backend,
  out: string,
): Promise<Freeze> {
  const input = await readJson(indexPath);
  validateIndex(input.value);
  if (
    !profiles.length ||
    new Set(profiles).size !== profiles.length ||
    profiles.some((p) => !PROFILES.includes(p))
  )
    throw new Error("Invalid profiles.");
  const frozen: Freeze = {
    schema_version: 1,
    kind: "decision-engineering-freeze",
    split_lock_sha256: input.sha256,
    profiles,
    backend,
    requested_model: MODELS[backend],
    files: await sourceHashes(root),
    probe_version: "paired-comparison-probes-v1",
    composition_grid: "joint-policy-grid-v1",
    production_qualification: "not_assessed",
  };
  await exclusiveJson(out, frozen);
  return frozen;
}
export async function verifyFreeze(root: string, indexPath: string, freezePath: string) {
  const input = await readJson(freezePath),
    frozen = input.value as Freeze;
  if (
    frozen.kind !== "decision-engineering-freeze" ||
    frozen.schema_version !== 1 ||
    !BACKENDS.includes(frozen.backend) ||
    frozen.requested_model !== MODELS[frozen.backend] ||
    !frozen.profiles?.length ||
    frozen.profiles.some((p) => !PROFILES.includes(p))
  )
    throw new Error("Invalid engineering freeze.");
  const index = await readJson(indexPath);
  validateIndex(index.value);
  if (index.sha256 !== frozen.split_lock_sha256)
    throw new Error("Split lock differs from profile freeze.");
  const actual = await sourceHashes(root);
  if (JSON.stringify(actual) !== JSON.stringify(frozen.files))
    throw new Error(
      "Compiler/provider/evaluator sources differ from the pre-inference freeze; create a new experiment.",
    );
  // Source names are repository-relative and never arbitrary caller-specified reads.
  if (Object.keys(actual).some((p) => relative(root, resolve(root, p)).startsWith("..")))
    throw new Error("Invalid source path.");
  return { frozen, sha256: input.sha256 };
}
