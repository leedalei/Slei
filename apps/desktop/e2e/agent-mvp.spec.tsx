import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  agentsForComputerNode,
  detectAgentMemoryRequest,
  SleiAppFrame,
} from "../src/app/SleiApp";
import { createSleiFixtures, type SleiMember } from "../src/test/fixtures";
import type { DesktopNodeView } from "../src/lib/daemon-bridge";

const nodes: DesktopNodeView[] = [
  {
    id: "local-node",
    name: "Local Mac",
    status: "connected",
    daemonVersion: "0.54.1",
    device: {
      platform: "darwin",
      arch: "arm64",
      hostname: "local-mac.local",
    },
    runtimes: [{ kind: "ClaudeCode", readiness: "ready", version: "1.0.54" }],
  },
  {
    id: "remote-linux",
    name: "Remote Linux",
    status: "offline",
    daemonVersion: "0.54.1",
    device: {
      platform: "linux",
      arch: "x64",
      hostname: "remote-linux.local",
    },
    runtimes: [{ kind: "ClaudeCode", readiness: "ready", version: "1.0.54" }],
  },
];

const members: SleiMember[] = [
  {
    id: "agent_coda",
    name: "Coda",
    handle: "@coda",
    avatar: "CO",
    avatarSeed: "agent_coda",
    type: "agent",
    runtimeStatus: "idle",
    role: "开发工程师",
    description: "负责实现编码。",
    computer: "Local Mac",
    nodeId: "local-node",
    created: "May 29, 2026",
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
    workspaceEntries: [
      { kind: "directory", name: ".claude", relativePath: ".claude" },
      { kind: "directory", name: "docs", relativePath: "docs" },
      { kind: "file", name: "MEMORY.md", relativePath: "MEMORY.md" },
    ],
    workspaceFilePreview: {
      name: "MEMORY.md",
      relativePath: "MEMORY.md",
      content: "# MEMORY.md\n\n实现编码。",
    },
    skills: [
      {
        id: "guide-create",
        name: "引导创建",
        trigger: "识别创建智能体、成员、频道的请求",
        path: "~/.slei/agents/agent_coda/.claude/skills/guide-create/SKILL.md",
      },
      {
        id: "memory",
        name: "记忆",
        trigger: "提及 @coda 并使用 remember、learn 或 记住",
        path: "~/.slei/agents/agent_coda/.claude/skills/memory/SKILL.md",
      },
    ],
  },
  {
    id: "agent_nancy",
    name: "Nancy",
    handle: "@nancy",
    avatar: "NA",
    avatarSeed: "agent_nancy",
    type: "agent",
    runtimeStatus: "idle",
    role: "QA",
    description: "负责质量审查。",
    computer: "Remote Linux",
    nodeId: "remote-linux",
    created: "May 29, 2026",
    creator: "lei lee @lei-lee",
    runtime: "ClaudeCode",
    model: "Sonnet",
    instructions: "审查质量。",
    permissions: [],
    environmentVariables: [],
    createdAgents: [],
    activity: "待命",
    capabilities: ["QA"],
    workspacePath: "~/.slei/agents/agent_nancy",
    memoryPath: "~/.slei/agents/agent_nancy/MEMORY.md",
    docsPath: "~/.slei/agents/agent_nancy/docs",
    workspaceEntries: [
      { kind: "directory", name: ".claude", relativePath: ".claude" },
      { kind: "file", name: "MEMORY.md", relativePath: "MEMORY.md" },
    ],
    workspaceFilePreview: {
      name: "MEMORY.md",
      relativePath: "MEMORY.md",
      content: "# MEMORY.md\n\n审查质量。",
    },
  },
];

const data = createSleiFixtures({ nodes, members });
const readyRuntime = {
  loading: false,
  error: undefined,
  hasClaudeRuntimeReady: true,
  nodes,
};

describe("agent creation, device association, and memory MVP", () => {
  it("derives hosted agents from node ids instead of device names", () => {
    expect(agentsForComputerNode(nodes[0], data.members).map((member) => member.name)).toEqual(["Coda"]);
    expect(agentsForComputerNode(nodes[1], data.members).map((member) => member.name)).toEqual(["Nancy"]);
  });

  it("renders members with real selection, workspace content, and no removed feature tabs", () => {
    const html = renderToStaticMarkup(
      <SleiAppFrame
        activeMemberId="agent_nancy"
        activeView="members"
        data={data}
        locale="zh-CN"
        runtimeSetup={readyRuntime}
      />,
    );

    expect(html).toContain('aria-current="true"');
    expect(html).toContain("Nancy");
    expect(html).toContain("私聊");
    expect(html).toContain("QA");
    expect(html).toContain("能力");
    expect(html).toContain("工作区");
    expect(html).toContain("MEMORY.md");
    expect(html).toContain(".claude/");
    expect(html).not.toContain("~/.slei/agents/agent_nancy/MEMORY.md");
    expect(html).not.toContain("Agent 私信");
    expect(html).not.toContain("提醒");
    expect(html).not.toContain("应用");
  });

  it("renders member details with YYYY-MM-DD created date, clickable workspace paths, and skill cards", () => {
    const html = renderToStaticMarkup(
      <SleiAppFrame
        activeMemberId="agent_coda"
        activeView="members"
        data={createSleiFixtures({
          members: [
            {
              ...members[0],
              created: "2026-05-29T07:28:51.000Z",
            },
          ],
          nodes,
        })}
        locale="zh-CN"
        runtimeSetup={readyRuntime}
      />,
    );

    expect(html).toContain("2026-05-29");
    expect(html).not.toContain("20260529");
    expect(html).not.toContain("2026-05-29T07:28:51.000Z");
    expect(html).toContain("工作区");
    expect(html).toContain("MEMORY.md");
    expect(html).toContain("docs/");
    expect(html).toContain(".claude/");
    expect(html).not.toContain("~/.slei/agents/agent_coda/MEMORY.md");
    expect(html).toContain("引导创建</span>");
    expect(html).toContain("识别创建智能体、成员、频道的请求");
  });

  it("opens a complete agent creation modal from the members plus button", () => {
    const html = renderToStaticMarkup(
      <SleiAppFrame
        activeView="members"
        data={data}
        initialAgentCreateModalOpen
        locale="zh-CN"
        runtimeSetup={readyRuntime}
      />,
    );

    expect(html).toContain("slei-agent-modal");
    expect(html).toContain("创建智能体");
    expect(html).toContain("Runtime");
    expect(html).toContain("名字");
    expect(html).toContain("@handle");
    expect(html).toContain("关联设备");
    expect(html).toContain("描述");
    expect(html.match(/class="text-destructive">\*<\/span>/g) ?? []).toHaveLength(2);
  });

  it("detects explicit remember requests without deriving guide-created agent drafts", () => {
    expect(detectAgentMemoryRequest("@nancy 记住：以后优先检查安全漏洞", data.members)).toEqual({
      agentId: "agent_nancy",
      fact: "以后优先检查安全漏洞",
    });
    expect(detectAgentMemoryRequest("@coda remember use pnpm for desktop checks", data.members)).toEqual({
      agentId: "agent_coda",
      fact: "use pnpm for desktop checks",
    });
  });

  it("does not render guide draft cards from composer text", () => {
    const html = renderToStaticMarkup(
      <SleiAppFrame
        activeView="chat"
        data={data}
        initialChatDraft="帮我创建一个叫 Nancy 的 QA Agent"
        locale="zh-CN"
        runtimeSetup={readyRuntime}
      />,
    );

    expect(html).not.toContain("slei-agent-draft-card");
    expect(html).not.toContain("创建智能体草案");
  });

  it("renders channel hash as UI chrome only and never doubles it", () => {
    const html = renderToStaticMarkup(
      <SleiAppFrame
        activeChannelId="all"
        activeView="chat"
        data={createSleiFixtures({
          channels: [{ id: "all", name: "#all", description: "默认频道", unread: 0 }],
          members,
          nodes,
        })}
        locale="zh-CN"
        runtimeSetup={readyRuntime}
      />,
    );

    expect(html).toContain("输入消息到 #all");
    expect(html).not.toContain("##all");
    expect(html).not.toContain("# #all");
    expect(html).not.toContain("># all</span>");
  });

  it("renders compact create interactive cards and disables completed cards", () => {
    const html = renderToStaticMarkup(
      <SleiAppFrame
        activeView="chat"
        data={createSleiFixtures({
          members,
          nodes,
          messages: [
            {
              id: "m-card",
              author: "Yeal",
              role: "agent",
              time: "10:00",
              body: "我整理了一个创建草案。",
              channelId: "all",
              cards: [
                {
                  id: "card_1",
                  kind: "createAgent",
                  state: "done",
                  title: "创建智能体草案",
                  summary: "Nancy · ClaudeCode / Sonnet",
                  draft: { name: "Nancy" },
                  actionLabel: "创建",
                  doneLabel: "DONE",
                },
              ],
            },
          ],
        })}
        locale="zh-CN"
        runtimeSetup={readyRuntime}
      />,
    );

    expect(html).toContain('data-card-kind="createAgent"');
    expect(html).toContain('data-slot="card"');
    expect(html).toContain("Nancy · ClaudeCode / Sonnet");
    expect(html).not.toContain('data-variant="destructive"');
    expect(html).toContain('data-slot="button"');
    expect(html).toContain('data-slot="card-action"');
    expect(html).toContain("self-center");
    expect(html).toContain("disabled=\"\"");
    expect(html).toContain("已完成");
  });

  it("renders multiple persisted guide card messages separately", () => {
    const html = renderToStaticMarkup(
      <SleiAppFrame
        activeView="chat"
        data={createSleiFixtures({
          members,
          nodes,
          messages: [
            {
              id: "m-guide-summary",
              author: "Yeal",
              role: "agent",
              time: "10:00",
              body: "识别到 2 个成员创建请求。",
              channelId: "all",
            },
            {
              id: "card_message_card_1",
              author: "Yeal",
              role: "agent",
              time: "10:01",
              body: "",
              channelId: "all",
              status: "done",
              cards: [
                {
                  id: "card_1",
                  kind: "createAgent",
                  state: "pending",
                  title: "创建智能体草案",
                  summary: "Nancy · ClaudeCode / Sonnet",
                  draft: { name: "Nancy" },
                  actionLabel: "创建",
                  doneLabel: "DONE",
                },
              ],
            },
            {
              id: "card_message_card_2",
              author: "Yeal",
              role: "agent",
              time: "10:02",
              body: "",
              channelId: "all",
              status: "done",
              cards: [
                {
                  id: "card_2",
                  kind: "createAgent",
                  state: "pending",
                  title: "创建智能体草案",
                  summary: "Alice · ClaudeCode / Sonnet",
                  draft: { name: "Alice" },
                  actionLabel: "创建",
                  doneLabel: "DONE",
                },
              ],
            },
          ],
        })}
        locale="zh-CN"
        runtimeSetup={readyRuntime}
      />,
    );

    expect(html.match(/data-card-kind="createAgent"/g)).toHaveLength(2);
    expect(html).toContain("Nancy · ClaudeCode / Sonnet");
    expect(html).toContain("Alice · ClaudeCode / Sonnet");
  });
});
