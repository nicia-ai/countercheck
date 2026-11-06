import { describe, expect, it, vi } from "vitest";
import { vitaminPair, sciPairs, sampleGroups, type SciDocument } from "../eval/datasets.js";
import { auc, metrics, bootstrapIntervals, type Scored } from "../eval/metrics.js";
import { fromResponse, runPairs, makeRequest, presentationOrder } from "../eval/backends.js";
import {
  validateManifest,
  validateReplayMetadata,
  type Pair,
  type Prediction,
  type Manifest,
} from "../eval/types.js";
import { validateReplay } from "../eval/replay.js";
import { evaluateCheck } from "../src/kernel/index.js";
import type { DecisionProvider } from "../src/providers/types.js";

function pair(id: string, gold: Pair["gold"] = "contradiction"): Pair {
  return {
    id,
    dataset: "vitaminc",
    variant: "real",
    split: "dev",
    source_id: id,
    group_id: id,
    claim: "The plan includes SSO.",
    evidence: "The plan excludes SSO.",
    gold,
    native_label: gold === "contradiction" ? "REFUTES" : "SUPPORTS",
  };
}
function manifest(purpose: Manifest["purpose"], split: Pair["split"]): Manifest {
  return {
    schema_version: 1,
    adapter_version: "countercheck-public-pairs-v1",
    purpose,
    sources: [
      {
        name: "fixture",
        url: "https://example.org/data",
        revision: "fixture-v1",
        sha256: "a".repeat(64),
        license: "fixture",
        license_url: "https://example.org/license",
      },
    ],
    sampling: {
      seed: "seed",
      max_pairs: 1,
      method: "fixture",
      available_pairs: 1,
      selected_pairs: 1,
      excluded_unlabeled: 0,
      strata: {},
    },
    pairs: [
      { ...pair("a"), split, ...(purpose === "synthetic-smoke" && { dataset: "synthetic-smoke" }) },
    ],
  };
}
const output = (
  id: string,
  contradiction: number,
  verdict: Prediction["verdict"] = "contradiction",
): Prediction => ({
  pair_id: id,
  pass: 1,
  status: "ok",
  verdict,
  probabilities: { contradiction, no_contradiction: 1 - contradiction, insufficient_context: 0 },
  latency_ms: 10,
});
const provider: DecisionProvider = {
  id: "deterministic-test",
  model: "fake",
  async classify(payload) {
    return {
      answers: Object.fromEntries(
        Object.keys(payload.questions).map((id) => [
          id,
          {
            type: "choice",
            probabilities: {
              contradiction: 0.9,
              consistent: 0.1,
              different_scope: 0,
              insufficient_context: 0,
            },
          },
        ]),
      ),
    };
  },
};

describe("public dataset adapters", () => {
  it("preserves VitaminC native negatives, labels and conservative contrast groups", () => {
    const a = vitaminPair(
      { unique_id: "one", claim: "A", evidence: "B", label: "REFUTES" },
      "dev",
      "real",
    );
    const b = vitaminPair(
      { unique_id: "two", claim: "A", evidence: "C", gold_label: "NOT ENOUGH INFO" },
      "dev",
      "real",
    );
    expect(a?.gold).toBe("contradiction");
    expect(b?.gold).toBe("non_contradiction");
    expect(a?.group_id).toBe(b?.group_id);
    expect(vitaminPair({ id: 1 }, "dev", "real")).toBeNull();
    expect(() =>
      vitaminPair({ id: 1, claim: "A", evidence: "B", label: "UNRELATED" }, "dev", "real"),
    ).toThrow();
  });
  it("joins each complete SciFact rationale as a unit and never labels unannotated docs", () => {
    const corpus = new Map<string, SciDocument>([
      ["7", { doc_id: 7, abstract: ["First.", "Second.", "Third."] }],
    ]);
    const results = sciPairs(
      {
        id: 5,
        claim: "Claim.",
        cited_doc_ids: [7, 8],
        evidence: {
          "7": [
            { label: "CONTRADICT", sentences: [0, 2] },
            { label: "CONTRADICT", sentences: [1] },
          ],
        },
      },
      corpus,
      "dev",
    );
    expect(results).toHaveLength(2);
    expect(results[0]?.evidence).toBe("First. Third.");
    expect(results[0]?.rationale?.sentence_indices).toEqual([0, 2]);
    expect(results[0]?.group_id).toBe(results[1]?.group_id);
    expect(
      sciPairs({ id: 1, claim: "A", evidence: {}, cited_doc_ids: [7] }, corpus, "dev"),
    ).toEqual([]);
    expect(() =>
      sciPairs(
        { id: 2, claim: "A", evidence: { "7": [{ label: "SUPPORT", sentences: [999] }] } },
        corpus,
        "dev",
      ),
    ).toThrow();
  });
  it("samples deterministically without splitting mixed-label contrast groups", () => {
    const pairs = Array.from({ length: 20 }, (_, i) => ({
      ...pair(String(i), i % 2 ? "non_contradiction" : "contradiction"),
      group_id: `g${Math.floor(i / 2)}`,
    }));
    const sampled = sampleGroups(pairs, 7, "seed");
    expect(sampled).toEqual(sampleGroups([...pairs].reverse(), 7, "seed"));
    expect(sampled.length).toBe(6);
    for (const p of sampled)
      expect(sampled.filter((q) => q.group_id === p.group_id)).toHaveLength(2);
    expect(sampled.filter((p) => p.gold === "contradiction")).toHaveLength(3);
  });
  it("refuses mislabeled synthetic public manifests", () => {
    expect(() =>
      validateManifest({
        schema_version: 1,
        adapter_version: "countercheck-public-pairs-v1",
        purpose: "synthetic-smoke",
        sources: [{}],
        sampling: {},
        pairs: [pair("x")],
      }),
    ).toThrow();
  });
  it.each([
    ["development", "test"],
    ["development", "synthetic"],
    ["locked-test", "dev"],
    ["locked-test", "train"],
    ["synthetic-smoke", "dev"],
  ] as const)("rejects %s purpose containing %s original rows", (purpose, split) => {
    expect(() => validateManifest(manifest(purpose, split))).toThrow(
      "purpose does not match original split",
    );
  });
  it.each([
    ["development", "train"],
    ["development", "dev"],
    ["locked-test", "test"],
    ["synthetic-smoke", "synthetic"],
  ] as const)("preserves valid %s/%s tracks", (purpose, split) => {
    expect(validateManifest(manifest(purpose, split)).purpose).toBe(purpose);
  });
});

describe("metrics and deterministic replay", () => {
  it("retains positive errors and abstentions as recall misses", () => {
    const rows: Scored[] = [
      { pair: pair("tp"), prediction: output("tp", 0.95) },
      { pair: pair("uncertain"), prediction: output("uncertain", 0.5, "uncertain") },
      {
        pair: pair("error"),
        prediction: {
          pair_id: "error",
          pass: 1,
          status: "error",
          error_code: "timeout",
          latency_ms: 100,
        },
      },
      { pair: pair("tn", "non_contradiction"), prediction: output("tn", 0.1, "no_contradiction") },
      { pair: pair("fp", "non_contradiction"), prediction: output("fp", 0.9) },
    ];
    const m = metrics(rows);
    expect(m.precision.value).toBe(0.5);
    expect(m.recall.value).toBe(1 / 3);
    expect(m.coverage.value).toBe(3 / 5);
    expect(m.false_positive_rate.value).toBe(0.5);
    expect(m.probability_denominator).toBe(4);
    expect(m.cost.unknown_rows).toBe(5);
    expect(m.precision.ci95?.[0]).toBeLessThan(0.5);
    expect(bootstrapIntervals(rows, 30)).toEqual(bootstrapIntervals(rows, 30));
  });
  it("computes ranking metrics correctly including ties and absent classes", () => {
    expect(
      auc([
        { y: true, score: 0.9 },
        { y: false, score: 0.1 },
      ]),
    ).toEqual({ auroc: 1, pr_auc_average_precision: 1 });
    expect(
      auc([
        { y: true, score: 0.5 },
        { y: false, score: 0.5 },
      ]),
    ).toEqual({ auroc: 0.5, pr_auc_average_precision: 0.5 });
    expect(auc([{ y: false, score: 0.1 }])).toEqual({
      auroc: null,
      pr_auc_average_precision: null,
    });
  });
  it("requires exact coverage and valid distributions on replay", () => {
    expect(validateReplay([output("a", 0.9)], [pair("a")], 1)).toHaveLength(1);
    expect(() => validateReplay([output("a", 0.9), output("a", 0.9)], [pair("a")], 1)).toThrow();
    expect(() => validateReplay([], [pair("a")], 1)).toThrow();
    expect(() =>
      validateReplay(
        [
          {
            ...output("a", 0.9),
            probabilities: { contradiction: 1, no_contradiction: 1, insufficient_context: 0 },
          },
        ],
        [pair("a")],
        1,
      ),
    ).toThrow();
    expect(() =>
      validateReplay([{ ...output("a", 0.9), status: "error" }], [pair("a")], 1),
    ).toThrow();
  });
  it.each([null, false, 0, "", [], {}, { manifest_sha256: "wrong" }])(
    "rejects invalid replay provenance %j",
    (metadata) => {
      expect(() => validateReplayMetadata(metadata, "a".repeat(64))).toThrow();
    },
  );
  it("preserves provenance extras and requires the matching immutable manifest hash", () => {
    const metadata = {
      manifest_sha256: "a".repeat(64),
      runtime_seconds: { total: 3 },
      model: "fixture",
    };
    expect(validateReplayMetadata(metadata, "a".repeat(64))).toEqual(metadata);
    expect(() => validateReplayMetadata(metadata, "b".repeat(64))).toThrow("hash mismatch");
  });
  it.each(["raw_scores", "nli_probabilities", "forced_nli_verdict"])(
    "forbids %s on failed replay rows",
    (field) => {
      const row = {
        pair_id: "a",
        pass: 1,
        status: "error",
        latency_ms: 1,
        [field]: field === "forced_nli_verdict" ? "contradiction" : {},
      };
      expect(() => validateReplay([row], [pair("a")], 1)).toThrow();
    },
  );
  it("validates complete raw distributions and their projection without dropping NLI metadata", () => {
    const raw = {
      contradiction: 0.9,
      consistent: 0.05,
      different_scope: 0.05,
      insufficient_context: 0,
    };
    expect(
      validateReplay([{ ...output("a", 0.9), raw_scores: raw }], [pair("a")], 1)[0]?.raw_scores,
    ).toEqual(raw);
    for (const invalid of [
      { contradiction: 0.9 },
      { ...raw, contradiction: Infinity },
      { ...raw, invented: 0 },
      { contradiction: 0.1, consistent: 0.9, different_scope: 0, insufficient_context: 0 },
    ]) {
      expect(() =>
        validateReplay([{ ...output("a", 0.9), raw_scores: invalid }], [pair("a")], 1),
      ).toThrow();
    }
    const nli = {
      ...output("a", 0.9),
      nli_probabilities: { contradiction: 0.9, entailment: 0.04, neutral: 0.06 },
      forced_nli_verdict: "contradiction",
      fixture_metadata: "preserved",
    };
    expect(validateReplay([nli], [pair("a")], 1)[0]).toEqual(nli);
    expect(() =>
      validateReplay(
        [{ ...nli, nli_probabilities: { contradiction: 0.1, entailment: 0.4, neutral: 0.5 } }],
        [pair("a")],
        1,
      ),
    ).toThrow();
  });
  it("requires semantic outputs on every successful replay row", () => {
    expect(() =>
      validateReplay([{ pair_id: "a", pass: 1, status: "ok", latency_ms: 1 }], [pair("a")], 1),
    ).toThrow();
  });
});

describe("kernel and service evaluation adapters", () => {
  it("preserves full probabilities and exact pair attribution under presentation reversal", async () => {
    const pairs = [pair("a"), pair("b")];
    const request = makeRequest(pairs[0]!, pairs);
    expect(presentationOrder(request, "reversed", 1)).toEqual(
      presentationOrder(request, "original", 1).reverse(),
    );
    const predictions = await runPairs(pairs, {
      pass: 1,
      timeoutMs: 100,
      presentation: "reversed",
      provider,
    });
    expect(predictions.map((r) => r.pair_id)).toEqual(["a", "b"]);
    expect(predictions.every((r) => r.raw_scores?.contradiction === 0.9)).toBe(true);
    const response = await evaluateCheck(request, provider, {
      requestId: "test",
      signal: new AbortController().signal,
    });
    response.comparisons[0]!.against_id = "invented";
    expect(() => fromResponse(response, pairs, request, 1, 10, "original")).toThrow();
  });
  it("never converts malformed or timed-out providers into clean negatives", async () => {
    const malformed: DecisionProvider = {
      ...provider,
      async classify() {
        return { answers: {} };
      },
    };
    expect(
      (
        await runPairs([pair("a")], {
          pass: 1,
          timeoutMs: 50,
          presentation: "original",
          provider: malformed,
        })
      )[0]?.status,
    ).toBe("error");
    const stalled: DecisionProvider = { ...provider, classify: () => new Promise(() => {}) };
    const result = (
      await runPairs([pair("a")], {
        pass: 1,
        timeoutMs: 5,
        presentation: "original",
        provider: stalled,
      })
    )[0];
    expect(result?.error_code).toBe("deadline_exceeded");
    expect(result?.verdict).toBeUndefined();
  });
  it("records byte envelope exclusions without silently truncating", async () => {
    const result = await runPairs([{ ...pair("a"), evidence: "x".repeat(2049) }], {
      pass: 1,
      timeoutMs: 10,
      presentation: "original",
      provider,
    });
    expect(result[0]?.status).toBe("excluded");
    expect(result[0]?.probabilities).toBeUndefined();
  });
  it("compares direct Jev transport and kernel with equivalent payloads", async () => {
    const standard = await runPairs([pair("a")], {
      pass: 1,
      timeoutMs: 50,
      presentation: "original",
      provider,
    });
    const direct = await runPairs([pair("a")], {
      pass: 1,
      timeoutMs: 50,
      presentation: "original",
      provider,
      direct: true,
    });
    expect(direct[0]?.probabilities).toEqual(standard[0]?.probabilities);
    expect(direct[0]?.prompt_hash).toEqual(standard[0]?.prompt_hash);
  });
  it("runs fake smoke through the actual compiler and response mapper", async () => {
    const options = { pass: 1, timeoutMs: 100, presentation: "original" as const, fake: true };
    const [result] = await runPairs([pair("a")], options);
    expect(result).toMatchObject({
      status: "ok",
      verdict: "uncertain",
      model: "fake-no-model",
      provider: "fake",
      prompt_version: "pair-relation-v1",
      cost_usd: 0,
    });
    expect(result?.prompt_hash).toMatch(/^[a-f0-9]{64}$/);
    const oversized = Array.from({ length: 20 }, (_, i) => ({
      ...pair(`${i}`),
      evidence: "x".repeat(2048),
    }));
    const excluded = await runPairs(oversized, options);
    expect(
      excluded.every(
        (row) => row.status === "excluded" && row.error_code === "compiled_input_envelope",
      ),
    ).toBe(true);
  });
  it.each([false, true])(
    "owns one deadline and aborts a stalled direct=%s provider once",
    async (direct) => {
      vi.useFakeTimers();
      try {
        let providerSignal: AbortSignal | undefined;
        let aborts = 0;
        const stalled: DecisionProvider = {
          ...provider,
          classify: async (_payload, signal) => {
            providerSignal = signal;
            signal.addEventListener("abort", () => {
              aborts++;
            });
            return new Promise(() => {});
          },
        };
        const pending = runPairs([pair("a")], {
          pass: 1,
          timeoutMs: 10,
          presentation: "original",
          provider: stalled,
          direct,
        });
        await Promise.resolve();
        expect(vi.getTimerCount()).toBe(1);
        await vi.advanceTimersByTimeAsync(10);
        expect((await pending)[0]).toMatchObject({
          status: "error",
          error_code: "deadline_exceeded",
        });
        expect(providerSignal?.aborted).toBe(true);
        expect(aborts).toBe(1);
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    },
  );
});
