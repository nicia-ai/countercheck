import { describe, expect, it, vi } from "vitest";
import { metrics, type Scored } from "../eval/metrics.js";
import { runPairs } from "../eval/backends.js";
import { predictionSchema, projectNliScores, type Pair, type Prediction } from "../eval/types.js";
import { validateReplay } from "../eval/replay.js";
import type { DecisionProvider } from "../src/providers/types.js";

const pair = (id: string): Pair => ({
  id,
  dataset: "synthetic-smoke",
  variant: "fixture",
  split: "synthetic",
  source_id: id,
  group_id: id,
  claim: "A",
  evidence: "B",
  gold: "non_contradiction",
  native_label: "fixture",
});
const prediction = (id: string): Prediction => ({
  pair_id: id,
  pass: 1,
  status: "ok",
  verdict: "no_contradiction",
  probabilities: { contradiction: 0, no_contradiction: 1, insufficient_context: 0 },
  latency_ms: 1,
});
const scored = (p: Prediction): Scored => ({ pair: pair(p.pair_id), prediction: p });
const options = { pass: 1, timeoutMs: 100, presentation: "original" as const };

describe("honest token usage accounting", () => {
  it("keeps missing token totals unknown instead of presenting zero", () => {
    const cost = metrics([scored(prediction("a"))]).cost;
    expect(cost.input_tokens).toBeNull();
    expect(cost.output_tokens).toBeNull();
    expect(cost.token_usage.input).toEqual({
      known_subtotal: 0,
      known_observations: 0,
      unknown_observations: 1,
    });
    expect(cost.token_usage.output).toEqual(cost.token_usage.input);
  });
  it("retains known subtotals and distinguishes a measured zero from missing usage", () => {
    const cost = metrics([
      scored({ ...prediction("a"), input_tokens: 12, output_tokens: 0 }),
      scored({ pair_id: "b", pass: 1, status: "error", latency_ms: 1 }),
      scored({ pair_id: "c", pass: 1, status: "excluded", input_tokens: 999, latency_ms: 0 }),
    ]).cost;
    expect(cost.input_tokens).toBeNull();
    expect(cost.output_tokens).toBeNull();
    expect(cost.token_usage.observations).toBe(2);
    expect(cost.token_usage.input).toEqual({
      known_subtotal: 12,
      known_observations: 1,
      unknown_observations: 1,
    });
    expect(cost.token_usage.output).toEqual({
      known_subtotal: 0,
      known_observations: 1,
      unknown_observations: 1,
    });
    expect(
      metrics([scored({ ...prediction("a"), input_tokens: 0, output_tokens: 0 })]).cost
        .input_tokens,
    ).toBe(0);
  });
  it("retains batch request input usage and counts it once, without allocating it to pairs", async () => {
    const provider: DecisionProvider = {
      id: "fixture",
      model: "fixture",
      async classify(payload) {
        return {
          usage: { input_tokens: 123, output_tokens: 7 },
          answers: Object.fromEntries(
            Object.keys(payload.questions).map((id) => [
              id,
              {
                type: "choice",
                probabilities: {
                  contradiction: 0,
                  consistent: 1,
                  different_scope: 0,
                  insufficient_context: 0,
                },
              },
            ]),
          ),
        };
      },
    };
    const rows = await runPairs([pair("a"), pair("b")], { ...options, provider });
    expect(rows.every((row) => row.input_tokens === undefined)).toBe(true);
    expect(rows.every((row) => row.request_usage?.input_tokens === 123)).toBe(true);
    const cost = metrics(rows.map(scored)).cost;
    expect(cost.input_tokens).toBe(123);
    expect(cost.output_tokens).toBeNull();
    expect(cost.token_usage.input).toEqual({
      known_subtotal: 123,
      known_observations: 1,
      unknown_observations: 0,
    });
    expect(cost.token_usage.output.unknown_observations).toBe(1);
    expect(
      metrics([...rows, ...rows.map((row) => ({ ...row, pass: 2 }))].map(scored)).cost.input_tokens,
    ).toBe(246);
  });
  it("prefers request totals over legacy per-pair usage and validates the request identity", () => {
    const rows = ["a", "b"].map((id) => ({
      ...prediction(id),
      input_tokens: 99,
      request_id: "req_shared",
      request_usage: { input_tokens: 99, output_tokens: 0 },
    }));
    expect(metrics(rows.map(scored)).cost.input_tokens).toBe(99);
    expect(metrics(rows.map(scored)).cost.output_tokens).toBe(0);
    expect(() =>
      predictionSchema.parse({
        ...prediction("a"),
        request_usage: { input_tokens: 1, output_tokens: null },
      }),
    ).toThrow();
  });
});

describe("rounded native probabilities", () => {
  it.each([false, true])(
    "round-trips accepted rounded four-way output through live direct=%s and replay",
    async (direct) => {
      const rawScores = {
        contradiction: 0,
        consistent: 0.8005,
        different_scope: 0.2,
        insufficient_context: 0,
      };
      const provider: DecisionProvider = {
        id: "rounded-fixture",
        model: "fixture",
        async classify(payload) {
          return {
            answers: Object.fromEntries(
              Object.keys(payload.questions).map((id) => [
                id,
                { type: "choice", probabilities: rawScores },
              ]),
            ),
          };
        },
      };
      const rows = await runPairs([pair("a")], { ...options, provider, direct });
      expect(rows[0]?.status).toBe("ok");
      expect(rows[0]?.raw_scores).toEqual(rawScores);
      expect(rows[0]?.probabilities).toEqual({
        contradiction: 0,
        no_contradiction: 1,
        insufficient_context: 0,
      });
      expect(validateReplay(rows, [pair("a")], 1)).toEqual(rows);
    },
  );
  it("normalizes pooled NLI negatives while preserving native probabilities", () => {
    const native = { contradiction: 0, entailment: 0.8005, neutral: 0.2 };
    const row = predictionSchema.parse({
      ...prediction("a"),
      probabilities: projectNliScores(native),
      nli_probabilities: native,
    });
    expect(row.probabilities?.no_contradiction).toBe(1);
    expect(row.nli_probabilities).toEqual(native);
    expect(validateReplay([row], [pair("a")], 1)).toEqual([row]);
  });
});

describe("deployed error-envelope classification", () => {
  const serviceOptions = {
    ...options,
    serviceUrl: "https://example.invalid",
    serviceKey: "synthetic-fixture-key",
  };
  const errorBody = (code: string) => ({
    request_id: "req_fixture",
    error: { code, message: "Fixture error.", retryable: false },
  });
  it("classifies the same compiled-envelope rejection identically through local and service routes", async () => {
    const pairs = Array.from({ length: 20 }, (_, i) => ({
      ...pair(`${i}`),
      evidence: "x".repeat(1000),
    }));
    const send = vi.fn<typeof fetch>(async () =>
      Response.json(errorBody("compiled_input_too_large"), { status: 422 }),
    );
    vi.stubGlobal("fetch", send);
    try {
      const local = await runPairs(pairs, { ...options, fake: true });
      const deployed = await runPairs(pairs, serviceOptions);
      expect(deployed.map(({ status, error_code }) => ({ status, error_code }))).toEqual(
        local.map(({ status, error_code }) => ({ status, error_code })),
      );
      const summary = metrics(deployed.map(scored));
      expect(summary.errors).toBe(0);
      expect(summary.excluded).toBe(20);
      expect(summary.latency_ms.attempted).toBe(0);
      expect(send).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it.each([
    [422, errorBody("invalid_request")],
    [401, errorBody("compiled_input_too_large")],
    [503, errorBody("provider_unavailable")],
    [422, { malformed: true }],
  ])("retains non-envelope/malformed HTTP %i failures as errors", async (status, body) => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () => Response.json(body, { status })),
    );
    try {
      expect((await runPairs([pair("a")], serviceOptions))[0]).toMatchObject({
        status: "error",
        error_code: `http_${status}`,
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("bounds and cancels an oversized service error body", async () => {
    const cancel = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(
        async () =>
          new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(new Uint8Array(65_537));
              },
              cancel,
            }),
            { status: 422, headers: { "content-type": "application/json" } },
          ),
      ),
    );
    try {
      expect((await runPairs([pair("a")], serviceOptions))[0]).toMatchObject({
        status: "error",
        error_code: "http_422",
      });
      expect(cancel).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
