import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { test } from "node:test";

import { checkPackageResources } from "./package-resource-check.mjs";

test("checkPackageResources reports every required missing packaged resource", async () => {
  const root = mkdtempSync(join(tmpdir(), "slei-package-check-missing-"));
  writeFileSync(
    join(root, "electron-builder.yml"),
    "extraResources:\n  - from: dist-native/darwin-arm64\n    to: native/darwin-arm64\n",
  );

  const result = await checkPackageResources({ root, runHealthCheck: false });

  assert.equal(result.ok, false);
  assert.match(result.failures.join("\n"), /slei-daemon/);
  assert.match(result.failures.join("\n"), /slei-cli/);
  assert.match(result.failures.join("\n"), /node\/bin\/node/);
  assert.match(result.failures.join("\n"), /local-runner\.js/);
  assert.match(result.failures.join("\n"), /workers\/claude-agent\/package\.json/);
});

test("checkPackageResources accepts a complete fixture and runs worker health through bundled node", async () => {
  const root = mkdtempSync(join(tmpdir(), "slei-package-check-complete-"));
  const nativeRoot = join(root, "dist-native", "darwin-arm64");
  const workerRoot = join(nativeRoot, "workers", "claude-agent");
  const nodeBin = join(nativeRoot, "node", "bin");
  mkdirSync(workerRoot, { recursive: true });
  mkdirSync(nodeBin, { recursive: true });
  writeVersionAndManifest(root, nativeRoot);

  writeExecutable(join(nativeRoot, "slei-daemon"), "#!/bin/sh\nexit 0\n");
  writeExecutable(join(nativeRoot, "slei-cli"), "#!/bin/sh\nexit 0\n");
  symlinkSync(process.execPath, join(nodeBin, "node"));
  writeFileSync(join(workerRoot, "local-runner.js"), fixtureWorkerSource("valid-single-entry"));
  writeFileSync(
    join(workerRoot, "package.json"),
    JSON.stringify({
      name: "@slei/claude-agent",
      version: "0.1.0",
      private: true,
      type: "module",
      slei: {
        workerHealthArg: "--slei-worker-health",
        distribution: "standalone-artifact",
      },
    }),
  );
  writeFileSync(
    join(root, "electron-builder.yml"),
    "extraResources:\n  - from: dist-native/darwin-arm64\n    to: native/darwin-arm64\n",
  );

  const result = await checkPackageResources({
    root,
  });

  assert.deepEqual(result, {
    ok: true,
    failures: [],
  });
});

test("checkPackageResources rejects a packaged worker whose MCP config points to a missing adjacent server", async () => {
  const root = mkdtempSync(join(tmpdir(), "slei-package-check-broken-mcp-"));
  const nativeRoot = join(root, "dist-native", "darwin-arm64");
  const workerRoot = join(nativeRoot, "workers", "claude-agent");
  const nodeBin = join(nativeRoot, "node", "bin");
  mkdirSync(workerRoot, { recursive: true });
  mkdirSync(nodeBin, { recursive: true });
  writeVersionAndManifest(root, nativeRoot);

  writeExecutable(join(nativeRoot, "slei-daemon"), "#!/bin/sh\nexit 0\n");
  writeExecutable(join(nativeRoot, "slei-cli"), "#!/bin/sh\nexit 0\n");
  symlinkSync(process.execPath, join(nodeBin, "node"));
  writeFileSync(join(workerRoot, "local-runner.js"), fixtureWorkerSource("missing-adjacent-mcp-server"));
  writeWorkerPackage(join(workerRoot, "package.json"));
  writeFileSync(
    join(root, "electron-builder.yml"),
    "extraResources:\n  - from: dist-native/darwin-arm64\n    to: native/darwin-arm64\n",
  );

  const result = await checkPackageResources({ root });

  assert.equal(result.ok, false);
  assert.match(result.failures.join("\n"), /MCP server entry does not exist/);
});

test("checkPackageResources rejects a bundled Node version that differs from the pin", async () => {
  const root = mkdtempSync(join(tmpdir(), "slei-package-check-node-version-"));
  const nativeRoot = join(root, "dist-native", "darwin-arm64");
  const workerRoot = join(nativeRoot, "workers", "claude-agent");
  const nodeBin = join(nativeRoot, "node", "bin");
  mkdirSync(workerRoot, { recursive: true });
  mkdirSync(nodeBin, { recursive: true });
  writeVersionAndManifest(root, nativeRoot, { pinnedVersion: "0.0.0" });

  writeExecutable(join(nativeRoot, "slei-daemon"), "#!/bin/sh\nexit 0\n");
  writeExecutable(join(nativeRoot, "slei-cli"), "#!/bin/sh\nexit 0\n");
  writeExecutable(join(nodeBin, "node"), "#!/bin/sh\nprintf 'v99.0.0\\n'\n");
  writeFileSync(join(workerRoot, "local-runner.js"), "process.exit(0);\n");
  writeWorkerPackage(join(workerRoot, "package.json"));
  writeFileSync(
    join(root, "electron-builder.yml"),
    "extraResources:\n  - from: dist-native/darwin-arm64\n    to: native/darwin-arm64\n",
  );

  const result = await checkPackageResources({
    root,
    runHealthCheck: false,
    runNormalProtocolCheck: false,
  });

  assert.equal(result.ok, false);
  assert.match(result.failures.join("\n"), /bundled Node version/);
});

test("checkPackageResources rejects resource manifest version drift", async () => {
  const root = mkdtempSync(join(tmpdir(), "slei-package-check-manifest-version-"));
  const nativeRoot = join(root, "dist-native", "darwin-arm64");
  const workerRoot = join(nativeRoot, "workers", "claude-agent");
  const nodeBin = join(nativeRoot, "node", "bin");
  mkdirSync(workerRoot, { recursive: true });
  mkdirSync(nodeBin, { recursive: true });
  writeVersionAndManifest(root, nativeRoot, { manifestNodeRuntimeVersion: "0.0.0" });

  writeExecutable(join(nativeRoot, "slei-daemon"), "#!/bin/sh\nexit 0\n");
  writeExecutable(join(nativeRoot, "slei-cli"), "#!/bin/sh\nexit 0\n");
  symlinkSync(process.execPath, join(nodeBin, "node"));
  writeFileSync(join(workerRoot, "local-runner.js"), "process.exit(0);\n");
  writeWorkerPackage(join(workerRoot, "package.json"));
  writeFileSync(
    join(root, "electron-builder.yml"),
    "extraResources:\n  - from: dist-native/darwin-arm64\n    to: native/darwin-arm64\n",
  );

  const result = await checkPackageResources({
    root,
    runHealthCheck: false,
    runNormalProtocolCheck: false,
  });

  assert.equal(result.ok, false);
  assert.match(result.failures.join("\n"), /resource-manifest\.json nodeRuntimeVersion/);
});

function writeExecutable(path, contents) {
  writeFileSync(path, contents);
  chmodSync(path, 0o755);
}

function writeWorkerPackage(path) {
  writeFileSync(
    path,
    JSON.stringify({
      name: "@slei/claude-agent",
      version: "0.1.0",
      private: true,
      type: "module",
      slei: {
        workerHealthArg: "--slei-worker-health",
        distribution: "standalone-artifact",
      },
    }),
  );
}

function writeVersionAndManifest(root, nativeRoot, overrides = {}) {
  const version = overrides.pinnedVersion ?? process.version.slice(1);
  const manifestNodeRuntimeVersion = overrides.manifestNodeRuntimeVersion ?? version;
  mkdirSync(join(root, "build"), { recursive: true });
  writeFileSync(join(root, "build", "node-runtime-version.txt"), `${version}\n`);
  writeFileSync(
    join(nativeRoot, "resource-manifest.json"),
    `${JSON.stringify({
      platform: "darwin-arm64",
      nodeRuntimeVersion: manifestNodeRuntimeVersion,
      resources: {
        daemon: relative(nativeRoot, join(nativeRoot, "slei-daemon")),
        cli: relative(nativeRoot, join(nativeRoot, "slei-cli")),
        node: relative(nativeRoot, join(nativeRoot, "node/bin/node")),
        worker: relative(nativeRoot, join(nativeRoot, "workers/claude-agent/local-runner.js")),
        workerPackage: relative(nativeRoot, join(nativeRoot, "workers/claude-agent/package.json")),
      },
      worker: {
        name: "@slei/claude-agent",
        version: "0.1.0",
        healthArg: "--slei-worker-health",
        distribution: "standalone-artifact",
      },
      ...overrides,
    })}\n`,
  );
}

function fixtureWorkerSource(mode) {
  return `
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

if (process.argv.includes("--slei-worker-health")) {
  process.stdout.write(JSON.stringify({ ok: true, worker: "claude-agent" }) + "\\n");
  process.exit(0);
}

readFileSync(0, "utf8");
const tempDir = join(tmpdir(), "slei-package-check-" + process.pid);
mkdirSync(tempDir, { recursive: true });
const mcpConfigPath = join(tempDir, "mcp-config.json");
const serverArgs = ${JSON.stringify(mode)} === "valid-single-entry"
  ? [process.argv[1], "--slei-mcp-server"]
  : [join(dirname(process.argv[1]), "mcp-server.js")];
writeFileSync(mcpConfigPath, JSON.stringify({
  mcpServers: {
    slei: {
      type: "stdio",
      command: process.execPath,
      args: serverArgs,
      env: { SLEI_RUN_ID: "run_package_check", SLEI_AGENT_ID: "agent_package_check" },
    },
  },
}));
const result = spawnSync("claude", ["--mcp-config", mcpConfigPath], { encoding: "utf8" });
if (result.stderr) process.stderr.write(result.stderr);
if ((result.status ?? 1) === 0) {
  process.stdout.write(JSON.stringify({ type: "completed", run_id: "run_package_check" }) + "\\n");
  process.exit(0);
}
process.exit(result.status ?? 1);
`;
}
