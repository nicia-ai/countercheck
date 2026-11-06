import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, writeFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createServer } from "node:http";
import { evaluateCheck } from "../src/kernel/index.js";
import type { CheckRequest } from "../src/contracts/index.js";
import { sha256, type Manifest } from "../eval/types.js";

const execute = promisify(execFile);
const dirs: string[] = [];
const fixture = resolve("eval/fixtures/synthetic-smoke.json");
const cli = resolve("scripts/eval.ts");
const tsx = resolve("node_modules/tsx/dist/cli.mjs");
async function directory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "countercheck-eval-"));
  dirs.push(path);
  return path;
}
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((p) => rm(p, { recursive: true, force: true })));
});
async function run(args: string[], entrypoint = cli, environment: Record<string, string> = {}) {
  return execute(process.execPath, [tsx, entrypoint, ...args], {
    timeout: 15_000,
    env: {
      ...process.env,
      TYPESAFE_API_KEY: "",
      OPENROUTER_API_KEY: "",
      OPENAI_API_KEY: "",
      FASTINO_API_KEY: "",
      CLOUDFLARE_API_TOKEN: "",
      COUNTERCHECK_API_KEY: "",
      ...environment,
    },
  });
}
describe("evaluation command safety and smoke", () => {
  it("prints standalone help without a manifest or credentials", async () => {
    const { stdout } = await run(["--help"]);
    expect(stdout).toContain("--live");
    expect(stdout).toContain("--max-spend-usd");
    expect(stdout).toContain("jev-direct");
  });
  it("requires model selection and live budgets before hosted provider creation", async () => {
    for (const args of [[], ["--model", "unknown"], ["--model", "clef-omni"]]) {
      await expect(
        run([
          "--backend",
          "hosted",
          "--manifest",
          fixture,
          "--out",
          join(await directory(), "hosted"),
          ...args,
        ]),
      ).rejects.toThrow();
    }
    await expect(
      run([
        "--backend",
        "fake",
        "--model",
        "clef",
        "--manifest",
        fixture,
        "--out",
        join(await directory(), "fake-model"),
      ]),
    ).rejects.toThrow();
  });
  it("produces synthetic-only JSON and Markdown without credentials and refuses overwrite", async () => {
    const out = join(await directory(), "report");
    const args = ["--backend", "fake", "--manifest", fixture, "--out", out];
    await run(args);
    const report = JSON.parse(await readFile(`${out}.json`, "utf8")) as {
      purpose: string;
      denominator?: number;
      overall: { denominator: number; errors: number };
      schema_version: number;
      protocol: {
        public_dataset: boolean;
        measurement_stage: string;
        production_qualification: string;
      };
      rows: { prediction: { model: string } }[];
      prediction_artifact: { sha256: string };
    };
    expect(report.purpose).toBe("synthetic-smoke");
    expect(report.overall.denominator).toBe(8);
    expect(report.overall.errors).toBe(0);
    expect(report.schema_version).toBe(2);
    expect(report.protocol.public_dataset).toBe(false);
    expect(report.protocol.measurement_stage).toBe("synthetic_smoke");
    expect(report.protocol.production_qualification).toBe("not_assessed");
    expect(report.protocol).not.toHaveProperty("public_performance_claim");
    expect(report.rows.every((r) => r.prediction.model === "fake-no-model")).toBe(true);
    const checkpoint = await readFile(`${out}.predictions.jsonl`, "utf8");
    expect(checkpoint.trim().split("\n")).toHaveLength(8);
    expect(report.prediction_artifact.sha256).toBe(sha256(checkpoint));
    expect(await readFile(`${out}.md`, "utf8")).toContain(
      "No live model or public semantic benchmark was run",
    );
    await expect(run(args)).rejects.toThrow();
  });
  it("excludes uncertain synthetic proxy labels from binary scores but retains executions", async () => {
    const out = join(await directory(), "contract");
    await run([
      "--backend",
      "fake",
      "--profile",
      "structured-value-v1",
      "--manifest",
      resolve("eval/fixtures/prompt-ablation-contract.json"),
      "--out",
      out,
    ]);
    const report = JSON.parse(await readFile(`${out}.json`, "utf8"));
    expect(report.overall.denominator).toBe(28);
    expect(report.diagnostics.execution_observations).toBe(32);
    expect(report.diagnostics.execution_completed).toBe(32);
    expect(report.diagnostics.expected_uncertain_excluded_from_binary).toBe(4);
    expect(report.overall.probability_denominator).toBe(0);
    expect(report.rows).toHaveLength(32);
    expect(
      report.rows.filter((r: { prediction: { status: string } }) => r.prediction.status === "ok"),
    ).toHaveLength(32);
  });
  it("executes through a symlink whose path contains URL-reserved characters", async () => {
    const dir = await directory();
    const entrypoint = join(dir, "eval #?%.ts");
    await symlink(cli, entrypoint);
    const out = join(dir, "report");
    await run(["--backend", "fake", "--manifest", fixture, "--out", out], entrypoint);
    const report = JSON.parse(await readFile(`${out}.json`, "utf8")) as {
      overall: { denominator: number };
    };
    expect(report.overall.denominator).toBe(8);
  });
  it("refuses inference without explicit opt-in or adequate reservations", async () => {
    const out = join(await directory(), "live");
    await expect(run(["--backend", "jev", "--manifest", fixture, "--out", out])).rejects.toThrow();
    await expect(
      run([
        "--backend",
        "jev",
        "--manifest",
        fixture,
        "--out",
        out,
        "--live",
        "--max-calls",
        "1",
        "--max-spend-usd",
        "1",
        "--cost-per-call-usd",
        "0.1",
      ]),
    ).rejects.toThrow();
    await expect(readFile(`${out}.json`)).rejects.toThrow();
  });
  it("requires manifest-bound object metadata for public replay before writing a report", async () => {
    const dir = await directory();
    const source = JSON.parse(await readFile(fixture, "utf8")) as Manifest;
    const pairs = source.pairs.map((p) => ({
      ...p,
      dataset: "vitaminc",
      variant: "fixture",
      split: "dev",
      native_label: p.gold === "contradiction" ? "REFUTES" : "SUPPORTS",
    }));
    const manifestText = JSON.stringify({ ...source, purpose: "development", pairs });
    const manifest = join(dir, "manifest.json");
    const predictions = join(dir, "predictions.json");
    const metadata = `${predictions}.metadata.json`;
    const out = join(dir, "report");
    await writeFile(manifest, manifestText);
    await writeFile(
      predictions,
      JSON.stringify(
        pairs.map((p) => ({
          pair_id: p.id,
          pass: 1,
          status: "ok",
          verdict: "uncertain",
          probabilities: { contradiction: 0.25, no_contradiction: 0.5, insufficient_context: 0.25 },
          latency_ms: 1,
        })),
      ),
    );
    const args = [
      "--backend",
      "replay",
      "--manifest",
      manifest,
      "--predictions",
      predictions,
      "--out",
      out,
    ];
    await expect(run(args)).rejects.toThrow();
    await writeFile(metadata, "null");
    await expect(run(args)).rejects.toThrow();
    await expect(readFile(`${out}.json`)).rejects.toThrow();
    await writeFile(
      metadata,
      JSON.stringify({ manifest_sha256: sha256(manifestText), model: "fixture-only" }),
    );
    await run(args);
    const report = JSON.parse(await readFile(`${out}.json`, "utf8")) as {
      prediction_metadata: { model: string };
      protocol: {
        public_dataset: boolean;
        measurement_stage: string;
        production_qualification: string;
        presentation: null;
        batch_size: null;
        concurrency: null;
        timeout_ms: null;
        transport_route: null;
      };
      prediction_artifact: { sha256: string; source: string };
    };
    expect(report.prediction_metadata.model).toBe("fixture-only");
    expect(report.protocol).toMatchObject({
      public_dataset: true,
      measurement_stage: "public_development",
      production_qualification: "not_assessed",
    });
    expect(report.protocol).not.toHaveProperty("public_performance_claim");
    expect(report.protocol).toMatchObject({
      presentation: null,
      batch_size: null,
      concurrency: null,
      timeout_ms: null,
      transport_route: null,
    });
    expect(report.prediction_artifact.source).toBe("external_replay");
    expect(report.prediction_artifact.sha256).toBe(sha256(await readFile(predictions)));
  });
  it("retains complete dispatched predictions if final summary generation fails", async () => {
    const dir = await directory();
    const source = JSON.parse(await readFile(fixture, "utf8")) as Manifest;
    const pairs = source.pairs.slice(4, 6);
    const manifest = join(dir, "manifest.json");
    await writeFile(
      manifest,
      JSON.stringify({
        ...source,
        pairs,
        sampling: { ...source.sampling, selected_pairs: pairs.length },
      }),
    );
    let calls = 0;
    const server = createServer(async (request, response) => {
      let text = "";
      for await (const chunk of request) text += String(chunk);
      const check = JSON.parse(text) as CheckRequest;
      const result = await evaluateCheck(
        check,
        {
          id: "fixture",
          model: "fixture",
          async classify(payload) {
            return {
              answers: Object.fromEntries(
                Object.keys(payload.questions).map((id) => [
                  id,
                  {
                    type: "choice",
                    probabilities: {
                      contradiction: 0,
                      consistent: 1,
                      different_scope: 0,
                      insufficient_context: 0,
                    },
                  },
                ]),
              ),
            };
          },
        },
        { requestId: "deliberately-reused-request-id", signal: new AbortController().signal },
      );
      result.usage.input_tokens = ++calls;
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(result));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing fixture server address");
    const out = join(dir, "failure", "report");
    try {
      await expect(
        run(
          [
            "--backend",
            "service",
            "--manifest",
            manifest,
            "--out",
            out,
            "--url",
            `http://127.0.0.1:${address.port}`,
            "--live",
            "--max-calls",
            "2",
            "--cost-per-call-usd",
            "0.01",
            "--max-spend-usd",
            "0.02",
          ],
          cli,
          { COUNTERCHECK_API_KEY: "fixture-only-key" },
        ),
      ).rejects.toThrow();
      expect(calls).toBe(2);
      const rows = (await readFile(`${out}.predictions.jsonl`, "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      expect(rows).toHaveLength(2);
      expect(rows.every((row: { status: string }) => row.status === "ok")).toBe(true);
      const metadata = JSON.parse(await readFile(`${out}.predictions.jsonl.metadata.json`, "utf8"));
      expect(metadata).toHaveProperty("manifest_sha256");
      expect(metadata.model).toBeNull();
      expect(rows.every((row: { model?: string }) => row.model === "fixture")).toBe(true);
      await expect(readFile(`${out}.json`)).rejects.toThrow();
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
