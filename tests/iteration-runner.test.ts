import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { gunzipSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sourceFingerprint } from "../eval/iteration/fingerprint.js";
import { compileCandidate, type CompiledCandidate } from "../eval/iteration/profiles.js";
import {
  compose,
  DEFAULT_POLICY,
  extractFeatures,
  parseResponse,
  runPair,
} from "../eval/iteration/runner.js";
import { withPredictionCheckpoint } from "../eval/checkpoint.js";
import { predictionSchema, sha256, type Pair } from "../eval/types.js";
import { JEV_MODEL } from "../src/providers/jev.js";

const execute = promisify(execFile);
const directories: string[] = [];
const pair: Pair = {
  id: "invented-quantity",
  dataset: "synthetic-smoke",
  variant: "iteration-runner-unit",
  split: "synthetic",
  source_id: "invented-quantity",
  group_id: "invented-quantity",
  claim: "The same sample has mass exactly 10 kg.",
  evidence: "The same sample has mass exactly 20 kg.",
  gold: "contradiction",
  native_label: "contradiction",
};
type Answers = Record<string, Record<string, unknown>>;
function validResponse(compiled: CompiledCandidate) {
  const answers: Answers = Object.fromEntries(
    Object.entries(compiled.payload.questions).map(([id, question]) => [
      id,
      question.type === "noul"
        ? { type: "noul", noul: 0.5 }
        : {
            type: "choice",
            probabilities: Object.fromEntries(
              Object.keys(question.criteria).map((label) => [
                label,
                1 / Object.keys(question.criteria).length,
              ]),
            ),
          },
    ]),
  );
  return { model: JEV_MODEL, answers };
}
const jsonResponse = (value: unknown) =>
  new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
async function directory() {
  const path = await mkdtemp(join(tmpdir(), "countercheck-iteration-test-"));
  directories.push(path);
  return path;
}
afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("iteration mixed response validation", () => {
  it("accepts complete native Choice and Noul answers without projecting their roles together", () => {
    const compiled = compileCandidate("semantic-numeric", pair);
    const raw = validResponse(compiled);
    expect(Object.values(compiled.payload.questions).some((q) => q.type === "noul")).toBe(true);
    expect(parseResponse(raw, compiled).answers).toEqual(raw.answers);
  });

  it.each([
    ["missing question", (answers: Answers): boolean => delete answers.q_0_relation],
    [
      "unknown ID replacing a real ID",
      (answers: Answers) => {
        answers.unrequested = answers.q_0_relation!;
        delete answers.q_0_relation;
      },
    ],
    ["extra question", (answers: Answers) => (answers.unrequested = { type: "noul", noul: 0.5 })],
    [
      "wrong answer kind",
      (answers: Answers) => (answers.q_0_relation = { type: "noul", noul: 0.5 }),
    ],
    [
      "missing label",
      (answers: Answers) => {
        const p = answers.q_0_relation!.probabilities as Record<string, number>;
        delete p.insufficient_context;
      },
    ],
    [
      "unknown label",
      (answers: Answers) => {
        const p = answers.q_0_relation!.probabilities as Record<string, number>;
        delete p.insufficient_context;
        p.unrequested = 0.25;
      },
    ],
    [
      "unnormalized distribution",
      (answers: Answers) => {
        (answers.q_0_relation!.probabilities as Record<string, number>).contradiction = 0.7;
      },
    ],
    [
      "selected non-maximal label",
      (answers: Answers) => {
        answers.q_0_relation = {
          type: "choice",
          probabilities: {
            contradiction: 0.9,
            consistent: 0.1,
            different_scope: 0,
            insufficient_context: 0,
          },
          choice: "consistent",
        };
      },
    ],
    [
      "unknown answer field",
      (answers: Answers): boolean => (answers.q_0_relation!.unrequested = true),
    ],
    [
      "nonfinite Noul",
      (answers: Answers) => {
        const id = Object.keys(answers).find((key) => answers[key]!.type === "noul")!;
        answers[id] = { type: "noul", noul: Number.NaN };
      },
    ],
    [
      "Noul outside probability range",
      (answers: Answers) => {
        const id = Object.keys(answers).find((key) => answers[key]!.type === "noul")!;
        answers[id] = { type: "noul", noul: 1.01 };
      },
    ],
  ] as const)("rejects %s", (_name, mutate) => {
    const compiled = compileCandidate("semantic-numeric", pair);
    const raw = validResponse(compiled);
    mutate(raw.answers);
    expect(() => parseResponse(raw, compiled)).toThrow("invalid or incomplete response");
  });

  it("rejects an explicit reported-model mismatch but preserves an omitted model as unknown", () => {
    const compiled = compileCandidate("local-mini", pair);
    const raw = validResponse(compiled);
    expect(() => parseResponse({ ...raw, model: "jev-another-revision" }, compiled)).toThrow(
      "Unexpected inference model",
    );
    expect(parseResponse({ answers: raw.answers }, compiled).model).toBeUndefined();
  });
});

describe("iteration numeric and semantic composition", () => {
  function judgment(input: { claim: string; evidence: string }, decisive: number) {
    const compiled = compileCandidate("semantic-numeric", input);
    const raw = validResponse(compiled);
    raw.answers[compiled.signal_questions.relation!] = {
      type: "choice",
      probabilities: {
        contradiction: 0.02,
        consistent: 0.95,
        different_scope: 0.01,
        insufficient_context: 0.02,
      },
    };
    // The necessity question must exist independently of parser availability.
    expect(compiled.signal_questions.quantitative_decisive).toBeDefined();
    raw.answers[compiled.signal_questions.quantitative_decisive!] = {
      type: "noul",
      noul: decisive,
    };
    return { compiled, raw };
  }

  it("keeps decisive unsupported quantitative reasoning uncertain even with semantic negative support", () => {
    const { compiled, raw } = judgment(
      { claim: "The exact speed is 10 km/h.", evidence: "The exact speed is 20 miles/hour." },
      0.95,
    );
    expect(compiled.numeric_context!.available).toBe(false);
    expect(compose(extractFeatures(parseResponse(raw, compiled), compiled), DEFAULT_POLICY)).toBe(
      "uncertain",
    );
  });

  it("does not veto an independent semantic contradiction for an irrelevant unsupported identifier", () => {
    const { compiled, raw } = judgment(
      { claim: "Receptor αvβ8 permits entry.", evidence: "Receptor αvβ8 prohibits entry." },
      0.02,
    );
    expect(compiled.numeric_context!.available).toBe(false);
    raw.answers[compiled.signal_questions.relation!] = {
      type: "choice",
      probabilities: {
        contradiction: 0.95,
        consistent: 0.02,
        different_scope: 0.01,
        insufficient_context: 0.02,
      },
    };
    expect(compose(extractFeatures(parseResponse(raw, compiled), compiled), DEFAULT_POLICY)).toBe(
      "contradiction",
    );
  });

  it("does not veto an independently settled omission when numeric proof is unavailable and irrelevant", () => {
    const { compiled, raw } = judgment(
      { claim: "Receptor αvβ8 has features A and B.", evidence: "Receptor αvβ8 has feature A." },
      0.02,
    );
    expect(compose(extractFeatures(parseResponse(raw, compiled), compiled), DEFAULT_POLICY)).toBe(
      "no_contradiction",
    );
  });

  it("lets validated disjoint numeric proof add a contradiction but never lets overlap prove whole-pair consistency", () => {
    for (const evidence of [
      "The same sample has mass exactly 20 kg.",
      "The same sample has mass exactly 10 kg.",
    ]) {
      const { compiled, raw } = judgment({ claim: pair.claim, evidence }, 0.99);
      for (const [id, q] of Object.entries(compiled.payload.questions)) {
        if (q.type === "noul") raw.answers[id] = { type: "noul", noul: 0.99 };
      }
      raw.answers[compiled.signal_questions.relation!] = {
        type: "choice",
        probabilities: {
          contradiction: 0.4,
          consistent: 0.45,
          different_scope: 0.05,
          insufficient_context: 0.1,
        },
      };
      raw.answers[compiled.signal_questions.numeric_selection!] = {
        type: "choice",
        probabilities: { unknown: 0.01, p_0_0: 0.99 },
        choice: "p_0_0",
      };
      const features = extractFeatures(parseResponse(raw, compiled), compiled);
      expect(features.numeric_relation).toBe(
        evidence.includes("20") ? "incompatible" : "compatible",
      );
      expect(compose(features, DEFAULT_POLICY)).toBe(
        evidence.includes("20") ? "contradiction" : "uncertain",
      );
    }
  });

  it("keeps decisive arithmetic uncertain if selected supported values have incomparable dimensions", () => {
    const { compiled, raw } = judgment(
      { claim: "The value is 10 kg.", evidence: "The value is 20 USD." },
      0.99,
    );
    for (const [id, q] of Object.entries(compiled.payload.questions)) {
      if (q.type === "noul") raw.answers[id] = { type: "noul", noul: 0.99 };
    }
    raw.answers[compiled.signal_questions.numeric_selection!] = {
      type: "choice",
      probabilities: { unknown: 0.01, p_0_0: 0.99 },
    };
    const features = extractFeatures(parseResponse(raw, compiled), compiled);
    expect(features.numeric_relation).toBe("unknown");
    expect(compose(features, DEFAULT_POLICY)).toBe("uncertain");
  });
});

describe("iteration bounded execution and projections", () => {
  it("round-trips a tolerated rounded NLI distribution into bounded normalized replay probabilities", async () => {
    const send = vi.fn(async () =>
      jsonResponse({
        model: JEV_MODEL,
        answers: {
          q_0_relation: {
            type: "choice",
            probabilities: { contradiction: 0, entailment: 0.6, neutral: 0.4005 },
          },
        },
      }),
    );
    const observation = await runPair("nli-three-way", pair, 1, {
      apiKey: "unit-only",
      sequence: 0,
      fetch: send,
    });
    expect(observation.prediction.status).toBe("ok");
    expect(predictionSchema.parse(JSON.parse(JSON.stringify(observation.prediction)))).toEqual(
      observation.prediction,
    );
    expect(observation.prediction.probabilities).toEqual({
      contradiction: 0,
      no_contradiction: 1,
      insufficient_context: 0,
    });
    expect(observation.raw_answers!.q_0_relation).toMatchObject({
      probabilities: { neutral: 0.4005 },
    });
  });

  it("keeps native Noul marginals separate rather than multiplying independent questions", async () => {
    const compiled = compileCandidate("noul-conflict", pair);
    const raw = validResponse(compiled);
    raw.answers[compiled.signal_questions.conflict!] = { type: "noul", noul: 0.9 };
    raw.answers[compiled.signal_questions.applicability!] = { type: "noul", noul: 0.5 };
    const send = vi.fn(async () => jsonResponse(raw));
    const observation = await runPair("noul-conflict", pair, 1, {
      apiKey: "unit-only",
      sequence: 1,
      fetch: send,
    });
    expect(observation.prediction.status).toBe("ok");
    expect(observation.prediction.probabilities!.contradiction).toBe(0.9);
    expect(observation.features!.applicability).toBe(0.5);
    expect(observation.prediction).not.toHaveProperty("raw_scores");
  });

  it("fake execution makes no request and retains unknown usage explicitly", async () => {
    const send = vi.fn(async () => {
      throw new Error("must not dispatch");
    });
    const observation = await runPair("semantic-numeric", pair, 1, {
      apiKey: "",
      sequence: 2,
      fetch: send,
      fake: true,
    });
    expect(send).not.toHaveBeenCalled();
    expect(observation.provider_calls).toBe(0);
    expect(observation.prediction.status).toBe("ok");
    expect(observation.prediction).toMatchObject({
      provider: "fake",
      cost_usd: 0,
      request_usage: { input_tokens: null, output_tokens: null },
    });
  });

  it("excludes a compiled-envelope overflow before dispatch even when raw text budgets fit", async () => {
    const escaped = { ...pair, claim: '"'.repeat(4096), evidence: '"'.repeat(2048) };
    expect(compileCandidate("rich-control", escaped).compiled_bytes).toBeGreaterThan(16_384);
    const send = vi.fn(async () => {
      throw new Error("must not dispatch");
    });
    const observation = await runPair("rich-control", escaped, 1, {
      apiKey: "unit-only",
      sequence: 20,
      fetch: send,
    });
    expect(send).not.toHaveBeenCalled();
    expect(observation.provider_calls).toBe(0);
    expect(observation.prediction).toMatchObject({
      status: "excluded",
      error_code: "compiled_input_too_large",
    });
    expect(observation.prompt_sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it.each([401, 429, 500])(
    "records HTTP %i as one failed call without retrying or leaking its body",
    async (status) => {
      const send = vi.fn(async () => new Response("PRIVATE_UPSTREAM_BODY", { status }));
      const observation = await runPair("local-mini", pair, 1, {
        apiKey: "PRIVATE_KEY",
        sequence: 3,
        fetch: send,
      });
      expect(send).toHaveBeenCalledTimes(1);
      expect(observation.provider_calls).toBe(1);
      expect(observation.prediction.status).toBe("error");
      expect(observation.prediction).not.toHaveProperty("verdict");
      expect(JSON.stringify(observation)).not.toMatch(/PRIVATE_UPSTREAM_BODY|PRIVATE_KEY/);
    },
  );

  it("retains a safe malformed-response error and never turns an outage into a clean result", async () => {
    const send = vi.fn(async () => jsonResponse({ model: JEV_MODEL, answers: {} }));
    const observation = await runPair("local-mini", pair, 1, {
      apiKey: "unit-only",
      sequence: 4,
      fetch: send,
    });
    expect(observation.prediction).toMatchObject({
      status: "error",
      error_code: "provider_invalid_response",
    });
    expect(observation.raw_answers).toBeNull();
    expect(observation.features).toBeNull();
  });

  it("aborts the sole request at the 3000ms total deadline", async () => {
    vi.useFakeTimers();
    let seenSignal: AbortSignal | undefined;
    const send = vi.fn(async (_url: unknown, init?: RequestInit) => {
      seenSignal = init?.signal ?? undefined;
      return new Promise<Response>(() => {});
    });
    const pending = runPair("local-mini", pair, 1, {
      apiKey: "unit-only",
      sequence: 5,
      fetch: send,
    });
    await vi.advanceTimersByTimeAsync(3000);
    const observation = await pending;
    expect(send).toHaveBeenCalledTimes(1);
    expect(seenSignal?.aborted).toBe(true);
    expect(observation.prediction).toMatchObject({
      status: "error",
      error_code: "deadline_exceeded",
    });
  });
});

describe("iteration source freeze and checkpoint", () => {
  it("hashes actual transitive value imports and literal dynamic imports, while ignoring type-only and unrelated edits", async () => {
    const root = await directory();
    await mkdir(join(root, "scripts"));
    await mkdir(join(root, "eval"));
    await writeFile(
      join(root, "scripts/iterate.ts"),
      [
        'import type { Unavailable } from "../eval/type-only.js";',
        'import { value } from "../eval/runtime.js";',
        'void import("../eval/dynamic.js");',
        '// import "../eval/not-a-runtime-dependency.js";',
        "const text = 'import \"../eval/also-not-runtime.js\"';",
        "void value; void text;",
      ].join("\n"),
    );
    await writeFile(join(root, "eval/runtime.ts"), 'export { value } from "./leaf.js";');
    await writeFile(join(root, "eval/leaf.ts"), "export const value = 1;");
    await writeFile(join(root, "eval/dynamic.ts"), "export const dynamic = 1;");
    await writeFile(join(root, "package.json"), "{}");
    await writeFile(join(root, "pnpm-lock.yaml"), "lockfileVersion: 9");
    const before = await sourceFingerprint(root);
    expect(Object.keys(before)).toEqual([
      "eval/dynamic.ts",
      "eval/leaf.ts",
      "eval/runtime.ts",
      "package.json",
      "pnpm-lock.yaml",
      "scripts/iterate.ts",
    ]);
    await writeFile(join(root, "eval/parallel-calibrator.ts"), "export const changed = 2;");
    expect(await sourceFingerprint(root)).toEqual(before);
    await writeFile(join(root, "eval/leaf.ts"), "export const value = 2;");
    expect((await sourceFingerprint(root))["eval/leaf.ts"]).not.toBe(before["eval/leaf.ts"]);
  });

  it("retains completed rows and prewritten metadata after later run failure, and refuses overwrite", async () => {
    const path = join(await directory(), "checkpoint.jsonl");
    const observation = await runPair("local-mini", pair, 1, {
      apiKey: "",
      sequence: 6,
      fake: true,
    });
    await expect(
      withPredictionCheckpoint(path, { manifest_sha256: "a".repeat(64) }, async (append) => {
        expect(JSON.parse(await readFile(path + ".metadata.json", "utf8"))).toEqual({
          manifest_sha256: "a".repeat(64),
        });
        await append([observation.prediction]);
        throw new Error("later summary failure");
      }),
    ).rejects.toThrow("later summary failure");
    expect(JSON.parse((await readFile(path, "utf8")).trim())).toEqual(observation.prediction);
    await expect(
      withPredictionCheckpoint(path, { manifest_sha256: "b".repeat(64) }, async () => {}),
    ).rejects.toThrow();
  });

  it("CLI enforces explicit mode and reservation before producing any fake checkpoints, then records exact pass counts", async () => {
    const prefix = join(await directory(), "run");
    const fixture = resolve("eval/fixtures/synthetic-smoke.json");
    const base = [
      "--manifest",
      fixture,
      "--profiles",
      "local-mini,noul-conflict",
      "--out",
      prefix,
      "--purpose",
      "regression",
      "--passes",
      "2",
      "--max-calls",
      "32",
      "--cost-per-call-usd",
      "0.001",
      "--max-spend-usd",
      "0.032",
    ];
    const run = (args: string[]) =>
      execute(
        process.execPath,
        [resolve("node_modules/tsx/dist/cli.mjs"), resolve("scripts/iterate.ts"), ...args],
        {
          timeout: 15000,
          env: { ...process.env, TYPESAFE_API_KEY: "" },
        },
      );
    await expect(run(base)).rejects.toThrow();
    await expect(run([...base, "--live", "--fake"])).rejects.toThrow();
    await expect(
      run([...base.map((arg) => (arg === "0.032" ? "0.031" : arg)), "--fake"]),
    ).rejects.toThrow();
    await expect(readFile(prefix + ".predictions.jsonl")).rejects.toThrow();
    const { stdout } = await run([...base, "--fake"]);
    expect(JSON.parse(stdout)).toEqual({ observations: 32, calls: 0, errors: 0, excluded: 0 });
    const rows = (await readFile(prefix + ".predictions.jsonl", "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(rows).toHaveLength(32);
    expect(new Set(rows.map((r) => `${r.iteration.profile}/${r.pair_id}/${r.pass}`)).size).toBe(32);
    expect(rows.every((r) => r.iteration.provider_calls === 0)).toBe(true);
    expect(JSON.parse(await readFile(prefix + ".json", "utf8")).source_stable).toBe(true);
    const frozen = JSON.parse(await readFile(prefix + ".freeze.json", "utf8")) as {
      source_files: Record<string, string>;
    };
    const sources = JSON.parse(
      gunzipSync(await readFile(prefix + ".sources.json.gz")).toString("utf8"),
    ) as Record<string, string>;
    expect(Object.keys(sources).sort()).toEqual(Object.keys(frozen.source_files).sort());
    for (const [file, source] of Object.entries(sources)) {
      expect(sha256(source)).toBe(frozen.source_files[file]);
    }
    await expect(run([...base, "--fake"])).rejects.toThrow();
  }, 30_000);
});
