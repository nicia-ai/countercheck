import { readFile } from "node:fs/promises";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, type Metric } from "../src/http/app.js";
import { inviteAccount } from "../src/account/auth.js";
import type { AccountMail } from "../src/account/mail.js";
import type { Env } from "../src/env.js";
import type { DecisionProvider } from "../src/providers/types.js";
import { pruneUsage } from "../src/control/usage.js";
import { testAdmission } from "./helpers/admission.js";

const origin = "https://access-request.test";
const mail: AccountMail[] = [];
const metrics: Metric[] = [];
const admission = testAdmission();
const provider: DecisionProvider = {
  id: "typesafe",
  model: "synthetic-test-only",
  classify: vi.fn(async () => {
    throw new Error("No inference is expected in access-request tests");
  }),
};
let mf: Miniflare, env: Env;
const limiter = vi.fn(async () => ({ success: true }));
const app = createApp({
  account: {
    mailer: async (message) => {
      mail.push(message);
    },
  },
  provider,
  admission: admission.service,
  metric: (metric) => {
    metrics.push(metric);
  },
  background: {
    waitUntil: () => {
      throw new Error("No background inference work expected");
    },
  },
});
const email = () => `request-${crypto.randomUUID()}@example.test`;
const cookies = (response: Response) =>
  response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
function http(path: string, body?: unknown, headers: Record<string, string> = {}, target = env) {
  return app.request(
    origin + path,
    {
      method: body === undefined ? "GET" : "POST",
      headers: {
        origin,
        "cf-connecting-ip": "203.0.113.7",
        ...(body !== undefined && { "content-type": "application/json" }),
        ...headers,
      },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    },
    target,
  );
}
async function signedIn(admin = false) {
  const address = email();
  const target = admin ? { ...env, ADMIN_EMAILS: address } : env;
  if (!admin) await inviteAccount(target, { email: address, invitedBy: "synthetic-test-admin" });
  expect(
    (
      await http(
        "/api/auth/sign-in/magic-link",
        { email: address, callbackURL: "/dashboard" },
        {},
        target,
      )
    ).status,
  ).toBe(200);
  const link = [...mail].reverse().find((message) => message.to === address)!;
  expect(link).toBeTruthy();
  const verification = await app.request(link.url, {}, target);
  expect(verification.status).toBe(302);
  return { env: target, cookie: cookies(verification), email: address };
}
type QueueRow = { email: string; note: string | null; requestedAt: string };
async function queue(admin: Awaited<ReturnType<typeof signedIn>>) {
  const result = await http(
    "/dashboard/api/admin/access-requests",
    undefined,
    { cookie: admin.cookie },
    admin.env,
  );
  expect(result.status).toBe(200);
  expect(result.headers.get("cache-control")).toBe("no-store");
  return ((await result.json()) as { requests: QueueRow[] }).requests;
}
async function countAuthority() {
  const tables = ["user", "session", "verification", "account_invitations", "api_keys"];
  return Promise.all(
    tables.map(
      async (table) =>
        (await env.DB.prepare(`SELECT COUNT(*) AS count FROM "${table}"`).first<{
          count: number;
        }>())!.count,
    ),
  );
}
async function fillPendingQueue() {
  // Seed real D1 with one statement, avoiding 1,000 fixture statements across workerd IPC.
  await env.DB.prepare(
    `WITH RECURSIVE slots(n) AS (VALUES(0) UNION ALL SELECT n + 1 FROM slots WHERE n < 999)
     INSERT INTO access_requests(email,note,requested_at)
     SELECT 'cap-' || n || '@example.test', 'Request ' || n, ? FROM slots`,
  )
    .bind(new Date().toISOString())
    .run();
}

beforeAll(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      name: "access-request-d1-test",
      modules: true,
      script: "export default {fetch(){return new Response('ok')}}",
      compatibilityDate: "2026-11-04",
      d1Databases: { DB: "access-request-d1-test" },
    }),
  );
  const db = await mf.getD1Database("DB");
  for (const name of [
    "0001_control.sql",
    "0002_accounts.sql",
    "0003_observability.sql",
    "0004_invitations.sql",
    "0005_access_requests.sql",
  ]) {
    const sql = await readFile(new URL(`../migrations/${name}`, import.meta.url), "utf8");
    await db.batch(
      sql
        .split(";")
        .filter((statement) => statement.trim())
        .map((statement) => db.prepare(statement)),
    );
  }
  env = {
    DB: db,
    BETTER_AUTH_URL: origin,
    BETTER_AUTH_SECRET: "synthetic-test-secret-with-at-least-32-random-characters",
    AUTH_LIMITER: { limit: limiter },
    RATE_LIMITER: { limit: async () => ({ success: true }) },
    INGRESS_LIMITER: { limit: async () => ({ success: true }) },
  } as unknown as Env;
}, 20000);
beforeEach(async () => {
  limiter.mockReset().mockResolvedValue({ success: true });
  mail.length = 0;
  metrics.length = 0;
  vi.mocked(provider.classify).mockClear();
  await env.DB.prepare("DELETE FROM access_requests").run();
});
afterAll(async () => {
  await mf?.dispose();
});

describe("unverified access requests over public HTTP and real D1", () => {
  it("records a normalized request without creating an account, session, token, invitation or API key", async () => {
    const address = email();
    const before = await countAuthority();
    const requested = await http("/dashboard/api/access-requests", {
      email: `  ${address.toUpperCase()}  `,
      note: "Reviewing contract clauses.",
    });
    expect(requested.status).toBe(202);
    expect(await requested.json()).toEqual({ requested: true });
    expect(cookies(requested)).toBe("");
    expect(await countAuthority()).toEqual(before);
    const login = await http("/api/auth/sign-in/magic-link", {
      email: address,
      callbackURL: "/dashboard",
    });
    expect(login.status).toBe(403);
    expect(await login.json()).toMatchObject({ code: "ACCESS_REQUIRED" });
    expect(cookies(login)).toBe("");
    expect(await countAuthority()).toEqual(before);
    expect(mail).toEqual([]);
    expect((await http("/dashboard/api/keys", {})).status).toBe(401);
    expect(
      (
        await http("/dashboard/api/check", {
          claim: { id: "c", text: "A" },
          against: [{ id: "e", text: "B" }],
        })
      ).status,
    ).toBe(401);
    expect(provider.classify).not.toHaveBeenCalled();
    expect(admission.service.admit).not.toHaveBeenCalled();
  });

  it("keeps the first pending note/timestamp immutable across normalized concurrent duplicates", async () => {
    const admin = await signedIn(true),
      address = email();
    const note = "<img src=x onerror=alert(1)> Untrusted contact note.";
    expect((await http("/dashboard/api/access-requests", { email: address, note })).status).toBe(
      202,
    );
    const initial = (await queue(admin)).find((row) => row.email === address)!;
    expect(initial.note).toBe(note);
    const duplicates = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        http("/dashboard/api/access-requests", {
          email: address.toUpperCase(),
          note: `Overwrite attempt ${index}`,
        }),
      ),
    );
    expect(duplicates.every((response) => response.status === 202)).toBe(true);
    expect((await queue(admin)).filter((row) => row.email === address)).toEqual([initial]);
    const telemetry = JSON.stringify(metrics);
    for (const sensitive of [address, note, admin.email, admin.cookie, "Overwrite attempt"])
      expect(telemetry).not.toContain(sensitive);
  });

  it("validates bounded optional notes, strict fields, original origin and native limiter outcomes", async () => {
    expect((await http("/dashboard/api/access-requests", { email: email() })).status).toBe(202);
    expect(
      (await http("/dashboard/api/access-requests", { email: email(), note: "x".repeat(2000) }))
        .status,
    ).toBe(202);
    for (const body of [
      { email: "invalid" },
      { email: email(), note: "x".repeat(2001) },
      { email: email(), note: 1 },
      { email: email(), role: "admin" },
    ])
      expect((await http("/dashboard/api/access-requests", body)).status).toBe(422);
    expect(
      (
        await http(
          "/dashboard/api/access-requests",
          { email: email() },
          { origin: "https://other.example" },
        )
      ).status,
    ).toBe(403);
    expect(
      (await http("/dashboard/api/access-requests", { email: email(), note: "x".repeat(65536) }))
        .status,
    ).toBe(413);
    limiter.mockResolvedValueOnce({ success: false });
    expect((await http("/dashboard/api/access-requests", { email: email() })).status).toBe(429);
    limiter.mockRejectedValueOnce(new Error("private limiter details"));
    const unavailable = await http("/dashboard/api/access-requests", { email: email() });
    expect(unavailable.status).toBe(503);
    expect(await unavailable.text()).not.toContain("private limiter details");
    expect(limiter).toHaveBeenCalledWith({ key: "dashboard:203.0.113.7" });
    expect(provider.classify).not.toHaveBeenCalled();
    expect(mail).toEqual([]);
  });

  it("requires a current verified administrator session to view requests or invitations", async () => {
    const admin = await signedIn(true),
      ordinary = await signedIn(false);
    for (const path of ["access-requests", "invitations"]) {
      expect((await http(`/dashboard/api/admin/${path}`)).status).toBe(401);
      expect(
        (
          await http(
            `/dashboard/api/admin/${path}`,
            undefined,
            { cookie: ordinary.cookie },
            admin.env,
          )
        ).status,
      ).toBe(403);
      expect(
        (
          await http(
            `/dashboard/api/admin/${path}`,
            undefined,
            { authorization: `Bearer cck_${"x".repeat(43)}` },
            admin.env,
          )
        ).status,
      ).toBe(401);
      expect(
        (await http(`/dashboard/api/admin/${path}`, undefined, { cookie: admin.cookie }, admin.env))
          .status,
      ).toBe(200);
      expect(
        (await http(`/dashboard/api/admin/${path}`, undefined, { cookie: admin.cookie }, env))
          .status,
      ).toBe(403);
    }
  });

  it("manual approval grants only a seven-day invitation, atomically reviews the request, and sends no email", async () => {
    const admin = await signedIn(true),
      address = email();
    await http("/dashboard/api/access-requests", { email: address, note: "Initial request" });
    const before = mail.length;
    const grant = await http(
      "/dashboard/api/admin/invitations",
      { email: address },
      { cookie: admin.cookie },
      admin.env,
    );
    expect(grant.status).toBe(201);
    expect(await grant.json()).toMatchObject({ invited: true });
    expect(mail).toHaveLength(before);
    expect((await queue(admin)).some((row) => row.email === address)).toBe(false);
    const response = await http(
      "/dashboard/api/admin/invitations",
      undefined,
      { cookie: admin.cookie },
      admin.env,
    );
    const invitations = (
      (await response.json()) as {
        invitations: {
          email: string;
          createdAt: string;
          expiresAt: string;
          acceptedAt: string | null;
        }[];
      }
    ).invitations;
    const invitation = invitations.find((row) => row.email === address)!;
    expect(invitation.acceptedAt).toBeNull();
    expect(Date.parse(invitation.expiresAt) - Date.parse(invitation.createdAt)).toBe(7 * 86400000);
    expect(
      await env.DB.prepare('SELECT id FROM "user" WHERE email = ?').bind(address).first(),
    ).toBeNull();
    expect(
      (await http("/dashboard/api/access-requests", { email: address, note: "Already allowed" }))
        .status,
    ).toBe(202);
    expect((await queue(admin)).some((row) => row.email === address)).toBe(false);
    expect(mail).toHaveLength(before);
  });

  it("reopens an expired unaccepted approval with fresh context, then preserves pending duplicates", async () => {
    const admin = await signedIn(true),
      address = email();
    await http("/dashboard/api/access-requests", { email: address, note: "Original request" });
    expect(
      (
        await http(
          "/dashboard/api/admin/invitations",
          { email: address },
          { cookie: admin.cookie },
          admin.env,
        )
      ).status,
    ).toBe(201);
    await env.DB.prepare("UPDATE account_invitations SET expires_at = ? WHERE email = ?")
      .bind("2000-01-01T00:00:00.000Z", address)
      .run();
    expect(
      (
        await http("/dashboard/api/access-requests", {
          email: address.toUpperCase(),
          note: "Fresh request after expiry",
        })
      ).status,
    ).toBe(202);
    const reopened = (await queue(admin)).find((row) => row.email === address)!;
    expect(reopened.note).toBe("Fresh request after expiry");
    expect(
      (
        await http("/dashboard/api/access-requests", {
          email: address,
          note: "Do not overwrite pending",
        })
      ).status,
    ).toBe(202);
    expect((await queue(admin)).find((row) => row.email === address)).toEqual(reopened);
    const before = mail.length;
    expect(
      (await http("/api/auth/sign-in/magic-link", { email: address, callbackURL: "/dashboard" }))
        .status,
    ).toBe(403);
    expect(mail).toHaveLength(before);
  });

  it("bounds pending requests and frees capacity when an administrator dismisses one", async () => {
    const admin = await signedIn(true);
    await fillPendingQueue();
    expect(
      (
        await http("/dashboard/api/access-requests", {
          email: "cap-0@example.test",
          note: "Unchanged",
        })
      ).status,
    ).toBe(202);
    const overflow = await http("/dashboard/api/access-requests", { email: email() });
    expect(overflow.status).toBe(503);
    expect(await overflow.json()).toMatchObject({ error: { code: "access_requests_full" } });
    expect(await queue(admin)).toHaveLength(1000);
    expect((await queue(admin)).find((row) => row.email === "cap-0@example.test")!.note).toBe(
      "Request 0",
    );
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM access_requests").first()).toEqual({
      count: 1000,
    });
    const authority = await countAuthority(),
      mailCount = mail.length;
    const dismissed = await http(
      "/dashboard/api/admin/access-requests/dismiss",
      { email: "cap-0@example.test" },
      { cookie: admin.cookie },
      admin.env,
    );
    expect(dismissed.status).toBe(200);
    expect(await dismissed.json()).toEqual({ dismissed: true });
    expect(await queue(admin)).toHaveLength(999);
    expect(
      (
        await http("/dashboard/api/access-requests", {
          email: "cap-0@example.test",
          note: "Cannot reopen dismissed request",
        })
      ).status,
    ).toBe(202);
    expect(await queue(admin)).toHaveLength(999);
    const fresh = email();
    expect(
      (
        await http("/dashboard/api/access-requests", {
          email: fresh,
          note: "New intake after dismissal",
        })
      ).status,
    ).toBe(202);
    expect(await queue(admin)).toHaveLength(1000);
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM access_requests").first()).toEqual({
      count: 1001,
    });
    expect(await countAuthority()).toEqual(authority);
    expect(mail).toHaveLength(mailCount);
  });

  it("requires a current verified administrator and exact origin to dismiss, without granting access or sending email", async () => {
    const admin = await signedIn(true),
      ordinary = await signedIn(false),
      address = email();
    await http("/dashboard/api/access-requests", {
      email: address,
      note: "First private contact note",
    });
    const authority = await countAuthority(),
      mailCount = mail.length;
    const dismiss = (headers: Record<string, string>, target = admin.env) =>
      http("/dashboard/api/admin/access-requests/dismiss", { email: address }, headers, target);
    expect((await dismiss({})).status).toBe(401);
    expect((await dismiss({ cookie: ordinary.cookie })).status).toBe(403);
    expect((await dismiss({ cookie: admin.cookie, origin: "https://other.example" })).status).toBe(
      403,
    );
    expect(
      (await dismiss({ cookie: admin.cookie, authorization: `Bearer cck_${"x".repeat(43)}` }))
        .status,
    ).toBe(401);
    expect((await dismiss({ cookie: admin.cookie }, env)).status).toBe(403);
    await env.DB.prepare('UPDATE "user" SET emailVerified = 0 WHERE email = ?')
      .bind(admin.email)
      .run();
    expect((await dismiss({ cookie: admin.cookie })).status).toBe(403);
    await env.DB.prepare('UPDATE "user" SET emailVerified = 1 WHERE email = ?')
      .bind(admin.email)
      .run();
    expect((await queue(admin)).some((row) => row.email === address)).toBe(true);
    expect((await dismiss({ cookie: admin.cookie })).status).toBe(200);
    const stored = await env.DB.prepare(
      "SELECT note,requested_at,reviewed_at,dismissed_at FROM access_requests WHERE email = ?",
    )
      .bind(address)
      .first();
    expect(stored).toMatchObject({
      note: "First private contact note",
      reviewed_at: null,
      dismissed_at: expect.any(String),
    });
    expect(
      (
        await http("/dashboard/api/access-requests", {
          email: address.toUpperCase(),
          note: "Ignored replacement",
        })
      ).status,
    ).toBe(202);
    expect(
      await env.DB.prepare(
        "SELECT note,requested_at,reviewed_at,dismissed_at FROM access_requests WHERE email = ?",
      )
        .bind(address)
        .first(),
    ).toEqual(stored);
    expect((await queue(admin)).some((row) => row.email === address)).toBe(false);
    expect(
      (await http("/api/auth/sign-in/magic-link", { email: address, callbackURL: "/dashboard" }))
        .status,
    ).toBe(403);
    expect(await countAuthority()).toEqual(authority);
    expect(mail).toHaveLength(mailCount);
    expect(
      (
        await http(
          "/dashboard/api/admin/invitations",
          { email: address },
          { cookie: admin.cookie },
          admin.env,
        )
      ).status,
    ).toBe(201);
    expect(
      await env.DB.prepare("SELECT reviewed_at,dismissed_at FROM access_requests WHERE email = ?")
        .bind(address)
        .first(),
    ).toMatchObject({ reviewed_at: expect.any(String), dismissed_at: null });
    expect(mail).toHaveLength(mailCount);
  });

  it("does not reopen a reviewed expired request beyond the pending cap, but retries after dismissal can reopen it", async () => {
    const admin = await signedIn(true),
      address = email();
    await http("/dashboard/api/access-requests", { email: address, note: "Original request" });
    expect(
      (
        await http(
          "/dashboard/api/admin/invitations",
          { email: address },
          { cookie: admin.cookie },
          admin.env,
        )
      ).status,
    ).toBe(201);
    await env.DB.prepare("UPDATE account_invitations SET expires_at = ? WHERE email = ?")
      .bind("2000-01-01T00:00:00.000Z", address)
      .run();
    await fillPendingQueue();
    expect(
      (await http("/dashboard/api/access-requests", { email: address, note: "Fresh retry" }))
        .status,
    ).toBe(503);
    expect(await queue(admin)).toHaveLength(1000);
    expect(
      await env.DB.prepare("SELECT note,reviewed_at FROM access_requests WHERE email = ?")
        .bind(address)
        .first(),
    ).toMatchObject({ note: "Original request", reviewed_at: expect.any(String) });
    expect(
      (
        await http(
          "/dashboard/api/admin/access-requests/dismiss",
          { email: "cap-0@example.test" },
          { cookie: admin.cookie },
          admin.env,
        )
      ).status,
    ).toBe(200);
    expect(
      (await http("/dashboard/api/access-requests", { email: address, note: "Fresh retry" }))
        .status,
    ).toBe(202);
    const pending = await queue(admin);
    expect(pending).toHaveLength(1000);
    expect(pending.find((row) => row.email === address)?.note).toBe("Fresh retry");
  });

  it("daily retention deletes private contact notes older than thirty days without relying on intake traffic", async () => {
    const now = new Date(),
      cutoff = now.getTime() - 30 * 86400000;
    for (const [address, timestamp] of [
      ["old@example.test", cutoff - 1],
      ["boundary@example.test", cutoff],
      ["new@example.test", cutoff + 1],
    ] as const)
      await env.DB.prepare("INSERT INTO access_requests(email,note,requested_at) VALUES(?,?,?)")
        .bind(address, "Private contact note", new Date(timestamp).toISOString())
        .run();
    await pruneUsage(env, now);
    const retained = await env.DB.prepare("SELECT email FROM access_requests ORDER BY email").all<{
      email: string;
    }>();
    expect(retained.results).toEqual([
      { email: "boundary@example.test" },
      { email: "new@example.test" },
    ]);
  });
});
