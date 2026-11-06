import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const directory = await mkdtemp(join(tmpdir(), "countercheck-eval-smoke-"));
try {
  const result = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "scripts/eval.ts",
      "--backend",
      "fake",
      "--manifest",
      "eval/fixtures/synthetic-smoke.json",
      "--out",
      join(directory, "report"),
    ],
    { stdio: "inherit" },
  );
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  await rm(directory, { recursive: true, force: true });
}
