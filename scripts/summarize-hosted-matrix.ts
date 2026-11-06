import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { gzipSync } from "node:zlib";
import { parseArgs } from "../eval/args.js";
import { sha256File } from "../eval/files.js";
import { summarize, type Scored } from "../eval/metrics.js";
import { isUncertainFixture, sha256, validateManifest } from "../eval/types.js";

type Protocol = {
  models: { id: string; name: string; provider: string }[];
  inputs: { id: string; path: string; sha256: string; pairs: number; purpose: string }[];
  sources: Record<string, string>;
  planned_calls: number;
};
const percent = (value: number | null) => (value === null ? "n/a" : `${(100 * value).toFixed(1)}%`);
const cell = (value: number | null) => (value === null ? "—" : (100 * value).toFixed(1));
function compact(row: Scored): Scored & { text_provenance: unknown } {
  const p = row.pair;
  const meta = Object.fromEntries(
    Object.entries(p.source_metadata ?? {}).filter(([key]) =>
      [
        "genre",
        "hypothesis_id",
        "case",
        "expected_verdict",
        "label_status",
        "binary_label_policy",
      ].includes(key),
    ),
  );
  return {
    pair: {
      id: p.id,
      dataset: p.dataset,
      variant: p.variant,
      split: p.split,
      source_id: p.source_id,
      group_id: p.group_id,
      gold: p.gold,
      native_label: p.native_label,
      claim: "[not archived: input text hashes below]",
      evidence: "[not archived: input text hashes below]",
      source_metadata: meta,
    },
    prediction: row.prediction,
    text_provenance: {
      claim_sha256: sha256(p.claim),
      claim_utf8_bytes: Buffer.byteLength(p.claim),
      evidence_sha256: sha256(p.evidence),
      evidence_utf8_bytes: Buffer.byteLength(p.evidence),
    },
  };
}
async function main() {
  const args = parseArgs(process.argv.slice(2), ["in", "out"], []);
  if (!args.in || !args.out) throw new Error("Required --in completed-matrix --out fresh-archive");
  const input = resolve(args.in);
  const output = resolve(args.out);
  const protocol = JSON.parse(await readFile(join(input, "protocol.json"), "utf8")) as Protocol;
  const progress = JSON.parse(await readFile(join(input, "progress.json"), "utf8"));
  if (
    progress.status !== "complete" ||
    progress.completed.length !== protocol.models.length * protocol.inputs.length
  )
    throw new Error("Matrix is incomplete; no final comparison produced.");
  for (const [path, hash] of Object.entries(protocol.sources))
    if ((await sha256File(path)) !== hash)
      throw new Error(`Frozen execution source changed: ${path}`);
  const manifests = new Map<string, ReturnType<typeof validateManifest>>();
  for (const dataset of protocol.inputs) {
    if ((await sha256File(dataset.path)) !== dataset.sha256)
      throw new Error("Input manifest hash changed");
    manifests.set(dataset.id, validateManifest(JSON.parse(await readFile(dataset.path, "utf8"))));
  }
  const strict = validateManifest(
    JSON.parse(await readFile("eval/data/business/findver-testmini-ie-23.json", "utf8")),
  );
  const strictHash = await sha256File("eval/data/business/findver-testmini-ie-23.json");
  const strictById = new Map(strict.pairs.map((pair) => [pair.id, pair]));
  const runs: Record<string, unknown>[] = [];
  const operations: Record<string, unknown>[] = [];
  const archived: { model: string; dataset: string; row: ReturnType<typeof compact> }[] = [];
  const artifacts: Record<string, string> = {};
  let observations = 0;
  for (const model of protocol.models) {
    const operationalRows: Scored[] = [];
    for (const dataset of protocol.inputs) {
      const prefix = join(input, `${model.id.replaceAll("/", "--")}.${dataset.id}`);
      const report = JSON.parse(await readFile(`${prefix}.json`, "utf8")) as {
        rows: Scored[];
        manifest_sha256: string;
        prediction_artifact: { sha256: string; metadata_sha256: string };
        diagnostics: unknown;
      };
      if (report.manifest_sha256 !== dataset.sha256 || report.rows.length !== dataset.pairs)
        throw new Error("Report input mismatch");
      const checkpoint = (await readFile(`${prefix}.predictions.jsonl`, "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      const savedById = new Map(checkpoint.map((prediction) => [prediction.pair_id, prediction]));
      if (
        checkpoint.length !== dataset.pairs ||
        savedById.size !== dataset.pairs ||
        report.rows.some(
          (row) => JSON.stringify(row.prediction) !== JSON.stringify(savedById.get(row.pair.id)),
        )
      )
        throw new Error("Report predictions differ from checkpoint");
      const checkpointHash = await sha256File(`${prefix}.predictions.jsonl`);
      const metadataHash = await sha256File(`${prefix}.predictions.jsonl.metadata.json`);
      if (
        checkpointHash !== report.prediction_artifact.sha256 ||
        metadataHash !== report.prediction_artifact.metadata_sha256
      )
        throw new Error("Checkpoint hash mismatch");
      artifacts[`${model.id}/${dataset.id}/original_report`] = await sha256File(`${prefix}.json`);
      artifacts[`${model.id}/${dataset.id}/checkpoint`] = checkpointHash;
      artifacts[`${model.id}/${dataset.id}/metadata`] = metadataHash;
      const originals = new Map(manifests.get(dataset.id)!.pairs.map((pair) => [pair.id, pair]));
      const seen = new Set<string>();
      for (const row of report.rows) {
        const original = originals.get(row.pair.id);
        if (
          !original ||
          JSON.stringify(original) !== JSON.stringify(row.pair) ||
          seen.has(row.pair.id) ||
          row.prediction.pair_id !== row.pair.id ||
          row.prediction.pass !== 1
        )
          throw new Error("Pair coverage/provenance mismatch");
        if (row.prediction.status === "ok" && row.prediction.model !== model.id)
          throw new Error("Wrong model returned");
        seen.add(row.pair.id);
        archived.push({ model: model.id, dataset: dataset.id, row: compact(row) });
      }
      observations += report.rows.length;
      const scored = report.rows.filter((row) => !isUncertainFixture(row.pair));
      const summary = summarize(scored);
      const failures = Object.fromEntries(
        [
          ...new Set(
            report.rows
              .filter((r) => r.prediction.status !== "ok")
              .map((r) => r.prediction.error_code ?? "unknown"),
          ),
        ].map((code) => [
          code,
          report.rows.filter(
            (r) => r.prediction.status !== "ok" && (r.prediction.error_code ?? "unknown") === code,
          ).length,
        ]),
      );
      const sliceField =
        dataset.id === "mnli"
          ? "genre"
          : dataset.id === "contractnli"
            ? "hypothesis_id"
            : undefined;
      const slices = sliceField
        ? Object.fromEntries(
            [...new Set(scored.map((r) => r.pair.source_metadata?.[sliceField] ?? "unknown"))].map(
              (value) => [
                value,
                summarize(
                  scored.filter(
                    (r) => (r.pair.source_metadata?.[sliceField] ?? "unknown") === value,
                  ),
                ),
              ],
            ),
          )
        : {};
      runs.push({
        model: model.id,
        name: model.name,
        dataset: dataset.id,
        pairs: report.rows.length,
        pair_ids: report.rows.map((row) => row.pair.id),
        manifest_sha256: dataset.sha256,
        measurement:
          dataset.purpose === "synthetic-smoke"
            ? "synthetic_contract_diagnostic"
            : "public_native_label_adaptation",
        ...summary,
        diagnostics: report.diagnostics,
        error_codes: failures,
        slices,
        reported_models: [
          ...new Set(
            report.rows
              .filter((r) => r.prediction.status === "ok")
              .map((r) => r.prediction.reported_model ?? null),
          ),
        ],
      });
      if (dataset.purpose !== "synthetic-smoke") operationalRows.push(...report.rows);
      if (dataset.id === "findver") {
        const subset = report.rows.filter((row) => strictById.has(row.pair.id));
        if (
          subset.length !== strict.pairs.length ||
          subset.some((row) => {
            const prior = strictById.get(row.pair.id)!;
            return (
              prior.claim !== row.pair.claim ||
              prior.evidence !== row.pair.evidence ||
              prior.gold !== row.pair.gold
            );
          })
        )
          throw new Error("Finance overlap mismatch");
        runs.push({
          model: model.id,
          name: model.name,
          dataset: "findver-strict-subset",
          pairs: subset.length,
          derived_without_calls: true,
          pair_ids: subset.map((row) => row.pair.id),
          original_strict_manifest_sha256: strictHash,
          ...summarize(subset),
        });
      }
    }
    const ok = operationalRows.filter((r) => r.prediction.status === "ok");
    const times = ok.map((r) => r.prediction.latency_ms).sort((a, b) => a - b);
    const attempts = operationalRows.filter((row) => row.prediction.status !== "excluded");
    const known = attempts.filter((r) => r.prediction.input_tokens !== undefined);
    operations.push({
      model: model.id,
      name: model.name,
      selected: operationalRows.length,
      attempted: attempts.length,
      completed: ok.length,
      errors: operationalRows.filter((r) => r.prediction.status === "error").length,
      excluded: operationalRows.filter((r) => r.prediction.status === "excluded").length,
      completed_p50_ms: times[Math.floor((times.length - 1) * 0.5)] ?? null,
      completed_p95_ms: times[Math.floor((times.length - 1) * 0.95)] ?? null,
      completed_p99_ms: times[Math.floor((times.length - 1) * 0.99)] ?? null,
      known_input_tokens: known.reduce((sum, r) => sum + r.prediction.input_tokens!, 0),
      known_input_observations: known.length,
      unknown_input_observations: attempts.length - known.length,
      actual_cost_usd: null,
    });
  }
  if (observations !== protocol.planned_calls) throw new Error("Observation count mismatch");
  await mkdir(output, { recursive: false });
  await writeFile(join(output, "protocol.json"), JSON.stringify(protocol, null, 2) + "\n", {
    flag: "wx",
  });
  const executionSources = Object.fromEntries(
    await Promise.all(
      Object.keys(protocol.sources).map(
        async (path) => [path, await readFile(path, "utf8")] as const,
      ),
    ),
  );
  const analysisPaths = [
    "scripts/summarize-hosted-matrix.ts",
    "scripts/check-hosted-matrix.py",
    "eval/results/business-2026-11-04/metrics.py",
  ];
  const analysisSources = Object.fromEntries(
    await Promise.all(
      analysisPaths.map(async (path) => [path, await readFile(path, "utf8")] as const),
    ),
  );
  const analysisProvenance = {
    created_at: new Date().toISOString(),
    phase:
      "Analysis code developed during inference; snapshot recorded at post-inference archive creation, not pre-inference",
    inference_protocol_sha256: await sha256File(join(input, "protocol.json")),
    source_hashes: Object.fromEntries(
      Object.entries(analysisSources).map(([path, source]) => [path, sha256(source)]),
    ),
  };
  await writeFile(
    join(output, "execution-sources.json.gz"),
    gzipSync(JSON.stringify(executionSources)),
    { flag: "wx" },
  );
  await writeFile(
    join(output, "analysis-sources.json.gz"),
    gzipSync(JSON.stringify(analysisSources)),
    { flag: "wx" },
  );
  await writeFile(
    join(output, "analysis-provenance.json"),
    JSON.stringify(analysisProvenance, null, 2) + "\n",
    { flag: "wx" },
  );
  const catalogObservation = await readFile(join(input, "catalog-observation.json"), "utf8");
  await writeFile(join(output, "catalog-observation.json"), catalogObservation, { flag: "wx" });
  const dataProvenance = Object.fromEntries(
    protocol.inputs.map((input) => {
      const manifest = manifests.get(input.id)!;
      return [
        input.id,
        {
          manifest_sha256: input.sha256,
          adapter_version: manifest.adapter_version,
          sources: manifest.sources,
          sampling: manifest.sampling,
        },
      ];
    }),
  );
  await writeFile(
    join(output, "data-provenance.json"),
    JSON.stringify(dataProvenance, null, 2) + "\n",
    { flag: "wx" },
  );
  const safeRows = archived.map((x) => JSON.stringify(x)).join("\n") + "\n";
  await writeFile(join(output, "observations.redacted.jsonl.gz"), gzipSync(safeRows), {
    flag: "wx",
  });
  const targetResults = runs
    .filter((run) => run.measurement === "public_native_label_adaptation")
    .map((run) => {
      const m = run.overall as ReturnType<typeof summarize>["overall"];
      return {
        model: run.model,
        dataset: run.dataset,
        precision: m.precision.value,
        recall: m.recall.value,
        clear_negative_coverage: m.clear_negative_coverage.value,
        all_point_targets_met:
          (m.precision.value ?? 0) >= 0.95 &&
          (m.recall.value ?? 0) >= 0.9 &&
          (m.clear_negative_coverage.value ?? 0) >= 0.85,
      };
    });
  const summary = {
    schema_version: 1,
    observations,
    distinct_public_pairs: 880,
    synthetic_cases_per_model: 40,
    finance_strict_overlap: 23,
    quality_pooled_across_domains: false,
    transport_latency_is_not_deployed_api_latency: true,
    target_results: targetResults,
    targets: { precision: 0.95, recall: 0.9, clear_negative_coverage: 0.85 },
    runs,
    operations,
  };
  await writeFile(join(output, "summary.json"), JSON.stringify(summary, null, 2) + "\n", {
    flag: "wx",
  });
  await writeFile(
    join(output, "original-artifact-sha256.json"),
    JSON.stringify(artifacts, null, 2) + "\n",
    { flag: "wx" },
  );
  let md =
    "# All exposed models: frozen benchmark comparison\n\nMeasured 2026-11-05. Fixed shipped `balanced-v1`, single pairs, one pass, original presentation, 3,000ms direct-kernel deadline, concurrency1, no retries/fallbacks/truncation. Native Workers AI binding for Clef; direct native HTTPS for other providers. **These timings do not measure the authenticated deployed API or its 2,500ms provider deadline.**\n\n880 distinct public pairs per model: VitaminC200, SciFact199, ContractNLI199, MultiNLI200, FinDVer82. Two synthetic suites add40 cases per model, reported separately. 7,360 total observations. The strict23 finance subset is derived from82, with no duplicate calls. No new locked holdout was opened or threshold/prompt fitted.\n\nEach quality cell is **precision / recall / clear-negative coverage**, in percent. Uncertainty, errors and exclusions stay in recall/coverage denominators. Targets are95 /90 /85; these public native-label adaptations do not establish human-adjudicated service-contract quality. No domain-pooled quality ranking is produced. This compares current shipped behavior under one fixed policy, not the best achievable prompt or calibration for each model.\n\n";
  const runFor = (id: string, dataset: string) =>
    runs.find((r) => r.model === id && r.dataset === dataset) as unknown as {
      overall: ReturnType<typeof summarize>["overall"];
      diagnostics: {
        execution_errors: number;
        execution_excluded: number;
        expected_verdict_cases: number;
        expected_verdict_correct: number;
      };
    };
  for (const [title, sets] of [
    ["Business", ["contractnli", "mnli", "findver"]],
    ["Wikipedia and science", ["vitaminc", "scifact"]],
  ] as const) {
    md += `## ${title}\n\n| Model | ${sets.join(" | ")} |\n| --- | ${sets.map(() => "---:").join(" | ")} |\n`;
    for (const model of protocol.models)
      md += `| ${model.name} | ${sets
        .map((dataset) => {
          const m = runFor(model.id, dataset).overall;
          return `${cell(m.precision.value)} / ${cell(m.recall.value)} / ${cell(m.clear_negative_coverage.value)}`;
        })
        .join(" | ")} |\n`;
    md += "\n";
  }
  md +=
    "## Joint point targets\n\nPassing means precision≥95%, recall≥90%, and clear-negative coverage≥85% on the same native-label scorecard. It does not qualify the service contract or establish a confidence-bound guarantee.\n\n| Model | Primary scorecards meeting all three targets |\n| --- | --- |\n";
  for (const model of protocol.models) {
    const passed = targetResults
      .filter((run) => run.model === model.id && run.all_point_targets_met)
      .map((run) => run.dataset);
    md += `| ${model.name} | ${passed.length ? passed.join(", ") : "None"} |\n`;
  }
  md += "\n";
  md +=
    "## Execution on880 public pairs per model\n\n| Model | Completed | Errors / excluded | p50ms | p95ms | p99ms | Known input tokens / unknown observations |\n| --- | ---: | ---: | ---: | ---: | ---: | ---: |\n";
  for (const op of operations)
    md += `| ${op.name} | ${op.completed}/${op.selected} | ${op.errors} / ${op.excluded} | ${op.completed_p50_ms === null ? "n/a" : Number(op.completed_p50_ms).toFixed(0)} | ${op.completed_p95_ms === null ? "n/a" : Number(op.completed_p95_ms).toFixed(0)} | ${op.completed_p99_ms === null ? "n/a" : Number(op.completed_p99_ms).toFixed(0)} | ${op.known_input_tokens} / ${op.unknown_input_observations} |\n`;
  md +=
    "\nSuccessful-call latency excludes failed calls; all failures remain in completion counts. Reported tokenizers can differ; usage is not an invoice. Actual billed cost and unavailable output usage remain unknown. One unchanged pass does not establish stability, capacity, or an SLA. Model order is fixed, so timing can include changing network or provider load. Client attempts are sequential; a timed-out native Workers AI operation may continue running upstream.\n\n## Per-domain detailed metrics\n\n";
  for (const dataset of [
    "vitaminc",
    "scifact",
    "contractnli",
    "mnli",
    "findver",
    "findver-strict-subset",
  ]) {
    md += `### ${dataset}\n\n| Model | TP / FP | Precision | Recall | F1 | Clear negatives | Uncertain | False clears | Errors / excluded | AUROC |\n| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |\n`;
    for (const model of protocol.models) {
      const m = runFor(model.id, dataset).overall;
      md += `| ${model.name} | ${m.confusion.true_positive} / ${m.confusion.false_positive} | ${percent(m.precision.value)} | ${percent(m.recall.value)} | ${cell(m.f1)} | ${percent(m.clear_negative_coverage.value)} | ${Math.round((m.uncertainty.value ?? 0) * m.denominator)} | ${m.confusion.definitive_false_negative} | ${m.errors} / ${m.excluded} | ${m.auroc?.toFixed(3) ?? "n/a"} |\n`;
    }
    md += "\n";
  }
  md +=
    "## Synthetic diagnostics\n\nSynthetic cases test known boundary expectations; they are not public benchmark quality. Four uncertain contract fixtures use schema-only binary proxies and are excluded from binary metrics.\n\n| Model | Smoke precision / recall / negative coverage | Contract explicit expectations |\n| --- | ---: | ---: |\n";
  for (const model of protocol.models) {
    const smoke = runFor(model.id, "synthetic-smoke").overall;
    const contract = runFor(model.id, "synthetic-contract").diagnostics;
    md += `| ${model.name} | ${cell(smoke.precision.value)} / ${cell(smoke.recall.value)} / ${cell(smoke.clear_negative_coverage.value)} | ${contract.expected_verdict_correct}/${contract.expected_verdict_cases} |\n`;
  }
  md +=
    "\n## Limits and reproduction\n\nContractNLI labels describe full NDAs and are transferred to all gold rationale excerpts: not the official full-document task. FinDVer retains all annotated contexts/tables but only82/250 IE pairs fit2KiB; this is length-conditioned coverage. MultiNLI government/telephone/Slate is business-adjacent language, not workplace-native policy or CRM truth. SciFact uses complete gold rationale sets, not retrieval; VitaminC uses combined development data. Existing science/Wikipedia sampling is not population representative. No new labels were adjudicated.\n\n`summary.json` retains per-domain native-label/genre/clause slices, Wilson and source-group bootstrap intervals, probability denominators, calibration, risk/coverage, failures and model identities. `observations.redacted.jsonl.gz` contains typed predictions and scoring metadata, with **all** claim/evidence text removed and identified by hashes/byte lengths. It is a transformed scoring archive, not a canonical input manifest; finance issuer text is not redistributed. Original manifests/checkpoints/report hashes are pinned, and raw reports remain in ignored local storage.\n\nReproduce the summary offline from archived scoring rows; exact inference reconstruction additionally needs the frozen original manifests and provider configuration. The protocol records pre-inference execution-source hashes and runtime. Analysis code was developed during the run and is separately pinned at archive creation in `analysis-provenance.json`, with exact execution and analysis source snapshots; the matrix ran on the current5a614f0 service baseline with benchmark-only tooling additions. No model default or production prompt was changed by this run.\n";
  md +=
    "\nDataset attribution, source/terms URLs and pinned source hashes are preserved in `data-provenance.json`. Adapter and license notes: [VitaminC and SciFact](../../README.md), [business datasets](../../business/README.md).\n";
  const { format } = await import("prettier");
  await writeFile(join(output, "README.md"), await format(md, { parser: "markdown" }), {
    flag: "wx",
  });
  const hashes = Object.fromEntries(
    await Promise.all(
      [
        "protocol.json",
        "execution-sources.json.gz",
        "analysis-sources.json.gz",
        "analysis-provenance.json",
        "catalog-observation.json",
        "data-provenance.json",
        "summary.json",
        "observations.redacted.jsonl.gz",
        "original-artifact-sha256.json",
        "README.md",
      ].map(async (name) => [name, await sha256File(join(output, name))]),
    ),
  );
  await writeFile(join(output, "archive-sha256.json"), JSON.stringify(hashes, null, 2) + "\n", {
    flag: "wx",
  });
  console.log(JSON.stringify({ archive: output, runs: runs.length, observations }));
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Comparison failed");
  process.exitCode = 1;
});
