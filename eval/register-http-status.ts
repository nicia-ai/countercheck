import { openSync, writeSync, closeSync } from "node:fs";
import { observeHttpStatus } from "./http-status-observer.js";

const path = process.env.COUNTERCHECK_EVAL_HTTP_STATUS_PATH;
if (!path) throw new Error("Explicit evaluation HTTP status path required");
const handle = openSync(path, "wx", 0o600);
const original = globalThis.fetch.bind(globalThis);
const observed = observeHttpStatus(original, (value) => {
  writeSync(handle, JSON.stringify(value) + "\n");
});
globalThis.fetch = (input, init) => {
  const url = new URL(input instanceof Request ? input.url : input);
  return url.origin === "https://api.typesafe.ai" && url.pathname === "/v1/systemone"
    ? observed(input, init)
    : original(input, init);
};
process.once("exit", () => closeSync(handle));
