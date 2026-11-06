import { describe, expect, it } from "vitest";
import { parseContractNli } from "../eval/business/contractnli.js";
import { envelopeGroups } from "../eval/business/common.js";

function fixture(
  chunks = [
    "😀 Recipient keeps secrets.",
    "Duties survive termination.",
    "Duties survive termination.",
  ],
) {
  let position = 0;
  const spans = chunks.map((chunk) => {
    const start = position;
    position += Array.from(chunk).length + 1;
    return [start, position - 1];
  });
  return {
    labels: {
      "nda-1": { hypothesis: "Duties survive termination." },
      "nda-2": { hypothesis: "Recipient may publish secrets." },
      "nda-3": { hypothesis: "The contract is governed by French law." },
    },
    documents: [
      {
        id: 42,
        file_name: "nda.txt",
        document_type: "sec-text",
        url: "https://example.test/nda",
        text: chunks.join("\n"),
        spans,
        annotation_sets: [
          {
            annotations: {
              "nda-1": { choice: "Entailment", spans: [2, 1] },
              "nda-2": { choice: "Contradiction", spans: [0] },
              "nda-3": { choice: "NotMentioned", spans: [] as number[] },
            },
          },
        ],
      },
    ],
  };
}

describe("ContractNLI complete gold-rationale adaptation", () => {
  it("joins all rationale spans once per hypothesis in document order, retaining redundant text", () => {
    const input = fixture();
    const original = structuredClone(input);
    const parsed = parseContractNli(input, "train");
    expect(input).toEqual(original);
    expect(parsed.pairs).toHaveLength(2);
    const entailment = parsed.pairs[0]!;
    expect(entailment.evidence).toBe("Duties survive termination.\nDuties survive termination.");
    expect(entailment).toMatchObject({
      id: "contractnli:train:42:nda-1",
      source_id: "42:nda-1",
      group_id: "contractnli:document:42",
      native_label: "Entailment",
      gold: "non_contradiction",
      split: "train",
    });
    expect(JSON.parse(entailment.source_metadata!.annotated_span_ids!)).toEqual([2, 1]);
    expect(JSON.parse(entailment.source_metadata!.evidence_spans_document_order!)).toEqual([
      { id: 1, start: input.documents[0]!.spans[1]![0], end: input.documents[0]!.spans[1]![1] },
      { id: 2, start: input.documents[0]!.spans[2]![0], end: input.documents[0]!.spans[2]![1] },
    ]);
    expect(parsed.pairs[1]).toMatchObject({
      native_label: "Contradiction",
      gold: "contradiction",
      evidence: "😀 Recipient keeps secrets.",
    });
    expect(parsed.coverage.native_annotations).toEqual({
      Entailment: 1,
      Contradiction: 1,
      NotMentioned: 1,
    });
    expect(parsed.coverage.annotated_evidence_spans).toBe(3);
    expect(parsed.exclusions.unlabeled).toBe(1);
    expect(parsed.adaptation).toContain("not independently reannotated");
  });

  it("uses Unicode-character offsets, not JavaScript code-unit offsets", () => {
    const input = fixture(["😀 prefix", "second", "third"]);
    expect(parseContractNli(input, "dev").pairs[0]!.evidence).toBe("second\nthird");
    expect(parseContractNli(input, "dev").pairs[0]!.source_metadata!.offset_unit).toContain(
      "Unicode code points",
    );
  });

  it("preserves an annotated blank span alongside substantive evidence without inventing text", () => {
    const parsed = parseContractNli(fixture(["Clause.", " ", "Duties survive."]), "dev");
    expect(parsed.pairs[0]!.evidence).toBe(" \nDuties survive.");
    expect(parsed.coverage.annotated_blank_spans_preserved).toBe(1);
    expect(parsed.coverage.annotated_evidence_spans).toBe(3);
    expect(() => parseContractNli(fixture(["Clause.", " ", " "]), "dev")).toThrow("Entire");
  });

  it("counts whole-document envelope loss, retaining complete raw pairs for the shared filter", () => {
    const parsed = parseContractNli(fixture(["Fits.", "é".repeat(1024), "End."]), "dev");
    expect(parsed.pairs[0]!.evidence).toBe(`${"é".repeat(1024)}\nEnd.`);
    expect(parsed.coverage).toMatchObject({
      binary_pairs: 2,
      binary_groups: 1,
      individually_within_envelope: 1,
      eligible_pairs: 0,
      eligible_groups: 0,
      envelope_excluded_pairs: 2,
      envelope_excluded_groups: 1,
    });
    expect(envelopeGroups(parsed.pairs).pairs).toEqual([]);
  });

  it("does not pretend a long full contract fits or truncate one into the hypothesis excerpt", () => {
    const input = fixture();
    input.documents[0]!.text += `\n${"Unselected context. ".repeat(300)}`;
    const parsed = parseContractNli(input, "dev");
    expect(parsed.coverage.full_contracts_within_evidence_limit).toBe(0);
    expect(parsed.coverage.eligible_pairs).toBe(2);
    expect(parsed.pairs.every((p) => !p.evidence.includes("Unselected"))).toBe(true);
    expect(parsed.pairs[0]!.source_metadata!.native_label_scope).toBe("full-contract");
  });

  it.each([
    [
      "out-of-range reference",
      (x: ReturnType<typeof fixture>) => {
        x.documents[0]!.annotation_sets[0]!.annotations["nda-1"].spans = [99];
      },
    ],
    [
      "duplicate reference",
      (x: ReturnType<typeof fixture>) => {
        x.documents[0]!.annotation_sets[0]!.annotations["nda-1"].spans = [1, 1];
      },
    ],
    [
      "missing gold rationale",
      (x: ReturnType<typeof fixture>) => {
        x.documents[0]!.annotation_sets[0]!.annotations["nda-1"].spans = [];
      },
    ],
    [
      "invalid offset",
      (x: ReturnType<typeof fixture>) => {
        x.documents[0]!.spans[0] = [0, 99999];
      },
    ],
    [
      "neutral with evidence",
      (x: ReturnType<typeof fixture>) => {
        x.documents[0]!.annotation_sets[0]!.annotations["nda-3"].spans = [0];
      },
    ],
    [
      "multiple annotation sets",
      (x: ReturnType<typeof fixture>) => {
        x.documents[0]!.annotation_sets.push(x.documents[0]!.annotation_sets[0]!);
      },
    ],
    [
      "duplicate document ID",
      (x: ReturnType<typeof fixture>) => {
        x.documents.push(structuredClone(x.documents[0]!));
      },
    ],
  ])("rejects %s instead of silently repairing annotations", (_, mutate) => {
    const input = fixture();
    mutate(input);
    expect(() => parseContractNli(input, "train")).toThrow();
  });

  it("rejects incomplete hypothesis coverage and unknown native labels", () => {
    const missing = fixture();
    delete (missing.documents[0]!.annotation_sets[0]!.annotations as Record<string, unknown>)[
      "nda-1"
    ];
    expect(() => parseContractNli(missing, "train")).toThrow("coverage");
    const unknown = fixture();
    unknown.documents[0]!.annotation_sets[0]!.annotations["nda-1"].choice = "neutral";
    expect(() => parseContractNli(unknown, "train")).toThrow();
  });
});
