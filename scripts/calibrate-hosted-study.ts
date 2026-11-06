import { readFile, writeFile, mkdir } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { sha256, validateManifest } from "../eval/types.js";
import { sourceFingerprint } from "../eval/iteration/fingerprint.js";
import { exclusiveJson } from "../eval/engineering/manifests.js";
import {
  matchedPredictions,
  fitOperatingPolicy,
  redactCalibrationRow,
} from "../eval/calibration-study/scoring.js";

const PREP = "eval/results/calibration-preparation-2026-11-05";
const OUT = "eval/results/separate-calibration-2026-11-05";
const digest = async (path: string) => sha256(await readFile(path));
const json = (value: unknown) => JSON.stringify(value, null, 2) + "\n";
type Protocol = {
  source_files: Record<string, string>;
  manifests: Record<string, { path: string; sha256: string; pairs: number }>;
  accounting: { models: { model: string }[] };
};

async function main() {
  const role = process.argv[2];
  if (!["fit", "validation"].includes(role ?? ""))
    throw new Error("Use fit or validation; offline only");
  const protocol = JSON.parse(await readFile(`${PREP}/protocol.json`, "utf8")) as Protocol;
  const sourceFiles = await sourceFingerprint(process.cwd(), "scripts/calibrate-hosted-study.ts");
  const sourceSnapshot = Object.fromEntries(
    await Promise.all(
      Object.keys(sourceFiles).map(async (p) => [p, await readFile(p, "utf8")] as const),
    ),
  );
  if (Object.entries(sourceSnapshot).some(([p, text]) => sha256(text) !== sourceFiles[p]))
    throw new Error("Fitting sources changed during initial snapshot");
  const protocolHash = await digest(`${PREP}/protocol.json`);
  const approval = JSON.parse(await readFile(`${PREP}/approval.json`, "utf8"));
  if (approval.protocol_sha256 !== protocolHash || approval.owner_approval !== "Approved")
    throw new Error("Approval must bind the original protocol");
  // Verify all inference and preparation sources before freezing policies. Analysis added after
  // approval has its own snapshot; it does not change the pre-inference protocol.
  for (const [path, hash] of Object.entries(protocol.source_files))
    if ((await digest(path)) !== hash) throw new Error("Pre-inference source changed: " + path);
  const input = protocol.manifests[role!]!;
  if ((await digest(input.path)) !== input.sha256) throw new Error("Manifest changed");
  const manifest = validateManifest(JSON.parse(await readFile(input.path, "utf8")));
  const observations = [];
  const artifacts: Record<
    string,
    { predictions_sha256: string; metadata_sha256: string; metadata: unknown }
  > = {};
  const policies: Record<string, ReturnType<typeof fitOperatingPolicy>> = {};
  const checkpoints: Record<string, { predictions_utf8: string; metadata_utf8: string }> = {};
  if (role === "fit") await mkdir(OUT, { recursive: false });
  else {
    const receipt = JSON.parse(await readFile(`${OUT}/policy-freeze.json`, "utf8"));
    if (receipt.policies_sha256 !== (await digest(`${OUT}/policies.json`)))
      throw new Error("Policies changed after freeze");
  }
  for (const { model } of protocol.accounting.models) {
    const slug = model.replaceAll(/[^a-zA-Z0-9-]/g, "-");
    const prefix = `eval/reports/calibration-${role}-${slug}`;
    const predictionsPath = `${prefix}.predictions.jsonl`;
    const metadataPath = `${predictionsPath}.metadata.json`;
    const metadataText = await readFile(metadataPath, "utf8");
    const metadata = JSON.parse(metadataText);
    const backend = model === "fastino/GLiDE" ? "fastino" : "hosted";
    if (
      metadata.model !== model ||
      metadata.backend !== backend ||
      metadata.manifest_sha256 !== input.sha256 ||
      metadata.source_protocol.profile !== "balanced-v1" ||
      metadata.source_protocol.passes !== 1 ||
      metadata.source_protocol.presentation !== "original" ||
      metadata.source_protocol.batch_size !== 1 ||
      metadata.source_protocol.concurrency !== 1 ||
      metadata.source_protocol.timeout_ms !== 3000
    )
      throw new Error("Execution differs from protocol");
    const predictionText = await readFile(predictionsPath, "utf8");
    const predictions = predictionText
      .trim()
      .split("\n")
      .map((s) => JSON.parse(s));
    const rows = matchedPredictions(predictions, manifest.pairs, model);
    checkpoints[model] = { predictions_utf8: predictionText, metadata_utf8: metadataText };
    if (role === "fit") policies[model] = fitOperatingPolicy(rows);
    for (const { pair, prediction } of rows)
      observations.push({
        model,
        dataset: pair.dataset,
        row: redactCalibrationRow(pair, prediction),
      });
    artifacts[model] = {
      predictions_sha256: await digest(predictionsPath),
      metadata_sha256: await digest(metadataPath),
      metadata,
    };
    console.log(
      json({
        role,
        model,
        observations: rows.length,
        errors: rows.filter((r) => r.prediction.status !== "ok").length,
        ...(role === "fit" ? { policy: policies[model]!.policy } : {}),
      }).trim(),
    );
  }
  const observationPath = `${OUT}/${role}-observations.redacted.jsonl.gz`;
  if (
    JSON.stringify(await sourceFingerprint(process.cwd(), "scripts/calibrate-hosted-study.ts")) !==
    JSON.stringify(sourceFiles)
  )
    throw new Error("Fitting sources changed during scoring");
  await writeFile(
    observationPath,
    gzipSync(observations.map((r) => JSON.stringify(r)).join("\n") + "\n", {
      mtime: 0,
    } as Parameters<typeof gzipSync>[1]),
    { flag: "wx" },
  );
  await writeFile(`${OUT}/${role}-checkpoints.json.gz`, gzipSync(json(checkpoints)), {
    flag: "wx",
  });
  await exclusiveJson(`${OUT}/${role}-execution.json`, {
    manifest_sha256: input.sha256,
    artifacts,
    observations: observations.length,
    observed_at: new Date().toISOString(),
  });
  if (role === "fit") {
    await writeFile(
      `${OUT}/pre-inference-sources.json.gz`,
      gzipSync(
        json(
          Object.fromEntries(
            await Promise.all(
              Object.keys(protocol.source_files).map(async (p) => [p, await readFile(p, "utf8")]),
            ),
          ),
        ),
      ),
      { flag: "wx" },
    );
    await exclusiveJson(`${OUT}/policies.json`, {
      schema_version: 1,
      protocol_sha256: protocolHash,
      selection_uses_validation: false,
      policies,
    });
    await writeFile(`${OUT}/fitting-sources.json.gz`, gzipSync(json(sourceSnapshot)), {
      flag: "wx",
    });
    await exclusiveJson(`${OUT}/policy-freeze.json`, {
      frozen_at: new Date().toISOString(),
      protocol_sha256: protocolHash,
      policies_sha256: await digest(`${OUT}/policies.json`),
      fit_observations_sha256: await digest(observationPath),
      fitting_sources_sha256: await digest(`${OUT}/fitting-sources.json.gz`),
      pre_inference_sources_sha256: await digest(`${OUT}/pre-inference-sources.json.gz`),
      source_files: sourceFiles,
      validation_inference_started: false,
    });
  }
}
main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Offline fitting stopped");
  process.exitCode = 1;
});
