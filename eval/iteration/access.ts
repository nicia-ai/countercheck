import { realpath, writeFile } from "node:fs/promises";
import { z } from "zod";
import { sha256, validateManifest, type Manifest } from "../types.js";
import { assertDisjointFromTraining, modelSchema } from "./calibrate.js";
import { fusionModelSchema } from "./fusion.js";
import { candidateSourceHash, type ExecutionIdentity } from "./fingerprint.js";
import type { CandidateId } from "./profiles.js";

export type IterationPurpose = "tune" | "validation" | "regression";
const protocolSchema = z
  .object({
    role: z.enum(["screen", "fit", "validation", "locked-holdout"]),
    original_split: z.literal("train"),
    optimization_allowed: z.boolean(),
    locked_until_candidate_and_policy_frozen: z.boolean(),
  })
  .passthrough();
type Protocol = z.infer<typeof protocolSchema>;

/** Inspect only the role header before opening locked pairs for validation or metrics. */
export function iterationProtocol(value: unknown): Protocol | null {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid iteration manifest.");
  if (!Object.hasOwn(value, "iteration_protocol")) return null;
  const protocol = protocolSchema.parse((value as Record<string, unknown>).iteration_protocol);
  if (
    protocol.optimization_allowed !== ["screen", "fit"].includes(protocol.role) ||
    protocol.locked_until_candidate_and_policy_frozen !== (protocol.role === "locked-holdout")
  )
    throw new Error("Iteration role and protection flags disagree.");
  return protocol;
}

function unique(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}
function validateLockedPolicy(
  value: unknown,
  profiles: readonly CandidateId[],
  sourceFiles: Record<string, string>,
  execution?: ExecutionIdentity,
) {
  const model = z.union([modelSchema, fusionModelSchema]).parse(value);
  if (model.kind !== "iteration-threshold-model" && model.kind !== "iteration-logistic-fusion")
    throw new Error("A fitted model is required; diagnostic searches cannot unlock holdout.");
  if (
    !sourceFiles["eval/iteration/profiles.ts"] ||
    model.candidate_source_sha256 !== candidateSourceHash(sourceFiles, execution)
  )
    throw new Error("Locked candidate compiler/runtime differs from fitted policy.");
  if (
    !profiles.length ||
    !unique(profiles) ||
    JSON.stringify(
      (Array.isArray(model.profiles) ? [...model.profiles] : Object.keys(model.profiles)).sort(),
    ) !== JSON.stringify([...profiles].sort())
  )
    throw new Error("Locked fitted policy/profile coverage mismatch.");
  const groups = model.training_groups;
  const innerFolds =
    model.kind === "iteration-threshold-model"
      ? modelSchema.parse(model).inner_folds
      : z
          .object({
            folds: z.strictObject({ fit: z.array(z.string()), check: z.array(z.string()) }),
          })
          .parse("inner" in model ? model.inner : undefined).folds;
  const folds = [...innerFolds.fit, ...innerFolds.check];
  if (
    groups.length < 5 ||
    !unique(groups) ||
    !model.training_sources.length ||
    !unique(model.training_sources) ||
    !model.training_content.length ||
    !unique(model.training_content) ||
    model.training_groups_sha256 !== sha256(JSON.stringify(groups)) ||
    !innerFolds.fit.length ||
    !innerFolds.check.length ||
    !unique(folds) ||
    JSON.stringify([...folds].sort()) !== JSON.stringify([...groups].sort())
  )
    throw new Error("Invalid fitted training group/hash/fold provenance.");
  return model;
}

export type IterationAccess = {
  manifest: Manifest;
  protocol: Protocol | null;
  locked: boolean;
  locked_policy_kind: "iteration-threshold-model" | "iteration-logistic-fusion" | null;
};

/** Local workflow guard: metadata and hashes do not authenticate an external adjudicator. */
export function authorizeIterationManifest(
  value: unknown,
  options: {
    purpose: IterationPurpose;
    profiles: readonly CandidateId[];
    sourceFiles: Record<string, string>;
    execution?: ExecutionIdentity;
    lockedPolicy?: unknown;
  },
): IterationAccess {
  const protocol = iterationProtocol(value);
  const locked = protocol?.role === "locked-holdout";
  if (
    (options.purpose === "tune" && !["screen", "fit"].includes(protocol?.role ?? "")) ||
    (options.purpose === "validation" &&
      !["validation", "locked-holdout"].includes(protocol?.role ?? "")) ||
    (options.purpose === "regression" &&
      protocol !== null &&
      !["screen", "fit"].includes(protocol.role))
  )
    throw new Error("Run purpose cannot access this iteration role.");
  if (!locked && options.lockedPolicy !== undefined)
    throw new Error("--locked-policy is reserved for a locked-holdout manifest.");
  // Validate the policy's kind, formulation and profile set before examining locked pairs.
  const policy = locked
    ? validateLockedPolicy(
        options.lockedPolicy,
        options.profiles,
        options.sourceFiles,
        options.execution,
      )
    : null;
  const manifest = validateManifest(value);
  if (protocol) {
    if (manifest.purpose !== "development" || manifest.pairs.some((pair) => pair.split !== "train"))
      throw new Error("Iteration roles must preserve the original train development split.");
  } else if (
    options.purpose !== "regression" ||
    (manifest.purpose !== "synthetic-smoke" &&
      (manifest.purpose !== "development" || manifest.pairs.some((pair) => pair.split !== "dev")))
  )
    throw new Error("Unassigned manifests are restricted to public-dev or synthetic regression.");
  if (policy) assertDisjointFromTraining(manifest.pairs, policy);

  return {
    manifest,
    protocol,
    locked,
    locked_policy_kind:
      policy?.kind === "iteration-logistic-fusion"
        ? "iteration-logistic-fusion"
        : policy
          ? "iteration-threshold-model"
          : null,
  };
}

/** Exclusive marker precedes inference and is never removed after failure or a partial run. */
export async function consumeLockedManifest(
  manifestPath: string,
  binding: {
    manifest_sha256: string;
    locked_policy_sha256: string;
    freeze_sha256: string;
    profiles: readonly CandidateId[];
  },
): Promise<void> {
  const canonicalPath = await realpath(manifestPath);
  await writeFile(
    `${canonicalPath}.opened.json`,
    JSON.stringify(
      {
        kind: "iteration-locked-holdout-opened",
        ...binding,
        opened_at: new Date().toISOString(),
        boundary: "local one-shot workflow marker; not a cryptographic access-control boundary",
      },
      null,
      2,
    ) + "\n",
    { flag: "wx", mode: 0o600 },
  );
}
