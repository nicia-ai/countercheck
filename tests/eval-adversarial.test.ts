import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import { withPredictionCheckpoint } from "../eval/checkpoint.js";
import { runPairs } from "../eval/backends.js";
import { groupStatistics } from "../eval/datasets.js";
import { ServiceError } from "../src/contracts/errors.js";
import type { Pair, Prediction } from "../eval/types.js";
import type { DecisionProvider } from "../src/providers/types.js";

const pair = (id: string): Pair => ({
  id,
  dataset: "synthetic-smoke",
  variant: "fixture",
  split: "synthetic",
  source_id: id,
  group_id: id,
  claim: "A",
  evidence: "B",
  gold: "non_contradiction",
  native_label: "SUPPORTS",
});
const row = (id: string): Prediction => ({
  pair_id: id,
  pass: 1,
  status: "error",
  error_code: "fixture",
  latency_ms: 1,
});

describe("durable evaluation checkpoints", () => {
  it("keeps every completed append and provenance after a later failure", async () => {
    const dir = await mkdtemp(join(tmpdir(), "countercheck-checkpoint-"));
    const path = join(dir, "nested", "predictions.jsonl");
    try {
      await expect(
        withPredictionCheckpoint(path, { manifest_sha256: "a".repeat(64) }, async (append) => {
          await append([row("one")]);
          await append([row("two")]);
          throw new Error("later summary failure");
        }),
      ).rejects.toThrow("later summary failure");
      expect(
        (await readFile(path, "utf8"))
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line)),
      ).toEqual([row("one"), row("two")]);
      expect(JSON.parse(await readFile(`${path}.metadata.json`, "utf8"))).toEqual({
        manifest_sha256: "a".repeat(64),
      });
      const callback = vi.fn();
      await expect(
        withPredictionCheckpoint(path, { manifest_sha256: "a".repeat(64) }, callback),
      ).rejects.toThrow();
      expect(callback).not.toHaveBeenCalled();
      const blocker = join(dir, "not-a-directory");
      await writeFile(blocker, "fixture");
      await expect(
        withPredictionCheckpoint(
          join(blocker, "predictions.jsonl"),
          { manifest_sha256: "a".repeat(64) },
          callback,
        ),
      ).rejects.toThrow();
      expect(callback).not.toHaveBeenCalled();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("evaluation transport error diagnostics", () => {
  it.each(["provider_unavailable", "provider_invalid_response", "provider_timeout"])(
    "preserves safe internal %s without provider messages",
    async (code) => {
      const provider: DecisionProvider = {
        id: "fixture",
        model: "fixture",
        async classify() {
          throw new ServiceError(503, code, "DO_NOT_PUBLISH_UPSTREAM_DETAIL");
        },
      };
      const rows = await runPairs([pair("a")], {
        pass: 1,
        timeoutMs: 100,
        presentation: "original",
        provider,
      });
      expect(rows[0]).toMatchObject({ status: "error", error_code: code });
      expect(JSON.stringify(rows)).not.toContain("DO_NOT_PUBLISH");
    },
  );
  it("requests manual redirects and rejects them without consuming or following the body", async () => {
    const cancel = vi.fn();
    const send = vi.fn<typeof fetch>(
      async () =>
        new Response(new ReadableStream<Uint8Array>({ cancel }), {
          status: 302,
          headers: { location: "https://untrusted.invalid", "content-type": "text/plain" },
        }),
    );
    vi.stubGlobal("fetch", send);
    try {
      const [result] = await runPairs([pair("a")], {
        pass: 1,
        timeoutMs: 100,
        presentation: "original",
        serviceUrl: "https://example.invalid",
        serviceKey: "fixture-only-key",
      });
      expect(send).toHaveBeenCalledOnce();
      expect(send.mock.calls[0]?.[1]?.redirect).toBe("manual");
      expect(result).toMatchObject({ status: "error", error_code: "service_redirect_rejected" });
      expect(cancel).toHaveBeenCalledOnce();
      expect(JSON.stringify(result)).not.toContain("untrusted.invalid");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("group selection diagnostics", () => {
  it("quantifies mixed-label group-size differences without changing selected pairs", () => {
    const population = [
      pair("single-a"),
      { ...pair("single-b"), native_label: "REFUTES" },
      ...Array.from({ length: 4 }, (_, i) => ({
        ...pair(`mixed-${i}`),
        group_id: "mixed",
        native_label: i % 2 ? "REFUTES" : "SUPPORTS",
      })),
    ];
    expect(groupStatistics(population)).toEqual({
      pairs: 6,
      groups: 3,
      group_size_counts: { "1": 2, "4": 1 },
      mean_group_size: 2,
      max_group_size: 4,
      mixed_native_label_groups: 1,
      mixed_native_label_group_fraction: 1 / 3,
    });
    expect(groupStatistics(population.slice(2))).toMatchObject({
      pairs: 4,
      groups: 1,
      group_size_counts: { "4": 1 },
      mixed_native_label_group_fraction: 1,
    });
    expect(groupStatistics([])).toMatchObject({
      groups: 0,
      mean_group_size: null,
      max_group_size: null,
      mixed_native_label_group_fraction: null,
    });
  });
});
