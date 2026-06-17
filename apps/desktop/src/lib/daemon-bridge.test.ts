import { afterEach, describe, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

import { createDaemonBridge } from "./daemon-bridge";

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
    await expect(bridge.sendChannelMessage("all", { authorId: "human:local", body: "hello" })).rejects.toThrow("daemon offline");
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

  it("invokes paged message lists and message thread commands", async () => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { __TAURI_INTERNALS__: {} },
    });
    invokeMock
      .mockResolvedValueOnce({ messages: [], pageInfo: { hasMoreBefore: false } })
      .mockResolvedValueOnce({ messages: [], pageInfo: { hasMoreBefore: false } })
      .mockResolvedValueOnce({ thread: { id: "thread_1", sourceMessageId: "msg_1", sourceKind: "channel", sourceId: "all", replyCount: 0, updatedAt: "1" } })
      .mockResolvedValueOnce({ reply: { id: "reply_1", threadId: "thread_1", senderId: "human:local", role: "human", body: "hi", createdAt: "1" } });

    const bridge = createDaemonBridge();

    await bridge.listChannelMessages("all", { before: 10 });
    await bridge.listConversationMessages("dm:agent", { aroundMessageId: "msg_1", limit: 9 });
    await bridge.createMessageThreadFromSource({ sourceMessageId: "msg_1", createdBy: "human:local" });
    await bridge.replyToMessageThread("thread_1", { senderId: "human:local", body: "hi" });

    expect(invokeMock).toHaveBeenNthCalledWith(1, "list_channel_messages_command", {
      channelId: "all",
      query: { before: 10 },
    });
    expect(invokeMock).toHaveBeenNthCalledWith(2, "list_conversation_messages_command", {
      conversationId: "dm:agent",
      query: { aroundMessageId: "msg_1", limit: 9 },
    });
    expect(invokeMock).toHaveBeenNthCalledWith(3, "create_message_thread_from_source_command", {
      request: { sourceMessageId: "msg_1", createdBy: "human:local" },
    });
    expect(invokeMock).toHaveBeenNthCalledWith(4, "reply_to_message_thread_command", {
      threadId: "thread_1",
      request: { senderId: "human:local", body: "hi" },
    });
  });

  it("returns empty paged message lists and rejects thread mutations while offline", async () => {
    const bridge = createDaemonBridge();

    await expect(bridge.listChannelMessages("all")).resolves.toEqual({
      messages: [],
      pageInfo: { hasMoreBefore: false },
    });
    await expect(bridge.listConversationMessages("dm:agent")).resolves.toEqual({
      messages: [],
      pageInfo: { hasMoreBefore: false },
    });
    await expect(bridge.createMessageThreadFromSource({ sourceMessageId: "msg_1", createdBy: "human:local" })).rejects.toThrow("daemon offline");
    await expect(bridge.replyToMessageThread("thread_1", { senderId: "human:local", body: "hi" })).rejects.toThrow("daemon offline");
  });
});
