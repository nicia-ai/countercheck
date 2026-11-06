import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { JEV_MODEL, JEV_URL } from "../src/providers/jev.js";
import { compileProfile } from "../eval/prompt-ablation/profiles.js";
import {
  parseProfileResponse,
  runProfilePair,
  planExperiment,
  executeExperiment,
  summarizeExperiment,
  type AblationObservation,
} from "../eval/prompt-ablation/runner.js";
import { withPredictionCheckpoint } from "../eval/checkpoint.js";
import type { Pair, Manifest, Prediction } from "../eval/types.js";

const pair = (id: string, expected = "contradiction"): Pair => ({
  id,
  dataset: "synthetic-smoke",
  variant: "test-contract",
  split: "synthetic",
  source_id: id,
  group_id: id,
  claim: "The plan includes SSO.",
  evidence: "The plan excludes SSO.",
  gold: expected === "contradiction" ? "contradiction" : "non_contradiction",
  native_label: "fixture",
  source_metadata: { expected_verdict: expected },
});
const fixture = (pairs: Pair[]): Manifest => ({
  schema_version: 1,
  adapter_version: "countercheck-public-pairs-v1",
  purpose: "synthetic-smoke",
  sources: [
    {
      name: "fixture",
      url: "local:fixture",
      revision: "fixture",
      sha256: "a".repeat(64),
      license: "fixture",
      license_url: "local:license",
    },
  ],
  sampling: {
    seed: "fixture",
    max_pairs: pairs.length,
    available_pairs: pairs.length,
    selected_pairs: pairs.length,
    method: "fixture",
    excluded_unlabeled: 0,
    strata: {},
  },
  pairs,
});
const distribution = {
  contradiction: 0.9,
  consistent: 0.1,
  different_scope: 0,
  insufficient_context: 0,
};
const choice = (id: string) => ({
  model: JEV_MODEL,
  answers: { [id]: { type: "choice", probabilities: distribution } },
  usage: { input_tokens: 17, output_tokens: 0 },
});
const noul = (conflict: number, determinable: number) => ({
  model: JEV_MODEL,
  answers: {
    q_conflict: { type: "noul", noul: conflict },
    q_determinable: { type: "noul", noul: determinable },
  },
});
const fakeSend = (): typeof fetch =>
  vi.fn<typeof fetch>(async (_url, init) => {
    const payload = JSON.parse(String(init?.body)) as {
      questions: Record<string, { type: string }>;
    };
    return Response.json(
      Object.values(payload.questions)[0]?.type === "noul"
        ? noul(0.9, 0.9)
        : choice(Object.keys(payload.questions)[0]!),
    );
  });

describe("strict prompt ablation response parsing", () => {
  it("uses the compiled exact choice key, including the unchanged baseline q_000", () => {
    const compiled = compileProfile("baseline", pair("p"));
    expect(Object.keys(compiled.payload.questions)).toEqual(["q_000"]);
    expect(parseProfileResponse(choice("q_000"), compiled).kind).toBe("choice");
    expect(() => parseProfileResponse(choice("q_relation"), compiled)).toThrow();
    expect(() =>
      parseProfileResponse(
        {
          ...choice("q_000"),
          answers: { ...choice("q_000").answers, q_extra: choice("q_000").answers.q_000 },
        },
        compiled,
      ),
    ).toThrow();
    expect(() =>
      parseProfileResponse(
        {
          model: JEV_MODEL,
          answers: {
            q_000: { type: "choice", probabilities: { ...distribution, contradiction: 0.8 } },
          },
        },
        compiled,
      ),
    ).toThrow();
  });
  it("accepts only the official noul field and exact two-answer coverage", () => {
    const compiled = compileProfile("dual-noul", pair("p"));
    expect(parseProfileResponse(noul(0.9, 0.8), compiled)).toMatchObject({
      kind: "dual-noul",
      scores: { conflict: 0.9, determinable: 0.8 },
    });
    for (const answer of [
      { type: "noul", probability: 0.9 },
      { type: "noul", noul: 1.1 },
      { type: "noul", noul: 0.9, confidence: 0.9 },
    ])
      expect(() =>
        parseProfileResponse(
          {
            model: JEV_MODEL,
            answers: { q_conflict: answer, q_determinable: { type: "noul", noul: 0.9 } },
          },
          compiled,
        ),
      ).toThrow();
    expect(() =>
      parseProfileResponse(
        { model: JEV_MODEL, answers: { q_conflict: { type: "noul", noul: 0.9 } } },
        compiled,
      ),
    ).toThrow();
    expect(() => parseProfileResponse({ ...noul(0.9, 0.9), model: "jev-1.13" }, compiled)).toThrow(
      "unexpected model",
    );
  });
});

describe("pinned exactly-once inference and mapping", () => {
  it("sends text only to the compiler and one pinned request, preserving usage and payload identity", async () => {
    const send = fakeSend();
    const compiler = vi.fn(compileProfile);
    const result = await runProfilePair("baseline", pair("p"), {
      apiKey: "fixture-only",
      sequence: 0,
      manifestHash: "a".repeat(64),
      fetch: send,
      compiler,
    });
    expect(result.prediction).toMatchObject({
      status: "ok",
      verdict: "contradiction",
      reported_model: JEV_MODEL,
      input_tokens: 17,
      output_tokens: 0,
      raw_scores: distribution,
    });
    expect(compiler.mock.calls[0]?.[1]).toEqual({
      claim: pair("p").claim,
      evidence: pair("p").evidence,
    });
    expect(send).toHaveBeenCalledOnce();
    expect(vi.mocked(send).mock.calls[0]?.[0]).toBe(JEV_URL);
    expect(JSON.parse(String(vi.mocked(send).mock.calls[0]?.[1]?.body)).model).toBe(JEV_MODEL);
    expect(result.compiled?.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.provider_calls).toBe(1);
  });
  it.each([
    [0.9, 0.9, "contradiction"],
    [0.1, 0.9, "no_contradiction"],
    [0.9, 0.2, "uncertain"],
    [0.5, 0.9, "uncertain"],
  ] as const)(
    "gates dual Noul conflict=%s determinable=%s without fabricating four-way scores",
    async (conflict, determinable, verdict) => {
      const send = vi.fn<typeof fetch>(async () => Response.json(noul(conflict, determinable)));
      const { prediction } = await runProfilePair("dual-noul", pair("p"), {
        apiKey: "fixture",
        sequence: 1,
        manifestHash: "a".repeat(64),
        fetch: send,
      });
      expect(prediction).toMatchObject({
        status: "ok",
        verdict,
        probabilities: {
          contradiction: conflict,
          no_contradiction: 1 - conflict,
          insufficient_context: 0,
        },
        raw_noul: { q_conflict: conflict, q_determinable: determinable },
      });
      expect(prediction).not.toHaveProperty("raw_scores");
      expect(send).toHaveBeenCalledOnce();
    },
  );
  it("rejects oversized inputs before dispatch and keeps malformed responses as errors", async () => {
    const send = fakeSend();
    expect(
      (
        await runProfilePair(
          "baseline",
          { ...pair("p"), claim: "x".repeat(4097) },
          { apiKey: "fixture", sequence: 0, manifestHash: "a".repeat(64), fetch: send },
        )
      ).prediction.status,
    ).toBe("excluded");
    expect(send).not.toHaveBeenCalled();
    const malformed = vi.fn<typeof fetch>(async () =>
      Response.json({ model: JEV_MODEL, answers: {} }),
    );
    const row = await runProfilePair("baseline", pair("p"), {
      apiKey: "fixture",
      sequence: 1,
      manifestHash: "a".repeat(64),
      fetch: malformed,
    });
    expect(row.prediction).toMatchObject({
      status: "error",
      error_code: "provider_invalid_response",
    });
    expect(row.prediction).not.toHaveProperty("probabilities");
    expect(malformed).toHaveBeenCalledOnce();
  });
  it("owns one deadline and aborts a stalled request without retrying", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const send = vi.fn<typeof fetch>(async (_url, init) => {
      signal = init?.signal ?? undefined;
      return new Promise(() => {});
    });
    try {
      const pending = runProfilePair("baseline", pair("p"), {
        apiKey: "fixture",
        sequence: 1,
        manifestHash: "a".repeat(64),
        fetch: send,
      });
      await Promise.resolve();
      expect(vi.getTimerCount()).toBe(1);
      await vi.advanceTimersByTimeAsync(3000);
      expect((await pending).prediction).toMatchObject({
        status: "error",
        error_code: "deadline_exceeded",
      });
      expect(signal?.aborted).toBe(true);
      expect(send).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("experiment reservation, concurrency and checkpoints", () => {
  it("checks the whole planned budget and serializes durable writes across two sequential queues", async () => {
    const inputs = [
      { name: "fixture", sha256: "a".repeat(64), manifest: fixture([pair("a"), pair("b")]) },
    ];
    expect(() => planExperiment(inputs, ["baseline", "inline-policy"], 3, 0.01, 1)).toThrow();
    expect(() => planExperiment(inputs, ["baseline", "inline-policy"], 4, 0.1, 0.3)).toThrow();
    const plan = planExperiment(inputs, ["baseline", "inline-policy"], 4, 0.01, 1);
    let active = 0;
    let peak = 0;
    let writes = 0;
    let peakWrites = 0;
    const dir = await mkdtemp(join(tmpdir(), "countercheck-ablation-"));
    const path = join(dir, "checkpoint.jsonl");
    const send = vi.fn<typeof fetch>(async (...args) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active--;
      return fakeSend()(...args);
    });
    try {
      const rows = await withPredictionCheckpoint(
        path,
        { manifest_sha256: "a".repeat(64) },
        async (append) =>
          executeExperiment(plan, {
            apiKey: "fixture",
            concurrency: 2,
            fetch: send,
            append: async (observations) => {
              writes++;
              peakWrites = Math.max(peakWrites, writes);
              await new Promise((resolve) => setTimeout(resolve, 1));
              await append(observations);
              writes--;
            },
          }),
      );
      expect(rows.map((r) => r.sequence)).toEqual([0, 1, 2, 3]);
      expect(peak).toBe(2);
      expect(peakWrites).toBe(1);
      expect(send).toHaveBeenCalledTimes(4);
      expect((await readFile(path, "utf8")).trim().split("\n")).toHaveLength(4);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
  it("stops further dispatch when a checkpoint fails, while settling in-flight requests", async () => {
    const plan = planExperiment(
      [
        {
          name: "fixture",
          sha256: "a".repeat(64),
          manifest: fixture([pair("a"), pair("b"), pair("c")]),
        },
      ],
      ["baseline", "inline-policy"],
      6,
      0.01,
      1,
    );
    const send = fakeSend();
    await expect(
      executeExperiment(plan, {
        apiKey: "fixture",
        concurrency: 2,
        fetch: send,
        append: async () => {
          throw new Error("fixture disk failure");
        },
      }),
    ).rejects.toThrow("fixture disk failure");
    expect(send).toHaveBeenCalledTimes(2);
  });
});

describe("honest contract diagnostic denominators", () => {
  it("excludes explicit expected uncertainty from binary metrics and paired false positives, but keeps execution and uncertainty recall", () => {
    const observe = (
      profile: "baseline" | "inline-policy",
      p: Pair,
      verdict: Prediction["verdict"],
    ): AblationObservation => ({
      sequence: 0,
      profile,
      manifest_sha256: "a".repeat(64),
      dataset_key: "synthetic-smoke/test-contract/synthetic",
      pair: p,
      compiled: null,
      provider_calls: 0,
      prediction: {
        pair_id: p.id,
        pass: 1,
        status: "ok",
        verdict: verdict!,
        probabilities: {
          contradiction: verdict === "contradiction" ? 1 : 0,
          no_contradiction: verdict === "contradiction" ? 0 : 1,
          insufficient_context: 0,
        },
        latency_ms: 1,
      },
    });
    const rows = [
      observe("baseline", pair("p"), "contradiction"),
      observe("baseline", pair("u", "uncertain"), "contradiction"),
      observe("inline-policy", pair("p"), "contradiction"),
      observe("inline-policy", pair("u", "uncertain"), "uncertain"),
    ];
    const result = summarizeExperiment(rows, ["baseline", "inline-policy"]);
    expect(result.by_profile.baseline!.overall.denominator).toBe(1);
    const diagnostics =
      result.by_profile["inline-policy"]!.execution_and_contract_by_dataset[
        "synthetic-smoke/test-contract/synthetic"
      ]!;
    expect(diagnostics).toMatchObject({
      all_cases: 2,
      completed: 2,
      binary_quality_cases: 1,
      binary_quality_excluded_expected_uncertain: 1,
    });
    expect(diagnostics.expected_uncertain_recall.value).toBe(1);
    expect(
      result.paired_against_fresh_baseline["inline-policy"]![
        "synthetic-smoke/test-contract/synthetic"
      ],
    ).toMatchObject({
      matched_pairs: 2,
      binary_eligible_pairs: 1,
      expected_uncertain_pairs: 1,
      recovered_expected_uncertain: 1,
      new_false_positive: 0,
      removed_false_positive: 0,
    });
  });
});
