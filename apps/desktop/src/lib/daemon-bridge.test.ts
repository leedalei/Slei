import { afterEach, describe, expect, it, vi } from "vitest";

const { invokeMock, listenMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  listenMock: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: listenMock,
}));

import { createDaemonBridge } from "./daemon-bridge";
import type { ChannelMessageView, DesktopAgentView } from "./daemon-bridge";
import { createDaemonBridgeMock } from "../test/daemon-bridge-mock";

describe("createDaemonBridge non-Tauri fallback", () => {
  afterEach(() => {
    invokeMock.mockReset();
    listenMock.mockReset();
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
    await expect(bridge.listAgentRolePresets()).resolves.toEqual({ presets: [] });
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
    await expect(
      bridge.uploadProfileAvatar({
        fileName: "avatar.png",
        mimeType: "image/png",
        bytesBase64: "aGVsbG8=",
      }),
    ).rejects.toThrow("daemon offline");
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

  it("listens for daemon event batches through the Tauri event bridge", async () => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { __TAURI_INTERNALS__: {} },
    });
    const unlisten = vi.fn();
    listenMock.mockImplementationOnce(async (_eventName, handler) => {
      handler({
        payload: {
          after: 7,
          events: [
            {
              sequence: 8,
              eventType: "task_thread.updated",
              occurredAtUnixMs: 1,
              payload: { taskId: "task_1", channelId: "all" },
            },
          ],
        },
      });
      return unlisten;
    });

    const bridge = createDaemonBridge();
    const handler = vi.fn();
    const cleanup = await bridge.listenDaemonEvents(handler);

    expect(listenMock).toHaveBeenCalledWith("slei://daemon-events", expect.any(Function));
    expect(handler).toHaveBeenCalledWith({
      after: 7,
      events: [
        {
          sequence: 8,
          eventType: "task_thread.updated",
          occurredAtUnixMs: 1,
          payload: { taskId: "task_1", channelId: "all" },
        },
      ],
    });
    cleanup();
    expect(unlisten).toHaveBeenCalledOnce();
  });

  it("returns a no-op daemon event listener while offline", async () => {
    const bridge = createDaemonBridge();
    const handler = vi.fn();

    const cleanup = await bridge.listenDaemonEvents(handler);

    cleanup();
    expect(handler).not.toHaveBeenCalled();
    expect(listenMock).not.toHaveBeenCalled();
  });

  it("prefers the Electron preload RPC bridge over Tauri commands", async () => {
    const call = vi.fn(async (method: string) => {
      if (method === "preferences.list") return { preferences: { locale: "zh-CN", timeZone: "Asia/Shanghai", appearance: { theme: "light", fontSize: "md" }, notifications: { mentions: true, humanReplies: true, approvals: true } } };
      if (method === "profile.get") return { profile: null };
      if (method === "agents.list") return { agents: [] };
      if (method === "conversations.list") return { conversations: [] };
      if (method === "savedMessages.list") return { savedMessages: [] };
      if (method === "search.global") return { query: "needle", totals: { agents: 0, channels: 0, messages: 0 }, agents: [], channels: [], messages: [] };
      throw new Error(`unexpected method ${method}`);
    });
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        __TAURI_INTERNALS__: {},
        slei: {
          rpc: { call },
          events: { subscribe: vi.fn() },
        },
      },
    });

    const bridge = createDaemonBridge();
    await bridge.listPreferences();
    await bridge.listProfile();
    await bridge.listAgents();
    await bridge.listConversations();
    await bridge.listSavedMessages();
    await bridge.globalSearch({ q: "needle" });

    expect(call.mock.calls.map(([method]) => method)).toEqual([
      "preferences.list",
      "profile.get",
      "agents.list",
      "conversations.list",
      "savedMessages.list",
      "search.global",
    ]);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("subscribes to daemon state through Electron events and no-ops elsewhere", async () => {
    const cleanup = vi.fn();
    const subscribe = vi.fn((_channel, handler) => {
      handler({ state: "connected" });
      return cleanup;
    });
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        slei: {
          rpc: { call: vi.fn() },
          events: { subscribe },
        },
      },
    });

    const bridge = createDaemonBridge();
    const handler = vi.fn();
    const unlisten = await bridge.listenDaemonState(handler);

    expect(subscribe).toHaveBeenCalledWith("daemon.state", expect.any(Function));
    expect(handler).toHaveBeenCalledWith({ state: "connected" });
    unlisten();
    expect(cleanup).toHaveBeenCalledOnce();

    Reflect.deleteProperty(globalThis as Record<string, unknown>, "window");
    const offlineCleanup = await createDaemonBridge().listenDaemonState(handler);
    offlineCleanup();
    expect(handler).toHaveBeenCalledTimes(1);
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
    await bridge.clearConversationMessages("dm:agent");
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
    expect(invokeMock).toHaveBeenNthCalledWith(3, "clear_conversation_messages_command", {
      conversationId: "dm:agent",
    });
    expect(invokeMock).toHaveBeenNthCalledWith(4, "create_message_thread_from_source_command", {
      request: { sourceMessageId: "msg_1", createdBy: "human:local" },
    });
    expect(invokeMock).toHaveBeenNthCalledWith(5, "reply_to_message_thread_command", {
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
    await expect(bridge.clearConversationMessages("dm:agent")).rejects.toThrow("daemon offline");
    await expect(bridge.createMessageThreadFromSource({ sourceMessageId: "msg_1", createdBy: "human:local" })).rejects.toThrow("daemon offline");
    await expect(bridge.replyToMessageThread("thread_1", { senderId: "human:local", body: "hi" })).rejects.toThrow("daemon offline");
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

  it("invokes role preset listing and surfaces command failures", async () => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { __TAURI_INTERNALS__: {} },
    });
    invokeMock
      .mockResolvedValueOnce({
        presets: [{ id: "engineer", title: "工程师", description: "实现功能", sortOrder: 10 }],
      })
      .mockRejectedValueOnce(new Error("daemon unavailable"));

    const bridge = createDaemonBridge();
    await expect(bridge.listAgentRolePresets()).resolves.toEqual({
      presets: [{ id: "engineer", title: "工程师", description: "实现功能", sortOrder: 10 }],
    });
    await expect(bridge.listAgentRolePresets()).rejects.toThrow("daemon unavailable");

    expect(invokeMock).toHaveBeenNthCalledWith(1, "list_agent_role_presets_command");
    expect(invokeMock).toHaveBeenNthCalledWith(2, "list_agent_role_presets_command");
  });

  it("passes avatarSeed through createAgent", async () => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { __TAURI_INTERNALS__: {} },
    });
    invokeMock.mockResolvedValueOnce({ agent: testAgent("agent_nova", "Nova", "@Nova") });

    const bridge = createDaemonBridge();
    await bridge.createAgent({
      name: "Nova",
      handle: "@Nova",
      runtimeKind: "ClaudeCode",
      model: "Sonnet",
      nodeId: "local-node",
      description: "Architect",
      avatarSeed: "preset-engineer",
    });

    expect(invokeMock).toHaveBeenCalledWith("create_agent_command", {
      request: {
        name: "Nova",
        handle: "@Nova",
        runtimeKind: "ClaudeCode",
        model: "Sonnet",
        nodeId: "local-node",
        description: "Architect",
        avatarSeed: "preset-engineer",
      },
    });
  });

  it("invokes profile avatar upload with the expected command shape", async () => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { __TAURI_INTERNALS__: {} },
    });
    invokeMock.mockResolvedValueOnce({
      profile: {
        displayName: "Lei",
        handle: "lei",
        avatar: `profile-image:${"a".repeat(64)}.png`,
      },
    });

    const request = {
      fileName: "avatar.png",
      mimeType: "image/png",
      bytesBase64: "aGVsbG8=",
    };
    const bridge = createDaemonBridge();
    await expect(bridge.uploadProfileAvatar(request)).resolves.toEqual({
      profile: {
        displayName: "Lei",
        handle: "lei",
        avatar: `profile-image:${"a".repeat(64)}.png`,
      },
    });

    expect(invokeMock).toHaveBeenCalledWith("upload_profile_avatar_command", { request });
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

  it("returns role preset fixtures and preserves avatarSeed on created agents", async () => {
    const bridge = createDaemonBridgeMock({
      connected: true,
      rolePresets: [{ id: "engineer", title: "工程师", description: "实现功能", sortOrder: 10 }],
    });

    await expect(bridge.listAgentRolePresets()).resolves.toEqual({
      presets: [{ id: "engineer", title: "工程师", description: "实现功能", sortOrder: 10 }],
    });

    const created = await bridge.createAgent({
      name: "Nova",
      handle: "@Nova",
      runtimeKind: "ClaudeCode",
      model: "Sonnet",
      nodeId: "local-node",
      description: "Architect",
      avatarSeed: "preset-engineer",
    });

    expect(created.agent.avatarSeed).toBe("preset-engineer");
  });

  it("supports daemon state subscriptions in tests", async () => {
    const bridge = createDaemonBridgeMock({ connected: false });
    const handler = vi.fn();

    const cleanup = await bridge.listenDaemonState(handler);
    bridge.emitDaemonState({ state: "starting" });
    bridge.emitDaemonState({ state: "connected" });
    cleanup();
    bridge.emitDaemonState({ state: "offline", code: "daemon_unavailable" });

    expect(handler).toHaveBeenCalledTimes(2);
    expect(handler).toHaveBeenNthCalledWith(1, { state: "starting" });
    expect(handler).toHaveBeenNthCalledWith(2, { state: "connected" });
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
