import { readFile, mkdir, writeFile, access } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "../eval/args.js";
import { sha256, validateManifest, type Manifest, type Pair, type Source } from "../eval/types.js";
import { exclusiveJson, contentHash } from "../eval/engineering/manifests.js";
import { groupKey, contentKey } from "../eval/iteration/calibrate.js";
import { sourceFingerprint } from "../eval/iteration/fingerprint.js";
import { strata, DATASETS as PUBLIC_DATASETS } from "../eval/datasets.js";
import { CONTRACT_NLI_SOURCE } from "../eval/business/contractnli.js";
import { MNLI_SOURCE } from "../eval/business/mnli.js";
import {
  archivedRows,
  missAnalysis,
  buildCohort,
  publishedManifests,
  DATASETS,
  SEED,
  MODELS,
  ARCHIVE,
  fitsAllModels,
} from "../eval/calibration-study/preparation.js";
import {
  selectPacket,
  blankAnnotation,
  rubric,
  mergeAnnotations,
  readAnnotation,
  scoreHumanLabels,
  validatePacketIdentity,
  type PacketRegistry,
  type PacketKey,
} from "../eval/calibration-study/adjudication.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PUBLIC = "eval/results/calibration-preparation-2026-11-05";
const PRIVATE = "eval/data/calibration-study-2026-11-05";
const json = (v: unknown) => JSON.stringify(v, null, 2) + "\n";
const digestFile = async (path: string) => sha256(await readFile(path));
async function studySources() {
  const files = {
    ...(await sourceFingerprint(ROOT, "scripts/prepare-calibration-study.ts")),
    ...(await sourceFingerprint(ROOT, "scripts/eval.ts")),
  };
  for (const path of [
    "scripts/analyze-eval-release.py",
    "scripts/verify-eval-release.py",
    "eval/results/business-2026-11-04/metrics.py",
    "tests/calibration-study.test.ts",
  ])
    files[path] = await digestFile(path);
  return files;
}

function summarize(pairs: Pair[]) {
  return Object.fromEntries(
    DATASETS.filter((d) => d !== "findver").map((dataset) => {
      const rows = pairs.filter((p) => p.dataset === dataset);
      return [
        dataset,
        {
          pairs: rows.length,
          groups: new Set(rows.map((p) => p.group_id)).size,
          positives: rows.filter((p) => p.gold === "contradiction").length,
          positive_groups: new Set(
            rows.filter((p) => p.gold === "contradiction").map((p) => p.group_id),
          ).size,
        },
      ];
    }),
  );
}
const redact = (pairs: Pair[]) =>
  pairs.map(({ id, dataset, group_id, source_id, gold, native_label, claim, evidence }) => ({
    id,
    dataset,
    group_id,
    source_id,
    gold,
    native_label,
    content_sha256: contentHash({ claim, evidence }),
    claim_sha256: sha256(claim),
    evidence_sha256: sha256(evidence),
  }));
async function prepare() {
  for (const path of [PUBLIC, PRIVATE])
    if (
      await access(path).then(
        () => true,
        () => false,
      )
    )
      throw new Error("Choose fresh versioned study paths; existing files are immutable");
  const rows = await archivedRows(),
    analysis = missAnalysis(rows),
    published = await publishedManifests();
  const pairs = published.flatMap((p) => p.manifest.pairs),
    cache = new Map(pairs.map((p) => [p.id, p]));
  for (const o of rows.filter((o) => DATASETS.includes(o.dataset as (typeof DATASETS)[number]))) {
    const pair = cache.get(o.row.pair.id);
    if (
      !pair ||
      pair.gold !== o.row.pair.gold ||
      sha256(pair.claim) !== o.row.text_provenance.claim_sha256 ||
      sha256(pair.evidence) !== o.row.text_provenance.evidence_sha256
    )
      throw new Error("Published input rehydration mismatch");
  }
  const cohort = await buildCohort(pairs);
  const sources: Source[] = Object.entries(cohort.sources).map(([path, hash]) => {
    if (typeof hash !== "string") throw new Error("Invalid source hash");
    const original = path.includes("vitaminc")
      ? PUBLIC_DATASETS.vitaminc
      : path.includes("scifact")
        ? PUBLIC_DATASETS.scifact
        : path.includes("contractnli")
          ? CONTRACT_NLI_SOURCE
          : MNLI_SOURCE;
    return {
      name: path,
      url: original.url,
      revision: original.revision,
      license: original.license,
      license_url: original.license_url,
      sha256: hash,
    };
  });
  await mkdir(PRIVATE, { recursive: true });
  await mkdir(PUBLIC, { recursive: true });
  const manifests: Record<string, { path: string; sha256: string; pairs: number }> = {};
  for (const role of ["fit", "validation"] as const) {
    const selected = cohort[role].sort((a, b) => a.id.localeCompare(b.id));
    const manifest: Manifest = {
      schema_version: 1,
      adapter_version: "countercheck-public-pairs-v1",
      purpose: "development",
      sources,
      sampling: {
        seed: SEED,
        max_pairs: selected.length,
        selected_pairs: selected.length,
        available_pairs: cohort.fit.length + cohort.validation.length,
        method:
          "Existing source-component preparation, label-blind whole-group sampling and foldGroups; original train labels retained; no finance",
        excluded_unlabeled: 0,
        strata: strata(selected),
      },
      pairs: selected,
    };
    validateManifest(manifest);
    const path = join(PRIVATE, role + ".json");
    await exclusiveJson(path, manifest);
    manifests[role] = { path, sha256: await digestFile(path), pairs: selected.length };
  }
  const packet = selectPacket(rows, pairs),
    view = {
      schema_version: 1,
      items: packet.map(({ blind_id, pair }) => ({
        blind_id,
        claim: pair.claim,
        evidence: pair.evidence,
      })),
    };
  const packetBytes = json(view),
    packetSha = sha256(packetBytes),
    packetDir = join(PRIVATE, "adjudication");
  await mkdir(packetDir);
  await writeFile(join(packetDir, "packet.json"), packetBytes, { flag: "wx", mode: 0o600 });
  await writeFile(
    join(packetDir, "packet.txt"),
    packet
      .map(
        ({ blind_id, pair }) => `${blind_id}\nCLAIM\n${pair.claim}\nCOMPARISON\n${pair.evidence}\n`,
      )
      .join("\n====================\n\n"),
    { flag: "wx", mode: 0o600 },
  );
  await writeFile(join(packetDir, "RUBRIC.md"), rubric, { flag: "wx", mode: 0o600 });
  await exclusiveJson(join(packetDir, "operator-key.json"), {
    packet_sha256: packetSha,
    items: packet,
  });
  for (const name of ["annotator-1", "annotator-2", "adjudicator"] as const)
    await exclusiveJson(
      join(packetDir, name + ".blank.json"),
      blankAnnotation(
        packetSha,
        packet.map((p) => p.blind_id),
        name === "adjudicator" ? "adjudicator" : "annotator",
      ),
    );
  await exclusiveJson(join(PUBLIC, "packet-registry.json"), {
    status: "packet prepared, not yet labelled",
    packet_sha256: packetSha,
    operator_key_sha256: await digestFile(join(packetDir, "operator-key.json")),
    selection:
      "68 never-caught native positives plus 68 caught-positive and 68 native-negative controls; dataset and nearest evidence-length bin matched; hash-random within bins; opaque random IDs and independently shuffled presentation",
    items: packet.map(({ blind_id, pair, content_sha256 }) => ({
      blind_id,
      content_sha256,
      claim_sha256: sha256(pair.claim),
      evidence_sha256: sha256(pair.evidence),
    })),
  });
  await exclusiveJson(join(PUBLIC, "miss-breakdown.json"), {
    ...analysis,
    compressed_archive_sha256: await digestFile(ARCHIVE),
    correction_to_request:
      "1333 completed misses plus four error outcomes equals 1337 total misses. Top-category ties are kept separate.",
  });
  await exclusiveJson(join(PUBLIC, "cohort-registry.json"), {
    schema_version: 1,
    seed: SEED,
    manifests,
    source_hashes: cohort.sources,
    excluded_locked_metadata: cohort.blocked_locks,
    exclusions: cohort.exclusions,
    selection_caps: cohort.selection_caps,
    fit: summarize(cohort.fit),
    validation: summarize(cohort.validation),
    rows: { fit: redact(cohort.fit), validation: redact(cohort.validation) },
    prior_exposure:
      "Public train may have been used in earlier optimization; no newly untouched test claim. Previous validation and locked roles are excluded using metadata, without opening their manifests.",
  });
  const sourceFiles = await studySources();
  const total = cohort.fit.length + cohort.validation.length;
  const protocol = {
    schema_version: 1,
    kind: "separately-fitted-hosted-calibration-protocol-v1",
    approval_status: "pending-owner-budget-approval",
    seed: SEED,
    archive: { path: ARCHIVE, sha256: await digestFile(ARCHIVE) },
    manifests,
    source_files: sourceFiles,
    registry_sha256: await digestFile(join(PUBLIC, "cohort-registry.json")),
    packet_registry_sha256: await digestFile(join(PUBLIC, "packet-registry.json")),
    inference: {
      profile: "balanced-v1",
      passes: 1,
      presentation: "original",
      batch_size: 1,
      concurrency: 1,
      timeout_ms: 3000,
      retries: 0,
      fallbacks: false,
      sequence:
        "All fit predictions first; fit and freeze policies using fit labels only; only then run disjoint validation. No inference on published 880. No locked-role opening.",
    },
    operating_policy: {
      scope:
        "one global policy per model across four non-finance datasets; no per-domain fitted policies",
      feature_bridge:
        "conflict=raw contradiction; negative=max(raw consistent,raw different_scope); native raw outputs unchanged; no numeric overrides or extra judgments",
      fitter:
        "eval/iteration/calibrate.ts selectThresholds; existing compose; no new model or prompt",
      positive:
        "Maximize fit recall at observed point precision >=0.95; ties by higher precision then higher cutoff; observed cutoffs plus frozen 0.01 grid; if none qualifies disable positives with cutoff 1.000001",
      negative:
        "Maximize fit clear-negative count subject to ZERO native-positive false clears on fit. Use existing negative_cut and negative_support grid, positive precedence, negative_cut < positive cutoff; grid-order tie break; disabling negatives remains eligible",
      false_clear_budget: {
        fit: 0,
        validation: "report every false clear; no reselection if validation fails",
        basis:
          "Existing selectThresholds negative_fit_constraint=zero_training_false_clears; public native labels are not service-contract gold",
      },
      validation:
        "Group-disjoint 1-in-5 source groups per dataset, using existing foldGroups with fixed seed; no validation-driven tuning or refit",
      errors:
        "Never impute missing probabilities or drop failed cases from selected-case denominators. Every selected pair requires an attributed ok/error/excluded row. Explicit failures remain misses in full-denominator reports, without imputed scores; cutoff search uses observed distributions. Missing or unmatched rows abort fitting.",
    },
    accounting: {
      reservation_per_call_usd: 0.002,
      max_calls_per_model: total,
      fit_calls_per_model: cohort.fit.length,
      validation_calls_per_model: cohort.validation.length,
      models: MODELS.map((model) => ({
        model,
        backend: model === "fastino/GLiDE" ? "fastino" : "hosted",
        max_calls: total,
        operator_reservation_usd: total * 0.002,
      })),
      max_calls_all_models: total * MODELS.length,
      operator_reservation_usd: total * MODELS.length * 0.002,
      actual_billed_cost: null,
      budget_is_not_provider_enforced: true,
      no_live_calls_before_owner_approval: true,
    },
    evaluation:
      "Freeze policies before validation; apply unchanged to archived Nov 5 outputs. Finance is transfer only, never fit. Versioned calibrated scorecards and metric-matched paired source-group intervals, including non-improving models, remain separate from shipped policy. Same reused 880, not fresh held-out performance.",
    adjudication: {
      status: "packet prepared, not yet labelled",
      items: packet.length,
      human_judgments: 0,
      ai_judgments: 0,
    },
    service_change: false,
  };
  await exclusiveJson(join(PUBLIC, "protocol.json"), protocol);
  await exclusiveJson(join(PUBLIC, "freeze.json"), {
    protocol_sha256: await digestFile(join(PUBLIC, "protocol.json")),
    source_files: sourceFiles,
    manifests,
    lock_metadata_sha256: cohort.blocked_locks,
    original_heldout_manifests_opened: false,
    approval_status: "pending-owner-budget-approval",
  });
  const commands = MODELS.map((model) => {
    const backend = model === "fastino/GLiDE" ? "fastino" : "hosted";
    return `# ${model}: ONLY after budget approval and verification of protocol/freeze hashes\npnpm eval:run --backend ${backend}${backend === "hosted" ? ` --model ${model}` : ""} --manifest ${manifests.fit!.path} --profile balanced-v1 --live --max-calls ${cohort.fit.length} --cost-per-call-usd .002 --max-spend-usd ${(cohort.fit.length * 0.002).toFixed(3)} --out eval/reports/calibration-fit-${model.replaceAll(/[^a-zA-Z0-9-]/g, "-")}`;
  }).join("\n\n");
  await writeFile(join(PUBLIC, "planned-fit-commands.txt"), commands + "\n", {
    flag: "wx",
    mode: 0o600,
  });
  await writeFile(
    join(PUBLIC, "README.md"),
    `# Separately fitted calibration and human-adjudication preparation\n\nStatus: **awaiting budget approval; no new inference performed**. Original archives, shipped service and verifier summary remain unchanged.\n\nThe request's 1,333 misses count completed assessments only: four additional provider errors give 1,337 total missed-positive outcomes. See the hash-bound miss breakdown. The 68 never-caught positives and 75.6% union recall reproduce.\n\nThe blinded local packet has ${packet.length} items and no judgments. Give each annotator only packet.json/packet.txt, RUBRIC.md and their blank template under the ignored local adjudication directory. Never distribute operator-key.json, the native labels, model outputs or selection membership. Control membership is reproducible from the fixed seed; blind IDs and order are intentionally randomized, with the packet and private key hashes serving as the exact version receipt. Blinding is a workflow boundary, not protection against an adjudicator deliberately linking public sources. Third-human adjudication follows two independent completed annotation files.\n\n## Pre-inference protocol\n\nRead protocol.json and freeze.json for exact rules and source/data hashes. One global policy per model is fitted on separate non-finance public-train groups. Positive precision target is 95% observed on fit; negative gate allows zero fit false clears, following the existing calibrator. Separate validation is evaluated without reselection. Finance is transfer only. No prompt, default, service threshold or native label changes.\n\nFit pairs: ${cohort.fit.length}; validation pairs: ${cohort.validation.length}. Each of nine models has at most ${total} calls and a $${(total * 0.002).toFixed(3)} operator reservation. Total cap: ${total * MODELS.length} calls / $${(total * MODELS.length * 0.002).toFixed(3)} at $0.002 per call. This is an operator reservation, not measured billing or a provider-enforced cap.\n\nNo live calls are authorized until the owner approves this protocol and budget. The command file is a plan, not an executable launch approval. Policies, validation results, calibrated archive scorecards and calibrated-scorecard verifier extension remain unrun/unproduced pending approval.\n\n## Human labels\n\nRun the preparation CLI's adjudicate subcommand only after the two humans and a distinct adjudicator complete their templates. It checks complete coverage, packet hashes, independent/human attestations and content provenance, and emits a separate service-contract label sidecar plus scorecard. Tooling records the human assertions; it cannot verify who actually authored a label. No AI labels are generated. Source text and free-text rationale stay in ignored local files, especially all FinDVer text.\n`,
    { flag: "wx", mode: 0o600 },
  );
  console.log(
    json({
      phase: "offline-preparation",
      live_calls: 0,
      fit: summarize(cohort.fit),
      validation: summarize(cohort.validation),
      calls_per_model: total,
      total_calls: total * MODELS.length,
      reservation_usd: total * MODELS.length * 0.002,
      packet_items: packet.length,
      protocol: join(PUBLIC, "protocol.json"),
    }),
  );
}
async function adjudicate(argv: string[]) {
  const args = parseArgs(argv, ["key", "packet", "first", "second", "final", "out"]);
  if (!args.key || !args.packet || !args.first || !args.second || !args.final || !args.out)
    throw new Error("Missing annotation arguments");
  const keyBytes = await readFile(args.key);
  const key = JSON.parse(keyBytes.toString("utf8")) as {
    packet_sha256: string;
    items: PacketKey[];
  };
  const packetBytes = await readFile(args.packet);
  if (sha256(packetBytes) !== key.packet_sha256) throw new Error("Packet changed");
  const view = JSON.parse(packetBytes.toString("utf8")) as {
    items: { blind_id: string; claim: string; evidence: string }[];
  };
  const registryBytes = await readFile(join(PUBLIC, "packet-registry.json"));
  const registry = JSON.parse(registryBytes.toString("utf8")) as PacketRegistry;
  const protocolBytes = await readFile(join(PUBLIC, "protocol.json"));
  const protocol = JSON.parse(protocolBytes.toString("utf8")) as {
    packet_registry_sha256: string;
    archive: { sha256: string };
  };
  const frozen = JSON.parse(await readFile(join(PUBLIC, "freeze.json"), "utf8")) as {
    protocol_sha256: string;
  };
  if (
    sha256(protocolBytes) !== frozen.protocol_sha256 ||
    sha256(registryBytes) !== protocol.packet_registry_sha256 ||
    sha256(keyBytes) !== registry.operator_key_sha256 ||
    key.packet_sha256 !== registry.packet_sha256 ||
    (await digestFile(ARCHIVE)) !== protocol.archive.sha256
  )
    throw new Error("Adjudication receipt differs from frozen study");
  validatePacketIdentity(key.items, view, registry);
  const rows = await archivedRows();
  for (const item of key.items) {
    const shown = view.items.find((p) => p.blind_id === item.blind_id);
    const archived = rows.find((r) => r.row.pair.id === item.pair.id);
    if (
      !shown ||
      !archived ||
      contentHash(shown) !== item.content_sha256 ||
      contentHash(item.pair) !== item.content_sha256 ||
      sha256(shown.claim) !== archived.row.text_provenance.claim_sha256 ||
      sha256(shown.evidence) !== archived.row.text_provenance.evidence_sha256 ||
      item.pair.gold !== archived.row.pair.gold
    )
      throw new Error("Annotation source/content mismatch");
  }
  const merged = mergeAnnotations(
    key.items,
    key.packet_sha256,
    await Promise.all([args.first, args.second, args.final].map(readAnnotation)),
  );
  // Commit labels and hashes, never annotator prose that might quote finance source text.
  const publicLabels = {
    ...merged,
    judgments: merged.judgments.map(({ label, blind_id, relation, judgments }) => ({
      label,
      blind_id,
      relation,
      judgments: judgments.map(({ note, ...value }) => ({ ...value, note_sha256: sha256(note) })),
    })),
  };
  await exclusiveJson(args.out, {
    ...publicLabels,
    service_contract_scorecard: scoreHumanLabels(
      rows,
      merged.labels,
      new Map(
        key.items.map((item) => [
          item.pair.id,
          {
            content_sha256: item.content_sha256,
            claim_sha256: sha256(item.pair.claim),
            evidence_sha256: sha256(item.pair.evidence),
          },
        ]),
      ),
    ),
    selection_bias:
      "Enriched never-caught/control sample, not population accuracy; native archive labels unchanged",
  });
  console.log(
    "Human-attested service-contract sidecar written; no inference or native-label changes.",
  );
}
async function verify() {
  const protocol = JSON.parse(await readFile(join(PUBLIC, "protocol.json"), "utf8")) as {
    archive: { path: string; sha256: string };
    source_files: Record<string, string>;
    registry_sha256: string;
    packet_registry_sha256: string;
    manifests: Record<string, { path: string; sha256: string; pairs: number }>;
    accounting: {
      max_calls_all_models: number;
      max_calls_per_model: number;
      operator_reservation_usd: number;
    };
  };
  const freeze = JSON.parse(await readFile(join(PUBLIC, "freeze.json"), "utf8")) as {
    protocol_sha256: string;
    lock_metadata_sha256: Record<string, string>;
  };
  if (
    freeze.protocol_sha256 !== (await digestFile(join(PUBLIC, "protocol.json"))) ||
    protocol.registry_sha256 !== (await digestFile(join(PUBLIC, "cohort-registry.json"))) ||
    protocol.packet_registry_sha256 !== (await digestFile(join(PUBLIC, "packet-registry.json")))
  )
    throw new Error("Study receipt mismatch");
  const actual = await studySources();
  if (JSON.stringify(actual) !== JSON.stringify(protocol.source_files))
    throw new Error("Sources changed after the pre-inference freeze");
  for (const [path, hash] of Object.entries(freeze.lock_metadata_sha256))
    if ((await digestFile(path)) !== hash) throw new Error("Prior split metadata changed");
  if (protocol.archive.path !== ARCHIVE || (await digestFile(ARCHIVE)) !== protocol.archive.sha256)
    throw new Error("Archived observations changed");
  const groups = new Set<string>(),
    content = new Set<string>();
  let total = 0;
  for (const role of ["fit", "validation"]) {
    const m = protocol.manifests[role]!;
    if ((await digestFile(m.path)) !== m.sha256) throw new Error("Study manifest changed");
    const manifest = validateManifest(JSON.parse(await readFile(m.path, "utf8")));
    if (manifest.pairs.length !== m.pairs) throw new Error("Study size mismatch");
    const ownGroups = new Set<string>(),
      ownContent = new Set<string>();
    for (const p of manifest.pairs) {
      if (p.split !== "train" || p.dataset === "findver" || !fitsAllModels(p))
        throw new Error("Invalid fit/validation source or envelope");
      const g = groupKey(p),
        c = contentKey(p);
      if (groups.has(g) || content.has(c)) throw new Error("Fit/validation leakage");
      ownGroups.add(g);
      ownContent.add(c);
    }
    for (const g of ownGroups) groups.add(g);
    for (const c of ownContent) content.add(c);
    total += manifest.pairs.length;
  }
  if (
    total !== protocol.accounting.max_calls_per_model ||
    total * MODELS.length !== protocol.accounting.max_calls_all_models ||
    Math.abs(total * MODELS.length * 0.002 - protocol.accounting.operator_reservation_usd) > 1e-9
  )
    throw new Error("Budget mismatch");
  console.log(
    json({
      verified_protocol: true,
      calls_made: 0,
      planned_calls: total * MODELS.length,
      reservation_usd: protocol.accounting.operator_reservation_usd,
    }),
  );
}
async function main() {
  const [command, ...argv] = process.argv.slice(2);
  if (command === "--help" || !command) {
    console.log(
      "Offline only: tsx scripts/prepare-calibration-study.ts prepare | verify | adjudicate --key PRIVATE --packet PRIVATE --first HUMAN.json --second HUMAN.json --final HUMAN.json --out NEW.json. No live inference command exists; budget approval is required first.",
    );
    return;
  }
  if (command === "prepare" && !argv.length) await prepare();
  else if (command === "verify" && !argv.length) await verify();
  else if (command === "adjudicate") await adjudicate(argv);
  else throw new Error("Unknown offline command");
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch(() => {
    console.error(
      "Offline preparation stopped. Check source hashes, fresh paths, complete source groups and annotation provenance. No model calls were made.",
    );
    process.exitCode = 1;
  });
