import { randomBytes, randomUUID } from "node:crypto";
import { hashKey } from "../src/control/auth.js";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const databaseName = "countercheck";
const configPath = resolve("wrangler.jsonc");
const placeholderDatabaseId = "00000000-0000-0000-0000-000000000000";

function fail(message: string): never {
  console.error(message);
  process.exit(2);
}

function sqlString(value: string): string {
  if (value.includes("\0")) fail("Values may not contain a NUL character.");
  return `'${value.replaceAll("'", "''")}'`;
}

function options(args: string[]): {
  remote: boolean;
  persistTo?: string;
  values: Map<string, string>;
} {
  let remote = false;
  let persistTo: string | undefined;
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--remote") {
      if (remote) fail("Do not repeat --remote.");
      remote = true;
    } else if (argument === "--persist-to") {
      if (persistTo) fail("Do not repeat --persist-to.");
      const value = args[index + 1];
      if (!value || value.startsWith("--")) fail("Expected a directory after --persist-to.");
      persistTo = value;
      index += 1;
    } else {
      if (argument !== "--tenant-id" && argument !== "--id") {
        fail(`Unrecognized argument: ${argument}`);
      }
      if (values.has(argument)) fail(`Do not repeat ${argument}.`);
      const value = args[index + 1];
      if (!value || value.startsWith("--")) fail(`Expected a value after ${argument}.`);
      values.set(argument, value);
      index += 1;
    }
  }
  if (remote && persistTo) fail("--persist-to is only available with local D1; omit --remote.");
  return { remote, ...(persistTo ? { persistTo } : {}), values };
}

async function assertRemoteDatabaseConfigured(remote: boolean): Promise<void> {
  if (!remote) return;
  const config = await readFile(configPath, "utf8");
  const databaseId = config.match(/"database_id"\s*:\s*"([0-9a-f-]+)"/i)?.[1];
  if (!databaseId || databaseId === placeholderDatabaseId) {
    fail("Remote D1 is disabled until wrangler.jsonc has a real database_id.");
  }
}

async function execute(
  sql: string,
  remote: boolean,
  persistTo?: string,
  expectRows = false,
): Promise<unknown> {
  const args = [
    "exec",
    "wrangler",
    "d1",
    "execute",
    databaseName,
    "--config",
    configPath,
    remote ? "--remote" : "--local",
    ...(persistTo ? ["--persist-to", resolve(persistTo)] : []),
  ];
  if (remote) return runWrangler([...args, "--command", sql], expectRows);

  const directory = await mkdtemp(`${tmpdir()}/countercheck-keys-`);
  const file = resolve(directory, "query.sql");
  try {
    await writeFile(file, `${sql.trim()}\n`, { mode: 0o600 });
    return runWrangler([...args, "--file", file], expectRows);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function runWrangler(args: string[], expectRows: boolean): unknown {
  const result = spawnSync("pnpm", [...args, ...(expectRows ? ["--json"] : [])], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
  if (expectRows && result.status === 0) {
    try {
      return JSON.parse(result.stdout) as unknown;
    } catch {
      throw new Error("Wrangler returned an unreadable result for the key operation.");
    }
  }
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw new Error("Could not start Wrangler.");
  if (result.status !== 0) throw new Error("Wrangler key operation failed.");
}

async function main(): Promise<void> {
  const [command, ...rawArgs] = process.argv.slice(2);
  if (!command || !["create", "revoke", "list"].includes(command)) {
    fail(
      "Usage: pnpm keys <create --tenant-id ID | revoke --id ID | list> [--remote] [--persist-to DIR]\n" +
        "Commands target local D1 by default. Add --remote to explicitly target the configured remote database.",
    );
  }
  const { remote, persistTo, values } = options(rawArgs);
  const allowedValues =
    command === "create" ? ["--tenant-id"] : command === "revoke" ? ["--id"] : [];
  for (const name of values.keys()) {
    if (!allowedValues.includes(name)) fail(`${name} is not valid for ${command}.`);
  }
  await assertRemoteDatabaseConfigured(remote);

  if (command === "create") {
    const tenantId = values.get("--tenant-id");
    if (!tenantId || tenantId.length > 128) fail("Provide --tenant-id with 1–128 characters.");
    const key = `cck_${randomBytes(32).toString("base64url")}`;
    const keyHash = await hashKey(key);
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    await execute(
      `INSERT INTO api_keys (id, tenant_id, key_hash, created_at) VALUES (${sqlString(id)}, ${sqlString(tenantId)}, ${sqlString(keyHash)}, ${sqlString(createdAt)});`,
      remote,
      persistTo,
    );
    console.log(`Key ID: ${id}`);
    console.log("Save this API key now; it is shown only once:");
    console.log(key);
    return;
  }

  if (command === "revoke") {
    const rawId = values.get("--id");
    if (!rawId || !/^[0-9a-f-]{36}$/i.test(rawId)) fail("Provide a valid key UUID with --id.");
    const id = rawId.toLowerCase();
    const revokedAt = new Date().toISOString();
    const result = await execute(
      `UPDATE api_keys SET revoked_at = ${sqlString(revokedAt)} WHERE id = ${sqlString(id)} AND revoked_at IS NULL RETURNING id;`,
      remote,
      persistTo,
      true,
    );
    const rows = Array.isArray(result)
      ? result.flatMap((entry) =>
          typeof entry === "object" &&
          entry !== null &&
          "results" in entry &&
          Array.isArray(entry.results)
            ? entry.results
            : [],
        )
      : typeof result === "object" && result !== null && "results" in result
        ? (result as { results: unknown }).results
        : undefined;
    if (Array.isArray(rows) && rows.length === 0) {
      fail("No active API key matched that ID; nothing was revoked.");
    }
    if (
      !Array.isArray(rows) ||
      rows.length !== 1 ||
      typeof rows[0] !== "object" ||
      rows[0] === null ||
      !("id" in rows[0]) ||
      rows[0].id !== id
    )
      fail("Wrangler did not confirm the requested key ID; inspect the key state before retrying.");
    console.log(`Revoked key ${id}.`);
    return;
  }

  await execute(
    "SELECT id, tenant_id, created_at, revoked_at FROM api_keys ORDER BY created_at DESC;",
    remote,
    persistTo,
  );
}

await main().catch(() => {
  console.error("Key operation failed; inspect the Wrangler error above.");
  process.exitCode = 1;
});
