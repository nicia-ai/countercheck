import { parseStrictJson } from "../json.js";
import { ServiceError } from "../contracts/errors.js";
import { utf8Bytes } from "../contracts/index.js";
import { LIMITS } from "../contracts/limits.js";
import { malformedProvider } from "./response.js";

export const MAX_PROVIDER_RESPONSE_BYTES = 65_536;

export function assertDecisionBodyFits(payload: unknown): void {
  serializeDecisionBody(payload);
}

function serializeDecisionBody(payload: unknown): string {
  const body = JSON.stringify(payload);
  if (utf8Bytes(body) > LIMITS.compiledBytes)
    throw new ServiceError(
      422,
      "compiled_input_too_large",
      "The compiled check exceeds the provider input byte limit.",
    );
  return body;
}

/** Provider failures never leak decoder or upstream details. */
export function parseProviderJson(text: string): unknown {
  try {
    return parseStrictJson(text);
  } catch {
    throw malformedProvider();
  }
}

function aborted(signal: AbortSignal): void {
  if (signal.aborted)
    throw new ServiceError(504, "deadline_exceeded", "The check deadline was exceeded.", true);
}

/** Counts streamed, decoded body bytes rather than trusting Content-Length. */
export async function readProviderJson(response: Response, signal: AbortSignal): Promise<unknown> {
  aborted(signal);
  const declared = response.headers.get("content-length");
  if (
    declared !== null &&
    /^\d+$/.test(declared) &&
    Number(declared) > MAX_PROVIDER_RESPONSE_BYTES
  ) {
    void response.body?.cancel().catch(() => {});
    throw malformedProvider();
  }
  if (
    !/^application\/(?:[\w.-]+\+)?json(?:\s*;|$)/i.test(response.headers.get("content-type") ?? "")
  ) {
    void response.body?.cancel().catch(() => {});
    throw malformedProvider();
  }
  if (!response.body) throw malformedProvider();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  const cancel = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    while (true) {
      aborted(signal);
      const chunk = await reader.read();
      aborted(signal);
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_PROVIDER_RESPONSE_BYTES) {
        cancel();
        throw malformedProvider();
      }
      chunks.push(chunk.value);
    }
    const buffer = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) {
      buffer.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return parseProviderJson(new TextDecoder("utf-8", { fatal: true }).decode(buffer));
  } catch (error) {
    aborted(signal);
    if (error instanceof ServiceError) throw error;
    throw malformedProvider();
  } finally {
    signal.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
}

export async function sendDecision(
  send: typeof fetch,
  url: string,
  apiKey: string,
  payload: unknown,
  signal: AbortSignal,
): Promise<unknown> {
  aborted(signal);
  const body = serializeDecisionBody(payload);
  let response: Response;
  try {
    response = await send(url, {
      method: "POST",
      redirect: "manual",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
        accept: "application/json",
      },
      body,
      signal,
    });
  } catch {
    aborted(signal);
    throw new ServiceError(
      503,
      "provider_unavailable",
      "The inference provider is unavailable.",
      true,
    );
  }
  if (signal.aborted) {
    void response.body?.cancel().catch(() => {});
    aborted(signal);
  }
  if (!response.ok) {
    // Never read or retain provider error bodies, including request IDs or credentials.
    void response.body?.cancel().catch(() => {});
    if (response.status === 408 || response.status === 504)
      throw new ServiceError(
        504,
        "provider_timeout",
        "The inference provider deadline was exceeded.",
        true,
      );
    if (response.status === 401 || response.status === 403)
      throw new ServiceError(
        503,
        "provider_auth_failed",
        "Inference provider access is unavailable.",
        false,
      );
    if (response.status === 429 || response.status >= 500) {
      const retry = response.headers.get("retry-after");
      const seconds =
        retry !== null && /^\d{1,5}$/.test(retry)
          ? Math.max(1, Math.min(3600, Number(retry)))
          : undefined;
      throw new ServiceError(
        503,
        "provider_unavailable",
        "The inference provider is unavailable.",
        true,
        seconds,
      );
    }
    throw malformedProvider();
  }
  return readProviderJson(response, signal);
}
