import { z } from "zod";
import { ServiceError } from "../../src/contracts/errors.js";
import { CLEF_BINDING_MODEL, CLEF_MODEL } from "../../src/providers/clef.js";
import { DECIDER_MODEL, DECIDER_URL } from "../../src/providers/decider.js";
import { JEV_MODEL, JEV_URL } from "../../src/providers/jev.js";
import { malformedProvider } from "../../src/providers/response.js";
import { sendDecision } from "../../src/providers/transport.js";
import type { CandidatePayload } from "./profiles.js";

export const BACKEND_IDS = ["jev", "clef", "decider"] as const;
export type BackendId = (typeof BACKEND_IDS)[number];
export const BACKEND_MODELS = {
  jev: JEV_MODEL,
  clef: CLEF_MODEL,
  decider: DECIDER_MODEL,
} as const;
export const DECIDER_REPORTED_MODELS = [
  DECIDER_MODEL,
  "perplexity/pplx-decider-v1.2-20261016",
] as const;

/** Missing identity stays unknown at the caller; explicit identities must match a reviewed pin. */
export function modelReportedCompatible(requested: string, reported: string): boolean {
  if (requested === JEV_MODEL || requested === CLEF_MODEL) return requested === reported;
  return requested === DECIDER_MODEL && DECIDER_REPORTED_MODELS.some((model) => model === reported);
}

/** Runtime-only configuration contains a credential; persist public route fields separately. */
export type BackendConfig = Readonly<{
  id: BackendId;
  model: string;
  url: string;
  apiKey: string;
  accountId?: string;
}>;
type Environment = Readonly<Record<string, string | undefined>>;
const configurationError = () =>
  new ServiceError(
    503,
    "provider_configuration",
    "Iteration backend configuration is unavailable.",
  );

function required(env: Environment, key: string): string {
  const value = env[key];
  if (typeof value !== "string" || !value.trim()) throw configurationError();
  return value;
}
function route(id: BackendId, accountId?: string): string {
  if (id === "jev") return JEV_URL;
  if (id === "decider") return DECIDER_URL;
  if (id !== "clef" || !accountId || !/^[a-fA-F0-9]{32}$/.test(accountId))
    throw configurationError();
  return `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${CLEF_BINDING_MODEL}`;
}
function validateConfig(config: BackendConfig): void {
  if (
    !BACKEND_IDS.includes(config.id) ||
    config.model !== BACKEND_MODELS[config.id] ||
    config.url !== route(config.id, config.accountId) ||
    typeof config.apiKey !== "string" ||
    !config.apiKey.trim() ||
    (config.id !== "clef" && config.accountId !== undefined)
  )
    throw configurationError();
}

/** Explicit environment only: no file loading, ambient fallback key, or alternate model. */
export function createBackend(id: BackendId, env: Environment): BackendConfig {
  if (!BACKEND_IDS.includes(id)) throw configurationError();
  const accountId = id === "clef" ? required(env, "CLOUDFLARE_ACCOUNT_ID") : undefined;
  const config: BackendConfig = {
    id,
    model: BACKEND_MODELS[id],
    url: route(id, accountId),
    apiKey: required(
      env,
      id === "jev"
        ? "TYPESAFE_API_KEY"
        : id === "clef"
          ? "CLOUDFLARE_API_TOKEN"
          : "OPENROUTER_API_KEY",
    ),
    ...(accountId !== undefined && { accountId }),
  };
  validateConfig(config);
  return Object.freeze(config);
}

export type BackendPayload = CandidatePayload & {
  provider?: { only: ["Perplexity"]; allow_fallbacks: false };
};
/** Hash this returned body: the OpenRouter routing envelope counts toward 16 KiB too. */
export function backendPayload(config: BackendConfig, payload: CandidatePayload): BackendPayload {
  validateConfig(config);
  if (payload.model !== config.model || Object.hasOwn(payload, "provider"))
    throw configurationError();
  return config.id === "decider"
    ? { ...payload, provider: { only: ["Perplexity"], allow_fallbacks: false } }
    : { ...payload };
}

const tokenCount = z.number().int().nonnegative().nullable().optional();
const usageSchema = z.strictObject({ input_tokens: tokenCount, output_tokens: tokenCount });
const commonResponseSchema = z.strictObject({
  model: z.string().min(1).max(256).optional(),
  model_revision: z.string().min(1).max(256).optional(),
  // Semantic coverage, answer kinds and distributions are validated by the mixed runner parser.
  answers: z.record(z.string(), z.unknown()),
  usage: usageSchema.optional(),
});
const routerResponseSchema = commonResponseSchema.extend({
  id: z.string().optional(),
  provider: z.string().optional(),
  usage: usageSchema
    .extend({ cost: z.number().finite().nonnegative().nullable().optional() })
    .optional(),
});
const clefEnvelopeSchema = z.strictObject({
  success: z.literal(true),
  result: z.unknown(),
  errors: z.array(z.unknown()).max(0),
  messages: z.array(z.unknown()),
});

/** Preserve mixed answers and full reported identity; never substitute the requested pin. */
export function normalizeBackendResponse(id: BackendId, raw: unknown) {
  if (!BACKEND_IDS.includes(id)) throw configurationError();
  let response = raw;
  if (id === "clef") {
    const envelope = clefEnvelopeSchema.safeParse(response);
    if (!envelope.success) throw malformedProvider();
    response = envelope.data.result;
  }
  const parsed = (id === "decider" ? routerResponseSchema : commonResponseSchema).safeParse(
    response,
  );
  if (!parsed.success) throw malformedProvider();
  const value = parsed.data;
  if ("provider" in value && value.provider !== undefined && value.provider !== "Perplexity")
    throw new ServiceError(502, "provider_route_mismatch", "Unexpected inference provider route.");
  return {
    ...(value.model !== undefined && { model: value.model }),
    ...(value.model_revision !== undefined && { model_revision: value.model_revision }),
    answers: value.answers,
    ...(value.usage !== undefined && {
      usage: {
        ...(value.usage.input_tokens != null && { input_tokens: value.usage.input_tokens }),
        ...(value.usage.output_tokens != null && { output_tokens: value.usage.output_tokens }),
      },
    }),
  };
}

/** One bounded attempt; caller owns the 3000ms race and passes its cancellation signal. */
export async function sendBackend(
  config: BackendConfig,
  payload: CandidatePayload,
  signal: AbortSignal,
  send: typeof fetch = fetch,
) {
  const wire = backendPayload(config, payload);
  const raw = await sendDecision(send, config.url, config.apiKey, wire, signal);
  return normalizeBackendResponse(config.id, raw);
}
