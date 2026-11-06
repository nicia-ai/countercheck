import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  checkRequestSchema,
  checkResponseSchema,
  errorResponseSchema,
  type CheckRequest,
  type RawScores,
} from "../src/contracts/index.js";
import { LIMITS } from "../src/contracts/limits.js";
import { compileCheck, evaluateCheck, POLICY } from "../src/kernel/index.js";
import type { DecisionProvider } from "../src/providers/types.js";

const request = (): CheckRequest =>
  checkRequestSchema.parse({
    claim: { id: "claim", text: "Starter includes SSO." },
    against: [
      { id: "z", text: "Starter excludes SSO." },
      { id: "a", text: "Starter has SSO." },
    ],
  });
const scores = (positive = 0.97): RawScores => ({
  contradiction: positive,
  consistent: 1 - positive,
  different_scope: 0,
  insufficient_context: 0,
});
const answer = (probabilities: RawScores = scores()) => ({ type: "choice", probabilities });
const options = () => ({ requestId: "req_test", signal: new AbortController().signal });
const provider = (value: unknown): DecisionProvider => ({
  id: "fake",
  model: "fake-v1",
  classify: vi.fn(async () => value),
});
const envelope = (a = scores(), z = scores(0.01)) => ({
  model: "reported-v1",
  answers: { q_000: answer(a), q_001: answer(z) },
  usage: { input_tokens: 13, output_tokens: 2 },
  model_revision: "immutable-revision",
});

describe("canonical closed contracts", () => {
  it("defaults the profile and preserves exact text", () => {
    const parsed = checkRequestSchema.parse({
      claim: { id: "c", text: "  A\r\n" },
      against: [{ id: "C", text: "B" }],
    });
    expect(parsed.profile).toBe("balanced-v1");
    expect(parsed.model).toBe("jev-1.14.0");
    expect(parsed.claim.text).toBe("  A\r\n");
  });
  it.each([
    { claim: { id: "c", text: "" }, against: [{ id: "a", text: "ok" }] },
    { claim: { id: "c", text: " \t\r\n" }, against: [{ id: "a", text: "ok" }] },
    { claim: { id: "c", text: "ok", title: "extra" }, against: [{ id: "a", text: "ok" }] },
    { claim: { id: "c", text: "ok" }, against: [{ id: "a", text: "ok", extra: true }] },
    { claim: { id: "c", text: "ok" }, against: [{ id: "a", text: "ok" }], context: "extra" },
    { claim: { id: "c", text: "ok" }, against: [{ id: "a", text: "ok" }], profile: "custom" },
    { claim: { id: "same", text: "ok" }, against: [{ id: "same", text: "ok" }] },
    {
      claim: { id: "c", text: "ok" },
      against: [
        { id: "a", text: "ok" },
        { id: "a", text: "ok" },
      ],
    },
    { claim: { id: "not ascii é", text: "ok" }, against: [{ id: "a", text: "ok" }] },
    { claim: { id: "c", text: "ok" }, against: [] },
    {
      claim: { id: "c", text: "ok" },
      against: Array.from({ length: 21 }, (_, i) => ({ id: `${i}`, text: "ok" })),
    },
  ])("rejects invalid fields and identities %#", (value) => {
    expect(checkRequestSchema.safeParse(value).success).toBe(false);
  });
  it("measures UTF-8 rather than UTF-16 units at both boundaries", () => {
    const base = request();
    base.claim.text = "é".repeat(LIMITS.claimBytes / 2);
    base.against[0]!.text = "😀".repeat(LIMITS.comparisonBytes / 4);
    expect(checkRequestSchema.safeParse(base).success).toBe(true);
    base.claim.text += "a";
    expect(checkRequestSchema.safeParse(base).success).toBe(false);
    base.claim.text = "fine";
    base.against[0]!.text += "a";
    expect(checkRequestSchema.safeParse(base).success).toBe(false);
  });
  it.each(["\ud800", "\udfff", "a\ud800b", "\ud800\ud800", "😀\udfff"])(
    "rejects unpaired surrogate %j",
    (text) => {
      const input = request();
      input.claim.text = text;
      expect(checkRequestSchema.safeParse(input).success).toBe(false);
      expect(() => compileCheck(input, "model")).toThrow(
        expect.objectContaining({ status: 400, code: "invalid_unicode" }),
      );
    },
  );
  it("exports JSON Schemas without transforms/unrepresentable types", () => {
    for (const schema of [checkRequestSchema, checkResponseSchema, errorResponseSchema]) {
      const json = z.toJSONSchema(schema, { io: "input" });
      if (schema === checkResponseSchema) {
        expect(json.anyOf).toHaveLength(3);
        for (const variant of json.anyOf ?? [])
          expect(variant).toMatchObject({ type: "object", additionalProperties: false });
        continue;
      }
      expect(json.type).toBe("object");
      expect(json.additionalProperties).toBe(false);
    }
  });
});

describe("compiler and attribution", () => {
  it("canonicalizes provider state and questions independently of caller order", () => {
    const forward = request();
    const reverse = { ...forward, against: [...forward.against].reverse() };
    expect(compileCheck(forward, "m").payload).toEqual(compileCheck(reverse, "m").payload);
    expect(compileCheck(forward, "m").payload.state.comparisons).toEqual([
      { text: "Starter has SSO." },
      { text: "Starter excludes SSO." },
    ]);
    expect(JSON.stringify(compileCheck(forward, "m").payload)).not.toContain('"id"');
  });
  it("evaluation permutation changes actual presentation and question references while retaining pair identity", () => {
    const compiled = compileCheck(request(), "m", { presentationOrder: ["z", "a"] });
    expect(compiled.payload.state.comparisons).toEqual([
      { text: "Starter excludes SSO." },
      { text: "Starter has SSO." },
    ]);
    expect(Object.keys(compiled.payload.questions)).toEqual(["q_001", "q_000"]);
    expect(compiled.payload.questions.q_001!.instructions).toContain("comparisons[0].text");
    expect(compiled.againstIdByQuestion.get("q_001")).toBe("z");
  });
  it.each(
    [[], ["a"], ["a", "a"], ["z", "missing"], ["a", "z", "extra"]].map((presentationOrder) => ({
      presentationOrder,
    })),
  )("rejects incomplete or forged permutation %j", ({ presentationOrder }) => {
    expect(() => compileCheck(request(), "m", { presentationOrder })).toThrow(
      expect.objectContaining({ code: "invalid_presentation_order" }),
    );
  });
  it("supports 20 short comparisons and rejects oversized aggregate input before dispatch", async () => {
    const input = request();
    input.against = Array.from({ length: 20 }, (_, i) => ({ id: `${i}`, text: "x" }));
    expect(compileCheck(input, "m").questionIds).toHaveLength(20);
    input.against.forEach((item) => {
      item.text = "x".repeat(2_048);
    });
    const fake = provider(envelope());
    await expect(evaluateCheck(input, fake, options())).rejects.toMatchObject({
      status: 422,
      code: "compiled_input_too_large",
    });
    expect(fake.classify).not.toHaveBeenCalled();
  });
  it("enforces exactly the compiled byte boundary without truncation", () => {
    const input = request();
    input.against = Array.from({ length: 7 }, (_, i) => ({ id: `${i}`, text: "x" }));
    // Add budget to multiple snippets while keeping every per-snippet bound valid.
    let remaining = LIMITS.compiledBytes - compileCheck(input, "m").compiledBytes;
    const texts = [input.claim, ...input.against];
    for (const item of texts) {
      const max = item === input.claim ? LIMITS.claimBytes : LIMITS.comparisonBytes;
      const add = Math.min(remaining, max - item.text.length);
      item.text += "x".repeat(add);
      remaining -= add;
    }
    expect(remaining).toBe(0);
    expect(compileCheck(input, "m").compiledBytes).toBe(LIMITS.compiledBytes);
    input.against.at(-1)!.text += "x";
    expect(() => compileCheck(input, "m")).toThrow(
      expect.objectContaining({ code: "compiled_input_too_large" }),
    );
  });
  it("retains qualifiers, scope precedence, distrust and pair-only semantics in the shared policy", () => {
    for (const meaning of [
      "untrusted data",
      "explicitly disjoint",
      "Restatement, omission",
      "Submission order gives no authority",
      "never extra evidence",
      "three or more texts",
      "quoted, rejected or proposed",
    ])
      expect(POLICY).toContain(meaning);
  });
});

describe("atomic decisions", () => {
  it("calls once, preserves raw probabilities and restores caller order and server-owned evidence", async () => {
    const fake = provider(envelope());
    const result = await evaluateCheck(request(), fake, options());
    expect(fake.classify).toHaveBeenCalledTimes(1);
    expect(result.comparisons.map((item) => item.against_id)).toEqual(["z", "a"]);
    expect(result.comparisons[0]!.verdict).toBe("no_contradiction_detected");
    expect(result.comparisons[1]!.raw_scores).toEqual(scores());
    expect(result.comparisons[1]!.evidence).toEqual({
      claim_id: "claim",
      against_id: "a",
      granularity: "submitted_text",
    });
    expect(result).not.toHaveProperty("verdict");
    expect(checkResponseSchema.safeParse({ ...result, verdict: "contradiction" }).success).toBe(
      false,
    );
    expect(result.comparisons[1]!.verdict).toBe("contradiction");
    expect(result.coverage).toEqual({
      scope: "claim_against_each_text",
      requested: 2,
      completed: 2,
      unassessed: 0,
      input_truncated: false,
    });
    expect(result.engine).toMatchObject({
      reported_model: "reported-v1",
      requested_model: "fake-v1",
      model_revision: "immutable-revision",
    });
    expect(result.usage).toEqual({ provider_calls: 1, input_tokens: 13 });
  });
  it.each([
    [scores(0.8), "contradiction", "incompatible_assertions"],
    [scores(0.2), "no_contradiction_detected", "jointly_satisfiable"],
    [
      { contradiction: 0.2, consistent: 0, different_scope: 0.8, insufficient_context: 0 },
      "no_contradiction_detected",
      "different_scope",
    ],
    [scores(0.79), "uncertain", "insufficient_confidence_or_context"],
    [scores(0.21), "uncertain", "insufficient_confidence_or_context"],
    [
      { contradiction: 0, consistent: 0, different_scope: 0, insufficient_context: 1 },
      "uncertain",
      "insufficient_confidence_or_context",
    ],
    [
      { contradiction: 0.01, consistent: 0.49, different_scope: 0.5, insufficient_context: 0 },
      "uncertain",
      "insufficient_confidence_or_context",
    ],
  ] as const)("maps release starting thresholds %#", async (distribution, verdict, reason) => {
    const result = await evaluateCheck(
      request(),
      provider(envelope(distribution, distribution)),
      options(),
    );
    expect(result.comparisons.map((item) => item.verdict)).toEqual([verdict, verdict]);
    expect(result.comparisons.every((item) => item.reason === reason)).toBe(true);
    expect(result.status).toBe("completed");
  });
  it("preserves mixed uncertain and clear outcomes without a request verdict", async () => {
    const result = await evaluateCheck(
      request(),
      provider(envelope(scores(0.4), scores(0.01))),
      options(),
    );
    expect(result).not.toHaveProperty("verdict");
    expect(result.status).toBe("completed");
    expect(result.comparisons.map((item) => item.verdict)).toEqual([
      "no_contradiction_detected",
      "uncertain",
    ]);
  });
  it("never invents model revision or usage", async () => {
    const result = await evaluateCheck(
      request(),
      provider({ answers: envelope().answers }),
      options(),
    );
    expect(result.engine.reported_model).toBeNull();
    expect(result.engine.model_revision).toBeNull();
    expect(result.usage.input_tokens).toBeNull();
  });
  it("permutes actual provider presentation while restoring identical pair results", async () => {
    const fake: DecisionProvider = {
      id: "path-reading-fixture",
      model: "fixture",
      async classify(payload) {
        const texts = payload.state.comparisons as { text: string }[];
        return {
          answers: Object.fromEntries(
            Object.entries(payload.questions).map(([id, question]) => {
              if (typeof question.instructions !== "string")
                throw new Error("Balanced fixture requires string instructions");
              const index = Number(/comparisons\[(\d+)\]/.exec(question.instructions)![1]);
              return [id, answer(scores(texts[index]!.text.includes("excludes") ? 0.97 : 0.01))];
            }),
          ),
        };
      },
    };
    const original = await evaluateCheck(request(), fake, options());
    const reordered = await evaluateCheck(request(), fake, {
      ...options(),
      presentationOrder: ["z", "a"],
    });
    expect(reordered).toEqual(original);
    expect(original.comparisons.map((item) => item.verdict)).toEqual([
      "contradiction",
      "no_contradiction_detected",
    ]);
  });
  it.each([
    null,
    { ...envelope(), refusal: "no" },
    { ...envelope(), answers: { q_000: answer() } },
    { ...envelope(), answers: { ...envelope().answers, forged: answer() } },
    { ...envelope(), answers: { q_000: answer(), q_001: { type: "noul", noul: 1 } } },
    { ...envelope(), answers: { q_000: answer(), q_001: { ...answer(), choice: "invented" } } },
    { ...envelope(), answers: { q_000: answer(), q_001: { ...answer(), choice: "consistent" } } },
    { ...envelope(), answers: { q_000: answer(), q_001: { ...answer(), confidence: NaN } } },
    { ...envelope(), usage: { input_tokens: -1 } },
    { ...envelope(), usage: { input_tokens: 1.5 } },
    {
      ...envelope(),
      answers: { q_000: answer(), q_001: answer({ ...scores(), contradiction: Infinity }) },
    },
    {
      ...envelope(),
      answers: { q_000: answer(), q_001: answer({ ...scores(), contradiction: -0.1 }) },
    },
    {
      ...envelope(),
      answers: { q_000: answer(), q_001: { type: "choice", probabilities: { contradiction: 1 } } },
    },
    {
      ...envelope(),
      answers: {
        q_000: answer(),
        q_001: { type: "choice", probabilities: { ...scores(), invented: 0 } },
      },
    },
    {
      ...envelope(),
      answers: {
        q_000: answer(),
        q_001: answer({
          contradiction: 0.9,
          consistent: 0.9,
          different_scope: 0,
          insufficient_context: 0,
        }),
      },
    },
  ])("rejects invalid upstream outputs atomically with safe errors %#", async (raw) => {
    await expect(evaluateCheck(request(), provider(raw), options())).rejects.toMatchObject({
      status: 502,
      code: "provider_invalid_response",
    });
  });
  it("accepts rounding tolerance without renormalizing raw scores", async () => {
    const rounded = {
      contradiction: 0.8005,
      consistent: 0.2,
      different_scope: 0,
      insufficient_context: 0,
    };
    const raw = envelope(rounded, rounded);
    raw.answers.q_000 = { ...answer(rounded), choice: "contradiction" } as ReturnType<
      typeof answer
    >;
    const result = await evaluateCheck(request(), provider(raw), options());
    expect(result.comparisons[0]!.raw_scores).toEqual(rounded);
  });
  it("accepts any maximizing selected label on a tie", async () => {
    const equal = {
      contradiction: 0.5,
      consistent: 0.5,
      different_scope: 0,
      insufficient_context: 0,
    };
    const raw = {
      answers: {
        q_000: { ...answer(equal), choice: "consistent" },
        q_001: { ...answer(equal), choice: "contradiction" },
      },
    };
    const result = await evaluateCheck(request(), provider(raw), options());
    expect(result.comparisons.every((item) => item.verdict === "uncertain")).toBe(true);
  });
  it("maps unknown upstream exceptions without exposing their text", async () => {
    const fake = provider(null);
    fake.classify = async () => {
      throw new Error("secret customer input");
    };
    await expect(evaluateCheck(request(), fake, options())).rejects.toMatchObject({
      status: 503,
      message: "The inference provider is unavailable.",
    });
  });
  it("does not dispatch an already aborted request and discards a late response", async () => {
    const controller = new AbortController();
    controller.abort();
    const fake = provider(envelope());
    await expect(
      evaluateCheck(request(), fake, { requestId: "req", signal: controller.signal }),
    ).rejects.toMatchObject({ status: 504 });
    expect(fake.classify).not.toHaveBeenCalled();
    const late = new AbortController();
    const lateProvider = provider(null);
    lateProvider.classify = async () => {
      late.abort();
      return envelope();
    };
    await expect(
      evaluateCheck(request(), lateProvider, { requestId: "req", signal: late.signal }),
    ).rejects.toMatchObject({ status: 504 });
  });
});
