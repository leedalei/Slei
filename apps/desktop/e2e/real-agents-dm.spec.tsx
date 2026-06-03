import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { shouldRefreshConversationMessages, SleiAppFrame } from "../src/app/SleiApp";
import { createSleiFixtures, type SleiMember } from "../src/app/fixtures";

const nodes = createSleiFixtures().nodes;
const agent: SleiMember = {
  id: "agent_coda",
  name: "Coda",
  handle: "@coda",
  avatar: "CO",
  avatarSeed: "agent_coda",
  type: "agent",
  runtimeStatus: "idle",
  role: "研发团队开发工程师",
  description: "真实创建的开发 Agent。",
  computer: nodes[0].name,
  nodeId: nodes[0].id,
  created: "2026-05-29T10:00:00Z",
  creator: "lei lee @lei-lee",
  runtime: "ClaudeCode",
  model: "Sonnet",
  instructions: "实现编码。",
  permissions: [],
  environmentVariables: [],
  createdAgents: [],
  activity: "待命",
  capabilities: ["代码实现"],
  workspacePath: "~/.slei/agents/agent_coda",
  memoryPath: "~/.slei/agents/agent_coda/MEMORY.md",
  docsPath: "~/.slei/agents/agent_coda/docs",
};

const readyRuntime = {
  loading: false,
  error: undefined,
  hasClaudeRuntimeReady: true,
  nodes,
};

const codaDm = {
  id: "dm:agent_coda",
  kind: "dm",
  agentId: "agent_coda",
  activeSessionId: "session-current",
  createdAt: "2026-05-29T10:00:00Z",
  updatedAt: "2026-05-29T10:00:00Z",
} as const;

const codaSessions = [
  {
    id: "session-old",
    conversationId: "dm:agent_coda",
    title: "帮我检查历史会话",
    status: "ready",
    createdAt: "2026-05-29T09:00:00Z",
    updatedAt: "2026-05-29T09:05:00Z",
  },
  {
    id: "session-current",
    conversationId: "dm:agent_coda",
    title: "新会话",
    status: "ready",
    createdAt: "2026-05-29T10:00:00Z",
    updatedAt: "2026-05-29T10:00:00Z",
  },
];

describe("real agent members and direct messages", () => {
  it("does not ship fake default members", () => {
    expect(createSleiFixtures().members).toEqual([]);
  });

  it("renders only real agents in members without graph or humans", () => {
    const html = renderToStaticMarkup(
      <SleiAppFrame
        activeView="members"
        data={createSleiFixtures({ members: [agent] })}
        locale="zh-CN"
        runtimeSetup={readyRuntime}
      />,
    );

    expect(html).toContain("Coda");
    expect(html).toContain("私聊");
    expect(html).not.toContain("图谱");
    expect(html).not.toContain("HUMANS");
    expect(html).not.toContain("Lei");
  });

  it("keeps the chat direct message list empty until a conversation exists", () => {
    const html = renderToStaticMarkup(
      <SleiAppFrame
        activeView="chat"
        data={createSleiFixtures({ members: [agent] })}
        locale="zh-CN"
        runtimeSetup={readyRuntime}
      />,
    );

    expect(html).toContain("私聊 0");
    expect(html).not.toContain("@coda");
    expect(html).not.toContain("Coda");
  });

  it("shows direct messages in chat sidebar from created conversations", () => {
    const html = renderToStaticMarkup(
      <SleiAppFrame
        activeView="chat"
        data={createSleiFixtures({ conversations: [codaDm], members: [agent] })}
        locale="zh-CN"
        runtimeSetup={readyRuntime}
      />,
    );

    expect(html).toContain("私聊 1");
    expect(html).toContain("Coda");
    expect(html).toContain("slei-channel__dm-copy");
    expect(html).toContain("<strong>Coda</strong>");
    expect(html).toContain("真实创建的开发 Agent。");
    expect(html).not.toContain("<small>@coda</small>");
  });

  it("highlights only the selected direct message while a dm is active", () => {
    const html = renderToStaticMarkup(
      <SleiAppFrame
        activeConversationId="dm:agent_coda"
        activeView="chat"
        data={createSleiFixtures({ conversations: [codaDm], members: [agent] })}
        locale="zh-CN"
        runtimeSetup={readyRuntime}
      />,
    );

    expect(html.match(/aria-current="true"/g)).toHaveLength(1);
    expect(html).toContain('aria-current="true" class="slei-channel slei-channel--dm"');
    expect(html).not.toContain('aria-current="true" class="slei-channel"');
  });

  it("highlights only the selected channel while a channel is active", () => {
    const html = renderToStaticMarkup(
      <SleiAppFrame
        activeChannelId="all"
        activeView="chat"
        data={createSleiFixtures({ conversations: [codaDm], members: [agent] })}
        locale="zh-CN"
        runtimeSetup={readyRuntime}
      />,
    );

    expect(html.match(/aria-current="true"/g)).toHaveLength(1);
    expect(html).toContain('aria-current="true" class="slei-channel"');
    expect(html).not.toContain('aria-current="true" class="slei-channel slei-channel--dm"');
  });

  it("uses compact detail edit buttons and a 440px modal width", () => {
    const html = renderToStaticMarkup(
      <SleiAppFrame
        activeView="members"
        data={createSleiFixtures({ members: [agent] })}
        initialAgentCreateModalOpen
        locale="zh-CN"
        runtimeSetup={readyRuntime}
      />,
    );
    const css = readFileSync(join(process.cwd(), "src/app/app.css"), "utf8");

    expect(html).toContain("slei-agent-modal");
    expect(html).toContain("slei-button--small");
    expect(css).toContain(".slei-button--small");
    expect(css).toContain("width: min(100%, 440px)");
  });

  it("renders runtime status squares for active approved failed and pending agent replies", () => {
    const html = renderToStaticMarkup(
      <SleiAppFrame
        activeConversationId="dm:agent_coda"
        activeView="chat"
        data={createSleiFixtures({
          conversations: [codaDm],
          members: [agent],
          messages: [
            {
              id: "human-1",
              author: "Lei",
              role: "human",
              time: "10:00",
              body: "请给我一个方案",
              channelId: "dm:agent_coda",
              sessionId: "session-current",
            },
            {
              id: "run-1",
              author: "Coda",
              role: "agent",
              time: "10:01",
              body: "我正在处理",
              channelId: "dm:agent_coda",
              sessionId: "session-current",
              status: "running",
            },
            {
              id: "run-2",
              author: "Coda",
              role: "agent",
              time: "10:02",
              body: "Claude auth missing",
              channelId: "dm:agent_coda",
              sessionId: "session-current",
              status: "failed",
            },
            {
              id: "run-3",
              author: "Coda",
              role: "agent",
              time: "10:03",
              body: "已经发送完成",
              channelId: "dm:agent_coda",
              sessionId: "session-current",
              status: "done",
            },
            {
              id: "run-4",
              author: "Coda",
              role: "agent",
              time: "10:04",
              body: "审批已通过",
              channelId: "dm:agent_coda",
              sessionId: "session-current",
              status: "approval",
            },
            {
              id: "run-5",
              author: "Coda",
              role: "agent",
              time: "10:05",
              body: "等待决断",
              channelId: "dm:agent_coda",
              sessionId: "session-current",
              status: "pending",
            },
          ],
        })}
        locale="zh-CN"
        runtimeSetup={readyRuntime}
      />,
    );

    expect(html).toContain("我正在处理");
    expect(html).toContain("slei-message-status-square--running");
    expect(html).toContain("Claude auth missing");
    expect(html).toContain("slei-message-status-square--failed");
    expect(html).toContain("已经发送完成");
    expect(html).toContain("审批已通过");
    expect(html).toContain("slei-message-status-square--approval");
    expect(html).toContain("等待决断");
    expect(html).toContain("slei-message-status-square--pending");
    expect(html).not.toContain("slei-badge--running");
    expect(html).not.toContain("slei-badge--failed");
    expect(html).not.toContain("slei-badge--done");
  });

  it("keeps polling active direct messages while output is running or pending", () => {
    expect(
      shouldRefreshConversationMessages(
        [
          {
            id: "run-pending",
            author: "Coda",
            role: "agent",
            time: "10:00",
            body: "收到，",
            channelId: "dm:agent_coda",
            status: "pending",
          },
        ],
        "dm:agent_coda",
      ),
    ).toBe(true);
    expect(
      shouldRefreshConversationMessages(
        [
          {
            id: "run-done",
            author: "Coda",
            role: "agent",
            time: "10:01",
            body: "收到，我来处理。",
            channelId: "dm:agent_coda",
            status: "done",
          },
        ],
        "dm:agent_coda",
      ),
    ).toBe(false);
  });

  it("renders only new session and history actions for active direct messages", () => {
    const dmHtml = renderToStaticMarkup(
      <SleiAppFrame
        activeConversationId="dm:agent_coda"
        activeSessionId="session-current"
        activeView="chat"
        data={createSleiFixtures({ conversations: [codaDm], conversationSessions: codaSessions, members: [agent] })}
        locale="zh-CN"
        onConversationNewSession={() => undefined}
        onConversationHistoryToggle={() => undefined}
        runtimeSetup={readyRuntime}
      />,
    );
    const channelHtml = renderToStaticMarkup(
      <SleiAppFrame
        activeChannelId="all"
        activeView="chat"
        data={createSleiFixtures({ conversations: [codaDm], members: [agent] })}
        locale="zh-CN"
        onConversationNewSession={() => undefined}
        runtimeSetup={readyRuntime}
      />,
    );

    expect(dmHtml).toContain("新会话");
    expect(dmHtml).not.toContain("重置会话");
    expect(dmHtml).toContain("历史对话");
    expect(dmHtml).not.toContain("Runtime 已检测");
    expect(dmHtml).not.toContain("slei-chat-tabs");
    expect(channelHtml).not.toContain("重置会话");
    expect(channelHtml).not.toContain("历史对话");
  });

  it("hides the as-task composer toggle in direct messages", () => {
    const dmHtml = renderToStaticMarkup(
      <SleiAppFrame
        activeConversationId="dm:agent_coda"
        activeSessionId="session-current"
        activeView="chat"
        data={createSleiFixtures({ conversations: [codaDm], conversationSessions: codaSessions, members: [agent] })}
        locale="zh-CN"
        runtimeSetup={readyRuntime}
      />,
    );
    const channelHtml = renderToStaticMarkup(
      <SleiAppFrame activeView="chat" data={createSleiFixtures({ members: [agent] })} locale="zh-CN" runtimeSetup={readyRuntime} />,
    );

    expect(dmHtml).not.toContain("转为任务");
    expect(dmHtml).not.toContain("slei-task-toggle");
    expect(channelHtml).toContain("转为任务");
  });

  it("renders direct message identity, role, time, and icon-only copy action in message cards", () => {
    const html = renderToStaticMarkup(
      <SleiAppFrame
        activeConversationId="dm:agent_coda"
        activeSessionId="session-current"
        activeView="chat"
        data={createSleiFixtures({
          conversations: [codaDm],
          conversationSessions: codaSessions,
          members: [agent],
          messages: [
            {
              id: "current-1",
              author: "Coda",
              handle: "@coda",
              role: "agent",
              time: "10:00",
              body: "当前消息",
              channelId: "dm:agent_coda",
              sessionId: "session-current",
            },
          ],
        })}
        locale="zh-CN"
        runtimeSetup={readyRuntime}
      />,
    );

    expect(html).toContain("Coda");
    expect(html).toContain("@coda");
    expect(html).toContain("研发团队开发工程师");
    expect(html).toContain("10:00");
    expect(html).toContain('aria-label="复制"');
    expect(html).toContain("slei-message__meta-separator");
    expect(html).not.toContain(">复制</button>");
    expect(html.indexOf('aria-label="复制"')).toBeLessThan(html.indexOf("<time>10:00</time>"));
  });

  it("uses localized fallback role labels for unmatched direct message authors", () => {
    const html = renderToStaticMarkup(
      <SleiAppFrame
        activeConversationId="dm:agent_coda"
        activeSessionId="session-current"
        activeView="chat"
        data={createSleiFixtures({
          conversations: [codaDm],
          conversationSessions: codaSessions,
          members: [agent],
          messages: [
            {
              id: "current-1",
              author: "Lei",
              handle: "@lei",
              role: "human",
              time: "10:00",
              body: "当前消息",
              channelId: "dm:agent_coda",
              sessionId: "session-current",
            },
          ],
        })}
        locale="zh-CN"
        runtimeSetup={readyRuntime}
      />,
    );

    expect(html).toContain("Lei");
    expect(html).toContain("@lei");
    expect(html).toContain("用户");
  });

  it("uses the active session title as the direct message detail title", () => {
    const html = renderToStaticMarkup(
      <SleiAppFrame
        activeConversationId="dm:agent_coda"
        activeSessionId="session-old"
        activeView="chat"
        data={createSleiFixtures({ conversations: [codaDm], conversationSessions: codaSessions, members: [agent] })}
        locale="zh-CN"
        runtimeSetup={readyRuntime}
      />,
    );

    expect(html).toContain("帮我检查历史会话");
  });

  it("renders the member name and created time under direct message session titles", () => {
    const html = renderToStaticMarkup(
      <SleiAppFrame
        activeConversationId="dm:agent_coda"
        activeSessionId="session-old"
        activeView="chat"
        data={createSleiFixtures({ conversations: [codaDm], conversationSessions: codaSessions, members: [agent] })}
        locale="zh-CN"
        runtimeSetup={readyRuntime}
      />,
    );

    expect(html).toContain("Coda ｜");
    expect(html).toContain("2026-05-29 09:00:00");
    expect(html).not.toContain("@coda · 私聊");
  });

  it("falls back to the new session title for unnamed direct message sessions", () => {
    const html = renderToStaticMarkup(
      <SleiAppFrame
        activeConversationId="dm:agent_coda"
        activeSessionId="session-unnamed"
        activeView="chat"
        data={createSleiFixtures({
          conversations: [{ ...codaDm, activeSessionId: "session-unnamed" }],
          conversationSessions: [
            {
              id: "session-unnamed",
              conversationId: "dm:agent_coda",
              title: "",
              status: "ready",
              createdAt: "2026-05-29T10:00:00Z",
              updatedAt: "2026-05-29T10:00:00Z",
            },
          ],
          members: [agent],
        })}
        locale="zh-CN"
        runtimeSetup={readyRuntime}
      />,
    );

    expect(html).toContain("新会话");
  });

  it("renders direct message history drawer with sessions newest first and filters messages by active session", () => {
    const html = renderToStaticMarkup(
      <SleiAppFrame
        activeConversationId="dm:agent_coda"
        activeSessionId="session-current"
        activeView="chat"
        data={createSleiFixtures({
          conversations: [codaDm],
          conversationSessions: codaSessions,
          members: [agent],
          messages: [
            {
              id: "old-1",
              author: "Lei",
              role: "human",
              time: "09:00",
              body: "旧消息",
              channelId: "dm:agent_coda",
              sessionId: "session-old",
            },
            {
              id: "current-1",
              author: "Lei",
              role: "human",
              time: "10:00",
              body: "当前消息",
              channelId: "dm:agent_coda",
              sessionId: "session-current",
            },
          ],
        })}
        initialConversationHistoryOpen
        locale="zh-CN"
        runtimeSetup={readyRuntime}
      />,
    );

    expect(html).toContain("slei-session-drawer");
    expect(html).toContain("历史对话");
    expect(html).toContain("帮我检查历史会话");
    expect(html).toContain("新会话");
    const sessionListHtml = html.slice(html.indexOf("slei-session-list"));
    expect(sessionListHtml.indexOf("新会话")).toBeLessThan(sessionListHtml.indexOf("帮我检查历史会话"));
    expect(html).toContain("当前消息");
    expect(html).not.toContain("旧消息");
  });

  it("disables direct message send while current session is running", () => {
    const html = renderToStaticMarkup(
      <SleiAppFrame
        activeConversationId="dm:agent_coda"
        activeSessionId="session-current"
        activeView="chat"
        data={createSleiFixtures({
          conversations: [codaDm],
          conversationSessions: codaSessions,
          members: [agent],
          messages: [
            {
              id: "run-1",
              author: "Coda",
              role: "agent",
              time: "10:00",
              body: "处理中",
              channelId: "dm:agent_coda",
              sessionId: "session-current",
              status: "running",
            },
          ],
        })}
        initialChatDraft="继续处理"
        locale="zh-CN"
        runtimeSetup={readyRuntime}
      />,
    );

    expect(html).toContain('data-testid="slei-send-button"');
    expect(html).toContain("disabled");
  });

  it("does not disable send for stale running messages from another session", () => {
    const html = renderToStaticMarkup(
      <SleiAppFrame
        activeConversationId="dm:agent_coda"
        activeSessionId="session-current"
        activeView="chat"
        data={createSleiFixtures({
          conversations: [codaDm],
          conversationSessions: codaSessions,
          members: [agent],
          messages: [
            {
              id: "run-old",
              author: "Coda",
              role: "agent",
              time: "09:00",
              body: "旧会话仍在处理中",
              channelId: "dm:agent_coda",
              sessionId: "session-old",
              status: "running",
            },
          ],
        })}
        initialChatDraft="新的消息"
        locale="zh-CN"
        runtimeSetup={readyRuntime}
      />,
    );

    expect(html).toContain('data-testid="slei-send-button"');
    expect(html).not.toContain('data-testid="slei-send-button" disabled=""');
    expect(html).not.toContain("旧会话仍在处理中");
  });

  it("does not show sessionless direct messages in a fresh active session", () => {
    const html = renderToStaticMarkup(
      <SleiAppFrame
        activeConversationId="dm:agent_coda"
        activeSessionId="session-current"
        activeView="chat"
        data={createSleiFixtures({
          conversations: [codaDm],
          conversationSessions: codaSessions,
          members: [agent],
          messages: [
            {
              id: "legacy-1",
              author: "Lei",
              role: "human",
              time: "09:00",
              body: "缺少 session 的旧消息",
              channelId: "dm:agent_coda",
            },
          ],
        })}
        locale="zh-CN"
        runtimeSetup={readyRuntime}
      />,
    );

    expect(html).not.toContain("缺少 session 的旧消息");
  });
});
