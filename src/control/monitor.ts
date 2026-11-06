import type { Env } from "../env.js";
import { checkResponseSchema } from "../contracts/index.js";
import { readProviderJson } from "../providers/transport.js";

type AlertCode = "retention_stale" | "canary_failed" | "elevated_failure_rate";
export type MonitorEvent = {
  outcome:
    | `alert_${AlertCode}`
    | "canary_not_configured"
    | "canary_configuration_invalid"
    | "canary_passed"
    | "canary_failed"
    | "alert_configuration_invalid"
    | "alert_delivery_failed"
    | "monitor_failed";
  failures?: number;
  duration_ms?: number;
};
/** Optional operator-owned synthetic check. It consumes the same quota as any API request. */
export async function runMonitor(
  env: Env,
  send: typeof fetch = fetch,
  emit: (event: MonitorEvent) => void = (e) => console.log(JSON.stringify(e)),
) {
  const log = (event: MonitorEvent) => {
    try {
      emit(event);
    } catch {
      /* Logging cannot change monitor state or expose a logger exception. */
    }
  };
  try {
    await monitor(env, send, log);
  } catch {
    log({ outcome: "monitor_failed" });
    throw new Error("Operational monitoring failed.");
  }
}

async function monitor(env: Env, send: typeof fetch, emit: (event: MonitorEvent) => void) {
  const now = new Date();
  const last = await env.DB.prepare(
    "SELECT value FROM ops_state WHERE name = 'retention_last_success'",
  ).first<{ value: string }>();
  const retention = last ? Date.parse(last.value) : NaN;
  if (
    !Number.isFinite(retention) ||
    retention > now.getTime() + 300000 ||
    now.getTime() - retention > 26 * 3600000
  )
    await alert(env, "retention_stale", send, emit);
  if (!env.CANARY_API_KEY) {
    emit({ outcome: "canary_not_configured" });
  } else await canary(env, now, send, emit);
  const usage = await env.DB.prepare(
    "SELECT SUM(requests) AS requests,SUM(errors) AS errors FROM tenant_daily_usage WHERE day=?",
  )
    .bind(now.toISOString().slice(0, 10))
    .first<{ requests: number | null; errors: number | null }>();
  if ((usage?.requests ?? 0) >= 20 && (usage?.errors ?? 0) / (usage?.requests ?? 1) > 0.02)
    await alert(env, "elevated_failure_rate", send, emit);
}

async function canary(
  env: Env,
  now: Date,
  send: typeof fetch,
  emit: (event: MonitorEvent) => void,
) {
  let origin: string;
  try {
    const url = new URL(env.BETTER_AUTH_URL ?? "");
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    )
      throw Error();
    origin = url.origin;
  } catch {
    emit({ outcome: "canary_configuration_invalid" });
    return;
  }
  const contradiction = Math.floor(now.getTime() / 300000) % 2 === 0;
  const started = performance.now();
  let valid = false;
  try {
    const signal = AbortSignal.timeout(7000);
    const response = await send(`${origin}/v1/check`, {
      method: "POST",
      redirect: "manual",
      signal,
      headers: {
        authorization: `Bearer ${env.CANARY_API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        profile: "balanced-v1",
        claim: { id: "claim", text: "The Starter plan includes SSO." },
        against: [
          {
            id: "comparison",
            text: contradiction
              ? "The Starter plan does not include SSO."
              : "The Starter plan includes SSO.",
          },
        ],
      }),
    });
    if (response.ok) {
      const parsed = checkResponseSchema.safeParse(await readProviderJson(response, signal));
      if (parsed.success) {
        const result = parsed.data;
        const expected = contradiction ? "contradiction" : "no_contradiction_detected";
        const comparison = result.comparisons[0];
        valid =
          result.status === "completed" &&
          result.engine.profile === "balanced-v1" &&
          result.claim_id === "claim" &&
          result.coverage.requested === 1 &&
          result.coverage.completed === 1 &&
          result.comparisons.length === 1 &&
          comparison?.against_id === "comparison" &&
          comparison.verdict === expected &&
          comparison.evidence.claim_id === "claim" &&
          comparison.evidence.against_id === "comparison";
      }
    } else void response.body?.cancel().catch(() => undefined);
  } catch {
    /* Only the controlled outcome is emitted; no response bodies or credentials. */
  }
  const previous = await env.DB.prepare(
    "SELECT value FROM ops_state WHERE name = 'canary_failures'",
  ).first<{ value: string }>();
  const storedFailures = Number(previous?.value);
  const previousFailures =
    Number.isSafeInteger(storedFailures) && storedFailures >= 0 ? storedFailures : 0;
  const failures = valid ? 0 : Math.min(1000, previousFailures + 1);
  await env.DB.prepare(
    "INSERT INTO ops_state(name,value) VALUES('canary_failures',?) ON CONFLICT(name) DO UPDATE SET value=excluded.value",
  )
    .bind(String(failures))
    .run();
  emit({
    outcome: valid ? "canary_passed" : "canary_failed",
    failures,
    duration_ms: Math.round(performance.now() - started),
  });
  if (failures >= 3) await alert(env, "canary_failed", send, emit);
}

async function alert(
  env: Env,
  code: AlertCode,
  send: typeof fetch,
  emit: (event: MonitorEvent) => void,
) {
  emit({ outcome: `alert_${code}` });
  if (!env.ALERT_WEBHOOK_URL) return;
  let url: URL;
  try {
    url = new URL(env.ALERT_WEBHOOK_URL);
    if (url.protocol !== "https:" || url.username || url.password) throw Error();
  } catch {
    emit({ outcome: "alert_configuration_invalid" });
    return;
  }
  const key = `alert:${code}`,
    now = Date.now();
  const row = await env.DB.prepare(
    "INSERT INTO ops_state(name,value) VALUES(?,?) ON CONFLICT(name) DO UPDATE SET value=excluded.value WHERE CAST(ops_state.value AS INTEGER) < ? RETURNING name",
  )
    .bind(key, String(now), now - 3600000)
    .first();
  if (!row) return;
  try {
    const response = await send(url, {
      method: "POST",
      redirect: "manual",
      signal: AbortSignal.timeout(5000),
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        service: "countercheck",
        event: code,
        time: new Date(now).toISOString(),
      }),
    });
    void response.body?.cancel().catch(() => undefined);
    if (!response.ok) throw Error();
  } catch {
    emit({ outcome: "alert_delivery_failed" });
  }
}
