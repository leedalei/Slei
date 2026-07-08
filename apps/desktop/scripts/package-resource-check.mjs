#!/usr/bin/env node
import { access, chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { delimiter, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";

const RESOURCE_RELATIVE_ROOT = "dist-native/darwin-arm64";
const WORKER_HEALTH_ARG = "--slei-worker-health";
const EXPECTED_HEALTH_OUTPUT = JSON.stringify({ ok: true, worker: "claude-agent" });

export async function checkPackageResources(options = {}) {
  const root = resolve(options.root ?? process.cwd());
  const nativeRoot = resolve(root, RESOURCE_RELATIVE_ROOT);
  const failures = [];

  const daemonPath = resolve(nativeRoot, "slei-daemon");
  const cliPath = resolve(nativeRoot, "slei-cli");
  const nodePath = resolve(nativeRoot, "node/bin/node");
  const workerPath = resolve(nativeRoot, "workers/claude-agent/local-runner.js");
  const workerPackagePath = resolve(nativeRoot, "workers/claude-agent/package.json");
  const electronBuilderPath = resolve(root, "electron-builder.yml");
  const nodeVersionPath = resolve(root, "build/node-runtime-version.txt");
  const manifestPath = resolve(nativeRoot, "resource-manifest.json");

  await checkExecutable(daemonPath, "dist-native/darwin-arm64/slei-daemon", failures);
  await checkExecutable(cliPath, "dist-native/darwin-arm64/slei-cli", failures);
  await checkExecutable(nodePath, "dist-native/darwin-arm64/node/bin/node", failures);
  await checkNodeVersion({ nodePath, nodeVersionPath }, failures);
  await checkFile(workerPath, "dist-native/darwin-arm64/workers/claude-agent/local-runner.js", failures);
  await checkWorkerPackage(workerPackagePath, failures);
  await checkNoWorkerNodeModules(resolve(nativeRoot, "workers/claude-agent/node_modules"), failures);
  await checkElectronBuilderResources(electronBuilderPath, failures);
  await checkResourceManifest({ manifestPath, nativeRoot, nodeVersionPath }, failures);

  if (options.runHealthCheck !== false) {
    await checkWorkerHealth({ nativeRoot, nodePath, workerPath, env: options.env }, failures);
  }
  if (options.runNormalProtocolCheck !== false) {
    await checkWorkerNormalProtocol({ nativeRoot, nodePath, workerPath, env: options.env }, failures);
  }

  return { ok: failures.length === 0, failures };
}

async function checkFile(path, label, failures) {
  try {
    const fileStat = await stat(path);
    if (!fileStat.isFile()) {
      failures.push(`${label} exists but is not a file`);
      return false;
    }
    return true;
  } catch {
    failures.push(`${label} is missing`);
    return false;
  }
}

async function checkExecutable(path, label, failures) {
  const exists = await checkFile(path, label, failures);
  if (!exists) {
    return false;
  }
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    failures.push(`${label} is not executable`);
    return false;
  }
}

async function checkNodeVersion({ nodePath, nodeVersionPath }, failures) {
  let expectedVersion;
  try {
    expectedVersion = (await readFile(nodeVersionPath, "utf8")).trim();
  } catch {
    failures.push("build/node-runtime-version.txt is missing");
    return;
  }

  if (!/^\d+\.\d+\.\d+$/.test(expectedVersion)) {
    failures.push(`build/node-runtime-version.txt must contain an exact x.y.z version, got ${JSON.stringify(expectedVersion)}`);
    return;
  }

  const result = await run(nodePath, ["-v"], {
    PATH: resolve(nodePath, "../"),
    HOME: process.env.HOME ?? "",
    TMPDIR: process.env.TMPDIR ?? "/tmp",
  });
  const actualVersion = result.stdout.trim();
  if (result.code !== 0) {
    failures.push(`bundled Node version check exited ${result.code}: ${result.stderr.trim() || actualVersion || "no output"}`);
    return;
  }
  if (actualVersion !== `v${expectedVersion}`) {
    failures.push(`bundled Node version mismatch: expected v${expectedVersion}, got ${actualVersion || "no output"}`);
  }
}

async function checkWorkerPackage(path, failures) {
  const existed = await checkFile(path, "dist-native/darwin-arm64/workers/claude-agent/package.json", failures);
  if (!existed) {
    return;
  }

  let packageJson;
  try {
    packageJson = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    failures.push(`workers/claude-agent/package.json is not valid JSON: ${error.message}`);
    return;
  }

  if (packageJson.name !== "@slei/claude-agent") {
    failures.push("workers/claude-agent/package.json is missing name @slei/claude-agent");
  }
  if (typeof packageJson.version !== "string" || packageJson.version.length === 0) {
    failures.push("workers/claude-agent/package.json is missing a version string");
  }
  if (packageJson.type !== "module") {
    failures.push("workers/claude-agent/package.json must declare type module");
  }
  if (packageJson.slei?.workerHealthArg !== WORKER_HEALTH_ARG) {
    failures.push(`workers/claude-agent/package.json must declare slei.workerHealthArg ${WORKER_HEALTH_ARG}`);
  }
  if (packageJson.slei?.distribution !== "standalone-artifact") {
    failures.push("workers/claude-agent/package.json must declare slei.distribution standalone-artifact");
  }
}

async function checkNoWorkerNodeModules(path, failures) {
  try {
    await stat(path);
    failures.push("worker artifact must not include workers/claude-agent/node_modules");
  } catch (error) {
    if (error.code !== "ENOENT") {
      failures.push(`could not inspect worker node_modules directory: ${error.message}`);
    }
  }
}

async function checkElectronBuilderResources(path, failures) {
  let source;
  try {
    source = await readFile(path, "utf8");
  } catch {
    failures.push("electron-builder.yml is missing");
    return;
  }

  if (!/extraResources:\s*(?:\n|.)*?from:\s*dist-native\/darwin-arm64\b/.test(source)) {
    failures.push("electron-builder.yml extraResources source must be dist-native/darwin-arm64");
  }
}

async function checkResourceManifest({ manifestPath, nativeRoot, nodeVersionPath }, failures) {
  const existed = await checkFile(manifestPath, "dist-native/darwin-arm64/resource-manifest.json", failures);
  if (!existed) {
    return;
  }

  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch (error) {
    failures.push(`resource-manifest.json is not valid JSON: ${error.message}`);
    return;
  }

  let expectedVersion = "";
  try {
    expectedVersion = (await readFile(nodeVersionPath, "utf8")).trim();
  } catch {
    return;
  }

  const expectedResources = {
    daemon: "slei-daemon",
    cli: "slei-cli",
    node: "node/bin/node",
    worker: "workers/claude-agent/local-runner.js",
    workerPackage: "workers/claude-agent/package.json",
  };

  if (manifest.platform !== "darwin-arm64") {
    failures.push(`resource-manifest.json platform mismatch: expected darwin-arm64, got ${String(manifest.platform)}`);
  }
  if (manifest.nodeRuntimeVersion !== expectedVersion) {
    failures.push(
      `resource-manifest.json nodeRuntimeVersion mismatch: expected ${expectedVersion}, got ${String(manifest.nodeRuntimeVersion)}`,
    );
  }
  for (const [key, expectedPath] of Object.entries(expectedResources)) {
    if (manifest.resources?.[key] !== expectedPath) {
      failures.push(`resource-manifest.json resources.${key} mismatch: expected ${expectedPath}, got ${String(manifest.resources?.[key])}`);
      continue;
    }
    const resourceExists = await checkFile(resolve(nativeRoot, expectedPath), `manifest resource ${expectedPath}`, []);
    if (!resourceExists) {
      failures.push(`resource-manifest.json resources.${key} points to missing file ${expectedPath}`);
    }
  }
  if (manifest.worker?.name !== "@slei/claude-agent") {
    failures.push("resource-manifest.json worker.name must be @slei/claude-agent");
  }
  if (manifest.worker?.healthArg !== WORKER_HEALTH_ARG) {
    failures.push(`resource-manifest.json worker.healthArg must be ${WORKER_HEALTH_ARG}`);
  }
  if (manifest.worker?.distribution !== "standalone-artifact") {
    failures.push("resource-manifest.json worker.distribution must be standalone-artifact");
  }
}

async function checkWorkerHealth({ nativeRoot, nodePath, workerPath, env }, failures) {
  const nodeBin = resolve(nativeRoot, "node/bin");
  const pathValue = `${nodeBin}${delimiter}${nativeRoot}`;
  const result = await run(nodePath, [workerPath, WORKER_HEALTH_ARG], {
    PATH: pathValue,
    HOME: process.env.HOME ?? "",
    TMPDIR: process.env.TMPDIR ?? "/tmp",
    ...env,
  });

  if (result.code !== 0) {
    failures.push(
      `worker health check exited ${result.code}: ${result.stderr.trim() || result.stdout.trim() || "no output"}`,
    );
    return;
  }

  const stdout = result.stdout.trim();
  if (stdout !== EXPECTED_HEALTH_OUTPUT) {
    failures.push(`worker health check output mismatch: expected ${EXPECTED_HEALTH_OUTPUT}, got ${stdout}`);
  }
}

async function checkWorkerNormalProtocol({ nativeRoot, nodePath, workerPath, env }, failures) {
  const probeRoot = await mkdtemp(join(tmpdir(), "slei-package-worker-probe-"));
  const fakeBin = join(probeRoot, "bin");
  const workspaceRoot = join(probeRoot, "workspace");
  const agentRoot = join(probeRoot, "agent");
  const overlayRoot = join(probeRoot, "overlay");

  try {
    await mkdir(fakeBin, { recursive: true });
    await mkdir(workspaceRoot, { recursive: true });
    await mkdir(agentRoot, { recursive: true });
    await mkdir(overlayRoot, { recursive: true });

    const fakeClaudePath = join(fakeBin, "claude");
    await writeFile(fakeClaudePath, fakeClaudeSource(), "utf8");
    await chmod(fakeClaudePath, 0o755);

    const nodeBin = resolve(nativeRoot, "node/bin");
    const pathValue = `${fakeBin}${delimiter}${nodeBin}${delimiter}${nativeRoot}`;
    const result = await run(
      nodePath,
      [workerPath],
      {
        PATH: pathValue,
        HOME: process.env.HOME ?? "",
        TMPDIR: process.env.TMPDIR ?? "/tmp",
        SLEI_OVERLAY_HOME: overlayRoot,
        ...env,
      },
      JSON.stringify(packageProbeCommand({ workspaceRoot, agentRoot })),
    );

    if (result.code !== 0) {
      failures.push(
        `worker normal protocol check exited ${result.code}: ${result.stderr.trim() || result.stdout.trim() || "no output"}`,
      );
      return;
    }

    if (!result.stdout.split("\n").some((line) => line.trim() === JSON.stringify({ type: "completed", run_id: "run_package_check" }))) {
      failures.push(`worker normal protocol check did not complete successfully: ${result.stdout.trim() || "no output"}`);
    }
  } finally {
    await rm(probeRoot, { recursive: true, force: true });
  }
}

function fakeClaudeSource() {
  return `#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";

const configFlagIndex = process.argv.indexOf("--mcp-config");
if (configFlagIndex < 0 || !process.argv[configFlagIndex + 1]) {
  console.error("missing --mcp-config");
  process.exit(31);
}

const config = JSON.parse(readFileSync(process.argv[configFlagIndex + 1], "utf8"));
const server = config?.mcpServers?.slei;
const serverArgs = Array.isArray(server?.args) ? server.args : [];
const serverEntry = serverArgs[0];

if (server?.command !== process.execPath) {
  console.error("MCP server command is not bundled Node: " + String(server?.command));
  process.exit(32);
}
if (typeof serverEntry !== "string" || !existsSync(serverEntry)) {
  console.error("MCP server entry does not exist: " + String(serverEntry));
  process.exit(33);
}
if (!serverArgs.includes("--slei-mcp-server")) {
  console.error("MCP server args missing --slei-mcp-server");
  process.exit(34);
}

process.stdout.write(JSON.stringify({ type: "result", is_error: false }) + "\\n");
`;
}

function packageProbeCommand({ workspaceRoot, agentRoot }) {
  return {
    type: "start_run",
    run_id: "run_package_check",
    session: {
      session_id: "11111111-1111-4111-8111-111111111111",
      agent_id: "agent_package_check",
      runtime: "ClaudeCode",
      cwd: workspaceRoot,
      agent_workspace_path: agentRoot,
      persist_session: false,
      resume_session: false,
    },
    input: {
      prompt: "package resource check",
      context: [],
    },
  };
}

function run(command, args, env, stdin = "") {
  return new Promise((resolveRun) => {
    const child = spawn(command, args, { env, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.stdin.end(stdin);
    child.on("error", (error) => {
      resolveRun({ code: 1, stdout, stderr: error.message });
    });
    child.on("close", (code) => {
      resolveRun({ code: code ?? 1, stdout, stderr });
    });
  });
}

function parseArgs(argv) {
  const args = { root: process.cwd() };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--root") {
      args.root = argv[index + 1];
      index += 1;
    } else if (arg === "--no-health-check") {
      args.runHealthCheck = false;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }

  return args;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const result = await checkPackageResources(options);

  if (result.ok) {
    process.stdout.write("package resources OK\n");
    return;
  }

  for (const failure of result.failures) {
    process.stderr.write(`package resource check failed: ${failure}\n`);
  }
  process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
}
