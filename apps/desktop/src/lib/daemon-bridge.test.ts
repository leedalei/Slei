import { afterEach, describe, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

import { createDaemonBridge } from "./daemon-bridge";
import type { ChannelMessageView, DesktopAgentView } from "./daemon-bridge";
import { createDaemonBridgeMock } from "../test/daemon-bridge-mock";

describe("createDaemonBridge non-Tauri fallback", () => {
  afterEach(() => {
    invokeMock.mockReset();
    Reflect.deleteProperty(globalThis as Record<string, unknown>, "window");
  });

  it("returns offline empty receipts instead of product mock data", async () => {
    const bridge = createDaemonBridge();

    await expect(bridge.daemonStatus()).resolves.toMatchObject({
      connected: false,
      label: "offline",
    });
    await expect(bridge.listAgents()).resolves.toEqual({ agents: [] });
    await expect(bridge.listTasks()).resolves.toEqual({ tasks: [] });
    await expect(bridge.listNodes()).resolves.toEqual({ nodes: [] });
    await expect(bridge.listChannels()).resolves.toEqual({ channels: [] });
    await expect(bridge.listAgentActivity("agent_alice")).resolves.toEqual({ logs: [] });
    await expect(bridge.globalSearch({ q: "needle" })).resolves.toEqual({
      query: "needle",
      totals: { agents: 0, channels: 0, messages: 0 },
      agents: [],
      channels: [],
      messages: [],
    });
  });

  it("rejects mutations and workspace access while offline", async () => {
    const bridge = createDaemonBridge();

    await expect(
      bridge.createAgent({
        name: "Alice",
        handle: "@alice",
        runtimeKind: "ClaudeCode",
        model: "Sonnet",
        nodeId: "local-node",
        description: "Developer",
      }),
    ).rejects.toThrow("daemon offline");
    await expect(bridge.sendChannelMessage("all", { authorId: "human:local", body: "hello", asTask: false })).rejects.toThrow("daemon offline");
    await expect(bridge.listAgentWorkspace("agent_alice")).rejects.toThrow("daemon offline");
  });

  it("invokes list agent activity with the expected command shape", async () => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { __TAURI_INTERNALS__: {} },
    });
    invokeMock.mockResolvedValueOnce({ logs: [] });

    const bridge = createDaemonBridge();
    await expect(bridge.listAgentActivity("agent_coda")).resolves.toEqual({ logs: [] });

    expect(invokeMock).toHaveBeenCalledWith("list_agent_activity_command", {
      agentId: "agent_coda",
      limit: 200,
    });
  });

  it("invokes global search with the expected command shape", async () => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { __TAURI_INTERNALS__: {} },
    });
    invokeMock.mockResolvedValueOnce({
      query: "needle",
      totals: { agents: 0, channels: 0, messages: 0 },
      agents: [],
      channels: [],
      messages: [],
    });

    const bridge = createDaemonBridge();
    await expect(
      bridge.globalSearch({
        q: "needle",
        fromId: "msg_42",
        channelId: "dev-team",
        timeRange: "today",
        timeZone: "UTC",
      }),
    ).resolves.toMatchObject({ query: "needle" });

    expect(invokeMock).toHaveBeenCalledWith("global_search_command", {
      query: {
        q: "needle",
        fromId: "msg_42",
        channelId: "dev-team",
        timeRange: "today",
        timeZone: "UTC",
      },
    });
  });
});

describe("createDaemonBridgeMock global search", () => {
  it("treats fromId as the author id filter instead of message ordering", async () => {
    const bridge = createDaemonBridgeMock({
      connected: true,
      agents: [
        testAgent("agent_coda", "Coda", "@coda"),
        testAgent("agent_ada", "Ada", "@ada"),
      ],
      channels: [{ id: "dev", name: "dev", description: "Development", isDefault: false, activeSessionId: "session:dev", projectPaths: [] }],
      channelMessages: [
        testChannelMessage("msg_999", "agent_ada", "needle from Ada"),
        testChannelMessage("msg_001", "agent_coda", "needle from Coda"),
      ],
    });

    const receipt = await bridge.globalSearch({
      q: "needle",
      fromId: "agent_coda",
      includeAgents: false,
      includeChannels: false,
    });

    expect(receipt.messages.map((message) => message.messageId)).toEqual(["msg_001"]);
    expect(receipt.messages[0].authorId).toBe("agent_coda");
  });
});

function testAgent(id: string, name: string, handle: string): DesktopAgentView {
  return {
    id,
    name,
    handle,
    agentKind: "agent",
    systemOwned: false,
    runtimeKind: "ClaudeCode",
    model: "Sonnet",
    nodeId: "local-node",
    description: `${name} works on product flows.`,
    workspacePath: `~/.slei/agents/${id}`,
    memoryPath: `~/.slei/agents/${id}/MEMORY.md`,
    docsPath: `~/.slei/agents/${id}/docs`,
    avatarSeed: id,
    runtimeThread: { runtimeKind: "ClaudeCode", status: "ready", createdAt: "2026-06-17T08:00:00.000Z" },
    skills: [],
    channelIds: ["dev"],
    createdAt: "2026-06-17T08:00:00.000Z",
    updatedAt: "2026-06-17T08:00:00.000Z",
  };
}

function testChannelMessage(id: string, authorId: string, body: string): ChannelMessageView {
  return {
    id,
    channelId: "dev",
    sessionId: "session:dev",
    authorId,
    body,
    cards: [],
    kind: authorId.startsWith("agent_") ? "agent" : "human",
    deleted: false,
    edited: false,
    createdAt: id,
  };
}
