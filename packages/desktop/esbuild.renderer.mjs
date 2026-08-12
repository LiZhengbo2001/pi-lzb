import * as esbuild from "esbuild";
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageDir = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(packageDir, "dist/renderer");

mkdirSync(outDir, { recursive: true });

await esbuild.build({
  entryPoints: [resolve(packageDir, "src/renderer/main.tsx")],
  bundle: true,
  outfile: resolve(outDir, "bundle.js"),
  platform: "browser",
  target: "chrome120",
  format: "iife",
  jsx: "automatic",
  loader: { ".ts": "ts", ".tsx": "tsx", ".css": "css" },
  minify: false,
  sourcemap: true,
});

// Copy HTML shell
copyFileSync(
  resolve(packageDir, "src/renderer/index.html"),
  resolve(outDir, "index.html"),
);

console.log("Renderer built successfully.");
