import {
  checkRequestSchema,
  checkResponseSchema,
  errorResponseSchema,
  type CheckRequest,
  type CheckResponse,
} from "../src/contracts/index.js";
import { ServiceError } from "../src/contracts/errors.js";
import { evaluateCheck, compileCheck, pairDecision, ENGINE } from "../src/kernel/index.js";
import { withDeadline } from "../src/http/deadline.js";
import type { DecisionProvider } from "../src/providers/types.js";
import { validateDecisionResponse } from "../src/providers/response.js";
import { readProviderJson } from "../src/providers/transport.js";
import {
  evaluationVerdict,
  predictionSchema,
  projectScores,
  sha256,
  type Pair,
  type Prediction,
} from "./types.js";

export type RunOptions = {
  pass: number;
  profile?: CheckRequest["profile"];
  timeoutMs: number;
  presentation: "original" | "reversed" | "shuffled";
  provider?: DecisionProvider | undefined;
  serviceUrl?: string | undefined;
  serviceKey?: string | undefined;
  fake?: boolean | undefined;
  direct?: boolean | undefined;
};
export function makeRequest(
  pair: Pair,
  comparisons: Pair[] = [pair],
  profile: CheckRequest["profile"] = "balanced-v1",
): CheckRequest {
  if (comparisons.some((p) => p.claim !== pair.claim))
    throw new Error("Bundled comparisons must share an identical claim");
  return checkRequestSchema.parse({
    claim: { id: "claim", text: pair.claim },
    against: comparisons.map((p) => ({ id: `e${sha256(p.id).slice(0, 24)}`, text: p.evidence })),
    profile,
  });
}
export function fromResponse(
  response: CheckResponse,
  pairs: Pair[],
  request: CheckRequest,
  pass: number,
  elapsed: number,
  presentation: string,
): Prediction[] {
  const parsed = checkResponseSchema.parse(response);
  if (
    parsed.engine.profile !== request.profile ||
    parsed.claim_id !== request.claim.id ||
    parsed.comparisons.length !== pairs.length ||
    parsed.coverage.requested !== pairs.length ||
    parsed.coverage.completed !== pairs.length
  )
    throw new Error("Invalid response coverage");
  const expected = new Map(request.against.map((p, i) => [p.id, pairs[i]]));
  const seen = new Set<string>();
  return parsed.comparisons.map((result) => {
    const pair = expected.get(result.against_id);
    if (
      !pair ||
      seen.has(result.against_id) ||
      result.evidence.against_id !== result.against_id ||
      result.evidence.claim_id !== request.claim.id
    )
      throw new Error("Invalid response attribution");
    seen.add(result.against_id);
    return predictionSchema.parse({
      pair_id: pair.id,
      pass,
      status: "ok",
      verdict: evaluationVerdict(result.verdict),
      probabilities: result.raw_scores ? projectScores(result.raw_scores) : undefined,
      raw_scores: result.raw_scores,
      structured_signals: result.structured_signals,
      latency_ms: elapsed,
      model: parsed.engine.requested_model,
      engine_release: parsed.engine.engine_release,
      provider: parsed.engine.provider,
      reported_model: parsed.engine.reported_model,
      model_revision: parsed.engine.model_revision,
      prompt_version: parsed.engine.prompt_version,
      threshold_version: parsed.engine.threshold_version,
      input_tokens: pairs.length === 1 ? (parsed.usage.input_tokens ?? undefined) : undefined,
      presentation,
      request_id: parsed.request_id,
      request_usage: { input_tokens: parsed.usage.input_tokens, output_tokens: null },
    });
  });
}
export function presentationOrder(
  request: CheckRequest,
  mode: RunOptions["presentation"],
  pass: number,
): string[] {
  const ids = request.against.map((p) => p.id).sort();
  if (mode === "reversed") ids.reverse();
  if (mode === "shuffled")
    ids.sort((a, b) => sha256(`${pass}:${a}`).localeCompare(sha256(`${pass}:${b}`)));
  return ids;
}
const fakeProvider: DecisionProvider = {
  id: "fake",
  model: "fake-no-model",
  async classify(payload) {
    return {
      answers: Object.fromEntries(
        Object.entries(payload.questions).map(([id, question]) => [
          id,
          {
            type: "choice",
            probabilities: Object.fromEntries(
              Object.keys(question.criteria).map((label) => [
                label,
                1 / Object.keys(question.criteria).length,
              ]),
            ),
          },
        ]),
      ),
    };
  },
};

export async function runPairs(pairs: Pair[], options: RunOptions): Promise<Prediction[]> {
  const start = performance.now();
  let request: CheckRequest;
  try {
    request = makeRequest(pairs[0]!, pairs, options.profile);
  } catch {
    return pairs.map((p) => ({
      pair_id: p.id,
      pass: options.pass,
      status: "excluded",
      error_code: "service_input_envelope",
      latency_ms: 0,
      presentation: options.presentation,
    }));
  }
  try {
    return await withDeadline(
      async (signal): Promise<Prediction[]> => {
        const provider = options.fake ? fakeProvider : options.provider;
        let response: CheckResponse;
        let promptHash: string | undefined;
        if (provider) {
          const order = presentationOrder(request, options.presentation, options.pass);
          const compiled = compileCheck(request, provider.model, { presentationOrder: order });
          promptHash = sha256(JSON.stringify(compiled.payload));
          if (options.direct && !options.fake) {
            if (pairs.length !== 1) throw new Error("Direct comparison requires one pair");
            const raw = await provider.classify(compiled.payload, signal);
            if (signal.aborted) throw signal.reason;
            const validated = validateDecisionResponse(raw, compiled.questionIds);
            const scores = validated.answers[compiled.questionIds[0]!]!.probabilities;
            return [
              predictionSchema.parse({
                pair_id: pairs[0]!.id,
                pass: options.pass,
                status: "ok",
                verdict: evaluationVerdict(pairDecision(scores).verdict),
                probabilities: projectScores(scores),
                raw_scores: scores,
                latency_ms: performance.now() - start,
                model: provider.model,
                engine_release: "direct-same-compiler-v1",
                provider: provider.id,
                reported_model: validated.model ?? null,
                model_revision: validated.model_revision ?? null,
                prompt_version: ENGINE.prompt_version,
                threshold_version: ENGINE.threshold_version,
                prompt_hash: promptHash,
                presentation: options.presentation,
                input_tokens: validated.usage?.input_tokens,
                output_tokens: validated.usage?.output_tokens,
              }),
            ];
          }
          response = await evaluateCheck(request, provider, {
            requestId: `eval-${options.pass}-${sha256(pairs[0]!.id).slice(0, 16)}`,
            signal,
            presentationOrder: order,
          });
        } else {
          if (!options.serviceUrl || !options.serviceKey)
            throw new Error("Missing service configuration");
          // Public reversal tests canonicalization; provider permutations are kernel-only.
          if (options.presentation === "reversed")
            request = { ...request, against: [...request.against].reverse() };
          const result = await fetch(new URL("/v1/check", options.serviceUrl), {
            method: "POST",
            redirect: "manual",
            headers: {
              authorization: `Bearer ${options.serviceKey}`,
              "content-type": "application/json",
            },
            body: JSON.stringify(request),
            signal,
          });
          if (result.status >= 300 && result.status < 400) {
            void result.body?.cancel().catch(() => {});
            throw new ServiceError(
              502,
              "service_redirect_rejected",
              "The service returned an unexpected redirect.",
            );
          }
          if (!result.ok) {
            let envelope: ReturnType<typeof errorResponseSchema.parse>;
            try {
              envelope = errorResponseSchema.parse(await readProviderJson(result, signal));
            } catch (error) {
              if (signal.aborted) throw signal.reason;
              throw new Error(`http_${result.status}`, { cause: error });
            }
            if (result.status === 422 && envelope.error.code === "compiled_input_too_large")
              throw new ServiceError(
                422,
                "compiled_input_too_large",
                "The compiled check exceeds the input limit.",
              );
            throw new Error(`http_${result.status}`);
          }
          response = checkResponseSchema.parse(await readProviderJson(result, signal));
        }
        if (signal.aborted) throw signal.reason;
        const pairBySnippet = new Map(pairs.map((p) => [`e${sha256(p.id).slice(0, 24)}`, p]));
        const responsePairs = request.against.map((a) => pairBySnippet.get(a.id)!);
        return fromResponse(
          response,
          responsePairs,
          request,
          options.pass,
          performance.now() - start,
          options.presentation,
        ).map((p) => ({ ...p, prompt_hash: promptHash, ...(options.fake && { cost_usd: 0 }) }));
      },
      options.timeoutMs,
      new ServiceError(504, "deadline_exceeded", "Evaluation deadline exceeded."),
    );
  } catch (error) {
    const excluded =
      error instanceof ServiceError &&
      error.status === 422 &&
      error.code === "compiled_input_too_large";
    const code = excluded
      ? "compiled_input_envelope"
      : error instanceof ServiceError
        ? error.code
        : error instanceof Error && /^http_\d{3}$/.test(error.message)
          ? error.message
          : "evaluation_or_provider_failure";
    return pairs.map((p) => ({
      pair_id: p.id,
      pass: options.pass,
      status: excluded ? "excluded" : "error",
      error_code: code,
      latency_ms: performance.now() - start,
      presentation: options.presentation,
    }));
  }
}
