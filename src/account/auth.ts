import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { magicLink } from "better-auth/plugins";
import { z } from "zod";
import type { Env } from "../env.js";
import { ServiceError } from "../contracts/errors.js";
import { readJsonBody } from "../http/body.js";
import { accountMailer, type AccountMailer } from "./mail.js";

export const useCaseSchema = z.enum(["contracts", "finance", "policy", "other"]);
export type AccountOptions = { mailer?: AccountMailer };

const normalizedEmail = (email: string) => email.trim().toLowerCase();
function bootstrapEmail(email: string, env: Env): boolean {
  return (env.ADMIN_EMAILS ?? "")
    .split(",")
    .some((allowed) => !!allowed.trim() && normalizedEmail(allowed) === normalizedEmail(email));
}
export async function inviteAccount(env: Env, input: { email: string; invitedBy: string }) {
  const parsed = z
    .strictObject({ email: z.email().max(254), invitedBy: z.string().min(1).max(128) })
    .safeParse({ ...input, email: normalizedEmail(input.email) });
  if (!parsed.success)
    throw new ServiceError(422, "invalid_invitation", "Provide a valid account email.");
  const createdAt = new Date().toISOString(),
    expiresAt = new Date(Date.parse(createdAt) + 7 * 86400000).toISOString();
  const primary = env.DB.withSession("first-primary");
  await primary.batch([
    primary
      .prepare(
        "INSERT INTO account_invitations(email,created_at,expires_at,invited_by) VALUES(?,?,?,?) ON CONFLICT(email) DO UPDATE SET created_at=excluded.created_at,expires_at=excluded.expires_at,invited_by=excluded.invited_by",
      )
      .bind(parsed.data.email, createdAt, expiresAt, parsed.data.invitedBy),
    primary
      .prepare("UPDATE access_requests SET reviewed_at = ?, dismissed_at = NULL WHERE email = ?")
      .bind(createdAt, parsed.data.email),
  ]);
  return { email: parsed.data.email, createdAt, expiresAt };
}

async function maySignUp(email: string, env: Env): Promise<boolean> {
  if (bootstrapEmail(email, env)) return true;
  return !!(await env.DB.withSession("first-primary")
    .prepare("SELECT email FROM account_invitations WHERE email = ? AND expires_at > ?")
    .bind(normalizedEmail(email), new Date().toISOString())
    .first());
}

// Accepted accounts remain eligible even after the invitation's original expiry.
export async function maySignIn(email: string, env: Env): Promise<boolean> {
  if (bootstrapEmail(email, env)) return true;
  return !!(await env.DB.withSession("first-primary")
    .prepare(
      "SELECT email FROM account_invitations WHERE email = ? AND (accepted_at IS NOT NULL OR expires_at > ?)",
    )
    .bind(normalizedEmail(email), new Date().toISOString())
    .first());
}

async function requireSignInAccess(email: string, env: Env): Promise<void> {
  if (!(await maySignIn(email, env)))
    throw new APIError("FORBIDDEN", {
      code: "ACCESS_REQUIRED",
      message: "Request access before signing in to Countercheck.",
    });
}

export async function acceptAccountInvitation(
  user: { email: string; emailVerified: boolean },
  env: Env,
): Promise<void> {
  if (!user.emailVerified)
    throw new ServiceError(
      403,
      "email_verification_required",
      "Verify your email before using Countercheck.",
    );
  const now = new Date().toISOString();
  if (bootstrapEmail(user.email, env)) {
    // Account eligibility survives a later change to the administrator allowlist.
    await env.DB.withSession("first-primary")
      .prepare(
        "INSERT INTO account_invitations(email,created_at,expires_at,invited_by,accepted_at) VALUES(?,?,?,?,?) ON CONFLICT(email) DO UPDATE SET accepted_at=COALESCE(account_invitations.accepted_at,excluded.accepted_at)",
      )
      .bind(
        normalizedEmail(user.email),
        now,
        new Date(Date.parse(now) + 7 * 86400000).toISOString(),
        "admin-bootstrap",
        now,
      )
      .run();
    return;
  }
  const existing = await env.DB.withSession("first-primary")
    .prepare("SELECT accepted_at FROM account_invitations WHERE email = ?")
    .bind(normalizedEmail(user.email))
    .first<{ accepted_at: string | null }>();
  if (existing?.accepted_at) return;
  const accepted = await env.DB.withSession("first-primary")
    .prepare(
      "UPDATE account_invitations SET accepted_at = COALESCE(accepted_at, ?) WHERE email = ? AND (accepted_at IS NOT NULL OR expires_at > ?) RETURNING email",
    )
    .bind(now, normalizedEmail(user.email), now)
    .first();
  if (!accepted)
    throw new ServiceError(
      403,
      "invitation_required",
      "An active invitation is required to join this pilot.",
    );
}

export function accountOrigin(env: Env): string {
  try {
    const url = new URL(env.BETTER_AUTH_URL ?? "");
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (
      (url.protocol !== "https:" && !(local && url.protocol === "http:")) ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    )
      throw new Error();
    return url.origin;
  } catch {
    throw new ServiceError(
      503,
      "account_unavailable",
      "Accounts are temporarily unavailable.",
      true,
    );
  }
}

export function assertAccountOrigin(request: Request, env: Env): void {
  if (request.headers.get("origin") !== accountOrigin(env))
    throw new ServiceError(
      403,
      "invalid_origin",
      "Use the Countercheck dashboard for this action.",
    );
}

export function createAuth(env: Env, options: AccountOptions = {}) {
  const origin = accountOrigin(env);
  if (!env.BETTER_AUTH_SECRET || env.BETTER_AUTH_SECRET.length < 32)
    throw new ServiceError(
      503,
      "account_unavailable",
      "Accounts are temporarily unavailable.",
      true,
    );
  const mailer = options.mailer ?? accountMailer(env);
  const primary = env.DB.withSession("first-primary");
  // Better Auth's native D1 detection needs exec; its request queries use primary prepare/batch.
  const database = {
    prepare: primary.prepare.bind(primary),
    batch: primary.batch.bind(primary),
    exec: env.DB.exec.bind(env.DB),
  };
  return betterAuth({
    appName: "Countercheck",
    baseURL: origin,
    basePath: "/api/auth",
    secret: env.BETTER_AUTH_SECRET,
    database,
    trustedOrigins: [origin],
    emailAndPassword: { enabled: false },
    disabledPaths: [
      "/sign-up/email",
      "/sign-in/email",
      "/request-password-reset",
      "/reset-password",
      "/change-password",
      "/set-password",
      "/verify-password",
      "/send-verification-email",
      "/verify-email",
    ],
    plugins: [
      magicLink({
        expiresIn: 300,
        storeToken: "hashed",
        sendMagicLink: async ({ email, url }) => {
          // Recheck eligibility if the invitation changed after the request hook.
          await requireSignInAccess(email, env);
          await mailer({ to: email, url, kind: "signin" });
        },
      }),
    ],
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        // disabledPaths matches literal paths; the legacy callback has a dynamic token segment.
        if (ctx.path.startsWith("/reset-password/")) throw new APIError("NOT_FOUND");
        if (ctx.path !== "/sign-in/magic-link" && ctx.path !== "/magic-link/verify") return;
        if (ctx.path === "/sign-in/magic-link") {
          const email = z
            .email()
            .max(254)
            .safeParse(
              typeof ctx.body?.email === "string"
                ? normalizedEmail(ctx.body.email)
                : ctx.body?.email,
            );
          if (!email.success)
            throw new APIError("BAD_REQUEST", {
              code: "INVALID_EMAIL",
              message: "Provide a valid email address.",
            });
          ctx.body.email = email.data;
        }
        const callbacks = ctx.path === "/magic-link/verify" ? ctx.query : ctx.body;
        for (const field of ["callbackURL", "newUserCallbackURL", "errorCallbackURL"]) {
          const value = callbacks?.[field];
          if (typeof value !== "string") continue;
          let valid = false;
          try {
            const url = new URL(value, origin);
            valid = url.origin === origin && !url.username && !url.password;
          } catch {
            // The endpoint reports invalid callbacks without issuing a link.
          }
          if (!valid)
            throw new APIError("FORBIDDEN", {
              code: "INVALID_CALLBACK_URL",
              message: "Use the Countercheck dashboard for sign-in.",
            });
        }
        // Reject ineligible emails before the plugin can create verification tokens.
        if (ctx.path === "/sign-in/magic-link") await requireSignInAccess(ctx.body.email, env);
      }),
    },
    user: {
      additionalFields: {
        useCase: { type: "string", required: false, validator: { input: useCaseSchema } },
      },
    },
    session: { expiresIn: 7 * 86400, updateAge: 86400, cookieCache: { enabled: false } },
    rateLimit: { enabled: true, storage: "database", window: 60, max: 20 },
    advanced: {
      ipAddress: { disableIpTracking: true },
      // Better Auth prepends __Secure- when this flag is true. Name our HTTPS cookies
      // explicitly so browsers enforce __Host- isolation from parent-domain cookies.
      cookiePrefix: origin.startsWith("https:") ? "__Host-countercheck" : "countercheck",
      useSecureCookies: false,
      defaultCookieAttributes: {
        path: "/",
        httpOnly: true,
        secure: origin.startsWith("https:"),
        sameSite: "lax",
      },
      database: { validateSchema: false },
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            if (!(await maySignUp(user.email, env)))
              // Only mailbox verification may create an invited account.
              throw new APIError("UNPROCESSABLE_ENTITY", {
                code: "INVITATION_REQUIRED",
                message: "An active invitation is required to sign up.",
              });
            return { data: user };
          },
        },
      },
      session: {
        create: {
          before: async (session) => {
            // Recheck at consumption time, including existing users, before any cookie is issued.
            const user = await primary
              .prepare('SELECT email, emailVerified FROM "user" WHERE id = ?')
              .bind(session.userId)
              .first<{ email: string; emailVerified: number }>();
            if (!user?.emailVerified)
              throw new APIError("FORBIDDEN", {
                code: "EMAIL_VERIFICATION_REQUIRED",
                message: "A mailbox sign-in link is required.",
              });
            try {
              await acceptAccountInvitation({ email: user.email, emailVerified: true }, env);
            } catch (error) {
              if (!(error instanceof ServiceError) || error.code !== "invitation_required")
                throw error;
              throw new APIError("FORBIDDEN", {
                code: "INVITATION_REQUIRED",
                message: "An active invitation is required to sign in.",
              });
            }
            return { data: { ...session, ipAddress: null, userAgent: null } };
          },
        },
      },
    },
    logger: { disabled: true },
    telemetry: { enabled: false },
  });
}

export async function handleAuth(
  request: Request,
  env: Env,
  options: AccountOptions = {},
): Promise<Response> {
  try {
    if (!env.AUTH_LIMITER) throw new Error("Account limiter unavailable");
    const limited = await env.AUTH_LIMITER.limit({
      key: request.headers.get("cf-connecting-ip") ?? "unattributed",
    });
    if (!limited.success)
      throw new ServiceError(429, "rate_limited", "Account request rate limit exceeded.", true, 60);
  } catch (error) {
    if (error instanceof ServiceError) throw error;
    throw new ServiceError(
      503,
      "account_unavailable",
      "Accounts are temporarily unavailable.",
      true,
    );
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    assertAccountOrigin(request, env);
    const body = await readJsonBody(request);
    const headers = new Headers(request.headers);
    headers.delete("content-length");
    request = new Request(request.url, {
      method: request.method,
      headers,
      body: JSON.stringify(body),
      signal: request.signal,
    });
  }
  try {
    const response = await createAuth(env, options).handler(request);
    if (response.status >= 500) throw new Error("Account backend unavailable");
    return response;
  } catch {
    throw new ServiceError(
      503,
      "account_unavailable",
      "Accounts are temporarily unavailable.",
      true,
    );
  }
}

export async function accountSession(request: Request, env: Env, options: AccountOptions = {}) {
  if (request.headers.has("authorization"))
    throw new ServiceError(401, "session_required", "Sign in to the Countercheck dashboard.");
  let session;
  try {
    session = await createAuth(env, options).api.getSession({ headers: request.headers });
  } catch {
    throw new ServiceError(
      503,
      "account_unavailable",
      "Accounts are temporarily unavailable.",
      true,
    );
  }
  if (!session)
    throw new ServiceError(401, "session_required", "Sign in to the Countercheck dashboard.");
  return session;
}

export async function sessionPrincipal(request: Request, env: Env, options: AccountOptions = {}) {
  const session = await accountSession(request, env, options);
  if (!session.user.emailVerified)
    throw new ServiceError(
      403,
      "email_verification_required",
      "Verify your email before using Countercheck.",
    );
  await acceptAccountInvitation(session.user, env);
  return {
    principal: { id: `dashboard:${session.user.id}`, tenantId: `tenant_${session.user.id}` },
    user: session.user,
  };
}
