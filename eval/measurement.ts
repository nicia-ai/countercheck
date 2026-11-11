import { readFile } from "node:fs/promises";
import { z } from "zod";
import { sha256File } from "./files.js";
import { validateManifest } from "./types.js";

export const SCREEN_CONFIG_PATH = "eval/model-screen.json";
export const PROBE_INPUT = { id: "integration-probe", path: "eval/fixtures/synthetic-smoke.json" };
export const MEASUREMENT_PROFILE = "balanced-v1";
/** Snapshotted with every run so the measured implementation survives later edits. */
export const EXECUTION_SOURCES = [
  "scripts/measure-model.ts",
  "scripts/eval.ts",
  "eval/measurement.ts",
  "eval/providers.ts",
  "eval/openrouter-candidates.ts",
  "eval/nace-provider.ts",
  "eval/fastino-provider.ts",
  "eval/http-status-observer.ts",
  "eval/register-http-status.ts",
  "eval/metrics.ts",
  "eval/types.ts",
  "eval/protocol.ts",
  "eval/checkpoint.ts",
  "src/contracts/models.ts",
  "src/contracts/index.ts",
  "src/providers/catalog.ts",
  "src/providers/jev.ts",
  "src/providers/clef.ts",
  "src/providers/decider.ts",
  "src/providers/openai-decisions.ts",
  "pnpm-lock.yaml",
] as const;

const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);
const cohortSchema = z.object({
  id: z.string().min(1),
  description: z.string(),
  datasets: z.array(z.string().min(1)).min(1),
  inputs: z
    .array(
      z.object({
        id: z.string().regex(/^[a-z0-9-]+$/),
        path: z.string().min(1),
        sha256: sha256Schema,
        pairs: z.number().int().positive(),
      }),
    )
    .min(1),
  sources: z.array(z.string().min(1)),
});
const screenConfigSchema = z.object({
  schema_version: z.literal(2),
  frozen_sources: z.record(z.string().min(1), sha256Schema),
  cohorts: z.array(cohortSchema).min(1),
});
export type Cohort = z.infer<typeof cohortSchema>;
export type ScreenConfig = z.infer<typeof screenConfigSchema>;

export class MeasurementPlanError extends Error {
  override name = "MeasurementPlanError";
}

export async function loadScreenConfig(path = SCREEN_CONFIG_PATH): Promise<ScreenConfig> {
  return screenConfigSchema.parse(JSON.parse(await readFile(path, "utf8")));
}

export function selectCohort(config: ScreenConfig, id: string | undefined): Cohort {
  const cohort = config.cohorts.find((candidate) => candidate.id === id);
  if (!cohort)
    throw new MeasurementPlanError(
      `Unknown cohort; choose one of: ${config.cohorts.map((c) => c.id).join(", ")}`,
    );
  return cohort;
}

/** A drifted prompt, kernel or scorer would make the new rows incomparable with the cohort. */
export async function assertFrozenSources(config: ScreenConfig): Promise<void> {
  for (const [path, expected] of Object.entries(config.frozen_sources))
    if ((await sha256File(path)) !== expected)
      throw new MeasurementPlanError(
        `Frozen source changed since the cohort was measured: ${path}`,
      );
}

export async function assertFrozenInputs(cohort: Cohort): Promise<void> {
  for (const input of cohort.inputs) {
    if ((await sha256File(input.path)) !== input.sha256)
      throw new MeasurementPlanError(`Cohort input changed: ${input.path}`);
    const manifest = validateManifest(JSON.parse(await readFile(input.path, "utf8")));
    if (
      manifest.pairs.length !== input.pairs ||
      manifest.pairs.some((pair) => !cohort.datasets.includes(pair.dataset))
    )
      throw new MeasurementPlanError(`Cohort input does not match its declaration: ${input.path}`);
  }
}

export interface Reservation {
  maxCalls: number;
  perCallUsd: number;
  capUsd: number;
}

export function plannedCalls(cohort: Cohort, probePairs: number, reservation: Reservation): number {
  const planned = cohort.inputs.reduce((sum, input) => sum + input.pairs, probePairs);
  const { maxCalls, perCallUsd, capUsd } = reservation;
  if (![perCallUsd, capUsd].every((value) => Number.isFinite(value) && value > 0))
    throw new MeasurementPlanError("A positive per-call reservation and spend cap are required.");
  if (planned > maxCalls || planned * perCallUsd > capUsd)
    throw new MeasurementPlanError(
      `Measurement needs ${planned} calls, which exceeds the explicit call or spend reservation.`,
    );
  return planned;
}
