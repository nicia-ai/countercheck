import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { z } from "zod";
import {
  sha256,
  isUncertainFixture,
  validateManifest,
  type Pair,
  type Source,
  type EvaluationVerdict,
} from "../types.js";

export const ROLES = ["train", "dev", "holdout"] as const;
export type Role = (typeof ROLES)[number];
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const contractLabelSchema = z
  .strictObject({
    pair_id: z.string().min(1),
    content_sha256: hashSchema,
    verdict: z.enum(["contradiction", "no_contradiction", "uncertain"]),
    provenance: z.strictObject({
      kind: z.enum(["synthetic", "human-adjudicated"]),
      source: z.string().min(1),
      method: z.string().min(1),
      annotators: z.array(z.string().min(1)),
      adjudicator: z.string().min(1).nullable(),
      real_source: z.boolean(),
      authorization: z.string().min(1),
    }),
  })
  .superRefine((label, ctx) => {
    if (
      label.provenance.kind === "human-adjudicated" &&
      (new Set(label.provenance.annotators).size < 2 || !label.provenance.adjudicator)
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Human adjudication requires two distinct annotators and an adjudicator assertion.",
      });
    if (label.provenance.kind === "synthetic" && label.provenance.real_source)
      ctx.addIssue({
        code: "custom",
        message: "Synthetic labels cannot assert the real-source gate.",
      });
  });
export type ContractLabel = z.infer<typeof contractLabelSchema>;
export type EngineeringCase = {
  pair: Pair;
  content_sha256: string;
  group_sha256: string;
  source_manifest_sha256: string;
  native_label: {
    label: string;
    binary_gold: Pair["gold"];
    provenance: "upstream-dataset" | "synthetic-fixture";
  };
  service_contract: ContractLabel | null;
  calibration_fold: "tune" | "validation" | null;
};
export type SplitManifest = {
  schema_version: 1;
  kind: "decision-engineering-split";
  role: Role;
  seed: string;
  sources: Source[];
  cases: EngineeringCase[];
};
export type SplitIndex = {
  schema_version: 1;
  kind: "decision-engineering-split-lock";
  seed: string;
  source_manifests: { sha256: string; name: string }[];
  label_sidecar_sha256: string | null;
  separation: "source-group-and-identical-content-components";
  holdout_protection: "workflow-only-not-cryptographic-access-control";
  partitions: Record<
    Role,
    {
      file: string;
      sha256: string;
      cases: {
        id: string;
        content_sha256: string;
        group_sha256: string;
        calibration_fold: EngineeringCase["calibration_fold"];
      }[];
    }
  >;
};
export const contentHash = (pair: Pick<Pair, "claim" | "evidence">) =>
  sha256(JSON.stringify([pair.claim, pair.evidence]));
const normalizedContentHash = (pair: Pair) =>
  sha256(
    JSON.stringify(
      [pair.claim, pair.evidence].map((s) =>
        s.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase(),
      ),
    ),
  );
export const jsonBytes = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
export async function exclusiveJson(path: string, value: unknown) {
  await writeFile(path, jsonBytes(value), { flag: "wx", mode: 0o600 });
}
export async function readJson(path: string): Promise<{ value: unknown; sha256: string }> {
  const bytes = await readFile(path);
  return { value: JSON.parse(bytes.toString("utf8")) as unknown, sha256: sha256(bytes) };
}

/** Identical normalized content joins source groups rather than being split under another ID. */
export function partitionCases(
  cases: EngineeringCase[],
  seed: string,
): Record<Role, EngineeringCase[]> {
  if (!seed || cases.length < 3)
    throw new Error("At least three independent groups and a seed are required.");
  const parent = new Map<string, string>();
  const find = (key: string): string => {
    const p = parent.get(key);
    if (!p) {
      parent.set(key, key);
      return key;
    }
    if (p === key) return key;
    const root = find(p);
    parent.set(key, root);
    return root;
  };
  const byContent = new Map<string, string>();
  for (const item of cases) {
    const group = item.group_sha256;
    find(group);
    const content = normalizedContentHash(item.pair);
    const previous = byContent.get(content);
    if (previous) {
      const a = find(group),
        b = find(previous);
      if (a !== b) parent.set(a > b ? a : b, a > b ? b : a);
    }
    byContent.set(content, group);
  }
  for (const item of cases) item.group_sha256 = find(item.group_sha256);
  const groups = [...new Set(cases.map((c) => c.group_sha256))].sort((a, b) =>
    sha256(`${seed}:${a}`).localeCompare(sha256(`${seed}:${b}`)),
  );
  if (groups.length < 5)
    throw new Error(
      "At least five independent source/content groups are required, including dev tuning and validation.",
    );
  const nTrain = Math.min(groups.length - 3, Math.max(1, Math.floor(groups.length * 0.6)));
  const nDev = Math.min(groups.length - nTrain - 1, Math.max(2, Math.floor(groups.length * 0.2)));
  const train = new Set(groups.slice(0, nTrain));
  const dev = new Set(groups.slice(nTrain, nTrain + nDev));
  const tune = new Set(groups.slice(nTrain, nTrain + Math.ceil(nDev / 2)));
  const result: Record<Role, EngineeringCase[]> = { train: [], dev: [], holdout: [] };
  for (const c of cases) {
    const role = train.has(c.group_sha256) ? "train" : dev.has(c.group_sha256) ? "dev" : "holdout";
    result[role].push({
      ...c,
      calibration_fold: role === "dev" ? (tune.has(c.group_sha256) ? "tune" : "validation") : null,
    });
  }
  for (const role of ROLES) result[role].sort((a, b) => a.pair.id.localeCompare(b.pair.id));
  return result;
}

export async function createSplits(
  paths: string[],
  directory: string,
  seed: string,
  labelsPath?: string,
) {
  const inputs = await Promise.all(
    paths.map(async (path) => ({ name: resolve(path), ...(await readJson(path)) })),
  );
  const labelInput = labelsPath ? await readJson(labelsPath) : null;
  const labels = labelInput
    ? z
        .strictObject({ schema_version: z.literal(1), labels: z.array(contractLabelSchema) })
        .parse(labelInput.value).labels
    : [];
  const labelById = new Map<string, ContractLabel>();
  for (const label of labels) {
    if (labelById.has(label.pair_id)) throw new Error("Duplicate contract annotation.");
    labelById.set(label.pair_id, label);
  }
  const seen = new Set<string>();
  const allSources: Source[] = [];
  const cases: EngineeringCase[] = [];
  for (const input of inputs) {
    const manifest = validateManifest(input.value);
    if (manifest.purpose === "locked-test" || manifest.pairs.some((p) => p.split === "test"))
      throw new Error("Never repartition a published test split for optimization.");
    allSources.push(...manifest.sources);
    for (const pair of manifest.pairs) {
      if (seen.has(pair.id)) throw new Error("Pair IDs must be unique across all input manifests.");
      seen.add(pair.id);
      const content = contentHash(pair),
        label = labelById.get(pair.id) ?? null;
      if (label && label.content_sha256 !== content)
        throw new Error("Contract annotation content hash mismatch.");
      cases.push({
        pair,
        content_sha256: content,
        group_sha256: sha256(`${pair.dataset}:${pair.group_id}`),
        source_manifest_sha256: input.sha256,
        native_label: {
          label: pair.native_label,
          binary_gold: pair.gold,
          provenance: pair.dataset === "synthetic-smoke" ? "synthetic-fixture" : "upstream-dataset",
        },
        service_contract: label,
        calibration_fold: null,
      });
    }
  }
  if (labels.some((l) => !seen.has(l.pair_id)))
    throw new Error("Annotation references an unknown pair.");
  const partitioned = partitionCases(cases, seed);
  await mkdir(directory, { recursive: true });
  const partitions = {} as SplitIndex["partitions"];
  for (const role of ROLES) {
    const file = `${role}.json`;
    const manifest: SplitManifest = {
      schema_version: 1,
      kind: "decision-engineering-split",
      role,
      seed,
      sources: allSources,
      cases: partitioned[role],
    };
    const bytes = jsonBytes(manifest);
    await writeFile(join(directory, file), bytes, { flag: "wx", mode: 0o600 });
    partitions[role] = {
      file,
      sha256: sha256(bytes),
      cases: manifest.cases.map((c) => ({
        id: c.pair.id,
        content_sha256: c.content_sha256,
        group_sha256: c.group_sha256,
        calibration_fold: c.calibration_fold,
      })),
    };
  }
  const index: SplitIndex = {
    schema_version: 1,
    kind: "decision-engineering-split-lock",
    seed,
    source_manifests: inputs.map((x) => ({ name: x.name, sha256: x.sha256 })),
    label_sidecar_sha256: labelInput?.sha256 ?? null,
    separation: "source-group-and-identical-content-components",
    holdout_protection: "workflow-only-not-cryptographic-access-control",
    partitions,
  };
  validateIndex(index);
  await exclusiveJson(join(directory, "split-lock.json"), index);
  return index;
}

export function validateIndex(value: unknown): SplitIndex {
  const index = z
    .object({
      schema_version: z.literal(1),
      kind: z.literal("decision-engineering-split-lock"),
      seed: z.string().min(1),
      source_manifests: z.array(z.strictObject({ sha256: hashSchema, name: z.string() })).min(1),
      label_sidecar_sha256: hashSchema.nullable(),
      separation: z.literal("source-group-and-identical-content-components"),
      holdout_protection: z.literal("workflow-only-not-cryptographic-access-control"),
      partitions: z.record(
        z.enum(ROLES),
        z.object({
          file: z.string().regex(/^(train|dev|holdout)\.json$/),
          sha256: hashSchema,
          cases: z.array(
            z.object({
              id: z.string(),
              content_sha256: hashSchema,
              group_sha256: hashSchema,
              calibration_fold: z.enum(["tune", "validation"]).nullable(),
            }),
          ),
        }),
      ),
    })
    .parse(value) as SplitIndex;
  const ids = new Set<string>(),
    groups = new Map<string, string>(),
    contents = new Map<string, string>();
  for (const role of ROLES) {
    const p = index.partitions[role];
    if (!p.cases.length || p.file !== `${role}.json`) throw new Error("Missing or misnamed split.");
    for (const c of p.cases) {
      if (ids.has(c.id)) throw new Error("Pair leak across splits.");
      ids.add(c.id);
      const boundary = role === "dev" ? `dev-${c.calibration_fold}` : role;
      if ((role === "dev") !== (c.calibration_fold !== null))
        throw new Error("Invalid calibration fold.");
      for (const [map, key] of [
        [groups, c.group_sha256],
        [contents, c.content_sha256],
      ] as const) {
        if (map.has(key) && map.get(key) !== boundary)
          throw new Error("Group/content leak across split or dev folds.");
        map.set(key, boundary);
      }
    }
  }
  return index;
}
export async function loadRole(
  indexPath: string,
  role: Role,
  purpose: "optimization" | "evaluation",
) {
  if (role === "holdout" && purpose !== "evaluation")
    throw new Error("Holdout is forbidden during optimization.");
  const input = await readJson(indexPath),
    index = validateIndex(input.value);
  const entry = index.partitions[role];
  const split = await readJson(join(resolve(indexPath, ".."), entry.file));
  if (split.sha256 !== entry.sha256) throw new Error("Split content differs from frozen index.");
  const m = split.value as SplitManifest;
  if (
    m.kind !== "decision-engineering-split" ||
    m.role !== role ||
    m.seed !== index.seed ||
    !Array.isArray(m.cases)
  )
    throw new Error("Invalid split manifest.");
  if (
    JSON.stringify(
      m.cases.map((c) => ({
        id: c.pair.id,
        content_sha256: c.content_sha256,
        group_sha256: c.group_sha256,
        calibration_fold: c.calibration_fold,
      })),
    ) !== JSON.stringify(entry.cases)
  )
    throw new Error("Split rows differ from lock.");
  for (const c of m.cases) {
    if (
      c.content_sha256 !== contentHash(c.pair) ||
      c.native_label.binary_gold !== c.pair.gold ||
      c.native_label.label !== c.pair.native_label
    )
      throw new Error("Invalid case provenance.");
    if (c.service_contract) {
      contractLabelSchema.parse(c.service_contract);
      if (
        c.service_contract.pair_id !== c.pair.id ||
        c.service_contract.content_sha256 !== c.content_sha256
      )
        throw new Error("Mismatched service-contract annotation.");
    }
  }
  return { manifest: m, index, index_sha256: input.sha256, manifest_sha256: split.sha256 };
}
export function targetLabel(
  item: EngineeringCase,
  space: "native" | "service-contract",
): EvaluationVerdict | null {
  if (space === "service-contract") return item.service_contract?.verdict ?? null;
  // Legacy synthetic manifests need binary proxy fields; the authored unknown target takes precedence.
  if (isUncertainFixture(item.pair)) return "uncertain";
  return item.native_label.binary_gold === "contradiction" ? "contradiction" : "no_contradiction";
}
