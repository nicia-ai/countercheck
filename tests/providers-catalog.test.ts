import { describe, expect, it, vi } from "vitest";
import { createClefProvider, type ClefModel } from "../src/providers/clef.js";
import {
  createOpenRouterProvider,
  type OpenRouterDecisionModel,
} from "../src/providers/decider.js";
import type { DecisionPayload, DecisionProvider } from "../src/providers/types.js";

const signal = () => new AbortController().signal;
const payload = (): DecisionPayload => ({
  model: "jev-1.14.0",
  state: { claim: "Standard costs $49.", evidence: "Standard costs $79." },
  questions: {
    pair: {
      type: "choice",
      instructions: "Do they conflict?",
      criteria: { yes: "Conflict", no: "Compatible" },
    },
  },
});
const output = (model?: string) => ({
  ...(model !== undefined && { model }),
  answers: { pair: { type: "choice", choice: "yes", probabilities: { yes: 0.9, no: 0.1 } } },
  usage: { input_tokens: 32, output_tokens: 2 },
});
const sendOutput = (model?: string) =>
  vi.fn<typeof fetch>(async () => Response.json(output(model)));
const clefModels: ClefModel[] = ["clef", "clef-flash", "clef-omni"];
const routerModels: OpenRouterDecisionModel[] = [
  "microsoft/microsoft-decision-1",
  "perplexity/pplx-decider-v1.2",
  "perplexity/pplx-decider-flash-v1.2",
];
const routerSnapshots: [OpenRouterDecisionModel, string][] = [
  ["microsoft/microsoft-decision-1", "microsoft/microsoft-decision-1-20261009"],
  ["perplexity/pplx-decider-v1.2", "perplexity/pplx-decider-v1.2-20261016"],
  ["perplexity/pplx-decider-flash-v1.2", "perplexity/pplx-decider-flash-v1.2-20261016"],
];

describe("catalog decision providers", () => {
  it.each(clefModels)("selects and validates the exact %s binding", async (model) => {
    const run = vi.fn(async () => output(model));
    const provider = createClefProvider({ run }, model);
    await expect(provider.classify(payload(), signal())).resolves.toEqual(output(model));
    expect(run).toHaveBeenCalledExactlyOnceWith(`@cf/cloudflare/${model}`, { ...payload(), model });
    run.mockResolvedValueOnce(output("some-other-model"));
    await expect(provider.classify(payload(), signal())).rejects.toMatchObject({
      code: "provider_model_mismatch",
    });
  });

  it.each(routerModels)(
    "pins %s with fallback disabled and strict reported identity",
    async (model) => {
      const send = sendOutput(model);
      const provider = createOpenRouterProvider({ apiKey: "synthetic-token", model, fetch: send });
      await expect(provider.classify(payload(), signal())).resolves.toEqual(output(model));
      expect(send).toHaveBeenCalledTimes(1);
      const [url, init] = send.mock.calls[0]!;
      expect(url).toBe("https://openrouter.ai/api/alpha/decisions");
      expect(init?.redirect).toBe("manual");
      expect(JSON.parse(init!.body as string)).toEqual({
        ...payload(),
        model,
        provider: {
          ...(model.startsWith("perplexity/") && { only: ["Perplexity"] }),
          allow_fallbacks: false,
        },
      });
      send.mockResolvedValueOnce(Response.json(output("wrong-model-private-text")));
      await expect(provider.classify(payload(), signal())).rejects.toMatchObject({
        status: 502,
        code: "provider_model_mismatch",
        message: "The inference provider reported an unexpected model.",
      });
    },
  );

  it.each(routerSnapshots)(
    "preserves the reviewed snapshot and strips router billing metadata for %s",
    async (model, reported) => {
      const expected = { ...output(reported), model_revision: "opaque-provider-revision" };
      const response = {
        ...expected,
        id: "synthetic-router-id",
        provider: "synthetic-provider",
        usage: {
          ...expected.usage,
          cost: 0.0001,
          is_byok: false,
          cost_details: { upstream_inference_cost: null },
        },
      };
      const send = vi.fn<typeof fetch>(async () => Response.json(response));
      const provider = createOpenRouterProvider({ apiKey: "fake", model, fetch: send });
      expect(provider.model).toBe(model);
      await expect(provider.classify(payload(), signal())).resolves.toEqual(expected);
      expect(JSON.parse(send.mock.calls[0]![1]!.body as string).model).toBe(model);
      send.mockResolvedValueOnce(Response.json(output()));
      await expect(provider.classify(payload(), signal())).resolves.toEqual(output());
      for (const usage of [
        { ...response.usage, input_tokens: "32" },
        { ...response.usage, output_tokens: -1 },
      ]) {
        send.mockResolvedValueOnce(Response.json({ ...response, usage }));
        await expect(provider.classify(payload(), signal())).rejects.toMatchObject({
          code: "provider_invalid_response",
        });
      }
    },
  );

  it.each(routerSnapshots)(
    "rejects unreviewed versions and other models for %s",
    async (model, reported) => {
      const send = sendOutput();
      const provider = createOpenRouterProvider({ apiKey: "fake", model, fetch: send });
      const wrongIdentities = [
        reported.replace(/\d{8}$/, "20261105"),
        `${reported}-revision-2`,
        `${model}-latest`,
        ...routerSnapshots
          .filter(([other]) => other !== model)
          .flatMap(([other, snapshot]) => [other, snapshot]),
      ];
      for (const wrongModel of wrongIdentities) {
        send.mockResolvedValueOnce(
          Response.json({ ...output(wrongModel), model_revision: reported }),
        );
        await expect(provider.classify(payload(), signal())).rejects.toMatchObject({
          status: 502,
          code: "provider_model_mismatch",
          message: "The inference provider reported an unexpected model.",
        });
      }
    },
  );

  const factories: [string, (send: typeof fetch) => DecisionProvider, string, boolean][] = [
    ...clefModels.map(
      (model): [string, (send: typeof fetch) => DecisionProvider, string, boolean] => [
        model,
        (send) =>
          createClefProvider(
            { run: async () => send("https://unused.example.com").then((r) => r.json()) },
            model,
          ),
        model,
        false,
      ],
    ),
    ...routerModels.map(
      (model): [string, (send: typeof fetch) => DecisionProvider, string, boolean] => [
        model,
        (send) => createOpenRouterProvider({ apiKey: "fake", model, fetch: send }),
        model,
        true,
      ],
    ),
  ];
  it.each(factories)(
    "preflights exact actual wire bytes for %s",
    async (_name, factory, wireModel, router) => {
      const send = sendOutput(wireModel);
      const provider = factory(send);
      const input = payload();
      input.state.pad = "";
      const body = () => ({
        ...input,
        model: wireModel,
        ...(router && {
          provider: {
            ...(wireModel.startsWith("perplexity/") && { only: ["Perplexity"] }),
            allow_fallbacks: false,
          },
        }),
      });
      input.state.pad = "x".repeat(
        16_384 - new TextEncoder().encode(JSON.stringify(body())).length,
      );
      expect(() => provider.validateInput!(input)).not.toThrow();
      input.state.pad += "é";
      expect(() => provider.validateInput!(input)).toThrow(
        expect.objectContaining({ status: 422, code: "compiled_input_too_large" }),
      );
      await expect(provider.classify(input, signal())).rejects.toMatchObject({ status: 422 });
      expect(send).not.toHaveBeenCalled();
    },
  );
});
