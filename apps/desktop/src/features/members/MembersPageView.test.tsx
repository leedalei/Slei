import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { createDesktopMessages } from "../../i18n";
import { createSleiFixtures } from "../../app/fixtures";
import { buildWorkspaceTreeRows, MembersPage } from "./MembersPageView";

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
    expect(html).toContain("Channel coordinator");
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
    expect(html).toContain('data-slot="alert-dialog-trigger"');
    expect(html).toContain(messages.members.deleteAgentConfirm("Coda"));
    expect(html).toContain("Capabilities");
    expect(html).toContain("ClaudeCode");
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
});
