import { describe, expect, it } from "vitest";
import {
  CANDIDATE_IDS,
  COMPACT_CANDIDATE_IDS,
  compileCandidate,
  compileCandidateBatch,
  type CandidateId,
} from "../eval/iteration/profiles.js";
import { compileProfile } from "../eval/prompt-ablation/profiles.js";
import { compareValueCandidates } from "../src/kernel/values.js";

const pair = { claim: "Mass is exactly 10 kg.", evidence: "Mass is exactly 20 kg." };

describe("isolated iteration formulations", () => {
  it("preserves the exact historical rich-examples control payload", () => {
    const compiled = compileCandidate("rich-control", pair);
    expect(JSON.stringify(compiled.payload)).toBe(
      JSON.stringify(compileProfile("rich-criteria-examples", pair).payload),
    );
    expect(compiled.signal_questions).toEqual({ relation: "q_relation" });
  });

  it.each(COMPACT_CANDIDATE_IDS)("fits20 short comparisons for %s in16KiB", (id) => {
    const compiled = compileCandidateBatch(id, {
      claim: pair.claim,
      evidence: Array<string>(20).fill(pair.evidence),
    });
    expect(compiled.compiled_bytes).toBeLessThanOrEqual(16_384);
    expect(compiled.comparisons).toHaveLength(20);
    for (const [index, context] of compiled.comparisons.entries()) {
      for (const questionId of Object.values(context.signal_questions)) {
        const instructions = JSON.stringify(compiled.payload.questions[questionId]!.instructions);
        expect(instructions).toContain("`claim.text`");
        expect(instructions).toContain(`\`comparisons[${index}].text\``);
      }
    }
    expect(compiled.compiled_bytes).toBe(
      new TextEncoder().encode(JSON.stringify(compiled.payload)).length,
    );
  });

  it("keeps the historical full control's larger budget visible", () => {
    expect(
      compileCandidateBatch("rich-control", {
        claim: pair.claim,
        evidence: Array<string>(20).fill(pair.evidence),
      }).compiled_bytes,
    ).toBeGreaterThan(16_384);
  });

  it("puts contrastive structured criteria directly in each local question", () => {
    const compiled = compileCandidate("local-mini", pair);
    const question = compiled.payload.questions[compiled.signal_questions.relation!]!;
    expect(question.criteria).toMatchObject({
      contradiction: { is: expect.any(String), contrast: expect.any(String) },
      consistent: { is: expect.stringContaining("omission"), contrast: expect.any(String) },
      different_scope: { is: expect.any(String), contrast: expect.any(String) },
      insufficient_context: { is: expect.any(String), contrast: expect.any(String) },
    });
    expect(compiled.payload.state).not.toHaveProperty("examples");
    expect(compiled.payload.state).not.toHaveProperty("rubric");
  });

  it("distinguishes changed property values from disjoint applicability in the literal-contract variant", () => {
    const literal = compileCandidate("literal-contract", pair).payload.questions.q_0_relation!;
    expect(literal.criteria).toMatchObject({
      contradiction: { values_not_scope: expect.stringContaining("born 1981/1990") },
      different_scope: { scope_not_values: expect.stringContaining("fee in 2024/2025") },
    });
    expect(JSON.stringify(literal.criteria)).toContain("current team Red/Blue");
    expect(JSON.stringify(literal.criteria)).toContain("summit sole location Paris/Rome");
    expect(JSON.stringify(literal.criteria)).toContain("Paris office/Rome office");
    expect(JSON.stringify(compileCandidate("local-mini", pair).payload)).not.toContain("Nora");
  });

  it("preserves native three-way NLI meanings instead of fabricating four-way scores", () => {
    const compiled = compileCandidate("nli-three-way", pair);
    const question = compiled.payload.questions[compiled.signal_questions.relation!]!;
    expect(question.type).toBe("choice");
    expect(Object.keys(question.criteria!)).toEqual(["contradiction", "entailment", "neutral"]);
  });

  it("asks conflict and applicability independently with native Noul outputs", () => {
    const compiled = compileCandidate("noul-conflict", pair);
    expect(Object.keys(compiled.payload.questions)).toHaveLength(2);
    expect(compiled.signal_questions.determinable).toBeUndefined();
    for (const question of Object.values(compiled.payload.questions)) {
      expect(question.type).toBe("noul");
      expect(Object.keys(question.criteria!)).toEqual(["true", "false"]);
    }
    expect(
      JSON.stringify(compiled.payload.questions[compiled.signal_questions.applicability!]!),
    ).toContain("assertion status");
  });

  it("keeps semantic relation, quantitative decisiveness and value selection separate", () => {
    const compiled = compileCandidate("semantic-numeric", pair);
    const {
      relation,
      quantitative_decisive: gate,
      numeric_selection: selection,
    } = compiled.signal_questions;
    expect(new Set([relation, gate, selection]).size).toBe(3);
    expect(Object.keys(compiled.payload.questions[relation!]!.criteria!)).toEqual([
      "contradiction",
      "consistent",
      "different_scope",
      "insufficient_context",
    ]);
    expect(compiled.payload.questions[gate!]!.type).toBe("noul");
    expect(Object.keys(compiled.payload.questions[selection!]!.criteria!)).toEqual([
      "unknown",
      "p_0_0",
    ]);
    const [left, right] = compiled.numeric_context!.pairs.get("p_0_0")!;
    expect(left.span.text).toBe("10 kg");
    expect(right.span.text).toBe("20 kg");
    expect(compareValueCandidates(left, right).relation).toBe("incompatible");
    expect(compiled.payload.state.numeric_rule).toEqual(
      expect.stringContaining("complete assertions"),
    );
    expect(compiled.payload.state.numeric_rule).toEqual(
      expect.stringContaining("Code alone checks"),
    );
    expect(compiled.payload.state.quantitative_rule).toEqual(
      expect.stringContaining("False if nonnumeric assertions settle"),
    );
    expect(JSON.stringify(compiled.payload.questions[gate!]!.instructions)).toContain(
      "Must compare quantities/dates",
    );
  });

  it.each([
    { claim: "Approximately 10 kg.", evidence: "Mass is 20 kg." },
    { claim: "Five kg.", evidence: "Mass is 20 kg." },
    { claim: "Mass is 10 kg.", evidence: "between 10 and 20 Fahrenheit" },
    { claim: "Rate is 5％.", evidence: "Rate is 50‰." },
    { claim: "Mass is 1 kg; 2 kg; 3 kg.", evidence: "Mass is 20 kg." },
    { claim: "Entry is permitted.", evidence: "Entry is forbidden." },
  ])("disables only optional numeric proof for incomplete/absent candidates: $claim", (input) => {
    const compiled = compileCandidate("semantic-numeric", input);
    expect(compiled.numeric_context!.available).toBe(false);
    expect(compiled.numeric_context!.pairs.size).toBe(0);
    expect(Object.keys(compiled.payload.questions)).toHaveLength(2);
    expect(compiled.signal_questions.relation).toBeDefined();
    expect(compiled.payload.questions[compiled.signal_questions.quantitative_decisive!]!.type).toBe(
      "noul",
    );
    expect(compiled.signal_questions.numeric_selection).toBeUndefined();
    expect(
      Object.keys(compiled.payload.questions[compiled.signal_questions.relation!]!.criteria!),
    ).toContain("consistent");
  });

  it("does not include benchmark labels or rationales in inference", () => {
    const labeled = {
      ...pair,
      gold: "GOLD_SECRET",
      rationale: "RATIONALE_SECRET",
      id: "BENCHMARK_ID",
    };
    for (const id of CANDIDATE_IDS) {
      const serialized = JSON.stringify(compileCandidate(id, labeled).payload);
      expect(serialized).not.toMatch(/GOLD_SECRET|RATIONALE_SECRET|BENCHMARK_ID/);
    }
  });

  it("cannot mutate later frozen criteria by changing an earlier compiled payload", () => {
    const first = compileCandidate("local-mini", pair);
    const question = first.payload.questions[first.signal_questions.relation!]!;
    if (question.type !== "choice") throw new Error("Expected Choice fixture.");
    question.criteria.consistent = "modified";
    const later = compileCandidate("local-mini", pair).payload.questions.q_0_relation!;
    if (later.type !== "choice") throw new Error("Expected Choice fixture.");
    expect(later.criteria.consistent).not.toBe("modified");
  });

  it("rejects unknown candidates and invalid batch sizes before transport", () => {
    expect(() => compileCandidate("unknown" as CandidateId, pair)).toThrow(
      "Unknown iteration candidate",
    );
    for (const size of [0, 21])
      expect(() =>
        compileCandidateBatch("local-mini", {
          claim: pair.claim,
          evidence: Array<string>(size).fill(pair.evidence),
        }),
      ).toThrow("one to twenty");
  });
});
