import { randomUUID, randomInt } from "node:crypto";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { sha256, predictionSchema, type Prediction, type Pair } from "../types.js";
import { contentHash, contractLabelSchema, type ContractLabel } from "../engineering/manifests.js";
import { features, policyMetrics, type LabeledSignal } from "../engineering/composition.js";
import { MODELS, SEED, type Archived } from "./preparation.js";

export const OUTCOMES = [
  "contradiction",
  "consistent",
  "different_scope",
  "insufficient_context",
  "excerpt_insufficient_to_judge",
] as const;
export const rubric = `# Human pair adjudication\n\nRead the two submitted texts only. Judge whether their assertions can both hold under overlapping conditions and time. Do not decide which assertion is true, use outside facts, consult native dataset labels/model outputs, or use AI to label. Record any recognized item or outside knowledge in your note.\n\nChoose one outcome and explain the decisive text:\n- contradiction: incompatible assertions in overlapping scope.\n- consistent: jointly satisfiable, including omission, unrelated assertions and lack of support alone.\n- different_scope: explicitly disjoint entities, populations, conditions, versions or times.\n- insufficient_context: the relation cannot be determined because meaning or applicability is unresolved.\n- excerpt_insufficient_to_judge: the submitted excerpt omits necessary definitions, context or references; do not invent those missing facts.\n\nCheck lower bounds versus exact values (more than 100 and more than 120 can both hold), intervals, units, negations and quantifiers. Preserve proposed/quoted/rejected assertion status and exceptions. Distinct dates can refer to different observations; do not assume the later-looking statement supersedes the other. Do not assume a name/abbreviation is an alias without a supplied bridge. Nondetection of an effect is not proof of absence. A general statement and a subgroup result require careful scope alignment.\n\nFirst work independently without seeing the other annotator's judgments. Every item needs an outcome and a note. The adjudicator then records a final judgment with a rationale after considering both independent judgments. Do not edit the source text or source labels. Human/independence attestations record operator assertions; tooling cannot prove who performed annotation.\n`;
export type PacketKey = {
  blind_id: string;
  pair: Pair;
  membership: string;
  content_sha256: string;
};
const byteBin = (p: Pair) => Math.floor(Math.log2(Math.max(1, Buffer.byteLength(p.evidence))));
export function selectPacket(rows: Archived[], pairs: Pair[]) {
  const byId = new Map(pairs.map((p) => [p.id, p]));
  const caught = new Set(
    rows.filter((r) => r.row.prediction.verdict === "contradiction").map((r) => r.row.pair.id),
  );
  const missed = pairs.filter((p) => p.gold === "contradiction" && !caught.has(p.id));
  const used = new Set(missed.map((p) => p.id));
  const selected: { pair: Pair; membership: string }[] = missed.map((pair) => ({
    pair,
    membership: "never-caught-positive",
  }));
  for (const anchor of missed.sort((a, b) => a.id.localeCompare(b.id)))
    for (const positive of [true, false]) {
      const candidates = [...byId.values()].filter(
        (p) =>
          p.dataset === anchor.dataset &&
          !used.has(p.id) &&
          (positive
            ? p.gold === "contradiction" && caught.has(p.id)
            : p.gold === "non_contradiction"),
      );
      candidates.sort(
        (a, b) =>
          Math.abs(byteBin(a) - byteBin(anchor)) - Math.abs(byteBin(b) - byteBin(anchor)) ||
          sha256(`${SEED}:control:${anchor.id}:${a.id}`).localeCompare(
            sha256(`${SEED}:control:${anchor.id}:${b.id}`),
          ),
      );
      const pair = candidates[0];
      if (!pair) throw new Error("Insufficient matched controls");
      used.add(pair.id);
      selected.push({
        pair,
        membership: positive ? "caught-positive-control" : "native-negative-control",
      });
    }
  for (let i = selected.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [selected[i], selected[j]] = [selected[j]!, selected[i]!];
  }
  return selected.map(({ pair, membership }) => ({
    blind_id: randomUUID(),
    pair,
    membership,
    content_sha256: contentHash(pair),
  }));
}
export function blankAnnotation(
  packetSha: string,
  ids: string[],
  role: "annotator" | "adjudicator",
) {
  return {
    schema_version: 1,
    packet_sha256: packetSha,
    role,
    human_id: "",
    human_attestation: false,
    independent: role === "annotator",
    labels: ids.map((blind_id) => ({ blind_id, outcome: null, note: "" })),
  };
}
const annotationSchema = z.strictObject({
  schema_version: z.literal(1),
  packet_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  role: z.enum(["annotator", "adjudicator"]),
  human_id: z.string().regex(/^[A-Za-z0-9_.:-]{1,128}$/),
  human_attestation: z.literal(true),
  independent: z.boolean(),
  labels: z.array(
    z.strictObject({
      blind_id: z.uuid(),
      outcome: z.enum(OUTCOMES),
      note: z.string().trim().min(1).max(8000),
    }),
  ),
});
export function mergeAnnotations(key: PacketKey[], packetSha: string, values: unknown[]) {
  if (values.length !== 3)
    throw new Error("Two independent humans and an adjudicator are required");
  const parsed = values.map((v) => annotationSchema.parse(v));
  if (new Set(parsed.map((v) => v.human_id)).size !== 3)
    throw new Error("Three distinct human identifiers required");
  for (const [i, v] of parsed.entries()) {
    if (
      v.packet_sha256 !== packetSha ||
      v.role !== (i === 2 ? "adjudicator" : "annotator") ||
      (i < 2 && !v.independent)
    )
      throw new Error("Annotation provenance mismatch");
    if (
      v.labels.length !== key.length ||
      new Set(v.labels.map((l) => l.blind_id)).size !== key.length ||
      key.some((k) => !v.labels.some((l) => l.blind_id === k.blind_id))
    )
      throw new Error("Incomplete or unmatched annotation coverage");
  }
  const sidecar = key.map((item) => {
    const final = parsed[2]!.labels.find((l) => l.blind_id === item.blind_id)!;
    const verdict =
      final.outcome === "contradiction"
        ? "contradiction"
        : ["consistent", "different_scope"].includes(final.outcome)
          ? "no_contradiction"
          : "uncertain";
    const label = contractLabelSchema.parse({
      pair_id: item.pair.id,
      content_sha256: item.content_sha256,
      verdict,
      provenance: {
        kind: "human-adjudicated",
        source: `blinded-packet:${packetSha}`,
        method:
          "Two independently attested human judgments plus third-human adjudication; native labels unchanged",
        annotators: parsed.slice(0, 2).map((v) => v.human_id),
        adjudicator: parsed[2]!.human_id,
        real_source: true,
        authorization: "Original public dataset terms apply; source text remains in local packet",
      },
    });
    return {
      label,
      blind_id: item.blind_id,
      relation: final.outcome,
      judgments: parsed.map((v) => ({
        human_id: v.human_id,
        ...v.labels.find((l) => l.blind_id === item.blind_id)!,
      })),
    };
  });
  return {
    schema_version: 1,
    kind: "human-service-contract-adjudication",
    packet_sha256: packetSha,
    status: "human-attested-adjudicated",
    labels: sidecar.map((r) => r.label),
    judgments: sidecar,
  };
}
export type PacketRegistry = {
  packet_sha256: string;
  operator_key_sha256: string;
  items: {
    blind_id: string;
    content_sha256: string;
    claim_sha256: string;
    evidence_sha256: string;
  }[];
};
export function validatePacketIdentity(
  key: PacketKey[],
  view: { items: { blind_id: string; claim: string; evidence: string }[] },
  registry: PacketRegistry,
) {
  const sets = [key, view.items, registry.items].map(
    (items) => new Set(items.map((item) => item.blind_id)),
  );
  const expected = sets[2]!;
  if (
    !registry.items.length ||
    [key, view.items, registry.items].some(
      (items, i) => items.length !== registry.items.length || sets[i]!.size !== items.length,
    ) ||
    sets.some((set) => [...set].some((id) => !expected.has(id)))
  )
    throw new Error("Packet/key/registry identity sets must match exactly");
  for (const item of key) {
    const shown = view.items.find((p) => p.blind_id === item.blind_id)!;
    const recorded = registry.items.find((p) => p.blind_id === item.blind_id)!;
    if (
      contentHash(shown) !== recorded.content_sha256 ||
      item.content_sha256 !== recorded.content_sha256 ||
      contentHash(item.pair) !== recorded.content_sha256 ||
      sha256(shown.claim) !== recorded.claim_sha256 ||
      sha256(shown.evidence) !== recorded.evidence_sha256
    )
      throw new Error("Packet content differs from frozen registry");
  }
}
export type AnnotationSource = {
  content_sha256: string;
  claim_sha256: string;
  evidence_sha256: string;
};
export function scoreHumanLabels(
  rows: Archived[],
  labels: ContractLabel[],
  sources: Map<string, AnnotationSource>,
) {
  const byId = new Map(labels.map((l) => [l.pair_id, contractLabelSchema.parse(l)]));
  if (!labels.length || byId.size !== labels.length || sources.size !== labels.length)
    throw new Error("Unique labels and source identities required");
  return Object.fromEntries(
    MODELS.map((model) => {
      const selected = rows.filter((r) => r.model === model && byId.has(r.row.pair.id));
      if (
        selected.length !== labels.length ||
        new Set(selected.map((r) => r.row.pair.id)).size !== labels.length
      )
        throw new Error("Archived model coverage does not match labels");
      for (const r of selected) {
        const source = sources.get(r.row.pair.id),
          label = byId.get(r.row.pair.id)!;
        if (
          !source ||
          source.content_sha256 !== label.content_sha256 ||
          source.claim_sha256 !== r.row.text_provenance.claim_sha256 ||
          source.evidence_sha256 !== r.row.text_provenance.evidence_sha256
        )
          throw new Error("Archived text provenance does not match adjudicated sources");
      }
      const signals: (Pick<LabeledSignal, "label" | "features"> & { original: Prediction })[] =
        selected.map((r) => {
          const label = byId.get(r.row.pair.id)!;
          const original = predictionSchema.parse(r.row.prediction);
          return { label: label.verdict, features: features(original), original };
        });
      // Max, rather than summed negative labels, preserves the shipped four-way negative gate.
      for (const signal of signals)
        if (signal.features && signal.original.raw_scores) {
          const raw = signal.original.raw_scores;
          signal.features.semantic_negative = Math.max(raw.consistent, raw.different_scope);
        }
      return [
        model,
        policyMetrics(signals, {
          positive_threshold: 0.8,
          negative_threshold: 0.8,
          max_unknown: 1,
          numeric_override: false,
        }),
      ];
    }),
  );
}
export async function readAnnotation(path: string) {
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}
