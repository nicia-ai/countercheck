import { evaluationProvider } from "../eval/providers.js";
import { access, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, positiveInteger } from "../eval/args.js";
import { withPredictionCheckpoint } from "../eval/checkpoint.js";
import { sha256File } from "../eval/files.js";
import {
  createSplits,
  exclusiveJson,
  loadRole,
  readJson,
  type Role,
} from "../eval/engineering/manifests.js";
import {
  BACKENDS,
  PROFILES,
  createFreeze,
  verifyFreeze,
  type Backend,
  type Profile,
} from "../eval/engineering/freeze.js";
import { PROBES, type Probe } from "../eval/engineering/probes.js";
import {
  fitComposition,
  calibrationSchema,
  type FrozenCalibration,
  labeledSignals,
  policyMetrics,
  calibrationMetrics,
  type Observation,
} from "../eval/engineering/composition.js";

const HELP = `Decision engineering: workflow guards, not cryptographic holdout access control.
Usage: pnpm exec tsx scripts/engineering-eval.ts COMMAND [options]
 split      --manifests FILE,FILE --dir DIR --seed TEXT [--contract-labels FILE]
 freeze     --index DIR/split-lock.json --profiles balanced-v1,semantic-v2,structured-value-v1 --backend fake|jev|clef|decider --out FILE
 run        --index FILE --freeze FILE --role train|dev --out PREFIX [--probes clean,repeat,distractor,order,hostile,criteria-order,field-order]
 calibrate  --index FILE --freeze FILE --run PREFIX.json --profile ID --label-space native|service-contract --out FILE [--semantic-profile ID]
 holdout    --index FILE --freeze FILE --calibration FILE --out PREFIX
Run/holdout: --max-calls N --cost-per-call-usd USD --max-spend-usd USD
Live backends additionally REQUIRE --live; fake makes zero network calls. One sequential
queue, 3000ms direct/kernel deadline, one call/request, no retries/fallbacks/truncation.
Calibration uses dev-tune only; dev-validation is group-disjoint and never reselects.
Holdout requires frozen calibration and creates an exclusive consumed marker before calls.
Native labels are not service-contract adjudication. Human500/locked200 release gate unmet.
Use --help for this text; see eval/engineering/README.md for schemas and a smoke workflow.`;
const ROOT = fileURLToPath(new URL("..", import.meta.url));
function requireValue(value: string | undefined, key: string) {
  if (!value) throw new Error(`Required ${key}.`);
  return value;
}
function money(value: string | undefined) {
  const n = Number(value);
  if (!value || !Number.isFinite(n) || n <= 0)
    throw new Error("Explicit positive spend reservation required.");
  return n;
}
function profile(value: string | undefined): Profile {
  if (!PROFILES.includes(value as Profile)) throw new Error("Unknown profile.");
  return value as Profile;
}
async function fresh(paths: string[]) {
  for (const path of paths) {
    let exists = false;
    try {
      await access(path);
      exists = true;
    } catch {
      /* exclusive writers remain authoritative */
    }
    if (exists) throw new Error("Choose fresh outputs before spending.");
  }
}
type RunReport = {
  kind: "decision-engineering-run";
  role: Role;
  freeze_sha256: string;
  split_lock_sha256: string;
  split_manifest_sha256: string;
  observations: Observation[];
};
async function main() {
  const argv = process.argv.slice(2);
  if (!argv.length || argv.includes("--help")) {
    process.stdout.write(`${HELP}\n`);
    return;
  }
  const command = argv.shift();
  const sharedRun = [
    "index",
    "freeze",
    "out",
    "live",
    "max-calls",
    "cost-per-call-usd",
    "max-spend-usd",
  ];
  const allowed: Record<string, readonly string[]> = {
    split: ["manifests", "dir", "seed", "contract-labels"],
    freeze: ["index", "profiles", "backend", "out"],
    run: [...sharedRun, "role", "probes"],
    calibrate: ["index", "freeze", "run", "profile", "semantic-profile", "label-space", "out"],
    holdout: [...sharedRun, "calibration"],
  };
  if (!command || !allowed[command]) throw new Error("Unknown command.");
  const args = parseArgs(argv, allowed[command], ["live"]);
  if (command === "split") {
    const index = await createSplits(
      requireValue(args.manifests, "manifests").split(","),
      resolve(requireValue(args.dir, "dir")),
      requireValue(args.seed, "seed"),
      args["contract-labels"],
    );
    process.stdout.write(
      `Created train/dev/holdout groups: ${Object.values(index.partitions)
        .map((p) => new Set(p.cases.map((c) => c.group_sha256)).size)
        .join("/")}. Holdout remains workflow-protected, not access-sealed.\n`,
    );
    return;
  }
  const indexPath = resolve(requireValue(args.index, "index"));
  if (command === "freeze") {
    const backend = requireValue(args.backend, "backend") as Backend;
    if (!BACKENDS.includes(backend)) throw new Error("Unknown backend.");
    await createFreeze(
      ROOT,
      indexPath,
      requireValue(args.profiles, "profiles").split(",").map(profile),
      backend,
      requireValue(args.out, "out"),
    );
    process.stdout.write("Frozen split/source/profile/provider fingerprints; no inference.\n");
    return;
  }
  const freezePath = resolve(requireValue(args.freeze, "freeze"));
  const frozen = await verifyFreeze(ROOT, indexPath, freezePath);
  const out = resolve(requireValue(args.out, "out"));
  await mkdir(dirname(out), { recursive: true });
  if (command === "calibrate") {
    const split = await loadRole(indexPath, "dev", "optimization"),
      input = await readJson(requireValue(args.run, "run")),
      report = input.value as RunReport;
    if (
      report.kind !== "decision-engineering-run" ||
      report.role !== "dev" ||
      report.freeze_sha256 !== frozen.sha256 ||
      report.split_lock_sha256 !== split.index_sha256 ||
      report.split_manifest_sha256 !== split.manifest_sha256
    )
      throw new Error("Calibration input must be the matching development run.");
    const selected = profile(args.profile),
      semantic = args["semantic-profile"] ? profile(args["semantic-profile"]) : null;
    if (
      !frozen.frozen.profiles.includes(selected) ||
      (semantic && !frozen.frozen.profiles.includes(semantic))
    )
      throw new Error("Profile was not frozen.");
    const labelSpace = args["label-space"];
    if (labelSpace !== "native" && labelSpace !== "service-contract")
      throw new Error("Explicit native/service-contract target required.");
    const rows = labeledSignals(
      split.manifest.cases,
      report.observations,
      selected,
      semantic,
      labelSpace,
    );
    const calibration = calibrationSchema.parse({
      kind: "decision-engineering-calibration",
      freeze_sha256: frozen.sha256,
      split_lock_sha256: split.index_sha256,
      dev_run_sha256: input.sha256,
      profile: selected,
      semantic_profile: semantic,
      label_space: labelSpace,
      ...fitComposition(rows),
    });
    await exclusiveJson(out, calibration);
    process.stdout.write(
      "Frozen dev-only composition; group-disjoint validation reported, no holdout read or promotion.\n",
    );
    return;
  }
  let calibration: FrozenCalibration | null = null,
    calibrationHash: string | null = null;
  if (command === "holdout") {
    const input = await readJson(requireValue(args.calibration, "calibration"));
    calibration = calibrationSchema.parse(input.value);
    calibrationHash = input.sha256;
    if (
      calibration.kind !== "decision-engineering-calibration" ||
      calibration.freeze_sha256 !== frozen.sha256 ||
      calibration.split_lock_sha256 !== frozen.frozen.split_lock_sha256 ||
      calibration.selection_uses_validation !== false ||
      !frozen.frozen.profiles.includes(calibration.profile) ||
      (calibration.semantic_profile &&
        !frozen.frozen.profiles.includes(calibration.semantic_profile))
    )
      throw new Error("Holdout requires the matching frozen dev-only calibration.");
  }
  const role = command === "holdout" ? "holdout" : (requireValue(args.role, "role") as Role);
  if (role !== "train" && role !== "dev" && !(command === "holdout" && role === "holdout"))
    throw new Error("Optimization runs cannot open holdout.");
  const probes =
    command === "holdout"
      ? ["clean" as const]
      : ((args.probes ?? PROBES.join(",")).split(",") as Probe[]);
  if (
    probes.some((p) => !PROBES.includes(p)) ||
    (probes.includes("order") && !probes.includes("distractor"))
  )
    throw new Error("Invalid probes; order requires matched distractor.");
  if (frozen.frozen.backend !== "fake" && !args.live)
    throw new Error("Explicit --live is required for paid providers.");
  const checkpoint = `${out}.predictions.jsonl`,
    consumed = `${indexPath}.holdout-opened.json`;
  await fresh([
    `${out}.json`,
    `${out}.md`,
    checkpoint,
    `${checkpoint}.metadata.json`,
    ...(command === "holdout" ? [consumed] : []),
  ]);
  const split = await loadRole(
    indexPath,
    role,
    command === "holdout" ? "evaluation" : "optimization",
  );
  // Import compiler/provider execution only after checking its complete source graph.
  const { planRun, executeRun, summarizeRun } = await import("../eval/engineering/runner.js");
  await verifyFreeze(ROOT, indexPath, freezePath);
  const effectiveFreeze = calibration
    ? {
        ...frozen.frozen,
        profiles: [
          ...new Set([
            calibration.profile,
            ...(calibration.semantic_profile ? [calibration.semantic_profile] : []),
          ]),
        ],
      }
    : frozen.frozen;
  const plan = planRun(
    split.manifest,
    effectiveFreeze,
    probes,
    positiveInteger(args["max-calls"], 0, "max-calls"),
    money(args["cost-per-call-usd"]),
    money(args["max-spend-usd"]),
  );
  const provider = await evaluationProvider(frozen.frozen.backend);
  const observations = await withPredictionCheckpoint(
    checkpoint,
    {
      manifest_sha256: split.manifest_sha256,
      freeze_sha256: frozen.sha256,
      role,
      split_lock_sha256: split.index_sha256,
      calibration_sha256: calibrationHash,
      protocol: {
        backend: frozen.frozen.backend,
        requested_model: frozen.frozen.requested_model,
        profiles: effectiveFreeze.profiles,
        probes,
        planned_calls: plan.planned_calls,
        reserved_max_usd: plan.reservation_usd,
        sequential_concurrency: 1,
        deadline_ms: 3000,
        retries: 0,
        fallback: false,
        truncation: false,
        production_qualification: "not_assessed",
      },
    },
    async (append) => {
      if (command === "holdout")
        await exclusiveJson(consumed, {
          kind: "holdout-opened-for-evaluation",
          freeze_sha256: frozen.sha256,
          calibration_sha256: calibrationHash,
          checkpoint,
          opened_at: new Date().toISOString(),
          note: "A second opening/tuning is forbidden by workflow; files are not cryptographically access-controlled.",
        });
      return executeRun(plan, append, provider ? { provider } : {});
    },
  );
  const composition = calibration
    ? (() => {
        const rows = labeledSignals(
          split.manifest.cases,
          observations,
          calibration.profile,
          calibration.semantic_profile,
          calibration.label_space,
        );
        return {
          policy: calibration.policy,
          label_space: calibration.label_space,
          metrics: policyMetrics(rows, calibration.policy),
          joint_empirical_calibration: calibrationMetrics(
            rows,
            calibration.joint_empirical_calibration.cells,
          ),
          tuning: false,
        };
      })()
    : null;
  const report = {
    kind: "decision-engineering-run",
    backend: frozen.frozen.backend,
    requested_model: frozen.frozen.requested_model,
    fake_synthetic_transport_only: frozen.frozen.backend === "fake",
    role,
    freeze_sha256: frozen.sha256,
    split_lock_sha256: split.index_sha256,
    split_manifest_sha256: split.manifest_sha256,
    calibration_sha256: calibrationHash,
    checkpoint_sha256: await sha256File(checkpoint),
    checkpoint_metadata_sha256: await sha256File(`${checkpoint}.metadata.json`),
    ...summarizeRun(split.manifest, observations),
    composition,
    observations,
  };
  await exclusiveJson(`${out}.json`, report);
  const { writeFile } = await import("node:fs/promises");
  await writeFile(
    `${out}.md`,
    `# Decision engineering ${role}\n\nBackend: ${frozen.frozen.backend}; requested model: ${frozen.frozen.requested_model}. ${frozen.frozen.backend === "fake" ? "FAKE SYNTHETIC TRANSPORT ONLY; uniform outputs are not model performance." : "Explicit provider candidate; not production qualification."}\n\n${observations.length} observations; ${report.completed} completed, ${report.errors} errors, ${report.excluded} exclusions. See JSON for separate native/service-contract metrics, denominators, raw distributions and paired variation.\n\nHuman 500 / locked 200 gate: unmet or unverified. No automatic promotion, production qualification or probability-independence claim. ${role === "holdout" ? "This is evaluation of the frozen composition; do not tune after opening." : "Optimization input excludes holdout content and labels."}\n`,
    { flag: "wx", mode: 0o600 },
  );
  process.stdout.write(`Wrote ${role} engineering report; no production promotion.\n`);
}
main().catch(() => {
  process.stderr.write(
    "Engineering evaluation stopped. Check --help, frozen sources/splits, explicit budgets and fresh outputs. Completed checkpoints remain; errors never print credentials/provider bodies.\n",
  );
  process.exitCode = 1;
});
