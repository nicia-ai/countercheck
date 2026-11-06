import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const exec = promisify(execFile);
const script = fileURLToPath(new URL("../scripts/keys.ts", import.meta.url));
const loader = import.meta.resolve("tsx");
const keyId = "11111111-1111-4111-8111-111111111111";

async function remoteHarness() {
  const directory = await mkdtemp(join(tmpdir(), "countercheck-remote-key-test-"));
  const bin = join(directory, "bin");
  const capture = join(directory, "arguments.jsonl");
  await mkdir(bin);
  await writeFile(
    join(directory, "wrangler.jsonc"),
    JSON.stringify({ d1_databases: [{ database_id: "11111111-1111-4111-8111-111111111111" }] }),
  );
  await writeFile(
    join(bin, "pnpm"),
    `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.ARGUMENT_CAPTURE, JSON.stringify(args) + '\\n');
const rows = process.env.RESULT_MODE === 'row' ? [{ id: '${keyId}' }]
  : process.env.RESULT_MODE === 'summary' ? [{ 'Total queries executed': 1 }] : [];
process.stdout.write(JSON.stringify([{ success: true, results: rows }]));
`,
    { mode: 0o700 },
  );
  return {
    directory,
    async run(args: string[], mode = "row") {
      return exec(process.execPath, ["--import", loader, script, ...args], {
        cwd: directory,
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH ?? ""}`,
          ARGUMENT_CAPTURE: capture,
          RESULT_MODE: mode,
        },
      });
    },
    async arguments(): Promise<string[][]> {
      return (await readFile(capture, "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as string[]);
    },
  };
}

it("uses the remote query path for create, list and revoke without a shell or raw API key", async () => {
  const harness = await remoteHarness();
  try {
    const created = await harness.run(["create", "--tenant-id", "O'Brien", "--remote"]);
    const rawKey = created.stdout.match(/cck_[A-Za-z0-9_-]{43}/u)?.[0];
    expect(rawKey).toBeTruthy();
    await harness.run(["list", "--remote"]);
    const revoked = await harness.run(["revoke", "--id", keyId, "--remote"]);
    expect(revoked.stdout).toContain(`Revoked key ${keyId}.`);
    const calls = await harness.arguments();
    expect(calls).toHaveLength(3);
    for (const args of calls) {
      expect(args).toContain("--command");
      expect(args).not.toContain("--file");
      expect(args.join(" ")).not.toContain(rawKey);
    }
    expect(calls[0]![calls[0]!.indexOf("--command") + 1]).toContain("'O''Brien'");
    expect(calls[2]).toContain("--json");
  } finally {
    await rm(harness.directory, { recursive: true, force: true });
  }
});

it("rejects empty or bulk-summary revocation results rather than claiming a key was revoked", async () => {
  const harness = await remoteHarness();
  try {
    for (const mode of ["empty", "summary"]) {
      const result = await harness.run(["revoke", "--id", keyId, "--remote"], mode).then(
        () => ({ code: 0, stdout: "", stderr: "" }),
        (error: unknown) => error,
      );
      expect(result).toMatchObject({ code: 2 });
      expect((result as { stdout: string }).stdout).not.toContain("Revoked key");
    }
  } finally {
    await rm(harness.directory, { recursive: true, force: true });
  }
});

it("creates, lists and revokes over isolated local D1 and rejects a repeated revoke", async () => {
  const directory = await mkdtemp(join(tmpdir(), "countercheck-local-key-test-"));
  const cwd = fileURLToPath(new URL("..", import.meta.url));
  const run = (args: string[]) =>
    exec(process.execPath, ["--import", loader, script, ...args, "--persist-to", directory], {
      cwd,
    });
  try {
    await exec(
      "pnpm",
      [
        "exec",
        "wrangler",
        "d1",
        "migrations",
        "apply",
        "countercheck",
        "--local",
        "--persist-to",
        directory,
      ],
      { cwd },
    );
    const created = await run(["create", "--tenant-id", "operator-regression"]);
    const id = created.stdout.match(/Key ID: ([0-9a-f-]{36})/u)?.[1];
    expect(id).toBeTruthy();
    expect((await run(["list"])).stdout).toContain("operator-regression");
    expect((await run(["revoke", "--id", id!.toUpperCase()])).stdout).toContain(
      `Revoked key ${id}.`,
    );
    await expect(run(["revoke", "--id", id!])).rejects.toMatchObject({ code: 2 });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 60_000);
