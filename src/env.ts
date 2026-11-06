import type { D1Database } from "@cloudflare/workers-types";
import type { AdmissionNamespace } from "./control/admission.js";

export interface RateLimitBinding {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface Env {
  DB: D1Database;
  RATE_LIMITER: RateLimitBinding;
  INGRESS_LIMITER: RateLimitBinding;
  AI?: { run(model: string, input: unknown): Promise<unknown> };
  TYPESAFE_API_KEY?: string;
  OPENAI_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
  ADMISSION?: AdmissionNamespace;
  ASSETS?: { fetch(request: Request): Promise<Response> };
  AUTH_LIMITER?: RateLimitBinding;
  BETTER_AUTH_SECRET?: string;
  BETTER_AUTH_URL?: string;
  RESEND_API_KEY?: string;
  AUTH_EMAIL_FROM?: string;
  ADMIN_USER_IDS?: string;
  ADMIN_EMAILS?: string;
  CANARY_API_KEY?: string;
  ALERT_WEBHOOK_URL?: string;
}

export interface BackgroundTasks {
  waitUntil(promise: Promise<unknown>): void;
}
