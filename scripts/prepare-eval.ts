import { writeFile, mkdir, stat, rename } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { Readable, Transform } from "node:stream";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DATASETS,
  jsonLines,
  vitaminPair,
  sciPairs,
  strata,
  sampleGroups,
  groupStatistics,
  SAMPLING_BIAS,
  type SciDocument,
} from "../eval/datasets.js";
import { parseArgs, positiveInteger } from "../eval/args.js";
import { sha256File } from "../eval/files.js";
import { validateManifest, type Pair, type Source, type Manifest } from "../eval/types.js";

const HELP = `Prepare a frozen public supplied-evidence pair manifest (no model calls).
Usage: pnpm eval:prepare --dataset vitaminc --input FILE --variant combined --split dev --out FILE
       pnpm eval:prepare --dataset scifact --claims FILE --corpus FILE --split dev --out FILE
       pnpm eval:prepare --dataset scifact --download --split dev --out FILE
Options:
  --dataset vitaminc|scifact       Required; no unsupported datasets downloaded
  --variant real|synthetic|combined  Required; real/synthetic archives are test-only
  --split train|dev|test          Required original split (SciFact test lacks public gold)
  --input FILE                   Local VitaminC JSONL (id/unique_id, claim,evidence,label/gold_label)
  --claims FILE --corpus FILE     Local SciFact release JSONL files
  --download                     Explicitly fetch official archive; only selected split extracted
  --cache DIR                    Default eval/data/<dataset>-<variant>
  --source-url URL --revision ID  Optional provenance override for manually obtained data
  --max-pairs N --seed TEXT       Default 200, countercheck-v1; whole contrast groups preserved
  --out FILE                     Required output JSON; refuses overwrite
  --help                         Print help
Sampling reports achieved strata and may undershoot size to retain whole groups.
Use dev only to develop prompts/thresholds. A test manifest is locked-test, never tuning data.
Archives can be mutable upstream: exact downloaded file hashes are recorded. No published score is implied.`;
async function download(url: string, path: string): Promise<void> {
  try {
    await stat(path);
    return;
  } catch {
    /* first download */
  }
  const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok || !response.body) throw new Error("Dataset download failed");
  const max = 512 * 1024 * 1024;
  if (Number(response.headers.get("content-length")) > max)
    throw new Error("Dataset download exceeds 512 MiB cap; import local files");
  let bytes = 0;
  const cap = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.length;
      callback(bytes > max ? new Error("Dataset download exceeds cap") : null, chunk);
    },
  });
  // A failed/partial archive never becomes a cache hit.
  const partial = `${path}.partial`;
  await pipeline(
    Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]),
    cap,
    createWriteStream(partial),
  );
  await rename(partial, path);
}
async function main(): Promise<void> {
  const args = parseArgs(
    process.argv.slice(2),
    [
      "help",
      "dataset",
      "variant",
      "split",
      "input",
      "claims",
      "corpus",
      "download",
      "cache",
      "source-url",
      "revision",
      "max-pairs",
      "seed",
      "out",
    ],
    ["help", "download"],
  );
  if (args.help) {
    process.stdout.write(`${HELP}\n`);
    return;
  }
  if (
    !["vitaminc", "scifact"].includes(args.dataset ?? "") ||
    !["train", "dev", "test"].includes(args.split ?? "") ||
    !args.out
  )
    throw new Error("Required: --dataset, --split, --out; use --help");
  const dataset = args.dataset as "vitaminc" | "scifact";
  const split = args.split as Pair["split"];
  if (dataset === "scifact" && split === "test")
    throw new Error(
      "SciFact test gold rationales are not public; use dev for an honest development baseline",
    );
  if (dataset === "vitaminc" && !["real", "synthetic", "combined"].includes(args.variant ?? ""))
    throw new Error("VitaminC requires --variant real|synthetic|combined");
  if (args.download && dataset === "vitaminc" && args.variant !== "combined" && split !== "test")
    throw new Error(
      "Official real/synthetic archives contain test only; use --variant combined for dev/train",
    );
  const cache = resolve(args.cache ?? `eval/data/${dataset}-${args.variant ?? "release"}`);
  let archivePath: string | undefined;
  let archiveUrl: string | undefined;
  if (args.download) {
    if (args.input || args.claims || args.corpus)
      throw new Error("Choose --download or local input files");
    await mkdir(cache, { recursive: true });
    archiveUrl =
      dataset === "scifact"
        ? "https://scifact.s3-us-west-2.amazonaws.com/release/latest/data.tar.gz"
        : `https://github.com/TalSchuster/talschuster.github.io/raw/master/static/${args.variant === "combined" ? "vitaminc" : `vitaminc_${args.variant}`}.zip`;
    archivePath = join(cache, dataset === "scifact" ? "data.tar.gz" : "data.zip");
    await download(archiveUrl, archivePath);
    await promisify(execFile)("python3", [
      fileURLToPath(new URL("../eval/archive.py", import.meta.url)),
      archivePath,
      cache,
      dataset,
      split,
    ]);
    args.input = join(cache, `${split}.jsonl`);
    args.claims = join(cache, `claims_${split}.jsonl`);
    args.corpus = join(cache, "corpus.jsonl");
  }
  const sources: Source[] = [];
  const info = DATASETS[dataset];
  for (const path of dataset === "vitaminc" ? [args.input] : [args.claims, args.corpus]) {
    if (!path) throw new Error("Missing input files; use --help");
    sources.push({
      name: path.split("/").at(-1) ?? "input",
      url: args["source-url"] ?? archiveUrl ?? info.url,
      revision:
        args.revision ?? `${info.revision} (repository documentation; data bytes pinned by sha256)`,
      sha256: await sha256File(path),
      license: info.license,
      license_url: info.license_url,
    });
  }
  if (archivePath && archiveUrl)
    sources.push({
      name: "download-archive",
      url: archiveUrl,
      revision: "mutable official release URL; exact archive pinned by sha256",
      sha256: await sha256File(archivePath),
      license: info.license,
      license_url: info.license_url,
    });
  const all: Pair[] = [];
  let unlabeled = 0;
  if (dataset === "vitaminc") {
    for await (const row of jsonLines(args.input ?? "")) {
      const pair = vitaminPair(row, split, args.variant as "real" | "synthetic" | "combined");
      if (pair) all.push(pair);
      else unlabeled++;
    }
  } else {
    const corpus = new Map<string, SciDocument>();
    for await (const row of jsonLines(args.corpus ?? "")) {
      if (!Array.isArray(row.abstract) || row.abstract.some((s) => typeof s !== "string"))
        throw new Error("Invalid SciFact corpus");
      const doc = row as unknown as SciDocument;
      corpus.set(String(doc.doc_id), doc);
    }
    for await (const row of jsonLines(args.claims ?? "")) {
      const pairs = sciPairs(row, corpus, split);
      if (!pairs.length) unlabeled++;
      all.push(...pairs);
    }
  }
  const seed = args.seed ?? "countercheck-v1";
  const limit = positiveInteger(args["max-pairs"], 200, "max-pairs");
  const pairs = sampleGroups(all, limit, seed);
  if (!pairs.length) throw new Error("No complete labeled groups fit sample cap");
  const manifest: Manifest = {
    schema_version: 1,
    adapter_version: "countercheck-public-pairs-v1",
    purpose: split === "test" ? "locked-test" : "development",
    sources,
    sampling: {
      seed,
      max_pairs: limit,
      method:
        "whole claim groups, deterministic seed ordering, greedy native-label proportion matching; no row truncation",
      available_pairs: all.length,
      selected_pairs: pairs.length,
      excluded_unlabeled: unlabeled,
      strata: strata(pairs),
      group_diagnostics: {
        population: groupStatistics(all),
        selected: groupStatistics(pairs),
        bias_disclosure: SAMPLING_BIAS,
      },
    },
    pairs,
  };
  validateManifest(manifest);
  await writeFile(resolve(args.out), `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
  process.stdout.write(
    `Prepared ${pairs.length} labeled pairs from ${all.length}; excluded ${unlabeled} unlabelled claims/rows. This is ${manifest.purpose}.\n`,
  );
}
main().catch(() => {
  console.error("Preparation failed. Check paths, labels, split and provenance; use --help.");
  process.exitCode = 1;
});
