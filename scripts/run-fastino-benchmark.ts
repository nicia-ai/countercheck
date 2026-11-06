import { spawn } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { parseArgs, positiveInteger } from "../eval/args.js";
import { sha256File } from "../eval/files.js";
import { FASTINO_GLIDE_MODEL } from "../eval/fastino-provider.js";

async function main() {
  const args = parseArgs(
    process.argv.slice(2),
    ["live", "baseline", "out", "max-calls", "cost-per-call-usd", "max-spend-usd", "prior-probes"],
    ["live"],
  );
  if (!args.live || !args.baseline || !args.out || !process.env.FASTINO_API_KEY?.trim())
    throw new Error(
      "Explicit live opt-in, baseline, fresh output and Fastino credential required.",
    );
  const baseline = JSON.parse(await readFile(join(args.baseline, "protocol.json"), "utf8")) as {
    inputs: { id: string; path: string; sha256: string; pairs: number; purpose: string }[];
    sources: Record<string, string>;
  };
  for (const input of baseline.inputs)
    if ((await sha256File(input.path)) !== input.sha256) throw new Error("Baseline input changed.");
  const planned = baseline.inputs.reduce((sum, input) => sum + input.pairs, 0);
  const probes = Number(args["prior-probes"] ?? "0");
  if (!Number.isSafeInteger(probes) || probes < 0) throw new Error("Invalid prior probe count");
  const maxCalls = positiveInteger(args["max-calls"], 0, "max-calls");
  const perCall = Number(args["cost-per-call-usd"]);
  const cap = Number(args["max-spend-usd"]);
  if (
    !Number.isFinite(perCall) ||
    perCall <= 0 ||
    !Number.isFinite(cap) ||
    cap <= 0 ||
    planned + probes > maxCalls ||
    (planned + probes) * perCall > cap
  )
    throw new Error("Fastino phase exceeds call/spend reservation.");
  const catalogResponse = await fetch(
    "https://api.fastino.ai/v1/base-models?supports_inference=true&task_type=systemone",
    {
      headers: { authorization: `Bearer ${process.env.FASTINO_API_KEY}` },
      redirect: "manual",
      signal: AbortSignal.timeout(15000),
    },
  );
  if (!catalogResponse.ok)
    throw new Error("Fastino catalog unavailable; no benchmark calls started.");
  const catalog = (await catalogResponse.json()) as {
    models: { id: string; description?: string; supports_inference?: boolean }[];
  };
  const model = catalog.models.find(
    (model) => model.id === FASTINO_GLIDE_MODEL && model.supports_inference,
  );
  if (!model) throw new Error("Requested Fastino model is not served.");
  const out = resolve(args.out);
  await mkdir(out, { recursive: false, mode: 0o700 });
  const sourcePaths = [
    ...Object.keys(baseline.sources),
    "eval/fastino-provider.ts",
    "scripts/run-fastino-benchmark.ts",
  ];
  const sources = Object.fromEntries(
    await Promise.all(sourcePaths.map(async (path) => [path, await sha256File(path)])),
  );
  for (const path of Object.keys(baseline.sources).filter(
    (path) =>
      path.startsWith("src/") ||
      [
        "eval/backends.ts",
        "eval/metrics.ts",
        "eval/types.ts",
        "eval/protocol.ts",
        "eval/checkpoint.ts",
      ].includes(path),
  ))
    if (sources[path] !== baseline.sources[path])
      throw new Error(`Shared kernel/metrics source drift: ${path}`);
  const protocol = {
    recorded_before_benchmark_inference: true,
    created_at: new Date().toISOString(),
    node: process.version,
    models: [{ id: FASTINO_GLIDE_MODEL, name: "GLiDE 27B (Fastino API)", provider: "fastino" }],
    inputs: baseline.inputs,
    sources,
    planned_calls: planned,
    prior_integration_probes: probes,
    max_calls_including_probes: maxCalls,
    reservation_per_call_usd: perCall,
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
    store: false,
    thinking: false,
    observed_retention_header: "not-stored",
    reported_engine: "glide_v2",
    checkpoint_revision: null,
    model_catalog: model,
    availability: {
      source: "https://fastino.ai/blog/glide-decision-model-family",
      hosted: "fastino/GLiDE",
      pending_open_weights: [
        "fastino/GLiDE-0.4B",
        "fastino/GLiDE-0.8B",
        "fastino/GLiDE-2B",
        "fastino/GLiDE-9B",
      ],
      owner_decision: "Evaluate hosted27B now; leave smaller sizes pending.",
    },
    baseline_protocol_sha256: await sha256File(join(args.baseline, "protocol.json")),
    baseline_archive: args.baseline,
    qualification:
      "Evaluation-only comparator; not an exposed service model or independently qualified contract.",
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
      event: "fastino_started",
      planned_calls: planned,
      prior_probes: probes,
      model: FASTINO_GLIDE_MODEL,
    }),
  );
  for (const input of baseline.inputs) {
    const prefix = join(out, `${FASTINO_GLIDE_MODEL.replaceAll("/", "--")}.${input.id}`);
    await writeFile(
      join(out, "progress.json"),
      JSON.stringify(
        {
          status: "running",
          current: { model: FASTINO_GLIDE_MODEL, dataset: input.id, pairs: input.pairs, prefix },
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
      "fastino",
      "--manifest",
      input.path,
      "--profile",
      "balanced-v1",
      "--live",
      "--max-calls",
      String(input.pairs),
      "--cost-per-call-usd",
      String(perCall),
      "--max-spend-usd",
      String(input.pairs * perCall),
      "--out",
      prefix,
    ];
    const code = await new Promise<number | null>((done, reject) => {
      const child = spawn(process.execPath, childArgs, {
        stdio: ["ignore", "pipe", "pipe"],
        env: process.env,
      });
      child.stdout.resume();
      child.stderr.resume();
      child.once("error", reject);
      child.once("close", done);
    });
    if (code !== 0) throw new Error(`Fastino run failed; checkpoint retained: ${input.id}`);
    const report = JSON.parse(await readFile(`${prefix}.json`, "utf8"));
    const run = {
      model: FASTINO_GLIDE_MODEL,
      dataset: input.id,
      pairs: report.diagnostics.execution_observations,
      errors: report.diagnostics.execution_errors,
      excluded: report.diagnostics.execution_excluded,
      prefix,
    };
    completed.push(run);
    console.log(JSON.stringify({ event: "fastino_run_completed", ...run }));
  }
  for (const [path, hash] of Object.entries(sources))
    if ((await sha256File(path)) !== hash)
      throw new Error("Inference source changed during Fastino phase; checkpoints retained.");
  await writeFile(
    join(out, "progress.json"),
    JSON.stringify({ status: "complete", completed }, null, 2) + "\n",
    { mode: 0o600 },
  );
  console.log(JSON.stringify({ event: "fastino_complete", observations: planned }));
}
main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : "Fastino phase failed; checkpoints retained.",
  );
  process.exitCode = 1;
});
