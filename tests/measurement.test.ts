import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  MeasurementPlanError,
  assertFrozenInputs,
  assertFrozenSources,
  loadScreenConfig,
  plannedCalls,
  selectCohort,
  type Cohort,
} from "../eval/measurement.js";
import { sha256File } from "../eval/files.js";

const PROBE_PAIRS = 8;
const cohort = (pairs: number[]): Cohort => ({
  id: "fixture",
  description: "fixture",
  datasets: ["synthetic-smoke"],
  inputs: pairs.map((count, index) => ({
    id: `input-${index}`,
    path: "eval/fixtures/synthetic-smoke.json",
    sha256: "0".repeat(64),
    pairs: count,
  })),
  sources: [],
});
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("model measurement planning", () => {
  it("counts the integration probe and refuses to exceed either reservation", () => {
    const fixture = cohort([200, 82]);
    const reservation = { maxCalls: 290, perCallUsd: 0.002, capUsd: 0.58 };
    expect(plannedCalls(fixture, PROBE_PAIRS, reservation)).toBe(290);
    for (const tooSmall of [
      { ...reservation, maxCalls: 289 },
      { ...reservation, capUsd: 0.57 },
      { ...reservation, perCallUsd: 0 },
      { ...reservation, capUsd: Number.NaN },
    ])
      expect(() => plannedCalls(fixture, PROBE_PAIRS, tooSmall)).toThrow(MeasurementPlanError);
  });

  it("declares frozen inputs and sources that match this checkout", async () => {
    const config = await loadScreenConfig();
    await expect(assertFrozenSources(config)).resolves.toBeUndefined();
    expect(
      config.cohorts.map(({ id, inputs }) => [id, inputs.reduce((n, i) => n + i.pairs, 0)]),
    ).toEqual([
      ["archive-880", 880],
      ["validation-688", 688],
    ]);
    expect(() => selectCohort(config, "no-such-cohort")).toThrow(/archive-880, validation-688/);
    expect(() => selectCohort(config, undefined)).toThrow(MeasurementPlanError);
  });

  it("refuses a drifted kernel source or cohort input by name", async () => {
    const directory = await mkdtemp(join(tmpdir(), "countercheck-measure-"));
    dirs.push(directory);
    const drifted = join(directory, "kernel.ts");
    await writeFile(drifted, "edited prompt");
    await expect(
      assertFrozenSources({
        schema_version: 2,
        frozen_sources: { [drifted]: "0".repeat(64) },
        cohorts: [cohort([8])],
      }),
    ).rejects.toThrow(`Frozen source changed since the cohort was measured: ${drifted}`);
    await expect(assertFrozenInputs(cohort([8]))).rejects.toThrow("Cohort input changed");
    const fixture = cohort([7]);
    fixture.inputs[0]!.sha256 = await sha256File(fixture.inputs[0]!.path);
    await expect(assertFrozenInputs(fixture)).rejects.toThrow("does not match its declaration");
    fixture.inputs[0]!.pairs = PROBE_PAIRS;
    await expect(assertFrozenInputs(fixture)).resolves.toBeUndefined();
  });
});
