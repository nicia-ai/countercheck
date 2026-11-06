import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runBundledPair } from "../eval/iteration/bundled-runner.js";
import { compileBundle, DEFAULT_BUNDLE_PROFILES } from "../eval/iteration/bundle.js";
import { createBackend, BACKEND_IDS, type BackendId } from "../eval/iteration/backends.js";
import type { CandidatePayload } from "../eval/iteration/profiles.js";
import { metrics } from "../eval/metrics.js";
import { sha256, type Pair } from "../eval/types.js";

const execute = promisify(execFile);
const directories: string[] = [];
const env = {
  TYPESAFE_API_KEY: "unit-only",
  CLOUDFLARE_API_TOKEN: "unit-only",
  CLOUDFLARE_ACCOUNT_ID: "a".repeat(32),
  OPENROUTER_API_KEY: "unit-only",
};
const pair: Pair = {
  id: "bundle-unit",
  dataset: "synthetic-smoke",
  variant: "invented",
  split: "synthetic",
  source_id: "bundle-unit",
  group_id: "bundle-unit",
  claim: "The sample weighs exactly 10 kg.",
  evidence: "The sample weighs exactly 20 kg.",
  gold: "contradiction",
  native_label: "contradiction",
};
function raw(payload: CandidatePayload, model = payload.model) {
  return {
    model,
    usage: { input_tokens: 123, output_tokens: 17 },
    answers: Object.fromEntries(
      Object.entries(payload.questions).map(([id, question]) => [
        id,
        question.type === "noul"
          ? { type: "noul", noul: 0.9 }
          : {
              type: "choice",
              probabilities: Object.fromEntries(
                Object.keys(question.criteria).map((label) => [
                  label,
                  label === (Object.hasOwn(question.criteria, "p_0_0") ? "p_0_0" : "contradiction")
                    ? 1
                    : 0,
                ]),
              ),
            },
      ]),
    ),
  };
}
function responder(id: BackendId) {
  return vi.fn<typeof fetch>(async (_url, init) => {
    const body = JSON.parse(init!.body as string) as CandidatePayload;
    const value = raw(
      body,
      id === "decider" ? "perplexity/pplx-decider-v1.2-20261016" : body.model,
    );
    return Response.json(
      id === "clef"
        ? { success: true, errors: [], messages: [], result: value }
        : id === "decider"
          ? {
              ...value,
              id: "PRIVATE_ROUTER_ID",
              provider: "Perplexity",
              usage: { ...value.usage, cost: 0.001 },
            }
          : value,
    );
  });
}
afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("bundled execution accounting", () => {
  it("canonicalizes head order so reversed caller profiles compile to identical input", () => {
    const original = compileBundle(DEFAULT_BUNDLE_PROFILES, pair);
    const reversed = compileBundle([...DEFAULT_BUNDLE_PROFILES].reverse(), pair);
    expect(original.payload).toEqual(reversed.payload);
    expect(original.prompt_sha256).toBe(reversed.prompt_sha256);
    expect(original.profiles).toEqual([...DEFAULT_BUNDLE_PROFILES].sort());
  });
  it.each(BACKEND_IDS)(
    "returns five remapped %s heads from one actual request with deduplicated usage",
    async (id) => {
      const send = responder(id),
        backend = createBackend(id, env);
      const rows = await runBundledPair(DEFAULT_BUNDLE_PROFILES, pair, 2, {
        backend,
        sequence: 7,
        fetch: send,
      });
      expect(send).toHaveBeenCalledTimes(1);
      expect(rows.map((row) => row.profile)).toEqual([...DEFAULT_BUNDLE_PROFILES].sort());
      expect(rows).toHaveLength(5);
      expect(rows.every((row) => row.prediction.status === "ok")).toBe(true);
      expect(rows.reduce((sum, row) => sum + row.provider_calls, 0)).toBe(1);
      expect(new Set(rows.map((row) => row.prediction.request_id)).size).toBe(1);
      const body = send.mock.calls[0]![1]!.body as string;
      const bytes = new TextEncoder().encode(body).length;
      expect(
        rows.every(
          (row) =>
            row.prompt_sha256 === sha256(body) && row.prediction.prompt_hash === sha256(body),
        ),
      ).toBe(true);
      expect(rows.every((row) => row.compiled_bytes === bytes)).toBe(true);
      for (const row of rows) {
        expect(row.prediction.request_usage).toEqual({ input_tokens: 123, output_tokens: 17 });
        expect(row.prediction).not.toHaveProperty("cost_usd");
        expect(Object.keys(row.raw_answers!).every((key) => !/^h\d_/.test(key))).toBe(true);
      }
      const summary = metrics(rows.map((row) => ({ pair, prediction: row.prediction })));
      expect(summary.cost.token_usage).toMatchObject({
        observations: 1,
        input: { known_subtotal: 123, unknown_observations: 0 },
        output: { known_subtotal: 17 },
      });
      if (id === "decider") {
        expect(JSON.parse(body).provider).toEqual({ only: ["Perplexity"], allow_fallbacks: false });
        expect(
          rows.every(
            (row) => row.prediction.reported_model === "perplexity/pplx-decider-v1.2-20261016",
          ),
        ).toBe(true);
        expect(JSON.stringify(rows)).not.toMatch(/PRIVATE_ROUTER_ID|"cost"/);
      }
    },
  );

  it("records a malformed dispatched bundle as one failed request, preserving actual wire identity and unknown usage", async () => {
    const send = vi.fn<typeof fetch>(async () => Response.json({ answers: {} }));
    const rows = await runBundledPair(DEFAULT_BUNDLE_PROFILES, pair, 1, {
      backend: createBackend("decider", env),
      sequence: 8,
      fetch: send,
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(rows.every((row) => row.prediction.status === "error")).toBe(true);
    expect(rows.reduce((sum, row) => sum + row.provider_calls, 0)).toBe(1);
    const body = send.mock.calls[0]![1]!.body as string;
    expect(
      rows.every(
        (row) =>
          row.prompt_sha256 === sha256(body) &&
          row.compiled_bytes === new TextEncoder().encode(body).length,
      ),
    ).toBe(true);
    expect(
      rows.every(
        (row) =>
          row.prediction.request_usage?.input_tokens === null &&
          row.prediction.request_usage.output_tokens === null,
      ),
    ).toBe(true);
    const summary = metrics(rows.map((row) => ({ pair, prediction: row.prediction })));
    expect(summary.cost.token_usage).toMatchObject({
      observations: 1,
      input: { unknown_observations: 1, known_subtotal: 0 },
    });
  });

  it("fails every head atomically after an explicit reported-model mismatch without retry", async () => {
    const send = vi.fn<typeof fetch>(async (_url, init) =>
      Response.json(raw(JSON.parse(init!.body as string), "jev-latest")),
    );
    const rows = await runBundledPair(DEFAULT_BUNDLE_PROFILES, pair, 1, {
      backend: createBackend("jev", env),
      sequence: 9,
      fetch: send,
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(
      rows.every(
        (row) => row.prediction.error_code === "provider_model_mismatch" && !row.prediction.verdict,
      ),
    ).toBe(true);
    expect(rows.every((row) => row.features === null && row.raw_answers === null)).toBe(true);
  });

  it("aborts a stalled bundle once at the three-second deadline and never returns clean heads", async () => {
    vi.useFakeTimers();
    let cancellation: AbortSignal | null | undefined;
    const send = vi.fn<typeof fetch>(async (_url, init) => {
      cancellation = init?.signal;
      return new Promise<Response>(() => {});
    });
    const pending = runBundledPair(DEFAULT_BUNDLE_PROFILES, pair, 1, {
      backend: createBackend("jev", env),
      sequence: 10,
      fetch: send,
    });
    await vi.advanceTimersByTimeAsync(3000);
    const rows = await pending;
    expect(send).toHaveBeenCalledTimes(1);
    expect(cancellation?.aborted).toBe(true);
    expect(rows.every((row) => row.prediction.error_code === "deadline_exceeded")).toBe(true);
  });

  it("excludes all heads before dispatch when escaped actual payload exceeds the envelope", async () => {
    const send = responder("decider");
    const rows = await runBundledPair(
      DEFAULT_BUNDLE_PROFILES,
      { ...pair, claim: '"'.repeat(4096), evidence: '"'.repeat(2048) },
      1,
      { backend: createBackend("decider", env), sequence: 11, fetch: send },
    );
    expect(send).not.toHaveBeenCalled();
    expect(
      rows.every((row) => row.provider_calls === 0 && row.prediction.status === "excluded"),
    ).toBe(true);
  });

  it("CLI freezes bundle mode, plans one call per pair and checkpoints all five fake heads", async () => {
    const path = await mkdtemp(join(tmpdir(), "countercheck-bundle-cli-"));
    directories.push(path);
    const prefix = join(path, "run");
    const args = [
      resolve("node_modules/tsx/dist/cli.mjs"),
      resolve("scripts/iterate.ts"),
      "--manifest",
      resolve("eval/fixtures/synthetic-smoke.json"),
      "--profiles",
      DEFAULT_BUNDLE_PROFILES.join(","),
      "--out",
      prefix,
      "--purpose",
      "regression",
      "--fake",
      "--bundle",
      "--backend",
      "jev",
      "--max-calls",
      "8",
      "--cost-per-call-usd",
      ".001",
      "--max-spend-usd",
      ".008",
    ];
    const { stdout } = await execute(process.execPath, args, {
      timeout: 15000,
      env: { ...process.env, TYPESAFE_API_KEY: "" },
    });
    expect(JSON.parse(stdout)).toEqual({ observations: 40, calls: 0, errors: 0, excluded: 0 });
    const freeze = JSON.parse(await readFile(prefix + ".freeze.json", "utf8"));
    expect(freeze.planned_calls).toBe(8);
    expect(freeze.execution).toMatchObject({
      compiler_mode: "bundle",
      backend: "jev",
      model: "jev-1.14.0",
    });
    const rows = (await readFile(prefix + ".predictions.jsonl", "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(rows).toHaveLength(40);
    expect(new Set(rows.map((row) => `${row.pair_id}/${row.iteration.profile}`)).size).toBe(40);
    expect(new Set(rows.map((row) => row.request_id)).size).toBe(8);
    expect(
      rows.every(
        (row) => row.iteration.provider_calls === 0 && row.request_usage.input_tokens === null,
      ),
    ).toBe(true);
    expect(JSON.parse(await readFile(prefix + ".json", "utf8")).source_stable).toBe(true);
  });
});
