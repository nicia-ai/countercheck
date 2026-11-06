import { z } from "zod";
import type { Env } from "../env.js";
import { ServiceError } from "../contracts/errors.js";
import { maySignIn } from "./auth.js";

const requestSchema = z.strictObject({
  email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
  note: z.string().trim().max(2000).optional(),
});

/** Intake is unverified contact information, never an account or access grant. */
export async function requestAccess(env: Env, input: unknown): Promise<void> {
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success)
    throw new ServiceError(
      422,
      "invalid_access_request",
      "Provide a valid email and a note of at most 2,000 characters.",
    );
  const { email, note } = parsed.data;
  if (await maySignIn(email, env)) return;
  const db = env.DB.withSession("first-primary");
  const now = new Date();
  const results = await db.batch([
    db
      .prepare("DELETE FROM access_requests WHERE requested_at < ?")
      .bind(new Date(now.getTime() - 30 * 86400000).toISOString()),
    db
      .prepare(
        "INSERT INTO access_requests(email,note,requested_at) SELECT ?,?,? WHERE ((SELECT COUNT(*) FROM access_requests WHERE reviewed_at IS NULL AND dismissed_at IS NULL) < 1000 OR EXISTS (SELECT 1 FROM access_requests WHERE email = ? AND reviewed_at IS NULL)) AND NOT EXISTS (SELECT 1 FROM account_invitations WHERE email = ? AND (accepted_at IS NOT NULL OR expires_at > ?)) ON CONFLICT(email) DO UPDATE SET note=excluded.note,requested_at=excluded.requested_at,reviewed_at=NULL WHERE access_requests.reviewed_at IS NOT NULL AND access_requests.dismissed_at IS NULL RETURNING email",
      )
      .bind(email, note || null, now.toISOString(), email, email, now.toISOString()),
  ]);
  if (results[1]!.results.length || (await maySignIn(email, env))) return;
  // Repeated submissions preserve the original request and note.
  const existing = await db
    .prepare("SELECT reviewed_at,dismissed_at FROM access_requests WHERE email = ?")
    .bind(email)
    .first<{ reviewed_at: string | null; dismissed_at: string | null }>();
  if (existing && (existing.reviewed_at === null || existing.dismissed_at !== null)) return;
  throw new ServiceError(
    503,
    "access_requests_full",
    "Access requests are temporarily unavailable. Try again later.",
    true,
  );
}

export async function listAccessRequests(env: Env) {
  const rows = await env.DB.withSession("first-primary")
    .prepare(
      "SELECT email,note,requested_at AS requestedAt FROM access_requests WHERE reviewed_at IS NULL AND dismissed_at IS NULL AND requested_at >= ? ORDER BY requested_at,email LIMIT 1000",
    )
    .bind(new Date(Date.now() - 30 * 86400000).toISOString())
    .all<{ email: string; note: string | null; requestedAt: string }>();
  return rows.results;
}

export async function dismissAccessRequest(env: Env, input: unknown): Promise<void> {
  const parsed = requestSchema.pick({ email: true }).safeParse(input);
  if (!parsed.success)
    throw new ServiceError(422, "invalid_access_request", "Provide a valid email address.");
  await env.DB.withSession("first-primary")
    .prepare("UPDATE access_requests SET dismissed_at = ? WHERE email = ? AND reviewed_at IS NULL")
    .bind(new Date().toISOString(), parsed.data.email)
    .run();
}

export async function listInvitations(env: Env) {
  const rows = await env.DB.withSession("first-primary")
    .prepare(
      "SELECT email,created_at AS createdAt,expires_at AS expiresAt,accepted_at AS acceptedAt FROM account_invitations ORDER BY created_at DESC,email LIMIT 1000",
    )
    .all<{ email: string; createdAt: string; expiresAt: string; acceptedAt: string | null }>();
  return rows.results;
}
