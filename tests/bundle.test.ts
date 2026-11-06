import { build as bundle } from "esbuild";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { expect, it } from "vitest";
import { SUPPORTED_MODELS } from "../src/contracts/models.js";
import { hashKey } from "../src/control/auth.js";
import { checkResponseSchema } from "../src/contracts/index.js";

it("runs the compiled Worker through real D1 and the actual workerd fetch implementation", async () => {
  const directory = await mkdtemp(join(tmpdir(), "countercheck-bundle-"));
  let mf: Miniflare | undefined;
  try {
    const build = spawnSync(
      process.execPath,
      [
        resolve("node_modules/wrangler/bin/wrangler.js"),
        "deploy",
        "--dry-run",
        "--outdir",
        directory,
      ],
      {
        encoding: "utf8",
        maxBuffer: 2 * 1024 * 1024,
        timeout: 30_000,
        env: { ...process.env, CI: "true", WRANGLER_SEND_METRICS: "false" },
      },
    );
    expect(
      build.status,
      ["Worker dry-run build must succeed", build.error?.message, build.stderr]
        .filter(Boolean)
        .join("\n"),
    ).toBe(0);
    const harness = join(directory, "harness.js");
    await bundle({
      stdin: {
        resolveDir: resolve("."),
        contents: `
      import worker from ${JSON.stringify(join(directory, "index.js"))};
      export { AdmissionDO } from ${JSON.stringify(join(directory, "index.js"))};
      import { getAdmissionService } from './src/control/admission.ts';
      export default {async fetch(request,env,ctx){
        if(new URL(request.url).pathname==='/__test/enroll')
          return Response.json(await getAdmissionService(env).enroll({tenantId:'bundle-tenant'}));
        return worker.fetch(request,env,ctx);
      }};`,
      },
      bundle: true,
      format: "esm",
      platform: "neutral",
      external: ["cloudflare:workers", "node:*"],
      outfile: harness,
    });
    const key = `cck_${"w".repeat(43)}`;
    let calls = 0;
    let redirect = false;
    mf = new Miniflare(
      convertV4MiniflareOptions({
        name: "countercheck-bundle-smoke",
        rootPath: directory,
        modules: true,
        scriptPath: harness,
        durableObjects: { ADMISSION: { className: "AdmissionDO", useSQLite: true } },
        compatibilityDate: "2026-11-03",
        compatibilityFlags: ["nodejs_compat", "enable_request_signal"],
        d1Databases: { DB: "bundle-smoke" },
        ratelimits: {
          RATE_LIMITER: { namespace_id: "9999", simple: { limit: 60, period: 60 } },
          INGRESS_LIMITER: { namespace_id: "9998", simple: { limit: 120, period: 60 } },
        },
        bindings: { TYPESAFE_API_KEY: "synthetic-test-credential" },
        outboundService: async (request) => {
          expect(new URL(request.url).hostname).toBe("api.typesafe.ai");
          calls++;
          if (redirect)
            return new Response(null, {
              status: 302,
              headers: { location: "https://unexpected.invalid/" },
            });
          const body = (await request.json()) as { questions: Record<string, unknown> };
          return Response.json({
            model: "jev-1.14.0",
            answers: Object.fromEntries(
              Object.keys(body.questions).map((id) => [
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
            usage: { input_tokens: 100, output_tokens: 0 },
          });
        },
      }),
    );
    const catalog = await mf.dispatchFetch("http://countercheck.test/v1/models");
    expect(catalog.status).toBe(200);
    expect(await catalog.json()).toEqual({
      default: "jev-1.14.0",
      models: SUPPORTED_MODELS.map((model) => ({
        ...model,
        configured: model.id === "jev-1.14.0",
      })),
    });
    expect(calls).toBe(0);
    const db = await mf.getD1Database("DB");
    for (const file of ["0001_control.sql", "0002_accounts.sql", "0003_observability.sql"]) {
      const migration = await readFile(resolve("migrations", file), "utf8");
      for (const statement of migration.split(";").filter((s) => s.trim()))
        await db.prepare(statement).run();
    }
    expect((await mf.dispatchFetch("http://countercheck.test/__test/enroll")).status).toBe(200);
    await db
      .prepare("INSERT INTO api_keys(id,tenant_id,key_hash,created_at) VALUES(?,?,?,?)")
      .bind("bundle-key", "bundle-tenant", await hashKey(key), new Date().toISOString())
      .run();
    const check = () =>
      mf!.dispatchFetch("http://countercheck.test/v1/check", {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify({
          claim: { id: "a", text: "Starter includes SSO." },
          against: [{ id: "b", text: "Starter excludes SSO." }],
        }),
      });
    const response = await check();
    expect(response.status).toBe(200);
    const result = checkResponseSchema.parse(await response.json());
    expect(result.comparisons[0]!.verdict).toBe("contradiction");
    expect(result.coverage.completed).toBe(1);
    expect(calls).toBe(1);
    redirect = true;
    const refused = await check();
    expect(refused.status).toBe(502);
    expect(calls).toBe(2);
    expect(await refused.text()).not.toContain("unexpected.invalid");
  } finally {
    await mf?.dispose();
    await rm(directory, { recursive: true, force: true });
  }
}, 45_000);
