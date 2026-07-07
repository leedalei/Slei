import { describe, expect, it, vi } from "vitest";
import {
  createRpcFailureEnvelope,
  handleRendererRpcForIpc,
  registerIpcHandlers,
  registerElectronProtocolHandlers,
  registerElectronProtocolSchemes,
  stopDaemonBridge,
} from "./main";
import { DesktopDaemonError } from "./daemon-http";

const electronMock = vi.hoisted(() => ({
  createEventForwarder: vi.fn(),
  handle: vi.fn(),
  ipcHandle: vi.fn(),
  ipcOn: vi.fn(),
  registerSchemesAsPrivileged: vi.fn(),
}));

vi.mock("./event-forwarder", () => ({
  createEventForwarder: electronMock.createEventForwarder,
}));

vi.mock("electron", () => ({
  app: {
    on: vi.fn(),
    whenReady: vi.fn(() => new Promise(() => undefined)),
  },
  BrowserWindow: {
    getAllWindows: vi.fn(() => []),
  },
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
