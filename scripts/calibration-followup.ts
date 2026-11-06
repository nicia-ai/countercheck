import { readFile, writeFile } from "node:fs/promises";
import { gzipSync, gunzipSync } from "node:zlib";
import { sha256, validateManifest, type Pair, type Prediction } from "../eval/types.js";
import {
  matchedPredictions,
  redactCalibrationRow,
  remapPrediction,
} from "../eval/calibration-study/scoring.js";
import { fitNegativePolicy } from "../eval/calibration-study/negative-policy.js";
import { metrics, type Scored } from "../eval/metrics.js";
import { exclusiveJson } from "../eval/engineering/manifests.js";
import { sourceFingerprint } from "../eval/iteration/fingerprint.js";
import type { ThresholdPolicy } from "../eval/iteration/calibrate.js";

const OUT = "eval/results/calibration-followup-2026-11-06";
const PRIOR = "eval/results/separate-calibration-2026-11-05";
const PREFIX = "eval/reports/calibration-followup-2026-11-06/jev-validation-v2";
const json = (v: unknown) => JSON.stringify(v, null, 2) + "\n";
const readJson = async (p: string) => JSON.parse(await readFile(p, "utf8"));
type Observation = { model: string; dataset: string; row: Scored };
async function observations(path: string): Promise<Observation[]> {
  return gunzipSync(await readFile(path))
    .toString("utf8")
    .trim()
    .split("\n")
    .map((s) => JSON.parse(s));
}
function summary(rows: Scored[]) {
  const m = metrics(rows);
  return {
    selected: m.denominator,
    completed: m.denominator - m.errors - m.excluded,
    positive: m.positive,
    negative: m.negative,
    tp: m.confusion.true_positive,
    fp: m.confusion.false_positive,
    tn: m.confusion.true_negative,
    false_clears: m.confusion.definitive_false_negative,
    errors: m.errors,
    excluded: m.excluded,
    uncertain: rows.filter(
      (r) => r.prediction.status === "ok" && r.prediction.verdict === "uncertain",
    ).length,
    precision: m.precision.value,
    recall: m.recall.value,
    f1: m.f1,
    clear_negative_coverage: m.clear_negative_coverage.value,
    false_clear_rate: m.positive ? m.confusion.definitive_false_negative / m.positive : null,
  };
}
async function main() {
  const sourceFiles = await sourceFingerprint(process.cwd(), "scripts/calibration-followup.ts");
  const sourceSnapshot = Object.fromEntries(
    await Promise.all(
      Object.keys(sourceFiles).map(async (p) => [p, await readFile(p, "utf8")] as const),
    ),
  );
  if (Object.entries(sourceSnapshot).some(([p, s]) => sha256(s) !== sourceFiles[p]))
    throw new Error("Source snapshot changed");
  const protocol = await readJson(`${OUT}/protocol.json`);
  if (
    sha256(await readFile(`${PRIOR}/archive-sha256.json`)) !== protocol.prior_archive_sha256 ||
    sha256(await readFile(`${PRIOR}/policies.json`)) !== protocol.prior_policies_sha256
  )
    throw new Error("Original artifacts changed");
  if (sha256(await readFile(protocol.manifest.path)) !== protocol.manifest.sha256)
    throw new Error("Manifest changed");
  const manifest = validateManifest(await readJson(protocol.manifest.path));
  const predictionText = await readFile(`${PREFIX}.predictions.jsonl`, "utf8");
  const metadataText = await readFile(`${PREFIX}.predictions.jsonl.metadata.json`, "utf8");
  const statusText = await readFile(`${PREFIX}.http-status.jsonl`, "utf8");
  const metadata = JSON.parse(metadataText);
  if (metadata.model !== protocol.model || metadata.manifest_sha256 !== protocol.manifest.sha256)
    throw new Error("Rerun attribution changed");
  const rerun = matchedPredictions(
    predictionText
      .trim()
      .split("\n")
      .map((s) => JSON.parse(s)),
    manifest.pairs,
    protocol.model,
  );
  const statusRows = statusText
    .trim()
    .split("\n")
    .map((s) => JSON.parse(s));
  if (
    statusRows.length !== 688 ||
    statusRows.some(
      (r, i) =>
        r.sequence !== i + 1 ||
        Object.keys(r).sort().join() !== "sequence,status" ||
        !(r.status === null || (Number.isInteger(r.status) && r.status >= 100 && r.status <= 599)),
    )
  )
    throw new Error("Invalid status-only diagnostic coverage");
  const replacement = rerun.map(({ pair, prediction }) => ({
    model: protocol.model as string,
    dataset: pair.dataset,
    row: redactCalibrationRow(pair, prediction),
  }));
  await writeFile(
    `${OUT}/jev-validation.redacted.jsonl.gz`,
    gzipSync(replacement.map((r) => JSON.stringify(r)).join("\n") + "\n"),
    { flag: "wx" },
  );
  await writeFile(
    `${OUT}/jev-checkpoint.json.gz`,
    gzipSync(
      json({
        predictions_utf8: predictionText,
        metadata_utf8: metadataText,
        http_status_utf8: statusText,
      }),
    ),
    { flag: "wx" },
  );
  await exclusiveJson(`${OUT}/rerun-receipt.json`, {
    observed_at: new Date().toISOString(),
    predictions_sha256: sha256(predictionText),
    metadata_sha256: sha256(metadataText),
    http_status_sha256: sha256(statusText),
    assessments: rerun.length,
    successes: rerun.filter((r) => r.prediction.status === "ok").length,
    max_calls: 688,
    reservation_usd: 1.38,
    actual_billed_cost: null,
  });
  const fit = await observations(`${PRIOR}/fit-observations.redacted.jsonl.gz`);
  const validation = (await observations(`${PRIOR}/validation-observations.redacted.jsonl.gz`))
    .filter((r) => r.model !== protocol.model)
    .concat(replacement);
  const archive = await observations(
    "eval/results/hosted-models-with-glide-2026-11-05/observations.redacted.jsonl.gz",
  );
  const old = (await readJson(`${PRIOR}/policies.json`)).policies as Record<
    string,
    { policy: ThresholdPolicy }
  >;
  const policies: Record<
    string,
    Record<string, { policy: ThresholdPolicy; allowed_fit_false_clears: number }>
  > = {};
  const scorecards = [];
  for (const [model, original] of Object.entries(old)) {
    const rows = fit.filter((r) => r.model === model).map((r) => r.row);
    const positives = rows.filter((r) => r.pair.gold === "contradiction").length;
    const shipped = summary(rows);
    if (
      positives !== 771 ||
      shipped.false_clears !== protocol.negative_analysis.primary_budget_counts[model]
    )
      throw new Error("Shipped budget does not match fit artifacts");
    const budgets: Record<string, number> = { primary: shipped.false_clears };
    for (const rate of protocol.negative_analysis.sensitivity_rates as number[])
      budgets[`rate_${rate}`] = Math.floor(rate * positives);
    policies[model] = {};
    for (const [variant, budget] of Object.entries(budgets)) {
      const policy = fitNegativePolicy(
        rows as { pair: Pair; prediction: Prediction }[],
        original.policy.positive,
        budget,
      );
      if (variant === "rate_0" && JSON.stringify(policy) !== JSON.stringify(original.policy))
        throw new Error("Zero-budget control does not reproduce frozen policy");
      policies[model]![variant] = { policy, allowed_fit_false_clears: budget };
    }
    for (const [role, observations] of [
      ["fit", fit],
      ["validation", validation],
      ["archive", archive],
    ] as const) {
      const datasets =
        role === "archive"
          ? ["vitaminc", "scifact", "contractnli", "mnli", "findver"]
          : ["vitaminc", "scifact", "contractnli", "mnli"];
      for (const dataset of [...datasets, "all"]) {
        const selected = observations
          .filter(
            (r) =>
              r.model === model &&
              datasets.includes(r.dataset) &&
              (dataset === "all" || dataset === r.dataset),
          )
          .map((r) => r.row);
        const baseline = summary(selected);
        for (const [variant, { policy }] of Object.entries(policies[model]!))
          scorecards.push({
            role,
            model,
            dataset,
            variant,
            shipped: baseline,
            calibrated: summary(
              selected.map((r) => ({ ...r, prediction: remapPrediction(r.prediction, policy) })),
            ),
          });
      }
    }
  }
  if (
    JSON.stringify(await sourceFingerprint(process.cwd(), "scripts/calibration-followup.ts")) !==
    JSON.stringify(sourceFiles)
  )
    throw new Error("Fitting sources changed during execution");
  await exclusiveJson(`${OUT}/negative-policies.json`, {
    protocol_sha256: sha256(await readFile(`${OUT}/protocol.json`)),
    primary_chosen_after_validation_seen: true,
    positive_cutoffs_unchanged: true,
    policies,
  });
  await exclusiveJson(`${OUT}/metric-crosscheck.json`, { scorecards });
  await writeFile(`${OUT}/analysis-ts-sources.json.gz`, gzipSync(json(sourceSnapshot)), {
    flag: "wx",
  });
  await exclusiveJson(`${OUT}/analysis-ts-receipt.json`, {
    source_files: sourceFiles,
    snapshot_sha256: sha256(await readFile(`${OUT}/analysis-ts-sources.json.gz`)),
  });
  console.log(
    `Archived ${rerun.length} fresh Jev assessments; fitted ${Object.keys(old).length} model policies across six budgets; scored ${scorecards.length} cohorts. No inference performed by this command.`,
  );
}
main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Follow-up archive failed");
  process.exitCode = 1;
});
