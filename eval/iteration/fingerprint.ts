import { readFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import ts from "typescript";
import { z } from "zod";
import { sha256 } from "../types.js";

export const executionSchema = z.strictObject({
  compiler_mode: z.enum(["isolated", "bundle"]),
  backend: z.enum(["jev", "clef", "decider"]),
  model: z.string().min(1),
});
export type ExecutionIdentity = z.infer<typeof executionSchema>;
export const DEFAULT_EXECUTION: ExecutionIdentity = {
  compiler_mode: "isolated",
  backend: "jev",
  model: "jev-1.14.0",
};

/** Bind fitted policies to every file in the actual inference/validation runtime graph. */
export function candidateSourceHash(
  files: Record<string, string>,
  execution: ExecutionIdentity = DEFAULT_EXECUTION,
): string {
  if (!files["eval/iteration/profiles.ts"])
    throw new Error("Runtime graph lacks candidate formulation source hash.");
  return sha256(
    JSON.stringify({
      files: Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b))),
      execution: executionSchema.parse(execution),
    }),
  );
}

/** Freeze the actual transitive runtime graph without unrelated parallel research edits. */
export async function sourceFingerprint(root: string, entrypoint = "scripts/iterate.ts") {
  const hashes = new Map<string, string>();
  async function visit(file: string): Promise<void> {
    if (hashes.has(file)) return;
    const path = resolve(root, file);
    if (relative(root, path).startsWith("..")) throw new Error("Runtime source escapes repository");
    const bytes = await readFile(path);
    hashes.set(file, sha256(bytes));
    const source = ts.createSourceFile(file, bytes.toString("utf8"), ts.ScriptTarget.Latest, true);
    const dependencies: string[] = [];
    function walk(node: ts.Node) {
      let specifier: ts.Expression | undefined;
      if (ts.isImportDeclaration(node) && !node.importClause?.isTypeOnly)
        specifier = node.moduleSpecifier;
      else if (ts.isExportDeclaration(node) && !node.isTypeOnly) specifier = node.moduleSpecifier;
      else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword)
        specifier = node.arguments[0];
      if (specifier && ts.isStringLiteral(specifier) && specifier.text.startsWith("."))
        dependencies.push(join(dirname(file), specifier.text).replace(/\.js$/, ".ts"));
      ts.forEachChild(node, walk);
    }
    walk(source);
    for (const dependency of dependencies) await visit(dependency);
  }
  await visit(entrypoint);
  for (const file of ["package.json", "pnpm-lock.yaml"])
    hashes.set(file, sha256(await readFile(join(root, file))));
  return Object.fromEntries([...hashes].sort(([a], [b]) => a.localeCompare(b)));
}
