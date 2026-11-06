import { compileCandidate, type CandidateId } from "./profiles.js";
import type { BackendConfig } from "./backends.js";
import { runBundle, compileBundle, parseBundleResponse } from "./bundle.js";
import { headPrediction, parseResponse, type Observation } from "./runner.js";
import { predictionSchema, sha256, type Pair } from "../types.js";
import { withDeadline } from "../../src/http/deadline.js";
import { utf8Bytes } from "../../src/contracts/index.js";
import { ServiceError } from "../../src/contracts/errors.js";

export async function runBundledPair(
  profiles: readonly CandidateId[],
  pair: Pair,
  pass: number,
  options: { sequence: number; backend: BackendConfig; fake?: boolean; fetch?: typeof fetch },
): Promise<Observation[]> {
  const start = performance.now();
  let calls: 0 | 1 = 0;
  let wireHash: string | null = null,
    wireBytes: number | null = null;
  const backend = options.backend;
  const common = {
    pair_id: pair.id,
    pass,
    request_id: `iteration-${options.sequence}`,
    model: backend.model,
    provider: options.fake ? "fake" : backend.id,
    engine_release: "decision-iteration-bundle-v1",
    threshold_version: "iteration-fixed-0.8-v1",
  };
  try {
    const result = await withDeadline(
      async (signal) => {
        if (options.fake) {
          const compiled = compileBundle(
            profiles,
            { claim: pair.claim, evidence: pair.evidence },
            backend.model,
          );
          const raw = {
            model: backend.model,
            answers: Object.fromEntries(
              Object.entries(compiled.payload.questions).map(([id, q]) => [
                id,
                q.type === "noul"
                  ? { type: "noul", noul: 0.5 }
                  : {
                      type: "choice",
                      probabilities: Object.fromEntries(
                        Object.keys(q.criteria).map((k) => [k, 1 / Object.keys(q.criteria).length]),
                      ),
                    },
              ]),
            ),
          };
          return { ...parseBundleResponse(raw, compiled), compiled_bytes: compiled.compiled_bytes };
        }
        return runBundle(
          profiles,
          { claim: pair.claim, evidence: pair.evidence },
          {
            apiKey: backend.apiKey,
            backend,
            signal,
            fetch: async (...args) => {
              const body = args[1]?.body;
              if (typeof body === "string") {
                wireHash = sha256(body);
                wireBytes = utf8Bytes(body);
              }
              calls = 1;
              return (options.fetch ?? fetch)(...args);
            },
          },
        );
      },
      3000,
      new ServiceError(504, "deadline_exceeded", "Iteration deadline exceeded."),
    );
    return result.heads.map((head, index) => {
      const compiled = compileCandidate(head.profile, {
        claim: pair.claim,
        evidence: pair.evidence,
      });
      compiled.payload.model = backend.model;
      const response = parseResponse(
        {
          answers: head.raw_answers,
          ...(result.reported_model !== null ? { model: result.reported_model } : {}),
          ...(result.model_revision !== null ? { model_revision: result.model_revision } : {}),
          usage: Object.fromEntries(
            Object.entries(result.request_usage).filter(([, v]) => v !== null),
          ),
        },
        compiled,
      );
      const prediction = headPrediction(
        compiled,
        response,
        head.features,
        { ...common, prompt_version: head.profile },
        result.prompt_sha256,
        performance.now() - start,
        !!options.fake,
      );
      return {
        profile: head.profile,
        pair_id: pair.id,
        pass,
        prompt_sha256: result.prompt_sha256,
        compiled_bytes: result.compiled_bytes,
        provider_calls: index === 0 ? calls : 0,
        features: head.features,
        raw_answers: head.raw_answers,
        prediction,
      };
    });
  } catch (error) {
    return profiles.map((profile, index) => ({
      profile,
      pair_id: pair.id,
      pass,
      prompt_sha256: wireHash,
      compiled_bytes: wireBytes,
      provider_calls: index === 0 ? calls : 0,
      features: null,
      raw_answers: null,
      prediction: predictionSchema.parse({
        ...common,
        prompt_version: profile,
        status: error instanceof ServiceError && error.status === 422 ? "excluded" : "error",
        error_code: error instanceof ServiceError ? error.code : "iteration_failure",
        ...(wireHash ? { prompt_hash: wireHash } : {}),
        ...(calls ? { request_usage: { input_tokens: null, output_tokens: null } } : {}),
        latency_ms: performance.now() - start,
      }),
    }));
  }
}
