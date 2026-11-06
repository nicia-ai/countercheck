import { readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "../eval/args.js";
import { sha256 } from "../eval/types.js";
import { loadCalibrationInput } from "../eval/iteration/calibrate.js";
import { fitFusion, evaluateFusion } from "../eval/iteration/fusion.js";
export async function main(argv: string[]) {
  const args = parseArgs(argv, [
    "mode",
    "run",
    "manifest",
    "out",
    "model",
    "seed",
    "regularization",
    "help",
  ]);
  if (args.help) {
    console.log(
      "Usage: tsx scripts/fuse-iteration.ts --mode diagnose|fit|evaluate --run RUN.json --manifest MANIFEST --out NEW.json [--seed SEED | --model FROZEN.json]. Offline matched-candidate logistic fusion; [--regularization fixed|group-cv] defaults fixed L2=1; group-cv chooses [1,10,100] on training-group OOF log loss and thresholds; tune+original train only. Both zero-false-clear and95NPV policies reported; no qualification claim.",
    );
    return;
  }
  if (
    !["diagnose", "fit", "evaluate"].includes(args.mode ?? "") ||
    !args.run ||
    !args.manifest ||
    !args.out
  )
    throw new Error("Invalid fusion arguments; use --help.");
  const [run, manifest] = await Promise.all([readFile(args.run), readFile(args.manifest)]);
  const input = loadCalibrationInput(
    JSON.parse(run.toString("utf8")),
    JSON.parse(manifest.toString("utf8")),
    sha256(manifest),
    sha256(run),
  );
  let output: unknown;
  if (args.mode === "evaluate") {
    if (!args.model || args.seed || args.regularization)
      throw new Error("Fusion evaluation requires frozen model and forbids fitting seed.");
    output = evaluateFusion(JSON.parse(await readFile(args.model, "utf8")), input);
  } else {
    if (!args.seed || args.model)
      throw new Error("Fusion fitting requires seed and forbids existing model.");
    if (args.regularization !== undefined && !["fixed", "group-cv"].includes(args.regularization))
      throw new Error("Unknown regularization mode.");
    output = fitFusion(input, {
      seed: args.seed,
      diagnostic: args.mode === "diagnose",
      regularization: args.regularization === "group-cv" ? "group-cv" : "fixed",
    });
  }
  await writeFile(args.out, JSON.stringify(output, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  console.log(
    JSON.stringify({
      output: args.out,
      mode: args.mode,
      cases: input.manifest.pairs.length,
      profiles: input.profiles,
      qualification: "not_assessed",
    }),
  );
}
if (process.argv[1]?.endsWith("fuse-iteration.ts"))
  main(process.argv.slice(2)).catch(() => {
    console.error(
      "Offline fusion failed; verify matched coverage, provenance, role and fresh output path.",
    );
    process.exitCode = 1;
  });
