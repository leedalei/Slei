import { app, BrowserWindow, ipcMain, protocol } from "electron";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DAEMON_ENDPOINT, DESKTOP_DAEMON_TOKEN, VITE_DEV_URL } from "./constants.js";
import { DesktopDaemonError, createDaemonHttpClient } from "./daemon-http.js";
import type { DaemonHandle } from "./daemon-lifecycle.js";
import { ensureDaemon, stopOwnedDaemon } from "./daemon-lifecycle.js";
import type { DaemonRpcHandler } from "./daemon-rpc.js";
import { createDaemonRpcHandler } from "./daemon-rpc.js";
import type { SanitizedDaemonStatus } from "../lib/daemon-types.js";

export type MainDaemonState =
  | { state: "starting" }
  | { state: "connected"; owned: boolean }
  | { state: "offline"; code: "daemon_unavailable" | "daemon_auth_failed" | "daemon_start_timeout" };

type RpcEnvelope = {
  method?: unknown;
  payload?: unknown;
};
type OfflineDaemonCode = Extract<MainDaemonState, { state: "offline" }>["code"];
export type RendererRpcResult =
  | { ok: true; value: unknown }
  | { ok: false; error: { name: string; code: string; message: string } };

let currentDaemonState: MainDaemonState = { state: "starting" };
let daemonHandle: DaemonHandle | undefined;
let activeRpcHandler: DaemonRpcHandler | undefined;
let ipcRegistered = false;

const electronDirname = dirname(fileURLToPath(import.meta.url));

export function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    title: "",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: join(electronDirname, "preload.cjs"),
    },
  });

  void window.loadURL(VITE_DEV_URL);
  return window;
}

export function registerElectronProtocolSchemes(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: "slei-avatar",
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
      },
    },
  ]);
}

export function registerElectronProtocolHandlers(): void {
  protocol.handle("slei-avatar", () => new Response(null, { status: 404 }));
}

export function registerIpcHandlers(): void {
  if (ipcRegistered) {
    return;
  }
  ipcRegistered = true;

  ipcMain.handle("slei:rpc", (_event, envelope: RpcEnvelope) => handleRendererRpcForIpc(envelope));

  ipcMain.on("slei:events:subscribe", (event, payload: unknown) => {
    const subscription = readSubscriptionPayload(payload);
    if (subscription?.channel === "daemon.state") {
      event.sender.send("slei:daemon-state", currentDaemonState);
    }
  });

  ipcMain.on("slei:events:unsubscribe", () => {
    // Event forwarder subscriptions are wired in a later task.
  });
}

export async function handleRendererRpcForIpc(envelope: RpcEnvelope): Promise<RendererRpcResult> {
  try {
    return { ok: true, value: await handleRendererRpc(envelope) };
  } catch (error) {
    return createRpcFailureEnvelope(error);
  }
}

export function createRpcFailureEnvelope(error: unknown): Extract<RendererRpcResult, { ok: false }> {
  if (error instanceof DesktopDaemonError) {
    return {
      ok: false,
      error: {
        name: error.name,
        code: error.code,
        message: sanitizeIpcErrorMessage(error.message),
      },
    };
  }

  const message = error instanceof Error ? error.message : String(error);
  return {
    ok: false,
    error: {
      name: "DesktopDaemonError",
      code: "daemon_unavailable",
      message: sanitizeIpcErrorMessage(message),
    },
  };
}

export async function startDaemonBridge(): Promise<void> {
  setDaemonState({ state: "starting" });

  try {
    daemonHandle = await ensureDaemon();
    activeRpcHandler = createDaemonRpcHandler(
      createDaemonHttpClient({
        endpoint: DAEMON_ENDPOINT,
        token: DESKTOP_DAEMON_TOKEN,
      }),
    );
    setDaemonState({ state: "connected", owned: daemonHandle.owned });
  } catch (error) {
    const offlineState = daemonOfflineStateFromError(error);
    logDaemonStartupFailure(error, offlineState.code);
    setDaemonState(offlineState);
  }
}

export function stopDaemonBridge(): void {
  if (daemonHandle) {
    stopOwnedDaemon(daemonHandle);
  }
}

async function handleRendererRpc(envelope: RpcEnvelope): Promise<unknown> {
  const method = readRpcMethod(envelope);

  if (method === "daemon.status" && currentDaemonState.state !== "connected") {
    return disconnectedDaemonStatus(currentDaemonState);
  }

  if (currentDaemonState.state !== "connected" || !activeRpcHandler) {
    throw daemonUnavailableError(currentDaemonState);
  }

  return activeRpcHandler.call(method, envelope.payload);
}

function setDaemonState(state: MainDaemonState): void {
  currentDaemonState = state;
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.webContents.isDestroyed()) {
      window.webContents.send("slei:daemon-state", state);
    }
  }
}

function disconnectedDaemonStatus(state: MainDaemonState): SanitizedDaemonStatus {
  return {
    connected: false,
    label: state.state === "offline" ? state.code : state.state,
    daemonVersion: "",
    protocolVersion: "",
  };
}

function daemonUnavailableError(state: MainDaemonState): DesktopDaemonError {
  if (state.state === "offline") {
    return new DesktopDaemonError(state.code, `Slei daemon is offline: ${state.code}`);
  }

  return new DesktopDaemonError("daemon_unavailable", "Slei daemon is starting");
}

function daemonOfflineStateFromError(error: unknown): Extract<MainDaemonState, { state: "offline" }> {
  if (error instanceof DesktopDaemonError) {
    if (error.code === "daemon_auth_failed") {
      return { state: "offline", code: "daemon_auth_failed" };
    }
    if (error.message.toLowerCase().includes("timed out")) {
      return { state: "offline", code: "daemon_start_timeout" };
    }
  }

  return { state: "offline", code: "daemon_unavailable" };
}

function logDaemonStartupFailure(error: unknown, code: OfflineDaemonCode): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[slei-electron] daemon startup failed: code=${code} message=${sanitizeLogMessage(message)}`);
}

function sanitizeLogMessage(message: string): string {
  return message.replaceAll(DESKTOP_DAEMON_TOKEN, "[redacted]").slice(0, 1000);
}

function sanitizeIpcErrorMessage(message: string): string {
  return message
    .replaceAll(DESKTOP_DAEMON_TOKEN, "[redacted]")
    .replaceAll(DAEMON_ENDPOINT, "[daemon-endpoint]")
    .slice(0, 1000);
}

function readRpcMethod(envelope: RpcEnvelope): string {
  if (!envelope || typeof envelope.method !== "string" || envelope.method.length === 0) {
    throw new DesktopDaemonError("invalid_rpc_payload", "Invalid desktop RPC envelope");
  }
  return envelope.method;
}

function readSubscriptionPayload(payload: unknown): { channel: string; subscriptionId: string } | undefined {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return undefined;
  }

  const channel = (payload as Record<string, unknown>).channel;
  const subscriptionId = (payload as Record<string, unknown>).subscriptionId;
  if (typeof channel !== "string" || typeof subscriptionId !== "string") {
    return undefined;
  }

  return { channel, subscriptionId };
}

registerElectronProtocolSchemes();

void app.whenReady().then(() => {
  registerIpcHandlers();
  registerElectronProtocolHandlers();
  createMainWindow();
  void startDaemonBridge();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  stopDaemonBridge();
});
