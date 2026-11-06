import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { expect, it } from "vitest";

it("persists atomic admission and limits concurrent RPC calls across a real workerd restart", async () => {
  const directory = await mkdtemp(join(tmpdir(), "countercheck-admission-"));
  let mf: Miniflare | undefined;
  try {
    const script = join(directory, "worker.js");
    await build({
      stdin: {
        resolveDir: resolve("."),
        contents: `
          export { AdmissionDO } from './src/control/admission-do.ts';
          import { getAdmissionService } from './src/control/admission.ts';
          export default { async fetch(request,env) {
            const body=await request.json(); const service=getAdmissionService(env);
            try {
              const value=await service[body.method](body.input);
              return Response.json({value});
            } catch(error) {return Response.json({code:error.code,message:error.message,retryAfter:error.retryAfter},{status:error.status??500});}
          }};
        `,
      },
      bundle: true,
      format: "esm",
      platform: "neutral",
      target: "es2022",
      external: ["cloudflare:workers"],
      outfile: script,
    });
    const create = () =>
      new Miniflare({
        ...convertV4MiniflareOptions({
          name: "admission-real-rpc-test",
          rootPath: directory,
          modules: true,
          scriptPath: script,
          compatibilityDate: "2026-11-03",
          compatibilityFlags: ["nodejs_compat"],
          durableObjects: { ADMISSION: { className: "AdmissionDO", useSQLite: true } },
        }),
        resourcePersistencePath: join(directory, "persist"),
      });
    mf = create();
    const call = (method: string, input?: unknown) =>
      mf!.dispatchFetch("http://admission.test/", {
        method: "POST",
        body: JSON.stringify({ method, input }),
      });
    for (const tenantId of ["tenant_a", "tenant_b", "tenant_c"])
      expect((await call("enroll", { tenantId })).status).toBe(200);
    const input = (tenantId: string) => ({
      tenantId,
      keyId: "synthetic-key-id",
      requestId: crypto.randomUUID(),
      comparisons: 2,
      compiledBytes: 1000,
      profile: "balanced-v1",
      channel: "api",
    });
    const admitted = await Promise.all(
      Array.from({ length: 6 }, () => call("admit", input("tenant_a"))),
    );
    expect(admitted.filter((r) => r.status === 200)).toHaveLength(2);
    expect(admitted.filter((r) => r.status === 429)).toHaveLength(4);
    for (let i = 0; i < 2; i++) expect((await call("admit", input("tenant_b"))).status).toBe(200);
    expect((await call("admit", input("tenant_c"))).status).toBe(429);
    const first = (await admitted.find((r) => r.status === 200)!.json()) as {
      value: { reservationId: string };
    };
    await mf.dispose();
    mf = create();
    const usage = (await (await call("getUsage", "tenant_a")).json()) as {
      value: { inflight: number; today: { attempts: number; comparisons: number } };
    };
    expect(usage).toMatchObject({ value: { inflight: 2, today: { attempts: 2, comparisons: 4 } } });
    expect((await call("admit", input("tenant_c"))).status).toBe(429);
    expect(
      (
        await call("complete", {
          ...first.value,
          outcome: "completed",
          inputTokens: 99,
          durationMs: 50,
        })
      ).status,
    ).toBe(200);
    expect((await call("admit", input("tenant_c"))).status).toBe(200);
    const global = (await (await call("getGlobalUsage")).json()) as {
      value: { inflight: number; today: { attempts: number; knownInputTokens: number } };
    };
    expect(global.value).toMatchObject({
      inflight: 4,
      today: { attempts: 5, knownInputTokens: 99 },
    });
    expect((await call("setGlobalPause", { paused: true })).status).toBe(200);
    await mf.dispose();
    mf = create();
    const paused = await call("admit", input("tenant_c"));
    expect(paused.status).toBe(503);
    expect(await paused.json()).toMatchObject({ code: "admission_paused" });
  } finally {
    await mf?.dispose();
    await rm(directory, { recursive: true, force: true });
  }
}, 30000);
