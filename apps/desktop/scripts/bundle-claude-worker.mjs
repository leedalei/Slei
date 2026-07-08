#!/usr/bin/env node
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const desktopRoot = resolve(scriptDir, "..");
const repoRoot = resolve(desktopRoot, "../..");
const entryPoint = resolve(repoRoot, "workers/claude-agent/src/local-runner.ts");
const outfile = resolve(desktopRoot, "dist-native/darwin-arm64/workers/claude-agent/local-runner.js");

await mkdir(dirname(outfile), { recursive: true });

await build({
  entryPoints: [entryPoint],
  outfile,
  bundle: true,
  platform: "node",
  format: "esm",
  target: ["node22"],
  packages: "bundle",
  external: ["claude"],
  legalComments: "none",
  logLevel: "info",
});

process.stdout.write(`bundled claude-agent worker: ${outfile}\n`);
