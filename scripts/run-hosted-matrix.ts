import { spawn } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { parseArgs, positiveInteger } from "../eval/args.js";
import { sha256File } from "../eval/files.js";
import { validateManifest } from "../eval/types.js";
import { SUPPORTED_MODELS } from "../src/contracts/models.js";

const datasets = [
  ["vitaminc", "eval/data/vitaminc-combined-dev-200.json"],
  ["scifact", "eval/data/scifact-dev-200.json"],
  ["contractnli", "eval/data/business/contractnli-dev-200.json"],
  ["mnli", "eval/data/business/mnli-nonfiction-dev-200.json"],
  ["findver", "eval/data/business/findver-testmini-ie-individual-82.json"],
  ["synthetic-smoke", "eval/fixtures/synthetic-smoke.json"],
  ["synthetic-contract", "eval/fixtures/prompt-ablation-contract.json"],
] as const;

async function main() {
  const args = parseArgs(
    process.argv.slice(2),
    ["live", "out", "max-calls", "cost-per-call-usd", "max-spend-usd"],
    ["live"],
  );
  if (!args.live || !args.out)
    throw new Error("Explicit --live and a fresh --out directory are required.");
  const inputs = await Promise.all(
    datasets.map(async ([id, path]) => {
      const manifest = validateManifest(JSON.parse(await readFile(path, "utf8")));
      return {
        id,
        path,
        sha256: await sha256File(path),
        pairs: manifest.pairs.length,
        purpose: manifest.purpose,
      };
    }),
  );
  const planned = inputs.reduce((sum, input) => sum + input.pairs, 0) * SUPPORTED_MODELS.length;
  const maxCalls = positiveInteger(args["max-calls"], 0, "max-calls");
  const reservation = Number(args["cost-per-call-usd"]);
  const cap = Number(args["max-spend-usd"]);
  if (
    !Number.isFinite(reservation) ||
    reservation <= 0 ||
    !Number.isFinite(cap) ||
    cap <= 0 ||
    planned > maxCalls ||
    planned * reservation > cap
  )
    throw new Error("Matrix exceeds explicit call/spend reservation.");
  for (const name of ["TYPESAFE_API_KEY", "OPENAI_API_KEY", "OPENROUTER_API_KEY"])
    if (!process.env[name]?.trim()) throw new Error(`Missing ${name}`);
  const out = resolve(args.out);
  await mkdir(out, { recursive: false, mode: 0o700 });
  const sourcePaths = [
    "scripts/run-hosted-matrix.ts",
    "scripts/eval.ts",
    "eval/providers.ts",
    "eval/backends.ts",
    "eval/metrics.ts",
    "eval/types.ts",
    "eval/protocol.ts",
    "eval/checkpoint.ts",
    "src/contracts/models.ts",
    "src/contracts/index.ts",
    "src/contracts/limits.ts",
    "src/kernel/index.ts",
    "src/kernel/experimental.ts",
    "src/providers/catalog.ts",
    "src/providers/jev.ts",
    "src/providers/clef.ts",
    "src/providers/decider.ts",
    "src/providers/openai-decisions.ts",
    "src/providers/transport.ts",
    "src/providers/response.ts",
    "src/http/deadline.ts",
    "pnpm-lock.yaml",
  ];
  const sources = Object.fromEntries(
    await Promise.all(sourcePaths.map(async (path) => [path, await sha256File(path)])),
  );
  const protocol = {
    recorded_before_inference: true,
    created_at: new Date().toISOString(),
    node: process.version,
    models: SUPPORTED_MODELS,
    inputs,
    sources,
    planned_calls: planned,
    max_calls: maxCalls,
    reservation_per_call_usd: reservation,
    reservation_cap_usd: cap,
    actual_billed_cost: null,
    profile: "balanced-v1",
    passes: 1,
    presentation: "original",
    batch_size: 1,
    concurrency: 1,
    timeout_ms: 3000,
    retries: 0,
    fallbacks: false,
    transport:
      "Shipped kernel and adapters; native Workers AI binding via named nicia-ai Wrangler remote proxy; other providers direct HTTPS. Not authenticated deployed API latency.",
    finance_overlap: "Strict23 is a subset of82; derive its score offline without duplicate calls.",
    synthetic_reporting:
      "Separate contract diagnostics; uncertain expectations excluded from binary metrics.",
    qualification:
      "Native public dataset labels only; no new human-adjudicated service-contract gold, tuning, held-out opening, or quality promotion.",
  };
  await writeFile(join(out, "protocol.json"), JSON.stringify(protocol, null, 2) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
  const completed: {
    model: string;
    dataset: string;
    pairs: number;
    errors: number;
    excluded: number;
    prefix: string;
  }[] = [];
  console.log(
    JSON.stringify({
      event: "matrix_started",
      planned_calls: planned,
      runs: SUPPORTED_MODELS.length * inputs.length,
      out,
    }),
  );
  for (const model of SUPPORTED_MODELS) {
    const slug = model.id.replaceAll("/", "--");
    for (const input of inputs) {
      const prefix = join(out, `${slug}.${input.id}`);
      await writeFile(
        join(out, "progress.json"),
        JSON.stringify(
          {
            status: "running",
            current: { model: model.id, dataset: input.id, pairs: input.pairs, prefix },
            completed,
          },
          null,
          2,
        ) + "\n",
        { mode: 0o600 },
      );
      const childArgs = [
        resolve("node_modules/tsx/dist/cli.mjs"),
        resolve("scripts/eval.ts"),
        "--backend",
        "hosted",
        "--model",
        model.id,
        "--manifest",
        input.path,
        "--profile",
        "balanced-v1",
        "--live",
        "--max-calls",
        String(input.pairs),
        "--cost-per-call-usd",
        String(reservation),
        "--max-spend-usd",
        String(input.pairs * reservation),
        "--out",
        prefix,
      ];
      const status = await new Promise<number | null>((done, reject) => {
        const child = spawn(process.execPath, childArgs, {
          stdio: ["ignore", "pipe", "pipe"],
          env: process.env,
        });
        // Provider errors are sanitized by the runner; avoid streaming operational internals.
        child.stdout.resume();
        child.stderr.resume();
        child.once("error", reject);
        child.once("close", done);
      });
      if (status !== 0)
        throw new Error(`Run failed; existing checkpoint retained: ${model.id}/${input.id}`);
      const report = JSON.parse(await readFile(`${prefix}.json`, "utf8"));
      const item = {
        model: model.id,
        dataset: input.id,
        pairs: report.diagnostics.execution_observations,
        errors: report.diagnostics.execution_errors,
        excluded: report.diagnostics.execution_excluded,
        prefix,
      };
      completed.push(item);
      console.log(
        JSON.stringify({ event: "run_completed", ...item, completed_runs: completed.length }),
      );
    }
  }
  await writeFile(
    join(out, "progress.json"),
    JSON.stringify({ status: "complete", completed }, null, 2) + "\n",
    { mode: 0o600 },
  );
  console.log(
    JSON.stringify({
      event: "matrix_complete",
      runs: completed.length,
      observations: completed.reduce((sum, run) => sum + run.pairs, 0),
    }),
  );
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Matrix failed; checkpoints retained.");
  process.exitCode = 1;
});
