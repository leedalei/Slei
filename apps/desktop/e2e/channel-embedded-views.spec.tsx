import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SleiAppFrame } from "../src/app/SleiApp";
import { createSleiFixtures, type SleiMember } from "../src/app/fixtures";

const nodes = createSleiFixtures().nodes;
const readyRuntime = {
  loading: false,
  error: undefined,
  hasClaudeRuntimeReady: true,
  nodes,
};

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
  created: "2026-06-03T10:00:00Z",
  creator: "lei lee @lei-lee",
  runtime: "ClaudeCode",
  model: "Sonnet",
  instructions: "实现编码。",
  permissions: [],
  environmentVariables: [],
  createdAgents: [],
  activity: "待命",
  capabilities: ["代码实现"],
};

const dm = {
  id: "dm:agent_coda",
  kind: "dm",
  agentId: "agent_coda",
  activeSessionId: "session-current",
  createdAt: "2026-06-03T10:00:00Z",
  updatedAt: "2026-06-03T10:00:00Z",
} as const;

const session = {
  id: "session-current",
  conversationId: "dm:agent_coda",
  title: "频道视图设计",
  status: "ready",
  createdAt: "2026-06-03T10:00:00Z",
  updatedAt: "2026-06-03T10:00:00Z",
} as const;

describe("channel embedded views", () => {
  it("removes the runtime detected badge from channel headers", () => {
    const html = renderToStaticMarkup(
      <SleiAppFrame activeView="chat" data={createSleiFixtures()} locale="zh-CN" runtimeSetup={readyRuntime} />,
    );

    expect(html).toContain('aria-label="频道视图"');
    expect(html).toContain(">聊天</button>");
    expect(html).toContain(">任务</button>");
    expect(html).toContain(">附件</button>");
    expect(html).not.toContain("Runtime 已检测");
    expect(html).not.toContain("Runtime detected");
  });

  it("renders only current channel tasks and hides the composer in tasks view", () => {
    const html = renderToStaticMarkup(
      <SleiAppFrame
        activeChannelId="dev-team"
        activeView="chat"
        data={createSleiFixtures({
          channels: [
            { id: "dev-team", name: "dev-team", description: "研发频道", unread: 0 },
            { id: "ops", name: "ops", description: "运维频道", unread: 0 },
          ],
          tasks: [
            {
              id: "T-dev",
              title: "实现频道任务列表",
              owner: "Lei",
              status: "pending_assignment",
              channelId: "dev-team",
              attention: "等待确认",
              replies: [{ id: "r1", sender: "Lei", role: "human", body: "任务根消息" }],
            },
            { id: "T-ops", title: "不要展示其他频道任务", owner: "Ops", status: "pending_assignment", channelId: "ops" },
          ],
        })}
        initialChannelView="tasks"
        locale="zh-CN"
        runtimeSetup={readyRuntime}
      />,
    );

    expect(html).toContain('aria-label="任务"');
    const taskPanelTag = html.match(/<section\b(?=[^>]*aria-label="任务")[^>]*>/)?.[0] ?? "";
    expect(taskPanelTag).toContain("h-full");
    expect(taskPanelTag).toContain("min-h-0");
    expect(taskPanelTag).toContain("overflow-hidden");
    const taskPanelHtml = html.slice(html.indexOf('aria-label="任务"'));
    expect(taskPanelHtml).toContain('data-slot="scroll-area"');
    expect(html).toContain("实现频道任务列表");
    expect(html).toContain("等待确认");
    expect(html).toContain("1 条回复");
    expect(html).not.toContain("不要展示其他频道任务");
    expect(html).not.toContain('aria-label="输入消息到 #dev-team"');
    expect(html).not.toContain('data-testid="slei-send-button"');
    expect(html).toContain('aria-current="page"');
  });

  it("renders only current channel attachments and hides the composer in files view", () => {
    const html = renderToStaticMarkup(
      <SleiAppFrame
        activeChannelId="dev-team"
        activeView="chat"
        data={createSleiFixtures({
          channels: [
            { id: "dev-team", name: "dev-team", description: "研发频道", unread: 0 },
            { id: "ops", name: "ops", description: "运维频道", unread: 0 },
          ],
          messages: [
            {
              id: "m-dev",
              author: "Lei",
              role: "human",
              time: "10:10",
              body: "看附件",
              channelId: "dev-team",
              attachments: [
                { id: "att-dev-image", name: "screen.png", mimeType: "image/png", size: 1200, url: "data:image/png;base64,AAA=" },
                { id: "att-dev-file", name: "notes.md", mimeType: "text/markdown", size: 2048 },
              ],
            },
            {
              id: "m-ops",
              author: "Ops",
              role: "human",
              time: "10:20",
              body: "其他频道附件",
              channelId: "ops",
              attachments: [{ id: "att-ops", name: "ops.log", mimeType: "text/plain", size: 100 }],
            },
          ],
        })}
        initialChannelView="files"
        locale="zh-CN"
        runtimeSetup={readyRuntime}
      />,
    );

    expect(html).toContain('aria-label="附件"');
    expect(html).toContain("screen.png");
    expect(html).toContain("notes.md");
    expect(html).toContain("Lei · 10:10");
    expect(html).toContain('aria-label="打开附件 screen.png"');
    expect(html).toContain("<img");
    expect(html).not.toContain("ops.log");
    expect(html).not.toContain('aria-label="输入消息到 #dev-team"');
    expect(html).not.toContain('data-testid="slei-send-button"');
  });

  it("keeps direct message session actions instead of channel tabs", () => {
    const html = renderToStaticMarkup(
      <SleiAppFrame
        activeConversationId="dm:agent_coda"
        activeSessionId="session-current"
        activeView="chat"
        data={createSleiFixtures({ conversations: [dm], conversationSessions: [session], members: [agent] })}
        locale="zh-CN"
        runtimeSetup={readyRuntime}
      />,
    );

    expect(html).toContain("新会话");
    expect(html).toContain("历史对话");
    expect(html).not.toContain('aria-label="频道视图"');
  });
});
