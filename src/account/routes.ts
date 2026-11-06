import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../env.js";
import { ServiceError } from "../contracts/errors.js";
import { hashKey } from "../control/auth.js";
import { getAdmissionService } from "../control/admission.js";
import { readJsonBody } from "../http/body.js";
import { requestAccess } from "./access.js";
import {
  accountSession,
  acceptAccountInvitation,
  assertAccountOrigin,
  sessionPrincipal,
  type AccountOptions,
} from "./auth.js";
export { handleAuth, sessionPrincipal } from "./auth.js";
export { inviteAccount } from "./auth.js";

export function isAccountAdmin(
  user: { id: string; email: string; emailVerified: boolean },
  env: Env,
): boolean {
  if (!user.emailVerified) return false;
  const ids = (env.ADMIN_USER_IDS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const emails = (env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  return ids.includes(user.id) || emails.includes(user.email.toLowerCase());
}

const createKeySchema = z.strictObject({ name: z.string().trim().min(1).max(80).optional() });
const keyFields = "id, prefix, name, created_at, expires_at, revoked_at, last_used_at";

export function accountRouter(options: AccountOptions = {}) {
  const app = new Hono<{ Bindings: Env }>();
  app.use("*", async (c, next) => {
    c.header("cache-control", "no-store");
    try {
      if (!c.env.AUTH_LIMITER) throw new Error("Account limiter unavailable");
      const limit = await c.env.AUTH_LIMITER.limit({
        key: `dashboard:${c.req.header("cf-connecting-ip") ?? "unattributed"}`,
      });
      if (!limit.success)
        throw new ServiceError(
          429,
          "rate_limited",
          "Account request rate limit exceeded.",
          true,
          60,
        );
    } catch (error) {
      if (error instanceof ServiceError) throw error;
      throw new ServiceError(
        503,
        "account_unavailable",
        "Accounts are temporarily unavailable.",
        true,
      );
    }
    if (c.req.method !== "GET" && c.req.method !== "HEAD") assertAccountOrigin(c.req.raw, c.env);
    await next();
  });
  app.post("/access-requests", async (c) => {
    await requestAccess(c.env, await readJsonBody(c.req.raw));
    return c.json({ requested: true }, 202);
  });
  app.get("/me", async (c) => {
    const { user } = await accountSession(c.req.raw, c.env, options);
    const tenantId = `tenant_${user.id}`;
    let admission: {
      status: "unverified" | "invitation_required" | "active" | "full" | "unavailable";
    } = {
      status: "unverified",
    };
    if (user.emailVerified) {
      try {
        await acceptAccountInvitation(user, c.env);
        await getAdmissionService(c.env).enroll({ tenantId });
        admission = { status: "active" };
      } catch (error) {
        if (error instanceof ServiceError && error.code === "invitation_required")
          admission = { status: "invitation_required" };
        else if (error instanceof ServiceError && error.code === "beta_full")
          admission = { status: "full" };
        else if (error instanceof ServiceError && error.status === 503)
          admission = { status: "unavailable" };
        else throw error;
      }
    }
    return c.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        emailVerified: user.emailVerified,
        useCase: user.useCase ?? null,
      },
      tenantId,
      admission,
      isAdmin: isAccountAdmin(user, c.env),
    });
  });
  app.get("/keys", async (c) => {
    const { principal } = await sessionPrincipal(c.req.raw, c.env, options);
    const rows = await c.env.DB.withSession("first-primary")
      .prepare(
        `SELECT ${keyFields} FROM api_keys WHERE tenant_id = ? ORDER BY (revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)) DESC, created_at DESC LIMIT 100`,
      )
      .bind(principal.tenantId, new Date().toISOString())
      .all();
    return c.json({ keys: rows.results });
  });
  app.post("/keys", async (c) => {
    const { principal } = await sessionPrincipal(c.req.raw, c.env, options);
    const parsed = createKeySchema.safeParse(await readJsonBody(c.req.raw));
    if (!parsed.success)
      throw new ServiceError(
        422,
        "invalid_key_options",
        "Provide an optional key name of 1–80 characters.",
      );
    await getAdmissionService(c.env).enroll({ tenantId: principal.tenantId });
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    const key = `cck_${btoa(String.fromCharCode(...bytes))
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replaceAll("=", "")}`;
    const id = crypto.randomUUID(),
      created = new Date(),
      expires = new Date(created.getTime() + 14 * 86400000);
    const createdAt = created.toISOString(),
      expiresAt = expires.toISOString();
    const prefix = key.slice(0, 12),
      name = parsed.data.name ?? "API key";
    // One atomic INSERT enforces the tenant cap even when simultaneous mint requests race.
    const inserted = await c.env.DB.withSession("first-primary")
      .prepare(
        "INSERT INTO api_keys (id, tenant_id, key_hash, created_at, name, prefix, expires_at) SELECT ?, ?, ?, ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM api_keys WHERE tenant_id = ? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)) < 3 RETURNING id",
      )
      .bind(
        id,
        principal.tenantId,
        await hashKey(key),
        createdAt,
        name,
        prefix,
        expiresAt,
        principal.tenantId,
        createdAt,
      )
      .first();
    if (!inserted)
      throw new ServiceError(
        409,
        "key_limit",
        "Revoke a key before creating another. Three live keys are allowed.",
      );
    return c.json(
      { key, id, prefix, name, created_at: createdAt, expires_at: expiresAt, revoked_at: null },
      201,
    );
  });
  app.post("/keys/:id/revoke", async (c) => {
    const { principal } = await sessionPrincipal(c.req.raw, c.env, options);
    const body = z.strictObject({}).safeParse(await readJsonBody(c.req.raw));
    if (!body.success)
      throw new ServiceError(422, "invalid_request", "Provide an empty JSON object.");
    const id = c.req.param("id");
    if (!z.uuid().safeParse(id).success)
      throw new ServiceError(404, "key_not_found", "Key not found.");
    const revokedAt = new Date().toISOString();
    const row = await c.env.DB.withSession("first-primary")
      .prepare(
        "UPDATE api_keys SET revoked_at = ? WHERE id = ? AND tenant_id = ? AND revoked_at IS NULL RETURNING id",
      )
      .bind(revokedAt, id, principal.tenantId)
      .first();
    if (!row) throw new ServiceError(404, "key_not_found", "Key not found or already revoked.");
    return c.json({ id, revoked_at: revokedAt });
  });
  return app;
}
