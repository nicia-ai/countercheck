import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import { validateDeploymentConfig } from "./deployment-config.js";

const requiredSecrets = [
  "TYPESAFE_API_KEY",
  "OPENAI_API_KEY",
  "OPENROUTER_API_KEY",
  "BETTER_AUTH_SECRET",
  "RESEND_API_KEY",
];
type RunWrangler = (args: string[], capture: boolean) => string;

export function deployFromBuild(source: string, env: NodeJS.ProcessEnv, run: RunWrangler): void {
  const error = validateDeploymentConfig(source);
  if (error) throw new Error(`Deploy config preflight failed: ${error}`);
  const config = ts.parseConfigFileTextToJson("wrangler.jsonc", source).config;
  if (config.name !== "countercheck" || !/^[a-f0-9]{32}$/u.test(config.account_id ?? ""))
    throw new Error(
      "Configure the countercheck Worker and its Cloudflare account before deploying.",
    );
  if (env.CLOUDFLARE_ACCOUNT_ID && env.CLOUDFLARE_ACCOUNT_ID !== config.account_id)
    throw new Error("CLOUDFLARE_ACCOUNT_ID must match the pinned deployment account.");
  if (!env.CLOUDFLARE_API_TOKEN)
    throw new Error("The Cloudflare build must provide its deployment API token.");
  if (env.WORKERS_CI_BRANCH && env.WORKERS_CI_BRANCH !== "main")
    throw new Error("Only main may deploy Countercheck.");
  const database = config.d1_databases?.find((item: { binding?: string }) => item.binding === "DB");
  if (
    database?.database_name !== "countercheck" ||
    !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(database.database_id ?? "") ||
    database.database_id === "00000000-0000-0000-0000-000000000000"
  )
    throw new Error("Configure the dedicated countercheck D1 database before deploying.");

  const secretList: unknown = JSON.parse(
    run(["secret", "list", "--config", "wrangler.jsonc", "--format", "json"], true),
  );
  if (!Array.isArray(secretList)) throw new Error("Could not verify Worker runtime secret names.");
  const names = new Set(
    secretList.flatMap((item: unknown) =>
      typeof item === "object" && item !== null && "name" in item && typeof item.name === "string"
        ? [item.name]
        : [],
    ),
  );
  const missing = requiredSecrets.filter((name) => !names.has(name));
  if (missing.length > 0)
    throw new Error(`Provision Worker runtime secrets before deploying: ${missing.join(", ")}.`);

  run(
    ["d1", "migrations", "apply", "countercheck", "--remote", "--config", "wrangler.jsonc"],
    false,
  );
  run(["deploy", "--config", "wrangler.jsonc"], false);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    deployFromBuild(
      readFileSync("wrangler.jsonc", "utf8"),
      process.env,
      (args, capture) =>
        execFileSync("pnpm", ["exec", "wrangler", ...args], {
          encoding: "utf8",
          stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
        }) ?? "",
    );
  } catch (error) {
    // Child-process errors can contain operational output; print only our own preflight messages.
    console.error(
      error instanceof Error && !("status" in error) && !(error instanceof SyntaxError)
        ? error.message
        : "Cloudflare deployment failed; no subsequent deployment step was run.",
    );
    process.exitCode = 1;
  }
}
