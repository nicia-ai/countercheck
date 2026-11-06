import { z } from "zod";
import { hasUnpairedSurrogate, utf8Bytes } from "../../src/contracts/index.js";
import { LIMITS } from "../../src/contracts/limits.js";
import { sha256, type Pair, type Source } from "../types.js";
import { envelopeGroups, type PreparedBusiness } from "./common.js";

export const CONTRACT_NLI_REVISION = "eced6528dd3c1d14d73f9a87df8f7bdbc03126f9";
export const CONTRACT_NLI_SOURCE = {
  name: "ContractNLI official train/development gold-rationale excerpts",
  url: `https://raw.githubusercontent.com/stanfordnlp/contract-nli/${CONTRACT_NLI_REVISION}/resources/contract-nli.zip`,
  revision: CONTRACT_NLI_REVISION,
  license: "CC BY 4.0; cite Koreeda and Manning, Findings of EMNLP 2021",
  license_url: `https://github.com/stanfordnlp/contract-nli/blob/${CONTRACT_NLI_REVISION}/LICENSE`,
} satisfies Omit<Source, "sha256">;
export const CONTRACT_NLI_MEMBER_SHA256 = {
  train: "dbceb356cd6203b35b27be94a5fa85e499a81c34c42c89ad53060b39f0257ba5",
  dev: "310af7d661d2ab50ee3700169cef524c75f39fb296bbf5a515c229eb0f42e68e",
} as const;

const nativeLabels = ["Entailment", "Contradiction", "NotMentioned"] as const;
type NativeLabel = (typeof nativeLabels)[number];
const text = z.string().refine((s) => !!s.trim() && !hasUnpairedSurrogate(s));
const index = z.number().int().nonnegative();
const datasetSchema = z.object({
  documents: z
    .array(
      z.object({
        id: index,
        text,
        file_name: text,
        document_type: text,
        url: text,
        spans: z.array(z.tuple([index, index])),
        annotation_sets: z
          .array(
            z.object({
              annotations: z.record(
                z.string().regex(/^[A-Za-z0-9._-]+$/),
                z.object({ choice: z.enum(nativeLabels), spans: z.array(index) }),
              ),
            }),
          )
          .length(1),
      }),
    )
    .min(1),
  labels: z.record(z.string().regex(/^[A-Za-z0-9._-]+$/), z.object({ hypothesis: text })),
});

const labelCounts = (): Record<NativeLabel, number> => ({
  Entailment: 0,
  Contradiction: 0,
  NotMentioned: 0,
});
export type ContractNliCoverage = {
  documents: number;
  hypotheses: number;
  native_annotations: Record<NativeLabel, number>;
  annotated_evidence_spans: number;
  annotated_blank_spans_preserved: number;
  binary_pairs: number;
  binary_groups: number;
  individually_within_envelope: number;
  eligible_pairs: number;
  eligible_groups: number;
  eligible_native_annotations: Record<NativeLabel, number>;
  envelope_excluded_pairs: number;
  envelope_excluded_groups: number;
  full_contracts_within_evidence_limit: number;
};

/** Native offsets count Unicode characters, as in the dataset's Python slicing. */
export function parseContractNli(
  value: unknown,
  split: "train" | "dev",
): PreparedBusiness & { coverage: ContractNliCoverage } {
  if (split !== "train" && split !== "dev")
    throw new Error("Only ContractNLI train/dev are enabled.");
  const data = datasetSchema.parse(value);
  const hypotheses = Object.keys(data.labels);
  if (!hypotheses.length) throw new Error("ContractNLI requires hypotheses.");
  const seen = new Set<number>();
  const pairs: Pair[] = [];
  const native = labelCounts();
  let spanCount = 0;
  let blankSpanCount = 0;
  for (const doc of data.documents) {
    if (seen.has(doc.id)) throw new Error("Duplicate ContractNLI document ID.");
    seen.add(doc.id);
    const characters = Array.from(doc.text);
    for (const [start, end] of doc.spans) {
      if (start >= end || end > characters.length)
        throw new Error("Invalid ContractNLI document span offsets.");
    }
    const annotations = doc.annotation_sets[0]!.annotations;
    if (
      Object.keys(annotations).length !== hypotheses.length ||
      hypotheses.some((id) => !Object.hasOwn(annotations, id))
    )
      throw new Error("Incomplete ContractNLI hypothesis coverage.");
    for (const hypothesisId of hypotheses) {
      const annotation = annotations[hypothesisId]!;
      native[annotation.choice]++;
      if (
        new Set(annotation.spans).size !== annotation.spans.length ||
        annotation.spans.some((id) => id >= doc.spans.length)
      )
        throw new Error("Invalid ContractNLI annotated span indices.");
      if (annotation.choice === "NotMentioned") {
        if (annotation.spans.length)
          throw new Error("NotMentioned unexpectedly has evidence spans.");
        continue;
      }
      if (!annotation.spans.length)
        throw new Error("Labeled ContractNLI hypothesis lacks evidence.");
      spanCount += annotation.spans.length;
      const ordered = annotation.spans
        .map((id) => ({ id, start: doc.spans[id]![0], end: doc.spans[id]![1] }))
        .sort((a, b) => a.start - b.start || a.end - b.end || a.id - b.id);
      const snippets = ordered.map(({ start, end }) => characters.slice(start, end).join(""));
      blankSpanCount += snippets.filter((s) => !s.trim()).length;
      const evidence = snippets.join("\n");
      if (!evidence.trim()) throw new Error("Entire ContractNLI rationale is blank.");
      pairs.push({
        id: `contractnli:${split}:${doc.id}:${hypothesisId}`,
        dataset: "contractnli",
        variant: "complete-gold-rationale-oracle-excerpt",
        split,
        source_id: `${doc.id}:${hypothesisId}`,
        group_id: `contractnli:document:${doc.id}`,
        claim: data.labels[hypothesisId]!.hypothesis,
        evidence,
        gold: annotation.choice === "Contradiction" ? "contradiction" : "non_contradiction",
        native_label: annotation.choice,
        source_metadata: {
          document_id: String(doc.id),
          hypothesis_id: hypothesisId,
          annotation_set_index: "0",
          file_name: doc.file_name,
          document_type: doc.document_type,
          document_url: doc.url,
          full_document_sha256: sha256(doc.text),
          full_document_utf8_bytes: String(utf8Bytes(doc.text)),
          annotated_span_ids: JSON.stringify(annotation.spans),
          evidence_spans_document_order: JSON.stringify(ordered),
          offset_unit: "Unicode code points; zero-based [start,end)",
          join_separator: "newline",
          native_label_scope: "full-contract",
          adaptation:
            "All annotated evidence spans, including redundant spans; oracle excerpt, not reannotated excerpt truth",
        },
      });
    }
  }
  const eligible = envelopeGroups(pairs);
  const eligibleNative = labelCounts();
  for (const pair of eligible.pairs) eligibleNative[pair.native_label as NativeLabel]++;
  return {
    // Shared businessManifest owns whole-document envelope filtering. These rows are never truncated.
    pairs,
    exclusions: {
      unlabeled: native.NotMentioned,
      not_mentioned_without_evidence: native.NotMentioned,
    },
    adaptation:
      "Oracle gold-rationale excerpt adaptation of document-level ContractNLI: one pair per hypothesis with every annotated span concatenated in document order, including redundant/noncontiguous spans. Original Entailment/Contradiction labels are preserved, not independently reannotated for the excerpt. Omitted surrounding definitions, exceptions or cross-references may affect standalone excerpt truth; no equivalence to full-contract NLI is claimed. NotMentioned without evidence is excluded. Whole document groups are excluded if any complete binary pair exceeds the service envelope; no rationale or contract is truncated.",
    coverage: {
      documents: data.documents.length,
      hypotheses: hypotheses.length,
      native_annotations: native,
      annotated_evidence_spans: spanCount,
      annotated_blank_spans_preserved: blankSpanCount,
      binary_pairs: pairs.length,
      binary_groups: new Set(pairs.map((p) => p.group_id)).size,
      individually_within_envelope: pairs.filter(
        (p) =>
          utf8Bytes(p.claim) <= LIMITS.claimBytes &&
          utf8Bytes(p.evidence) <= LIMITS.comparisonBytes,
      ).length,
      eligible_pairs: eligible.pairs.length,
      eligible_groups: new Set(eligible.pairs.map((p) => p.group_id)).size,
      eligible_native_annotations: eligibleNative,
      envelope_excluded_pairs: eligible.excludedPairs,
      envelope_excluded_groups: eligible.excludedGroups,
      full_contracts_within_evidence_limit: data.documents.filter(
        (doc) => utf8Bytes(doc.text) <= LIMITS.comparisonBytes,
      ).length,
    },
  };
}
