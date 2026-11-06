import { build } from "esbuild";
import { copyFile, mkdir } from "node:fs/promises";
await mkdir("public", { recursive: true });
await build({
  entryPoints: ["dashboard/client.ts"],
  bundle: true,
  minify: true,
  format: "esm",
  target: "es2022",
  outfile: "public/dashboard.js",
  sourcemap: false,
});
await copyFile("dashboard/styles.css", "public/dashboard.css");
