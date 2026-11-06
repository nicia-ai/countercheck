import { spawn } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { gzipSync, gunzipSync } from "node:zlib";
import { parseArgs, positiveInteger } from "../eval/args.js";
import { sha256, validateManifest, type Manifest } from "../eval/types.js";
import { sourceFingerprint } from "../eval/iteration/fingerprint.js";
import { assertDisjointFromTraining, groupKey, contentKey } from "../eval/iteration/calibrate.js";
import {
  matchedPredictions,
  redactCalibrationRow,
  remapPrediction,
} from "../eval/calibration-study/scoring.js";
import {
  NACE_CALIBRATION_MODELS,
  NACE_SENSITIVITY_RATES,
  fitNacePolicies,
  calibrationSummary,
  accountRejection,
} from "../eval/calibration-study/nace.js";

const PREP = "eval/results/calibration-preparation-2026-11-05";
const BENCHMARK = "eval/results/nace-2026-11-06";
const DATASETS = ["vitaminc", "scifact", "contractnli", "mnli"];
const json = (v: unknown) => JSON.stringify(v, null, 2) + "\n";
const read = async (p: string) => JSON.parse(await readFile(p, "utf8"));
const digest = async (p: string) => sha256(await readFile(p));

async function childRun(
  model: string,
  role: string,
  manifest: { path: string; pairs: number },
  prefix: string,
  interval: number,
  reservation: number,
) {
  const statusPath = `${prefix}.http-status.jsonl`;
  await new Promise<void>((done, reject) => {
    const child = spawn(
      process.execPath,
      [
        "--import",
        "tsx",
        "--import",
        resolve("eval/register-http-status.ts"),
        resolve("scripts/eval.ts"),
        "--backend",
        "nace",
        "--model",
        model,
        "--manifest",
        manifest.path,
        "--profile",
        "balanced-v1",
        "--live",
        "--interval-ms",
        String(interval),
        "--max-calls",
        String(manifest.pairs),
        "--cost-per-call-usd",
        String(reservation),
        "--max-spend-usd",
        String(manifest.pairs * reservation),
        "--out",
        prefix,
      ],
      {
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, COUNTERCHECK_EVAL_HTTP_STATUS_PATH: statusPath },
      },
    );
    child.stdout.resume();
    child.stderr.resume();
    let busy = false,
      finished = false,
      consumed = 0,
      rejected = false;
    const timer = setInterval(() => {
      if (busy || finished) return;
      busy = true;
      void readFile(statusPath, "utf8")
        .then((text) => {
          if (finished) return;
          const last = text.lastIndexOf("\n") + 1;
          const fresh = text.slice(consumed, last);
          consumed = last;
          if (
            fresh
              .split("\n")
              .filter(Boolean)
              .some((line) => accountRejection(JSON.parse(line).status))
          ) {
            rejected = true;
            child.kill("SIGTERM");
          }
        })
        .catch((error: NodeJS.ErrnoException) => {
          if (error.code !== "ENOENT" && !finished) {
            rejected = true;
            child.kill("SIGTERM");
          }
        })
        .finally(() => {
          busy = false;
        });
    }, 1000);
    child.once("error", () => {
      finished = true;
      clearInterval(timer);
      reject(new Error("Evaluation child failed to start"));
    });
    child.once("close", (code) => {
      finished = true;
      clearInterval(timer);
      if (code !== 0 || rejected)
        reject(new Error(`Stopped ${model}/${role}; partial checkpoints retained; no retry`));
      else done();
    });
  });
  const statusText = await readFile(statusPath, "utf8");
  if (
    statusText
      .trim()
      .split("\n")
      .some((s) => accountRejection(JSON.parse(s).status))
  )
    throw new Error("Account/rate rejection; checkpoints retained; no retry");
}

async function main() {
  const args = parseArgs(
    process.argv.slice(2),
    ["live", "out", "archive", "max-calls", "cost-per-call-usd", "max-spend-usd", "interval-ms"],
    ["live"],
  );
  if (!args.live || !args.out || !args.archive || !process.env.NACE_API_KEY?.trim())
    throw new Error("Explicit live opt-in, fresh output/archive and Nace key required");
  const original = await read(`${PREP}/protocol.json`);
  if ((await digest(`${PREP}/cohort-registry.json`)) !== original.registry_sha256)
    throw new Error("Original cohort registry changed");
  const manifests: Record<string, Manifest> = Object.fromEntries(
    await Promise.all(
      ["fit", "validation"].map(async (role) => {
        const input = original.manifests[role];
        if ((await digest(input.path)) !== input.sha256) throw new Error("Frozen manifest changed");
        const manifest = validateManifest(await read(input.path));
        if (
          manifest.purpose !== "development" ||
          manifest.pairs.length !== input.pairs ||
          manifest.pairs.some((p) => !DATASETS.includes(p.dataset))
        )
          throw new Error("Unexpected calibration cohort");
        return [role, manifest] as const;
      }),
    ),
  );
  if (manifests.fit!.pairs.length !== 2512 || manifests.validation!.pairs.length !== 688)
    throw new Error("Expected original fit/validation cohort sizes");
  assertDisjointFromTraining(manifests.validation!.pairs, {
    training_groups: manifests.fit!.pairs.map(groupKey),
    training_sources: manifests.fit!.pairs.map((p) => `${p.dataset}:${p.source_id}`),
    training_content: manifests.fit!.pairs.map(contentKey),
  });
  const planned = (2512 + 688) * NACE_CALIBRATION_MODELS.length;
  const maxCalls = positiveInteger(args["max-calls"], 0, "max-calls");
  const interval = positiveInteger(args["interval-ms"], 550, "interval-ms");
  const reservation = Number(args["cost-per-call-usd"]),
    cap = Number(args["max-spend-usd"]);
  if (
    maxCalls < planned ||
    interval < 550 ||
    !Number.isFinite(reservation) ||
    reservation <= 0 ||
    !Number.isFinite(cap) ||
    cap <= 0 ||
    planned * reservation > cap
  )
    throw new Error("Invalid call/spend/free-tier pacing reservation");
  const catalogResponse = await fetch("https://console.nace.ai/v1/models", {
    headers: { authorization: `Bearer ${process.env.NACE_API_KEY}` },
    redirect: "manual",
    signal: AbortSignal.timeout(15000),
  });
  if (!catalogResponse.ok) {
    await catalogResponse.body?.cancel();
    throw new Error("Catalog unavailable; no inference started");
  }
  const catalog = (await catalogResponse.json()) as {
    models: { name: string; alias_for: string | null }[];
  };
  if (
    NACE_CALIBRATION_MODELS.some(
      (id) => !catalog.models.some((m) => m.name === id && m.alias_for === null),
    )
  )
    throw new Error("Required active models unavailable");
  const sourceFiles = {
    ...(await sourceFingerprint(process.cwd(), "scripts/run-nace-calibration.ts")),
    ...(await sourceFingerprint(process.cwd(), "scripts/eval.ts")),
    ...(await sourceFingerprint(process.cwd(), "eval/register-http-status.ts")),
  };
  const snapshot = Object.fromEntries(
    await Promise.all(
      Object.keys(sourceFiles).map(async (p) => [p, await readFile(p, "utf8")] as const),
    ),
  );
  if (Object.entries(snapshot).some(([p, text]) => sha256(text) !== sourceFiles[p]))
    throw new Error("Source snapshot changed");
  const out = resolve(args.out),
    archive = resolve(args.archive);
  await mkdir(out, { recursive: false, mode: 0o700 });
  await mkdir(archive, { recursive: false });
  const save = (name: string, value: unknown) =>
    writeFile(join(archive, name), json(value), { flag: "wx" });
  const checkSources = async () => {
    for (const [path, h] of Object.entries(sourceFiles))
      if ((await digest(path)) !== h)
        throw new Error("Frozen inference/fitting source changed; stopped");
    for (const input of Object.values(original.manifests) as { path: string; sha256: string }[])
      if ((await digest(input.path)) !== input.sha256)
        throw new Error("Frozen input changed; stopped");
  };
  await save("protocol.json", {
    schema_version: 1,
    created_at: new Date().toISOString(),
    recorded_before_inference: true,
    user_authorization: "Let's advance them: Drex Max and Max Finance into the calibration study",
    models: [...NACE_CALIBRATION_MODELS],
    manifests: original.manifests,
    parent_preparation: {
      path: PREP,
      protocol_sha256: await digest(`${PREP}/protocol.json`),
      registry_sha256: await digest(`${PREP}/cohort-registry.json`),
    },
    benchmark: {
      path: BENCHMARK,
      archive_sha256: await digest(`${BENCHMARK}/archive-sha256.json`),
    },
    prior_followup_archive_sha256: await digest(
      "eval/results/calibration-followup-2026-11-06/archive-sha256.json",
    ),
    planned_calls: planned,
    max_calls: maxCalls,
    reservation_per_call_usd: reservation,
    reservation_cap_usd: cap,
    actual_billed_cost: null,
    profile: "balanced-v1",
    timeout_ms: 3000,
    passes: 1,
    presentation: "original",
    batch_size: 1,
    concurrency: 1,
    interval_ms: interval,
    pacing_outside_latency: true,
    cross_cohort_gap_ms: interval,
    retries: 0,
    fallback: false,
    positive_policy:
      "Existing selectThresholds: maximize fit true positives at observed precision >=.95; ties by precision then higher cutoff; observed values plus .01 grid; disable if none qualifies",
    negative_policy:
      "Per-model primary maximizes fit clear negatives subject to no more fit false clears than that model's shipped balanced-v1 fit result; positive precedence; same frozen negative grid/tie order",
    sensitivity_rates: [...NACE_SENSITIVITY_RATES],
    sequence:
      "Both fit runs, then freeze policies and fit-artifact hashes, then both validation runs, then offline scoring; no validation-driven reselection",
    exposure:
      "Models selected after Nace 920-case benchmarks and prior nine-model calibration results. Reuses previously studied public train fit/validation cohorts, not a newly untouched test. Primary budget definition fixed before Nace fit and validation; inherited from the earlier post-hoc nine-model follow-up. Finance transfer only; no new human adjudication or locked-role opening.",
    source_files: sourceFiles,
    node: process.version,
  });
  await writeFile(join(archive, "execution-sources.json.gz"), gzipSync(json(snapshot)), {
    flag: "wx",
  });
  const completed: {
    model: string;
    role: string;
    pairs: number;
    errors: number;
    prefix: string;
    started_at: string;
    completed_at: string;
  }[] = [];
  const policies: Record<string, ReturnType<typeof fitNacePolicies>> = {};
  let freezeHash: string | undefined;
  for (const role of ["fit", "validation"] as const) {
    const rowsForRole = [],
      checkpoints: Record<string, unknown> = {};
    for (const model of NACE_CALIBRATION_MODELS) {
      await checkSources();
      if (
        role === "validation" &&
        (!freezeHash || (await digest(join(archive, "policies.json"))) !== freezeHash)
      )
        throw new Error("Policy freeze changed or missing");
      const prefix = join(out, `${model}.${role}`),
        startedAt = new Date().toISOString();
      await writeFile(
        join(out, "progress.json"),
        json({
          status: "running",
          current: { model, role, prefix, pairs: original.manifests[role].pairs },
          completed,
        }),
      );
      console.log(
        json({
          event: "calibration_run_started",
          model,
          role,
          pairs: original.manifests[role].pairs,
        }).trim(),
      );
      await childRun(model, role, original.manifests[role], prefix, interval, reservation);
      const predictionText = await readFile(`${prefix}.predictions.jsonl`, "utf8"),
        metadataText = await readFile(`${prefix}.predictions.jsonl.metadata.json`, "utf8"),
        statusText = await readFile(`${prefix}.http-status.jsonl`, "utf8");
      const rows = matchedPredictions(
        predictionText
          .trim()
          .split("\n")
          .map((s) => JSON.parse(s)),
        manifests[role]!.pairs,
        model,
      );
      if (rows.some((r) => r.prediction.status === "ok" && r.prediction.reported_model !== model))
        throw new Error("Reported model changed");
      if (role === "fit") {
        policies[model] = fitNacePolicies(rows);
        if (policies[model]!.positive_fit_pairs !== 771)
          throw new Error("Fit positive denominator changed");
      }
      checkpoints[model] = {
        predictions_utf8: predictionText,
        metadata_utf8: metadataText,
        http_status_utf8: statusText,
        predictions_sha256: sha256(predictionText),
        metadata_sha256: sha256(metadataText),
        http_status_sha256: sha256(statusText),
      };
      rowsForRole.push(
        ...rows.map(({ pair, prediction }) => ({
          model,
          dataset: pair.dataset,
          row: redactCalibrationRow(pair, prediction),
        })),
      );
      completed.push({
        model,
        role,
        pairs: rows.length,
        errors: rows.filter((r) => r.prediction.status !== "ok").length,
        prefix,
        started_at: startedAt,
        completed_at: new Date().toISOString(),
      });
      console.log(json({ event: "calibration_run_completed", ...completed.at(-1) }).trim());
      await delay(interval);
    }
    await checkSources();
    await writeFile(
      join(archive, `${role}-observations.redacted.jsonl.gz`),
      gzipSync(rowsForRole.map((r) => JSON.stringify(r)).join("\n") + "\n"),
      { flag: "wx" },
    );
    await writeFile(join(archive, `${role}-checkpoints.json.gz`), gzipSync(json(checkpoints)), {
      flag: "wx",
    });
    if (role === "fit") {
      await save("policies.json", { selection_uses_validation: false, policies });
      freezeHash = await digest(join(archive, "policies.json"));
      await save("policy-freeze.json", {
        frozen_at: new Date().toISOString(),
        policies_sha256: freezeHash,
        protocol_sha256: await digest(join(archive, "protocol.json")),
        fit_observations_sha256: await digest(join(archive, "fit-observations.redacted.jsonl.gz")),
        fit_checkpoints_sha256: await digest(join(archive, "fit-checkpoints.json.gz")),
        validation_inference_started: false,
      });
      console.log(
        json({
          event: "policies_frozen",
          policies: Object.fromEntries(
            Object.entries(policies).map(([m, p]) => [
              m,
              {
                positive: p.positive,
                primary_budget: p.primary_budget,
                primary: p.variants.primary,
              },
            ]),
          ),
        }).trim(),
      );
    }
  }
  const archived = gunzipSync(await readFile(`${BENCHMARK}/observations.redacted.jsonl.gz`))
    .toString("utf8")
    .trim()
    .split("\n")
    .map((s) => JSON.parse(s));
  const scorecards = [];
  for (const role of ["fit", "validation", "archive"] as const) {
    const observations =
      role === "archive"
        ? archived
        : gunzipSync(await readFile(join(archive, `${role}-observations.redacted.jsonl.gz`)))
            .toString("utf8")
            .trim()
            .split("\n")
            .map((s) => JSON.parse(s));
    const datasets = role === "archive" ? [...DATASETS, "findver"] : DATASETS;
    for (const model of NACE_CALIBRATION_MODELS)
      for (const dataset of [...datasets, "all"]) {
        const rows = observations
          .filter(
            (r) =>
              r.model === model &&
              datasets.includes(r.dataset) &&
              (dataset === "all" || r.dataset === dataset),
          )
          .map((r) => r.row);
        for (const [variant, entry] of Object.entries(policies[model]!.variants))
          scorecards.push({
            role,
            model,
            dataset,
            variant,
            shipped: calibrationSummary(rows),
            calibrated: calibrationSummary(
              rows.map((r) => ({ ...r, prediction: remapPrediction(r.prediction, entry.policy) })),
            ),
          });
      }
  }
  await checkSources();
  await save("metric-crosscheck.json", { scorecards });
  await save("execution.json", {
    completed,
    completed_at: new Date().toISOString(),
    total_assessments: completed.reduce((n, r) => n + r.pairs, 0),
  });
  await writeFile(join(out, "progress.json"), json({ status: "complete", completed }));
  console.log(
    json({
      event: "nace_calibration_complete",
      observations: planned,
      scorecards: scorecards.length,
    }).trim(),
  );
}
main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : "Calibration stopped; checkpoints retained",
  );
  process.exitCode = 1;
});
