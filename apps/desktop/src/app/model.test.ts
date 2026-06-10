import { describe, expect, it } from "vitest";

import type { SleiMember } from "./fixtures";
import { isInternalCoordinatorMember, mentionSuggestions } from "./model";

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
