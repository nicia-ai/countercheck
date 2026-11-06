import { readFile } from "node:fs/promises";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createApp } from "../src/http/app.js";
import { hashKey } from "../src/control/auth.js";
import type { Env } from "../src/env.js";
import type { DecisionProvider } from "../src/providers/types.js";
import { checkResponseSchema } from "../src/contracts/index.js";
import { pruneUsage, recordUsage } from "../src/control/usage.js";
import { testAdmission } from "./helpers/admission.js";
import type { AccountMail } from "../src/account/mail.js";
import { inviteAccount } from "../src/account/auth.js";

const key = `cck_${"x".repeat(43)}`;
const mf = new Miniflare(
  convertV4MiniflareOptions({
    name: "countercheck-smoke",
    modules: true,
    script: 'export default { fetch() { return new Response("ok"); } };',
    compatibilityDate: "2026-11-03",
    d1Databases: { DB: "countercheck-smoke" },
  }),
);
let env: Env;
const tasks: Promise<unknown>[] = [];
const mail: AccountMail[] = [];
const admission = testAdmission(["smoke-tenant"]);
const provider: DecisionProvider = {
  id: "jev",
  model: "synthetic-not-a-benchmark",
  async classify(payload) {
    return {
      model: "synthetic-not-a-benchmark",
      answers: Object.fromEntries(
        Object.keys(payload.questions).map((id) => [
          id,
          {
            type: "choice",
            choice: "contradiction",
            probabilities: {
              contradiction: 0.97,
              consistent: 0.01,
              different_scope: 0.01,
              insufficient_context: 0.01,
            },
          },
        ]),
      ),
      usage: { input_tokens: 123 },
    };
  },
};
const app = createApp({
  provider,
  admission: admission.service,
  account: {
    mailer: async (message) => {
      mail.push(message);
    },
  },
  metric: () => undefined,
  background: { waitUntil: (task) => tasks.push(task) },
});

beforeAll(async () => {
  const db = await mf.getD1Database("DB");
  for (const name of [
    "0001_control.sql",
    "0002_accounts.sql",
    "0003_observability.sql",
    "0004_invitations.sql",
    "0005_access_requests.sql",
  ]) {
    const migration = await readFile(new URL(`../migrations/${name}`, import.meta.url), "utf8");
    for (const statement of migration.split(";").filter((item) => item.trim()))
      await db.prepare(statement).run();
  }
  await db
    .prepare("INSERT INTO api_keys (id,tenant_id,key_hash,created_at) VALUES (?,?,?,?)")
    .bind("smoke-key", "smoke-tenant", await hashKey(key), new Date().toISOString())
    .run();
  env = {
    DB: db,
    RATE_LIMITER: { limit: async () => ({ success: true }) },
    INGRESS_LIMITER: { limit: async () => ({ success: true }) },
    AUTH_LIMITER: { limit: async () => ({ success: true }) },
    BETTER_AUTH_URL: "https://countercheck.test",
    BETTER_AUTH_SECRET: "test-only-secret-with-at-least-32-random-characters",
  } as unknown as Env;
}, 30_000);
afterAll(async () => {
  await Promise.all(tasks);
  await mf.dispose();
});

it("checks over real local D1, records content-free usage, and immediately honors revoke", async () => {
  const request = () =>
    app.request(
      "/v1/check",
      {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
        body: JSON.stringify({
          claim: { id: "a", text: "Starter includes SSO." },
          against: [{ id: "b", text: "Starter excludes SSO." }],
        }),
      },
      env,
    );
  const response = await request();
  expect(response.status).toBe(200);
  const result = checkResponseSchema.parse(await response.json());
  expect(result.comparisons[0]!.verdict).toBe("contradiction");
  expect(result.usage).toEqual({ provider_calls: 1, input_tokens: 123 });
  await Promise.all(tasks);
  expect(
    await env.DB.prepare(
      "SELECT requests, comparisons, input_tokens FROM daily_usage WHERE key_id = ?",
    )
      .bind("smoke-key")
      .first(),
  ).toEqual({ requests: 1, comparisons: 1, input_tokens: 123 });
  await env.DB.prepare("UPDATE api_keys SET revoked_at = ? WHERE id = ?")
    .bind(new Date().toISOString(), "smoke-key")
    .run();
  expect((await request()).status).toBe(401);
});

it("expires usage for inactive and revoked keys without a successful inference", async () => {
  await env.DB.prepare("INSERT INTO daily_usage (key_id, day) VALUES (?, ?)")
    .bind("smoke-key", "2026-10-04")
    .run();
  await env.DB.prepare("INSERT INTO daily_usage (key_id, day) VALUES (?, ?)")
    .bind("smoke-key", "2026-10-05")
    .run();
  await pruneUsage(env, new Date("2026-11-03T00:00:00Z"));
  expect(
    await env.DB.prepare("SELECT day FROM daily_usage WHERE day = ?").bind("2026-10-04").first(),
  ).toBeNull();
  expect(
    await env.DB.prepare("SELECT day FROM daily_usage WHERE day = ?").bind("2026-10-05").first(),
  ).toEqual({ day: "2026-10-05" });
});

it("distinguishes unknown usage from a measured zero in daily aggregates", async () => {
  await recordUsage(env, "smoke-key", 1, null);
  await recordUsage(env, "smoke-key", 1, 0);
  const row = await env.DB.prepare(
    "SELECT requests, input_tokens, unknown_token_requests FROM daily_usage WHERE key_id = ? AND day = ?",
  )
    .bind("smoke-key", new Date().toISOString().slice(0, 10))
    .first();
  expect(row).toEqual({ requests: 3, input_tokens: 123, unknown_token_requests: 1 });
});

it("shares session and API tenant admission while rejecting playground CSRF and API-key session substitutes", async () => {
  const origin = "https://countercheck.test",
    email = "dashboard-smoke@example.test";
  const auth = (path: string, body?: unknown) =>
    app.request(
      origin + "/api/auth" + path,
      {
        method: body === undefined ? "GET" : "POST",
        headers: { origin, "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      },
      env,
    );
  await inviteAccount(env, { email, invitedBy: "synthetic-admin" });
  expect(
    (await auth("/sign-in/magic-link", { email, name: "Smoke account", callbackURL: "/dashboard" }))
      .status,
  ).toBe(200);
  const verification = mail.find((m) => m.kind === "signin" && m.to === email)!;
  expect(verification).toBeTruthy();
  const signin = await app.request(verification.url, {}, env);
  expect(signin.status).toBe(302);
  const cookie = signin.headers
    .getSetCookie()
    .map((s) => s.split(";")[0])
    .join("; ");
  const session = await app.request(origin + "/api/auth/get-session", { headers: { cookie } }, env);
  const signed = (await session.json()) as { user: { id: string } };
  const tenantId = `tenant_${signed.user.id}`;
  await admission.service.enroll({ tenantId });
  const input = {
    claim: { id: "private-dashboard", text: "The plan includes SSO." },
    against: [{ id: "private-comparison", text: "The plan excludes SSO." }],
  };
  const check = (headers: Record<string, string>) =>
    app.request(
      origin + "/dashboard/api/check",
      {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(input),
      },
      env,
    );
  expect((await check({ origin: "https://evil.test", cookie })).status).toBe(403);
  expect((await check({ origin, cookie, "sec-fetch-site": "cross-site" })).status).toBe(403);
  expect((await check({ origin, authorization: `Bearer ${key}` })).status).toBe(401);
  expect((await check({ origin, cookie })).status).toBe(200);
  await Promise.all(tasks);
  const apiKey = `cck_${"j".repeat(43)}`;
  await env.DB.prepare(
    "INSERT INTO api_keys (id,tenant_id,key_hash,created_at,expires_at) VALUES (?,?,?,?,?)",
  )
    .bind(
      "dashboard-smoke-api",
      tenantId,
      await hashKey(apiKey),
      new Date().toISOString(),
      "2099-01-01T00:00:00.000Z",
    )
    .run();
  const api = await app.request(
    "/v1/check",
    {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(input),
    },
    env,
  );
  expect(api.status).toBe(200);
  await Promise.all(tasks);
  expect(admission.coordinator.getUsage(tenantId).today.attempts).toBe(2);
  const channels = await env.DB.prepare(
    "SELECT channel, admitted, completed FROM tenant_daily_usage WHERE tenant_id = ? ORDER BY channel",
  )
    .bind(tenantId)
    .all();
  expect(channels.results).toEqual([
    { channel: "api", admitted: 1, completed: 1 },
    { channel: "dashboard", admitted: 1, completed: 1 },
  ]);
});

it("rejects expired API keys and retains future expiry and legacy-null behavior on real D1", async () => {
  for (const [index, expires] of [
    "2000-01-01T00:00:00.000Z",
    "2099-01-01T00:00:00.000Z",
    null,
  ].entries()) {
    const apiKey = `cck_${String.fromCharCode(107 + index).repeat(43)}`;
    await env.DB.prepare(
      "INSERT INTO api_keys (id,tenant_id,key_hash,created_at,expires_at) VALUES (?,?,?,?,?)",
    )
      .bind(
        `expiry-smoke-${index}`,
        "smoke-tenant",
        await hashKey(apiKey),
        new Date().toISOString(),
        expires,
      )
      .run();
    const response = await app.request(
      "/v1/check",
      {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          claim: { id: "a", text: "A applies." },
          against: [{ id: "b", text: "A does not apply." }],
        }),
      },
      env,
    );
    expect(response.status).toBe(index === 0 ? 401 : 200);
    await Promise.all(tasks);
  }
});

it("requires an administrator session and origin for invitations, enrollment and pause controls", async () => {
  const origin = "https://countercheck.test";
  const email = "operator-control@example.test";
  const adminEnv = { ...env, ADMIN_EMAILS: email };
  const account = (path: string, body: unknown) =>
    app.request(
      origin + "/api/auth" + path,
      {
        method: "POST",
        headers: { origin, "content-type": "application/json" },
        body: JSON.stringify(body),
      },
      adminEnv,
    );
  expect(
    (
      await account("/sign-in/magic-link", {
        email,
        name: "Test operator",
        callbackURL: "/dashboard",
      })
    ).status,
  ).toBe(200);
  const verification = mail.find((m) => m.kind === "signin" && m.to === email)!;
  const signin = await app.request(verification.url, {}, adminEnv);
  expect(signin.status).toBe(302);
  const cookie = signin.headers
    .getSetCookie()
    .map((s) => s.split(";")[0])
    .join("; ");
  const admin = (
    path: string,
    body: unknown,
    headers: Record<string, string> = { origin, cookie },
  ) =>
    app.request(
      origin + "/dashboard/api/admin" + path,
      {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(body),
      },
      adminEnv,
    );
  expect(
    (await admin("/invitations", { email: "new-invite@example.test" }, { origin })).status,
  ).toBe(401);
  expect(
    (
      await admin(
        "/invitations",
        { email: "new-invite@example.test" },
        { origin: "https://evil.test", cookie },
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await admin(
        "/invitations",
        { email: "new-invite@example.test" },
        { origin, authorization: `Bearer ${key}` },
      )
    ).status,
  ).toBe(401);
  const invited = await admin("/invitations", { email: "new-invite@example.test" });
  expect(invited.status).toBe(201);
  expect(await invited.json()).toMatchObject({ invited: true });
  const invite = await env.DB.prepare(
    "SELECT invited_by,accepted_at FROM account_invitations WHERE email=?",
  )
    .bind("new-invite@example.test")
    .first<{ invited_by: string; accepted_at: string | null }>();
  expect(invite?.invited_by).toBeTruthy();
  expect(invite?.accepted_at).toBeNull();
  expect((await admin("/enroll", { tenantId: "legacy-operator-tenant" })).status).toBe(200);
  expect((await admin("/tenants/legacy-operator-tenant/pause", { paused: true })).status).toBe(200);
  expect(admission.coordinator.getUsage("legacy-operator-tenant").paused).toBe(true);
  expect((await admin("/pause", { paused: true })).status).toBe(200);
  expect(admission.coordinator.getGlobalUsage().paused).toBe(true);
  expect((await admin("/pause", { paused: false })).status).toBe(200);
  const denied = await app.request(
    origin + "/dashboard/api/admin/overview",
    { headers: { cookie } },
    env,
  );
  expect(denied.status).toBe(403);
  const audit = await env.DB.prepare("SELECT action,target_id FROM admin_audit").all();
  expect(audit.results).toContainEqual({ action: "invite_account_requested", target_id: null });
  expect(JSON.stringify(audit.results)).not.toContain("new-invite@example.test");
});
