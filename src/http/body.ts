import { parseStrictJson } from "../json.js";
import { ServiceError } from "../contracts/errors.js";
import { LIMITS } from "../contracts/limits.js";
import { withDeadline } from "./deadline.js";

export async function readJsonBody(request: Request, parent = request.signal): Promise<unknown> {
  if (!/^application\/json(?:\s*;|$)/iu.test(request.headers.get("content-type") ?? "")) {
    throw new ServiceError(415, "unsupported_media_type", "Use application/json.");
  }
  const encoding = request.headers.get("content-encoding");
  if (encoding && encoding.toLowerCase() !== "identity") {
    throw new ServiceError(415, "unsupported_encoding", "Use uncompressed JSON.");
  }
  const length = request.headers.get("content-length");
  if (length && /^\d+$/u.test(length) && Number(length) > LIMITS.bodyBytes) {
    throw new ServiceError(413, "body_too_large", "Request body exceeds the byte limit.");
  }
  return withDeadline(
    async (signal) => {
      const reader = request.body?.getReader();
      if (!reader) throw new ServiceError(400, "invalid_json", "Provide a JSON body.");
      const cancel = () => {
        void reader.cancel().catch(() => undefined);
      };
      signal.addEventListener("abort", cancel, { once: true });
      const decoder = new TextDecoder("utf-8", { fatal: true });
      let size = 0;
      let text = "";
      try {
        while (true) {
          const chunk = await reader.read();
          if (signal.aborted) throw signal.reason;
          if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > LIMITS.bodyBytes) {
            cancel();
            throw new ServiceError(413, "body_too_large", "Request body exceeds the byte limit.");
          }
          text += decoder.decode(chunk.value, { stream: true });
        }
        text += decoder.decode();
        return parseStrictJson(text);
      } catch (error) {
        if (error instanceof ServiceError) throw error;
        throw new ServiceError(400, "invalid_json", "Provide valid UTF-8 JSON.");
      } finally {
        signal.removeEventListener("abort", cancel);
        reader.releaseLock();
      }
    },
    LIMITS.bodyReadMs,
    new ServiceError(408, "body_timeout", "Request body read timed out.", true),
    parent,
  );
}
