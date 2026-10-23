import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

// Only the optional Esri AI adapter needs a package build. Local research
// search is a native ES module and remains usable if this bundle is absent.
await mkdir(new URL("../assets/", import.meta.url), { recursive: true });
await build({
    absWorkingDir: fileURLToPath(new URL("../", import.meta.url)),
    entryPoints: ["src/research-ai.js"],
    outdir: "assets",
    entryNames: "research-ai",
    chunkNames: "research-chunk-[hash]",
    bundle: true,
    splitting: true,
    format: "esm",
    platform: "browser",
    target: ["es2022"],
    minify: true,
    sourcemap: false,
    legalComments: "eof",
    logLevel: "info"
});
