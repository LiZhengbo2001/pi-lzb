import * as esbuild from "esbuild";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageDir = dirname(fileURLToPath(import.meta.url));

await esbuild.build({
  entryPoints: [resolve(packageDir, "dist/server/index.js")],
  bundle: true,
  outfile: resolve(packageDir, "dist/server/bundle.js"),
  platform: "node",
  target: "node22",
  format: "cjs",
  external: ["@earendil-works/*"],
  minify: false,
});

console.log("Server bundled successfully.");
