import { readFile, writeFile } from "node:fs/promises";
import { gzipSync, gunzipSync } from "node:zlib";
import { metrics, type Scored } from "../eval/metrics.js";
import { remapPrediction } from "../eval/calibration-study/scoring.js";
import { exclusiveJson } from "../eval/engineering/manifests.js";
import { sourceFingerprint } from "../eval/iteration/fingerprint.js";
import type { ThresholdPolicy } from "../eval/iteration/calibrate.js";
import { sha256 } from "../eval/types.js";

const OUT = "eval/results/separate-calibration-2026-11-05";
type Observation = { model: string; dataset: string; row: Scored };
async function main() {
  const policies = JSON.parse(await readFile(`${OUT}/policies.json`, "utf8")) as {
    policies: Record<string, { policy: ThresholdPolicy }>;
  };
  const sourceFiles = await sourceFingerprint(process.cwd(), "scripts/score-calibration-study.ts");
  const snapshot = Object.fromEntries(
    await Promise.all(
      Object.keys(sourceFiles).map(async (p) => [p, await readFile(p, "utf8")] as const),
    ),
  );
  if (Object.entries(snapshot).some(([p, text]) => sha256(text) !== sourceFiles[p]))
    throw new Error("Scorer source changed");
  const scorecards = [];
  for (const role of ["fit", "validation", "archive"]) {
    const path =
      role === "archive"
        ? "eval/results/hosted-models-with-glide-2026-11-05/observations.redacted.jsonl.gz"
        : `${OUT}/${role}-observations.redacted.jsonl.gz`;
    const observations = gunzipSync(await readFile(path))
      .toString("utf8")
      .trim()
      .split("\n")
      .map((s) => JSON.parse(s) as Observation);
    const datasets =
      role === "archive"
        ? ["vitaminc", "scifact", "contractnli", "mnli", "findver"]
        : ["vitaminc", "scifact", "contractnli", "mnli"];
    for (const [model, { policy }] of Object.entries(policies.policies)) {
      const original = observations.filter(
        (o) => o.model === model && datasets.includes(o.dataset),
      );
      for (const dataset of [...datasets, "all"]) {
        const rows = original
          .filter((o) => dataset === "all" || o.dataset === dataset)
          .map((o) => o.row);
        const summarize = (values: Scored[]) => {
          const m = metrics(values);
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
            uncertain: values.filter(
              (r) => r.prediction.status === "ok" && r.prediction.verdict === "uncertain",
            ).length,
            precision: m.precision.value,
            recall: m.recall.value,
            f1: m.f1,
            clear_negative_coverage: m.clear_negative_coverage.value,
            false_clear_rate: m.positive
              ? m.confusion.definitive_false_negative / m.positive
              : null,
          };
        };
        scorecards.push({
          role,
          model,
          dataset,
          shipped: summarize(rows),
          calibrated: summarize(
            rows.map((r) => ({ ...r, prediction: remapPrediction(r.prediction, policy) })),
          ),
        });
      }
    }
  }
  if (
    JSON.stringify(await sourceFingerprint(process.cwd(), "scripts/score-calibration-study.ts")) !==
    JSON.stringify(sourceFiles)
  )
    throw new Error("Scorer changed during execution");
  await writeFile(`${OUT}/metric-crosscheck-sources.json.gz`, gzipSync(JSON.stringify(snapshot)), {
    flag: "wx",
  });
  await exclusiveJson(`${OUT}/metric-crosscheck.json`, { source_files: sourceFiles, scorecards });
  console.log(`Scored ${scorecards.length} cohorts using the existing TypeScript metric engine.`);
}
main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Offline scorer failed");
  process.exitCode = 1;
});
