import { spawn as nodeSpawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { dirname, delimiter, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import net from "node:net";
import {
  DAEMON_ENDPOINT,
  DAEMON_DYNAMIC_BIND_ADDR,
  DAEMON_HOST,
  DAEMON_PORT,
  DAEMON_READY_TIMEOUT_MS,
  DESKTOP_DAEMON_TOKEN,
} from "./constants.js";
import { createDaemonHttpClient, DesktopDaemonError } from "./daemon-http.js";
import { defaultAvatarDataRoot } from "./avatar-protocol.js";
import { resolveNativeResources, type NativeResourceArch, type NativeResourcePlatform } from "./packaged-resources.js";

export const EXPECTED_PROTOCOL_VERSION = "v1";
const MAX_RECENT_OUTPUT_LINES = 20;
const MAX_RECENT_OUTPUT_LINE_CHARS = 512;
const MAX_RECENT_OUTPUT_TOTAL_CHARS = 4_096;

export type DaemonHealth = {
  daemon_version: string;
  protocol_version: string;
  status: string;
};

export type DaemonHandle =
  | {
      owned: false;
      endpoint: string;
      token: string;
    }
  | {
      owned: true;
      endpoint: string;
      process: ChildProcess;
      token: string;
    };

type SpawnDaemon = typeof nodeSpawn;
type KillProcess = (pid: number, signal: NodeJS.Signals) => boolean | void;
type TerminateProcess = (process: ChildProcess) => void;

type LifecycleDependencies = {
  authCheck?: () => Promise<unknown>;
  arch?: NativeResourceArch;
  endpoint?: string;
  generateToken?: () => string;
  health?: () => Promise<DaemonHealth>;
  host?: string;
  isPackaged?: boolean;
  now?: () => number;
  platform?: NativeResourcePlatform;
  port?: number;
  probePort?: (host: string, port: number) => Promise<boolean>;
  repoRoot?: string;
  resourcesPath?: string;
  dataRoot?: string;
  sleep?: (ms: number) => Promise<void>;
  spawn?: SpawnDaemon;
  terminateProcess?: TerminateProcess;
  timeoutMs?: number;
  userDataPath?: string;
};

type WaitForDaemonReadyOptions = {
  authCheck?: () => Promise<unknown>;
  health: () => Promise<DaemonHealth>;
  host?: string;
  now?: () => number;
  port?: number;
  probePort?: (host: string, port: number) => Promise<boolean>;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
};

type TerminateOwnedProcessOptions = {
  killProcess?: KillProcess;
};

export function probePort(host: string, port: number): Promise<boolean> {
  return new Promise((resolvePortState) => {
    const socket = net.createConnection({ host, port });

    socket.once("connect", () => {
      socket.end();
      resolvePortState(true);
    });
    socket.once("error", () => {
      socket.destroy();
      resolvePortState(false);
    });
    socket.setTimeout(1_000, () => {
      socket.destroy();
      resolvePortState(false);
    });
  });
}

export async function waitForDaemonReady(options: WaitForDaemonReadyOptions): Promise<DaemonHealth> {
  const timeoutMs = options.timeoutMs ?? DAEMON_READY_TIMEOUT_MS;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? defaultSleep;
  const checkPort = options.probePort ?? probePort;
  const host = options.host ?? DAEMON_HOST;
  const port = options.port ?? DAEMON_PORT;
  const deadline = now() + timeoutMs;
  let lastError: unknown;

  while (now() < deadline) {
    try {
      if (await checkPort(host, port)) {
        const health = await runBeforeDeadline(options.health, {
          deadline,
          message: "Timed out waiting for Slei daemon health",
          now,
          sleep,
        });
        assertCompatibleHealth(health);
        if (options.authCheck) {
          await runBeforeDeadline(options.authCheck, {
            deadline,
            message: "Timed out validating Slei daemon authorization",
            now,
            sleep,
          });
        }
        return health;
      }
    } catch (error) {
      if (isFatalValidationError(error)) {
        throw error;
      }
      lastError = error;
    }

    const remainingMs = deadline - now();
    if (remainingMs > 0) {
      await sleep(Math.min(100, remainingMs));
    }
  }

  throw new DesktopDaemonError("daemon_unavailable", "Timed out waiting for Slei daemon to become ready", {
    cause: lastError,
  });
}

export async function ensureDaemon(dependencies: LifecycleDependencies = {}): Promise<DaemonHandle> {
  if (dependencies.isPackaged) {
    return startPackagedDaemon(dependencies);
  }

  const host = dependencies.host ?? DAEMON_HOST;
  const port = dependencies.port ?? DAEMON_PORT;
  const endpoint = dependencies.endpoint ?? DAEMON_ENDPOINT;
  const checkPort = dependencies.probePort ?? probePort;
  const client = createDaemonHttpClient({ endpoint, token: DESKTOP_DAEMON_TOKEN });
  const health = dependencies.health ?? createDefaultHealth(client);
  const authCheck = dependencies.authCheck ?? createDefaultAuthCheck(client);

  if (await checkPort(host, port)) {
    try {
      await waitForDaemonReady({
        authCheck,
        health,
        host,
        now: dependencies.now,
        port,
        probePort: checkPort,
        sleep: dependencies.sleep,
        timeoutMs: dependencies.timeoutMs,
      });
      return { owned: false, endpoint, token: DESKTOP_DAEMON_TOKEN };
    } catch (error) {
      throw normalizeExistingDaemonError(error);
    }
  }

  const repoRoot = dependencies.repoRoot ?? defaultRepoRoot();
  const dataRoot = dependencies.dataRoot ?? defaultAvatarDataRoot();
  const spawnDaemon = dependencies.spawn ?? nodeSpawn;
  const terminateProcess = dependencies.terminateProcess ?? terminateOwnedProcess;
  const daemonProcess = spawnDaemon("cargo", ["run", "-p", "slei-daemon"], {
    cwd: repoRoot,
    detached: true,
    env: {
      ...process.env,
      PATH: prependPath(resolve(repoRoot, "target/debug"), process.env.PATH),
      SLEI_DATA_ROOT: dataRoot,
      SLEI_DAEMON_TOKEN: DESKTOP_DAEMON_TOKEN,
      SLEI_DAEMON_URL: endpoint,
    },
    stdio: "inherit",
  });
  const spawnFailure = waitForSpawnError(daemonProcess);
  spawnFailure.catch(() => undefined);

  try {
    await Promise.race([
      waitForDaemonReady({
        authCheck,
        health,
        host,
        now: dependencies.now,
        port,
        probePort: checkPort,
        sleep: dependencies.sleep,
        timeoutMs: dependencies.timeoutMs,
      }),
      spawnFailure,
    ]);
  } catch (error) {
    terminateProcess(daemonProcess);
    throw error;
  }

  return { owned: true, endpoint, process: daemonProcess, token: DESKTOP_DAEMON_TOKEN };
}

async function startPackagedDaemon(dependencies: LifecycleDependencies): Promise<DaemonHandle> {
  const repoRoot = dependencies.repoRoot ?? defaultRepoRoot();
  const resources = resolveNativeResources({
    arch: dependencies.arch ?? process.arch,
    isPackaged: true,
    platform: dependencies.platform ?? process.platform,
    repoRoot,
    resourcesPath: dependencies.resourcesPath ?? defaultResourcesPath(),
  });
  const token = (dependencies.generateToken ?? generateDaemonToken)();
  const spawnDaemon = dependencies.spawn ?? nodeSpawn;
  const terminateProcess = dependencies.terminateProcess ?? terminateOwnedProcess;
  const daemonProcess = spawnDaemon(resources.daemonPath, [], {
    cwd: resources.nativeRoot,
    detached: true,
    env: packagedDaemonEnv({
      dataRoot: resolve(dependencies.userDataPath ?? defaultAvatarDataRoot(), "data"),
      nativeRoot: resources.nativeRoot,
      nodeBinPath: resources.nodeBinPath,
      token,
      workerPath: resources.workerPath,
    }),
    stdio: ["ignore", "pipe", "pipe"],
  });

  try {
    const endpoint = await waitForPackagedDaemonEndpoint(daemonProcess, dependencies.timeoutMs ?? DAEMON_READY_TIMEOUT_MS);
    return { owned: true, endpoint, process: daemonProcess, token };
  } catch (error) {
    terminateProcess(daemonProcess);
    throw error;
  }
}

export function stopOwnedDaemon(handle: DaemonHandle, options: TerminateOwnedProcessOptions = {}): void {
  if (!handle.owned) {
    return;
  }

  terminateOwnedProcess(handle.process, options);
}

export function terminateOwnedProcess(
  childProcess: ChildProcess,
  options: TerminateOwnedProcessOptions = {},
): void {
  const killProcess = options.killProcess ?? process.kill.bind(process);

  if (typeof childProcess.pid === "number" && childProcess.pid > 0) {
    try {
      killProcess(-childProcess.pid, "SIGTERM");
      return;
    } catch {
      // Fall back to the direct child if the process group is already gone or unavailable.
    }
  }

  childProcess.kill("SIGTERM");
}

function waitForPackagedDaemonEndpoint(childProcess: ChildProcess, timeoutMs: number): Promise<string> {
  const recentOutput: string[] = [];
  let outputBuffer = "";
  let settled = false;

  return new Promise((resolveReady, rejectReady) => {
    const timeout = setTimeout(() => {
      rejectWithOutput("Timed out waiting for packaged Slei daemon to report its listening address");
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timeout);
      childProcess.stdout?.off("data", onStdout);
      childProcess.stderr?.off("data", onStderr);
      childProcess.off("error", onError);
      childProcess.off("exit", onExit);
      childProcess.off("close", onClose);
    };

    const settle = (callback: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      callback();
    };

    const rejectWithOutput = (message: string, cause?: unknown) => {
      settle(() => {
        rejectReady(new DesktopDaemonError("daemon_unavailable", outputAwareMessage(message, recentOutput), { cause }));
      });
    };

    const resolveEndpoint = (endpoint: string) => {
      settle(() => {
        childProcess.stdout?.resume();
        childProcess.stderr?.resume();
        resolveReady(endpoint);
      });
    };

    const onStdout = (chunk: Buffer | string) => {
      const text = String(chunk);
      rememberOutput(recentOutput, text);
      outputBuffer = `${outputBuffer}${text}`.slice(-4_096);
      const endpoint = parseDaemonListeningEndpoint(outputBuffer);
      if (endpoint) {
        resolveEndpoint(endpoint);
      }
    };

    const onStderr = (chunk: Buffer | string) => {
      rememberOutput(recentOutput, String(chunk));
    };

    const onError = (error: Error) => {
      rejectWithOutput("Packaged Slei daemon process failed to start", error);
    };

    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      rejectWithOutput(`Packaged Slei daemon exited before readiness: code=${String(code)} signal=${String(signal)}`);
    };

    const onClose = (code: number | null, signal: NodeJS.Signals | null) => {
      rejectWithOutput(`Packaged Slei daemon closed before readiness: code=${String(code)} signal=${String(signal)}`);
    };

    childProcess.stdout?.on("data", onStdout);
    childProcess.stderr?.on("data", onStderr);
    childProcess.once("error", onError);
    childProcess.once("exit", onExit);
    childProcess.once("close", onClose);
  });
}

function parseDaemonListeningEndpoint(output: string): string | undefined {
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^slei-daemon listening on (127\.0\.0\.1):(\d+)$/);
    if (!match) {
      continue;
    }
    const port = Number(match[2]);
    if (Number.isInteger(port) && port >= 1 && port <= 65_535) {
      return `http://${match[1]}:${port}`;
    }
  }
  return undefined;
}

function rememberOutput(recentOutput: string[], text: string): void {
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      continue;
    }
    recentOutput.push(truncateRecentOutputLine(trimmed));
  }
  while (recentOutput.length > MAX_RECENT_OUTPUT_LINES || recentOutput.join("\n").length > MAX_RECENT_OUTPUT_TOTAL_CHARS) {
    recentOutput.shift();
  }
}

function truncateRecentOutputLine(line: string): string {
  if (line.length <= MAX_RECENT_OUTPUT_LINE_CHARS) {
    return line;
  }
  return `${line.slice(0, MAX_RECENT_OUTPUT_LINE_CHARS)}...`;
}

function outputAwareMessage(message: string, recentOutput: string[]): string {
  if (recentOutput.length === 0) {
    return message;
  }
  return `${message}. Recent daemon output:\n${recentOutput.join("\n")}`;
}

function packagedDaemonEnv(options: {
  dataRoot: string;
  nativeRoot: string;
  nodeBinPath: string;
  token: string;
  workerPath: string;
}): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.SLEI_DAEMON_URL;
  return {
    ...env,
    PATH: prependPathEntries([options.nodeBinPath, options.nativeRoot], process.env.PATH),
    SLEI_CLAUDE_AGENT_RUNNER: options.workerPath,
    SLEI_DAEMON_ADDR: DAEMON_DYNAMIC_BIND_ADDR,
    SLEI_DAEMON_TOKEN: options.token,
    SLEI_DATA_ROOT: options.dataRoot,
  };
}

function createDefaultHealth(client: ReturnType<typeof createDaemonHttpClient>): () => Promise<DaemonHealth> {
  return () => client.request<DaemonHealth>("GET", "/health");
}

function createDefaultAuthCheck(client: ReturnType<typeof createDaemonHttpClient>): () => Promise<unknown> {
  return () => client.request("GET", "/v1/nodes");
}

function assertCompatibleHealth(health: DaemonHealth): void {
  if (
    health.status !== "ok" ||
    typeof health.daemon_version !== "string" ||
    health.daemon_version.length === 0 ||
    health.protocol_version !== EXPECTED_PROTOCOL_VERSION
  ) {
    throw new DesktopDaemonError("daemon_unavailable", "Slei daemon health response is incompatible");
  }
}

async function runBeforeDeadline<T>(
  operation: () => Promise<T>,
  options: {
    deadline: number;
    message: string;
    now: () => number;
    sleep: (ms: number) => Promise<void>;
  },
): Promise<T> {
  const remainingMs = options.deadline - options.now();
  if (remainingMs <= 0) {
    throw new DesktopDaemonError("daemon_unavailable", options.message);
  }

  return Promise.race([
    operation(),
    options.sleep(remainingMs).then(() => {
      throw new DesktopDaemonError("daemon_unavailable", options.message);
    }),
  ]);
}

function waitForSpawnError(childProcess: ChildProcess): Promise<never> {
  return new Promise((_, reject) => {
    childProcess.once("error", (error) => {
      reject(
        new DesktopDaemonError("daemon_unavailable", "Slei daemon process failed to start", {
          cause: error,
        }),
      );
    });
  });
}

function defaultRepoRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
}

function defaultResourcesPath(): string {
  return (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath ?? defaultRepoRoot();
}

function generateDaemonToken(): string {
  return randomUUID();
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function isDesktopDaemonError(error: unknown, code?: string): error is DesktopDaemonError {
  return error instanceof DesktopDaemonError && (code === undefined || error.code === code);
}

function isFatalValidationError(error: unknown): error is DesktopDaemonError {
  return (
    isDesktopDaemonError(error, "daemon_auth_failed") ||
    (isDesktopDaemonError(error, "daemon_unavailable") &&
      (error.message.includes("incompatible") || error.message.startsWith("Timed out ")))
  );
}

function normalizeExistingDaemonError(error: unknown): DesktopDaemonError {
  if (isDesktopDaemonError(error, "daemon_auth_failed")) {
    return error;
  }

  if (isDesktopDaemonError(error)) {
    return new DesktopDaemonError("daemon_unavailable", "Existing Slei daemon is unavailable or incompatible", {
      status: error.status,
      cause: error,
    });
  }

  return new DesktopDaemonError("daemon_unavailable", "Existing Slei daemon is unavailable or incompatible", {
    cause: error,
  });
}

function prependPath(entry: string, currentPath: string | undefined): string {
  return currentPath ? `${entry}${delimiter}${currentPath}` : entry;
}

function prependPathEntries(entries: string[], currentPath: string | undefined): string {
  return [...entries, currentPath].filter((entry): entry is string => Boolean(entry)).join(delimiter);
}
