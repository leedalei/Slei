import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { createDesktopMessages } from "../../i18n";
import { createSleiFixtures } from "../../app/fixtures";
import { MembersPage } from "./MembersPageView";

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
    expect(html).toContain("@all-coordinator");
    expect(html).toContain("Channel coordinator");
    expect(html).toContain("Runtime configuration");
    expect(html).toContain("ClaudeCode");
    expect(html).toContain("Capabilities");
    expect(html).toContain("Workspace");
    expect(html).toContain("MEMORY.md");
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
    expect(html).toContain('data-slot="alert-dialog-trigger"');
    expect(html).toContain(messages.members.deleteAgentConfirm("Coda"));
    expect(html).toContain("Capabilities");
    expect(html).toContain("ClaudeCode");
  });

  it("renders the agent workspace as a file preview panel", () => {
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
              skills: [{ id: "memory", name: "Memory", trigger: "remember facts", path: "~/.slei/agents/agent_coda/skills/memory.skill.md" }],
              capabilities: ["ClaudeCode"],
              createdAgents: [],
              directMessageEnabled: true,
              workspacePath: "~/.slei/agents/agent_coda",
              memoryPath: "~/.slei/agents/agent_coda/MEMORY.md",
              docsPath: "~/.slei/agents/agent_coda/docs",
              workspaceFiles: [
                {
                  id: "memory",
                  name: "MEMORY-with-a-very-long-file-name-that-should-not-overflow-the-sidebar.md",
                  path: "~/.slei/agents/agent_coda/MEMORY.md",
                  content: "# Memory\nCoda prefers concise implementation notes.",
                },
              ],
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

    expect(html).toContain("文件");
    expect(html).toContain("文件预览");
    expect(html).toContain("MEMORY-with-a-very-long-file-name-that-should-not-overflow-the-sidebar.md");
    expect(html).toContain("w-full min-w-0 overflow-hidden justify-start gap-2 whitespace-nowrap");
    expect(html).toContain("Coda prefers concise implementation notes.");
    expect(html).toContain("打开工作区");
    expect(html).toContain("通过资源管理器打开");
    expect(html).not.toContain("通过 daemon 打开");
  });
});
