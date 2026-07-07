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

  it("logs frontend events locally without calling daemon routes", async () => {
    const request = vi.fn();
    const logger = vi.fn();
    const rpc = createDaemonRpcHandler({ request } as never, { logger });

    await expect(
      rpc.call("frontend.event.log", {
        report: {
          scope: "events",
          message: "listen-failed",
          context: { reason: "offline" },
        },
      }),
    ).resolves.toBeUndefined();

    expect(request).not.toHaveBeenCalled();
    expect(logger).toHaveBeenCalledWith('[slei-frontend] scope=events message=listen-failed context={"reason":"offline"}');
    expect(logger.mock.calls[0]?.[0]).not.toContain("/v1/diagnostics");
  });

  it("logs frontend crashes locally without calling daemon routes", async () => {
    const request = vi.fn();
    const logger = vi.fn();
    const rpc = createDaemonRpcHandler({ request } as never, { logger });

    await expect(
      rpc.call("frontend.crash.log", {
        report: {
          kind: "react",
          message: "render failed",
          stack: "Error: render failed",
          componentStack: "at SleiApp",
          url: "http://127.0.0.1:1420/",
        },
      }),
    ).resolves.toBeUndefined();

    expect(request).not.toHaveBeenCalled();
    expect(logger).toHaveBeenCalledOnce();
    const output = logger.mock.calls[0]?.[0] as string;
    expect(output).toContain("[slei-frontend-crash]");
    expect(output).toContain("kind=react");
    expect(output).toContain("url=http://127.0.0.1:1420/");
    expect(output).toContain("message=render failed");
    expect(output).toContain("stack=Error: render failed");
    expect(output).toContain("component_stack=at SleiApp");
    expect(output).not.toContain("/v1/diagnostics");
  });

  it("maps event reconnect to the daemon replay route", async () => {
    const event = {
      sequence: 43,
      eventType: "task_thread.updated",
      occurredAtUnixMs: 1,
      payload: { taskId: "task_1" },
    };
    const request = vi.fn().mockResolvedValue({ events: [event] });
    const rpc = createDaemonRpcHandler({ request } as never);

    await expect(rpc.call("events.reconnect", { after: 42 })).resolves.toEqual({
      after: 42,
      events: [event],
    });
    expect(request).toHaveBeenCalledWith("GET", "/v1/events/ws?after=42");
  });
});
