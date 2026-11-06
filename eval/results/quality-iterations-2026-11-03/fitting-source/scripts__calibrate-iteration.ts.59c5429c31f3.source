import { readFile, writeFile } from "node:fs/promises";
import { sha256 } from "../eval/types.js";
import { parseArgs } from "../eval/args.js";
import {
  loadCalibrationInput,
  fitCalibration,
  evaluateCalibration,
} from "../eval/iteration/calibrate.js";

export async function main(argv: string[]) {
  const args = parseArgs(argv, ["mode", "run", "manifest", "out", "model", "seed", "help"]);
  if (args.help) {
    console.log(
      "Usage: tsx scripts/calibrate-iteration.ts --mode diagnose|fit|evaluate --run RUN.json --manifest MANIFEST --out NEW.json [--seed SEED | --model FROZEN.json]. Offline only; fitting requires original train pairs and tune purpose. No logistic fit or model calls.",
    );
    return;
  }
  if (
    !["diagnose", "fit", "evaluate"].includes(args.mode ?? "") ||
    !args.run ||
    !args.manifest ||
    !args.out
  )
    throw new Error("Missing or invalid calibration arguments; use --help.");
  const [runBytes, manifestBytes] = await Promise.all([
    readFile(args.run),
    readFile(args.manifest),
  ]);
  const input = loadCalibrationInput(
    JSON.parse(runBytes.toString("utf8")),
    JSON.parse(manifestBytes.toString("utf8")),
    sha256(manifestBytes),
    sha256(runBytes),
  );
  let output: unknown;
  if (args.mode === "evaluate") {
    if (!args.model || args.seed)
      throw new Error("Evaluation requires a frozen model and forbids a split seed.");
    output = evaluateCalibration(JSON.parse(await readFile(args.model, "utf8")), input);
  } else {
    if (!args.seed || args.model)
      throw new Error("Fitting requires a seed and forbids a preexisting model.");
    output = fitCalibration(input, { seed: args.seed, diagnostic: args.mode === "diagnose" });
  }
  await writeFile(args.out, JSON.stringify(output, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  console.log(
    JSON.stringify({
      output: args.out,
      mode: args.mode,
      profiles: input.profiles,
      cases: input.manifest.pairs.length,
      qualification: "not_assessed",
    }),
  );
}
if (process.argv[1]?.endsWith("calibrate-iteration.ts"))
  main(process.argv.slice(2)).catch(() => {
    console.error(
      "Offline calibration failed; verify provenance, purpose, source-group separation and fresh output path.",
    );
    process.exitCode = 1;
  });
