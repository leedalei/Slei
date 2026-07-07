import { describe, expect, it, vi } from "vitest";
import {
  createRpcFailureEnvelope,
  handleRendererRpcForIpc,
  registerElectronProtocolHandlers,
  registerElectronProtocolSchemes,
} from "./main";
import { DesktopDaemonError } from "./daemon-http";

const electronMock = vi.hoisted(() => ({
  handle: vi.fn(),
  registerSchemesAsPrivileged: vi.fn(),
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
    handle: vi.fn(),
    on: vi.fn(),
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
});
