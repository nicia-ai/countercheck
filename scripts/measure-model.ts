import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs, positiveInteger } from "../eval/args.js";
import { accountRejection } from "../eval/calibration-study/nace.js";
import { sha256File } from "../eval/files.js";
import {
  EXECUTION_SOURCES,
  MEASUREMENT_PROFILE,
  PROBE_INPUT,
  SCREEN_CONFIG_PATH,
  assertFrozenInputs,
  assertFrozenSources,
  loadScreenConfig,
  plannedCalls,
  selectCohort,
} from "../eval/measurement.js";
import { validateManifest } from "../eval/types.js";

const HELP = `Measure one model on a screen cohort's frozen inputs (sequential, one pass, no retries).
Usage: pnpm eval:measure --cohort ID --backend BACKEND [--model ID] --live \\
         --max-calls N --cost-per-call-usd USD --max-spend-usd USD --out NEW_DIRECTORY
  --cohort ID          A cohort in ${SCREEN_CONFIG_PATH}
  --backend, --model   Passed to pnpm eval:run (hosted, nace, openrouter-candidate, fastino)
  --interval-ms N      Optional minimum between call starts, outside measured latency
An ${PROBE_INPUT.id} on synthetic fixtures runs first and is excluded from quality rows.
Archive the finished run with scripts/archive-measurement.py before adding it to the cohort.`;

interface RunRecord {
  input: string;
  model: string;
  pairs: number;
  completed: number;
  errors: number;
  excluded: number;
}

async function evaluate(
  directory: string,
  input: { id: string; path: string; pairs: number },
  options: { backend: string; model?: string; intervalMs?: string; perCallUsd: number },
): Promise<RunRecord & { rejected: boolean }> {
  const prefix = join(directory, input.id);
  const { pairs } = input;
  const statusPath = `${prefix}.http-status.jsonl`;
  const childArgs = [
    "--import",
    "tsx",
    "--import",
    resolve("eval/register-http-status.ts"),
    resolve("scripts/eval.ts"),
    ...["--backend", options.backend],
    ...(options.model ? ["--model", options.model] : []),
    ...(options.intervalMs ? ["--interval-ms", options.intervalMs] : []),
    ...["--manifest", input.path, "--profile", MEASUREMENT_PROFILE, "--live"],
    ...["--max-calls", String(pairs), "--cost-per-call-usd", String(options.perCallUsd)],
    ...["--max-spend-usd", String(pairs * options.perCallUsd), "--out", prefix],
  ];
  const code = await new Promise<number | null>((done, reject) => {
    const child = spawn(process.execPath, childArgs, {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, COUNTERCHECK_EVAL_HTTP_STATUS_PATH: statusPath },
    });
    // Provider errors are sanitized by the runner; avoid streaming operational internals.
    child.stdout.resume();
    child.stderr.resume();
    child.once("error", reject);
    child.once("close", done);
  });
  if (code !== 0) throw new Error(`Run failed; checkpoint retained: ${input.id}`);
  const report = JSON.parse(await readFile(`${prefix}.json`, "utf8"));
  const statuses = (await readFile(statusPath, "utf8")).split("\n").filter(Boolean);
  return {
    input: input.id,
    model: report.prediction_metadata.model,
    pairs: report.diagnostics.execution_observations,
    completed: report.diagnostics.execution_completed,
    errors: report.diagnostics.execution_errors,
    excluded: report.diagnostics.execution_excluded,
    rejected: statuses.some((line) => accountRejection(JSON.parse(line).status)),
  };
}

async function main() {
  const args = parseArgs(
    process.argv.slice(2),
    [
      "help",
      "live",
      "cohort",
      "backend",
      "model",
      "out",
      "max-calls",
      "cost-per-call-usd",
      "max-spend-usd",
      "interval-ms",
    ],
    ["help", "live"],
  );
  if (args.help) {
    process.stdout.write(`${HELP}\n`);
    return;
  }
  if (!args.live || !args.backend || !args.out)
    throw new Error("Explicit --live, --backend and a fresh --out directory are required.");
  const config = await loadScreenConfig();
  const cohort = selectCohort(config, args.cohort);
  await assertFrozenSources(config);
  await assertFrozenInputs(cohort);
  const probe = validateManifest(JSON.parse(await readFile(PROBE_INPUT.path, "utf8")));
  const perCallUsd = Number(args["cost-per-call-usd"]);
  const reservation = {
    maxCalls: positiveInteger(args["max-calls"], 0, "max-calls"),
    perCallUsd,
    capUsd: Number(args["max-spend-usd"]),
  };
  const planned = plannedCalls(cohort, probe.pairs.length, reservation);
  const sources = Object.fromEntries(
    await Promise.all(
      [...EXECUTION_SOURCES, ...Object.keys(config.frozen_sources)].map(
        async (path) => [path, await readFile(path, "utf8")] as const,
      ),
    ),
  );
  const out = resolve(args.out);
  await mkdir(out, { recursive: false, mode: 0o700 });
  const save = (name: string, value: unknown, fresh = false) =>
    writeFile(join(out, name), JSON.stringify(value, null, 2) + "\n", {
      mode: 0o600,
      ...(fresh && { flag: "wx" }),
    });
  await save(
    "protocol.json",
    {
      schema_version: 1,
      recorded_before_inference: true,
      created_at: new Date().toISOString(),
      node: process.version,
      backend: args.backend,
      requested_model: args.model ?? null,
      cohort,
      frozen_sources: config.frozen_sources,
      screen_config_sha256: await sha256File(SCREEN_CONFIG_PATH),
      probe: {
        ...PROBE_INPUT,
        sha256: await sha256File(PROBE_INPUT.path),
        pairs: probe.pairs.length,
      },
      planned_calls: planned,
      max_calls: reservation.maxCalls,
      reservation_per_call_usd: reservation.perCallUsd,
      reservation_cap_usd: reservation.capUsd,
      actual_billed_cost: null,
      profile: MEASUREMENT_PROFILE,
      passes: 1,
      presentation: "original",
      batch_size: 1,
      concurrency: 1,
      interval_ms: args["interval-ms"] ? Number(args["interval-ms"]) : 0,
      retries: 0,
      fallbacks: false,
      qualification:
        "Evaluation only; native labels, no prompt tuning, calibration or production qualification. Not contemporaneous with the cohort's earlier sources.",
    },
    true,
  );
  await save("execution-sources.json", sources, true);
  const options = {
    backend: args.backend,
    ...(args.model && { model: args.model }),
    ...(args["interval-ms"] && { intervalMs: args["interval-ms"] }),
    perCallUsd,
  };
  const assertUnchangedSources = async () => {
    for (const [path, text] of Object.entries(sources))
      if ((await readFile(path, "utf8")) !== text)
        throw new Error("Inference sources changed; checkpoints retained.");
  };
  const probed = await evaluate(out, { ...PROBE_INPUT, pairs: probe.pairs.length }, options);
  if (probed.completed === 0 || probed.rejected)
    throw new Error("Integration probe completed no call; cohort inference was not started.");
  const completed: RunRecord[] = [];
  console.log(JSON.stringify({ event: "measurement_started", cohort: cohort.id, planned }));
  for (const input of cohort.inputs) {
    await assertUnchangedSources();
    await save("progress.json", { status: "running", current: input.id, probe: probed, completed });
    const { rejected, ...run } = await evaluate(out, input, options);
    completed.push(run);
    console.log(JSON.stringify({ event: "input_completed", ...run }));
    if (rejected) throw new Error("Account or rate rejection observed; stopped without retries.");
  }
  await assertUnchangedSources();
  await save("progress.json", { status: "complete", probe: probed, completed });
  console.log(JSON.stringify({ event: "measurement_complete", cohort: cohort.id }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Measurement failed.");
  process.exitCode = 1;
});
