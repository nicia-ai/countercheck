export function parseArgs(
  args: string[],
  allowed: readonly string[],
  booleans: readonly string[] = ["help"],
): Record<string, string> {
  const result: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg?.startsWith("--") || !allowed.includes(arg.slice(2)))
      throw new Error("Unknown argument; use --help");
    const key = arg.slice(2);
    if (key in result) throw new Error("Duplicate argument");
    if (booleans.includes(key)) result[key] = "true";
    else {
      const value = args[++i];
      if (!value || value.startsWith("--")) throw new Error("Missing argument value");
      result[key] = value;
    }
  }
  return result;
}
export function positiveInteger(value: string | undefined, fallback: number, name: string): number {
  const n = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(n) || n < 1) throw new Error(`Invalid ${name}`);
  return n;
}
