import { describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import {
  missAnalysis,
  excludeCollidingGroups,
  fitsAllModels,
  type Archived,
} from "../eval/calibration-study/preparation.js";
import {
  blankAnnotation,
  mergeAnnotations,
  selectPacket,
  validatePacketIdentity,
  scoreHumanLabels,
  type PacketKey,
} from "../eval/calibration-study/adjudication.js";
import { contentHash } from "../eval/engineering/manifests.js";
import { select } from "../eval/iteration/prepare.js";
import { sha256, type Pair } from "../eval/types.js";
const pair = (id: string, gold: Pair["gold"] = "contradiction"): Pair => ({
  id,
  dataset: "vitaminc",
  variant: "combined",
  split: "dev",
  source_id: id,
  group_id: id,
  gold,
  native_label: gold,
  claim: `Synthetic claim ${id}`,
  evidence: `Synthetic comparison ${id}`,
});
const observation = (p: Pair, verdict?: string, raw?: Record<string, number>): Archived => ({
  model: "jev-1.14.0",
  dataset: p.dataset,
  row: {
    pair: p,
    prediction: {
      status: verdict ? "ok" : "error",
      ...(verdict && { verdict }),
      ...(raw && { raw_scores: raw }),
    },
    text_provenance: { claim_sha256: "0".repeat(64), evidence_sha256: "0".repeat(64) },
  },
});
describe("separate calibration preparation", () => {
  it("separates provider errors and top-score ties from completed semantic misses", () => {
    const rows = [
      observation(pair("uncertain"), "uncertain", {
        contradiction: 0.4,
        consistent: 0.4,
        different_scope: 0.1,
        insufficient_context: 0.1,
      }),
      observation(pair("failed")),
    ];
    const result = missAnalysis(rows);
    expect(result.total_missed_outcomes).toBe(2);
    expect(result.completed_misses).toBe(1);
    expect(result.provider_errors).toBe(1);
    expect(result.top_raw_category_in_completed_misses).toEqual({ "consistent+contradiction": 1 });
  });
  it("keeps entire source groups out when normalized duplicates cross groups", () => {
    const a = pair("a"),
      b = { ...pair("b"), claim: a.claim, evidence: a.evidence };
    expect(excludeCollidingGroups([a, b], [], new Set()).pairs).toEqual([]);
    expect(excludeCollidingGroups([a], [{ ...a, id: "published" }], new Set()).pairs).toEqual([]);
  });
  it("preflights all native wire shapes without network inference", () => {
    const send = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("No calls allowed"));
    try {
      expect(fitsAllModels(pair("small"))).toBe(true);
      expect(fitsAllModels({ ...pair("large"), evidence: "x".repeat(3000) })).toBe(false);
      expect(send).not.toHaveBeenCalled();
    } finally {
      send.mockRestore();
    }
  });
  it("reuses whole-component selection with distinct dataset caps", () => {
    const groups = new Map([
      ["v", { vitaminc: 8, scifact: 0 }],
      ["s", { vitaminc: 0, scifact: 4 }],
    ]);
    expect(select(groups, "fixed", { vitaminc: 8, scifact: 4 }, new Set()).counts).toEqual({
      vitaminc: 8,
      scifact: 4,
    });
  });
  it("mixes never-caught positives with unique matched controls and opaque IDs", () => {
    const a = pair("miss"),
      b = pair("caught"),
      c = pair("negative", "non_contradiction");
    const packet = selectPacket(
      [
        observation(a, "uncertain", { contradiction: 0.5, consistent: 0.5 }),
        observation(b, "contradiction", { contradiction: 0.9, consistent: 0.1 }),
      ],
      [a, b, c],
    );
    expect(packet).toHaveLength(3);
    expect(new Set(packet.map((p) => p.pair.id)).size).toBe(3);
    expect(new Set(packet.map((p) => p.membership)).size).toBe(3);
    expect(packet.every((p) => p.blind_id !== p.pair.id)).toBe(true);
  });
  const key: PacketKey[] = [
    {
      blind_id: randomUUID(),
      pair: pair("annotation-fixture"),
      membership: "synthetic-test-only",
      content_sha256: contentHash(pair("annotation-fixture")),
    },
  ];
  const hash = "a".repeat(64);
  const annotations = () =>
    ["one", "two", "three"].map((human_id, i) => ({
      schema_version: 1,
      packet_sha256: hash,
      role: i === 2 ? "adjudicator" : "annotator",
      human_id,
      human_attestation: true,
      independent: i < 2,
      labels: [
        {
          blind_id: key[0]!.blind_id,
          outcome: "insufficient_context",
          note: "Synthetic annotation gate fixture, not a real human judgment.",
        },
      ],
    }));
  it("refuses unlabelled templates and requires independent distinct human assertions", () => {
    expect(() =>
      mergeAnnotations(key, hash, [
        blankAnnotation(hash, [key[0]!.blind_id], "annotator"),
        ...annotations().slice(1),
      ]),
    ).toThrow();
    const dup = annotations();
    dup[1]!.human_id = dup[0]!.human_id;
    expect(() => mergeAnnotations(key, hash, dup)).toThrow();
    const dependent = annotations();
    dependent[0]!.independent = false;
    expect(() => mergeAnnotations(key, hash, dependent)).toThrow();
  });
  it("maps separately recorded service uncertainty without changing native gold", () => {
    const result = mergeAnnotations(key, hash, annotations());
    expect(result.labels[0]!.verdict).toBe("uncertain");
    expect(key[0]!.pair.gold).toBe("contradiction");
    expect(result.judgments[0]!.relation).toBe("insufficient_context");
  });
  it("requires matching packet hashes and every item before accepting assertions", () => {
    expect(() => mergeAnnotations(key, "b".repeat(64), annotations())).toThrow();
    const missing = annotations();
    missing[1]!.labels = [];
    expect(() => mergeAnnotations(key, hash, missing)).toThrow();
  });
  it("rejects trimmed, empty or duplicate packet keys against the frozen registry", () => {
    const item = key[0]!,
      view = {
        items: [{ blind_id: item.blind_id, claim: item.pair.claim, evidence: item.pair.evidence }],
      };
    const registry = {
      packet_sha256: hash,
      operator_key_sha256: hash,
      items: [
        {
          blind_id: item.blind_id,
          content_sha256: item.content_sha256,
          claim_sha256: sha256(item.pair.claim),
          evidence_sha256: sha256(item.pair.evidence),
        },
      ],
    };
    expect(() => validatePacketIdentity(key, view, registry)).not.toThrow();
    expect(() => validatePacketIdentity([], view, registry)).toThrow();
    expect(() => validatePacketIdentity([item, item], view, registry)).toThrow();
    expect(() => validatePacketIdentity(key, { items: [] }, registry)).toThrow();
  });
  it("rejects duplicate archived identities replacing a missing human-labeled pair", () => {
    const a = pair("source-a"),
      b = pair("source-b");
    const secondKey = [a, b].map((p) => ({
      blind_id: randomUUID(),
      pair: p,
      membership: "synthetic-test-only",
      content_sha256: contentHash(p),
    }));
    const values = annotations().map((v) => ({
      ...v,
      labels: secondKey.map((k) => ({
        blind_id: k.blind_id,
        outcome: "insufficient_context",
        note: "Synthetic coverage regression fixture, not human data.",
      })),
    }));
    const labels = mergeAnnotations(secondKey, hash, values).labels;
    const sources = new Map(
      secondKey.map((k) => [
        k.pair.id,
        {
          content_sha256: k.content_sha256,
          claim_sha256: "0".repeat(64),
          evidence_sha256: "0".repeat(64),
        },
      ]),
    );
    expect(() => scoreHumanLabels([observation(a), observation(a)], labels, sources)).toThrow(
      "Archived model coverage",
    );
  });
});
