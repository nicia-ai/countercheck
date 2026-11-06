import { ServiceError } from "../contracts/errors.js";
import type { Env, RateLimitBinding } from "../env.js";

export interface Principal {
  id: string;
  tenantId: string;
}

export async function hashKey(key: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function authenticate(request: Request, env: Env): Promise<Principal> {
  const match = /^(\S+) (cck_[A-Za-z0-9_-]{43})$/u.exec(request.headers.get("authorization") ?? "");
  if (!match || match[1]!.toLowerCase() !== "bearer")
    throw new ServiceError(401, "unauthorized", "A valid API key is required.");
  try {
    const hash = await hashKey(match[2]!);
    const row = await env.DB.withSession("first-primary")
      .prepare(
        "SELECT id, tenant_id FROM api_keys WHERE key_hash = ? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)",
      )
      .bind(hash, new Date().toISOString())
      .first<{ id: string; tenant_id: string }>();
    if (!row) throw new ServiceError(401, "unauthorized", "A valid API key is required.");
    return { id: row.id, tenantId: row.tenant_id };
  } catch (error) {
    if (error instanceof ServiceError) throw error;
    throw new ServiceError(
      503,
      "auth_unavailable",
      "Authentication is temporarily unavailable.",
      true,
    );
  }
}

export async function enforceRateLimit(principal: Principal, env: Env): Promise<void> {
  return enforceLimit(env.RATE_LIMITER, principal.id);
}

export async function enforceIngressLimit(request: Request, env: Env): Promise<void> {
  // Cloudflare supplies this header. Missing attribution shares a fail-safe bucket;
  // caller-controlled forwarding headers never select the bucket.
  return enforceLimit(
    env.INGRESS_LIMITER,
    request.headers.get("cf-connecting-ip") ?? "unattributed",
  );
}

async function enforceLimit(binding: RateLimitBinding, key: string): Promise<void> {
  try {
    const result = await binding.limit({ key });
    if (!result.success) {
      throw new ServiceError(429, "rate_limited", "Request rate limit exceeded.", true, 60);
    }
  } catch (error) {
    if (error instanceof ServiceError) throw error;
    throw new ServiceError(
      503,
      "rate_limit_unavailable",
      "Service is temporarily unavailable.",
      true,
    );
  }
}
