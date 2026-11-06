import { describe, expect, it } from "vitest";
import { businessManifest, envelopeGroups, sampleBusinessGroups } from "../eval/business/common.js";
import { validateManifest, type Pair } from "../eval/types.js";
const pair = (id: string, group = id): Pair => ({
  id,
  dataset: "mnli",
  variant: "dev_matched",
  split: "dev",
  group_id: group,
  source_id: group,
  claim: "The office is open.",
  evidence: "The office is closed.",
  gold: "contradiction",
  native_label: "contradiction",
});
const source = {
  name: "fixture",
  url: "https://example.org/fixture",
  revision: "fixture",
  sha256: "a".repeat(64),
  license: "fixture",
  license_url: "https://example.org/license",
};
describe("business evaluation source boundaries", () => {
  it("can explicitly keep complete supported pairs without inventing support for an oversized sibling", () => {
    const complete = pair("a", "shared");
    const tooLong = { ...pair("b", "shared"), evidence: "x".repeat(2049) };
    const m = businessManifest({
      prepared: { pairs: [complete, tooLong, pair("c")], exclusions: {}, adaptation: "fixture" },
      sources: [source],
      track: "business-adjacent",
      split: "dev",
      maxPairs: 10,
      seed: "fixture",
      envelopePolicy: "individual-pairs",
    });
    expect(m.pairs).toEqual([complete, pair("c")]);
    expect(m.business_protocol).toMatchObject({
      envelope_policy: "individual-pairs",
      partially_retained_source_groups: 1,
      exclusions: { envelope_pairs: 1, envelope_groups: 0 },
    });
    expect(tooLong.evidence).toHaveLength(2049);
  });
  it("retains envelope exclusions already applied by a source adapter", () => {
    const m = businessManifest({
      prepared: {
        pairs: [pair("one")],
        exclusions: { envelope_pairs: 3, envelope_groups: 1 },
        adaptation: "prefiltered",
      },
      sources: [source],
      track: "business-adjacent",
      split: "dev",
      maxPairs: 10,
      seed: "fixture",
    });
    expect(m.business_protocol).toMatchObject({
      exclusions: { envelope_pairs: 3, envelope_groups: 1 },
    });
  });
  it("excludes an entire source group rather than truncating one oversized assertion", () => {
    const rows = [
      pair("a", "shared"),
      { ...pair("b", "shared"), evidence: "x".repeat(2049) },
      pair("c"),
    ];
    expect(envelopeGroups(rows)).toEqual({ pairs: [rows[2]], excludedPairs: 2, excludedGroups: 1 });
    expect(rows[1]!.evidence).toHaveLength(2049);
  });
  it("applies byte limits and rejects invalid unicode without dropping sibling rows", () => {
    const rows = [
      { ...pair("unicode"), evidence: "é".repeat(1025) },
      { ...pair("invalid"), claim: "\ud800" },
      pair("good"),
    ];
    expect(envelopeGroups(rows).pairs.map((p) => p.id)).toEqual(["good"]);
  });
  it("keeps complete groups and selection independent of gold labels and input ordering", () => {
    const rows = Array.from({ length: 8 }, (_, i) => pair(String(i), `group-${Math.floor(i / 2)}`));
    const a = sampleBusinessGroups(rows, 5, "same-seed");
    const b = sampleBusinessGroups(
      [...rows].reverse().map((p) => ({ ...p, gold: "non_contradiction" as const })),
      5,
      "same-seed",
    );
    expect(a).toHaveLength(4);
    expect(a.map((p) => p.id)).toEqual(b.map((p) => p.id));
    for (const p of a) expect(a.filter((q) => q.group_id === p.group_id)).toHaveLength(2);
  });
  it("does not relabel native neutral as contradiction or mix test into development", () => {
    const prepared = { pairs: [pair("one")], exclusions: { unlabeled: 0 }, adaptation: "fixture" };
    const m = businessManifest({
      prepared,
      sources: [source],
      track: "business-adjacent",
      split: "dev",
      maxPairs: 10,
      seed: "fixture",
    });
    expect(m.business_protocol).toMatchObject({
      native_labels_unchanged: true,
      track: "business-adjacent",
    });
    expect(() =>
      validateManifest({ ...m, pairs: [{ ...m.pairs[0], native_label: "neutral" }] }),
    ).toThrow("MultiNLI gold");
    expect(() =>
      businessManifest({
        prepared,
        sources: [source],
        track: "business-adjacent",
        split: "test",
        maxPairs: 10,
        seed: "fixture",
      }),
    ).toThrow("original split");
  });
});
