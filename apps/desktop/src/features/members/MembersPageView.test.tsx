// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createDesktopMessages } from "../../i18n";
import { createSleiFixtures } from "../../test/fixtures";
import type { AgentActivityLogView, DesktopNodeView } from "../../lib/daemon-bridge";
import { buildWorkspaceTreeRows, MembersPage } from "./MembersPageView";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const baseNode: DesktopNodeView = {
  id: "local-node",
  name: "Local",
  status: "connected",
  daemonVersion: "0.1.0",
  device: { platform: "darwin", arch: "arm64", hostname: "local" },
  runtimes: [{ kind: "ClaudeCode", readiness: "ready" }],
};

function agentMember(id: string, name = "Coda") {
  return {
    id,
    name,
    handle: `@${name.toLowerCase()}`,
    avatar: name.slice(0, 2).toUpperCase(),
    avatarSeed: id,
    type: "agent" as const,
    runtimeStatus: "idle" as const,
    role: "Developer",
    runtime: "ClaudeCode",
    model: "Sonnet",
    computer: "Local",
    nodeId: "local-node",
    created: "2026-06-04",
    creator: "user",
    instructions: "Builds features.",
    description: "Builds features.",
    permissions: [],
    environmentVariables: [],
    activity: "Idle",
    skills: [],
    capabilities: ["ClaudeCode"],
    createdAgents: [],
    directMessageEnabled: true,
  };
}

function activityLog(input: Partial<AgentActivityLogView> = {}): AgentActivityLogView {
  return {
    id: input.id ?? "activity_1",
    agentId: input.agentId ?? "agent_coda",
    runId: input.runId ?? "run_123",
    channelId: input.channelId,
    messageId: input.messageId,
    taskId: input.taskId,
    state: input.state ?? "completed",
    phase: input.phase,
    reason: input.reason,
    eventKind: input.eventKind ?? "tool_call",
    severity: input.severity ?? "info",
    summary: input.summary ?? "Ran shell command",
    payloadPreview: input.payloadPreview,
    toolName: input.toolName ?? "shell",
    ok: input.ok ?? true,
    createdAt: input.createdAt ?? "2026-06-17T08:00:00.000Z",
  };
}

function renderMembersPage(input: Partial<Parameters<typeof MembersPage>[0]> = {}) {
  const messages = input.messages ?? createDesktopMessages("zh-CN");
  return (
    <MembersPage
      activeMemberId="agent_coda"
      data={createSleiFixtures({ members: [agentMember("agent_coda")] })}
      messages={messages}
      nodes={[baseNode]}
      onAgentUpdate={() => undefined}
      onMessage={() => undefined}
      {...input}
    />
  );
}

let mountedRoot: Root | undefined;
let mountedContainer: HTMLDivElement | undefined;

async function mount(element: React.ReactElement) {
  mountedContainer = document.createElement("div");
  document.body.appendChild(mountedContainer);
  mountedRoot = createRoot(mountedContainer);
  await act(async () => {
    mountedRoot?.render(element);
  });
  await act(async () => undefined);
  return mountedContainer;
}

async function clickTab(host: HTMLElement, label: string) {
  const tab = Array.from(host.querySelectorAll('[role="tab"]')).find((element) => element.textContent === label);
  expect(tab).toBeTruthy();
  await act(async () => {
    tab?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0, ctrlKey: false }));
    tab?.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0, ctrlKey: false }));
    (tab as HTMLElement | undefined)?.click();
  });
  await act(async () => undefined);
}

function activeTabPanel(host: HTMLElement) {
  const panel = host.querySelector('[role="tabpanel"][data-state="active"]');
  expect(panel).toBeTruthy();
  return panel as HTMLElement;
}

afterEach(async () => {
  if (mountedRoot) {
    await act(async () => {
      mountedRoot?.unmount();
    });
  }
  mountedContainer?.remove();
  mountedRoot = undefined;
  mountedContainer = undefined;
});

describe("MembersPage agent details", () => {
  it("makes the member detail header draggable without marking action buttons as drag regions", () => {
    const messages = createDesktopMessages("zh-CN");
    const html = renderToStaticMarkup(renderMembersPage({ messages }));
    const headerStart = html.indexOf('data-testid="slei-member-detail-header"');
    const headerEnd = html.indexOf("</header>", headerStart);
    const headerHtml = html.slice(headerStart, headerEnd);
    const messageButtonStart = headerHtml.indexOf(`>${messages.members.message}<`);
    const deleteButtonStart = headerHtml.indexOf(`>${messages.members.deleteAgent}<`);

    expect(headerStart).toBeGreaterThanOrEqual(0);
    expect(html).toContain("data-slei-page-header");
    expect(headerHtml).toContain("data-slei-status");
    expect(html).not.toContain('<header class="select-none border-b bg-background px-6 py-5"');
    expect(html).toContain('<div class="select-none border-b bg-background px-6 py-5" data-testid="slei-member-detail-header"');
    expect(headerHtml).toContain('data-tauri-drag-region="deep"');
    expect(messageButtonStart).toBeGreaterThanOrEqual(0);
    expect(headerHtml.slice(messageButtonStart - 160, messageButtonStart + 80)).not.toContain("data-tauri-drag-region");
    expect(deleteButtonStart).toBeGreaterThanOrEqual(0);
    expect(headerHtml.slice(deleteButtonStart - 180, deleteButtonStart + 80)).not.toContain("data-tauri-drag-region");
  });

  it("keeps the member header message action clickable inside the drag-enabled header", async () => {
    const messages = createDesktopMessages("zh-CN");
    const onMessage = vi.fn();
    const host = await mount(renderMembersPage({ messages, onMessage }));
    const messageButton = Array.from(host.querySelectorAll("button")).find((button) => button.textContent?.includes(messages.members.message));

    expect(messageButton).toBeDefined();
    await act(async () => {
      messageButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onMessage).toHaveBeenCalledWith("agent_coda");
  });

  it("keeps the page title text free of avatar fallback glyphs", async () => {
    const host = await mount(renderMembersPage());

    expect(host.querySelector("[data-slei-page-header-title]")?.textContent).toBe("Coda");
  });

  it("uses the shared channel tab bar height for member detail tabs", () => {
    const html = renderToStaticMarkup(renderMembersPage());
    const marker = 'data-testid="slei-member-detail-tabs"';
    const markerIndex = html.indexOf(marker);

    expect(markerIndex).toBeGreaterThanOrEqual(0);
    expect(html.slice(Math.max(0, markerIndex - 180), markerIndex + 180)).toContain("border-b px-4 py-2");
    const tabsHtml = html.slice(markerIndex, markerIndex + 1200);
    expect(tabsHtml).toContain('data-slot="tabs-list"');
    expect(tabsHtml).toContain('data-variant="line"');
    expect(tabsHtml).toContain("h-12");
  });

  it("renders a dedicated permissions tab label between capabilities and activity", async () => {
    const messages = createDesktopMessages("zh-CN");
    const host = await mount(renderMembersPage({ messages }));
    const labels = Array.from(host.querySelectorAll('[role="tab"]')).map((tab) => tab.textContent);

    expect(labels).toEqual([
      messages.members.profile,
      messages.members.workspace,
      messages.members.capabilities,
      messages.members.permissions,
      messages.members.activity,
    ]);
  });

  it("shows ordinary agent runtime configuration with a direct message action", () => {
    const messages = createDesktopMessages("en-US");
    const html = renderToStaticMarkup(
      <MembersPage
        activeMemberId="agent_coda"
        data={createSleiFixtures({
          members: [
            {
              id: "agent_coda",
              name: "Coda",
              handle: "@coda",
              avatar: "CO",
              avatarSeed: "agent_coda",
              type: "agent",
              runtimeStatus: "idle",
              role: "Developer",
              runtime: "ClaudeCode",
              model: "Sonnet",
              computer: "Local",
              nodeId: "local-node",
              created: "2026-06-04",
              creator: "system",
              instructions: "Builds features.",
              description: "Builds features.",
              permissions: [],
              environmentVariables: [],
              activity: "Idle",
              skills: [],
              capabilities: ["ClaudeCode"],
              createdAgents: [],
              directMessageEnabled: true,
            },
          ],
        })}
        messages={messages}
        nodes={[
          {
            id: "local-node",
            name: "Local",
            status: "connected",
            daemonVersion: "0.1.0",
            device: { platform: "darwin", arch: "arm64", hostname: "local" },
            runtimes: [{ kind: "ClaudeCode", readiness: "ready" }],
          },
        ]}
        onAgentUpdate={() => undefined}
        onMessage={() => undefined}
      />,
    );

    expect(html).toContain("Coda");
    expect(html).toContain("@coda");
    expect(html).toContain("Builds features.");
    expect(html).toContain("Runtime configuration");
    expect(html).toContain(">Online<");
    expect(html).not.toContain(">idle<");
    expect(html).toContain("ClaudeCode");
    expect(html).toContain("Capabilities");
    expect(html).toContain("Workspace");
    expect(html).toContain(`>${messages.members.message}<`);
  });

  it("uses EinUI card slots and secondary detail blocks in member profile details", () => {
    const html = renderToStaticMarkup(renderMembersPage());

    expect(html).toContain('data-slot="card"');
    expect(html).toContain("data-slei-status");
    expect(html).toContain('data-slot="detail-block"');
    expect(html).toContain('data-member-detail-block="computer"');
  });

  it("renders member profile sections as content cards", async () => {
    const host = await mount(renderMembersPage());
    const panel = activeTabPanel(host);
    const profileCards = Array.from(panel.querySelectorAll<HTMLElement>('[data-slot="card"]'));
    const detailBlocks = Array.from(panel.querySelectorAll<HTMLElement>("[data-member-detail-block]"));

    expect(profileCards).toHaveLength(2);
    for (const card of profileCards) {
      expect(card.className).toContain("grid");
      expect(card.className).toContain("text-card-foreground");
      expect(card.className).not.toContain("bg-card/80");
      expect(card.className).not.toContain("bg-muted/40");
    }

    expect(detailBlocks).toHaveLength(3);
    for (const block of detailBlocks) {
      expect(block.className).toContain("border");
      expect(block.className).not.toContain("bg-muted/40");
      expect(block.className).not.toContain("bg-card/80");
    }
  });

  it("shows a delete action for ordinary agents", () => {
    const messages = createDesktopMessages("en-US");
    const html = renderToStaticMarkup(
      <MembersPage
        activeMemberId="agent_coda"
        data={createSleiFixtures({
          members: [
            {
              id: "agent_coda",
              name: "Coda",
              handle: "@coda",
              avatar: "CO",
              avatarSeed: "agent_coda",
              type: "agent",
              runtimeStatus: "idle",
              role: "Developer",
              runtime: "ClaudeCode",
              model: "Sonnet",
              computer: "Local",
              nodeId: "local-node",
              created: "2026-06-04",
              creator: "user",
              instructions: "Builds features.",
              description: "Builds features.",
              permissions: [],
              environmentVariables: [],
              activity: "Idle",
              skills: [],
              capabilities: ["ClaudeCode"],
              createdAgents: [],
              directMessageEnabled: true,
            },
          ],
        })}
        messages={messages}
        nodes={[
          {
            id: "local-node",
            name: "Local",
            status: "connected",
            daemonVersion: "0.1.0",
            device: { platform: "darwin", arch: "arm64", hostname: "local" },
            runtimes: [{ kind: "ClaudeCode", readiness: "ready" }],
          },
        ]}
        onAgentDelete={() => undefined}
        onAgentUpdate={() => undefined}
        onMessage={() => undefined}
      />,
    );

    expect(html).toContain(`>${messages.members.message}<`);
    expect(html).toContain(`>${messages.members.deleteAgent}<`);
    expect(html.match(/@coda/g)).toHaveLength(1);
    expect(html).toContain('<span class="truncate text-xs text-muted-foreground" data-tauri-drag-region="deep">@coda</span>');
    expect(html).toContain('aria-label="Copy"');
    expect(html).not.toContain('<p class="text-sm text-muted-foreground">Developer</p>');
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain("data-slei-page-header-actions");
    expect(html).not.toContain(messages.members.deleteAgentConfirm("Coda"));
    expect(html).toContain("Capabilities");
    expect(html).toContain("ClaudeCode");
  });

  it("uses the short Chinese delete action label in the member header", () => {
    const messages = createDesktopMessages("zh-CN");
    const html = renderToStaticMarkup(renderMembersPage({ messages }));

    expect(html).toContain(">删除<");
    expect(html).not.toContain(">删除智能体<");
  });

  it("shows the profile description only in the editable description field", () => {
    const messages = createDesktopMessages("zh-CN");
    const description = "回答关于 Slei App 如何使用的问题，用于帮助和引导用户建立自己的团队。";
    const html = renderToStaticMarkup(
      <MembersPage
        activeMemberId="agent_yeal"
        data={createSleiFixtures({
          members: [
            {
              id: "agent_yeal",
              name: "Yeal",
              handle: "@yeal",
              avatar: "YE",
              avatarSeed: "agent_yeal",
              type: "agent",
              runtimeStatus: "idle",
              role: "Guide",
              runtime: "ClaudeCode",
              model: "Sonnet",
              computer: "Local",
              nodeId: "local-node",
              created: "2026-06-04",
              creator: "system",
              instructions: "Guide users.",
              description,
              permissions: [],
              environmentVariables: [],
              activity: "Idle",
              skills: [],
              capabilities: ["ClaudeCode"],
              createdAgents: [],
              directMessageEnabled: true,
            },
          ],
        })}
        messages={messages}
        nodes={[
          {
            id: "local-node",
            name: "Local",
            status: "connected",
            daemonVersion: "0.1.0",
            device: { platform: "darwin", arch: "arm64", hostname: "local" },
            runtimes: [{ kind: "ClaudeCode", readiness: "ready" }],
          },
        ]}
        onAgentUpdate={() => undefined}
        onMessage={() => undefined}
      />,
    );

    expect(html).toContain(`>${messages.members.description}<`);
    expect(html.match(new RegExp(description, "g")) ?? []).toHaveLength(2);
  });

  it("renders the agent workspace as a file explorer backed by directory entries", () => {
    const messages = createDesktopMessages("zh-CN");
    const html = renderToStaticMarkup(
      <MembersPage
        activeMemberId="agent_coda"
        data={createSleiFixtures({
          members: [
            {
              id: "agent_coda",
              name: "Coda",
              handle: "@coda",
              avatar: "CO",
              avatarSeed: "agent_coda",
              type: "agent",
              runtimeStatus: "idle",
              role: "Developer",
              runtime: "ClaudeCode",
              model: "Sonnet",
              computer: "Local",
              nodeId: "local-node",
              created: "2026-06-04",
              creator: "user",
              instructions: "Builds features.",
              description: "Builds features.",
              permissions: [],
              environmentVariables: [],
              activity: "Idle",
              skills: [{ id: "memory", name: "memory", trigger: "remember facts", path: "~/.slei/agents/agent_coda/.claude/skills/memory/SKILL.md" }],
              capabilities: ["ClaudeCode"],
              createdAgents: [],
              directMessageEnabled: true,
              workspacePath: "~/.slei/agents/agent_coda",
              memoryPath: "~/.slei/agents/agent_coda/MEMORY.md",
              docsPath: "~/.slei/agents/agent_coda/docs",
              workspaceEntries: [
                {
                  kind: "directory",
                  name: ".claude",
                  relativePath: ".claude",
                },
                {
                  kind: "file",
                  name: "MEMORY-with-a-very-long-file-name-that-should-not-overflow-the-sidebar.md",
                  relativePath: "MEMORY.md",
                },
              ],
              workspaceFilePreview: {
                content: "# Memory\nCoda prefers concise implementation notes.",
                name: "MEMORY-with-a-very-long-file-name-that-should-not-overflow-the-sidebar.md",
                relativePath: "MEMORY.md",
              },
            },
          ],
        })}
        messages={messages}
        nodes={[
          {
            id: "local-node",
            name: "Local",
            status: "connected",
            daemonVersion: "0.1.0",
            device: { platform: "darwin", arch: "arm64", hostname: "local" },
            runtimes: [{ kind: "ClaudeCode", readiness: "ready" }],
          },
        ]}
        onAgentDelete={() => undefined}
        onAgentUpdate={() => undefined}
        onMessage={() => undefined}
      />,
    );

    const host = document.createElement("div");
    host.innerHTML = html;
    const workspaceRegion = host.querySelector<HTMLElement>('[aria-label="工作区"][role="region"]');
    expect(workspaceRegion).not.toBeNull();
    const workspaceHtml = workspaceRegion?.outerHTML ?? "";

    expect(html).toContain("文件预览");
    expect(html).not.toContain("<h2 class=\"text-sm font-semibold\">文件</h2>");
    expect(html).not.toContain("~/.slei/agents/agent_coda</p>");
    expect(html).toContain("MEMORY-with-a-very-long-file-name-that-should-not-overflow-the-sidebar.md");
    expect(html).toContain(".claude");
    expect(workspaceHtml).not.toContain("memory</span>");
    expect(workspaceHtml).not.toContain("remember facts");
    expect(html).toContain("w-full min-w-0 overflow-hidden justify-start gap-2 whitespace-nowrap");
    expect(html).toContain("Coda prefers concise implementation notes.");
    expect(html).toContain("通过资源管理器打开");
    expect(html).not.toContain("通过 daemon 打开");
  });

  it("does not invent default workspace entries when directory entries are unavailable", () => {
    const messages = createDesktopMessages("zh-CN");
    const html = renderToStaticMarkup(
      <MembersPage
        activeMemberId="agent_empty"
        data={createSleiFixtures({
          members: [
            {
              id: "agent_empty",
              name: "Empty",
              handle: "@empty",
              avatar: "EM",
              avatarSeed: "agent_empty",
              type: "agent",
              runtimeStatus: "idle",
              role: "Developer",
              runtime: "ClaudeCode",
              model: "Sonnet",
              computer: "Local",
              nodeId: "local-node",
              created: "2026-06-04",
              creator: "user",
              instructions: "Builds features.",
              description: "Builds features.",
              permissions: [],
              environmentVariables: [],
              activity: "Idle",
              skills: [],
              capabilities: ["ClaudeCode"],
              createdAgents: [],
              directMessageEnabled: true,
              workspaceEntries: [],
            },
          ],
        })}
        messages={messages}
        nodes={[
          {
            id: "local-node",
            name: "Local",
            status: "connected",
            daemonVersion: "0.1.0",
            device: { platform: "darwin", arch: "arm64", hostname: "local" },
            runtimes: [{ kind: "ClaudeCode", readiness: "ready" }],
          },
        ]}
        onAgentUpdate={() => undefined}
        onMessage={() => undefined}
      />,
    );

    expect(html).toContain("文件预览");
    expect(html).not.toContain(".claude");
    expect(html).not.toContain("docs/");
    expect(html).not.toContain("MEMORY.md");
  });

  it("flattens expanded workspace folders inline like a code editor", () => {
    const rows = buildWorkspaceTreeRows({
      entriesByDirectory: {
        "": [
          { kind: "directory", name: ".claude", relativePath: ".claude" },
          { kind: "file", name: "MEMORY.md", relativePath: "MEMORY.md" },
        ],
        ".claude": [
          { kind: "directory", name: "skills", relativePath: ".claude/skills" },
        ],
        ".claude/skills": [
          { kind: "directory", name: "memory", relativePath: ".claude/skills/memory" },
        ],
        ".claude/skills/memory": [
          { kind: "file", name: "SKILL.md", relativePath: ".claude/skills/memory/SKILL.md" },
        ],
      },
      expandedDirectories: new Set([".claude", ".claude/skills", ".claude/skills/memory"]),
    });

    expect(rows.map((row) => `${row.depth}:${row.entry.relativePath}`)).toEqual([
      "0:.claude",
      "1:.claude/skills",
      "2:.claude/skills/memory",
      "3:.claude/skills/memory/SKILL.md",
      "0:MEMORY.md",
    ]);
  });

  it("renders the activity tab with daemon activity rows", async () => {
    const messages = createDesktopMessages("zh-CN");
    const html = renderToStaticMarkup(
      renderMembersPage({
        messages,
        onListAgentActivity: async () => ({
          logs: [activityLog({ eventKind: "agent_run.completed", runId: "run_agent_42", summary: "Agent finished replying" })],
        }),
      }),
    );

    expect(html).toContain("活动日志");

    const log = activityLog({
      channelId: "内容营销开发",
      eventKind: "run.started",
      messageId: "msg_51999709e5f243388faaf416608793c4",
      ok: true,
      runId: "run_2a5ee1b7a27c41feab974274dd238dee",
      state: "run.started",
      summary: "运行开始：run=run_2a5ee1b7a27c41feab974274dd238dee",
    });
    const container = await mount(
      renderMembersPage({
        messages,
        onListAgentActivity: async () => ({
          logs: [log],
        }),
      }),
    );

    const row = container.querySelector(`[data-activity-log-row="${log.id}"]`);
    expect(row).toBeTruthy();
    expect(row?.closest('[data-slot="card"]')).toBeNull();
    expect(row?.className).toContain("rounded-lg");
    expect(row?.className).toContain("border");
    expect(row?.querySelector('[data-activity-log-line="meta"]')?.textContent).toBe("info | run.started | 成功 | #内容营销开发");
    expect(row?.querySelector('[data-activity-log-line="summary"]')?.textContent).toBe("运行开始：run=run_2a5ee1b7a27c41feab974274dd238dee");
    expect(row?.querySelector('[data-activity-log-line="time"]')?.textContent).toBe("2026-06-17 16:00:00");
    expect(row?.textContent).not.toContain("runId");
    expect(row?.textContent).not.toContain("message");
    expect(row?.textContent).not.toContain("state");
    expect(row?.textContent).not.toContain("msg_51999709e5f243388faaf416608793c4");
  });

  it("renders an empty activity state when daemon has no rows", async () => {
    const messages = createDesktopMessages("zh-CN");
    const container = await mount(
      renderMembersPage({
        messages,
        onListAgentActivity: async () => ({ logs: [] }),
      }),
    );

    expect(container.textContent).toContain(messages.members.noActivity);
    expect(container.querySelector('[data-empty-illustration="nodata"]')).not.toBeNull();
  });

  it("shows empty runtime and workspace permission states on the permissions tab", async () => {
    const messages = createDesktopMessages("zh-CN");
    const host = await mount(
      renderMembersPage({
        messages,
        data: createSleiFixtures({ members: [{ ...agentMember("agent_empty", "Empty"), capabilities: [], permissions: [] }] }),
        activeMemberId: "agent_empty",
      }),
    );

    await clickTab(host, messages.members.permissions);
    const panel = activeTabPanel(host);

    expect(panel.textContent).toContain(messages.members.noCapabilities);
    expect(panel.textContent).toContain(messages.members.noWorkspacePermissions);
    expect(panel.querySelector('[data-empty-illustration="nodata"]')).not.toBeNull();
  });

  it("shows workspace skills on the capabilities tab without runtime capabilities or workspace permissions", async () => {
    const messages = createDesktopMessages("zh-CN");
    const host = await mount(
      renderMembersPage({
        messages,
        data: createSleiFixtures({
          members: [
            {
              ...agentMember("agent_coda", "Coda"),
              capabilities: ["ClaudeCode"],
              permissions: ["文件读取"],
              skills: [
                {
                  id: "skill_memory",
                  name: "长期记忆",
                  trigger: "当用户希望保存偏好或事实时触发",
                  path: "~/.slei/agents/agent_coda/.claude/skills/memory/SKILL.md",
                },
              ],
            },
          ],
        }),
      }),
    );

    await clickTab(host, messages.members.capabilities);
    const panel = activeTabPanel(host);

    expect(panel.textContent).toContain("长期记忆");
    expect(panel.textContent).toContain("当用户希望保存偏好或事实时触发");
    expect(panel.textContent).not.toContain("ClaudeCode");
    expect(panel.textContent).not.toContain("文件读取");
  });

  it("labels the workspace skills card as skills without a duplicate subtitle", async () => {
    const messages = createDesktopMessages("zh-CN");
    const host = await mount(
      renderMembersPage({
        messages,
        data: createSleiFixtures({
          members: [
            {
              ...agentMember("agent_coda", "Coda"),
              skills: [
                {
                  id: "skill_memory",
                  name: "memory",
                  trigger: "Use when the user asks the agent to remember facts",
                  path: "~/.slei/agents/agent_coda/.claude/skills/memory/SKILL.md",
                },
              ],
            },
          ],
        }),
      }),
    );

    await clickTab(host, messages.members.capabilities);
    const panel = activeTabPanel(host);
    const skillsCard = panel.querySelector('[data-slot="card"]');

    expect(skillsCard?.querySelector("h2")?.textContent).toBe(messages.members.skills);
    expect(skillsCard?.textContent).not.toContain(messages.members.readOnly);
  });

  it("renders workspace skill icons small and visually muted", async () => {
    const messages = createDesktopMessages("zh-CN");
    const host = await mount(
      renderMembersPage({
        messages,
        data: createSleiFixtures({
          members: [
            {
              ...agentMember("agent_coda", "Coda"),
              skills: [
                {
                  id: "skill_memory",
                  name: "memory",
                  trigger: "Use when the user asks the agent to remember facts",
                  path: "~/.slei/agents/agent_coda/.claude/skills/memory/SKILL.md",
                },
              ],
            },
          ],
        }),
      }),
    );

    await clickTab(host, messages.members.capabilities);
    const panel = activeTabPanel(host);
    const skillIcon = panel.querySelector('[role="listitem"] svg');

    expect(skillIcon?.classList.contains("size-3")).toBe(true);
    expect(skillIcon?.classList.contains("text-muted-foreground")).toBe(true);
    expect(skillIcon?.classList.contains("opacity-60")).toBe(true);
  });

  it("shows read-only runtime capabilities and workspace permissions on the permissions tab", async () => {
    const messages = createDesktopMessages("zh-CN");
    const host = await mount(
      renderMembersPage({
        messages,
        data: createSleiFixtures({
          members: [
            {
              ...agentMember("agent_coda", "Coda"),
              capabilities: ["ClaudeCode"],
              permissions: ["文件读取"],
              skills: [
                {
                  id: "skill_memory",
                  name: "长期记忆",
                  trigger: "当用户希望保存偏好或事实时触发",
                  path: "~/.slei/agents/agent_coda/.claude/skills/memory/SKILL.md",
                },
              ],
            },
          ],
        }),
      }),
    );

    await clickTab(host, messages.members.permissions);
    const panel = activeTabPanel(host);

    expect(panel.textContent).toContain(messages.members.readOnly);
    expect(panel.textContent).toContain("ClaudeCode");
    expect(panel.textContent).toContain("文件读取");
    expect(panel.textContent).not.toContain("长期记忆");
  });

  it("shows the empty skills state on the capabilities tab without runtime capabilities", async () => {
    const messages = createDesktopMessages("zh-CN");
    const host = await mount(
      renderMembersPage({
        messages,
        data: createSleiFixtures({
          members: [
            {
              ...agentMember("agent_empty", "Empty"),
              capabilities: ["ClaudeCode"],
              permissions: ["文件读取"],
              skills: [],
            },
          ],
        }),
        activeMemberId: "agent_empty",
      }),
    );

    await clickTab(host, messages.members.capabilities);
    const panel = activeTabPanel(host);

    expect(panel.textContent).toContain(messages.members.noSkills);
    expect(panel.textContent).toContain(messages.members.noSkillsDescription);
    expect(panel.textContent).not.toContain("ClaudeCode");
  });

  it("renders an activity error state when daemon activity loading fails", async () => {
    const messages = createDesktopMessages("zh-CN");
    const container = await mount(
      renderMembersPage({
        messages,
        onListAgentActivity: async () => {
          throw new Error("daemon down");
        },
      }),
    );

    expect(container.textContent).toContain(messages.members.activityLoadFailed);
  });

  it("reloads activity when the selected member changes", async () => {
    const messages = createDesktopMessages("zh-CN");
    const calls: string[] = [];
    const data = createSleiFixtures({ members: [agentMember("agent_a", "Ava"), agentMember("agent_b", "Bea")] });

    await mount(
      <MembersPage
        activeMemberId="agent_a"
        data={data}
        messages={messages}
        nodes={[baseNode]}
        onAgentUpdate={() => undefined}
        onListAgentActivity={async (agentId) => {
          calls.push(agentId);
          return { logs: [] };
        }}
        onMessage={() => undefined}
      />,
    );

    await act(async () => {
      mountedRoot?.render(
        <MembersPage
          activeMemberId="agent_b"
          data={data}
          messages={messages}
          nodes={[baseNode]}
          onAgentUpdate={() => undefined}
          onListAgentActivity={async (agentId) => {
            calls.push(agentId);
            return { logs: [] };
          }}
          onMessage={() => undefined}
        />,
      );
    });
    await act(async () => undefined);

    expect(calls).toContain("agent_a");
    expect(calls).toContain("agent_b");
  });

  it("does not reload activity when the same selected member rerenders", async () => {
    const messages = createDesktopMessages("zh-CN");
    const calls: string[] = [];
    const data = createSleiFixtures({ members: [agentMember("agent_a", "Ava")] });

    await mount(
      <MembersPage
        activeMemberId="agent_a"
        data={data}
        messages={messages}
        nodes={[baseNode]}
        onAgentUpdate={() => undefined}
        onListAgentActivity={async (agentId) => {
          calls.push(agentId);
          return { logs: [] };
        }}
        onMessage={() => undefined}
      />,
    );

    await act(async () => {
      mountedRoot?.render(
        <MembersPage
          activeMemberId="agent_a"
          data={data}
          messages={messages}
          nodes={[baseNode]}
          onAgentUpdate={() => undefined}
          onListAgentActivity={async (agentId) => {
            calls.push(agentId);
            return { logs: [] };
          }}
          onMessage={() => undefined}
        />,
      );
    });
    await act(async () => undefined);

    expect(calls).toEqual(["agent_a"]);
  });

  it("renders activity error state when the list callback throws synchronously", async () => {
    const messages = createDesktopMessages("zh-CN");
    const container = await mount(
      renderMembersPage({
        messages,
        onListAgentActivity: () => {
          throw new Error("boom");
        },
      }),
    );

    expect(container.textContent).toContain(messages.members.activityLoadFailed);
    expect(container.textContent).not.toContain(messages.members.activityLoading);
  });

  it("renders activity rows with nullable daemon fields", async () => {
    const messages = createDesktopMessages("zh-CN");
    const nullableLog: AgentActivityLogView = {
      id: "activity_nullable",
      agentId: "agent_coda",
      runId: null,
      channelId: null,
      messageId: null,
      taskId: null,
      state: "completed",
      phase: null,
      reason: null,
      eventKind: "agent_run.completed",
      severity: "info",
      summary: "Completed with empty metadata",
      payloadPreview: null,
      toolName: null,
      ok: null,
      createdAt: "2026-06-17T08:00:00.000Z",
    };
    const container = await mount(
      renderMembersPage({
        messages,
        onListAgentActivity: async () => ({ logs: [nullableLog] }),
      }),
    );

    expect(container.textContent).toContain("Completed with empty metadata");
    expect(container.textContent).toContain("agent_run.completed");
    expect(container.textContent).toContain("info");
    expect(container.textContent).not.toContain("state completed");
    expect(container.textContent).not.toContain("null");
  });

  it("expands and collapses payload previews", async () => {
    const messages = createDesktopMessages("zh-CN");
    const payload = "{\"cmd\":\"pnpm test\"}";
    const container = await mount(
      renderMembersPage({
        messages,
        onListAgentActivity: async () => ({
          logs: [activityLog({ payloadPreview: payload })],
        }),
      }),
    );

    expect(container.textContent).not.toContain(payload);
    const expandButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes(messages.members.expandPayload));
    expect(expandButton).toBeTruthy();
    expect(expandButton?.getAttribute("data-activity-log-payload-toggle")).toBe("");
    expect(expandButton?.className).toContain("px-0");

    await act(async () => {
      expandButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.textContent).toContain(payload);

    const collapseButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes(messages.members.collapsePayload));
    await act(async () => {
      collapseButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.textContent).not.toContain(payload);
  });
});
