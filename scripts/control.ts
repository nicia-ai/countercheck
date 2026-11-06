import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "../eval/args.js";

const HELP =
  "Usage: tsx scripts/control.ts <overview|pause|resume|tenant-pause|tenant-resume|enroll> [--origin https://countercheck.nicia.ai] [--tenant-id ID]. Set COUNTERCHECK_ADMIN_COOKIE to a verified administrator session cookie in the environment; never pass it on the command line. Origin defaults to COUNTERCHECK_ORIGIN or https://countercheck.nicia.ai. Changes use authenticated admin routes and make no inference calls.";
const MAX_RESPONSE_BYTES = 256 * 1024;

async function responseJson(response: Response): Promise<unknown> {
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(`Control request failed (HTTP ${response.status}).`);
  }
  if (
    !response.body ||
    !/^application\/json(?:\s*;|$)/i.test(response.headers.get("content-type") ?? "")
  )
    throw new Error("Control response was not JSON.");
  const reader = response.body.getReader();
  let bytes = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) throw new Error("Control response exceeded its byte limit.");
      chunks.push(next.value);
    }
    const all = Buffer.concat(chunks);
    try {
      return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(all)) as unknown;
    } catch {
      throw new Error("Control response contained invalid JSON.");
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
}

export async function runControl(
  argv: string[],
  env: Record<string, string | undefined> = process.env,
  send: typeof fetch = fetch,
): Promise<unknown> {
  if (!argv.length || argv[0] === "--help") return HELP;
  const [command, ...rest] = argv;
  const args = parseArgs(rest, ["origin", "tenant-id", "help"]);
  if (args.help) return HELP;
  if (
    !["overview", "pause", "resume", "tenant-pause", "tenant-resume", "enroll"].includes(command!)
  )
    throw new Error("Unknown control command; use --help.");
  let origin: URL;
  try {
    origin = new URL(args.origin ?? env.COUNTERCHECK_ORIGIN ?? "https://countercheck.nicia.ai");
  } catch {
    throw new Error("Provide a valid HTTPS origin.");
  }
  if (
    origin.protocol !== "https:" ||
    origin.username ||
    origin.password ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash
  )
    throw new Error("Provide a bare HTTPS origin without credentials, path, query or fragment.");
  const cookie = env.COUNTERCHECK_ADMIN_COOKIE;
  if (!cookie?.trim() || cookie.length > 16384 || /[\r\n]/.test(cookie))
    throw new Error("Set a valid COUNTERCHECK_ADMIN_COOKIE environment variable.");
  const tenantCommand = command!.startsWith("tenant-") || command === "enroll";
  const tenantId = args["tenant-id"];
  if (
    tenantCommand ? !tenantId || !/^[A-Za-z0-9_.:-]{1,128}$/.test(tenantId) : tenantId !== undefined
  )
    throw new Error("Provide --tenant-id only for tenant-pause, tenant-resume or enroll.");
  const path =
    command === "overview"
      ? "overview"
      : command === "enroll"
        ? "enroll"
        : tenantCommand
          ? `tenants/${encodeURIComponent(tenantId!)}/pause`
          : "pause";
  const payload =
    command === "overview"
      ? undefined
      : command === "enroll"
        ? { tenantId }
        : { paused: command === "pause" || command === "tenant-pause" };
  let response: Response;
  try {
    response = await send(`${origin.origin}/dashboard/api/admin/${path}`, {
      method: payload === undefined ? "GET" : "POST",
      headers: {
        cookie,
        origin: origin.origin,
        accept: "application/json",
        ...(payload !== undefined && { "content-type": "application/json" }),
      },
      ...(payload !== undefined && { body: JSON.stringify(payload) }),
      redirect: "manual",
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    throw new Error("Control request could not be completed.");
  }
  return responseJson(response);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  runControl(process.argv.slice(2)).then(
    (value) => console.log(typeof value === "string" ? value : JSON.stringify(value, null, 2)),
    () => {
      console.error(
        "Control operation failed. Check HTTPS origin, verified administrator session, command and service availability; use --help.",
      );
      process.exitCode = 1;
    },
  );
