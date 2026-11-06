import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { sha256File } from "../eval/files.js";
import { sampleGroups } from "../eval/datasets.js";
import { summarize, type Scored } from "../eval/metrics.js";
import { sha256, type Manifest } from "../eval/types.js";

const results = "eval/results/deberta-dev-2026-11-03";
type Baseline = ReturnType<typeof summarize> & { rows: Scored[] };
function qualityAndDollarMetrics(summary: ReturnType<typeof summarize>) {
  const omitTokens = ({ cost, ...metric }: ReturnType<typeof summarize>["overall"]) => ({
    ...metric,
    cost: {
      known_rows: cost.known_rows,
      unknown_rows: cost.unknown_rows,
      known_total_usd: cost.known_total_usd,
    },
  });
  const slices = (values: ReturnType<typeof summarize>["by_dataset"]) =>
    Object.fromEntries(Object.entries(values).map(([key, value]) => [key, omitTokens(value)]));
  return {
    overall: omitTokens(summary.overall),
    intervals: summary.intervals,
    by_dataset: slices(summary.by_dataset),
    by_native_label: slices(summary.by_native_label),
    by_pass: slices(summary.by_pass),
  };
}
type SamplingCase = {
  dataset: string;
  seed: string;
  limit: number;
  selected_count: number;
  selected_ids_sha256: string;
};

describe("evaluation efficiency preserves reproducibility", () => {
  it("streams exact file-byte SHA-256 across multiple chunks and propagates file errors", async () => {
    const directory = await mkdtemp(join(tmpdir(), "countercheck-file-hash-"));
    try {
      const bytes = Buffer.alloc(2 * 1024 * 1024 + 19);
      for (let i = 0; i < bytes.length; i++) bytes[i] = i % 256;
      const path = join(directory, "binary-fixture");
      await writeFile(path, bytes);
      expect(await sha256File(path)).toBe(sha256(bytes));
      const empty = join(directory, "empty");
      await writeFile(empty, "");
      expect(await sha256File(empty)).toBe(sha256(""));
      await expect(sha256File(join(directory, "missing"))).rejects.toThrow();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("selects the original exact pair IDs across seeds, tight caps and entire samples", async () => {
    const fixture = JSON.parse(
      await readFile("eval/fixtures/sampling-regression.json", "utf8"),
    ) as { cases: SamplingCase[] };
    for (const scenario of fixture.cases) {
      const manifest = JSON.parse(
        await readFile(`${results}/${scenario.dataset}.manifest`, "utf8"),
      ) as Manifest;
      const selected = sampleGroups(manifest.pairs, scenario.limit, scenario.seed);
      expect(selected.length).toBe(scenario.selected_count);
      expect(sha256(JSON.stringify(selected.map((p) => p.id)))).toBe(scenario.selected_ids_sha256);
    }
  });

  it.each([
    ["deberta-dev-2026-11-03", "vitaminc-combined-dev"],
    ["deberta-dev-2026-11-03", "scifact-dev"],
    ["decider-dev-2026-11-03", "vitaminc-combined-dev"],
    ["decider-dev-2026-11-03", "scifact-dev"],
  ])(
    "reproduces saved %s/%s quality metrics and bootstrap intervals while correcting usage",
    async (run, dataset) => {
      const baseline = JSON.parse(
        await readFile(`eval/results/${run}/${dataset}.report.json`, "utf8"),
      ) as Baseline;
      const current = summarize(baseline.rows);
      expect(qualityAndDollarMetrics(current)).toStrictEqual(
        qualityAndDollarMetrics({
          overall: baseline.overall,
          intervals: baseline.intervals,
          by_dataset: baseline.by_dataset,
          by_native_label: baseline.by_native_label,
          by_pass: baseline.by_pass,
        }),
      );
      const attempted = baseline.rows.filter((row) => row.prediction.status !== "excluded");
      const knownInput = attempted.filter(
        (row) => row.prediction.input_tokens !== undefined,
      ).length;
      expect(current.overall.cost.input_tokens).toBe(
        knownInput === attempted.length ? baseline.overall.cost.input_tokens : null,
      );
      expect(current.overall.cost.output_tokens).toBeNull();
      expect(current.overall.cost.token_usage.input.known_observations).toBe(knownInput);
      expect(current.overall.cost.token_usage.input.known_subtotal).toBe(
        baseline.overall.cost.input_tokens,
      );
      expect(current.overall.cost.token_usage.output).toEqual({
        known_subtotal: 0,
        known_observations: 0,
        unknown_observations: attempted.length,
      });
    },
  );
});
