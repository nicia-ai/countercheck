import { openSync, writeSync, closeSync } from "node:fs";
import { observeHttpStatus } from "./http-status-observer.js";
import { NACE_SYSTEMONE_URL } from "./nace-provider.js";
import { DECIDER_URL } from "../src/providers/decider.js";
import { JEV_URL } from "../src/providers/jev.js";

const OBSERVED_ENDPOINTS: readonly string[] = [JEV_URL, NACE_SYSTEMONE_URL, DECIDER_URL];

const path = process.env.COUNTERCHECK_EVAL_HTTP_STATUS_PATH;
if (!path) throw new Error("Explicit evaluation HTTP status path required");
const handle = openSync(path, "wx", 0o600);
const original = globalThis.fetch.bind(globalThis);
const observed = observeHttpStatus(original, (value) => {
  writeSync(handle, JSON.stringify(value) + "\n");
});
globalThis.fetch = (input, init) => {
  const url = new URL(input instanceof Request ? input.url : input);
  return OBSERVED_ENDPOINTS.includes(url.origin + url.pathname)
    ? observed(input, init)
    : original(input, init);
};
process.once("exit", () => closeSync(handle));
