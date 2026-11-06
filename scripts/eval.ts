import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parseArgs, positiveInteger } from "../eval/args.js";
import { sampleGroups, groupStatistics, SAMPLING_BIAS } from "../eval/datasets.js";
import { runPairs, type RunOptions } from "../eval/backends.js";
import { summarize, type Scored } from "../eval/metrics.js";
import { validateReplay } from "../eval/replay.js";
import { withPredictionCheckpoint } from "../eval/checkpoint.js";
import { sha256File } from "../eval/files.js";
import { evaluationTiming, measurementProtocol, packingProtocol } from "../eval/protocol.js";
import {
  sha256,
  isUncertainFixture,
  validateManifest,
  validateReplayMetadata,
  type Pair,
  type Prediction,
  type ReplayMetadata,
} from "../eval/types.js";
import { profileSchema, modelSchema, type CheckRequest } from "../src/contracts/index.js";
import { evaluationProvider } from "../eval/providers.js";

const HELP = `Countercheck supplied-evidence benchmark runner (sequential calls; no retries).
Usage: pnpm eval:run --manifest FILE --backend fake --out PREFIX
       pnpm eval:run --manifest FILE --backend jev --live --limit 10 --max-calls 10 --max-spend-usd 1 --cost-per-call-usd 0.01 --out PREFIX
       pnpm eval:run --manifest FILE --backend service --url https://... --live --limit 10 --max-calls 10 --max-spend-usd 1 --cost-per-call-usd 0.01 --out PREFIX
       pnpm eval:run --manifest FILE --backend replay --predictions FILE --out PREFIX
Options:
  --backend fake|service|hosted|fastino|jev|jev-direct|clef|decider|replay
  --model ID                     Required with hosted; closed catalog of deployed models, native Workers AI binding
  --profile balanced-v1|semantic-v2|structured-value-v1 (default balanced-v1; candidates experimental)
  --manifest FILE --out PREFIX   Required; emits PREFIX.json and PREFIX.md; refuses overwrite
  --live                         Mandatory for all network/model calls (never inferred from credentials)
  --limit N                      Maximum pairs, preserving complete groups (default manifest size)
  --passes N                     Repeated unchanged passes (default 1)
  --presentation original|reversed|shuffled (default original; provider permutation for kernel routes)
  --batch-size N                 Default 1; 2–20 fixed same-claim batches test atomic envelope stress, never repacked
  --timeout-ms N                 Default 6000 service / 3000 kernel; total route deadline, no retries
  --max-calls N                  Required live hard cap; rejects planned over-budget run
  --max-spend-usd USD            Required live reservation cap
  --cost-per-call-usd USD        Required live conservative per-call reservation, not a measured price
  --url URL                     Service origin; COUNTERCHECK_API_KEY env (HTTPS except localhost)
  --predictions FILE            Replay JSONL/JSON array; every selected pair/pass exactly once
  --prediction-metadata FILE    Required for public replay (default FILE.metadata.json); binds manifest SHA-256
  --help
Credentials: TYPESAFE_API_KEY (Jev), CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN (Clef),
OPENROUTER_API_KEY (Decider), FASTINO_API_KEY (Fastino GLiDE). No provider keys or error bodies enter reports.
Fake is transport/metrics smoke only, restricted to explicitly synthetic fixtures, no semantic performance claim.
jev-direct uses the same single-pair compiler/policy and response validator, bypassing evaluateCheck.
Cost reservation is operator supplied, not a guaranteed vendor spending limit. Usage unknown remains unknown.
Public Worker reversal tests caller-array canonicalization, not actual provider presentation order.
Thresholds stay fixed; do not tune on locked tests. These runs do not satisfy custom human-labeled release gates.`;
function dollars(value: string | undefined, name: string): number {
  const n = Number(value);
  if (!value || !Number.isFinite(n) || n <= 0) throw new Error(`Required positive ${name}`);
  return n;
}
function groupBatches(pairs: Pair[], batchSize: number): Pair[][] {
  const byClaim = new Map<string, Pair[]>();
  for (const pair of pairs) byClaim.set(pair.claim, [...(byClaim.get(pair.claim) ?? []), pair]);
  return [...byClaim.values()].flatMap((group) =>
    Array.from({ length: Math.ceil(group.length / batchSize) }, (_, i) =>
      group.slice(i * batchSize, (i + 1) * batchSize),
    ),
  );
}
function markdown(
  report: ReturnType<typeof summarize>,
  backend: string,
  purpose: string,
  hash: string,
  protocol: ReturnType<typeof evaluationTiming> & { packing: ReturnType<typeof packingProtocol> },
): string {
  const m = report.overall;
  const fmt = (v: number | null) => (v === null ? "n/a" : v.toFixed(4));
  return `# Countercheck evaluation\n\nBackend: **${backend}**. Track: **${purpose}**. Manifest SHA-256: \`${hash}\`.\n\n${backend === "fake" ? "**Synthetic transport smoke only. No live model or public semantic benchmark was run.**" : "Supplied-evidence pair adaptation; this is not an end-to-end retrieval score or production release qualification."}\n\nPacking: \`${protocol.packing.assessment}\`; envelope failure: \`${protocol.packing.envelope_failure}\`; automatic repacking: false. Batched coverage is specific to this submitted-batch protocol and is not an isolated-pair quality score.\n\nDeadline: ${protocol.timeout_ms === null ? "not applied (replay)" : `${protocol.timeout_ms} ms`}, \`${protocol.timeout_scope}\`, \`${protocol.timeout_policy}\`. Production qualification: not assessed.\n\n| Measure | Value |\n|---|---:|\n| Pair observations | ${m.denominator} |\n| Positive / negative | ${m.positive} / ${m.negative} |\n| Precision | ${fmt(m.precision.value)} |\n| Recall (uncertainty/failures miss) | ${fmt(m.recall.value)} |\n| F1 | ${fmt(m.f1)} |\n| Definitive coverage | ${fmt(m.coverage.value)} |\n| Clear-negative coverage | ${fmt(m.clear_negative_coverage.value)} |\n| False positive rate | ${fmt(m.false_positive_rate.value)} |\n| AUROC | ${fmt(m.auroc)} |\n| PR-AUC (average precision) | ${fmt(m.pr_auc_average_precision)} |\n| Scored prevalence | ${fmt(m.prevalence_in_scored_subset)} |\n| Brier | ${fmt(m.brier)} |\n| Errors / excluded | ${m.errors} / ${m.excluded} |\n\nProbabilistic metrics exclude missing distributions; their denominator is ${m.probability_denominator}. Positive recall and coverage retain errors, exclusions and uncertainty. Pair-weighted latency is diagnostic; it is not a deployed request-capacity measurement.\n\nJSON contains complete per-pair distributions, original labels, dataset/native-negative slices, pass summaries, calibration bins, risk/coverage, Wilson intervals and group bootstrap intervals. Cost reservations are not measured charges; unavailable usage/cost stays unknown. No production gates are certified by this report.\n`;
}
async function main(): Promise<void> {
  const args = parseArgs(
    process.argv.slice(2),
    [
      "help",
      "backend",
      "profile",
      "model",
      "manifest",
      "out",
      "live",
      "limit",
      "passes",
      "presentation",
      "batch-size",
      "timeout-ms",
      "max-calls",
      "max-spend-usd",
      "cost-per-call-usd",
      "url",
      "predictions",
      "prediction-metadata",
    ],
    ["help", "live"],
  );
  if (args.help) {
    process.stdout.write(`${HELP}\n`);
    return;
  }
  if (
    !args.manifest ||
    !args.out ||
    ![
      "fake",
      "service",
      "hosted",
      "fastino",
      "jev",
      "jev-direct",
      "clef",
      "decider",
      "replay",
    ].includes(args.backend ?? "")
  )
    throw new Error("Required --manifest --backend --out; use --help");
  const model = args.backend === "hosted" ? modelSchema.parse(args.model) : undefined;
  if (args.model !== undefined && args.backend !== "hosted")
    throw new Error("Use --model only with --backend hosted");
  const profile: CheckRequest["profile"] = profileSchema.parse(args.profile ?? "balanced-v1");
  if (args.backend === "replay" && args.profile !== undefined)
    throw new Error("Replay profile comes from archived provenance; do not supply --profile");
  if (args.backend === "jev-direct" && profile !== "balanced-v1")
    throw new Error(
      "Direct scorer only supports balanced-v1; use kernel mode for experimental composition",
    );
  const out = resolve(args.out);
  const checkpointPath = `${out}.predictions.jsonl`;
  for (const path of [
    `${out}.json`,
    `${out}.md`,
    checkpointPath,
    `${checkpointPath}.metadata.json`,
  ]) {
    let exists = false;
    try {
      await access(path);
      exists = true;
    } catch {
      /* new output */
    }
    if (exists) throw new Error("Output exists; choose a fresh report prefix before spending");
  }
  const bytes = await readFile(args.manifest, "utf8");
  const manifest = validateManifest(JSON.parse(bytes));
  const limit = positiveInteger(args.limit, manifest.pairs.length, "limit");
  const pairs = sampleGroups(manifest.pairs, limit, manifest.sampling.seed);
  if (!pairs.length) throw new Error("No complete groups fit --limit");
  const passes = positiveInteger(args.passes, 1, "passes");
  const batchSize = positiveInteger(args["batch-size"], 1, "batch-size");
  if (batchSize > 20) throw new Error("Batch size exceeds service envelope");
  if (args.backend === "jev-direct" && batchSize !== 1)
    throw new Error("Direct comparison is isolated single pairs");
  const presentation = args.presentation ?? "original";
  if (!["original", "reversed", "shuffled"].includes(presentation))
    throw new Error("Invalid presentation");
  if (args.backend === "service" && presentation === "shuffled")
    throw new Error("Service route cannot perturb provider presentation; use a kernel backend");
  const timing = evaluationTiming(args.backend ?? "", args["timeout-ms"]);
  const batches = groupBatches(pairs, batchSize);
  const calls = batches.length * passes;
  let reservationPerCall: number | undefined;
  if (args.backend === "fake" && manifest.purpose !== "synthetic-smoke")
    throw new Error("Fake transport is restricted to synthetic smoke manifests");
  if (!["fake", "replay"].includes(args.backend ?? "")) {
    if (!args.live) throw new Error("Model/network calls require --live");
    if (!args["max-calls"]) throw new Error("Live calls require explicit --max-calls");
    const maxCalls = positiveInteger(args["max-calls"], 0, "max-calls");
    reservationPerCall = dollars(args["cost-per-call-usd"], "cost-per-call-usd");
    const cap = dollars(args["max-spend-usd"], "max-spend-usd");
    if (calls > maxCalls || calls * reservationPerCall > cap)
      throw new Error("Planned run exceeds call/spend reservation limits");
  }
  if (args.backend === "service") {
    if (!args.url || !process.env.COUNTERCHECK_API_KEY) throw new Error("Missing service URL/key");
    const url = new URL(args.url);
    if (
      url.protocol !== "https:" &&
      !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
    )
      throw new Error("Service URL requires HTTPS except loopback");
  }
  let predictions: Prediction[];
  let predictionsHash: string;
  let predictionMetadataHash: string | null = null;
  let predictionMetadata: ReplayMetadata | null = null;
  const requests: {
    pass: number;
    pair_ids: string[];
    status: string;
    latency_ms: number;
    usage: { input_tokens: number | null; output_tokens: number | null };
  }[] = [];
  if (args.backend === "replay") {
    if (!args.predictions) throw new Error("Missing replay predictions");
    const predictionBytes = await readFile(args.predictions);
    predictionsHash = sha256(predictionBytes);
    const text = predictionBytes.toString("utf8");
    const trimmed = text.trim();
    const raw = trimmed.startsWith("[")
      ? JSON.parse(trimmed)
      : trimmed
          .split("\n")
          .filter(Boolean)
          .map((line) => JSON.parse(line));
    predictions = validateReplay(raw, pairs, passes);
    const metadataPath = args["prediction-metadata"] ?? `${args.predictions}.metadata.json`;
    let metadataText: string | undefined;
    try {
      metadataText = await readFile(metadataPath, "utf8");
    } catch (error) {
      if (
        manifest.purpose !== "synthetic-smoke" ||
        (error as NodeJS.ErrnoException).code !== "ENOENT"
      )
        throw new Error("Replay requires readable provenance metadata", { cause: error });
    }
    if (metadataText !== undefined) {
      predictionMetadata = validateReplayMetadata(JSON.parse(metadataText), sha256(bytes));
      predictionMetadataHash = await sha256File(metadataPath);
    }
  } else {
    const provider = await evaluationProvider(args.backend ?? "", process.env, model);
    predictions = [];
    const timeoutMs = timing.timeout_ms;
    if (timeoutMs === null) throw new Error("Dispatch requires an explicit operation deadline");
    predictionMetadata = {
      manifest_sha256: sha256(bytes),
      model: provider?.model ?? (args.backend === "fake" ? "fake-no-model" : null),
      backend: args.backend,
      expected_pair_observations: pairs.length * passes,
      selected_pair_ids: pairs.map((pair) => pair.id),
      source_protocol: {
        profile,
        passes,
        presentation,
        batch_size: batchSize,
        concurrency: 1,
        ...timing,
        packing: packingProtocol(args.backend ?? "", batchSize),
      },
      checkpoint_semantics:
        "Incremental completed batches; exact replay coverage required; no automatic resume or retry",
    };
    try {
      await withPredictionCheckpoint(checkpointPath, predictionMetadata, async (append) => {
        for (let pass = 1; pass <= passes; pass++) {
          for (const batch of batches) {
            const options: RunOptions = {
              pass,
              profile,
              timeoutMs,
              presentation: presentation as RunOptions["presentation"],
              provider,
              serviceUrl: args.url,
              serviceKey: process.env.COUNTERCHECK_API_KEY,
              fake: args.backend === "fake",
              direct: args.backend === "jev-direct",
            };
            const started = performance.now();
            const observations = await runPairs(batch, options);
            const elapsed = performance.now() - started;
            await append(observations);
            requests.push({
              pass,
              pair_ids: batch.map((p) => p.id),
              status: observations.every((r) => r.status === "ok")
                ? "completed"
                : observations.every((r) => r.status === "excluded")
                  ? "excluded"
                  : "error",
              latency_ms: elapsed,
              usage: observations[0]?.request_usage ?? {
                input_tokens: batch.length === 1 ? (observations[0]?.input_tokens ?? null) : null,
                output_tokens: batch.length === 1 ? (observations[0]?.output_tokens ?? null) : null,
              },
            });
            predictions.push(...observations);
          }
        }
      });
    } finally {
      await provider?.dispose?.();
    }
    predictionsHash = await sha256File(checkpointPath);
    predictionMetadataHash = await sha256File(`${checkpointPath}.metadata.json`);
  }
  const byId = new Map(pairs.map((p) => [p.id, p]));
  const rows: Scored[] = predictions.map((prediction) => ({
    pair: byId.get(prediction.pair_id)!,
    prediction,
  }));
  const binaryRows = rows.filter((row) => !isUncertainFixture(row.pair));
  const summary = summarize(binaryRows);
  const expected = rows.filter(
    (row) => row.pair.dataset === "synthetic-smoke" && row.pair.source_metadata?.expected_verdict,
  );
  const diagnostics = {
    execution_observations: rows.length,
    execution_completed: rows.filter((row) => row.prediction.status === "ok").length,
    execution_errors: rows.filter((row) => row.prediction.status === "error").length,
    execution_excluded: rows.filter((row) => row.prediction.status === "excluded").length,
    expected_uncertain_excluded_from_binary: rows.length - binaryRows.length,
    expected_verdict_cases: expected.length,
    expected_verdict_correct: expected.filter(
      (row) =>
        row.prediction.status === "ok" &&
        row.prediction.verdict ===
          (row.pair.source_metadata?.expected_verdict === "no_contradiction_detected"
            ? "no_contradiction"
            : row.pair.source_metadata?.expected_verdict),
    ).length,
  };
  const report = {
    schema_version: 2,
    backend: args.backend,
    purpose: manifest.purpose,
    manifest_sha256: sha256(bytes),
    adapter_version: manifest.adapter_version,
    sources: manifest.sources,
    sampling: {
      manifest_sampling: manifest.sampling,
      evaluated_group_diagnostics: groupStatistics(pairs),
      bias_disclosure: SAMPLING_BIAS,
    },
    created_at: new Date().toISOString(),
    protocol: {
      profile: args.backend === "replay" ? null : profile,
      passes,
      presentation: args.backend === "replay" ? null : presentation,
      batch_size: args.backend === "replay" ? null : batchSize,
      concurrency: args.backend === "replay" ? null : 1,
      planned_calls: args.backend === "replay" ? 0 : calls,
      ...timing,
      packing: packingProtocol(args.backend ?? "", batchSize),
      cost_reservation_per_call_usd: reservationPerCall ?? null,
      max_reserved_usd: reservationPerCall === undefined ? null : calls * reservationPerCall,
      measured_cost: "not available unless explicitly supplied by offline scorer",
      tuning: "none; fixed evaluation thresholds",
      ...measurementProtocol(manifest.purpose),
    },
    ...summary,
    diagnostics,
    prediction_metadata: predictionMetadata,
    prediction_artifact: {
      source: args.backend === "replay" ? "external_replay" : "incremental_checkpoint",
      sha256: predictionsHash,
      metadata_sha256: predictionMetadataHash,
    },
    request_observations: requests,
    rows,
  };
  await mkdir(dirname(out), { recursive: true });
  await writeFile(`${out}.json`, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
  await writeFile(
    `${out}.md`,
    markdown(summary, args.backend ?? "", manifest.purpose, sha256(bytes), report.protocol) +
      `\nExecution observations: ${diagnostics.execution_observations}; completed: ${diagnostics.execution_completed}; errors: ${diagnostics.execution_errors}; excluded: ${diagnostics.execution_excluded}. Expected-uncertain synthetic fixtures excluded from binary metrics: ${diagnostics.expected_uncertain_excluded_from_binary}. Expected-verdict diagnostics: ${diagnostics.expected_verdict_correct}/${diagnostics.expected_verdict_cases} (synthetic only).\n`,
    { flag: "wx" },
  );
  process.stdout.write(
    `Wrote ${predictions.length} pair observations (${diagnostics.execution_errors} errors, ${diagnostics.execution_excluded} excluded). ${args.backend === "fake" ? "Synthetic smoke only." : manifest.purpose}\n`,
  );
}
main().catch(() => {
  process.stderr.write(
    "Evaluation failed. Completed prediction checkpoints, if created, are retained. Check live opt-in, budgets, credentials and paths; use --help.\n",
  );
  process.exitCode = 1;
});
