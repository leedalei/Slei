import { describe, expect, it, vi } from "vitest";
import { createDesktopRpcClient, desktopRpcMethods } from "./desktop-rpc";

describe("desktop rpc contract", () => {
  it("lists V1 core method names", () => {
    expect(desktopRpcMethods).toEqual(
      expect.arrayContaining([
        "daemon.status",
        "diagnostics.list",
        "nodes.list",
        "channels.list",
        "channels.messages.list",
        "channels.messages.send",
        "tasks.list",
        "events.reconnect",
        "frontend.crash.log",
        "frontend.event.log",
      ]),
    );
  });

  it("calls the injected transport with method and payload", async () => {
    const call = vi.fn().mockResolvedValue({ channels: [] });
    const client = createDesktopRpcClient({ call });

    await expect(client.call("channels.list", {})).resolves.toEqual({ channels: [] });
    expect(call).toHaveBeenCalledWith("channels.list", {});
  });
});
