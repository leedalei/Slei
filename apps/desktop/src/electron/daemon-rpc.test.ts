import { describe, expect, it, vi } from "vitest";
import { createDaemonRpcHandler } from "./daemon-rpc.js";

describe("daemon rpc handler", () => {
  it("maps daemon.status to /health and sanitizes status output", async () => {
    const request = vi.fn().mockResolvedValue({
      daemon_version: "0.1.0",
      protocol_version: "2026-05-27",
      status: "ok",
    });
    const rpc = createDaemonRpcHandler({ request } as never);

    await expect(rpc.call("daemon.status", {})).resolves.toEqual({
      connected: true,
      label: "connected",
      daemonVersion: "0.1.0",
      protocolVersion: "2026-05-27",
    });
    expect(request).toHaveBeenCalledWith("GET", "/health");
  });

  it("maps channel message send to the daemon route", async () => {
    const request = vi.fn().mockResolvedValue({ message: { id: "msg_1" }, outcome: { action: "broadcast_delivered" } });
    const rpc = createDaemonRpcHandler({ request } as never);

    await rpc.call("channels.messages.send", {
      channelId: "all",
      request: { authorId: "human:local", body: "hello" },
    });

    expect(request).toHaveBeenCalledWith("POST", "/v1/channels/all/messages", {
      authorId: "human:local",
      body: "hello",
    });
  });
});
