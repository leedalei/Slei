import { spawn as nodeSpawn, type ChildProcess } from "node:child_process";
import { dirname, delimiter, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import net from "node:net";
import {
  DAEMON_ENDPOINT,
  DAEMON_HOST,
  DAEMON_PORT,
  DAEMON_READY_TIMEOUT_MS,
  DESKTOP_DAEMON_TOKEN,
} from "./constants.js";
import { createDaemonHttpClient, DesktopDaemonError } from "./daemon-http.js";
import { defaultAvatarDataRoot } from "./avatar-protocol.js";

export const EXPECTED_PROTOCOL_VERSION = "v1";

export type DaemonHealth = {
  daemon_version: string;
  protocol_version: string;
  status: string;
};

export type DaemonHandle =
  | {
      owned: false;
    }
  | {
      owned: true;
      process: ChildProcess;
    };

type SpawnDaemon = typeof nodeSpawn;
type KillProcess = (pid: number, signal: NodeJS.Signals) => boolean | void;
type TerminateProcess = (process: ChildProcess) => void;

type LifecycleDependencies = {
  authCheck?: () => Promise<unknown>;
  endpoint?: string;
  health?: () => Promise<DaemonHealth>;
  host?: string;
  now?: () => number;
  port?: number;
  probePort?: (host: string, port: number) => Promise<boolean>;
  repoRoot?: string;
  dataRoot?: string;
  sleep?: (ms: number) => Promise<void>;
  spawn?: SpawnDaemon;
  terminateProcess?: TerminateProcess;
  timeoutMs?: number;
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
      return { owned: false };
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

  return { owned: true, process: daemonProcess };
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
