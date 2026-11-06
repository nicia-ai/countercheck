import { parseCheckRequest, utf8Bytes } from "../../src/contracts/index.js";
import { ServiceError } from "../../src/contracts/errors.js";
import { LIMITS } from "../../src/contracts/limits.js";
import { JEV_MODEL } from "../../src/providers/jev.js";
import { sendBackend, createBackend, backendPayload, type BackendConfig } from "./backends.js";
import type { JsonValue } from "../../src/providers/types.js";
import { sha256 } from "../types.js";
import {
  CANDIDATE_IDS,
  compileCandidate,
  type CandidateId,
  type CandidatePayload,
  type CandidateQuestion,
  type CompiledCandidate,
} from "./profiles.js";
import { parseResponse, extractFeatures } from "./runner.js";

export const DEFAULT_BUNDLE_PROFILES = [
  "literal-contract",
  "nli-three-way",
  "noul-conflict",
  "semantic-numeric-v2",
  "evidence-refutation",
] as const satisfies readonly CandidateId[];
export type CompiledBundle = {
  profiles: CandidateId[];
  payload: CandidatePayload;
  compiled_bytes: number;
  prompt_sha256: string;
  heads: { profile: CandidateId; compiled: CompiledCandidate; id_map: Record<string, string> }[];
};
const RULE_KEYS = ["numeric_rule", "quantitative_rule"] as const;
function namespaceReferences(value: JsonValue, names: ReadonlyMap<string, string>): JsonValue {
  if (typeof value === "string") {
    let rewritten = value;
    for (const [original, scoped] of names)
      rewritten = rewritten.replaceAll(`\`${original}\``, `\`${scoped}\``);
    return rewritten;
  }
  if (Array.isArray(value)) return value.map((item) => namespaceReferences(item, names));
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, namespaceReferences(item, names)]),
    );
  return value;
}

export function compileBundle(
  profiles: readonly CandidateId[],
  pair: { claim: string; evidence: string },
  model: string = JEV_MODEL,
): CompiledBundle {
  if (
    !profiles.length ||
    new Set(profiles).size !== profiles.length ||
    profiles.some((p) => !CANDIDATE_IDS.includes(p))
  )
    throw new Error("Bundle requires unique known candidate profiles.");
  parseCheckRequest({
    claim: { id: "claim", text: pair.claim },
    against: [{ id: "comparison", text: pair.evidence }],
  });
  const payload: CandidatePayload = {
    model,
    state: { claim: { text: pair.claim }, comparisons: [{ text: pair.evidence }] },
    questions: {},
  };
  const orderedProfiles = [...profiles].sort();
  const heads: CompiledBundle["heads"] = orderedProfiles.map((profile, index) => {
    const compiled = compileCandidate(profile, pair);
    const prefix = `h${index}`,
      id_map: Record<string, string> = {};
    if (
      compiled.payload.model !== JEV_MODEL ||
      JSON.stringify(compiled.payload.state.claim) !== JSON.stringify(payload.state.claim) ||
      JSON.stringify(compiled.payload.state.comparisons) !==
        JSON.stringify(payload.state.comparisons)
    )
      throw new Error("Bundle head changed its shared pair or pinned model.");
    compiled.payload.model = model;
    const names = new Map<string, string>();
    for (const [key, value] of Object.entries(compiled.payload.state)) {
      if (key === "claim" || key === "comparisons") continue;
      if (!RULE_KEYS.some((rule) => rule === key))
        throw new Error("Unsupported bundle head state field.");
      const scoped = `${prefix}_${key}`;
      names.set(key, scoped);
      payload.state[scoped] = structuredClone(value);
    }
    for (const [id, question] of Object.entries(compiled.payload.questions)) {
      const scoped = `${prefix}_${id}`;
      id_map[id] = scoped;
      payload.questions[scoped] = namespaceReferences(
        question as unknown as JsonValue,
        names,
      ) as unknown as CandidateQuestion;
    }
    return { profile, compiled, id_map };
  });
  const body = JSON.stringify(payload),
    compiled_bytes = utf8Bytes(body);
  if (compiled_bytes > LIMITS.compiledBytes)
    throw new ServiceError(
      422,
      "compiled_input_too_large",
      "The compiled bundle exceeds the provider input byte limit.",
    );
  return { profiles: orderedProfiles, payload, compiled_bytes, prompt_sha256: sha256(body), heads };
}

/** Head distributions are fresh outputs of this merged request, not reused isolated-head scores. */
export function parseBundleResponse(raw: unknown, bundle: CompiledBundle) {
  const envelope = parseResponse(raw, {
    ...bundle.heads[0]!.compiled,
    payload: bundle.payload,
    compiled_bytes: bundle.compiled_bytes,
  });
  const heads = bundle.heads.map((head) => {
    const answers = Object.fromEntries(
      Object.entries(head.id_map).map(([original, scoped]) => [
        original,
        envelope.answers[scoped]!,
      ]),
    );
    const response = parseResponse({ ...envelope, answers }, head.compiled);
    return {
      profile: head.profile,
      features: extractFeatures(response, head.compiled),
      raw_answers: response.answers,
    };
  });
  return {
    prompt_sha256: bundle.prompt_sha256,
    requested_model: bundle.payload.model,
    reported_model: envelope.model ?? null,
    model_revision: envelope.model_revision ?? null,
    request_usage: {
      input_tokens: envelope.usage?.input_tokens ?? null,
      output_tokens: envelope.usage?.output_tokens ?? null,
    },
    heads,
  };
}

/** The caller owns deadlines. Transport enforces bounded bodies, pinning and no retries. */
export async function runBundle(
  profiles: readonly CandidateId[],
  pair: { claim: string; evidence: string },
  options: { apiKey: string; signal: AbortSignal; fetch?: typeof fetch; backend?: BackendConfig },
) {
  const backend = options.backend ?? createBackend("jev", { TYPESAFE_API_KEY: options.apiKey });
  const bundle = compileBundle(profiles, pair, backend.model);
  const wire = JSON.stringify(backendPayload(backend, bundle.payload));
  bundle.prompt_sha256 = sha256(wire);
  bundle.compiled_bytes = utf8Bytes(wire);
  if (bundle.compiled_bytes > LIMITS.compiledBytes)
    throw new ServiceError(422, "compiled_input_too_large", "Compiled wire input exceeds budget.");
  const raw = await sendBackend(backend, bundle.payload, options.signal, options.fetch ?? fetch);
  return {
    ...parseBundleResponse(raw, bundle),
    provider_calls: 1 as const,
    compiled_bytes: bundle.compiled_bytes,
  };
}
