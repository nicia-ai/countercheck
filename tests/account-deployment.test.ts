import { readFile, readdir } from "node:fs/promises";
import { expect, it, vi } from "vitest";
import { deployFromBuild } from "../scripts/ci-deploy.js";

const source = await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8");
const env = { CLOUDFLARE_API_TOKEN: "synthetic-build-token", WORKERS_CI_BRANCH: "main" };
const runtimeSecrets = JSON.stringify(
  [
    "TYPESAFE_API_KEY",
    "OPENAI_API_KEY",
    "OPENROUTER_API_KEY",
    "BETTER_AUTH_SECRET",
    "RESEND_API_KEY",
  ].map((name) => ({
    name,
    type: "secret_text",
  })),
);

it("verifies runtime secret names, migrates remotely, then deploys without uploading build secrets", () => {
  const run = vi.fn(() => runtimeSecrets);
  deployFromBuild(source, env, run);
  expect(run.mock.calls).toEqual([
    [["secret", "list", "--config", "wrangler.jsonc", "--format", "json"], true],
    [
      ["d1", "migrations", "apply", "countercheck", "--remote", "--config", "wrangler.jsonc"],
      false,
    ],
    [["deploy", "--config", "wrangler.jsonc"], false],
  ]);
});

it.each([
  "TYPESAFE_API_KEY",
  "OPENAI_API_KEY",
  "OPENROUTER_API_KEY",
  "BETTER_AUTH_SECRET",
  "RESEND_API_KEY",
])("stops before migrations when runtime secret %s is missing", (missing) => {
  const run = vi.fn(() =>
    JSON.stringify(
      JSON.parse(runtimeSecrets).filter((item: { name: string }) => item.name !== missing),
    ),
  );
  expect(() => deployFromBuild(source, env, run)).toThrow(missing);
  expect(run).toHaveBeenCalledTimes(1);
});

it.each(["not-json", "{}", "null", "[]"])(
  "stops before migrations when runtime secret metadata is invalid or empty: %s",
  (response) => {
    const run = vi.fn(() => response);
    expect(() => deployFromBuild(source, env, run)).toThrow();
    expect(run).toHaveBeenCalledTimes(1);
  },
);

it.each([0, 1])("stops after failed deployment step %s without retrying", (failure) => {
  let step = 0;
  const run = vi.fn(() => {
    if (step++ === failure) throw new Error("synthetic Cloudflare failure");
    return runtimeSecrets;
  });
  expect(() => deployFromBuild(source, env, run)).toThrow("synthetic Cloudflare failure");
  expect(run).toHaveBeenCalledTimes(failure + 1);
});

it.each([
  { ...env, CLOUDFLARE_API_TOKEN: "" },
  { ...env, CLOUDFLARE_ACCOUNT_ID: "0".repeat(32) },
  { ...env, WORKERS_CI_BRANCH: "feature/unreviewed" },
])("rejects missing credentials, wrong accounts and non-main builds", (environment) => {
  const run = vi.fn(() => runtimeSecrets);
  expect(() => deployFromBuild(source, environment, run)).toThrow();
  expect(run).not.toHaveBeenCalled();
});

it.each([
  source.replace('"workers_dev": false', '"workers_dev": true'),
  source.replace('"preview_urls": false', '"preview_urls": true'),
  source.replace('"name": "countercheck"', '"name": "another-worker"'),
  source.replace(
    /"database_id": "[^"]+"/u,
    '"database_id": "00000000-0000-0000-0000-000000000000"',
  ),
  source.replace('"database_name": "countercheck"', '"database_name": "another-database"'),
])(
  "rejects unsafe routing and invalid deployment targets before any Cloudflare command",
  (config) => {
    const run = vi.fn(() => runtimeSecrets);
    expect(() => deployFromBuild(config, env, run)).toThrow();
    expect(run).not.toHaveBeenCalled();
  },
);

it("keeps GitHub Actions limited to checks and builds the dashboard before the Worker dry run", async () => {
  const workflows = await readdir(new URL("../.github/workflows/", import.meta.url));
  for (const file of workflows) {
    const workflow = await readFile(
      new URL(`../.github/workflows/${file}`, import.meta.url),
      "utf8",
    );
    expect(workflow).not.toMatch(/wrangler (?:deploy|d1|secret)|ci:deploy|CLOUDFLARE_API_TOKEN/u);
  }
  const packageJson = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  expect(packageJson.scripts.test).toBe("pnpm build:dashboard && vitest run");
  expect(packageJson.scripts["ci:build"]).toBe("pnpm check && pnpm test && pnpm build");
  expect(packageJson.scripts["ci:deploy"]).toBe("tsx scripts/ci-deploy.ts");
  expect(packageJson.scripts.build).toBe(
    "pnpm build:dashboard && wrangler deploy --dry-run --outdir dist",
  );
});
