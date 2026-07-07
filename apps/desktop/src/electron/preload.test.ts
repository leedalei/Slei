import { describe, expect, it, vi } from "vitest";
import { createSleiPreloadApi } from "./preload";

vi.mock("electron", () => ({
  contextBridge: {
    exposeInMainWorld: vi.fn(),
  },
  ipcRenderer: {
    invoke: vi.fn(),
    off: vi.fn(),
    on: vi.fn(),
    send: vi.fn(),
  },
}));

describe("electron preload api", () => {
  it("exposes only narrow rpc and events APIs", async () => {
    const invoke = vi.fn().mockResolvedValue({ connected: true });
    const on = vi.fn();
    const send = vi.fn();
    const off = vi.fn();

    const api = createSleiPreloadApi({ invoke, on, send, off }, { createSubscriptionId: () => "sub_1" });

    expect(Object.keys(api).sort()).toEqual(["events", "rpc"]);
    expect(Object.keys(api.rpc)).toEqual(["call"]);
    expect(Object.keys(api.events).sort()).toEqual(["subscribe"]);
    expect(JSON.stringify(api)).not.toContain("desktop-session-token");
    expect(JSON.stringify(api)).not.toContain("127.0.0.1");
  });

  it("maps daemon state subscriptions to the daemon-state IPC event", () => {
    const invoke = vi.fn();
    const on = vi.fn();
    const send = vi.fn();
    const off = vi.fn();
    const handler = vi.fn();

    const api = createSleiPreloadApi({ invoke, on, send, off }, { createSubscriptionId: () => "sub_state" });
    const cleanup = api.events.subscribe("daemon.state", handler);

    expect(on).toHaveBeenCalledWith("slei:daemon-state", expect.any(Function));
    expect(send).toHaveBeenCalledWith("slei:events:subscribe", { channel: "daemon.state", subscriptionId: "sub_state" });
    cleanup();
    expect(off).toHaveBeenCalledWith("slei:daemon-state", expect.any(Function));
  });

  it("rehydrates structured daemon errors from rpc envelopes", async () => {
    const invoke = vi.fn().mockResolvedValue({
      ok: false,
      error: {
        name: "DesktopDaemonError",
        code: "daemon_auth_failed",
        message: "Slei daemon is offline: daemon_auth_failed",
      },
    });
    const on = vi.fn();
    const send = vi.fn();
    const off = vi.fn();

    const api = createSleiPreloadApi({ invoke, on, send, off }, { createSubscriptionId: () => "sub_1" });

    await expect(api.rpc.call("channels.list", {})).rejects.toMatchObject({
      name: "DesktopDaemonError",
      code: "daemon_auth_failed",
      message: "Slei daemon is offline: daemon_auth_failed",
    });
  });
});
