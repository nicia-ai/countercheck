import { describe, expect, it } from "vitest";
import {
  MNLI_GENRES,
  MNLI_SOURCE,
  mnliPair,
  mnliPairs,
  type MnliSplit,
} from "../eval/business/mnli.js";
import { LIMITS } from "../src/contracts/limits.js";

const row = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  pairID: "123c",
  promptID: "123",
  genre: "government",
  sentence1: "  The authority approved the project.\n",
  sentence2: "The authority did not approve the project. ",
  gold_label: "contradiction",
  annotator_labels: ["entailment"], // Gold consensus, not the first annotator, is authoritative.
  ...overrides,
});

describe("official MultiNLI nonfiction transfer adapter", () => {
  it("pins the official archive and each original JSONL member with primary license evidence", () => {
    expect(MNLI_SOURCE.url).toBe("https://cims.nyu.edu/~sbowman/multinli/multinli_1.0.zip");
    expect(MNLI_SOURCE.sha256).toBe(
      "049f507b9e36b1fcb756cfd5aeb3b7a0cfcb84bf023793652987f7e7e0957822",
    );
    expect(MNLI_SOURCE.license_url).toContain("cims.nyu.edu");
    expect(MNLI_SOURCE.oanc_license_url).toBe("https://anc.org/data/oanc/");
    expect(new Set(Object.values(MNLI_SOURCE.files).map((f) => f.sha256)).size).toBe(3);
    for (const file of Object.values(MNLI_SOURCE.files))
      expect(file.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("keeps exact premise as evidence and hypothesis as claim with original identifiers", () => {
    const pair = mnliPair(row(), "train")!;
    expect(pair).toMatchObject({
      id: "mnli:train:123c",
      dataset: "mnli",
      variant: "train",
      split: "train",
      evidence: "  The authority approved the project.\n",
      claim: "The authority did not approve the project. ",
      source_id: "123c",
      group_id: "mnli:government:prompt-123",
      gold: "contradiction",
      native_label: "contradiction",
      source_metadata: {
        pairID: "123c",
        promptID: "123",
        genre: "government",
        source_split: "train",
      },
    });
  });

  it.each(["entailment", "neutral", "contradiction"])(
    "preserves human gold %s without relabeling",
    (label) => {
      const pair = mnliPair(row({ gold_label: label }), "dev_matched")!;
      expect(pair.native_label).toBe(label);
      expect(pair.gold).toBe(label === "contradiction" ? "contradiction" : "non_contradiction");
    },
  );

  it("preserves both dev variants and rejects a test split even with claimed gold", () => {
    const matched = mnliPair(row(), "dev_matched")!,
      mismatched = mnliPair(row(), "dev_mismatched")!;
    expect(matched.split).toBe("dev");
    expect(mismatched.split).toBe("dev");
    expect(matched.id).not.toBe(mismatched.id);
    expect(matched.variant).toBe("dev_matched");
    expect(mismatched.variant).toBe("dev_mismatched");
    expect(matched.group_id).toBe(mismatched.group_id); // Conservative if input files overlap.
    expect(() => mnliPair(row(), "test" as MnliSplit)).toThrow("no test gold");
    expect(() => mnliPairs([], "test" as MnliSplit)).toThrow("no test gold");
  });

  it("uses an explicit three-genre allowlist and excludes all mismatched genres", () => {
    expect(MNLI_GENRES).toEqual(["telephone", "government", "slate"]);
    for (const genre of MNLI_GENRES) expect(mnliPair(row({ genre }), "train")).not.toBeNull();
    const excluded = [
      "fiction",
      "travel",
      "letters",
      "verbatim",
      "facetoface",
      "oup",
      "nineeleven",
    ];
    for (const genre of excluded) expect(mnliPair(row({ genre }), "dev_mismatched")).toBeNull();
    expect(
      mnliPairs(
        excluded.map((genre) => row({ genre })),
        "dev_mismatched",
      ),
    ).toMatchObject({
      pairs: [],
      excluded_genre: 7,
      excluded_unlabeled: 0,
    });
    expect(() => mnliPair(row({ genre: "business" }), "train")).toThrow("Unknown MultiNLI genre");
  });

  it("excludes unresolved human consensus instead of falling back to annotator labels", () => {
    expect(mnliPair(row({ gold_label: "-" }), "dev_matched")).toBeNull();
    expect(mnliPair(row({ gold_label: undefined }), "train")).toBeNull();
    expect(mnliPairs([row({ gold_label: "-" }), row()], "train")).toMatchObject({
      excluded_unlabeled: 1,
      excluded_genre: 0,
      pairs: [expect.any(Object)],
    });
    expect(() => mnliPair(row({ gold_label: "CONTRADICTION" }), "train")).toThrow("gold label");
    expect(() => mnliPair(row({ gold_label: ["neutral"] }), "train")).toThrow("gold label");
  });

  it("keeps all three hypotheses in the original genre/prompt group", () => {
    const result = mnliPairs(
      ["entailment", "neutral", "contradiction"].map((gold_label, i) =>
        row({
          pairID: `123-${i}`,
          gold_label,
        }),
      ),
      "train",
    );
    expect(result.pairs).toHaveLength(3);
    expect(new Set(result.pairs.map((p) => p.group_id)).size).toBe(1);
    expect(mnliPair(row({ genre: "slate" }), "train")!.group_id).not.toBe(
      result.pairs[0]!.group_id,
    );
  });

  it("drops an entire prompt group for an oversized member without truncation", () => {
    const oversized = row({
      pairID: "123n",
      sentence1: "é".repeat(LIMITS.comparisonBytes / 2 + 1),
    });
    const result = mnliPairs([row(), oversized, row({ pairID: "124c", promptID: "124" })], "train");
    expect(result.pairs.map((p) => p.source_id)).toEqual(["124c"]);
    expect(result).toMatchObject({ excluded_envelope_pairs: 2, excluded_envelope_groups: 1 });
    expect(mnliPair(oversized, "train")!.evidence).toBe(oversized.sentence1);
  });

  it("supports a stricter compiled envelope and cannot bypass service text limits", () => {
    const members = [row(), row({ pairID: "123n", sentence2: "fails compiled payload" })];
    expect(mnliPairs(members, "train", (p) => p.source_id !== "123n")).toMatchObject({
      pairs: [],
      excluded_envelope_pairs: 2,
      excluded_envelope_groups: 1,
    });
    expect(
      mnliPairs([row({ sentence2: "a".repeat(LIMITS.claimBytes + 1) })], "train", () => true).pairs,
    ).toEqual([]);
    expect(mnliPairs([row({ sentence1: "\ud800" })], "train").excluded_envelope_pairs).toBe(1);
  });

  it("disambiguates repeated official pairIDs by original row without dropping hypotheses", () => {
    const result = mnliPairs(
      [row({ genre: "fiction" }), row(), row({ sentence2: "Another human hypothesis." })],
      "train",
    );
    expect(result.pairs.map((p) => p.id)).toEqual([
      "mnli:train:123c:row-2",
      "mnli:train:123c:row-3",
    ]);
    expect(result.pairs.map((p) => p.source_id)).toEqual(["123c", "123c"]);
    expect(result.pairs.map((p) => p.source_metadata!.source_row)).toEqual(["2", "3"]);
    expect(new Set(result.pairs.map((p) => p.group_id)).size).toBe(1);
    expect(() => mnliPair(row(), "train", 0)).toThrow("source row");
  });

  it("rejects missing identity/text rather than manufacturing replacements", () => {
    for (const key of ["pairID", "promptID", "sentence1", "sentence2"])
      expect(() => mnliPair(row({ [key]: "" }), "train")).toThrow(`Missing MultiNLI ${key}`);
    expect(mnliPair(row({ promptID: 123 }), "train")!.source_metadata!.promptID).toBe("123");
    expect(() => mnliPair(row({ promptID: Number.MAX_SAFE_INTEGER + 1 }), "train")).toThrow(
      "promptID",
    );
  });
});
