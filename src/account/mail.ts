import type { Env } from "../env.js";
import { ServiceError } from "../contracts/errors.js";

export type AccountMail = { to: string; url: string; kind: "signin" };
export type AccountMailer = (mail: AccountMail) => Promise<void>;

export function accountMailer(env: Env, send: typeof fetch = fetch): AccountMailer {
  if (!env.RESEND_API_KEY || !env.AUTH_EMAIL_FROM)
    throw new ServiceError(
      503,
      "account_unavailable",
      "Account email is temporarily unavailable.",
      true,
    );
  return async ({ to, url }) => {
    let response: Response;
    try {
      response = await send("https://api.resend.com/emails", {
        method: "POST",
        redirect: "manual",
        signal: AbortSignal.timeout(10000),
        headers: {
          authorization: `Bearer ${env.RESEND_API_KEY}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          from: env.AUTH_EMAIL_FROM,
          to: [to],
          subject: "Sign in to Countercheck",
          text: `Sign in to Countercheck using this link:\n\n${url}\n\nThis link expires in five minutes and can be used once. If you did not request this, ignore this email.`,
        }),
      });
      await response.body?.cancel();
    } catch {
      throw new ServiceError(
        503,
        "account_email_unavailable",
        "Account email is temporarily unavailable.",
        true,
      );
    }
    if (!response.ok)
      throw new ServiceError(
        503,
        "account_email_unavailable",
        "Account email is temporarily unavailable.",
        true,
      );
  };
}
