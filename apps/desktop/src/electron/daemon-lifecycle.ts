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

type LifecycleDependencies = {
  endpoint?: string;
  health?: () => Promise<DaemonHealth>;
  host?: string;
  now?: () => number;
  port?: number;
  probePort?: (host: string, port: number) => Promise<boolean>;
  repoRoot?: string;
  sleep?: (ms: number) => Promise<void>;
  spawn?: SpawnDaemon;
  timeoutMs?: number;
};

type WaitForDaemonReadyOptions = {
  health: () => Promise<DaemonHealth>;
  host?: string;
  now?: () => number;
  port?: number;
  probePort?: (host: string, port: number) => Promise<boolean>;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
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

  while (now() <= deadline) {
    try {
      if (await checkPort(host, port)) {
        const health = await options.health();
        assertCompatibleHealth(health);
        return health;
      }
    } catch (error) {
      if (isDesktopDaemonError(error, "daemon_auth_failed")) {
        throw error;
      }
      lastError = error;
    }

    await sleep(100);
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
  const health = dependencies.health ?? createDefaultHealth(endpoint);

  if (await checkPort(host, port)) {
    try {
      const response = await health();
      assertCompatibleHealth(response);
      return { owned: false };
    } catch (error) {
      throw normalizeExistingDaemonError(error);
    }
  }

  const repoRoot = dependencies.repoRoot ?? defaultRepoRoot();
  const spawnDaemon = dependencies.spawn ?? nodeSpawn;
  const daemonProcess = spawnDaemon("cargo", ["run", "-p", "slei-daemon"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      PATH: prependPath(resolve(repoRoot, "target/debug"), process.env.PATH),
      SLEI_DAEMON_TOKEN: DESKTOP_DAEMON_TOKEN,
      SLEI_DAEMON_URL: endpoint,
    },
    stdio: "inherit",
  });

  try {
    await waitForDaemonReady({
      health,
      host,
      now: dependencies.now,
      port,
      probePort: checkPort,
      sleep: dependencies.sleep,
      timeoutMs: dependencies.timeoutMs,
    });
  } catch (error) {
    daemonProcess.kill("SIGTERM");
    throw error;
  }

  return { owned: true, process: daemonProcess };
}

export function stopOwnedDaemon(handle: DaemonHandle): void {
  if (!handle.owned) {
    return;
  }

  handle.process.kill("SIGTERM");
}

function createDefaultHealth(endpoint: string): () => Promise<DaemonHealth> {
  const client = createDaemonHttpClient({ endpoint, token: DESKTOP_DAEMON_TOKEN });
  return () => client.request<DaemonHealth>("GET", "/health");
}

function assertCompatibleHealth(health: DaemonHealth): void {
  if (
    health.status !== "ok" ||
    typeof health.daemon_version !== "string" ||
    health.daemon_version.length === 0 ||
    typeof health.protocol_version !== "string" ||
    health.protocol_version.length === 0
  ) {
    throw new DesktopDaemonError("daemon_unavailable", "Slei daemon health response is incompatible");
  }
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
