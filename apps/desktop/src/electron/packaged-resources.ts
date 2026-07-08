import { accessSync, constants, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DesktopDaemonError } from "./daemon-http.js";

export type NativeResourcePlatform = NodeJS.Platform | string;
export type NativeResourceArch = NodeJS.Architecture | string;

export type ResolveNativeResourcesOptions = {
  arch: NativeResourceArch;
  isPackaged: boolean;
  platform: NativeResourcePlatform;
  repoRoot: string;
  resourcesPath: string;
};

export type NativeResources = {
  nativeRoot: string;
  daemonPath: string;
  cliPath: string;
  nodePath: string;
  nodeBinPath: string;
  workerPath: string;
  workerPackagePath: string;
};

export function resolveNativeResources(options: ResolveNativeResourcesOptions): NativeResources {
  if (!options.isPackaged) {
    return resolveDevResources(options.repoRoot);
  }

  const platformKey = packagedPlatformKey(options.platform, options.arch);
  const nativeRoot = resolve(options.resourcesPath, "native", platformKey);
  const resources = {
    nativeRoot,
    daemonPath: resolve(nativeRoot, "slei-daemon"),
    cliPath: resolve(nativeRoot, "slei-cli"),
    nodePath: resolve(nativeRoot, "node/bin/node"),
    nodeBinPath: resolve(nativeRoot, "node/bin"),
    workerPath: resolve(nativeRoot, "workers/claude-agent/local-runner.js"),
    workerPackagePath: resolve(nativeRoot, "workers/claude-agent/package.json"),
  };

  assertPackagedFile(resources.daemonPath, "daemon", { executable: true });
  assertPackagedFile(resources.cliPath, "CLI", { executable: true });
  assertPackagedFile(resources.nodePath, "Node runtime", { executable: true });
  assertPackagedFile(resources.workerPath, "Claude worker");
  assertPackagedFile(resources.workerPackagePath, "Claude worker package");

  return resources;
}

function resolveDevResources(repoRoot: string): NativeResources {
  const nativeRoot = resolve(repoRoot, "target/debug");
  const nodePath = process.execPath;
  return {
    nativeRoot,
    daemonPath: resolve(nativeRoot, "slei-daemon"),
    cliPath: resolve(nativeRoot, "slei-cli"),
    nodePath,
    nodeBinPath: dirname(nodePath),
    workerPath: resolve(repoRoot, "workers/claude-agent/dist/local-runner.js"),
    workerPackagePath: resolve(repoRoot, "workers/claude-agent/package.json"),
  };
}

function packagedPlatformKey(platform: NativeResourcePlatform, arch: NativeResourceArch): string {
  if (platform === "darwin" && arch === "arm64") {
    return "darwin-arm64";
  }

  throw new DesktopDaemonError(
    "daemon_resource_unsupported_architecture",
    `Unsupported packaged Slei native resources for ${platform}-${arch}`,
  );
}

function assertPackagedFile(path: string, label: string, options: { executable?: boolean } = {}): void {
  try {
    if (!statSync(path).isFile()) {
      throw new DesktopDaemonError("daemon_resource_missing", `Packaged ${label} resource is missing: ${path}`);
    }
    if (options.executable) {
      try {
        accessSync(path, constants.X_OK);
      } catch {
        throw new DesktopDaemonError("daemon_resource_invalid", `Packaged ${label} resource is not executable: ${path}`);
      }
    }
    return;
  } catch (error) {
    if (error instanceof DesktopDaemonError) {
      throw error;
    }
    throw new DesktopDaemonError("daemon_resource_missing", `Packaged ${label} resource is missing: ${path}`);
  }
}
