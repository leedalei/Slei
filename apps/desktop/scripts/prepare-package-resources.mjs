#!/usr/bin/env node
import { chmod, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const desktopRoot = resolve(scriptDir, "..");
const repoRoot = resolve(desktopRoot, "../..");
const nativeRoot = resolve(desktopRoot, "dist-native/darwin-arm64");
const skipBuild = process.argv.includes("--skip-build");

if (!skipBuild) {
  await run("cargo", ["build", "--release", "-p", "slei-daemon", "-p", "slei-cli"], { cwd: repoRoot });
  await run(process.execPath, [resolve(scriptDir, "bundle-claude-worker.mjs")], { cwd: desktopRoot });
  await run(process.execPath, [resolve(scriptDir, "prepare-node-runtime.mjs")], { cwd: desktopRoot });
} else {
  process.stdout.write("skipping cargo build; validating previously prepared worker and Node runtime resources\n");
}

await mkdir(nativeRoot, { recursive: true });
await copyExecutable(resolve(repoRoot, "target/release/slei-daemon"), resolve(nativeRoot, "slei-daemon"));
await copyExecutable(resolve(repoRoot, "target/release/slei-cli"), resolve(nativeRoot, "slei-cli"));

await ensurePreparedResource(resolve(nativeRoot, "workers/claude-agent/local-runner.js"), "worker bundle", () =>
  run(process.execPath, [resolve(scriptDir, "bundle-claude-worker.mjs")], { cwd: desktopRoot }),
);
await ensurePreparedResource(resolve(nativeRoot, "node/bin/node"), "Node runtime", () =>
  run(process.execPath, [resolve(scriptDir, "prepare-node-runtime.mjs")], { cwd: desktopRoot }),
);

const workerPackageSource = resolve(repoRoot, "workers/claude-agent/package.json");
const workerPackageDestination = resolve(nativeRoot, "workers/claude-agent/package.json");
await mkdir(dirname(workerPackageDestination), { recursive: true });
await copyFile(workerPackageSource, workerPackageDestination);

const workerPackage = JSON.parse(await readFile(workerPackageSource, "utf8"));
const nodeRuntimeVersion = (await readFile(resolve(desktopRoot, "build/node-runtime-version.txt"), "utf8")).trim();
const manifest = {
  platform: "darwin-arm64",
  nodeRuntimeVersion,
  resources: {
    daemon: "slei-daemon",
    cli: "slei-cli",
    node: "node/bin/node",
    worker: "workers/claude-agent/local-runner.js",
    workerPackage: "workers/claude-agent/package.json",
  },
  worker: {
    name: workerPackage.name,
    version: workerPackage.version,
    healthArg: workerPackage.slei?.workerHealthArg,
    distribution: workerPackage.slei?.distribution,
  },
};

await writeFile(resolve(nativeRoot, "resource-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
process.stdout.write(`prepared package resources at ${relative(repoRoot, nativeRoot)}\n`);

async function copyExecutable(source, destination) {
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(source, destination);
  await chmod(destination, 0o755);
}

async function ensurePreparedResource(path, label, prepare) {
  try {
    await readFile(path);
  } catch {
    process.stdout.write(`${label} missing; preparing now\n`);
    await prepare();
  }
}

async function run(command, args, options) {
  process.stdout.write(`$ ${command} ${args.join(" ")}\n`);
  await new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { ...options, stdio: "inherit" });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolveRun();
      } else {
        reject(new Error(`${command} ${args.join(" ")} exited with code ${code}`));
      }
    });
  });
}
