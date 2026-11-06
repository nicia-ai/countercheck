import { mkdtemp, open, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchPinnedFindverFile,
  pinnedFindverReports,
  readBoundedFindverCache,
} from "../eval/business/fetch-findver.js";
import { sha256 } from "../eval/types.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
async function temporaryPath(name: string) {
  const dir = await mkdtemp(join(tmpdir(), "findver-cache-review-"));
  directories.push(dir);
  return join(dir, name);
}
async function sparseOversizedFile(path: string) {
  const handle = await open(path, "wx");
  try {
    await handle.truncate(1024 ** 3);
  } finally {
    await handle.close();
  }
}

describe("FinDVer cache bounds and inventory identity", () => {
  it("rejects an oversized inventory cache before reading its contents", async () => {
    const path = await temporaryPath("tree.json");
    await sparseOversizedFile(path);
    await expect(readBoundedFindverCache(path, 2 * 1024 ** 2)).rejects.toThrow("Oversized");
  });

  it("keeps cache reads exact at their boundary", async () => {
    const path = await temporaryPath("small.json");
    await writeFile(path, "1234");
    expect((await readBoundedFindverCache(path, 4)).toString()).toBe("1234");
    await expect(readBoundedFindverCache(path, 3)).rejects.toThrow("Oversized");
  });

  it("applies the same bound if another process creates the cache during the fetch", async () => {
    const path = await temporaryPath("testmini.json");
    const send = vi.fn(async () => {
      await sparseOversizedFile(path);
      return new Response("safe");
    });
    await expect(
      fetchPinnedFindverFile({
        path,
        relativeUrl: "data/testmini.json",
        maxBytes: 1024,
        expectedBytes: 4,
        expectedSha256: sha256("safe"),
        fetch: send as typeof fetch,
      }),
    ).rejects.toThrow("Oversized");
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("rejects well-formed cached inventories whose report identity is not the pinned source", () => {
    const name = "SYNTHETIC-2024-01-01_10-Q.json";
    const tree = {
      truncated: false,
      tree: [{ path: `financial_reports/${name}`, type: "blob", sha: "a".repeat(40), size: 100 }],
    };
    for (const subset of ["ie", "numeric"] as const)
      expect(() => pinnedFindverReports(tree, [name], subset)).toThrow("pinned source identity");
    expect(() => pinnedFindverReports({ ...tree, truncated: true }, [name], "ie")).toThrow();
    expect(() => pinnedFindverReports(tree, ["missing.json"], "ie")).toThrow("missing");
  });
});
