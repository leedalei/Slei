import { describe, expect, it, vi } from "vitest";
import { createDaemonHttpClient } from "./daemon-http.js";
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

    expect(request).toHaveBeenCalledOnce();
    const [method, path, body, options] = request.mock.calls[0] as [
      string,
      string,
      unknown,
      { headers?: Record<string, string> },
    ];
    expect(method).toBe("POST");
    expect(path).toBe("/v1/channels/all/messages");
    expect(body).toEqual({ authorId: "human:local", body: "hello" });
    expect(options.headers?.["Idempotency-Key"]).toEqual(expect.stringMatching(/^desktop-channel-message-.+/));
  });

  it("sends channel messages with authorization and idempotency headers through the HTTP client", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ message: { id: "msg_1" }, outcome: { action: "broadcast_delivered" } }),
    });
    const client = createDaemonHttpClient({
      endpoint: "http://127.0.0.1:4319",
      token: "desktop-session-token",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const rpc = createDaemonRpcHandler(client);

    await rpc.call("channels.messages.send", {
      channelId: "team chat",
      request: { authorId: "human:local", body: "hello" },
    });

    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(url).toBe("http://127.0.0.1:4319/v1/channels/team%20chat/messages");
    expect(init.method).toBe("POST");
    expect(headers.Authorization).toBe("Bearer desktop-session-token");
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers["Idempotency-Key"]).toEqual(expect.stringMatching(/^desktop-channel-message-.+/));
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

  it("maps SleiApp initial loading RPC methods to daemon routes", async () => {
    const request = vi.fn().mockResolvedValue({});
    const rpc = createDaemonRpcHandler({ request } as never);

    await rpc.call("preferences.list", {});
    await rpc.call("savedMessages.list", {});
    await rpc.call("profile.get", {});
    await rpc.call("agents.bootstrapGuide", {});
    await rpc.call("agents.list", {});
    await rpc.call("conversations.list", {});
    await rpc.call("channels.list", {});
    await rpc.call("tasks.list", { query: { channelId: "all" } });
    await rpc.call("search.global", { query: { q: "needle", includeAgents: true } });

    expect(request.mock.calls.map(([method, path]) => [method, path])).toEqual([
      ["GET", "/v1/settings/preferences"],
      ["GET", "/v1/saved-messages"],
      ["GET", "/v1/settings/profile"],
      ["POST", "/v1/agents/guide/bootstrap"],
      ["GET", "/v1/agents"],
      ["GET", "/v1/conversations"],
      ["GET", "/v1/channels"],
      ["GET", "/v1/tasks?channelId=all"],
      ["GET", "/v1/search/global?includeAgents=true&query=needle"],
    ]);
  });

  it("maps core interaction RPC methods to daemon routes", async () => {
    const request = vi.fn().mockResolvedValue({});
    const rpc = createDaemonRpcHandler({ request } as never);

    await rpc.call("channels.create", { request: { name: "dev" } });
    await rpc.call("channels.delete", { channelId: "dev" });
    await rpc.call("channels.projectPaths.replace", { channelId: "dev", request: { projectPaths: ["/tmp/app"] } });
    await rpc.call("channels.members.list", { channelId: "dev" });
    await rpc.call("channels.members.add", { channelId: "dev", request: { agentId: "agent_1" } });
    await rpc.call("channels.members.remove", { channelId: "dev", agentId: "agent_1" });
    await rpc.call("agents.create", { request: { name: "Ada" } });
    await rpc.call("agents.update", { agentId: "agent_1", request: { description: "Updated" } });
    await rpc.call("agents.delete", { agentId: "agent_1" });
    await rpc.call("agents.remember", { agentId: "agent_1", fact: "Prefers tests" });
    await rpc.call("agents.skills.list", { agentId: "agent_1" });
    await rpc.call("agents.activity.list", { agentId: "agent_1", limit: 20 });
    await rpc.call("conversations.dm.create", { agentId: "agent_1" });
    await rpc.call("conversations.sessions.list", { conversationId: "dm:agent_1" });
    await rpc.call("conversations.sessions.create", { conversationId: "dm:agent_1" });
    await rpc.call("conversations.sessions.activate", { conversationId: "dm:agent_1", sessionId: "session_1" });
    await rpc.call("conversations.messages.list", { conversationId: "dm:agent_1", query: { limit: 50 } });
    await rpc.call("conversations.messages.send", { conversationId: "dm:agent_1", request: { authorId: "human:local", body: "hi" } });
    await rpc.call("conversations.messages.clear", { conversationId: "dm:agent_1" });
    await rpc.call("conversations.runtimeSession.reset", { conversationId: "dm:agent_1" });
    await rpc.call("attachments.upload", { request: { name: "a.txt", mimeType: "text/plain", bytesBase64: "YQ==" } });
    await rpc.call("permissions.resolve", { request: { requestId: "perm_1", decision: "approve_once" } });
    await rpc.call("messageThreads.createFromSource", { request: { sourceMessageId: "msg_1", createdBy: "human:local" } });
    await rpc.call("messageThreads.get", { threadId: "thread_1" });
    await rpc.call("messageThreads.reply", { threadId: "thread_1", request: { senderId: "human:local", body: "ok" } });
    await rpc.call("tasks.thread.get", { taskId: "task_1" });
    await rpc.call("tasks.reply", { taskId: "task_1", request: { senderId: "human:local", body: "done" } });
    await rpc.call("tasks.status.update", { taskId: "task_1", request: { status: "done" } });
    await rpc.call("interactiveCards.complete", { cardId: "card_1" });
    await rpc.call("savedMessages.save", { request: { messageId: "msg_1", sourceId: "all", sourceKind: "channel" } });
    await rpc.call("savedMessages.unsave", { messageId: "msg_1" });
    await rpc.call("preferences.update", { request: { timeZone: "UTC" } });
    await rpc.call("profile.update", { request: { displayName: "Lei" } });
    await rpc.call("profile.avatar.upload", { request: { fileName: "a.png", mimeType: "image/png", bytesBase64: "YQ==" } });
    await rpc.call("nodes.renameLocal", { name: "Studio" });
    await rpc.call("runtime.refreshStatus", {});

    expect(request.mock.calls.map(([method, path, body]) => [method, path, body])).toEqual([
      ["POST", "/v1/channels", { name: "dev" }],
      ["DELETE", "/v1/channels/dev", undefined],
      ["PATCH", "/v1/channels/dev/project-paths", { projectPaths: ["/tmp/app"] }],
      ["GET", "/v1/channels/dev/members", undefined],
      ["POST", "/v1/channels/dev/members", { agentId: "agent_1" }],
      ["DELETE", "/v1/channels/dev/members/agent_1", undefined],
      ["POST", "/v1/agents", { name: "Ada" }],
      ["PATCH", "/v1/agents/agent_1", { description: "Updated" }],
      ["DELETE", "/v1/agents/agent_1", undefined],
      ["POST", "/v1/agents/agent_1/memory/remember", { fact: "Prefers tests" }],
      ["GET", "/v1/agents/agent_1/skills", undefined],
      ["GET", "/v1/agents/agent_1/activity?limit=20", undefined],
      ["POST", "/v1/conversations/dm", { agentId: "agent_1" }],
      ["GET", "/v1/conversations/dm%3Aagent_1/sessions", undefined],
      ["POST", "/v1/conversations/dm%3Aagent_1/sessions", undefined],
      ["PATCH", "/v1/conversations/dm%3Aagent_1/sessions/session_1/active", undefined],
      ["GET", "/v1/conversations/dm%3Aagent_1/messages?limit=50", undefined],
      ["POST", "/v1/conversations/dm%3Aagent_1/messages", { authorId: "human:local", body: "hi" }],
      ["DELETE", "/v1/conversations/dm%3Aagent_1/messages", undefined],
      ["POST", "/v1/conversations/dm%3Aagent_1/runtime-session/reset", undefined],
      ["POST", "/v1/attachments", { name: "a.txt", mimeType: "text/plain", bytesBase64: "YQ==" }],
      ["POST", "/v1/approvals/permissions/resolve", { requestId: "perm_1", decision: "approve_once" }],
      ["POST", "/v1/message-threads/from-source-message", { sourceMessageId: "msg_1", createdBy: "human:local" }],
      ["GET", "/v1/message-threads/thread_1", undefined],
      ["POST", "/v1/message-threads/thread_1/replies", { senderId: "human:local", body: "ok" }],
      ["GET", "/v1/tasks/task_1/thread", undefined],
      ["POST", "/v1/tasks/task_1/replies", { senderId: "human:local", body: "done" }],
      ["PATCH", "/v1/tasks/task_1/status", { status: "done" }],
      ["POST", "/v1/interactive-cards/card_1/complete", undefined],
      ["POST", "/v1/saved-messages", { messageId: "msg_1", sourceId: "all", sourceKind: "channel" }],
      ["DELETE", "/v1/saved-messages/msg_1", undefined],
      ["PATCH", "/v1/settings/preferences", { timeZone: "UTC" }],
      ["PATCH", "/v1/settings/profile", { displayName: "Lei" }],
      ["POST", "/v1/settings/profile/avatar-image", { fileName: "a.png", mimeType: "image/png", bytesBase64: "YQ==" }],
      ["PATCH", "/v1/nodes/local-node/name", { name: "Studio" }],
      ["GET", "/v1/nodes", undefined],
    ]);
  });

  it("maps agent workspace RPC methods to daemon routes and opens resolved paths locally", async () => {
    const request = vi.fn()
      .mockResolvedValueOnce({
        agentId: "agent_1",
        target: "workspace",
        path: "/tmp/slei/agents/agent_1",
      })
      .mockResolvedValueOnce({
        agentId: "agent_1",
        relativePath: "",
        entries: [{ kind: "file", name: "MEMORY.md", relativePath: "MEMORY.md" }],
      })
      .mockResolvedValueOnce({
        agentId: "agent_1",
        name: "MEMORY.md",
        relativePath: "MEMORY.md",
        content: "# Memory",
      });
    const openPath = vi.fn().mockResolvedValue("");
    const rpc = createDaemonRpcHandler({ request } as never, { openPath });

    await expect(rpc.call("agents.path.open", { agentId: "agent_1", target: "workspace" })).resolves.toEqual({
      agentId: "agent_1",
      target: "workspace",
      path: "/tmp/slei/agents/agent_1",
    });
    await expect(rpc.call("agents.workspace.list", { agentId: "agent_1" })).resolves.toEqual({
      agentId: "agent_1",
      relativePath: "",
      entries: [{ kind: "file", name: "MEMORY.md", relativePath: "MEMORY.md" }],
    });
    await expect(rpc.call("agents.workspace.file.read", { agentId: "agent_1", relativePath: "MEMORY.md" })).resolves.toEqual({
      agentId: "agent_1",
      name: "MEMORY.md",
      relativePath: "MEMORY.md",
      content: "# Memory",
    });

    expect(request.mock.calls.map(([method, path]) => [method, path])).toEqual([
      ["GET", "/v1/agents/agent_1/paths/workspace"],
      ["GET", "/v1/agents/agent_1/workspace"],
      ["GET", "/v1/agents/agent_1/workspace/file?relativePath=MEMORY.md"],
    ]);
    expect(openPath).toHaveBeenCalledWith("/tmp/slei/agents/agent_1");
  });

  it("adds idempotency keys to write routes that require them", async () => {
    const request = vi.fn().mockResolvedValue({});
    const rpc = createDaemonRpcHandler({ request } as never);

    await rpc.call("channels.create", { request: { name: "dev" } });
    await rpc.call("agents.create", { request: { name: "Ada" } });
    await rpc.call("tasks.reply", { taskId: "task_1", request: { senderId: "human:local", body: "done" } });
    await rpc.call("tasks.status.update", { taskId: "task_1", request: { status: "done" } });
    await rpc.call("interactiveCards.complete", { cardId: "card_1" });
    await rpc.call("messageThreads.createFromSource", { request: { sourceMessageId: "msg_1", createdBy: "human:local" } });
    await rpc.call("messageThreads.reply", { threadId: "thread_1", request: { senderId: "human:local", body: "ok" } });

    expect(request.mock.calls.map(([method, path, _body, options]) => [
      method,
      path,
      options?.headers?.["Idempotency-Key"],
    ])).toEqual([
      ["POST", "/v1/channels", expect.stringMatching(/^desktop-channel-create-.+/)],
      ["POST", "/v1/agents", expect.stringMatching(/^desktop-agent-create-.+/)],
      ["POST", "/v1/tasks/task_1/replies", expect.stringMatching(/^desktop-task-reply-.+/)],
      ["PATCH", "/v1/tasks/task_1/status", expect.stringMatching(/^desktop-task-status-.+/)],
      ["POST", "/v1/interactive-cards/card_1/complete", expect.stringMatching(/^desktop-card-complete-.+/)],
      ["POST", "/v1/message-threads/from-source-message", expect.stringMatching(/^desktop-message-thread-create-.+/)],
      ["POST", "/v1/message-threads/thread_1/replies", expect.stringMatching(/^desktop-message-thread-reply-.+/)],
    ]);
  });

  it.each([-1, 1.5])("rejects invalid event reconnect cursor %s", async (after) => {
    const request = vi.fn().mockResolvedValue({ events: [] });
    const rpc = createDaemonRpcHandler({ request } as never);

    await expect(rpc.call("events.reconnect", { after })).rejects.toMatchObject({
      code: "invalid_rpc_payload",
    });
    expect(request).not.toHaveBeenCalled();
  });
});
