import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  checkRequestSchema,
  checkResponseSchema,
  type CheckRequest,
} from "../src/contracts/index.js";
import { compileCheck, evaluateCheck } from "../src/kernel/index.js";
import { validatePayloadResponse } from "../src/providers/response.js";
import type { DecisionProvider, DecisionPayload } from "../src/providers/types.js";
import { makeRequest } from "../eval/backends.js";
import type { Pair } from "../eval/types.js";

const request = (
  profile: CheckRequest["profile"] = "semantic-v2",
  claim = "The limit is 10 kg.",
  against = "The limit is 20 kg.",
) =>
  checkRequestSchema.parse({
    profile,
    claim: { id: "c", text: claim },
    against: [{ id: "a", text: against }],
  });
const options = () => ({ requestId: "req_fixture", signal: new AbortController().signal });
const provider = (label: string): DecisionProvider => ({
  id: "fixture",
  model: "fixture",
  classify: vi.fn(async (payload: DecisionPayload) => ({
    answers: Object.fromEntries(
      Object.entries(payload.questions).map(([id, question]) => [
        id,
        {
          type: "choice",
          choice: label,
          probabilities: Object.fromEntries(
            Object.keys(question.criteria).map((key) => [key, key === label ? 1 : 0]),
          ),
        },
      ]),
    ),
  })),
});

describe("profile envelope and unchanged default", () => {
  it("keeps the original balanced payload byte-identical", () => {
    const input: CheckRequest = {
      model: "jev-1.14.0",
      profile: "balanced-v1",
      claim: { id: "claim", text: "Starter includes SSO." },
      against: [
        { id: "z", text: "Starter excludes SSO." },
        { id: "a", text: "Starter has SSO." },
      ],
    };
    expect(
      createHash("sha256")
        .update(JSON.stringify(compileCheck(input, "jev-1.14.0").payload))
        .digest("hex"),
    ).toBe("ecbea32fdacd7627bf61583b6082a091b288c4d282a6deb514aa5f8fc4a14898");
  });
  it.each(["semantic-v2", "structured-value-v1"] as const)(
    "fits20 short %s pairs in one16KiB payload",
    (profile) => {
      const input = request(profile);
      input.against = Array.from({ length: 20 }, (_, i) => ({
        id: `${i}`,
        text: "The limit is 20 kg.",
      }));
      const compiled = compileCheck(input, "jev-1.14.0");
      expect(compiled.compiledBytes).toBeLessThanOrEqual(16_384);
      expect(compiled.questionIds).toHaveLength(20);
      expect(JSON.stringify(compiled.payload.state)).not.toContain("The limit is 20 kg.");
      expect(JSON.stringify(compiled.payload).match(/The limit is 10 kg\./g)).toHaveLength(1);
      expect(() =>
        compileCheck(
          { ...input, against: input.against.map((item) => ({ ...item, text: "x".repeat(2048) })) },
          "jev-1.14.0",
        ),
      ).toThrow(expect.objectContaining({ code: "compiled_input_too_large" }));
    },
  );
  it.each(["semantic-v2", "structured-value-v1"] as const)(
    "keeps %s comparison text private to its own question and permutes actual presentation",
    (profile) => {
      const input = request(profile);
      input.against = [
        { id: "z", text: "PRIVATE_Z has no values." },
        { id: "a", text: "PRIVATE_A has no values." },
      ];
      const canonical = compileCheck(input, "m");
      const reversed = compileCheck(input, "m", { presentationOrder: ["z", "a"] });
      expect(JSON.stringify(canonical.payload.questions.q_000)).toContain("PRIVATE_A");
      expect(JSON.stringify(canonical.payload.questions.q_000)).not.toContain("PRIVATE_Z");
      expect(Object.keys(reversed.payload.questions)).toEqual(["q_001", "q_000"]);
      expect(reversed.payload.questions.q_001).toEqual(canonical.payload.questions.q_001);
      expect(
        compileCheck({ ...input, against: [...input.against].reverse() }, "m").payload,
      ).toEqual(canonical.payload);
    },
  );
  it("correlates the three response profiles with exclusive signal schemas in JSON Schema", () => {
    const json = z.toJSONSchema(checkResponseSchema);
    expect(json.anyOf).toHaveLength(3);
  });
  it.each(["semantic-v2", "structured-value-v1"] as const)(
    "calls once and marks %s as experimental",
    async (profile) => {
      const fake = provider(profile === "semantic-v2" ? "contradiction" : "p_0_0");
      const result = await evaluateCheck(request(profile), fake, options());
      expect(fake.classify).toHaveBeenCalledOnce();
      expect(result.engine).toMatchObject({ profile, experimental: true });
      expect(result.engine.engine_release).toContain("experimental");
      expect(
        checkResponseSchema.safeParse({
          ...result,
          engine: { ...result.engine, profile: "balanced-v1" },
        }).success,
      ).toBe(false);
      expect(
        checkResponseSchema.safeParse({
          ...result,
          comparisons: result.comparisons.map((item) => ({
            ...item,
            ...(profile === "structured-value-v1"
              ? {
                  raw_scores: {
                    contradiction: 1,
                    consistent: 0,
                    different_scope: 0,
                    insufficient_context: 0,
                  },
                }
              : { structured_signals: {} }),
          })),
        }).success,
      ).toBe(false);
    },
  );
});

describe("structured selection and conservative composition", () => {
  it("uses code to confirm a selected disjoint quantity and returns exact UTF16 source spans without invented scores", async () => {
    const input = request("structured-value-v1", "😀 Mass is 10 kg.", "😀 Mass is 20 kg.");
    const result = await evaluateCheck(input, provider("p_0_0"), options());
    const comparison = result.comparisons[0]!;
    expect(comparison.verdict).toBe("contradiction");
    expect(comparison.raw_scores).toBeUndefined();
    expect(comparison.structured_signals).toMatchObject({
      decision_basis: "deterministic_numeric",
      numeric_relation: "incompatible",
    });
    const selected = comparison.structured_signals!.selected_pair!;
    expect(input.claim.text.slice(selected.claim.span.start, selected.claim.span.end)).toBe(
      selected.claim.span.text,
    );
    expect(
      input.against[0]!.text.slice(selected.against.span.start, selected.against.span.end),
    ).toBe(selected.against.span.text);
    expect(selected.claim.span.start).toBe(11);
  });
  it.each([
    ["between 10 and 20 Fahrenheit", "between -10 and -5 Celsius"],
    ["approximately ≥10 kg", "Mass is 5 kg."],
    ["about at least $10", "Price is $5."],
    ["roughly between 5 and 10 kg", "Mass is 20 kg."],
    ["between 2026-11-01 and 2026-12-01", "Effective 2026-11-15"],
    ["10 kg per day", "20 kg per day"],
    ["The board is 5' long.", 'The board is 60" long.'],
    ["Rate is 5％", "Rate is 50‰"],
    ["Rate is at least 5 ％", "Rate is at least 500 ‱"],
    ["Rate is between 5 and 10％", "Rate is between 50 and 100‰"],
    ["Rate is 5–10 ‱", "Rate is 50–100 ‰"],
  ])(
    "keeps unsupported values uncertain despite confident semantic contradiction: %s",
    async (claim, against) => {
      const input = request("structured-value-v1", claim, against);
      const compiled = compileCheck(input, "jev-1.14.0");
      expect(
        Object.keys(compiled.payload.questions.q_000!.criteria).some((key) => key.startsWith("p_")),
      ).toBe(false);
      const result = await evaluateCheck(input, provider("contradiction"), options());
      expect(result.comparisons[0]!.verdict).toBe("uncertain");
      expect(result.comparisons[0]!.structured_signals).toMatchObject({
        selected_pair: null,
        numeric_relation: null,
        numeric_reason: "incomplete_candidate_coverage",
        decision_basis: "uncertain",
      });
    },
  );
  it("keeps count-property identity with semantic selection rather than arithmetic", async () => {
    const same = await evaluateCheck(
      request(
        "structured-value-v1",
        "Study includes exactly 180 participants.",
        "Study includes exactly 230 participants.",
      ),
      provider("p_0_0"),
      options(),
    );
    expect(same.comparisons[0]!.verdict).toBe("contradiction");
    const differentInput = request(
      "structured-value-v1",
      "Study includes exactly 180 participants.",
      "Study stores exactly 230 boxes.",
    );
    const compiled = compileCheck(differentInput, "jev-1.14.0");
    expect(JSON.stringify(compiled.payload)).toContain("participants");
    expect(JSON.stringify(compiled.payload)).toContain("boxes");
    const different = await evaluateCheck(differentInput, provider("unknown"), options());
    expect(different.comparisons[0]!.verdict).toBe("uncertain");
    expect(different.comparisons[0]!.structured_signals!.selected_pair).toBeNull();
  });
  it("does not certify a whole-pair negative from overlapping numeric bounds", async () => {
    const result = await evaluateCheck(
      request("structured-value-v1", "Mass is over 10 kg.", "Mass is over 20 kg."),
      provider("p_0_0"),
      options(),
    );
    expect(result.comparisons[0]!.verdict).toBe("uncertain");
    expect(result.comparisons[0]!.structured_signals).toMatchObject({
      numeric_relation: "compatible",
      decision_basis: "uncertain",
    });
  });
  it("exposes winning candidate diagnostics below the verdict threshold for offline calibration", async () => {
    const fake: DecisionProvider = {
      id: "fixture",
      model: "fixture",
      async classify(payload) {
        return {
          answers: Object.fromEntries(
            Object.entries(payload.questions).map(([id, question]) => [
              id,
              {
                type: "choice",
                probabilities: Object.fromEntries(
                  Object.keys(question.criteria).map((key) => [
                    key,
                    key === "p_0_0" ? 0.65 : key === "unknown" ? 0.35 : 0,
                  ]),
                ),
              },
            ]),
          ),
        };
      },
    };
    const result = await evaluateCheck(request("structured-value-v1"), fake, options());
    expect(result.comparisons[0]!.verdict).toBe("uncertain");
    expect(result.comparisons[0]!.structured_signals).toMatchObject({
      selected_choice: "p_0_0",
      pair_probability: 0.65,
      numeric_relation: "incompatible",
      decision_basis: "uncertain",
      selected_pair: { claim: { span: { text: "10 kg" } }, against: { span: { text: "20 kg" } } },
    });
  });
  it("does not compare unmatched dimensions as incompatible assertions", async () => {
    const result = await evaluateCheck(
      request("structured-value-v1", "Value is 10 kg.", "Value is 20 seconds."),
      provider("p_0_0"),
      options(),
    );
    expect(result.comparisons[0]!.verdict).toBe("uncertain");
    expect(result.comparisons[0]!.structured_signals!.numeric_relation).toBe("unknown");
  });
  it.each(["unknown", "insufficient_context"])(
    "preserves ambiguous identity/status/scope through %s",
    async (label) => {
      const result = await evaluateCheck(
        request(
          "structured-value-v1",
          "Its threshold is 10 kg.",
          "Their proposed threshold was 20 kg.",
        ),
        provider(label),
        options(),
      );
      expect(result.comparisons[0]!.verdict).toBe("uncertain");
      expect(result.comparisons[0]!.structured_signals!.selected_pair).toBeNull();
    },
  );
  it.each(["consistent", "contradiction", "different_scope"])(
    "forces unsupported extraction to uncertainty despite semantic %s",
    async (label) => {
      const result = await evaluateCheck(
        request("structured-value-v1", "Mass is about 10 kg.", "Mass is 20 kg."),
        provider(label),
        options(),
      );
      expect(result.comparisons[0]!.verdict).toBe("uncertain");
      expect(
        result.comparisons[0]!.structured_signals!.candidate_coverage.claim.unsupported_spans,
      ).toBeGreaterThan(0);
    },
  );
  it("offers unknown for missing-side quantities and excessive candidate sets", async () => {
    for (const input of [
      request("structured-value-v1", "Mass is 10 kg.", "Mass is unreported."),
      request("structured-value-v1", "A 10 kg B 20 kg C 30 kg D 40 kg E 50 kg.", "Mass is 60 kg."),
    ]) {
      const compiled = compileCheck(input, "m");
      expect(Object.keys(compiled.payload.questions.q_000!.criteria)).not.toContain("p_0_0");
      expect(
        (await evaluateCheck(input, provider("consistent"), options())).comparisons[0]!.verdict,
      ).toBe("uncertain");
    }
  });
  it("retains whole-pair semantic decisions for ordinary nonnumeric pairs", async () => {
    expect(
      (
        await evaluateCheck(
          request("structured-value-v1", "SSO is included.", "SSO is excluded."),
          provider("contradiction"),
          options(),
        )
      ).comparisons[0]!.verdict,
    ).toBe("contradiction");
  });
  it.each(["missing", "extra", "label", "type", "selected", "sum"])(
    "rejects malformed dynamic choice %s atomically",
    (kind) => {
      const compiled = compileCheck(request("structured-value-v1"), "m");
      const probabilities = Object.fromEntries(
        Object.keys(compiled.payload.questions.q_000!.criteria).map((id) => [
          id,
          id === "p_0_0" ? 1 : 0,
        ]),
      );
      const answer = { type: "choice", choice: "p_0_0", probabilities };
      const raw: { answers: Record<string, unknown> } = { answers: { q_000: answer } };
      if (kind === "missing") delete raw.answers.q_000;
      if (kind === "extra") raw.answers.forged = answer;
      if (kind === "label") probabilities.forged = 0;
      if (kind === "type") answer.type = "noul";
      if (kind === "selected") answer.choice = "consistent";
      if (kind === "sum") probabilities.p_0_0 = 0.4;
      expect(() => validatePayloadResponse(raw, compiled.payload)).toThrow(
        expect.objectContaining({ status: 502 }),
      );
    },
  );
});

describe("all frozen baseline payloads", () => {
  it("matches every saved399 Jev development request hash", async () => {
    let checked = 0;
    for (const dataset of ["vitaminc-combined-dev", "scifact-dev"]) {
      const report = JSON.parse(
        await readFile(`eval/results/jev-dev-2026-11-03/${dataset}.report.json`, "utf8"),
      ) as {
        rows: {
          pair: Pair;
          prediction: { status: string; prompt_hash?: string; model?: string };
        }[];
      };
      for (const row of report.rows) {
        if (!row.prediction.prompt_hash) continue;
        const payload = compileCheck(
          makeRequest(row.pair),
          row.prediction.model ?? "jev-1.14.0",
        ).payload;
        expect(
          createHash("sha256").update(JSON.stringify(payload)).digest("hex"),
          row.pair.id,
        ).toBe(row.prediction.prompt_hash);
        checked++;
      }
    }
    expect(checked).toBe(399);
  });
});
