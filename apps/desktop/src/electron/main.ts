import { app, BrowserWindow, ipcMain, nativeImage, protocol } from "electron";
import type { WebContents } from "electron";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DAEMON_ENDPOINT, DESKTOP_DAEMON_TOKEN, VITE_DEV_URL } from "./constants.js";
import { DesktopDaemonError, createDaemonHttpClient } from "./daemon-http.js";
import type { DaemonHandle } from "./daemon-lifecycle.js";
import { ensureDaemon, stopOwnedDaemon } from "./daemon-lifecycle.js";
import type { DaemonRpcHandler } from "./daemon-rpc.js";
import { createDaemonRpcHandler } from "./daemon-rpc.js";
import type { EventReconnectReceipt, SanitizedDaemonStatus } from "../lib/daemon-types.js";
import type { EventForwarder } from "./event-forwarder.js";
import { createEventForwarder } from "./event-forwarder.js";
import { defaultAvatarDataRoot, profileAvatarProtocolResponse } from "./avatar-protocol.js";
import { resolveRendererEntry } from "./renderer-entry.js";
import { createWindowVisualOptions } from "./window-options.js";

export type MainDaemonState =
  | { state: "starting" }
  | { state: "connected"; owned: boolean }
  | { state: "offline"; code: "daemon_unavailable" | "daemon_auth_failed" | "daemon_start_timeout" };

type RpcEnvelope = {
  method?: unknown;
  payload?: unknown;
};
type OfflineDaemonCode = Extract<MainDaemonState, { state: "offline" }>["code"];
type DaemonEventSubscription = {
  sender: WebContents;
  destroyedHandler: () => void;
};
export type RendererRpcResult =
  | { ok: true; value: unknown }
  | { ok: false; error: { name: string; code: string; message: string } };

let currentDaemonState: MainDaemonState = { state: "starting" };
let daemonHandle: DaemonHandle | undefined;
let activeRpcHandler: DaemonRpcHandler | undefined;
let activeDaemonEndpoint = DAEMON_ENDPOINT;
let activeDaemonToken = DESKTOP_DAEMON_TOKEN;
let ipcRegistered = false;
let daemonEventForwarder: EventForwarder | undefined;
const daemonEventSubscriptions = new Map<string, DaemonEventSubscription>();

const electronDirname = dirname(fileURLToPath(import.meta.url));

export function configureAppIdentity(): void {
  app.setName("Slei");

  if (process.platform !== "darwin" || app.isPackaged) {
    return;
  }

  const dockIconPath = join(electronDirname, "..", "..", "build", "icon.icns");
  if (existsSync(dockIconPath)) {
    app.dock?.setIcon(nativeImage.createFromPath(dockIconPath));
  }
}

export function createMainWindow(): BrowserWindow {
  configureAppIdentity();

  const window = new BrowserWindow({
    ...createWindowVisualOptions({
      platform: process.platform,
    }),
    title: "",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: join(electronDirname, "preload.cjs"),
    },
  });

  const rendererEntry = resolveRendererEntry({
    isPackaged: app.isPackaged,
    devUrl: VITE_DEV_URL,
    appPath: app.getAppPath(),
  });

  if (rendererEntry.kind === "url") {
    void window.loadURL(rendererEntry.value);
  } else {
    void window.loadFile(rendererEntry.value);
  }

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
  protocol.handle("slei-avatar", (request) =>
    profileAvatarProtocolResponse(resolveElectronAvatarDataRoot(), request.url),
  );
}

function resolveElectronAvatarDataRoot(): string {
  return app.isPackaged ? join(app.getPath("userData"), "data") : defaultAvatarDataRoot();
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
      return;
    }

    if (subscription?.channel === "daemon.events") {
      addDaemonEventSubscription(subscription.subscriptionId, event.sender);
    }
  });

  ipcMain.on("slei:events:unsubscribe", (_event, payload: unknown) => {
    const subscriptionId = readUnsubscribePayload(payload);
    if (subscriptionId) {
      removeDaemonEventSubscription(subscriptionId);
    }
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
  const startupDaemonToken = app.isPackaged ? randomUUID() : DESKTOP_DAEMON_TOKEN;
  activeDaemonToken = startupDaemonToken;

  try {
    daemonHandle = await ensureDaemon({
      arch: process.arch,
      generateToken: () => startupDaemonToken,
      isPackaged: app.isPackaged,
      platform: process.platform,
      resourcesPath: (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath ?? app.getAppPath(),
      userDataPath: app.getPath("userData"),
    });
    activeDaemonEndpoint = daemonHandle.endpoint;
    activeDaemonToken = daemonHandle.token;
    activeRpcHandler = createDaemonRpcHandler(
      createDaemonHttpClient({
        endpoint: daemonHandle.endpoint,
        token: daemonHandle.token,
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
  teardownDaemonEventSubscriptions();
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

function addDaemonEventSubscription(subscriptionId: string, sender: WebContents): void {
  if (sender.isDestroyed()) {
    return;
  }

  removeDaemonEventSubscription(subscriptionId);
  const destroyedHandler = () => removeDaemonEventSubscription(subscriptionId);
  sender.once("destroyed", destroyedHandler);
  daemonEventSubscriptions.set(subscriptionId, { sender, destroyedHandler });
  ensureDaemonEventForwarder().start();
}

function removeDaemonEventSubscription(subscriptionId: string): void {
  const subscription = daemonEventSubscriptions.get(subscriptionId);
  if (!subscription) {
    return;
  }

  daemonEventSubscriptions.delete(subscriptionId);
  if (!subscription.sender.isDestroyed()) {
    subscription.sender.off("destroyed", subscription.destroyedHandler);
  }
  if (daemonEventSubscriptions.size === 0) {
    stopDaemonEventForwarder();
  }
}

function stopDaemonEventForwarder(): void {
  daemonEventForwarder?.stop();
}

function teardownDaemonEventSubscriptions(): void {
  daemonEventForwarder?.unsubscribe();
  daemonEventForwarder = undefined;
  for (const subscription of daemonEventSubscriptions.values()) {
    if (!subscription.sender.isDestroyed()) {
      subscription.sender.off("destroyed", subscription.destroyedHandler);
    }
  }
  daemonEventSubscriptions.clear();
}

function ensureDaemonEventForwarder(): EventForwarder {
  daemonEventForwarder ??= createEventForwarder({
    reconnect: reconnectDaemonEvents,
    emit: emitDaemonEventBatch,
  });
  return daemonEventForwarder;
}

async function reconnectDaemonEvents(after: number): Promise<EventReconnectReceipt> {
  if (currentDaemonState.state !== "connected" || !activeRpcHandler) {
    throw daemonUnavailableError(currentDaemonState);
  }

  return activeRpcHandler.call("events.reconnect", { after });
}

function emitDaemonEventBatch(batch: EventReconnectReceipt): void {
  for (const [subscriptionId, subscription] of daemonEventSubscriptions) {
    if (subscription.sender.isDestroyed()) {
      removeDaemonEventSubscription(subscriptionId);
      continue;
    }

    try {
      subscription.sender.send("slei:daemon-events", batch);
    } catch {
      removeDaemonEventSubscription(subscriptionId);
    }
  }
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
  return sanitizeSensitiveDaemonText(message).slice(0, 1000);
}

function sanitizeIpcErrorMessage(message: string): string {
  return sanitizeSensitiveDaemonText(message).slice(0, 1000);
}

function sanitizeSensitiveDaemonText(message: string): string {
  let sanitized = message;
  for (const token of new Set([DESKTOP_DAEMON_TOKEN, activeDaemonToken])) {
    if (token.length > 0) {
      sanitized = sanitized.replaceAll(token, "[redacted]");
    }
  }
  for (const endpoint of new Set([DAEMON_ENDPOINT, activeDaemonEndpoint])) {
    if (endpoint.length > 0) {
      sanitized = sanitized.replaceAll(endpoint, "[daemon-endpoint]");
    }
  }
  return sanitized;
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

function readUnsubscribePayload(payload: unknown): string | undefined {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return undefined;
  }

  const subscriptionId = (payload as Record<string, unknown>).subscriptionId;
  return typeof subscriptionId === "string" ? subscriptionId : undefined;
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
