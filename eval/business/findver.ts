import { z } from "zod";
import { sha256, type Pair } from "../types.js";
import type { PreparedBusiness } from "./common.js";

export const FINDVER_SOURCE = {
  revision: "e8bb237def4ce555a606a45edba22666e31df248",
  base_url:
    "https://raw.githubusercontent.com/yilunzhao/FinDVer/e8bb237def4ce555a606a45edba22666e31df248/",
  testmini_sha256: "09ffb848fec6cc38c7df153500f63388fa5fb7d9bc78300690ddbb83fa4e403a",
  testmini_bytes: 971086,
  license: "Repository artifacts: MIT; underlying issuer-report text license not separately stated",
  license_url:
    "https://github.com/yilunzhao/FinDVer/blob/e8bb237def4ce555a606a45edba22666e31df248/LICENSE",
  paper_url: "https://aclanthology.org/2024.emnlp-main.818.pdf",
} as const;
export type FindverSubset = "ie" | "numeric";
export const reportFilenameSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*\.json$/);
const subsetSchema = z.enum(["ie", "numeric", "knowledge"]);
const rowSchema = z.object({
  example_id: z.string().min(1).max(256),
  subset: subsetSchema,
  split: z.literal("testmini"),
  statement: z.string().min(1),
  entailment_label: z.boolean(),
  relevant_context: z.array(z.number().int().nonnegative().safe()).min(1),
  report: reportFilenameSchema,
});
const reportSchema = z.object({
  url: z.string().url(),
  report_type: z.string().min(1),
  context: z
    .array(
      z.object({
        id: z.number().int().nonnegative().safe(),
        context: z.string(),
        type: z.enum(["paragraph", "table"]),
      }),
    )
    .min(1),
  html_tables: z.array(z.string()),
});

export function findverReportNames(value: unknown, subset: FindverSubset): string[] {
  if (!["ie", "numeric"].includes(subset))
    throw new Error("FinDVer knowledge requires outside context and is not a core pair subset.");
  const rows = z.array(z.object({ subset: subsetSchema }).passthrough()).parse(value);
  return [
    ...new Set(
      rows
        .filter((row) => row.subset === subset)
        .map((row) => reportFilenameSchema.parse(row.report)),
    ),
  ].sort();
}

/** Complete annotated source context only; the gold explanation is deliberately never read. */
export function parseFindver(
  value: unknown,
  reports: ReadonlyMap<string, unknown>,
  subset: FindverSubset = "ie",
): PreparedBusiness & {
  coverage: {
    input_rows: number;
    selected_rows: number;
    reports: number;
    table_contexts: number;
    duplicate_context_references: number;
  };
} {
  findverReportNames(value, subset);
  const rows = z.array(z.object({ subset: subsetSchema }).passthrough()).parse(value);
  const pairs: Pair[] = [],
    ids = new Set<string>(),
    parsed = new Map<string, z.infer<typeof reportSchema>>();
  let outside = 0,
    unlabeled = 0,
    tables = 0,
    selected = 0,
    duplicates = 0;
  for (const item of rows) {
    if (item.subset !== subset) {
      outside++;
      continue;
    }
    selected++;
    if (item.entailment_label === undefined || item.entailment_label === null) {
      unlabeled++;
      continue;
    }
    const row = rowSchema.parse(item);
    if (ids.has(row.example_id)) throw new Error("Duplicate FinDVer example ID.");
    ids.add(row.example_id);
    let report = parsed.get(row.report);
    if (!report) {
      if (!reports.has(row.report)) throw new Error("Selected FinDVer source report is missing.");
      report = reportSchema.parse(reports.get(row.report));
      if (report.context.some((context, index) => context.id !== index))
        throw new Error("FinDVer context IDs disagree with official zero-based array positions.");
      parsed.set(row.report, report);
    }
    const indices = [...new Set(row.relevant_context)].sort((a, b) => a - b);
    duplicates += row.relevant_context.length - indices.length;
    if (indices.some((index) => index >= report.context.length))
      throw new Error("FinDVer requires valid indices for every annotated evidence item.");
    const evidence = indices
      .map((index) => {
        const context = report.context[index]!;
        if (!context.context.trim()) throw new Error("Selected FinDVer evidence context is empty.");
        if (context.type === "table") tables++;
        return `[paragraph id = ${index}] ${context.context}`;
      })
      .join("\n");
    pairs.push({
      id: `findver:testmini:${subset}:${row.example_id}`,
      dataset: "findver",
      variant: `testmini-${subset}`,
      split: "test",
      source_id: row.example_id,
      group_id: `findver:report:${row.report}`,
      claim: row.statement,
      evidence,
      gold: row.entailment_label ? "non_contradiction" : "contradiction",
      native_label: row.entailment_label ? "entailed" : "refuted",
      source_metadata: {
        source_split: row.split,
        subset,
        report: row.report,
        report_url: report.url,
        report_type: report.report_type,
        issuer: row.report.replace(/-\d{4}-\d{2}-\d{2}_10-[QK]\.json$/, ""),
        evidence_indices: JSON.stringify(indices),
        source_evidence_indices: JSON.stringify(row.relevant_context),
        evidence_sha256: sha256(evidence),
        evidence_policy:
          "All annotated paragraphs/tables verbatim, report order; no explanation or truncation",
        annotation_provenance:
          "Native expert annotation; explanations proofread by GPT-4o; no new service-contract adjudication",
      },
    });
  }
  return {
    pairs,
    exclusions: { outside_subset: outside, unlabeled },
    adaptation:
      "FinDVer testmini complete annotated-evidence pairs; original split preserved as test/testmini variant. IE is core; numeric is a separate research track. Missing/invalid source structure fails preparation. No retrieval, full-document leaderboard equivalence, external-knowledge cases, explanation leakage or truncation.",
    coverage: {
      input_rows: rows.length,
      selected_rows: selected,
      reports: parsed.size,
      table_contexts: tables,
      duplicate_context_references: duplicates,
    },
  };
}
