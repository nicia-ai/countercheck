import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parseArgs, positiveInteger } from "../eval/args.js";
import { withPredictionCheckpoint } from "../eval/checkpoint.js";
import { sha256File } from "../eval/files.js";
import { sha256, validateManifest } from "../eval/types.js";
import { PROFILE_IDS, type ProfileId } from "../eval/prompt-ablation/profiles.js";
import {
  executeExperiment,
  planExperiment,
  summarizeExperiment,
  type InputManifest,
} from "../eval/prompt-ablation/runner.js";

const HELP = `Jev 1.14 prompt ablation: evaluation only; no production changes.
Usage: pnpm exec tsx scripts/prompt-ablation.ts --manifests FILE,FILE --out PREFIX --live --max-calls N --cost-per-call-usd USD --max-spend-usd USD
  --manifests PATHS     Required comma-separated frozen canonical pair manifests
  --profiles IDS        Comma-separated profile IDs; default all (${PROFILE_IDS.join(",")})
  --out PREFIX          Required exclusive report/checkpoint prefix
  --live                Required before any model call; TYPESAFE_API_KEY environment only
  --max-calls N         Required hard planned-call cap, including every profile/pair
  --cost-per-call-usd N  Required conservative per-call reservation, not measured price
  --max-spend-usd N     Required aggregate reservation cap
  --concurrency N       1 or 2; default 2 global sequential-profile/dataset queues
  --help                Show help without credentials or calls
Fixed one pass, one provider call per pair/profile, 3000ms deadline, no retries/fallbacks.
Choice uses the unchanged production evaluation thresholds. Dual-noul also changes the
question representation and determinability gate, so it is not a prompt-only effect.
Every completed request is checkpointed before its queue advances. No threshold tuning.
Public and separately reported synthetic contract fixtures are diagnostics, not release qualification.`;
function money(value: string | undefined): number {
  const n = Number(value);
  if (!value || !Number.isFinite(n) || n <= 0)
    throw new Error("Positive reservation values are required");
  return n;
}
async function main() {
  const args = parseArgs(
    process.argv.slice(2),
    [
      "help",
      "manifests",
      "profiles",
      "out",
      "live",
      "max-calls",
      "cost-per-call-usd",
      "max-spend-usd",
      "concurrency",
    ],
    ["help", "live"],
  );
  if (args.help) {
    process.stdout.write(`${HELP}\n`);
    return;
  }
  if (!args.manifests || !args.out || !args.live || !args["max-calls"])
    throw new Error("Explicit manifests/output/live/call and spend caps are required");
  const profiles = (args.profiles ? args.profiles.split(",") : [...PROFILE_IDS]).map((p) =>
    p.trim(),
  );
  if (profiles.some((p) => !PROFILE_IDS.includes(p as ProfileId)))
    throw new Error("Unknown ablation profile");
  const concurrency = positiveInteger(args.concurrency, 2, "concurrency");
  if (concurrency > 2) throw new Error("Ablation concurrency is capped at 2");
  const inputs: InputManifest[] = [];
  for (const path of args.manifests.split(",").map((p) => p.trim())) {
    const bytes = await readFile(path);
    inputs.push({
      name: path,
      sha256: sha256(bytes),
      manifest: validateManifest(JSON.parse(bytes.toString("utf8"))),
    });
  }
  const plan = planExperiment(
    inputs,
    profiles as ProfileId[],
    positiveInteger(args["max-calls"], 0, "max-calls"),
    money(args["cost-per-call-usd"]),
    money(args["max-spend-usd"]),
  );
  const out = resolve(args.out);
  const checkpoint = `${out}.predictions.jsonl`;
  for (const path of [`${out}.json`, `${out}.md`, checkpoint, `${checkpoint}.metadata.json`]) {
    let exists = false;
    try {
      await access(path);
      exists = true;
    } catch {
      /* exclusive creation below */
    }
    if (exists) throw new Error("Choose a fresh ablation output prefix before spending");
  }
  if (!process.env.TYPESAFE_API_KEY) throw new Error("TYPESAFE_API_KEY is required");
  const profileHash = sha256(
    await readFile(new URL("../eval/prompt-ablation/profiles.ts", import.meta.url)),
  );
  const frozenProtocolBytes = await readFile(
    new URL("../eval/prompt-ablation/protocol.json", import.meta.url),
  );
  const frozenProtocol = JSON.parse(frozenProtocolBytes.toString("utf8")) as {
    files?: Record<string, string>;
  };
  if (frozenProtocol.files?.["eval/prompt-ablation/profiles.ts"] !== profileHash)
    throw new Error("Profile definitions do not match the frozen protocol");
  for (const input of inputs) {
    const frozen = Object.entries(frozenProtocol.files).find(
      ([path]) => resolve(path) === resolve(input.name),
    );
    if (!frozen || frozen[1] !== input.sha256)
      throw new Error("An input manifest does not match the frozen protocol");
  }
  const manifestHashes = inputs.map((x) => ({
    name: x.name,
    sha256: x.sha256,
    purpose: x.manifest.purpose,
    pairs: x.manifest.pairs.length,
    sources: x.manifest.sources,
  }));
  const bundleHash = sha256(JSON.stringify(manifestHashes));
  const protocol = {
    requested_model: "jev-1.14.0",
    profile_source_sha256: profileHash,
    frozen_protocol_sha256: sha256(frozenProtocolBytes),
    profiles,
    manifests: manifestHashes,
    planned_calls: plan.planned_calls,
    max_reserved_usd: plan.max_reserved_usd,
    reservation_per_call_usd: money(args["cost-per-call-usd"]),
    global_concurrency: concurrency,
    per_profile_dataset_queue_concurrency: 1,
    deadline_ms: 3000,
    passes: 1,
    retries: 0,
    truncation: false,
    threshold_tuning: false,
    dual_noul_changes_policy_and_question_representation: true,
    production_qualification: "not_assessed",
  };
  const observations = await withPredictionCheckpoint(
    checkpoint,
    {
      manifest_sha256: bundleHash,
      manifest_bundle_sha256: bundleHash,
      protocol,
      checkpoint_semantics:
        "Mixed-profile checkpoint: identify each row by ablation_profile, source_manifest_sha256, pair_id; no automatic retries or resume",
    },
    (append) =>
      executeExperiment(plan, { apiKey: process.env.TYPESAFE_API_KEY!, concurrency, append }),
  );
  const summary = summarizeExperiment(observations, profiles as ProfileId[]);
  const report = {
    schema_version: 1,
    experiment: "jev-1.14-prompt-ablation",
    created_at: new Date().toISOString(),
    protocol,
    manifest_bundle_sha256: bundleHash,
    checkpoint_sha256: await sha256File(checkpoint),
    checkpoint_metadata_sha256: await sha256File(`${checkpoint}.metadata.json`),
    ...summary,
    observations,
  };
  await mkdir(dirname(out), { recursive: true });
  await writeFile(`${out}.json`, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
  const lines = [
    "# Jev 1.14 prompt ablation",
    "",
    "One fixed pass; no threshold tuning. The baseline is fresh. Dual-noul changes representation and determinability policy as well as wording; no isolated prompt-only conclusion follows from that arm.",
    "",
    "| Profile | Dataset | Pairs | Precision | Recall | F1 | Clear-negative coverage | Uncertain | Errors | AUROC |",
    "|---|---|---:|---:|---:|---:|---:|---:|---:|---:|",
  ];
  const f = (n: number | null) => (n === null ? "n/a" : n.toFixed(4));
  for (const [profile, metrics] of Object.entries(summary.by_profile))
    for (const [dataset, m] of Object.entries(metrics.by_dataset))
      lines.push(
        `| ${profile} | ${dataset} | ${m.denominator} | ${f(m.precision.value)} | ${f(m.recall.value)} | ${f(m.f1)} | ${f(m.clear_negative_coverage.value)} | ${f(m.uncertainty.value)} | ${m.errors} | ${f(m.auroc)} |`,
      );
  lines.push(
    "",
    "## All-case execution and explicit contract diagnostics",
    "",
    "| Profile | Dataset | All cases | Completed | Errors | Expected-uncertain excluded from binary | Expected-verdict accuracy | Uncertain-target recall |",
    "|---|---|---:|---:|---:|---:|---:|---:|",
  );
  for (const [profile, metrics] of Object.entries(summary.by_profile))
    for (const [dataset, m] of Object.entries(metrics.execution_and_contract_by_dataset))
      lines.push(
        `| ${profile} | ${dataset} | ${m.all_cases} | ${m.completed} | ${m.errors} | ${m.binary_quality_excluded_expected_uncertain} | ${f(m.explicit_expected_verdict_accuracy.value)} | ${f(m.expected_uncertain_recall.value)} |`,
      );
  lines.push(
    "",
    "JSON preserves every probability, native Noul output, compiled payload hash/bytes, exact model identity, usage, source manifests, error/exclusion and paired changes against the fresh baseline. Synthetic fixtures are reported separately; explicit expected-uncertain cases are excluded from binary quality, ranking and calibration, retained in all-case completion and expected-verdict diagnostics. This is exploratory development evaluation, not held-out or production qualification; billing is unknown unless returned.",
  );
  await writeFile(`${out}.md`, `${lines.join("\n")}\n`, { flag: "wx" });
  process.stdout.write(
    `Wrote ${observations.length} prompt-ablation observations; ${observations.filter((x) => x.prediction.status === "error").length} errors.\n`,
  );
}
main().catch(() => {
  process.stderr.write(
    "Prompt ablation failed. Retained checkpoints, if created, preserve completed requests. Check explicit budgets, profile/manifests and output paths; use --help.\n",
  );
  process.exitCode = 1;
});
