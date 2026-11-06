import { checkRequestSchema } from "../../src/contracts/index.js";
import type { Pair } from "../types.js";

/** A nonfiction transfer diagnostic, not a business-native dataset. */
export const MNLI_GENRES = ["telephone", "government", "slate"] as const;
export const MNLI_SPLITS = ["train", "dev_matched", "dev_mismatched"] as const;
export type MnliSplit = (typeof MNLI_SPLITS)[number];
export const MNLI_SOURCE = {
  url: "https://cims.nyu.edu/~sbowman/multinli/multinli_1.0.zip",
  revision: "MultiNLI 1.0",
  cache_path: "eval/data/business/multinli_1.0.zip",
  sha256: "049f507b9e36b1fcb756cfd5aeb3b7a0cfcb84bf023793652987f7e7e0957822",
  license:
    "Selected OANC nonfiction genres: unrestricted use, modification and redistribution, including commercial use",
  license_url: "https://cims.nyu.edu/~sbowman/multinli/paper.pdf",
  oanc_license_url: "https://anc.org/data/oanc/",
  homepage: "https://cims.nyu.edu/~sbowman/multinli/",
  citation:
    "Williams, Nangia and Bowman (2018), A Broad-Coverage Challenge Corpus for Sentence Understanding through Inference, NAACL-HLT, 1112–1122",
  files: {
    train: {
      name: "multinli_1.0/multinli_1.0_train.jsonl",
      cache_path: "eval/data/business/multinli_1.0_train.jsonl",
      sha256: "e440e582329a812feca8fedfed2dc6932aaddd99aad32bf894b4c3a2d4206032",
    },
    dev_matched: {
      name: "multinli_1.0/multinli_1.0_dev_matched.jsonl",
      cache_path: "eval/data/business/multinli_1.0_dev_matched.jsonl",
      sha256: "9db14e02591c51b7c0401802382f01602ce97c21697a68a263f8c4b5958229a6",
    },
    dev_mismatched: {
      name: "multinli_1.0/multinli_1.0_dev_mismatched.jsonl",
      cache_path: "eval/data/business/multinli_1.0_dev_mismatched.jsonl",
      sha256: "65f3a993919f6a26f1468145a7ea2a7d8f5da175f1fee93a14315ba4fda0fd0e",
    },
  },
} as const;

const originalGenres = [
  ...MNLI_GENRES,
  "travel",
  "fiction",
  "letters",
  "verbatim",
  "facetoface",
  "oup",
  "nineeleven",
];
function field(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (typeof value !== "string" || !value.trim()) throw new Error(`Missing MultiNLI ${key}`);
  return value;
}
function identifier(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  // Original 1.0 JSONL uses strings; accept safe integer exports without rounding IDs.
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return String(value);
  return field(row, key);
}
function validateSplit(split: MnliSplit): void {
  if (!MNLI_SPLITS.includes(split))
    throw new Error("MultiNLI accepts original train/dev splits only; no test gold");
}
function selectedGenre(row: Record<string, unknown>): boolean {
  const genre = field(row, "genre");
  if (!originalGenres.includes(genre)) throw new Error("Unknown MultiNLI genre");
  return (MNLI_GENRES as readonly string[]).includes(genre);
}

export function mnliPair(
  row: Record<string, unknown>,
  split: MnliSplit,
  sourceRow?: number,
): Pair | null {
  validateSplit(split);
  if (sourceRow !== undefined && (!Number.isSafeInteger(sourceRow) || sourceRow < 1))
    throw new Error("Invalid MultiNLI source row");
  if (!selectedGenre(row)) return null;
  const label = row.gold_label;
  if (label === "-" || label === undefined || label === null) return null;
  if (typeof label !== "string" || !["entailment", "contradiction", "neutral"].includes(label))
    throw new Error("Unknown MultiNLI gold label");
  const pairID = identifier(row, "pairID"),
    promptID = identifier(row, "promptID");
  const genre = field(row, "genre");
  return {
    // The official train release repeats some pairIDs for distinct hypotheses.
    id: `mnli:${split}:${pairID}${sourceRow === undefined ? "" : `:row-${sourceRow}`}`,
    dataset: "mnli",
    variant: split,
    split: split === "train" ? "train" : "dev",
    source_id: pairID,
    // Do not separate hypotheses from one prompt, even across input split files.
    group_id: `mnli:${genre}:prompt-${promptID}`,
    claim: field(row, "sentence2"),
    evidence: field(row, "sentence1"),
    gold: label === "contradiction" ? "contradiction" : "non_contradiction",
    native_label: String(label),
    source_metadata: {
      pairID,
      promptID,
      genre,
      source_split: split,
      ...(sourceRow === undefined ? {} : { source_row: String(sourceRow) }),
    },
  };
}

function fitsServiceEnvelope(pair: Pair): boolean {
  return checkRequestSchema.safeParse({
    claim: { id: "claim", text: pair.claim },
    against: [{ id: "evidence", text: pair.evidence }],
  }).success;
}

/** Apply additional compiled-payload limits via fitsEnvelope; never trim source text. */
export function mnliPairs(
  rows: Iterable<Record<string, unknown>>,
  split: MnliSplit,
  fitsEnvelope?: (pair: Pair) => boolean,
): {
  pairs: Pair[];
  excluded_genre: number;
  excluded_unlabeled: number;
  excluded_envelope_pairs: number;
  excluded_envelope_groups: number;
} {
  validateSplit(split);
  const pairs: Pair[] = [],
    unsafeGroups = new Set<string>();
  let excluded_genre = 0,
    excluded_unlabeled = 0,
    sourceRow = 0;
  for (const row of rows) {
    sourceRow++;
    if (!selectedGenre(row)) {
      excluded_genre++;
      continue;
    }
    const pair = mnliPair(row, split, sourceRow);
    if (!pair) {
      excluded_unlabeled++;
      continue;
    }
    pairs.push(pair);
    // Service text limits always apply, even when a compiled-envelope predicate is supplied.
    if (!fitsServiceEnvelope(pair) || (fitsEnvelope && !fitsEnvelope(pair)))
      unsafeGroups.add(pair.group_id);
  }
  const kept = pairs.filter((pair) => !unsafeGroups.has(pair.group_id));
  return {
    pairs: kept,
    excluded_genre,
    excluded_unlabeled,
    excluded_envelope_pairs: pairs.length - kept.length,
    excluded_envelope_groups: unsafeGroups.size,
  };
}
