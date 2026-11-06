import { spawn } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs, positiveInteger } from "../eval/args.js";
import { sha256File } from "../eval/files.js";
import { naceModelSchema } from "../eval/nace-provider.js";
import { validateManifest } from "../eval/types.js";

async function main() {
  const args = parseArgs(
    process.argv.slice(2),
    [
      "live",
      "baseline",
      "out",
      "max-calls",
      "cost-per-call-usd",
      "max-spend-usd",
      "prior-probes",
      "interval-ms",
    ],
    ["live"],
  );
  if (!args.live || !args.baseline || !args.out || !process.env.NACE_API_KEY?.trim())
    throw new Error("Explicit live opt-in, baseline, fresh output and Nace credential required.");
  const baseline = JSON.parse(await readFile(join(args.baseline, "protocol.json"), "utf8")) as {
    inputs: { id: string; path: string; sha256: string; pairs: number; purpose: string }[];
    sources: Record<string, string>;
  };
  for (const input of baseline.inputs) {
    const manifest = validateManifest(JSON.parse(await readFile(input.path, "utf8")));
    if ((await sha256File(input.path)) !== input.sha256 || manifest.pairs.length !== input.pairs)
      throw new Error("Baseline input changed.");
  }
  const models = ["drex-max-v1.1", "drex-max-finance", "drex-v2.0", "drex-max", "drex-v1.5"].map(
    (id) => ({
      id: naceModelSchema.parse(id),
      provider: "nace",
      name: id,
    }),
  );
  const planned = baseline.inputs.reduce((n, input) => n + input.pairs, 0) * models.length;
  const probes = Number(args["prior-probes"] ?? "0");
  const maxCalls = positiveInteger(args["max-calls"], 0, "max-calls");
  const intervalMs = positiveInteger(args["interval-ms"], 550, "interval-ms");
  const reservation = Number(args["cost-per-call-usd"]);
  const cap = Number(args["max-spend-usd"]);
  if (
    !Number.isSafeInteger(probes) ||
    probes < 0 ||
    !Number.isFinite(reservation) ||
    reservation <= 0 ||
    !Number.isFinite(cap) ||
    cap <= 0 ||
    planned + probes > maxCalls ||
    (planned + probes) * reservation > cap ||
    intervalMs < 110
  )
    throw new Error("Invalid call/spend/pacing reservation.");
  const response = await fetch("https://console.nace.ai/v1/models", {
    headers: { authorization: `Bearer ${process.env.NACE_API_KEY}` },
    redirect: "manual",
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error("Nace catalog unavailable; no inference started.");
  }
  const catalog = (await response.json()) as {
    models: { name: string; alias_for: string | null }[];
  };
  if (models.some((m) => !catalog.models.some((c) => c.name === m.id && c.alias_for === null)))
    throw new Error("Requested active models unavailable; no inference started.");
  const sourcePaths = [
    ...new Set([
      ...Object.keys(baseline.sources),
      "eval/nace-provider.ts",
      "eval/http-status-observer.ts",
      "eval/register-http-status.ts",
      "scripts/run-nace-benchmark.ts",
    ]),
  ];
  const snapshot = Object.fromEntries(
    await Promise.all(sourcePaths.map(async (path) => [path, await readFile(path, "utf8")])),
  );
  const sources = Object.fromEntries(
    await Promise.all(sourcePaths.map(async (path) => [path, await sha256File(path)])),
  );
  for (const path of Object.keys(baseline.sources).filter(
    (p) =>
      (p.startsWith("src/") && p !== "src/providers/decider.ts") ||
      [
        "eval/backends.ts",
        "eval/metrics.ts",
        "eval/types.ts",
        "eval/protocol.ts",
        "eval/checkpoint.ts",
      ].includes(p),
  ))
    if (sources[path] !== baseline.sources[path])
      throw new Error(`Shared kernel/metrics drift: ${path}`);
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
      recorded_before_benchmark_inference: true,
      created_at: new Date().toISOString(),
      node: process.version,
      models,
      inputs: baseline.inputs,
      sources,
      planned_calls: planned,
      prior_integration_probes: probes,
      max_calls_including_probes: maxCalls,
      reservation_per_call_usd: reservation,
      reservation_cap_usd: cap,
      actual_billed_cost: null,
      profile: "balanced-v1",
      passes: 1,
      presentation: "original",
      batch_size: 1,
      concurrency: 1,
      interval_ms: intervalMs,
      pacing_outside_latency_and_deadline: true,
      timeout_ms: 3000,
      retries: 0,
      fallbacks: false,
      input_conversion: "none; same structured instructions/state/criteria; model field replaced",
      model_catalog: catalog.models,
      checkpoint_revision: null,
      unused_adapter_change:
        "src/providers/decider.ts differs from the baseline: a later defensive fix strips extra router billing fields. This adapter is not loaded by the Nace route; kernel/compiler/metrics/transport/response validator are byte-identical.",
      retention: "Not established by inference response; public benchmark inputs only",
      baseline_archive: args.baseline,
      baseline_protocol_sha256: await sha256File(join(args.baseline, "protocol.json")),
      qualification:
        "Evaluation only; native labels, no new human adjudication, no prompt tuning or calibration. Non-contemporaneous comparison with November 5 baseline.",
    },
    true,
  );
  await save("execution-sources.json", snapshot, true);
  const completed: {
    model: string;
    dataset: string;
    pairs: number;
    errors: number;
    excluded: number;
    prefix: string;
  }[] = [];
  console.log(
    JSON.stringify({ event: "nace_started", planned_calls: planned, interval_ms: intervalMs }),
  );
  for (const model of models)
    for (const input of baseline.inputs) {
      for (const [path, hash] of Object.entries(sources))
        if ((await sha256File(path)) !== hash)
          throw new Error("Inference sources changed; checkpoints retained.");
      const prefix = join(out, `${model.id}.${input.id}`);
      await save("progress.json", {
        status: "running",
        current: { model: model.id, dataset: input.id, pairs: input.pairs, prefix },
        completed,
      });
      const childArgs = [
        "--import",
        "tsx",
        "--import",
        resolve("eval/register-http-status.ts"),
        resolve("scripts/eval.ts"),
        "--backend",
        "nace",
        "--model",
        model.id,
        "--manifest",
        input.path,
        "--profile",
        "balanced-v1",
        "--live",
        "--interval-ms",
        String(intervalMs),
        "--max-calls",
        String(input.pairs),
        "--cost-per-call-usd",
        String(reservation),
        "--max-spend-usd",
        String(input.pairs * reservation),
        "--out",
        prefix,
      ];
      const code = await new Promise<number | null>((done, reject) => {
        const child = spawn(process.execPath, childArgs, {
          stdio: ["ignore", "pipe", "pipe"],
          env: {
            ...process.env,
            COUNTERCHECK_EVAL_HTTP_STATUS_PATH: `${prefix}.http-status.jsonl`,
          },
        });
        child.stdout.resume();
        child.stderr.resume();
        child.once("error", reject);
        child.once("close", done);
      });
      if (code !== 0) throw new Error(`Run failed; checkpoint retained: ${model.id}/${input.id}`);
      const report = JSON.parse(await readFile(`${prefix}.json`, "utf8"));
      const statuses = (await readFile(`${prefix}.http-status.jsonl`, "utf8"))
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((s) => JSON.parse(s));
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
        JSON.stringify({ event: "nace_run_completed", ...item, completed_runs: completed.length }),
      );
      if (statuses.some((s) => [401, 402, 403, 429].includes(s.status)))
        throw new Error(
          "Account/rate rejection observed; phase stopped without retries; checkpoint retained.",
        );
    }
  for (const [path, hash] of Object.entries(sources))
    if ((await sha256File(path)) !== hash)
      throw new Error("Inference sources changed during phase.");
  await save("progress.json", { status: "complete", completed });
  console.log(JSON.stringify({ event: "nace_complete", observations: planned }));
}
main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : "Nace phase failed; checkpoints retained.",
  );
  process.exitCode = 1;
});
