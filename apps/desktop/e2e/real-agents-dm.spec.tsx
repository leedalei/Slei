import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { findActiveAgentActivities, selectAgentActivityForTick, shouldRefreshConversationMessages, SleiAppFrame } from "../src/app/SleiApp";
import { formatLocalRecordDateTime } from "../src/app/model";
import { createSleiFixtures, type SleiMember } from "../src/test/fixtures";

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

function sendButtonMarkup(html: string) {
  return html.match(/<button\b(?=[^>]*data-testid="slei-send-button")[^>]*>/)?.[0] ?? "";
}

function agentCreateTitleMarkup(html: string) {
  return html.match(/<h2\b(?=[^>]*data-slot="dialog-title")[^>]*>[\s\S]*?创建智能体[\s\S]*?<\/h2>/)?.[0] ?? "";
}

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
    expect(html).not.toContain(">Lei</strong>");
  });

  it("shows real agents in the chat direct message list before a conversation exists", () => {
    const html = renderToStaticMarkup(
      <SleiAppFrame
        activeView="chat"
        data={createSleiFixtures({ members: [agent] })}
        locale="zh-CN"
        runtimeSetup={readyRuntime}
      />,
    );

    expect(html).toContain("私聊 1");
    expect(html).toContain("Coda");
    expect(html).toContain('data-member-id="agent_coda"');
    expect(html).not.toContain("真实创建的开发 Agent。");
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
    expect(html).toContain('<span class="min-w-0 truncate text-[14px] font-normal leading-5">Coda</span>');
    expect(html).not.toContain("真实创建的开发 Agent。");
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
    expect(html).toMatch(
      /aria-current="true"[\s\S]*?<span class="min-w-0 truncate text-\[14px\] font-normal leading-5">Coda<\/span>/,
    );
    expect(html).not.toMatch(/aria-current="true"[\s\S]{0,240}# all/);
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
    const currentButton = html.slice(html.indexOf('aria-current="true"'), html.indexOf("</button>", html.indexOf('aria-current="true"')));
    expect(currentButton).toContain("all</span>");
    expect(currentButton).not.toContain("<strong>Coda</strong>");
  });

  it("renders the agent create modal as an accessible dialog", () => {
    const html = renderToStaticMarkup(
      <SleiAppFrame
        activeView="members"
        data={createSleiFixtures({ members: [agent] })}
        initialAgentCreateModalOpen
        locale="zh-CN"
        runtimeSetup={readyRuntime}
      />,
    );

    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain("创建智能体");
    const title = agentCreateTitleMarkup(html);
    expect(title).toContain("text-lg");
    expect(title).toContain("font-semibold");
    expect(title).not.toContain("<svg");
    expect(html).toContain(">名字<");
    expect(html).not.toContain(">@handle<");
    expect(html).toContain(">运行环境<");
    expect(html).toContain(">职业设定<");
    expect(html).toContain(">关联设备 / 运行时<");
    expect(html).toContain(">模型<");
    expect(html).not.toContain(">描述来源<");
    expect(html).toContain('aria-label="关联设备"');
    expect(html).toContain('aria-label="运行时"');
    expect(html.match(/class="text-destructive">\*<\/span>/g) ?? []).toHaveLength(1);
    expect(html).toMatch(/<button\b[^>]*type="button"[\s\S]*?>下一步<\/button>/);
  });

  it("moves running and pending agent activity to the sidebar while keeping terminal replies in chat", () => {
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

    expect(html).not.toContain("我正在处理");
    expect(html).not.toContain("等待决断");
    expect(html).toContain('data-slot="agent-activity"');
    expect(html).toContain("Coda");
    expect(html).toContain("正在思考");
    expect(html).toContain("Claude auth missing");
    expect(html).toContain('aria-label="failed"');
    expect(html).toContain("已经发送完成");
    expect(html).not.toContain('aria-label="done"');
    expect(html).toContain("审批已通过");
    expect(html).toContain('aria-label="approval"');
    expect(html).not.toContain('aria-label="pending"');
  });

  it("keeps the first spawned active agent activity instead of rotating", () => {
    const cindy: SleiMember = { ...agent, id: "agent_cindy", name: "Cindy", handle: "@cindy", avatar: "CI" };
    const data = createSleiFixtures({
      conversations: [codaDm],
      members: [agent, cindy],
      messages: [
        {
          id: "run-coda",
          author: "Coda",
          handle: "@coda",
          role: "agent",
          time: "10:01",
          body: "Coda running",
          channelId: "dm:agent_coda",
          sessionId: "session-current",
          status: "running",
        },
        {
          id: "run-cindy",
          author: "Cindy",
          handle: "@cindy",
          role: "agent",
          time: "10:02",
          body: "Cindy running",
          channelId: "dm:agent_coda",
          sessionId: "session-current",
          status: "pending",
        },
      ],
    });

    const activities = findActiveAgentActivities(data, { id: "all", name: "all", description: "", unread: 0 }, codaDm, "session-current");

    expect(activities.map((activity) => activity.message.author)).toEqual(["Coda", "Cindy"]);
    expect(selectAgentActivityForTick(activities, 0)?.message.author).toBe("Coda");
    expect(selectAgentActivityForTick(activities, 1)?.message.author).toBe("Coda");
    expect(selectAgentActivityForTick(activities, 2)?.message.author).toBe("Coda");
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

  it("does not render removed session controls in chat headers", () => {
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

    expect(dmHtml).not.toContain("新会话");
    expect(dmHtml).not.toContain("重置会话");
    expect(dmHtml).not.toContain("历史对话");
    expect(dmHtml).not.toContain("Runtime 已检测");
    expect(dmHtml).not.toContain('aria-label="频道视图"');
    expect(dmHtml).not.toContain('data-testid="slei-channel-member-group"');
    expect(channelHtml).not.toContain("重置会话");
    expect(channelHtml).not.toContain("新会话");
    expect(channelHtml).not.toContain("历史对话");
    expect(channelHtml).toContain('data-testid="slei-channel-member-group"');
    expect(channelHtml).not.toContain('data-testid="slei-channel-members-header-toggle"');
    expect(channelHtml).not.toContain('data-testid="slei-channel-member-panel"');
  });

  it("shows the as-task composer toggle in direct messages and channels", () => {
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

    expect(dmHtml).toContain("转为任务");
    expect(channelHtml).toContain("转为任务");
  });

  it("renders direct message role, time, and icon-only copy action without identity text in message cards", () => {
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
    const messageStart = html.indexOf('data-message-id="current-1"');
    const rowHtml = html.slice(html.lastIndexOf("<article", messageStart), html.indexOf("</article>", messageStart));
    const headerStart = rowHtml.indexOf('data-slot="message-header"');
    const headerHtml = rowHtml.slice(rowHtml.lastIndexOf("<div", headerStart), rowHtml.indexOf("<div class=\"slei-markdown-message", headerStart));

    expect(messageStart).toBeGreaterThanOrEqual(0);
    expect(headerStart).toBeGreaterThanOrEqual(0);
    expect(headerHtml).toContain(">Coda<");
    expect(headerHtml).toContain("研发团队开发工程师");
    expect(headerHtml).not.toContain(">@coda<");
    expect(headerHtml).toContain("研发团队开发工程师");
    expect(headerHtml).toContain("10:00");
    expect(headerHtml).toContain('aria-label="复制"');
    expect(headerHtml).not.toContain(">复制</button>");
    expect(headerHtml.indexOf('aria-label="复制"')).toBeLessThan(headerHtml.indexOf(">10:00</time>"));
  });

  it("omits fallback role labels for unmatched direct message authors", () => {
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

    const messageStart = html.indexOf('data-message-id="current-1"');
    const rowHtml = html.slice(html.lastIndexOf("<article", messageStart), html.indexOf("</article>", messageStart));
    const headerStart = rowHtml.indexOf('data-slot="message-header"');
    const headerHtml = rowHtml.slice(rowHtml.lastIndexOf("<div", headerStart), rowHtml.indexOf("<div class=\"slei-markdown-message", headerStart));

    expect(messageStart).toBeGreaterThanOrEqual(0);
    expect(headerStart).toBeGreaterThanOrEqual(0);
    expect(headerHtml).not.toContain(">Lei<");
    expect(headerHtml).not.toContain(">@lei<");
    expect(headerHtml).not.toContain("用户");
  });

  it("uses the member name as the direct message detail title", () => {
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

    expect(html).toContain('aria-label="Coda"');
    expect(html).not.toContain("帮我检查历史会话");
  });

  it("renders the member conversation created time under direct message titles", () => {
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

    expect(html).toContain(formatLocalRecordDateTime("2026-05-29T10:00:00Z"));
    expect(html).not.toContain("@coda · 私聊");
  });

  it("keeps unnamed direct message sessions on the member title", () => {
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

    expect(html).toContain('aria-label="Coda"');
    expect(html).not.toContain("新会话");
  });

  it("renders direct messages without a session history drawer", () => {
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

    expect(html).not.toContain('aria-label="历史对话"');
    expect(html).not.toContain("历史对话");
    expect(html).not.toContain("帮我检查历史会话");
    expect(html).toContain("当前消息");
    expect(html).toContain("旧消息");
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

    const sendButton = sendButtonMarkup(html);
    expect(sendButton).toContain('data-testid="slei-send-button"');
    expect(sendButton).toContain(' disabled=""');
  });

  it("disables send while any direct message run is still active", () => {
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

    const sendButton = sendButtonMarkup(html);
    expect(sendButton).toContain('data-testid="slei-send-button"');
    expect(sendButton).toContain(' disabled=""');
  });

  it("shows sessionless direct messages after session UI is removed", () => {
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

    expect(html).toContain("缺少 session 的旧消息");
  });
});
