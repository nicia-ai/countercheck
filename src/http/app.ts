import { Hono } from "hono";
import { parseCheckRequest } from "../contracts/index.js";
import { DEFAULT_MODEL, MODEL_ROUTES } from "../contracts/models.js";
import { ServiceError } from "../contracts/errors.js";
import { LIMITS } from "../contracts/limits.js";
import {
  authenticate,
  enforceRateLimit,
  enforceIngressLimit,
  type Principal,
} from "../control/auth.js";
import { recordUsage, recordRequestUsage } from "../control/usage.js";
import { getAdmissionService, type AdmissionService } from "../control/admission.js";
import type { BackgroundTasks, Env } from "../env.js";
import { evaluateCheck, ENGINE } from "../kernel/index.js";
import { providerFor, configuredModelCatalog } from "../providers/catalog.js";
import type { DecisionProvider } from "../providers/types.js";
import { readJsonBody } from "./body.js";
import { withDeadline } from "./deadline.js";
import { openApiDocument } from "./openapi.js";
import { accountRouter, handleAuth, sessionPrincipal, inviteAccount } from "../account/routes.js";
import { dashboardPage } from "../dashboard/page.js";
import { accountSession, assertAccountOrigin, type AccountOptions } from "../account/auth.js";
import { isAccountAdmin } from "../account/routes.js";
import { dismissAccessRequest, listAccessRequests, listInvitations } from "../account/access.js";
import { EXPERIMENTAL_ENGINES } from "../kernel/experimental.js";
import { z } from "zod";

export interface Metric {
  request_id: string;
  outcome: string;
  duration_ms: number;
  route?: string;
  channel?: "api" | "dashboard";
  status?: number;
  tenant_id?: string;
  key_id?: string;
  profile?: string;
  engine_release?: string;
  provider?: string;
  model?: string;
  comparisons?: number;
  body_bytes?: number;
  compiled_bytes?: number;
  auth_ms?: number;
  admission_ms?: number;
  provider_ms?: number;
  admitted?: boolean;
  dispatched?: boolean;
  input_tokens?: number | null;
}
interface RequestState {
  started: number;
  route: string;
  outcome: string;
  channel: "api" | "dashboard";
  principal?: Principal;
  profile: string;
  engineRelease: string;
  comparisons: number;
  bodyBytes: number;
  compiledBytes: number;
  authMs: number;
  admissionMs: number;
  providerMs: number;
  admitted: boolean;
  dispatched: boolean;
  inputTokens: number | null;
  provider?: DecisionProvider;
}
interface AppOptions {
  provider?: DecisionProvider;
  metric?: (metric: Metric) => void;
  background?: BackgroundTasks;
  admission?: AdmissionService;
  account?: AccountOptions;
}
function routeName(path: string) {
  if (path === "/v1/check") return "check";
  if (path === "/dashboard/api/check") return "playground";
  if (path.startsWith("/api/auth/")) return "auth";
  if (path.startsWith("/dashboard/api/admin/")) return "admin";
  if (path.startsWith("/dashboard/api/")) return "account";
  if (path === "/internal/ready") return "ready";
  return "public";
}
export function createApp(options: AppOptions = {}) {
  const app = new Hono<{ Bindings: Env; Variables: { requestId: string; state: RequestState } }>();
  const emit = options.metric ?? ((metric: Metric) => console.log(JSON.stringify(metric)));
  app.use("*", async (c, next) => {
    const requestId = `req_${crypto.randomUUID()}`;
    c.set("requestId", requestId);
    const state: RequestState = {
      started: performance.now(),
      route: routeName(c.req.path),
      outcome: "completed",
      channel: c.req.path === "/dashboard/api/check" ? "dashboard" : "api",
      profile: "balanced-v1",
      engineRelease: ENGINE.engine_release,
      comparisons: 0,
      bodyBytes: 0,
      compiledBytes: 0,
      authMs: 0,
      admissionMs: 0,
      providerMs: 0,
      admitted: false,
      dispatched: false,
      inputTokens: null,
    };
    c.set("state", state);
    c.header("Cache-Control", "no-store");
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Referrer-Policy", "same-origin");
    c.header(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    await next();
    c.header("X-Request-Id", requestId);
    if (state.route !== "public") {
      const duration = Math.max(0, Math.round(performance.now() - state.started));
      const completed = state.outcome === "completed" && c.res.status < 400;
      emit({
        request_id: requestId,
        route: state.route,
        outcome:
          state.outcome === "completed" && c.res.status >= 400
            ? `http_${c.res.status}`
            : state.outcome,
        duration_ms: duration,
        status: c.res.status,
        ...(state.route === "check" || state.route === "playground"
          ? {
              channel: state.channel,
              profile: state.profile,
              engine_release: state.engineRelease,
              comparisons: state.comparisons,
              body_bytes: state.bodyBytes,
              compiled_bytes: state.compiledBytes,
              auth_ms: state.authMs,
              admission_ms: state.admissionMs,
              provider_ms: state.providerMs,
              admitted: state.admitted,
              dispatched: state.dispatched,
              input_tokens: state.inputTokens,
            }
          : {}),
        ...(state.principal
          ? { tenant_id: state.principal.tenantId, key_id: state.principal.id }
          : {}),
        ...(state.provider ? { provider: state.provider.id, model: state.provider.model } : {}),
      });
      if (state.principal && (state.route === "check" || state.route === "playground")) {
        const background = options.background ?? c.executionCtx;
        background.waitUntil(
          recordRequestUsage(c.env, {
            tenantId: state.principal.tenantId,
            keyId: state.principal.id,
            channel: state.channel,
            profile: state.profile,
            engineRelease: state.engineRelease,
            admitted: state.admitted,
            dispatched: state.dispatched,
            completed,
            status: c.res.status,
            comparisons: state.comparisons,
            bodyBytes: state.bodyBytes,
            compiledBytes: state.compiledBytes,
            durationMs: duration,
            inputTokens: state.inputTokens,
          }).catch(() =>
            emit({ request_id: requestId, outcome: "usage_write_failed", duration_ms: 0 }),
          ),
        );
      }
    }
  });
  app.get("/health", (c) => c.json({ status: "ok", service: "countercheck" }));
  app.get("/v1/models", (c) =>
    c.json({ default: DEFAULT_MODEL, models: configuredModelCatalog(c.env) }),
  );
  app.get("/openapi.json", (c) => c.json(openApiDocument()));
  for (const path of ["/dashboard.js", "/dashboard.css"])
    app.get(path, (c) => {
      if (!c.env.ASSETS)
        throw new ServiceError(503, "assets_unavailable", "Dashboard assets are unavailable.");
      return c.env.ASSETS.fetch(c.req.raw);
    });
  app.all("/api/auth/*", (c) => handleAuth(c.req.raw, c.env, options.account));
  app.route("/dashboard/api", accountRouter(options.account));
  app.get("/dashboard/api/usage", async (c) => {
    const { principal } = await sessionPrincipal(c.req.raw, c.env, options.account);
    c.set("state", { ...c.get("state"), principal });
    return c.json(
      await (options.admission ?? getAdmissionService(c.env)).getUsage(principal.tenantId),
    );
  });
  app.get("/internal/ready", async (c) => {
    await withDeadline(
      async (signal) => {
        await enforceIngressLimit(c.req.raw, c.env);
        if (signal.aborted) throw signal.reason;
        await authenticate(c.req.raw, c.env);
        if (signal.aborted) throw signal.reason;
        providerFor(c.env);
        await (options.admission ?? getAdmissionService(c.env)).getGlobalUsage();
      },
      LIMITS.requestMs,
      new ServiceError(504, "readiness_timeout", "Readiness check timed out.", true),
      c.req.raw.signal,
    );
    return c.json({ status: "ready" });
  });
  for (const route of ["/v1/check", "/dashboard/api/check"] as const)
    app.post(route, async (c) => {
      const state = c.get("state");
      const raw = await withDeadline(
        async (signal) => {
          await enforceIngressLimit(c.req.raw, c.env);
          if (signal.aborted) throw signal.reason;
          if (state.channel === "dashboard") {
            const origin = c.req.header("origin");
            if (
              !origin ||
              origin !== new URL(c.env.BETTER_AUTH_URL ?? "https://countercheck.nicia.ai").origin ||
              c.req.header("sec-fetch-site") === "cross-site"
            )
              throw new ServiceError(
                403,
                "untrusted_origin",
                "Use the dashboard from its configured origin.",
              );
          }
          const body = await readJsonBody(c.req.raw, signal);
          state.bodyBytes = new TextEncoder().encode(JSON.stringify(body)).byteLength;
          return body;
        },
        LIMITS.bodyReadMs,
        new ServiceError(408, "body_timeout", "Request admission and body read timed out.", true),
        c.req.raw.signal,
      );
      const request = parseCheckRequest(raw);
      state.profile = request.profile ?? "balanced-v1";
      state.engineRelease =
        state.profile === "balanced-v1"
          ? ENGINE.engine_release
          : EXPERIMENTAL_ENGINES[request.profile as "semantic-v2" | "structured-value-v1"]
              .engine_release;
      state.comparisons = request.against.length;
      let reservationId: string | undefined;
      let service: AdmissionService | undefined;
      let completionOutcome: "completed" | "failed" | "timeout" | "aborted" | undefined;
      try {
        const result = await withDeadline(
          async (signal) => {
            const authStarted = performance.now();
            state.principal =
              state.channel === "api"
                ? await authenticate(c.req.raw, c.env)
                : (await sessionPrincipal(c.req.raw, c.env, options.account)).principal;
            if (state.channel === "api") await enforceRateLimit(state.principal, c.env);
            state.authMs = performance.now() - authStarted;
            if (signal.aborted) throw signal.reason;
            const provider = options.provider ?? providerFor(c.env, request.model);
            state.provider = provider;
            service = options.admission ?? getAdmissionService(c.env);
            const observed: DecisionProvider = {
              ...provider,
              classify: async (payload, providerSignal) => {
                state.dispatched = true;
                const started = performance.now();
                try {
                  return await provider.classify(payload, providerSignal);
                } finally {
                  state.providerMs = performance.now() - started;
                }
              },
            };
            return withDeadline(
              (providerSignal) =>
                evaluateCheck(request, observed, {
                  requestId: c.get("requestId"),
                  signal: providerSignal,
                  beforeDispatch: async (compiledBytes) => {
                    state.compiledBytes = compiledBytes;
                    const started = performance.now();
                    const admitted = await service!.admit({
                      requestId: c.get("requestId").slice(4),
                      tenantId: state.principal!.tenantId,
                      keyId: state.principal!.id,
                      comparisons: request.against.length,
                      compiledBytes,
                      profile: request.profile ?? "balanced-v1",
                      channel: state.channel,
                      route: MODEL_ROUTES[request.model],
                      release: state.engineRelease,
                    });
                    reservationId = admitted.reservationId;
                    state.admitted = true;
                    state.admissionMs = performance.now() - started;
                  },
                }),
              LIMITS.providerMs,
              new ServiceError(504, "provider_timeout", "Inference timed out.", true),
              signal,
            );
          },
          LIMITS.requestMs,
          new ServiceError(504, "request_timeout", "Request timed out.", true),
          c.req.raw.signal,
        );
        completionOutcome = "completed";
        state.inputTokens = result.usage.input_tokens;
        if (state.channel === "api")
          (options.background ?? c.executionCtx).waitUntil(
            recordUsage(
              c.env,
              state.principal!.id,
              request.against.length,
              state.inputTokens,
            ).catch(() =>
              emit({
                request_id: c.get("requestId"),
                outcome: "usage_write_failed",
                duration_ms: 0,
              }),
            ),
          );
        c.header(
          "Server-Timing",
          `auth;dur=${state.authMs.toFixed(1)}, admission;dur=${state.admissionMs.toFixed(1)}, provider;dur=${state.providerMs.toFixed(1)}, total;dur=${(performance.now() - state.started).toFixed(1)}`,
        );
        return c.json(result);
      } catch (error) {
        completionOutcome = c.req.raw.signal.aborted
          ? "aborted"
          : error instanceof ServiceError && error.status === 504
            ? "timeout"
            : "failed";
        throw error;
      } finally {
        if (reservationId && service) {
          const outcome = completionOutcome ?? "failed";
          (options.background ?? c.executionCtx).waitUntil(
            service
              .complete({
                reservationId,
                outcome,
                inputTokens: state.inputTokens,
                durationMs: Math.round(performance.now() - state.started),
              })
              .catch(() =>
                emit({
                  request_id: c.get("requestId"),
                  outcome: "admission_completion_failed",
                  duration_ms: 0,
                }),
              ),
          );
        }
      }
    });
  const requireAdmin = async (request: Request, env: Env) => {
    const session = await accountSession(request, env, options.account);
    if (!isAccountAdmin(session.user, env))
      throw new ServiceError(403, "admin_required", "Administrator access is required.");
    return session.user;
  };
  app.get("/dashboard/api/admin/overview", async (c) => {
    await requireAdmin(c.req.raw, c.env);
    const overview = await (options.admission ?? getAdmissionService(c.env)).getGlobalUsage();
    const rows = await c.env.DB.prepare(
      "SELECT tenant_id, channel, profile, SUM(requests) AS requests, SUM(admitted) AS admitted, SUM(dispatches) AS dispatches, SUM(completed) AS completed, SUM(errors) AS errors, SUM(rejected) AS rejected FROM tenant_daily_usage WHERE day >= ? GROUP BY tenant_id, channel, profile",
    )
      .bind(new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10))
      .all();
    return c.json({ ...overview, rollups: rows.results });
  });
  app.get("/dashboard/api/admin/access-requests", async (c) => {
    await requireAdmin(c.req.raw, c.env);
    return c.json({ requests: await listAccessRequests(c.env) });
  });
  app.get("/dashboard/api/admin/invitations", async (c) => {
    await requireAdmin(c.req.raw, c.env);
    return c.json({ invitations: await listInvitations(c.env) });
  });
  app.post("/dashboard/api/admin/access-requests/dismiss", async (c) => {
    assertAccountOrigin(c.req.raw, c.env);
    const user = await requireAdmin(c.req.raw, c.env);
    const input = await readJsonBody(c.req.raw);
    await c.env.DB.prepare(
      "INSERT INTO admin_audit (id,actor_id,action,target_id,created_at) VALUES (?,?,?,?,?)",
    )
      .bind(
        crypto.randomUUID(),
        user.id,
        "dismiss_access_request_requested",
        null,
        new Date().toISOString(),
      )
      .run();
    await dismissAccessRequest(c.env, input);
    return c.json({ dismissed: true });
  });
  app.post("/dashboard/api/admin/invitations", async (c) => {
    assertAccountOrigin(c.req.raw, c.env);
    const user = await requireAdmin(c.req.raw, c.env);
    const parsed = z
      .strictObject({ email: z.email().max(254) })
      .safeParse(await readJsonBody(c.req.raw));
    if (!parsed.success)
      throw new ServiceError(422, "invalid_request", "Provide a valid email address.");
    await c.env.DB.prepare(
      "INSERT INTO admin_audit (id,actor_id,action,target_id,created_at) VALUES (?,?,?,?,?)",
    )
      .bind(
        crypto.randomUUID(),
        user.id,
        "invite_account_requested",
        null,
        new Date().toISOString(),
      )
      .run();
    const invitation = await inviteAccount(c.env, { email: parsed.data.email, invitedBy: user.id });
    return c.json({ invited: true, expiresAt: invitation.expiresAt }, 201);
  });
  app.post("/dashboard/api/admin/enroll", async (c) => {
    assertAccountOrigin(c.req.raw, c.env);
    const user = await requireAdmin(c.req.raw, c.env);
    const parsed = z
      .strictObject({ tenantId: z.string().regex(/^[A-Za-z0-9_.:-]{1,128}$/) })
      .safeParse(await readJsonBody(c.req.raw));
    if (!parsed.success)
      throw new ServiceError(422, "invalid_request", "Provide a valid tenantId.");
    await c.env.DB.prepare(
      "INSERT INTO admin_audit (id,actor_id,action,target_id,created_at) VALUES (?,?,?,?,?)",
    )
      .bind(
        crypto.randomUUID(),
        user.id,
        "enroll_tenant_requested",
        parsed.data.tenantId,
        new Date().toISOString(),
      )
      .run();
    const result = await (options.admission ?? getAdmissionService(c.env)).enroll(parsed.data);
    return c.json(result);
  });
  for (const route of [
    "/dashboard/api/admin/pause",
    "/dashboard/api/admin/tenants/:id/pause",
  ] as const)
    app.post(route, async (c) => {
      assertAccountOrigin(c.req.raw, c.env);
      const user = await requireAdmin(c.req.raw, c.env);
      const parsed = z
        .strictObject({ paused: z.boolean() })
        .safeParse(await readJsonBody(c.req.raw));
      if (!parsed.success)
        throw new ServiceError(422, "invalid_request", "Provide a paused boolean.");
      const target = c.req.param("id");
      if (target !== undefined && !/^[A-Za-z0-9_.:-]{1,128}$/.test(target))
        throw new ServiceError(404, "tenant_not_found", "Tenant not found.");
      await c.env.DB.prepare(
        "INSERT INTO admin_audit (id,actor_id,action,target_id,created_at) VALUES (?,?,?,?,?)",
      )
        .bind(
          crypto.randomUUID(),
          user.id,
          `${parsed.data.paused ? "pause" : "resume"}_${target ? "tenant" : "global"}_requested`,
          target ?? null,
          new Date().toISOString(),
        )
        .run();
      const service = options.admission ?? getAdmissionService(c.env);
      if (target) await service.setTenant({ tenantId: target, paused: parsed.data.paused });
      else await service.setGlobalPause({ paused: parsed.data.paused });
      return c.json({ paused: parsed.data.paused });
    });
  app.all("/dashboard/api/*", (c) =>
    c.json(
      {
        error: { code: "not_found", message: "Route not found.", retryable: false },
        request_id: c.get("requestId"),
      },
      404,
    ),
  );
  for (const path of [
    "/",
    "/dashboard",
    "/dashboard/",
    "/dashboard/reset-password",
    "/dashboard/verified",
  ])
    app.get(path, (c) => c.html(dashboardPage()));
  app.notFound((c) =>
    c.json(
      {
        error: { code: "not_found", message: "Route not found.", retryable: false },
        request_id: c.get("requestId"),
      },
      404,
    ),
  );
  app.onError((error, c) => {
    const safe =
      error instanceof ServiceError
        ? error
        : c.req.raw.signal.aborted
          ? new ServiceError(408, "request_aborted", "The client cancelled the request.", false)
          : new ServiceError(500, "internal_error", "An internal error occurred.", false);
    const state = c.get("state");
    if (state) state.outcome = safe.code;
    return new Response(
      JSON.stringify({
        error: { code: safe.code, message: safe.message, retryable: safe.retryable },
        request_id: c.get("requestId"),
      }),
      {
        status: safe.status,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
          "X-Request-Id": c.get("requestId"),
          ...(safe.retryAfter === undefined ? {} : { "Retry-After": String(safe.retryAfter) }),
        },
      },
    );
  });
  return app;
}
