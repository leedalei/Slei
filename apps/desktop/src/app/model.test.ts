import { describe, expect, it } from "vitest";

import type { SleiMember } from "./types";
import { isInternalCoordinatorMember, mentionSuggestions, shouldRefreshChannelMessages } from "./model";

function agent(overrides: Partial<SleiMember> = {}): SleiMember {
  return {
    id: "agent_coda",
    name: "Coda",
    handle: "@coda",
    avatar: "CO",
    type: "agent",
    runtimeStatus: "idle",
    role: "Developer",
    description: "Builds features",
    computer: "Local",
    created: "2026-06-10",
    creator: "system",
    runtime: "ClaudeCode",
    model: "Sonnet",
    instructions: "",
    permissions: [],
    environmentVariables: [],
    createdAgents: [],
    activity: "",
    capabilities: [],
    ...overrides,
  };
}

describe("internal coordinator members", () => {
  it("identifies global and legacy channel coordinators", () => {
    expect(isInternalCoordinatorMember(agent({ id: "agent_global_coordinator", agentKind: "coordinator" }))).toBe(true);
    expect(isInternalCoordinatorMember(agent({ id: "agent_coordinator_all" }))).toBe(true);
    expect(isInternalCoordinatorMember(agent({ id: "agent_coda", agentKind: "agent" }))).toBe(false);
  });

  it("omits coordinator agents from mention suggestions", () => {
    const members = [
      agent({ id: "agent_global_coordinator", name: "Global Coordinator", handle: "@global-coordinator", agentKind: "coordinator" }),
      agent({ id: "agent_coordinator_all", name: "Channel Coordinator", handle: "@channel-coordinator" }),
      agent({ id: "agent_coda", name: "Coda", handle: "@coda", agentKind: "agent" }),
    ];

    expect(mentionSuggestions("", members).map((member) => member.id)).toEqual(["agent_coda"]);
  });
});

describe("channel message refresh", () => {
  it("keeps polling while the active channel has coordinator or agent pending activity", () => {
    expect(
      shouldRefreshChannelMessages(
        [
          {
            id: "coordinator-activity-msg_1",
            author: "频道协调员",
            role: "agent",
            time: "",
            body: "",
            channelId: "all",
            status: "pending",
            toolCall: "coordinator_routing",
          },
        ],
        "all",
      ),
    ).toBe(true);
  });

  it("does not poll inactive channels or settled channel messages", () => {
    expect(
      shouldRefreshChannelMessages(
        [
          {
            id: "msg_agent_done",
            author: "Yeal",
            role: "agent",
            time: "",
            body: "完成了",
            channelId: "all",
            status: "done",
          },
        ],
        "all",
      ),
    ).toBe(false);
    expect(
      shouldRefreshChannelMessages(
        [
          {
            id: "coordinator-activity-msg_2",
            author: "频道协调员",
            role: "agent",
            time: "",
            body: "",
            channelId: "all",
            status: "pending",
          },
        ],
        "dev",
      ),
    ).toBe(false);
  });
});
