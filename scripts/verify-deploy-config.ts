import { readFile } from "node:fs/promises";
import { validateDeploymentConfig } from "./deployment-config.js";

const configPath = process.argv[2] ?? "wrangler.jsonc";
try {
  const source = await readFile(configPath, "utf8");
  const error = validateDeploymentConfig(source);
  if (error) {
    console.error(`Deploy config preflight failed: ${error}`);
    process.exitCode = 1;
  } else {
    console.log("Deploy config preflight passed.");
  }
} catch {
  console.error(`Deploy config preflight failed: could not read ${configPath}.`);
  process.exitCode = 1;
}
