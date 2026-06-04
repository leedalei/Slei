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
    expect(html).toContain("Runtime configuration");
    expect(html).toContain("ClaudeCode");
    expect(html).not.toContain(`>${messages.members.message}<`);
  });
});
