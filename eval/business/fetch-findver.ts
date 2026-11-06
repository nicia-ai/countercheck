/** Public data transport only. No inference credentials or model API calls. */
import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { sha256, type Source } from "../types.js";
import { FINDVER_SOURCE, findverReportNames, type FindverSubset } from "./findver.js";

const MiB = 1024 * 1024;
const MAX_REPORT_BYTES = 8 * MiB;
const MAX_TOTAL_REPORT_BYTES = 150 * MiB;
export const FINDVER_REPORT_INVENTORY_SHA256 = {
  ie: "36cb4ffeb6c4fb194ffe61d1cd02a58e4a04211d4e99b14f56f2376efc243b8e",
  numeric: "249a0922dd72ac166e136e62eadaea7a1a55d67f207151661cb64b9cd3e1e51f",
} as const;
const gitBlob = (bytes: Uint8Array) =>
  createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");

async function readBoundedResponse(response: Response, maxBytes: number): Promise<Buffer> {
  if (!response.ok || !response.body)
    throw new Error("FinDVer data request failed; no retry or redirect.");
  if (Number(response.headers.get("content-length")) > maxBytes) {
    await response.body.cancel();
    throw new Error("FinDVer data response exceeds the bounded resource size.");
  }
  const reader = response.body.getReader(),
    chunks: Uint8Array[] = [];
  let count = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      count += next.value.byteLength;
      if (count > maxBytes)
        throw new Error("FinDVer streamed response exceeds the bounded resource size.");
      chunks.push(next.value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}

export async function readBoundedFindverCache(path: string, maxBytes: number): Promise<Buffer> {
  const info = await stat(path);
  if (info.size > maxBytes) throw new Error("Oversized FinDVer cache file.");
  const bytes = await readFile(path);
  if (bytes.length > maxBytes) throw new Error("Oversized FinDVer cache file.");
  return bytes;
}

/** Cache bytes must match the pinned source; a failed fetch never becomes a reusable partial file. */
export async function fetchPinnedFindverFile(input: {
  path: string;
  relativeUrl: string;
  maxBytes: number;
  expectedSha256?: string;
  expectedGitBlob?: string;
  expectedBytes?: number;
  fetch?: typeof fetch;
}) {
  if (
    !/^(?:data\/testmini\.json|financial_reports\/[A-Za-z0-9][A-Za-z0-9_.-]*\.json)$/.test(
      input.relativeUrl,
    )
  )
    throw new Error("Unsupported pinned FinDVer resource path.");
  const validate = (bytes: Buffer) => {
    if (
      bytes.length > input.maxBytes ||
      (input.expectedBytes !== undefined && bytes.length !== input.expectedBytes) ||
      (input.expectedSha256 !== undefined && sha256(bytes) !== input.expectedSha256) ||
      (input.expectedGitBlob !== undefined && gitBlob(bytes) !== input.expectedGitBlob)
    )
      throw new Error("FinDVer cached/downloaded bytes disagree with pinned provenance or size.");
    return bytes;
  };
  try {
    return {
      bytes: validate(await readBoundedFindverCache(input.path, input.maxBytes)),
      cached: true,
    };
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
  const response = await (input.fetch ?? fetch)(FINDVER_SOURCE.base_url + input.relativeUrl, {
    redirect: "manual",
    signal: AbortSignal.timeout(30000),
  });
  const bytes = validate(await readBoundedResponse(response, input.maxBytes));
  try {
    await writeFile(input.path, bytes, { flag: "wx", mode: 0o600 });
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
    validate(await readBoundedFindverCache(input.path, input.maxBytes));
  }
  return { bytes, cached: false };
}

const treeSchema = z.object({
  tree: z.array(
    z.object({
      path: z.string(),
      type: z.string(),
      sha: z.string().regex(/^[a-f0-9]{40}$/),
      size: z.number().int().nonnegative().optional(),
    }),
  ),
  truncated: z.literal(false),
});

export function pinnedFindverReports(
  value: unknown,
  names: readonly string[],
  subset: FindverSubset,
) {
  const tree = treeSchema.parse(value);
  const inventory = new Map(
    tree.tree.filter((file) => file.type === "blob").map((file) => [file.path, file]),
  );
  const selected = [...names].sort().map((name) => {
    const file = inventory.get(`financial_reports/${name}`);
    if (!file || file.size === undefined || file.size < 1 || file.size > MAX_REPORT_BYTES)
      throw new Error("FinDVer selected report is missing or exceeds its resource bound.");
    return { name, file, size: file.size };
  });
  const canonical = selected.map(({ name, file, size }) => ({
    name,
    git_blob_sha1: file.sha,
    bytes: size,
  }));
  if (sha256(JSON.stringify(canonical)) !== FINDVER_REPORT_INVENTORY_SHA256[subset])
    throw new Error("FinDVer report inventory disagrees with pinned source identity.");
  return selected;
}

/** Selective, bounded download with at most two report requests running concurrently. */
export async function fetchFindverTestmini(
  options: {
    cacheDir?: string;
    subset?: FindverSubset;
    fetch?: typeof fetch;
  } = {},
) {
  const cache = options.cacheDir ?? "eval/data/business/findver";
  const subset = options.subset ?? "ie";
  await mkdir(join(cache, "financial_reports"), { recursive: true });
  const send = options.fetch ?? fetch;
  const data = await fetchPinnedFindverFile({
    path: join(cache, "testmini.json"),
    relativeUrl: "data/testmini.json",
    maxBytes: 2 * MiB,
    expectedSha256: FINDVER_SOURCE.testmini_sha256,
    expectedBytes: FINDVER_SOURCE.testmini_bytes,
    fetch: send,
  });
  const value: unknown = JSON.parse(data.bytes.toString("utf8"));
  const names = findverReportNames(value, subset);
  const treePath = join(cache, `tree-${FINDVER_SOURCE.revision}.json`);
  let treeBytes: Buffer;
  try {
    treeBytes = await readBoundedFindverCache(treePath, 2 * MiB);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    const response = await send(
      `https://api.github.com/repos/yilunzhao/FinDVer/git/trees/${FINDVER_SOURCE.revision}?recursive=1`,
      {
        redirect: "manual",
        signal: AbortSignal.timeout(30000),
      },
    );
    treeBytes = await readBoundedResponse(response, 2 * MiB);
    treeSchema.parse(JSON.parse(treeBytes.toString("utf8")));
    await writeFile(treePath, treeBytes, { flag: "wx", mode: 0o600 });
  }
  const selected = pinnedFindverReports(JSON.parse(treeBytes.toString("utf8")), names, subset);
  const expected = selected.reduce((sum, report) => sum + report.size, 0);
  if (expected > MAX_TOTAL_REPORT_BYTES)
    throw new Error("FinDVer selected report set exceeds the total data budget.");
  const reports = new Map<string, unknown>();
  const sourceByName = new Map<string, Source>();
  let cursor = 0,
    downloaded = 0,
    cached = 0,
    failed = false;
  const completed = await Promise.allSettled(
    [0, 1].map(async () => {
      try {
        while (!failed && cursor < selected.length) {
          const { name, file, size } = selected[cursor++]!;
          const result = await fetchPinnedFindverFile({
            path: join(cache, "financial_reports", name),
            relativeUrl: `financial_reports/${name}`,
            maxBytes: MAX_REPORT_BYTES,
            expectedBytes: size,
            expectedGitBlob: file.sha,
            fetch: send,
          });
          if (result.cached) cached++;
          else downloaded++;
          reports.set(name, JSON.parse(result.bytes.toString("utf8")) as unknown);
          sourceByName.set(name, {
            name: `findver-report:${name}`,
            url: FINDVER_SOURCE.base_url + `financial_reports/${name}`,
            revision: FINDVER_SOURCE.revision,
            sha256: sha256(result.bytes),
            license: FINDVER_SOURCE.license,
            license_url: FINDVER_SOURCE.license_url,
          });
        }
      } catch (error) {
        failed = true;
        throw error;
      }
    }),
  );
  const failure = completed.find((result) => result.status === "rejected");
  if (failure?.status === "rejected") throw failure.reason;
  const sources: Source[] = [
    {
      name: "findver-testmini",
      url: FINDVER_SOURCE.base_url + "data/testmini.json",
      revision: FINDVER_SOURCE.revision,
      sha256: sha256(data.bytes),
      license: FINDVER_SOURCE.license,
      license_url: FINDVER_SOURCE.license_url,
    },
    ...names.map((name) => sourceByName.get(name)!),
  ];
  return {
    value,
    reports,
    sources,
    downloads: {
      subset,
      selected_reports: names.length,
      total_report_bytes: expected,
      downloaded_reports: downloaded,
      cached_reports: cached,
      report_concurrency: 2,
      max_report_bytes: MAX_REPORT_BYTES,
      max_total_report_bytes: MAX_TOTAL_REPORT_BYTES,
      report_inventory_sha256: FINDVER_REPORT_INVENTORY_SHA256[subset],
    },
  };
}
