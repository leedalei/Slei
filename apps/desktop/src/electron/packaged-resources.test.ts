import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { DesktopDaemonError } from "./daemon-http.js";
import { resolveNativeResources } from "./packaged-resources.js";

const tempRoots: string[] = [];

describe("packaged resource resolution", () => {
  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it("resolves packaged darwin arm64 resources from process resourcesPath native root", async () => {
    const resourcesPath = await createPackagedResources();
    const nativeRoot = join(resourcesPath, "native", "darwin-arm64");

    expect(resolveNativeResources({
      arch: "arm64",
      isPackaged: true,
      platform: "darwin",
      repoRoot: "/repo",
      resourcesPath,
    })).toEqual({
      nativeRoot,
      daemonPath: join(nativeRoot, "slei-daemon"),
      cliPath: join(nativeRoot, "slei-cli"),
      nodeBinPath: join(nativeRoot, "node", "bin"),
      nodePath: join(nativeRoot, "node", "bin", "node"),
      workerPath: join(nativeRoot, "workers", "claude-agent", "local-runner.js"),
      workerPackagePath: join(nativeRoot, "workers", "claude-agent", "package.json"),
    });
  });

  it("resolves dev resources from repo target/debug and worker dev build paths", () => {
    expect(resolveNativeResources({
      arch: "arm64",
      isPackaged: false,
      platform: "darwin",
      repoRoot: "/repo",
      resourcesPath: "/ignored",
    })).toMatchObject({
      nativeRoot: "/repo/target/debug",
      daemonPath: "/repo/target/debug/slei-daemon",
      cliPath: "/repo/target/debug/slei-cli",
      workerPath: "/repo/workers/claude-agent/dist/local-runner.js",
      workerPackagePath: "/repo/workers/claude-agent/package.json",
    });
  });

  it.each(["x64", "universal"])("rejects packaged darwin %s resources as an unsupported architecture", (arch) => {
    expect(() => resolveNativeResources({
      arch,
      isPackaged: true,
      platform: "darwin",
      repoRoot: "/repo",
      resourcesPath: "/resources",
    })).toThrowError(expect.objectContaining({
      code: "daemon_resource_unsupported_architecture",
    }));
  });

  it.each([
    ["daemon", "slei-daemon"],
    ["CLI", "slei-cli"],
    ["node", "node/bin/node"],
    ["worker", "workers/claude-agent/local-runner.js"],
    ["worker package", "workers/claude-agent/package.json"],
  ])("throws daemon_resource_missing when the packaged %s resource is missing", async (_label, missingRelativePath) => {
    const resourcesPath = await createPackagedResources({ omit: missingRelativePath });

    expect(() => resolveNativeResources({
      arch: "arm64",
      isPackaged: true,
      platform: "darwin",
      repoRoot: "/repo",
      resourcesPath,
    })).toThrowError(expect.objectContaining({
      code: "daemon_resource_missing",
    }));
  });

  it.each([
    ["daemon", "slei-daemon"],
    ["CLI", "slei-cli"],
    ["node", "node/bin/node"],
  ])("throws daemon_resource_invalid when the packaged %s resource is not executable", async (_label, nonExecutableRelativePath) => {
    const resourcesPath = await createPackagedResources({ nonExecutable: nonExecutableRelativePath });

    expect(() => resolveNativeResources({
      arch: "arm64",
      isPackaged: true,
      platform: "darwin",
      repoRoot: "/repo",
      resourcesPath,
    })).toThrowError(expect.objectContaining({
      code: "daemon_resource_invalid",
    }));
  });
});

async function createPackagedResources(options: { nonExecutable?: string; omit?: string } = {}): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "slei-packaged-resources-test-"));
  tempRoots.push(root);
  const nativeRoot = join(root, "native", "darwin-arm64");
  const files = [
    "slei-daemon",
    "slei-cli",
    "node/bin/node",
    "workers/claude-agent/local-runner.js",
    "workers/claude-agent/package.json",
  ];

  for (const file of files) {
    if (file === options.omit) {
      continue;
    }
    const path = join(nativeRoot, file);
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, file.endsWith(".json") ? "{}\n" : "#!/bin/sh\n", "utf8");
    if (!file.endsWith(".json") && !file.endsWith(".js")) {
      await chmod(path, file === options.nonExecutable ? 0o644 : 0o755);
    }
  }

  return root;
}
