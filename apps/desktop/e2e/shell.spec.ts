import { describe, expect, it } from "vitest";

import { createDaemonBridgeMock, type DesktopAgentView } from "../src/lib/daemon-bridge";
import { createEventBridge } from "../src/lib/event-bridge";
import { renderAppShell } from "../src/app/App";

describe("desktop shell daemon connectivity", () => {
  it("renders Chinese by default and reflects daemon connection state", async () => {
    const bridge = createDaemonBridgeMock({ connected: true });

    const connected = await renderAppShell({ bridge });
    expect(connected).toContain("聊天");
    expect(connected).toContain("已连接");

    bridge.setConnected(false);
    const offline = await renderAppShell({ bridge });
    expect(offline).toContain("离线");
  });

  it("reconnects event delivery from the last seen sequence", async () => {
    const bridge = createDaemonBridgeMock({ connected: true });
    const events = createEventBridge(bridge);

    await events.reconnectFrom(41);

    expect(bridge.eventSubscriptions).toEqual([{ after: 41 }]);
  });

  it("never exposes daemon endpoint, token or raw socket values to webview code", async () => {
    const bridge = createDaemonBridgeMock({ connected: true });

    const status = await bridge.daemonStatus();
    const serialized = JSON.stringify(status);

    expect(serialized).not.toContain("secret-token");
    expect(serialized).not.toContain("127.0.0.1");
    expect(serialized).not.toContain("ws://");
  });

  it("loads guide creation and memory skills for the mock Yeal agent", async () => {
    const bridge = createDaemonBridgeMock({
      connected: true,
      nodes: [
        {
          id: "local-node",
          name: "本机设备",
          status: "connected",
          daemonVersion: "0.1.0",
          device: { platform: "darwin", arch: "arm64", hostname: "local-device" },
          runtimes: [{ kind: "ClaudeCode", readiness: "ready" }],
        },
      ],
    });

    const receipt = await bridge.bootstrapGuideAgent();
    const skills = await bridge.listAgentSkills("agent_guide_local_node");

    expect(receipt.agent?.skills?.map((skill) => skill.id)).toEqual(["guide-create", "memory"]);
    expect(skills.skills.map((skill) => skill.id)).toEqual(["guide-create", "memory"]);
  });

  it("resetting a DM clears current session messages without creating a new session", async () => {
    const agent: DesktopAgentView = {
      id: "agent_coda",
      name: "Coda",
      handle: "@coda",
      runtimeKind: "ClaudeCode",
      model: "Sonnet",
      nodeId: "local-node",
      description: "研发团队开发工程师。",
      workspacePath: "/tmp/coda",
      memoryPath: "/tmp/coda/MEMORY.md",
      docsPath: "/tmp/coda/docs",
      avatarSeed: "agent_coda",
      createdAt: "2026-05-29T10:00:00Z",
      updatedAt: "2026-05-29T10:00:00Z",
    };
    const bridge = createDaemonBridgeMock({ connected: true, agents: [agent] });
    const { conversation } = await bridge.createDmConversation(agent.id);
    const sessionId = conversation.activeSessionId;

    await bridge.sendConversationMessage(conversation.id, {
      authorId: "human:local",
      body: "第一句",
      sessionId,
    });
    const beforeResetSessions = await bridge.listConversationSessions(conversation.id);

    const reset = await bridge.resetConversationRuntimeSession(conversation.id);
    const afterResetSessions = await bridge.listConversationSessions(conversation.id);
    const afterResetMessages = await bridge.listConversationMessages(conversation.id);

    expect(reset.conversation.activeSessionId).toBe(sessionId);
    expect(beforeResetSessions.sessions).toHaveLength(1);
    expect(afterResetSessions.sessions).toHaveLength(1);
    expect(afterResetSessions.sessions[0]).toMatchObject({
      id: sessionId,
      title: "新会话",
      runtimeSession: undefined,
    });
    expect(afterResetMessages.messages).toEqual([]);
  });
});
