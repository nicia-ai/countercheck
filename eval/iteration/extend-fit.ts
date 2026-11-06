/** Extend optimization data only; locked labels are never opened. */
import { access, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { parseArgs } from "../args.js";
import { sha256File } from "../files.js";
import { sha256, validateManifest, type Manifest, type Pair } from "../types.js";
import { collectSelectedPairs, loadTrainingPool, select } from "./prepare.js";

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const componentLock = z.object({ sha256: hash, component_sha256: z.array(hash).min(1) });
const indexSchema = z.object({
  kind: z.literal("iteration-training-source-lock"),
  source_sha256: z.record(z.string(), hash),
  manifests: z.object({
    fit: componentLock,
    validation: componentLock,
    "locked-holdout": componentLock,
  }),
});
type SourceLock = z.infer<typeof indexSchema>;

export function selectExtension(
  components: Map<string, { vitaminc: number; scifact: number }>,
  index: SourceLock,
  seed: string,
) {
  const forbidden = new Set(Object.values(index.manifests).flatMap((m) => m.component_sha256));
  const eligible = new Map([...components].filter(([id]) => !forbidden.has(sha256(id))));
  return select(eligible, seed, 200, new Set());
}

export function mergeExtension(base: readonly Pair[], extra: readonly Pair[]): Pair[] {
  const ids = new Set(base.map((p) => p.id));
  const groups = new Set(base.map((p) => p.group_id));
  const content = (p: Pair) =>
    sha256(
      JSON.stringify(
        [p.claim, p.evidence]
          .map((s) => s.normalize("NFKC").replace(/\s+/gu, " ").trim().toLowerCase())
          .sort(),
      ),
    );
  const seenContent = new Set(base.map(content));
  for (const pair of extra) {
    if (ids.has(pair.id) || groups.has(pair.group_id) || seenContent.has(content(pair)))
      throw new Error(
        "Extension overlaps existing fit IDs, components or normalized unordered content.",
      );
    ids.add(pair.id);
  }
  const result = [...base, ...extra].sort((a, b) => a.id.localeCompare(b.id));
  const byId = new Map(result.map((p) => [p.id, p]));
  if (base.some((p) => !isDeepStrictEqual(p, byId.get(p.id))))
    throw new Error("Original fit content changed.");
  return result;
}

async function main() {
  const args = parseArgs(
    process.argv.slice(2),
    ["help", "prefix", "seed", "index", "fit"],
    ["help"],
  );
  if (args.help) {
    console.log(
      "Usage: tsx eval/iteration/extend-fit.ts [--prefix eval/data/iteration-expanded] [--seed iteration-extend-fit-v1] [--index eval/data/iteration-index.json] [--fit eval/data/iteration-fit.json]. Rebuilds original source/content closure from cached public train, excludes original fit/validation/locked components without opening locked labels, selects ~200 extra pairs per dataset, and writes -extra-fit.json, -fit.json and -index.json. No model calls. Original files remain unchanged.",
    );
    return;
  }
  const prefix = resolve(args.prefix ?? "eval/data/iteration-expanded");
  for (const suffix of ["-extra-fit.json", "-fit.json", "-index.json"]) {
    if (
      await access(prefix + suffix).then(
        () => true,
        () => false,
      )
    )
      throw new Error("Choose a fresh extension output prefix.");
  }
  const indexBytes = await readFile(args.index ?? "eval/data/iteration-index.json");
  const index = indexSchema.parse(JSON.parse(indexBytes.toString("utf8")));
  const baseBytes = await readFile(args.fit ?? "eval/data/iteration-fit.json");
  if (sha256(baseBytes) !== index.manifests.fit.sha256)
    throw new Error("Original fit hash mismatch.");
  const baseValue: unknown = JSON.parse(baseBytes.toString("utf8"));
  const base = validateManifest(baseValue);
  if (!isDeepStrictEqual(base.pairs, (baseValue as { pairs: unknown }).pairs))
    throw new Error("Original fit pairs cannot be normalized or stripped by validation.");
  const fitGroups = new Set(index.manifests.fit.component_sha256.map((h) => `iteration:${h}`));
  if (
    base.pairs.some((p) => p.split !== "train" || !fitGroups.has(p.group_id)) ||
    new Set(base.pairs.map((p) => p.group_id)).size !== fitGroups.size
  )
    throw new Error("Original fit/component provenance mismatch.");
  const pool = await loadTrainingPool();
  if (!isDeepStrictEqual(pool.hashes, index.source_sha256))
    throw new Error("Cached source hashes differ from original pool.");
  const selected = selectExtension(pool.components, index, args.seed ?? "iteration-extend-fit-v1");
  const rows = await collectSelectedPairs(pool, { extra: selected.selected });
  const excluded = new Set(Object.values(index.manifests).flatMap((m) => m.component_sha256));
  if ([...selected.selected].some((id) => excluded.has(sha256(id))))
    throw new Error("Extension crossed original fit/validation/locked components.");
  const extra = rows.extra.sort((a, b) => a.id.localeCompare(b.id));
  if (
    extra.filter((p) => p.dataset === "vitaminc").length !== selected.counts.vitaminc ||
    extra.filter((p) => p.dataset === "scifact").length !== selected.counts.scifact
  )
    throw new Error("Selected whole-component counts changed.");
  const combined = mergeExtension(base.pairs, extra);
  const outputs: Record<string, unknown> = {};
  await mkdir(dirname(prefix), { recursive: true });
  for (const [name, pairs] of [
    ["extra-fit", extra],
    ["fit", combined],
  ] as const) {
    const manifest = {
      ...base,
      sampling: {
        ...base.sampling,
        seed: args.seed ?? "iteration-extend-fit-v1",
        max_pairs: pairs.length,
        method:
          "Original source closure, full-dev/envelope exclusions; label-blind whole components; exact original fit superset for combined",
        available_pairs: [...pool.components.values()].reduce(
          (n, c) => n + c.vitaminc + c.scifact,
          0,
        ),
        selected_pairs: pairs.length,
        strata: {},
      },
      pairs,
      iteration_protocol: {
        role: "fit",
        original_split: "train",
        optimization_allowed: true,
        locked_until_candidate_and_policy_frozen: false,
        label_space: "native upstream labels only; no service-contract or human adjudication",
        base_fit_sha256: sha256(baseBytes),
        base_source_lock_sha256: sha256(indexBytes),
        extension: name,
        screen_subset_of_fit: name === "fit",
        source_grouping:
          "Original Wikipedia page/revision + SciFact connected claim/document graph + cross-dataset normalized unordered pair closure",
        sampling_bias:
          "Seeded complete-component size cap; not population-representative; original validation is a repeatedly inspected development monitor",
      },
    } satisfies Manifest & { iteration_protocol: unknown };
    validateManifest(manifest);
    const bytes = JSON.stringify(manifest, null, 2) + "\n";
    await writeFile(`${prefix}-${name}.json`, bytes, { flag: "wx", mode: 0o600 });
    outputs[name] = {
      path: `${prefix}-${name}.json`,
      sha256: sha256(bytes),
      pairs: pairs.length,
      by_dataset: {
        vitaminc: pairs.filter((p) => p.dataset === "vitaminc").length,
        scifact: pairs.filter((p) => p.dataset === "scifact").length,
      },
      component_sha256: [
        ...new Set(pairs.map((p) => p.group_id.slice("iteration:".length))),
      ].sort(),
    };
  }
  const provenance = {
    kind: "iteration-fit-extension-source-lock",
    seed: args.seed ?? "iteration-extend-fit-v1",
    source_sha256: pool.hashes,
    base_fit_sha256: sha256(baseBytes),
    base_source_lock_sha256: sha256(indexBytes),
    original_fit_unchanged: true,
    original_fit_exact_superset: true,
    excluded_original_component_hashes: [...excluded].sort(),
    source_closure:
      "Same loadTrainingPool/collectSelectedPairs helpers as original preparer; cached hashes verified identical",
    preparer_sha256: await sha256File(fileURLToPath(import.meta.url)),
    shared_preparer_sha256: await sha256File(fileURLToPath(new URL("prepare.ts", import.meta.url))),
    original_preparer_sha256: "07dfdd7f651063d4430d0c54161258ad3d8e9b09c7e5041685381270486c0ef7",
    manifests: outputs,
    holdout_labels_opened: false,
    qualification:
      "Native public-train optimization only; human500/locked200 gate unmet; no model calls",
  };
  await writeFile(`${prefix}-index.json`, JSON.stringify(provenance, null, 2) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
  console.log(JSON.stringify({ manifests: outputs, holdout_labels_opened: false, model_calls: 0 }));
}

if (
  process.argv[1] &&
  (await realpath(resolve(process.argv[1])).catch(() => null)) === fileURLToPath(import.meta.url)
)
  main().catch(() => {
    console.error(
      "Fit extension stopped. Verify source hashes, source/component provenance and fresh output paths. No model calls made.",
    );
    process.exitCode = 1;
  });
