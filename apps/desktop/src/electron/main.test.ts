import { join } from "node:path";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { app } from "electron";
import { describe, expect, it, vi } from "vitest";
import {
  createMainWindow,
  createRpcFailureEnvelope,
  handleRendererRpcForIpc,
  registerIpcHandlers,
  registerElectronProtocolHandlers,
  registerElectronProtocolSchemes,
  startDaemonBridge,
  stopDaemonBridge,
} from "./main";
import { DesktopDaemonError } from "./daemon-http";

const electronMock = vi.hoisted(() => ({
  appGetAppPath: vi.fn(() => "/Applications/Slei.app/Contents/Resources/app.asar"),
  appGetPath: vi.fn(() => "/Users/leelei/Library/Application Support/Slei"),
  browserWindowInstances: [] as Array<{
    loadFile: ReturnType<typeof vi.fn>;
    loadURL: ReturnType<typeof vi.fn>;
    options: Record<string, unknown>;
  }>,
  browserWindowGetAllWindows: vi.fn(() => []),
  BrowserWindow: vi.fn((options: Record<string, unknown>) => {
    const window = {
      loadFile: vi.fn(),
      loadURL: vi.fn(),
      options,
    };
    electronMock.browserWindowInstances.push(window);
    return window;
  }),
  createEventForwarder: vi.fn(),
  handle: vi.fn(),
  ipcHandle: vi.fn(),
  ipcOn: vi.fn(),
  registerSchemesAsPrivileged: vi.fn(),
}));

const cryptoMock = vi.hoisted(() => ({
  randomUUID: vi.fn(() => "generated-packaged-token"),
}));

const lifecycleMock = vi.hoisted(() => ({
  ensureDaemon: vi.fn(),
  stopOwnedDaemon: vi.fn(),
}));

vi.mock("./event-forwarder", () => ({
  createEventForwarder: electronMock.createEventForwarder,
}));

vi.mock("./daemon-lifecycle", () => ({
  ensureDaemon: lifecycleMock.ensureDaemon,
  stopOwnedDaemon: lifecycleMock.stopOwnedDaemon,
}));

vi.mock("node:crypto", () => ({
  randomUUID: cryptoMock.randomUUID,
}));

vi.mock("electron", () => ({
  app: {
    getAppPath: electronMock.appGetAppPath,
    getPath: electronMock.appGetPath,
    isPackaged: false,
    on: vi.fn(),
    whenReady: vi.fn(() => new Promise(() => undefined)),
  },
  BrowserWindow: Object.assign(electronMock.BrowserWindow, {
    getAllWindows: electronMock.browserWindowGetAllWindows,
  }),
  ipcMain: {
    handle: electronMock.ipcHandle,
    on: electronMock.ipcOn,
  },
  protocol: {
    handle: electronMock.handle,
    registerSchemesAsPrivileged: electronMock.registerSchemesAsPrivileged,
  },
}));

describe("electron main bootstrap helpers", () => {
  it("redacts the generated packaged daemon token when startup fails before connection", async () => {
    (app as unknown as { isPackaged: boolean }).isPackaged = true;
    lifecycleMock.ensureDaemon.mockRejectedValueOnce(
      new DesktopDaemonError("daemon_unavailable", "spawn failed generated-packaged-token"),
    );
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await startDaemonBridge();

    expect(lifecycleMock.ensureDaemon).toHaveBeenCalledWith(expect.objectContaining({
      generateToken: expect.any(Function),
    }));
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining("[redacted]"));
    expect(consoleError.mock.calls[0][0]).not.toContain("generated-packaged-token");

    consoleError.mockRestore();
    (app as unknown as { isPackaged: boolean }).isPackaged = false;
  });

  it("loads the dev renderer URL without daemon query parameters", () => {
    (app as unknown as { isPackaged: boolean }).isPackaged = false;
    electronMock.browserWindowInstances.length = 0;

    createMainWindow();

    const window = electronMock.browserWindowInstances.at(-1);
    expect(window?.loadURL).toHaveBeenCalledWith("http://127.0.0.1:1420");
    expect(window?.loadURL.mock.calls[0][0]).not.toContain("desktop-session-token");
    expect(window?.loadURL.mock.calls[0][0]).not.toContain("4319");
    expect(window?.loadFile).not.toHaveBeenCalled();
  });

  it("loads the packaged renderer file and preserves secure BrowserWindow options", () => {
    const appPath = "/Applications/Slei.app/Contents/Resources/app.asar";
    (app as unknown as { isPackaged: boolean }).isPackaged = true;
    electronMock.appGetAppPath.mockReturnValue(appPath);
    electronMock.browserWindowInstances.length = 0;

    createMainWindow();

    const window = electronMock.browserWindowInstances.at(-1);
    expect(window?.loadFile).toHaveBeenCalledWith(join(appPath, "dist", "index.html"));
    expect(window?.loadURL).not.toHaveBeenCalled();
    expect(window?.options).toEqual(
      expect.objectContaining({
        width: 1280,
        height: 800,
        minWidth: 960,
        minHeight: 640,
        webPreferences: expect.objectContaining({
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          preload: expect.stringContaining("preload.cjs"),
        }),
      }),
    );
  });

  it("registers the slei-avatar protocol scheme and handler", async () => {
    registerElectronProtocolSchemes();
    registerElectronProtocolHandlers();

    expect(electronMock.registerSchemesAsPrivileged).toHaveBeenCalledWith([
      expect.objectContaining({
        scheme: "slei-avatar",
      }),
    ]);
    expect(electronMock.handle).toHaveBeenCalledWith("slei-avatar", expect.any(Function));
    const protocolHandler = electronMock.handle.mock.calls.find((call) => call[0] === "slei-avatar")?.[1];
    const response = await protocolHandler({ url: "slei-avatar:///avatar.png" });

    expect(response.status).toBe(404);
  });

  it("serves packaged avatars from Electron userData data root", async () => {
    const userDataPath = await mkdtemp(join(tmpdir(), "slei-packaged-avatar-user-data-"));
    const fileName = `${"a".repeat(64)}.png`;
    const avatarBytes = Buffer.from("\x89PNG\r\n\x1a\npackaged-avatar");
    await mkdir(join(userDataPath, "data", "profile", "avatars"), { recursive: true });
    await writeFile(join(userDataPath, "data", "profile", "avatars", fileName), avatarBytes);
    (app as unknown as { isPackaged: boolean }).isPackaged = true;
    electronMock.appGetPath.mockReturnValue("/Applications/Slei.app/Contents/Resources/app.asar");
    electronMock.appGetPath.mockImplementation((name?: string) =>
      name === "userData" ? userDataPath : "/Applications/Slei.app/Contents/Resources/app.asar",
    );
    electronMock.handle.mockClear();

    try {
      registerElectronProtocolHandlers();
      const protocolHandler = electronMock.handle.mock.calls.find((call) => call[0] === "slei-avatar")?.[1];
      const response = await protocolHandler({ url: `slei-avatar:///${fileName}` });

      expect(response.status).toBe(200);
      expect(Buffer.from(await response.arrayBuffer())).toEqual(avatarBytes);
    } finally {
      (app as unknown as { isPackaged: boolean }).isPackaged = false;
      electronMock.appGetPath.mockReset();
      electronMock.appGetPath.mockReturnValue("/Applications/Slei.app/Contents/Resources/app.asar");
      await rm(userDataPath, { recursive: true, force: true });
    }
  });

  it("serializes daemon errors with a stable code for renderer rehydration", () => {
    expect(createRpcFailureEnvelope(new DesktopDaemonError("daemon_unavailable", "Slei daemon is starting"))).toEqual({
      ok: false,
      error: {
        name: "DesktopDaemonError",
        code: "daemon_unavailable",
        message: "Slei daemon is starting",
      },
    });
  });

  it("wraps unavailable business rpc failures in structured daemon error envelopes", async () => {
    await expect(handleRendererRpcForIpc({ method: "channels.list", payload: {} })).resolves.toMatchObject({
      ok: false,
      error: {
        code: "daemon_unavailable",
      },
    });
  });

  it("clears daemon event subscriptions when the bridge stops", () => {
    const forwarder = {
      after: vi.fn(() => 0),
      start: vi.fn(),
      stop: vi.fn(),
      unsubscribe: vi.fn(),
      tick: vi.fn(),
    };
    electronMock.createEventForwarder.mockReturnValue(forwarder);
    const sender = {
      isDestroyed: vi.fn(() => false),
      off: vi.fn(),
      once: vi.fn(),
      send: vi.fn(),
    };

    registerIpcHandlers();
    const subscribeHandler = electronMock.ipcOn.mock.calls.find((call) => call[0] === "slei:events:subscribe")?.[1];
    expect(subscribeHandler).toBeTypeOf("function");
    subscribeHandler({ sender }, { channel: "daemon.events", subscriptionId: "sub_events" });

    stopDaemonBridge();
    const emitBatch = electronMock.createEventForwarder.mock.calls.at(-1)?.[0].emit;
    emitBatch({ after: 1, events: [{ sequence: 1, eventType: "task_thread.updated", occurredAtUnixMs: 1, payload: {} }] });

    expect(forwarder.unsubscribe).toHaveBeenCalled();
    expect(sender.off).toHaveBeenCalledWith("destroyed", sender.once.mock.calls[0][1]);
    expect(sender.send).not.toHaveBeenCalled();
  });
});
