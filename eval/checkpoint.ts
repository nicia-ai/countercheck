import { mkdir, open, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Prediction, ReplayMetadata } from "./types.js";

export async function withPredictionCheckpoint<T>(
  path: string,
  metadata: ReplayMetadata,
  run: (append: (rows: readonly Prediction[]) => Promise<void>) => Promise<T>,
): Promise<T> {
  await mkdir(dirname(path), { recursive: true });
  const handle = await open(path, "wx", 0o600);
  try {
    await writeFile(`${path}.metadata.json`, `${JSON.stringify(metadata, null, 2)}\n`, {
      flag: "wx",
      mode: 0o600,
    });
    return await run(async (rows) => {
      await handle.writeFile(rows.map((row) => `${JSON.stringify(row)}\n`).join(""));
      // Completed batches survive a later summary/write failure or process interruption.
      await handle.datasync();
    });
  } finally {
    await handle.close();
  }
}
