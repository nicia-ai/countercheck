import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { getMigrations } from "better-auth/db/migration";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { Hono } from "hono";
import type { D1Database } from "@cloudflare/workers-types";
import type { Env } from "../src/env.js";
import {
  accountOrigin,
  createAuth,
  handleAuth,
  sessionPrincipal,
  inviteAccount,
  acceptAccountInvitation,
} from "../src/account/auth.js";
import type { AccountMail } from "../src/account/mail.js";
import { accountRouter, isAccountAdmin } from "../src/account/routes.js";
import { accountMailer } from "../src/account/mail.js";
import { ServiceError } from "../src/contracts/errors.js";
import { hashKey } from "../src/control/auth.js";
import type { AdmissionNamespace } from "../src/control/admission.js";

let mf: Miniflare, db: D1Database;
const origin = "https://countercheck.test";
const messages: AccountMail[] = [];
const options = {
  mailer: async (mail: AccountMail) => {
    messages.push(mail);
  },
};
const environment = (): Env =>
  ({
    DB: db,
    BETTER_AUTH_URL: origin,
    BETTER_AUTH_SECRET: "test-only-secret-with-at-least-32-random-characters",
    AUTH_LIMITER: { limit: async () => ({ success: true }) },
    RATE_LIMITER: { limit: async () => ({ success: true }) },
    INGRESS_LIMITER: { limit: async () => ({ success: true }) },
  }) as Env;
const request = (
  path: string,
  body?: unknown,
  cookie?: string,
  extra: Record<string, string> = {},
) =>
  new Request(origin + "/api/auth" + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      origin,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(cookie && { cookie }),
      ...extra,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const call = (path: string, body?: unknown, cookie?: string) =>
  handleAuth(request(path, body, cookie), environment(), options);
const cookies = (response: Response) =>
  response.headers
    .getSetCookie()
    .map((s) => s.split(";")[0])
    .join("; ");
async function sendLink(email: string, env = environment()) {
  const sent = await handleAuth(
    request("/sign-in/magic-link", { email, name: "Account tester", callbackURL: "/dashboard" }),
    env,
    options,
  );
  expect(sent.status).toBe(200);
  expect(await sent.json()).toEqual({ status: true });
  expect(cookies(sent)).toBe("");
  return [...messages].reverse().find((m) => m.to === email.toLowerCase() && m.kind === "signin");
}
async function expectAccessRequired(email: string) {
  const before = messages.length;
  const pending = await db.prepare("SELECT COUNT(*) AS count FROM verification").first();
  const response = await call("/sign-in/magic-link", { email, callbackURL: "/dashboard" });
  expect(response.status).toBe(403);
  expect(await response.json()).toMatchObject({ code: "ACCESS_REQUIRED" });
  expect(cookies(response)).toBe("");
  expect(messages).toHaveLength(before);
  expect(await db.prepare("SELECT COUNT(*) AS count FROM verification").first()).toEqual(pending);
  expect(
    await db
      .prepare('SELECT s.id FROM "session" s JOIN "user" u ON u.id = s.userId WHERE u.email = ?')
      .bind(email.toLowerCase())
      .first(),
  ).toBeNull();
}
async function verifiedUser() {
  const email = `test-${crypto.randomUUID()}@example.test`;
  await inviteAccount(environment(), { email, invitedBy: "synthetic-admin" });
  const message = await sendLink(email);
  expect(message).toBeTruthy();
  const signin = await handleAuth(new Request(message!.url), environment(), options);
  expect(signin.status).toBe(302);
  expect(signin.headers.get("location")).toBe(origin + "/dashboard");
  return { email, cookie: cookies(signin), message: message!, response: signin };
}
beforeAll(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      name: "account-test",
      modules: true,
      script: `export default {fetch(){return new Response("ok")}}`,
      d1Databases: { DB: "account-test" },
      compatibilityDate: "2026-11-04",
    }),
  );
  db = (await mf.getD1Database("DB")) as unknown as D1Database;
  for (const file of [
    "0001_control.sql",
    "0002_accounts.sql",
    "0004_invitations.sql",
    "0005_access_requests.sql",
  ]) {
    const sql = await readFile(new URL(`../migrations/${file}`, import.meta.url), "utf8");
    await db.batch(
      sql
        .split(";")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => db.prepare(s)),
    );
  }
}, 20000);
afterAll(async () => {
  await mf?.dispose();
});

describe("Better Auth native D1 accounts", () => {
  it("returns access-required without mail, token, account or session, and creates users only from mailbox links", async () => {
    const email = `invite-${crypto.randomUUID()}@example.test`;
    await expectAccessRequired(email);
    expect(
      await db.prepare('SELECT id FROM "user" WHERE email = ?').bind(email).first(),
    ).toBeNull();
    await db
      .prepare("INSERT INTO access_requests(email,note,requested_at) VALUES(?,?,?)")
      .bind(email, "Synthetic evaluation request", new Date().toISOString())
      .run();
    // Requesting access neither grants membership nor creates authentication state.
    await expectAccessRequired(email);
    expect(
      await db.prepare('SELECT id FROM "user" WHERE email = ?').bind(email).first(),
    ).toBeNull();
    const mailBeforeApproval = messages.length;
    const invitation = await inviteAccount(environment(), {
      email: email.toUpperCase(),
      invitedBy: "admin-id",
    });
    expect(invitation.email).toBe(email);
    expect(messages).toHaveLength(mailBeforeApproval);
    expect(
      await db
        .prepare("SELECT reviewed_at FROM access_requests WHERE email = ?")
        .bind(email)
        .first(),
    ).toEqual({ reviewed_at: invitation.createdAt });
    expect(
      Date.parse(invitation.expiresAt) - Date.parse(invitation.createdAt),
    ).toBeGreaterThanOrEqual(7 * 86400000 - 5);
    await expect(
      acceptAccountInvitation({ email, emailVerified: false }, environment()),
    ).rejects.toMatchObject({ status: 403 });
    const message = await sendLink(email.toUpperCase());
    expect(new URL(message!.url).pathname).toBe("/api/auth/magic-link/verify");
    expect(
      await db.prepare('SELECT id FROM "user" WHERE email = ?').bind(email).first(),
    ).toBeNull();
    expect(
      await db
        .prepare("SELECT accepted_at FROM account_invitations WHERE email = ?")
        .bind(email)
        .first(),
    ).toEqual({ accepted_at: null });
    const response = await handleAuth(new Request(message!.url), environment(), options);
    expect(response.status).toBe(302);
    expect(cookies(response)).not.toBe("");
    expect(
      await db.prepare('SELECT emailVerified FROM "user" WHERE email = ?').bind(email).first(),
    ).toEqual({ emailVerified: 1 });
    expect(
      (await db
        .prepare("SELECT accepted_at FROM account_invitations WHERE email = ?")
        .bind(email)
        .first())!.accepted_at,
    ).toBeTruthy();
    const replay = await handleAuth(new Request(message!.url), environment(), options);
    expect(replay.status).toBe(302);
    expect(replay.headers.get("location")).toContain("error=INVALID_TOKEN");
    expect(cookies(replay)).toBe("");
  });

  it("blocks password pre-hijacking for invited and bootstrap mailboxes", async () => {
    for (const bootstrap of [false, true]) {
      const email = `owner-${crypto.randomUUID()}@example.test`;
      const env = { ...environment(), ...(bootstrap ? { ADMIN_EMAILS: email } : {}) };
      if (!bootstrap) await inviteAccount(env, { email, invitedBy: "synthetic-admin" });
      for (const path of [
        "/sign-up/email",
        "/sign-in/email",
        "/request-password-reset",
        "/reset-password",
        "/set-password",
        "/change-password",
        "/verify-password",
        "/send-verification-email",
      ])
        expect(
          (
            await handleAuth(
              request(path, {
                email,
                name: "Attacker",
                password: "Attacker-selected-password-42!",
                newPassword: "Attacker-selected-password-42!",
              }),
              env,
              options,
            )
          ).status,
        ).toBe(404);
      expect(
        (await handleAuth(request("/reset-password/synthetic-legacy-token"), env, options)).status,
      ).toBe(404);
      expect(
        (await handleAuth(request("/verify-email?token=synthetic-legacy-token"), env, options))
          .status,
      ).toBe(404);
      expect(
        await db.prepare('SELECT id FROM "user" WHERE email = ?').bind(email).first(),
      ).toBeNull();
      const message = await sendLink(email, env);
      const response = await handleAuth(new Request(message!.url), env, options);
      expect(response.status).toBe(302);
      const session = await createAuth(env, options).api.getSession({
        headers: new Headers({ cookie: cookies(response) }),
      });
      expect(session?.user.emailVerified).toBe(true);
      expect(
        await db
          .prepare("SELECT id FROM account WHERE userId = ? AND password IS NOT NULL")
          .bind(session!.user.id)
          .first(),
      ).toBeNull();
      // A bootstrap account remains eligible after removal from the admin allowlist.
      expect(await sendLink(email)).toBeTruthy();
    }
  });

  it("checks invitation expiry again when consuming new and existing-user links", async () => {
    for (const existingUser of [false, true]) {
      const email = `expired-${crypto.randomUUID()}@example.test`;
      await inviteAccount(environment(), { email, invitedBy: "synthetic-admin" });
      if (existingUser) {
        const created = await createAuth(environment(), options).$context;
        await created.internalAdapter.createUser(
          { email, name: "Existing invitee", emailVerified: true },
          { method: "magic-link" },
        );
      }
      const message = await sendLink(email);
      await db
        .prepare("UPDATE account_invitations SET expires_at = ? WHERE email = ?")
        .bind("2000-01-01T00:00:00.000Z", email)
        .run();
      const response = await handleAuth(new Request(message!.url), environment(), options);
      expect([302, 403]).toContain(response.status);
      expect(cookies(response)).toBe("");
      if (response.status === 302) expect(response.headers.get("location")).toContain("error=");
      expect(
        await db
          .prepare(
            'SELECT s.id FROM "session" s JOIN "user" u ON u.id = s.userId WHERE u.email = ?',
          )
          .bind(email)
          .first(),
      ).toBeNull();
      await expectAccessRequired(email);
    }
    const accepted = await verifiedUser();
    await db
      .prepare("UPDATE account_invitations SET expires_at = ? WHERE email = ?")
      .bind("2000-01-01T00:00:00.000Z", accepted.email)
      .run();
    const next = await sendLink(accepted.email);
    expect((await handleAuth(new Request(next!.url), environment(), options)).status).toBe(302);
  });

  it("atomically consumes magic links and rejects expired links", async () => {
    const email = `single-use-${crypto.randomUUID()}@example.test`;
    await inviteAccount(environment(), { email, invitedBy: "synthetic-admin" });
    const message = await sendLink(email);
    const responses = await Promise.all(
      Array.from({ length: 2 }, () =>
        handleAuth(new Request(message!.url), environment(), options),
      ),
    );
    expect(responses.filter((response) => cookies(response) !== "")).toHaveLength(1);
    expect(
      responses.filter((response) =>
        response.headers.get("location")?.includes("error=INVALID_TOKEN"),
      ),
    ).toHaveLength(1);
    const expired = await sendLink(email);
    await db.prepare("UPDATE verification SET expiresAt = ?").bind(946684800000).run();
    const response = await handleAuth(new Request(expired!.url), environment(), options);
    expect(response.headers.get("location")).toContain("error=INVALID_TOKEN");
    expect(cookies(response)).toBe("");
  });
  it("isolates Countercheck sessions from parent-domain Better Auth cookies", async () => {
    const user = await verifiedUser();
    const oldCookie = "__Secure-better-auth.session_token=synthetic-parent-session.invalid";
    const env = {
      ...environment(),
      ADMISSION: {
        idFromName: () => ({}),
        get: () => ({ enroll: async () => ({ ok: true, value: { enrolled: true } }) }),
      } as unknown as AdmissionNamespace,
    };
    const app = new Hono<{ Bindings: Env }>().route("/dashboard/api", accountRouter(options));
    app.onError((error, c) =>
      error instanceof ServiceError
        ? c.json({ error: { code: error.code } }, error.status as 400)
        : c.json({ error: { code: "unavailable" } }, 503),
    );
    const me = (cookie: string) =>
      app.request(origin + "/dashboard/api/me", { headers: { cookie } }, env);
    for (const cookie of [`${oldCookie}; ${user.cookie}`, `${user.cookie}; ${oldCookie}`]) {
      const session = await call("/get-session", undefined, cookie);
      expect(((await session.json()) as { user: { email: string } }).user.email).toBe(user.email);
      const response = await me(cookie);
      expect(response.status).toBe(200);
      expect(((await response.json()) as { user: { email: string } }).user.email).toBe(user.email);
    }
    expect(await (await call("/get-session", undefined, oldCookie)).json()).toBeNull();
    expect((await me(oldCookie)).status).toBe(401);
    const emitted = user.response.headers.getSetCookie();
    expect(emitted.some((value) => value.startsWith("__Host-countercheck.session_token="))).toBe(
      true,
    );
    for (const value of emitted) {
      expect(value).toMatch(/^__Host-countercheck\./);
      expect(value).toContain("; Path=/");
      expect(value).toContain("; Secure");
      expect(value).toContain("; HttpOnly");
      expect(value).toContain("; SameSite=Lax");
      expect(value).not.toMatch(/; Domain=/i);
    }
    const signout = await call("/sign-out", {}, `${oldCookie}; ${user.cookie}`);
    expect(signout.status).toBe(200);
    const expired = signout.headers.getSetCookie();
    expect(
      expired.some(
        (value) =>
          value.startsWith("__Host-countercheck.session_token=") && value.includes("Max-Age=0"),
      ),
    ).toBe(true);
    expect(
      expired.every(
        (value) => value.startsWith("__Host-countercheck.") && !value.includes("Domain="),
      ),
    ).toBe(true);
    expect((await me(`${oldCookie}; ${user.cookie}`)).status).toBe(401);
  });

  it("keeps a dedicated non-secure cookie namespace for HTTP localhost development", async () => {
    const local = "http://localhost:8787";
    const email = `local-${crypto.randomUUID()}@example.test`;
    const env = { ...environment(), BETTER_AUTH_URL: local, ADMIN_EMAILS: email };
    const response = await handleAuth(
      new Request(local + "/api/auth/sign-in/magic-link", {
        method: "POST",
        headers: { origin: local, "content-type": "application/json" },
        body: JSON.stringify({ email, callbackURL: "/dashboard" }),
      }),
      env,
      options,
    );
    expect(response.status).toBe(200);
    const message = messages.find((mail) => mail.to === email)!;
    const verified = await handleAuth(new Request(message.url), env, options);
    expect(verified.status).toBe(302);
    const emitted = verified.headers.getSetCookie();
    expect(emitted.some((value) => value.startsWith("countercheck.session_token="))).toBe(true);
    expect(
      emitted.every((value) => !value.includes("; Secure") && !value.includes("Domain=")),
    ).toBe(true);
    const session = await createAuth(env, options).api.getSession({
      headers: new Headers({ cookie: cookies(verified) }),
    });
    expect(session?.user.email).toBe(email);
  });

  it("matches Better Auth's canonical migration plan without applying runtime migrations", async () => {
    const plan = await getMigrations(createAuth(environment(), options).options);
    expect(plan.toBeCreated).toEqual([]);
    expect(plan.toBeAdded).toEqual([]);
    expect(plan.toBeAddedIndexes).toEqual([]);
    expect(plan.schemaProblems).toEqual([]);
    expect(plan.unsafeChanges).toEqual([]);
  });
  it("uses verified exact admin allowlists and safely fails mail delivery without exposing upstream bodies", async () => {
    const user = { id: "admin-id", email: "Admin@example.test", emailVerified: true };
    expect(isAccountAdmin(user, { ...environment(), ADMIN_EMAILS: " admin@example.test " })).toBe(
      true,
    );
    expect(
      isAccountAdmin(
        { ...user, emailVerified: false },
        { ...environment(), ADMIN_USER_IDS: "admin-id" },
      ),
    ).toBe(false);
    expect(
      isAccountAdmin(
        { ...user, email: "intruder@admin@example.test" },
        { ...environment(), ADMIN_EMAILS: "admin@example.test" },
      ),
    ).toBe(false);
    const mail = accountMailer(
      {
        ...environment(),
        RESEND_API_KEY: "synthetic-test-not-a-real-key",
        AUTH_EMAIL_FROM: "test@example.test",
      },
      async (url, init) => {
        expect(url).toBe("https://api.resend.com/emails");
        expect(init?.redirect).toBe("manual");
        expect(init?.signal).toBeInstanceOf(AbortSignal);
        expect(JSON.parse(init!.body as string)).toMatchObject({
          subject: "Sign in to Countercheck",
        });
        return new Response("sensitive upstream diagnostic", { status: 503 });
      },
    );
    await expect(
      mail({
        to: "recipient@example.test",
        url: origin + "/api/auth/magic-link/verify?token=synthetic",
        kind: "signin",
      }),
    ).rejects.toMatchObject({ status: 503, message: "Account email is temporarily unavailable." });
  });
  it("stores only hashed expiring keys, caps concurrent minting and enforces ownership", async () => {
    const user = await verifiedUser(),
      other = await verifiedUser();
    const enrolled = new Set<string>();
    const env = {
      ...environment(),
      ADMISSION: {
        idFromName: () => ({}),
        get: () => ({
          enroll: async ({ tenantId }: { tenantId: string }) => {
            enrolled.add(tenantId);
            return { ok: true, value: { enrolled: true } };
          },
        }),
      } as unknown as AdmissionNamespace,
    };
    const app = new Hono<{ Bindings: Env }>().route("/dashboard/api", accountRouter(options));
    app.onError((error, c) =>
      error instanceof ServiceError
        ? c.json({ error: { code: error.code } }, error.status as 400)
        : c.json({ error: { code: "unavailable" } }, 503),
    );
    const account = (path: string, cookie: string, body?: unknown, host = origin) =>
      app.request(
        origin + "/dashboard/api" + path,
        {
          method: body === undefined ? "GET" : "POST",
          headers: {
            cookie,
            origin: host,
            ...(body === undefined ? {} : { "content-type": "application/json" }),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        },
        env,
      );
    const minted = await Promise.all(
      Array.from({ length: 6 }, () => account("/keys", user.cookie, { name: "Integration" })),
    );
    expect(minted.filter((r) => r.status === 201)).toHaveLength(3);
    expect(minted.filter((r) => r.status === 409)).toHaveLength(3);
    const secret = (await minted.find((r) => r.status === 201)!.json()) as {
      key: string;
      id: string;
      created_at: string;
      expires_at: string;
    };
    expect(secret.key).toMatch(/^cck_[A-Za-z0-9_-]{43}$/);
    expect(Date.parse(secret.expires_at) - Date.parse(secret.created_at)).toBe(14 * 86400000);
    const stored = await db.prepare("SELECT * FROM api_keys WHERE id = ?").bind(secret.id).first();
    expect(stored!.key_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(stored)).not.toContain(secret.key);
    const listing = await account("/keys", user.cookie);
    expect(listing.headers.get("cache-control")).toBe("no-store");
    expect(JSON.stringify(await listing.json())).not.toContain(secret.key);
    const owner = await createAuth(environment(), options).api.getSession({
      headers: new Headers({ cookie: user.cookie }),
    });
    // Historic revoked metadata must never push an older live credential out of the bounded list.
    const historic = await Promise.all(
      Array.from({ length: 101 }, async (_, index) =>
        db
          .prepare(
            "INSERT INTO api_keys (id,tenant_id,key_hash,created_at,revoked_at) VALUES(?,?,?,?,?)",
          )
          .bind(
            crypto.randomUUID(),
            `tenant_${owner!.user.id}`,
            await hashKey(`public-revoked-fixture-${index}`),
            "2099-01-01T00:00:00.000Z",
            "2099-01-02T00:00:00.000Z",
          ),
      ),
    );
    await db.batch(historic);
    const bounded = (await (await account("/keys", user.cookie)).json()) as {
      keys: { id: string; revoked_at: string | null }[];
    };
    expect(bounded.keys).toHaveLength(100);
    expect(bounded.keys.filter((k) => k.revoked_at === null)).toHaveLength(3);
    expect(bounded.keys.some((k) => k.id === secret.id)).toBe(true);
    expect((await account(`/keys/${secret.id}/revoke`, other.cookie, {})).status).toBe(404);
    expect(
      (await account(`/keys/${secret.id}/revoke`, user.cookie, {}, "https://evil.test")).status,
    ).toBe(403);
    expect((await account(`/keys/${secret.id}/revoke`, user.cookie, {})).status).toBe(200);
    expect((await account("/keys", user.cookie, {})).status).toBe(201);
    expect(enrolled.size).toBe(1);
  }, 20000);
  it("uses database sessions without persisted IP/user-agent and revokes signed-out sessions", async () => {
    const verified = await verifiedUser();
    const auth = createAuth(environment(), options);
    const session = await auth.api.getSession({
      headers: new Headers({ cookie: verified.cookie }),
    });
    expect(session?.user.emailVerified).toBe(true);
    expect(session?.user.useCase).toBeNull();
    const principal = await sessionPrincipal(
      request("/get-session", undefined, verified.cookie),
      environment(),
      options,
    );
    expect(principal.principal).toEqual({
      id: `dashboard:${session!.user.id}`,
      tenantId: `tenant_${session!.user.id}`,
    });
    const persisted = await db
      .prepare('SELECT ipAddress, userAgent FROM "session" WHERE userId = ?')
      .bind(session!.user.id)
      .first();
    expect(persisted).toEqual({ ipAddress: null, userAgent: null });
    const message = await sendLink(verified.email);
    const signin = await handleAuth(
      new Request(message!.url, {
        headers: {
          "user-agent": "Synthetic privacy assertion",
          "cf-connecting-ip": "203.0.113.10",
        },
      }),
      environment(),
      options,
    );
    const privateSessions = await db
      .prepare('SELECT ipAddress, userAgent FROM "session" WHERE userId = ?')
      .bind(session!.user.id)
      .all();
    expect(
      privateSessions.results.every((row) => row.ipAddress === null && row.userAgent === null),
    ).toBe(true);
    expect(signin.headers.get("set-cookie")).toContain("HttpOnly");
    expect(signin.headers.get("set-cookie")).toContain("Secure");
    expect(signin.headers.get("set-cookie")).toContain("SameSite=Lax");
    expect((await call("/sign-out", {}, verified.cookie)).status).toBe(200);
    expect(
      await auth.api.getSession({ headers: new Headers({ cookie: verified.cookie }) }),
    ).toBeNull();
    await expect(
      sessionPrincipal(
        request("/get-session", undefined, undefined, {
          authorization: "Bearer cck_" + "a".repeat(43),
        }),
        environment(),
        options,
      ),
    ).rejects.toMatchObject({ status: 401 });
  }, 20000);

  it("rejects untrusted origins, invalid configuration and cross-origin magic-link callbacks", async () => {
    await expect(
      handleAuth(
        request("/sign-out", {}, undefined, { origin: "https://evil.test" }),
        environment(),
        options,
      ),
    ).rejects.toMatchObject({ status: 403 });
    expect(() =>
      accountOrigin({ ...environment(), BETTER_AUTH_URL: "http://evil.test" }),
    ).toThrow();
    expect(() => createAuth({ ...environment(), BETTER_AUTH_SECRET: "short" }, options)).toThrow();
    expect(() => createAuth(environment())).toThrow();
    const verified = await verifiedUser();
    const response = await call("/sign-in/magic-link", {
      email: verified.email,
      callbackURL: "https://evil.test/steal",
    });
    expect(response.status).toBe(403);
    const tampered = new URL(verified.message.url);
    tampered.searchParams.set("callbackURL", "https://evil.test/steal");
    const verification = await handleAuth(new Request(tampered), environment(), options);
    expect(verification.status).toBe(403);
    expect(cookies(verification)).toBe("");
  });
});
