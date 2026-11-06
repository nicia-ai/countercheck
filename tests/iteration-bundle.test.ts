import { describe, expect, it, vi } from "vitest";
import {
  compileBundle,
  DEFAULT_BUNDLE_PROFILES,
  parseBundleResponse,
  runBundle,
  type CompiledBundle,
} from "../eval/iteration/bundle.js";
import {
  compileCandidate,
  type CandidateId,
  type CandidatePayload,
} from "../eval/iteration/profiles.js";
import { sha256 } from "../eval/types.js";
import { JEV_MODEL } from "../src/providers/jev.js";

const pair = {
  claim: "Study enrolled exactly 180 participants.",
  evidence: "Study enrolled exactly 230 participants.",
};
function response(payload: CandidatePayload) {
  return {
    model: JEV_MODEL as string,
    model_revision: "fixture-revision",
    usage: { input_tokens: 123, output_tokens: 17 },
    answers: Object.fromEntries(
      Object.entries(payload.questions).map(([id, q]) => [
        id,
        q.type === "noul"
          ? { type: "noul", noul: id.endsWith("determinable") ? 0.2 : 0.9 }
          : {
              type: "choice",
              probabilities: Object.fromEntries(
                Object.keys(q.criteria).map((label) => [
                  label,
                  label === (Object.hasOwn(q.criteria, "p_0_0") ? "p_0_0" : "contradiction")
                    ? 1
                    : 0,
                ]),
              ),
            },
      ]),
    ),
  };
}
function originalQuestion(bundle: CompiledBundle, index: number, id: string) {
  return JSON.parse(
    JSON.stringify(bundle.payload.questions[bundle.heads[index]!.id_map[id]!])
      .replaceAll(`h${index}_numeric_rule`, `numeric_rule`)
      .replaceAll(`h${index}_quantitative_rule`, `quantitative_rule`),
  );
}

describe("one-call merged candidate bundle", () => {
  it("preserves all independent questions with shared pair text and namespaced rule references", () => {
    const bundle = compileBundle(DEFAULT_BUNDLE_PROFILES, pair);
    expect(bundle.profiles).toEqual([...DEFAULT_BUNDLE_PROFILES].sort());
    expect(bundle.payload.model).toBe(JEV_MODEL);
    expect(bundle.payload.state.claim).toEqual({ text: pair.claim });
    expect(bundle.payload.state.comparisons).toEqual([{ text: pair.evidence }]);
    const ids = Object.keys(bundle.payload.questions);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(
      bundle.heads.reduce((n, h) => n + Object.keys(h.compiled.payload.questions).length, 0),
    );
    for (const [i, head] of bundle.heads.entries()) {
      const original = compileCandidate(head.profile, pair);
      expect(head.compiled).toEqual(original);
      for (const [id, q] of Object.entries(original.payload.questions))
        expect(originalQuestion(bundle, i, id)).toEqual(q);
    }
    expect(bundle.payload.state.h4_numeric_rule).toBe(
      bundle.heads[4]!.compiled.payload.state.numeric_rule,
    );
    expect(bundle.payload.state.h4_quantitative_rule).toBe(
      bundle.heads[4]!.compiled.payload.state.quantitative_rule,
    );
    expect(JSON.stringify(bundle.payload.questions.h4_q_0_quantitative)).toContain(
      "`h4_quantitative_rule`",
    );
    expect(bundle.compiled_bytes).toBe(
      new TextEncoder().encode(JSON.stringify(bundle.payload)).length,
    );
    expect(bundle.prompt_sha256).toBe(sha256(JSON.stringify(bundle.payload)));
    expect(bundle.compiled_bytes).toBeLessThanOrEqual(16_384);
  });
  it("keeps different numeric rule variants separate without rewriting customer text", () => {
    const input = {
      claim: "Text contains `numeric_rule` and `quantitative_rule`.",
      evidence: "Other text contains `numeric_rule`.",
    };
    const bundle = compileBundle(["semantic-numeric", "semantic-numeric-v2"], input);
    expect(bundle.payload.state.claim).toEqual({ text: input.claim });
    expect(bundle.payload.state.comparisons).toEqual([{ text: input.evidence }]);
    expect(bundle.payload.state.h0_quantitative_rule).not.toBe(
      bundle.payload.state.h1_quantitative_rule,
    );
    expect(JSON.stringify(bundle.payload.questions.h0_q_0_quantitative)).toContain(
      "`h0_quantitative_rule`",
    );
    expect(JSON.stringify(bundle.payload.questions.h1_q_0_quantitative)).toContain(
      "`h1_quantitative_rule`",
    );
  });
  it("parses fresh complete merged outputs and restores every original head ID", () => {
    const bundle = compileBundle(DEFAULT_BUNDLE_PROFILES, pair),
      raw = response(bundle.payload),
      parsed = parseBundleResponse(raw, bundle);
    expect(parsed.heads).toHaveLength(5);
    for (const [index, head] of parsed.heads.entries()) {
      expect(Object.keys(head.raw_answers)).toEqual(
        Object.keys(bundle.heads[index]!.compiled.payload.questions),
      );
      expect(head.features.conflict).toBe(
        head.profile === "noul-conflict" || head.profile === "evidence-refutation" ? 0.9 : 1,
      );
      expect(head).not.toHaveProperty("request_usage");
      expect(head).not.toHaveProperty("input_tokens");
    }
    expect(parsed.heads[4]!.features).toMatchObject({
      numeric_available: true,
      numeric_probability: 1,
      numeric_relation: "incompatible",
      quantitative_decisive: 0.9,
    });
    expect(parsed.heads[0]!.features.determinable).toBe(0.2);
    expect(parsed.request_usage).toEqual({ input_tokens: 123, output_tokens: 17 });
    expect(parsed.prompt_sha256).toBe(bundle.prompt_sha256);
    expect(parsed.model_revision).toBe("fixture-revision");
  });
  it("rejects missing/extra questions, wrong types, malformed distributions and wrong model", () => {
    const bundle = compileBundle(DEFAULT_BUNDLE_PROFILES, pair);
    const mutations = [
      (r: ReturnType<typeof response>) => {
        delete r.answers.h1_q_0_relation;
      },
      (r: ReturnType<typeof response>) => {
        r.answers.extra = r.answers.h1_q_0_relation!;
      },
      (r: ReturnType<typeof response>) => {
        r.answers.h1_q_0_relation = { type: "noul", noul: 0.9 };
      },
      (r: ReturnType<typeof response>) => {
        const a = r.answers.h1_q_0_relation!;
        if ("probabilities" in a) a.probabilities = { ...a.probabilities, extra: 0 };
      },
      (r: ReturnType<typeof response>) => {
        const a = r.answers.h1_q_0_relation!;
        if ("probabilities" in a) a.probabilities = { ...a.probabilities, contradiction: 0.5 };
      },
      (r: ReturnType<typeof response>) => {
        r.model = "wrong-model";
      },
    ];
    for (const mutate of mutations) {
      const raw = response(bundle.payload);
      mutate(raw);
      expect(() => parseBundleResponse(raw, bundle)).toThrow();
    }
  });
  it("makes exactly one transport call and accounts usage once for all heads", async () => {
    const send = vi.fn<typeof fetch>(
      async (_url, init) =>
        new Response(JSON.stringify(response(JSON.parse(init!.body as string))), {
          headers: { "content-type": "application/json" },
        }),
    );
    const result = await runBundle(DEFAULT_BUNDLE_PROFILES, pair, {
      apiKey: "fixture-key",
      signal: new AbortController().signal,
      fetch: send,
    });
    expect(send).toHaveBeenCalledOnce();
    expect(result.provider_calls).toBe(1);
    expect(result.heads).toHaveLength(5);
    expect(result.request_usage).toEqual({ input_tokens: 123, output_tokens: 17 });
    expect(JSON.parse(send.mock.calls[0]![1]!.body as string).model).toBe(JEV_MODEL);
  });
  it("accepts a maximal plain-text pair but rejects escaped actual-body overflow before dispatch", async () => {
    const plain = { claim: "a".repeat(4096), evidence: "b".repeat(2048) };
    expect(compileBundle(DEFAULT_BUNDLE_PROFILES, plain).compiled_bytes).toBeLessThanOrEqual(
      16_384,
    );
    const send = vi.fn<typeof fetch>();
    await expect(
      runBundle(
        DEFAULT_BUNDLE_PROFILES,
        { claim: '"'.repeat(4096), evidence: '"'.repeat(2048) },
        { apiKey: "fixture", signal: new AbortController().signal, fetch: send },
      ),
    ).rejects.toMatchObject({ code: "compiled_input_too_large", status: 422 });
    expect(send).not.toHaveBeenCalled();
  });
  it("does not retry provider failures or expose raw error bodies", async () => {
    const send = vi.fn<typeof fetch>(
      async () => new Response("PRIVATE_UPSTREAM_ERROR", { status: 500 }),
    );
    await expect(
      runBundle(DEFAULT_BUNDLE_PROFILES, pair, {
        apiKey: "fixture",
        signal: new AbortController().signal,
        fetch: send,
      }),
    ).rejects.toMatchObject({
      code: "provider_unavailable",
      message: "The inference provider is unavailable.",
    });
    expect(send).toHaveBeenCalledOnce();
  });
  it("rejects duplicate/unknown/empty heads and invalid text before inference", () => {
    expect(() => compileBundle([], pair)).toThrow("unique known");
    expect(() => compileBundle(["literal-contract", "literal-contract"], pair)).toThrow(
      "unique known",
    );
    expect(() => compileBundle(["unknown" as CandidateId], pair)).toThrow("unique known");
    expect(() => compileBundle(DEFAULT_BUNDLE_PROFILES, { ...pair, claim: "" })).toThrow();
    expect(() => compileBundle(DEFAULT_BUNDLE_PROFILES, { ...pair, evidence: "\ud800" })).toThrow();
  });
});
