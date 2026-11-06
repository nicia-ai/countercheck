import { describe, expect, it, vi } from "vitest";
import { checkRequestSchema } from "../src/contracts/index.js";
import { evaluateCheck } from "../src/kernel/index.js";
import { createJevProvider } from "../src/providers/jev.js";
import { createClefProvider, createClefRestProvider } from "../src/providers/clef.js";
import { createDeciderProvider } from "../src/providers/decider.js";
import type { DecisionPayload } from "../src/providers/types.js";

describe("profile transport validation", () => {
  it.each(["jev", "clef", "clef-rest", "decider"] as const)(
    "passes dynamic structured choice through the explicit %s adapter",
    async (route) => {
      const response = (payload: DecisionPayload) => ({
        model: payload.model,
        answers: Object.fromEntries(
          Object.entries(payload.questions).map(([id, question]) => [
            id,
            {
              type: "choice",
              choice: "p_0_0",
              probabilities: Object.fromEntries(
                Object.keys(question.criteria).map((key) => [key, key === "p_0_0" ? 1 : 0]),
              ),
            },
          ]),
        ),
      });
      const send = vi.fn<typeof fetch>(async (_url, init) => {
        const raw = response(JSON.parse(init!.body as string) as DecisionPayload);
        return Response.json(
          route === "clef-rest" ? { success: true, errors: [], messages: [], result: raw } : raw,
        );
      });
      const run = vi.fn(async (_model: string, input: unknown) =>
        response(input as DecisionPayload),
      );
      const selected =
        route === "jev"
          ? createJevProvider({ apiKey: "fixture", fetch: send })
          : route === "clef"
            ? createClefProvider({ run })
            : route === "clef-rest"
              ? createClefRestProvider({
                  accountId: "a".repeat(32),
                  apiToken: "fixture",
                  fetch: send,
                })
              : createDeciderProvider({ apiKey: "fixture", fetch: send });
      const request = checkRequestSchema.parse({
        profile: "structured-value-v1",
        claim: { id: "c", text: "Mass is 10 kg." },
        against: [{ id: "a", text: "Mass is 20 kg." }],
      });
      const result = await evaluateCheck(request, selected, {
        requestId: "req",
        signal: new AbortController().signal,
      });
      expect(result.comparisons[0]!.verdict).toBe("contradiction");
      expect(result.comparisons[0]!.raw_scores).toBeUndefined();
      expect(result.comparisons[0]!.structured_signals!.decision_basis).toBe(
        "deterministic_numeric",
      );
      expect(route === "clef" ? run : send).toHaveBeenCalledOnce();
    },
  );
});
