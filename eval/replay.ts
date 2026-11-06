import { predictionSchema, type Pair, type Prediction } from "./types.js";

export function validateReplay(raw: unknown, pairs: Pair[], passes: number): Prediction[] {
  if (!Array.isArray(raw)) throw new Error("Replay must be a prediction array");
  const expected = new Set(
    pairs.flatMap((p) => Array.from({ length: passes }, (_, i) => `${p.id}\0${i + 1}`)),
  );
  const rows: Prediction[] = [];
  for (const value of raw) {
    const r = predictionSchema.parse(value);
    const key = `${r.pair_id}\0${r.pass}`;
    if (!expected.delete(key)) throw new Error("Invalid/duplicate replay pair");
    rows.push(r);
  }
  if (expected.size) throw new Error("Incomplete replay pair coverage");
  return rows;
}
