import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseFindver } from "../eval/business/findver.js";
import { fetchPinnedFindverFile } from "../eval/business/fetch-findver.js";
import { envelopeGroups } from "../eval/business/common.js";
import { sha256 } from "../eval/types.js";

// Deliberately synthetic schema fixtures, never public performance observations.
const filename = "DEMO-2024-01-01_10-Q.json";
const row = {
  example_id: "synthetic-case",
  subset: "ie",
  split: "testmini",
  statement: "Demo revenue is USD 12 million.",
  entailment_label: false,
  relevant_context: [1, 0],
  report: filename,
  explanation: "GOLD ANSWER MUST NOT ENTER INFERENCE",
};
const report = {
  url: "https://example.org/report",
  report_type: "10-Q",
  context: [
    { id: 0, context: "Reporting period: Q1; amounts in USD millions.", type: "paragraph" },
    { id: 1, context: "| Metric | Q1 |\n|---|---|\n| Revenue | 10 |", type: "table" },
  ],
  html_tables: ["<table>Alternate rendering is not extra annotated evidence.</table>"],
};
const reports = () => new Map<string, unknown>([[filename, structuredClone(report)]]);

describe("FinDVer complete annotated-evidence adaptation", () => {
  it("preserves both annotated contexts, headers and source order without leaking explanations", () => {
    const prepared = parseFindver([row], reports());
    const pair = prepared.pairs[0]!;
    expect(pair.evidence).toBe(
      `[paragraph id = 0] ${report.context[0]!.context}\n[paragraph id = 1] ${report.context[1]!.context}`,
    );
    expect(pair.evidence).not.toContain("GOLD ANSWER");
    expect(pair.evidence).not.toContain("Alternate rendering");
    expect(pair).toMatchObject({
      dataset: "findver",
      split: "test",
      variant: "testmini-ie",
      native_label: "refuted",
      gold: "contradiction",
      group_id: `findver:report:${filename}`,
    });
    expect(pair.source_metadata?.evidence_sha256).toBe(sha256(pair.evidence));
    expect(
      parseFindver([{ ...row, entailment_label: true }], reports()).pairs[0]?.native_label,
    ).toBe("entailed");
  });

  it("retains unused empty source positions but rejects empty annotated support", () => {
    const source = structuredClone(report);
    source.context.push({ id: 2, context: "", type: "paragraph" });
    expect(parseFindver([row], new Map([[filename, source]])).pairs).toHaveLength(1);
    expect(() =>
      parseFindver([{ ...row, relevant_context: [2] }], new Map([[filename, source]])),
    ).toThrow("empty");
  });

  it("records duplicated annotation references without inventing a second source fact", () => {
    const prepared = parseFindver([{ ...row, relevant_context: [0, 1, 0] }], reports());
    expect(prepared.coverage.duplicate_context_references).toBe(1);
    expect(prepared.pairs[0]!.source_metadata?.source_evidence_indices).toBe("[0,1,0]");
    expect(prepared.pairs[0]!.source_metadata?.evidence_indices).toBe("[0,1]");
    expect(prepared.pairs[0]!.evidence).toBe(parseFindver([row], reports()).pairs[0]!.evidence);
  });

  it("keeps report contrast groups atomic when any complete evidence pair exceeds the service limit", () => {
    const long = structuredClone(report);
    long.context[1]!.context = "x".repeat(2200);
    const prepared = parseFindver(
      [
        { ...row, example_id: "short", relevant_context: [0] },
        { ...row, example_id: "long", relevant_context: [1] },
      ],
      new Map([[filename, long]]),
    );
    expect(prepared.pairs).toHaveLength(2);
    expect(prepared.pairs[1]!.evidence).toContain("x".repeat(2200));
    expect(envelopeGroups(prepared.pairs)).toMatchObject({
      pairs: [],
      excludedPairs: 2,
      excludedGroups: 1,
    });
  });

  it("separates outside-knowledge and unlabeled cases and refuses missing or partial source support", () => {
    expect(
      parseFindver(
        [
          { ...row, subset: "knowledge" },
          { ...row, entailment_label: undefined },
        ],
        reports(),
      ),
    ).toMatchObject({ pairs: [], exclusions: { outside_subset: 1, unlabeled: 1 } });
    expect(() => parseFindver([row], new Map())).toThrow("missing");
    for (const relevant_context of [[9], []])
      expect(() => parseFindver([{ ...row, relevant_context }], reports())).toThrow();
    expect(() => parseFindver([{ ...row, entailment_label: "false" }], reports())).toThrow();
    expect(() => parseFindver([row, row], reports())).toThrow("Duplicate");
    expect(() => parseFindver([{ ...row, report: "../report.json" }], reports())).toThrow();
  });
});

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});
async function cachePath() {
  const directory = await mkdtemp(join(tmpdir(), "countercheck-findver-"));
  directories.push(directory);
  return join(directory, "testmini.json");
}

describe("FinDVer bounded pinned data transport", () => {
  it("verifies cached bytes and makes no second request", async () => {
    const bytes = Buffer.from("synthetic data bytes");
    const send = vi.fn(async () => new Response(bytes));
    const input = {
      path: await cachePath(),
      relativeUrl: "data/testmini.json",
      maxBytes: 1024,
      expectedSha256: sha256(bytes),
      expectedBytes: bytes.length,
      fetch: send as typeof fetch,
    };
    expect((await fetchPinnedFindverFile(input)).cached).toBe(false);
    expect((await fetchPinnedFindverFile(input)).cached).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
    expect(await readFile(input.path)).toEqual(bytes);
  });

  it("rejects redirects, streamed overflow and hash mismatch without saving partial cache files", async () => {
    for (const response of [
      new Response(null, { status: 302 }),
      new Response("x".repeat(100)),
      new Response("bad hash"),
    ]) {
      const path = await cachePath();
      const send = vi.fn(async (_url: unknown, options?: RequestInit) => {
        expect(options?.redirect).toBe("manual");
        return response;
      });
      await expect(
        fetchPinnedFindverFile({
          path,
          relativeUrl: "data/testmini.json",
          maxBytes: 50,
          expectedSha256: sha256("expected"),
          fetch: send as typeof fetch,
        }),
      ).rejects.toThrow();
      expect(send).toHaveBeenCalledTimes(1);
      await expect(stat(path)).rejects.toMatchObject({ code: "ENOENT" });
    }
  });
});
