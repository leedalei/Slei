import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SleiAppFrame } from "../src/app/SleiApp";
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
  createdAt: "2026-05-29T10:00:00Z",
  updatedAt: "2026-05-29T10:00:00Z",
} as const;

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
    expect(html).toContain("@coda");
    expect(html).toContain("Coda");
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
});
