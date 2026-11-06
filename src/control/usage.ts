import type { Env } from "../env.js";

export async function recordUsage(
  env: Env,
  keyId: string,
  comparisons: number,
  inputTokens: number | null,
): Promise<void> {
  const now = new Date();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO daily_usage (key_id, day, requests, comparisons, input_tokens, unknown_token_requests)
       VALUES (?, ?, 1, ?, ?, ?)
       ON CONFLICT (key_id, day) DO UPDATE SET
       requests = requests + 1,
       comparisons = comparisons + excluded.comparisons,
       input_tokens = input_tokens + excluded.input_tokens,
       unknown_token_requests = unknown_token_requests + excluded.unknown_token_requests`,
    ).bind(
      keyId,
      now.toISOString().slice(0, 10),
      comparisons,
      inputTokens ?? 0,
      inputTokens === null ? 1 : 0,
    ),
  ]);
}

export async function pruneUsage(env: Env, now = new Date()): Promise<void> {
  const oldestRetainedDay = new Date(now.getTime() - 29 * 86_400_000).toISOString().slice(0, 10);
  await env.DB.prepare("DELETE FROM daily_usage WHERE day < ?").bind(oldestRetainedDay).run();
  await env.DB.prepare("DELETE FROM tenant_daily_usage WHERE day < ?")
    .bind(oldestRetainedDay)
    .run();
  await env.DB.prepare("DELETE FROM admin_audit WHERE created_at < ?")
    .bind(oldestRetainedDay)
    .run();
  await env.DB.prepare("DELETE FROM access_requests WHERE requested_at < ?")
    .bind(new Date(now.getTime() - 30 * 86400000).toISOString())
    .run();
  await env.DB.prepare(
    "INSERT INTO ops_state(name,value) VALUES('retention_last_success',?) ON CONFLICT(name) DO UPDATE SET value=excluded.value",
  )
    .bind(now.toISOString())
    .run();
}

export interface RequestUsage {
  tenantId: string;
  keyId: string;
  channel: "api" | "dashboard";
  profile: string;
  engineRelease: string;
  admitted: boolean;
  dispatched: boolean;
  completed: boolean;
  status: number;
  comparisons: number;
  bodyBytes: number;
  compiledBytes: number;
  durationMs: number;
  inputTokens: number | null;
}

/** Advisory technical rollup. The admission controller remains the quota authority. */
export async function recordRequestUsage(env: Env, row: RequestUsage): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO tenant_daily_usage
      (tenant_id, day, channel, profile, engine_release, requests, admitted, dispatches, completed, errors, rejected, comparisons, body_bytes, compiled_bytes, duration_ms, known_input_tokens, unknown_token_attempts)
      VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(tenant_id, day, channel, profile, engine_release) DO UPDATE SET
      requests=requests+1, admitted=admitted+excluded.admitted, dispatches=dispatches+excluded.dispatches,
      completed=completed+excluded.completed, errors=errors+excluded.errors, rejected=rejected+excluded.rejected,
      comparisons=comparisons+excluded.comparisons, body_bytes=body_bytes+excluded.body_bytes,
      compiled_bytes=compiled_bytes+excluded.compiled_bytes, duration_ms=duration_ms+excluded.duration_ms,
      known_input_tokens=known_input_tokens+excluded.known_input_tokens, unknown_token_attempts=unknown_token_attempts+excluded.unknown_token_attempts`,
    ).bind(
      row.tenantId,
      new Date().toISOString().slice(0, 10),
      row.channel,
      row.profile,
      row.engineRelease,
      Number(row.admitted),
      Number(row.dispatched),
      Number(row.completed),
      Number(row.status >= 500),
      Number(!row.admitted && row.status >= 400),
      row.comparisons,
      row.bodyBytes,
      row.compiledBytes,
      Math.round(row.durationMs),
      row.inputTokens ?? 0,
      Number(row.dispatched && row.inputTokens === null),
    ),
    ...(row.channel === "api"
      ? [
          env.DB.prepare("UPDATE api_keys SET last_used_at = ? WHERE id = ?").bind(
            new Date().toISOString(),
            row.keyId,
          ),
        ]
      : []),
  ]);
}
