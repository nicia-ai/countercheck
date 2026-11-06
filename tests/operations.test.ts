import { readFile } from "node:fs/promises";
import { expect, it, vi } from "vitest";
import { validateDeploymentConfig } from "../scripts/deployment-config.js";
vi.mock("../src/control/admission-do.js", () => ({ AdmissionDO: class {} }));
import worker from "../src/index.js";
import type { Env } from "../src/env.js";

it("schedules retention cleanup independently of request authentication and inference", async () => {
  const run = vi.fn(async () => undefined);
  const bind = vi.fn(() => ({ run }));
  const prepare = vi.fn(() => ({ bind }));
  await worker.scheduled({}, { DB: { prepare } } as unknown as Env);
  expect(prepare).toHaveBeenCalledWith("DELETE FROM daily_usage WHERE day < ?");
  expect(prepare).toHaveBeenCalledWith("DELETE FROM access_requests WHERE requested_at < ?");
  expect(run).toHaveBeenCalledTimes(5);
  const config = await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8");
  expect(config).toContain('"crons": ["0 0 * * *", "*/5 * * * *"]');
  expect(config).toContain('"enable_request_signal"');
  expect(config).toContain('"workers_dev": false');
  expect(config).toContain('"preview_urls": false');
  expect(config).toContain('"pattern": "countercheck.nicia.ai"');
  expect(config).toContain('"name": "RATE_LIMITER",\n      "namespace_id": "1679165447"');
  expect(config).toContain('"name": "INGRESS_LIMITER",\n      "namespace_id": "1679165448"');
});

it("requires an actual zone or custom-domain route with alternate URLs disabled", async () => {
  const source = await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8");
  expect(validateDeploymentConfig(source)).toBeUndefined();
  expect(
    validateDeploymentConfig(
      JSON.stringify({ workers_dev: false, preview_urls: false, routes: [] }),
    ),
  ).toMatch(/route/i);
  expect(
    validateDeploymentConfig(
      JSON.stringify({
        workers_dev: false,
        preview_urls: false,
        routes: [{ pattern: "api.example.com/*", zone_name: "example.com" }],
      }),
    ),
  ).toMatch(/placeholder|example/i);
  expect(
    validateDeploymentConfig(
      JSON.stringify({
        workers_dev: false,
        preview_urls: false,
        routes: [{ pattern: "api.nicia.ai/*", zone_name: "nicia.ai" }],
      }),
    ),
  ).toBeUndefined();
  for (const host of ["api.myexample.com", "api.counterexample.org"]) {
    const zone = host.slice(host.indexOf(".") + 1);
    expect(
      validateDeploymentConfig(
        JSON.stringify({
          workers_dev: false,
          preview_urls: false,
          routes: [{ pattern: `${host}/*`, zone_name: zone }],
        }),
      ),
    ).toBeUndefined();
  }
  for (const pattern of [
    "https://api.example.com/*",
    "http://api.example.com/*",
    "https://api.example.com:443/*",
    "https://api.example.com./*",
  ]) {
    expect(
      validateDeploymentConfig(
        JSON.stringify({
          workers_dev: false,
          preview_urls: false,
          routes: [{ pattern, zone_id: "1".repeat(32) }],
        }),
      ),
    ).toMatch(/placeholder/i);
  }
  expect(
    validateDeploymentConfig(
      JSON.stringify({
        workers_dev: false,
        preview_urls: false,
        routes: [{ pattern: "api.nicia.test/*", zone_name: "nicia.test" }],
      }),
    ),
  ).toMatch(/placeholder/i);
  expect(
    validateDeploymentConfig(
      JSON.stringify({
        workers_dev: false,
        preview_urls: false,
        routes: [{ pattern: "api.nicia.ai/*", zone_name: "nicia.ai" }, "unreviewed.example.org/*"],
      }),
    ),
  ).toMatch(/every route/i);
});
