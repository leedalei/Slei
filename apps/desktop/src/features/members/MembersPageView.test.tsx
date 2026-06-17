// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";

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

describe("MembersPage coordinator agents", () => {
  it("shows channel coordinator runtime configuration without a direct message action", () => {
    const messages = createDesktopMessages("en-US");
    const html = renderToStaticMarkup(
      <MembersPage
        activeMemberId="agent_coordinator_all"
        data={createSleiFixtures({
          members: [
            {
              id: "agent_coordinator_all",
              name: "#all Coordinator",
              handle: "@all-coordinator",
              avatar: "#A",
              avatarSeed: "agent_coordinator_all",
              type: "agent",
              runtimeStatus: "idle",
              role: "Channel coordinator",
              runtime: "ClaudeCode",
              model: "Sonnet",
              computer: "Local",
              nodeId: "local-node",
              created: "2026-06-04",
              creator: "system",
              instructions: "Routes channel messages.",
              description: "Routes channel messages.",
              permissions: [],
              environmentVariables: [],
              activity: "Idle",
              skills: [],
              capabilities: ["ClaudeCode"],
              createdAgents: [],
              directMessageEnabled: false,
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

    expect(html).toContain("#all Coordinator");
    expect(html).not.toContain("@all-coordinator");
    expect(html).toContain("Routes channel messages.");
    expect(html).toContain("Runtime configuration");
    expect(html).toContain("ClaudeCode");
    expect(html).toContain("Capabilities");
    expect(html).toContain("Workspace");
    expect(html).not.toContain(`>${messages.members.message}<`);
    expect(html).not.toContain(`>${messages.members.deleteAgent}<`);
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
    expect(html).toContain('<span class="truncate text-xs text-muted-foreground">@coda</span>');
    expect(html).toContain('aria-label="Copy"');
    expect(html).not.toContain('<p class="text-sm text-muted-foreground">Developer</p>');
    expect(html).toContain('data-slot="alert-dialog-trigger"');
    expect(html).toContain("grid-cols-[auto_minmax(0,1fr)_auto]");
    expect(html).toContain("col-start-3 row-start-1");
    expect(html).toContain(messages.members.deleteAgentConfirm("Coda"));
    expect(html).toContain("Capabilities");
    expect(html).toContain("ClaudeCode");
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

    expect(html).toContain("文件预览");
    expect(html).not.toContain("<h2 class=\"text-sm font-semibold\">文件</h2>");
    expect(html).not.toContain("~/.slei/agents/agent_coda</p>");
    expect(html).toContain("MEMORY-with-a-very-long-file-name-that-should-not-overflow-the-sidebar.md");
    expect(html).toContain(".claude");
    expect(html).not.toContain("memory</span>");
    expect(html).not.toContain("remember facts");
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

    const container = await mount(
      renderMembersPage({
        messages,
        onListAgentActivity: async () => ({
          logs: [activityLog({ eventKind: "agent_run.completed", runId: "run_agent_42", summary: "Agent finished replying" })],
        }),
      }),
    );

    expect(container.textContent).toContain("Agent finished replying");
    expect(container.textContent).toContain("agent_run.completed");
    expect(container.textContent).toContain("run_agent_42");
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
    expect(container.textContent).toContain("state completed");
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
