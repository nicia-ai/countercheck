import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { sha256, type Pair, type GroupStatistics } from "./types.js";

export const DATASETS = {
  vitaminc: {
    revision: "eb532922b88b199df68ed26afeb58dca5501b52f",
    url: "https://github.com/TalSchuster/VitaminC",
    license:
      "Wikipedia article terms / CC BY-SA 3.0 fallback; synthetic examples also derive from FEVER",
    license_url:
      "https://github.com/TalSchuster/VitaminC/blob/eb532922b88b199df68ed26afeb58dca5501b52f/DATA_LICENSE",
  },
  scifact: {
    revision: "68b98a56d93e0f9da0d2aab4e6c3294699a0f72e",
    url: "https://github.com/allenai/scifact",
    license: "Claims/annotations: CC BY 4.0; abstracts: ODC-By 1.0 (S2ORC)",
    license_url:
      "https://github.com/allenai/scifact/blob/68b98a56d93e0f9da0d2aab4e6c3294699a0f72e/LICENSE.md",
  },
} as const;
export async function* jsonLines(path: string): AsyncGenerator<Record<string, unknown>> {
  let line = 0;
  for await (const text of createInterface({
    input: createReadStream(path),
    crlfDelay: Infinity,
  })) {
    line++;
    if (!text.trim()) continue;
    let row: unknown;
    try {
      row = JSON.parse(text);
    } catch {
      throw new Error(`Invalid JSONL at line ${line}`);
    }
    if (!row || typeof row !== "object" || Array.isArray(row))
      throw new Error(`Invalid JSONL object at line ${line}`);
    yield row as Record<string, unknown>;
  }
}
function text(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`Missing ${field}`);
  return value;
}
export function vitaminPair(
  row: Record<string, unknown>,
  split: Pair["split"],
  variant: "real" | "synthetic" | "combined",
): Pair | null {
  const label = row.gold_label ?? row.label;
  if (label === undefined || label === null || label === "-") return null;
  if (!["SUPPORTS", "REFUTES", "NOT ENOUGH INFO"].includes(String(label)))
    throw new Error("Unknown VitaminC label");
  const claim = text(row.claim, "claim");
  const evidence = text(row.evidence, "evidence");
  const sourceId = String(row.unique_id ?? row.id ?? "");
  if (!sourceId) throw new Error("Missing VitaminC original ID");
  // Preserve revision and four-row contrast groups, including differently worded claims.
  // Minimal third-party exports without metadata conservatively group identical claims.
  const group = row.wiki_revision_id
    ? `revision-${String(row.wiki_revision_id)}`
    : row.case_id
      ? `case-${String(row.case_id)}`
      : `claim-${sha256(claim).slice(0, 24)}`;
  const metadata = Object.fromEntries(
    ["case_id", "wiki_revision_id", "page", "group"]
      .filter((k) => row[k] !== undefined)
      .map((k) => [k, String(row[k])]),
  );
  return {
    id: `vitaminc:${variant}:${split}:${sourceId}`,
    dataset: "vitaminc",
    variant,
    split,
    source_id: sourceId,
    group_id: `vitaminc:${group}`,
    claim,
    evidence,
    gold: label === "REFUTES" ? "contradiction" : "non_contradiction",
    native_label: String(label),
    source_metadata: metadata,
  };
}
export type SciDocument = { doc_id: number; abstract: string[] };
export function sciPairs(
  row: Record<string, unknown>,
  corpus: Map<string, SciDocument>,
  split: Pair["split"],
): Pair[] {
  const evidence = row.evidence;
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) return [];
  const pairs: Pair[] = [];
  const sourceId = String(row.id ?? "");
  if (!sourceId) throw new Error("Missing SciFact claim ID");
  for (const [docId, rationaleSets] of Object.entries(evidence)) {
    const doc = corpus.get(docId);
    if (!doc) throw new Error("SciFact annotated document missing from corpus");
    if (!Array.isArray(rationaleSets)) throw new Error("Invalid SciFact rationale sets");
    for (const [index, raw] of rationaleSets.entries()) {
      const r = raw as { label?: string; sentences?: unknown[] };
      if (
        !["SUPPORT", "CONTRADICT"].includes(r.label ?? "") ||
        !Array.isArray(r.sentences) ||
        !r.sentences.length
      )
        throw new Error("Invalid SciFact rationale");
      const indices = r.sentences;
      if (
        indices.some(
          (i) => typeof i !== "number" || !Number.isInteger(i) || i < 0 || i >= doc.abstract.length,
        ) ||
        new Set(indices).size !== indices.length
      )
        throw new Error("Invalid SciFact rationale indices");
      const sentences = indices as number[];
      const snippet = sentences.map((i) => text(doc.abstract[i], "abstract sentence")).join(" ");
      pairs.push({
        id: `scifact:${split}:${sourceId}:${docId}:${index}`,
        dataset: "scifact",
        variant: "gold-rationale-set",
        split,
        source_id: sourceId,
        group_id: `scifact:${sourceId}`,
        claim: text(row.claim, "claim"),
        evidence: snippet,
        gold: r.label === "CONTRADICT" ? "contradiction" : "non_contradiction",
        native_label: r.label ?? "",
        rationale: { document_id: docId, sentence_indices: sentences, set_index: index },
      });
    }
  }
  // cited_doc_ids and arbitrary corpus documents are never manufactured into negative labels.
  return pairs;
}
export function strata(pairs: Pair[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const p of pairs) {
    const key = `${p.dataset}/${p.variant}/${p.native_label}`;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}
export function sampleGroups(pairs: Pair[], limit: number, seed: string): Pair[] {
  if (pairs.length <= limit) return [...pairs].sort((a, b) => a.id.localeCompare(b.id));
  const groups = new Map<string, Pair[]>();
  for (const p of pairs) {
    const group = groups.get(p.group_id);
    if (group) group.push(p);
    else groups.set(p.group_id, [p]);
  }
  const target = Object.entries(strata(pairs));
  const selected: Pair[] = [];
  const counts: Record<string, number> = {};
  const remaining = [...groups]
    .map(([id, members]) => ({
      members,
      rank: sha256(`${seed}:${id}`),
      counts: Object.entries(strata(members)),
    }))
    .sort((a, b) => a.rank.localeCompare(b.rank));
  // Select whole groups while minimizing native-label proportion error. Stable hash breaks ties.
  while (remaining.length && selected.length < limit) {
    let bestIndex = -1;
    let bestScore = Infinity;
    for (const [i, group] of remaining.entries()) {
      if (selected.length + group.members.length > limit) continue;
      const next = { ...counts };
      for (const [k, n] of group.counts) next[k] = (next[k] ?? 0) + n;
      const n = selected.length + group.members.length;
      const score = target.reduce(
        (sum, [k, total]) => sum + Math.abs((next[k] ?? 0) / n - total / pairs.length),
        0,
      );
      if (score < bestScore) {
        bestScore = score;
        bestIndex = i;
      }
    }
    if (bestIndex < 0) break;
    const [chosen] = remaining.splice(bestIndex, 1);
    if (!chosen) break;
    selected.push(...chosen.members);
    for (const [k, n] of chosen.counts) counts[k] = (counts[k] ?? 0) + n;
  }
  return selected.sort((a, b) => a.id.localeCompare(b.id));
}

export function groupStatistics(pairs: readonly Pair[]): GroupStatistics {
  const groups = new Map<string, { size: number; labels: Set<string> }>();
  for (const pair of pairs) {
    let group = groups.get(pair.group_id);
    if (!group) {
      group = { size: 0, labels: new Set() };
      groups.set(pair.group_id, group);
    }
    group.size++;
    group.labels.add(pair.native_label);
  }
  const sizeCounts: Record<string, number> = {};
  let mixed = 0;
  let max = 0;
  for (const group of groups.values()) {
    sizeCounts[String(group.size)] = (sizeCounts[String(group.size)] ?? 0) + 1;
    if (group.labels.size > 1) mixed++;
    max = Math.max(max, group.size);
  }
  return {
    pairs: pairs.length,
    groups: groups.size,
    group_size_counts: sizeCounts,
    mean_group_size: groups.size ? pairs.length / groups.size : null,
    max_group_size: groups.size ? max : null,
    mixed_native_label_groups: mixed,
    mixed_native_label_group_fraction: groups.size ? mixed / groups.size : null,
  };
}
export const SAMPLING_BIAS =
  "Greedy native-label proportion matching is a development diagnostic sample, not a uniform group sample or a population-representative split estimate. Seeded hashes break ties; mixed-label/group-size composition can be preferentially selected. Compare population and selected group diagnostics.";
