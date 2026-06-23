import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
  channelMessageToSleiMessage,
  conversationMessageToSleiMessage,
  createChannelAgentActivityMessages,
  debugLaunchEnabledFromSearch,
  failStaleAgentActivities,
  findActiveAgentActivities,
  hasPendingAgentActivity,
  hasUnsettledChannelMemberReadiness,
  ensureActiveDmAgentSkills,
  mergeActiveDmAgentSkills,
  markNodesOfflineForDaemonUnavailable,
  keepOnlyClaimedAgentActivityByDiagnostic,
  markAgentActivityFailedByDiagnostic,
  applyPreferenceMutation,
  removeCompletedAgentActivityByDiagnostic,
  shouldToastBackendServiceError,
  updateAgentActivityByDiagnostic,
  replaceChannelMessages,
} from "./SleiApp";
import {
  channelReplyTargetIds,
  createChannelAgentReplyMessage,
  createChannelAgentReplyMessageFromReplies,
  waitForChannelAgentReplies,
} from "../test/channel-agent-reply-utils";
import { createDesktopMessages } from "../i18n";
import { defaultProfile } from "./model";
import type { ChannelMessageView, ConversationMessageView, DesktopNodeView, SendChannelMessageOutcome } from "../lib/daemon-bridge";
import type { SleiFixtures, SleiMember, SleiMessage } from "./types";

function expectedLocalMessageDateTime(utcValue: string): { time: string; sentAt: string } {
  const date = new Date(`${utcValue.replace(" ", "T")}Z`);
  const parts = new Intl.DateTimeFormat("en-US", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const valueFor = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return {
    time: `${valueFor("hour")}:${valueFor("minute")}`,
    sentAt: `${valueFor("month")}-${valueFor("day")} ${valueFor("hour")}:${valueFor("minute")}`,
  };
}

function dataWithDmAgent(skills?: SleiMember["skills"]): SleiFixtures {
  const member: SleiMember = {
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
    skills,
  };
  return {
    nodes: [],
    channels: [{ id: "all", name: "all", description: "All", unread: 0 }],
    messages: [],
    tasks: [],
    members: [member],
    conversations: [{ id: "dm_agent_coda", kind: "dm", agentId: "agent_coda", createdAt: "0", updatedAt: "0" }],
    conversationSessions: [],
    channelSessions: [],
  };
}

describe("ensureActiveDmAgentSkills", () => {
  it("loads missing skills for the active DM agent", async () => {
    const data = dataWithDmAgent(undefined);
    const listAgentSkills = vi.fn().mockResolvedValue({
      skills: [{ id: "memory", name: "memory", trigger: "Remember facts", path: "/tmp/memory/SKILL.md" }],
    });

    const next = await ensureActiveDmAgentSkills({
      activeConversationId: "dm_agent_coda",
      data,
      listAgentSkills,
    });

    expect(listAgentSkills).toHaveBeenCalledWith("agent_coda");
    expect(next.members[0].skills?.map((skill) => skill.id)).toEqual(["memory"]);
  });

  it("does not reload skills that are already present", async () => {
    const data = dataWithDmAgent([]);
    const listAgentSkills = vi.fn();

    await expect(ensureActiveDmAgentSkills({ activeConversationId: "dm_agent_coda", data, listAgentSkills })).resolves.toBe(data);

    expect(listAgentSkills).not.toHaveBeenCalled();
  });

  it("keeps current data when loading skills fails", async () => {
    const data = dataWithDmAgent(undefined);
    const listAgentSkills = vi.fn().mockRejectedValue(new Error("offline"));

    await expect(ensureActiveDmAgentSkills({ activeConversationId: "dm_agent_coda", data, listAgentSkills })).resolves.toBe(data);
  });

  it("ignores channel context and non-DM conversations", async () => {
    const data = dataWithDmAgent(undefined);
    const dataWithNonDmConversation: SleiFixtures = {
      ...data,
      conversations: [{ id: "group_coda", kind: "group", agentId: "agent_coda", createdAt: "0", updatedAt: "0" }],
    };
    const listAgentSkills = vi.fn();

    await expect(ensureActiveDmAgentSkills({ activeConversationId: undefined, data, listAgentSkills })).resolves.toBe(data);
    await expect(ensureActiveDmAgentSkills({ activeConversationId: "missing", data, listAgentSkills })).resolves.toBe(data);
    await expect(
      ensureActiveDmAgentSkills({ activeConversationId: "group_coda", data: dataWithNonDmConversation, listAgentSkills }),
    ).resolves.toBe(dataWithNonDmConversation);

    expect(listAgentSkills).not.toHaveBeenCalled();
  });

  it("ignores active DM conversations whose member is missing or not an agent", async () => {
    const data = dataWithDmAgent(undefined);
    const missingMemberData: SleiFixtures = {
      ...data,
      conversations: [{ id: "dm_missing", kind: "dm", agentId: "agent_missing", createdAt: "0", updatedAt: "0" }],
    };
    const humanMemberData: SleiFixtures = {
      ...data,
      members: [{ ...data.members[0], id: "human_lei", type: "human" }],
      conversations: [{ id: "dm_human", kind: "dm", agentId: "human_lei", createdAt: "0", updatedAt: "0" }],
    };
    const listAgentSkills = vi.fn();

    await expect(
      ensureActiveDmAgentSkills({ activeConversationId: "dm_missing", data: missingMemberData, listAgentSkills }),
    ).resolves.toBe(missingMemberData);
    await expect(
      ensureActiveDmAgentSkills({ activeConversationId: "dm_human", data: humanMemberData, listAgentSkills }),
    ).resolves.toBe(humanMemberData);

    expect(listAgentSkills).not.toHaveBeenCalled();
  });

  it("merges loaded DM skills into the current data snapshot only when the target is still missing skills", () => {
    const data = dataWithDmAgent(undefined);
    const currentWithMessage: SleiFixtures = {
      ...data,
      messages: [{ id: "msg_new", author: "Lei", role: "human", time: "", body: "newer message", channelId: "dm_agent_coda" }],
    };

    const next = mergeActiveDmAgentSkills({
      activeConversationId: "dm_agent_coda",
      agentId: "agent_coda",
      data: currentWithMessage,
      skills: [{ id: "memory", name: "memory", trigger: "Remember facts", path: "/tmp/memory/SKILL.md" }],
    });

    expect(next.members[0].skills?.map((skill) => skill.id)).toEqual(["memory"]);
    expect(next.messages.map((message) => message.id)).toEqual(["msg_new"]);
    expect(
      mergeActiveDmAgentSkills({
        activeConversationId: "dm_agent_coda",
        agentId: "agent_coda",
        data: next,
        skills: [{ id: "other", name: "other", trigger: "Other", path: "/tmp/other/SKILL.md" }],
      }),
    ).toBe(next);
  });

  it("wires the active DM effect with guarded functional state merging", () => {
    const source = readFileSync(join(process.cwd(), "src/app/SleiApp.tsx"), "utf8");
    expect(source).toContain("const activeDmSkillLoadsRef = useRef(new Set<string>())");
    expect(source).toContain("setData((current) =>");
    expect(source).toContain("mergeActiveDmAgentSkills({");
    expect(source).toContain("activeDmSkillLoadsRef.current.delete(activeDmAgentId)");
    expect(source).not.toContain("if (nextData !== data) setData(nextData)");
    expect(source).not.toContain("}, [activeConversationId, bridge.listAgentSkills, data]);");
  });
});

describe("createChannelAgentReplyMessage", () => {
  it("marks cached nodes offline when a daemon unavailable error is observed", () => {
    const nodes: DesktopNodeView[] = [
      {
        id: "local-node",
        name: "本机设备",
        status: "connected",
        daemonVersion: "0.1.0",
        device: { platform: "darwin", arch: "arm64", hostname: "MateBook-Pro-Max-3.local" },
        runtimes: [{ kind: "ClaudeCode", readiness: "ready" }],
      },
    ];

    expect(markNodesOfflineForDaemonUnavailable(nodes, new Error("daemon unavailable"))).toEqual([
      { ...nodes[0], status: "offline" },
    ]);
  });

  it("keeps cached node status for non-daemon business errors", () => {
    const nodes: DesktopNodeView[] = [
      {
        id: "local-node",
        name: "本机设备",
        status: "connected",
        daemonVersion: "0.1.0",
        device: { platform: "darwin", arch: "arm64", hostname: "MateBook-Pro-Max-3.local" },
        runtimes: [{ kind: "ClaudeCode", readiness: "ready" }],
      },
    ];

    expect(markNodesOfflineForDaemonUnavailable(nodes, new Error("channel name already exists"))).toBe(nodes);
  });

  it("rolls back optimistic preference changes when persistence fails", async () => {
    const applied: string[] = [];
    await expect(
      applyPreferenceMutation({
        current: "zh-CN",
        optimistic: "en-US",
        applyOptimistic: (value) => applied.push(value),
        persist: async () => {
          throw new Error("daemon offline");
        },
        applyConfirmed: (value) => applied.push(`confirmed:${value}`),
        onError: () => applied.push("error"),
      }),
    ).rejects.toThrow("daemon offline");

    expect(applied).toEqual(["en-US", "zh-CN", "error"]);
  });

  it("notifies after preference persistence succeeds", async () => {
    const applied: string[] = [];
    const confirmed = await applyPreferenceMutation({
      current: "zh-CN",
      optimistic: "en-US",
      applyOptimistic: (value) => applied.push(value),
      persist: async () => "en-US",
      applyConfirmed: (value) => applied.push(`confirmed:${value}`),
      onError: () => applied.push("error"),
      onSuccess: () => applied.push("success"),
    });

    expect(confirmed).toBe("en-US");
    expect(applied).toEqual(["en-US", "confirmed:en-US", "success"]);
  });

  it("surfaces immediate settings changes through app toasts", () => {
    const source = readFileSync(new URL("./SleiApp.tsx", import.meta.url), "utf8");

    expect(source).toContain("showAppToast(messages.settings.updateSuccess, \"success\")");
    expect(source).toContain("formatAppErrorToast(messages.settings.updateFailed, error)");
    expect(source).toContain("if (field === \"avatar\") showAppToast(messages.settings.updateSuccess, \"success\")");
  });

  it("keeps direct agent activity during pending refresh and removes it after the agent reply appears", () => {
    const pending = {
      id: "agent-activity-msg_route_1-agent_alice",
      author: "Alice",
      handle: "@alice",
      avatar: "AL",
      role: "agent",
      time: "",
      body: "",
      channelId: "all",
      status: "pending",
      toolCall: "channel_agent_reply",
    } satisfies SleiMessage;
    const human = {
      id: "msg_route_1",
      author: "Lei",
      role: "human",
      time: "",
      body: "@alice 看下这个页面",
      channelId: "all",
    } satisfies SleiMessage;

    expect(replaceChannelMessages([human, pending], [human], ["all"]).map((message) => message.id)).toEqual([
      "agent-activity-msg_route_1-agent_alice",
      "msg_route_1",
    ]);

    const agentReply = {
      id: "msg_agent_1",
      author: "Alice",
      role: "agent",
      time: "",
      body: "我来看。",
      channelId: "all",
      status: "done",
    } satisfies SleiMessage;
    expect(replaceChannelMessages([human, pending], [human, agentReply], ["all"]).map((message) => message.id)).toEqual([
      "msg_route_1",
      "msg_agent_1",
    ]);
  });

  it("stores the latest channel agent tool diagnostic on the activity placeholder", () => {
    const pending = {
      id: "agent-activity-msg_route_1-agent_alice",
      author: "Alice",
      handle: "@alice",
      role: "agent",
      time: "",
      body: "",
      channelId: "all",
      status: "pending",
      sourceMessageId: "msg_route_1",
      toolCall: "channel_agent_reply",
    } satisfies SleiMessage;
    const event = {
      sequence: 1,
      eventType: "agent_activity.updated",
      entityId: "run_1",
      payload: "agent_id=agent_alice run_id=run_1 channel_id=all message_id=msg_route_1 task_id=none state=running phase= event_kind=tool.started tool_name=Bash",
      createdAt: "2026-06-23T08:00:00.000Z",
    };

    const [activity] = updateAgentActivityByDiagnostic([pending], event) as Array<SleiMessage & {
      activityEventKind?: string;
      activityToolName?: string;
    }>;

    expect(activity).toMatchObject({
      status: "running",
      activityEventKind: "tool.started",
      activityToolName: "Bash",
    });
  });

  it("marks pending agent activity failed when daemon diagnostics report the agent run failure", () => {
    const pending = {
      id: "agent-activity-msg_route_1-agent_nova",
      author: "Nova",
      handle: "@nova",
      avatar: "NO",
      role: "agent",
      time: "",
      body: "",
      channelId: "content",
      status: "pending",
      sourceMessageId: "msg_route_1",
      toolCall: "channel_agent_reply",
    } satisfies SleiMessage;
    const messages = markAgentActivityFailedByDiagnostic([pending], {
      sequence: 67,
      eventType: "channel_agent_runtime.failed",
      entityId: "event_67",
      payload: "run_id=run_1 agent_id=agent_nova channel_id=content source_message_id=msg_route_1",
      createdAt: "2026-06-11 09:58:39",
    });

    expect(messages[0]).toMatchObject({
      id: "agent-activity-msg_route_1-agent_nova",
      status: "failed",
      toolCall: "channel_agent_reply",
    });
  });

  it("removes pending agent activity when daemon reports delivery completed without a visible reply", () => {
    const pending = {
      id: "agent-activity-msg_route_1-agent_nova",
      author: "Nova",
      handle: "@nova",
      avatar: "NO",
      role: "agent",
      time: "",
      body: "",
      channelId: "content",
      status: "pending",
      sourceMessageId: "msg_route_1",
      toolCall: "channel_agent_reply",
    } satisfies SleiMessage;

    const messages = removeCompletedAgentActivityByDiagnostic([pending], {
      sequence: 68,
      eventType: "channel_agent_runtime.delivery_completed",
      entityId: "event_68",
      payload: "run_id=run_1 agent_id=agent_nova channel_id=content source_message_id=msg_route_1 marked=true",
      createdAt: "2026-06-11 09:59:39",
    });

    expect(messages).toEqual([]);
  });

  it("marks stale pending agent activity failed so the sidebar stops thinking", () => {
    const pending = {
      id: "agent-activity-msg_route_1-agent_nova",
      author: "Nova",
      handle: "@nova",
      avatar: "NO",
      role: "agent",
      time: "08:00",
      sentAt: "2026-06-15T08:00:00.000Z",
      body: "",
      channelId: "content",
      status: "pending",
      sourceMessageId: "msg_route_1",
      toolCall: "channel_agent_reply",
    } satisfies SleiMessage;
    const fresh = {
      ...pending,
      id: "agent-activity-msg_route_2-agent_nova",
      sentAt: "2026-06-15T08:02:30.000Z",
      sourceMessageId: "msg_route_2",
    } satisfies SleiMessage;

    const result = failStaleAgentActivities(
      [pending, fresh],
      Date.parse("2026-06-15T08:03:01.000Z"),
      120_000,
    );

    expect(result.failedActivities.map((message) => message.id)).toEqual(["agent-activity-msg_route_1-agent_nova"]);
    expect(result.messages.map((message) => [message.id, message.status])).toEqual([
      ["agent-activity-msg_route_1-agent_nova", "failed"],
      ["agent-activity-msg_route_2-agent_nova", "pending"],
    ]);
  });

  it("detects pending agent activities for task summary refresh", () => {
    const pending = {
      id: "agent-activity-msg_route_1-agent_nova",
      author: "Nova",
      handle: "@nova",
      avatar: "NO",
      role: "agent",
      time: "",
      sentAt: "2026-06-15T08:00:00.000Z",
      body: "",
      channelId: "content",
      status: "pending",
      sourceMessageId: "msg_route_1",
      toolCall: "channel_agent_reply",
    } satisfies SleiMessage;
    const failed = {
      ...pending,
      id: "agent-activity-msg_route_2-agent_nova",
      status: "failed" as const,
    } satisfies SleiMessage;

    expect(hasPendingAgentActivity([failed], "content")).toBe(false);
    expect(hasPendingAgentActivity([pending], "content")).toBe(true);
    expect(hasPendingAgentActivity([pending], "other")).toBe(false);
  });

  it("only enables backend service error toasts for debug launches", () => {
    expect(debugLaunchEnabledFromSearch("?debug=1")).toBe(true);
    expect(debugLaunchEnabledFromSearch("?debug=true")).toBe(true);
    expect(debugLaunchEnabledFromSearch("?debug=0")).toBe(false);
    expect(debugLaunchEnabledFromSearch("?debug=false")).toBe(false);
    expect(debugLaunchEnabledFromSearch("")).toBe(false);
    expect(shouldToastBackendServiceError(true)).toBe(true);
    expect(shouldToastBackendServiceError(false)).toBe(false);
  });

  it("builds a stable activity message only for the first spawned channel target", () => {
    const outcome: SendChannelMessageOutcome = {
      messageId: "msg_123",
      action: "broadcast_delivered",
      assigneeAgentId: "agent_alice",
      assigneeAgentIds: ["agent_alice", "agent_coda"],
    };

    expect(channelReplyTargetIds(outcome)).toEqual(["agent_alice", "agent_coda"]);
    expect(
      createChannelAgentActivityMessages(outcome, "all", [
        {
          id: "agent_alice",
          name: "Alice",
          handle: "@alice",
          avatar: "AL",
          type: "agent",
          runtimeStatus: "idle",
          role: "工程师",
          description: "",
          computer: "本机设备",
          created: "2026-06-04",
          creator: "system",
          runtime: "ClaudeCode",
          model: "Sonnet",
          instructions: "",
          permissions: [],
          environmentVariables: [],
          createdAgents: [],
          activity: "",
          capabilities: [],
        },
        {
          id: "agent_coda",
          name: "Coda",
          handle: "@coda",
          avatar: "CO",
          type: "agent",
          runtimeStatus: "idle",
          role: "工程师",
          description: "",
          computer: "本机设备",
          created: "2026-06-04",
          creator: "system",
          runtime: "ClaudeCode",
          model: "Sonnet",
          instructions: "",
          permissions: [],
          environmentVariables: [],
          createdAgents: [],
          activity: "",
          capabilities: [],
        },
      ]).map((message) => message.id),
    ).toEqual(["agent-activity-msg_123-agent_alice"]);
  });

  it("builds pending activity for the first broadcast-delivered channel target", () => {
    const outcome: SendChannelMessageOutcome = {
      messageId: "msg_broadcast_123",
      action: "broadcast_delivered",
      assigneeAgentIds: ["agent_alice", "agent_coda"],
    };
    const members: SleiMember[] = [
      {
        id: "agent_alice",
        name: "Alice",
        handle: "@alice",
        avatar: "AL",
        type: "agent",
        runtimeStatus: "idle",
        role: "工程师",
        description: "",
        computer: "本机设备",
        created: "2026-06-04",
        creator: "system",
        runtime: "ClaudeCode",
        model: "Sonnet",
        instructions: "",
        permissions: [],
        environmentVariables: [],
        createdAgents: [],
        activity: "",
        capabilities: [],
      },
      {
        id: "agent_coda",
        name: "Coda",
        handle: "@coda",
        avatar: "CO",
        type: "agent",
        runtimeStatus: "idle",
        role: "工程师",
        description: "",
        computer: "本机设备",
        created: "2026-06-04",
        creator: "system",
        runtime: "ClaudeCode",
        model: "Sonnet",
        instructions: "",
        permissions: [],
        environmentVariables: [],
        createdAgents: [],
        activity: "",
        capabilities: [],
      },
    ];

    const activities = createChannelAgentActivityMessages(outcome, "all", members);

    expect(activities.map((message) => message.id)).toEqual(["agent-activity-msg_broadcast_123-agent_alice"]);
    expect(activities.every((message) => message.toolCall === "channel_agent_reply" && message.status === "pending")).toBe(true);
    expect(hasPendingAgentActivity(activities, "all")).toBe(true);
  });

  it("keeps only the claimed agent activity after a daemon claim diagnostic", () => {
    const alice = {
      id: "agent_alice",
      name: "Alice",
      handle: "@alice",
      avatar: "AL",
      type: "agent" as const,
      runtimeStatus: "idle" as const,
      role: "工程师",
      description: "",
      computer: "本机设备",
      created: "2026-06-04",
      creator: "system",
      runtime: "ClaudeCode",
      model: "Sonnet",
      instructions: "",
      permissions: [],
      environmentVariables: [],
      createdAgents: [],
      activity: "",
      capabilities: [],
    };
    const coda = { ...alice, id: "agent_coda", name: "Coda", handle: "@coda", avatar: "CO" };
    const activities = createChannelAgentActivityMessages(
      {
        messageId: "msg_broadcast_123",
        action: "broadcast_delivered",
        assigneeAgentIds: ["agent_alice", "agent_coda"],
      },
      "all",
      [alice, coda],
    );

    const nextMessages = keepOnlyClaimedAgentActivityByDiagnostic(
      activities,
      {
        sequence: 12,
        eventType: "message_claimed",
        entityId: "event_claimed_12",
        payload: "message_id=msg_broadcast_123 agent_id=agent_coda",
        createdAt: "2026-06-17T00:00:00.000Z",
      },
      [alice, coda],
    );

    expect(nextMessages.map((message) => message.id)).toEqual(["agent-activity-msg_broadcast_123-agent_coda"]);
    expect(nextMessages[0]).toMatchObject({
      author: "Coda",
      handle: "@coda",
      avatar: "CO",
      channelId: "all",
      sourceMessageId: "msg_broadcast_123",
      toolCall: "channel_agent_reply",
      status: "pending",
    });
    expect(hasPendingAgentActivity(nextMessages, "all")).toBe(true);
  });

  it("updates the single channel activity from daemon agent status diagnostics", () => {
    const activities = createChannelAgentActivityMessages(
      {
        messageId: "msg_broadcast_123",
        action: "broadcast_delivered",
        assigneeAgentIds: ["agent_alice", "agent_coda"],
      },
      "all",
      [{
        id: "agent_alice",
        name: "Alice",
        handle: "@alice",
        avatar: "AL",
        type: "agent",
        runtimeStatus: "idle",
        role: "工程师",
        description: "",
        computer: "本机设备",
        created: "2026-06-04",
        creator: "system",
        runtime: "ClaudeCode",
        model: "Sonnet",
        instructions: "",
        permissions: [],
        environmentVariables: [],
        createdAgents: [],
        activity: "",
        capabilities: [],
      }],
    );

    const coda = {
      id: "agent_coda",
      name: "Coda",
      handle: "@coda",
      avatar: "CO",
      type: "agent" as const,
      runtimeStatus: "idle" as const,
      role: "工程师",
      description: "",
      computer: "本机设备",
      created: "2026-06-04",
      creator: "system",
      runtime: "ClaudeCode",
      model: "Sonnet",
      instructions: "",
      permissions: [],
      environmentVariables: [],
      createdAgents: [],
      activity: "",
      capabilities: [],
    };
    const nextMessages = updateAgentActivityByDiagnostic(
      activities,
      {
        sequence: 13,
        eventType: "agent_activity.updated",
        entityId: "event_activity_13",
        payload: "message_id=msg_broadcast_123 agent_id=agent_coda state=working phase=正在_阅读历史",
        createdAt: "2026-06-17T00:00:00.000Z",
      },
      [coda],
    );

    expect(nextMessages.map((message) => message.id)).toEqual(["agent-activity-msg_broadcast_123-agent_coda"]);
    expect(nextMessages[0]).toMatchObject({
      author: "Coda",
      handle: "@coda",
      avatar: "CO",
      body: "正在 阅读历史",
      status: "running",
      toolCall: "channel_agent_reply",
    });
  });

  it("shows task-assigned agent activity until the task thread has replies", () => {
    const outcome: SendChannelMessageOutcome = {
      messageId: "msg_task_1",
      action: "create_task_and_assign",
      taskId: "task_1",
      assigneeAgentId: "agent_coda",
      assigneeAgentIds: ["agent_coda"],
    };
    const [activity] = createChannelAgentActivityMessages(outcome, "all", [
      {
        id: "agent_coda",
        name: "Coda",
        handle: "@coda",
        avatar: "CO",
        type: "agent",
        runtimeStatus: "idle",
        role: "工程师",
        description: "",
        computer: "本机设备",
        created: "2026-06-04",
        creator: "system",
        runtime: "ClaudeCode",
        model: "Sonnet",
        instructions: "",
        permissions: [],
        environmentVariables: [],
        createdAgents: [],
        activity: "",
        capabilities: [],
      },
    ]);

    expect(activity).toMatchObject({
      id: "agent-activity-msg_task_1-agent_coda",
      status: "pending",
      toolCall: "channel_agent_reply",
      sourceMessageId: "msg_task_1",
    });

    const sourceMessage = {
      id: "msg_task_1",
      author: "Lei",
      role: "human",
      time: "",
      body: "@coda 请处理",
      channelId: "all",
      task: {
        id: "task_1",
        title: "@coda 请处理",
        owner: "Coda",
        status: "in_progress",
        channelId: "all",
        sourceMessageId: "msg_task_1",
        replyCount: 0,
      },
    } satisfies SleiMessage;

    expect(replaceChannelMessages([activity], [sourceMessage], ["all"]).map((message) => message.id)).toEqual([
      "agent-activity-msg_task_1-agent_coda",
      "msg_task_1",
    ]);
    expect(
      replaceChannelMessages(
        [activity],
        [{ ...sourceMessage, task: { ...sourceMessage.task, replyCount: 1 } }],
        ["all"],
      ).map((message) => message.id),
    ).toEqual(["msg_task_1"]);
  });

  it("detects channel members that still need readiness refresh", () => {
    const members = [
      { id: "agent_joining", channelReadiness: { dev: "joining" } },
      { id: "agent_ready", channelReadiness: { dev: "ready" } },
      { id: "agent_failed", channelReadiness: { dev: "memory_failed" } },
    ] as unknown as SleiMember[];

    expect(hasUnsettledChannelMemberReadiness(members, "dev")).toBe(true);
    expect(hasUnsettledChannelMemberReadiness(members.slice(1), "dev")).toBe(false);
    expect(hasUnsettledChannelMemberReadiness(members, "ops")).toBe(false);
  });

  it("polls active channel member readiness while members are joining", () => {
    const source = readFileSync(new URL("./SleiApp.tsx", import.meta.url), "utf8");

    expect(source).toContain("channel-members-readiness-interval");
    expect(source).toContain("hasUnsettledChannelMemberReadiness(data.members, activeChannelId)");
    expect(source).toContain("refreshChannelMembersIntoState(activeChannelId)");
  });

  it("keeps the current chat view after a member is created from an interactive card", () => {
    const source = readFileSync(new URL("./SleiApp.tsx", import.meta.url), "utf8");
    const handlerSource = source.slice(source.indexOf("async function handleCreateAgent"), source.indexOf("async function handleUpdateAgent"));

    expect(handlerSource).toContain("messages.agentCreate.createdSuccess");
    expect(handlerSource).not.toContain('navigateToView("members");');
  });

  it("surfaces agent creation failures from the modal", () => {
    const source = readFileSync(new URL("./SleiAppFrame.tsx", import.meta.url), "utf8");

    expect(source).toContain("messages.agentCreate.createdFailed");
    expect(source).toContain("catch (error)");
    expect(source).toContain("input.onChannelCreateFailure?.");
  });

  it("keeps the primary navigation icon-only with accessible labels", () => {
    const source = readFileSync(new URL("./SleiAppFrame.tsx", import.meta.url), "utf8");

    expect(source).toContain("aria-label={messages.shell.nav[item.id]}");
    expect(source).toContain("tooltip={messages.shell.nav[item.id]}");
    expect(source).toContain("className=\"size-5\"");
    expect(source).not.toContain("<span className=\"text-[11px] leading-none\">{messages.shell.nav[item.id]}</span>");
  });

  it("renders a thin sidebar resize handle with resize cursor", () => {
    const source = readFileSync(new URL("./SleiAppFrame.tsx", import.meta.url), "utf8");

    expect(source).toContain("aria-label={messages.common.resizeSidebar}");
    expect(source).toContain("role=\"separator\"");
    expect(source).toContain("w-1");
    expect(source).toContain("!cursor-col-resize");
    expect(source).not.toContain("w-2 cursor-col-resize border-x");
  });

  it("surfaces global and daemon diagnostic failures through the app toast", () => {
    const source = readFileSync(new URL("./SleiApp.tsx", import.meta.url), "utf8");

    expect(source).toContain('window.addEventListener("error"');
    expect(source).toContain('window.addEventListener("unhandledrejection"');
    expect(source).toContain("bridge.listDiagnostics()");
    expect(source).toContain("diagnosticEventNeedsToast");
    expect(source).toContain("showAppToast(formatAppErrorToast");
  });

  it("keeps the channel activity id stable across progress and completion", () => {
    const outcome: SendChannelMessageOutcome = {
      messageId: "msg_123",
      action: "broadcast_delivered",
      assigneeAgentId: "agent_guide_local_node",
    };
    const reply: ConversationMessageView = {
      id: "run_message_1",
      conversationId: "dm:agent_guide_local_node",
      authorId: "agent_guide_local_node",
      body: "处理中",
      status: "running",
      createdAt: "2026-06-08T09:00:00.000Z",
    };

    const message = createChannelAgentReplyMessage(reply, outcome, "all", undefined, "agent-activity-msg_123");

    expect(message.id).toBe("agent-activity-msg_123");
    expect(message.status).toBe("running");
  });

  it("preserves cards from the completed runtime message", () => {
    const outcome: SendChannelMessageOutcome = {
      messageId: "msg_123",
      action: "broadcast_delivered",
      assigneeAgentId: "agent_guide_local_node",
    };
    const reply: ConversationMessageView = {
      id: "card_message_1",
      conversationId: "dm:agent_guide_local_node",
      authorId: "agent_guide_local_node",
      body: "",
      status: "done",
      createdAt: "2026-06-08T09:00:01.000Z",
      cards: [
        {
          id: "card_1",
          kind: "createAgent",
          state: "pending",
          title: "创建架构师",
          summary: "架构师",
          draft: {},
          actionLabel: "创建",
          doneLabel: "DONE",
        },
      ],
    };

    const message = createChannelAgentReplyMessage(reply, outcome, "all", undefined, "agent-activity-msg_123");

    expect(message.id).toBe("agent-activity-msg_123");
    expect(message.status).toBe("done");
    expect(message.cards).toEqual(reply.cards);
  });

  it("preserves cards from channel agent card messages", () => {
    const card = {
      id: "card_1",
      kind: "createAgent",
      state: "pending",
      title: "创建 Nova",
      summary: "Nova · ClaudeCode / Opus",
      draft: { name: "Nova", handle: "@nova" },
      actionLabel: "创建",
      doneLabel: "DONE",
    };
    const message: ChannelMessageView = {
      id: "card_message_card_1",
      channelId: "all",
      authorId: "agent_guide_local_node",
      body: "",
      kind: "agent",
      deleted: false,
      cards: [card],
    };

    const converted = channelMessageToSleiMessage(
      message,
      [{
        id: "agent_guide_local_node",
        name: "Yeal",
        handle: "@yeal",
        avatar: "YE",
        type: "agent",
        runtimeStatus: "idle",
        role: "引导员",
        description: "",
        computer: "本机设备",
        created: "2026-06-04",
        creator: "system",
        runtime: "ClaudeCode",
        model: "Sonnet",
        instructions: "",
        permissions: [],
        environmentVariables: [],
        createdAgents: [],
        activity: "",
        capabilities: [],
      }],
      defaultProfile,
      createDesktopMessages("zh-CN"),
    );

    expect(converted?.body).toBe("");
    expect(converted?.cards).toEqual([card]);
    expect(converted?.status).toBe("done");
  });

  it("maps channel message created time for chat message headers", () => {
    const expected = expectedLocalMessageDateTime("2026-06-16 09:08:07");
    const message: ChannelMessageView = {
      id: "channel_msg_1",
      channelId: "all",
      authorId: "human:lei",
      body: "频道消息",
      kind: "human",
      deleted: false,
      createdAt: "2026-06-16 09:08:07",
    };

    const converted = channelMessageToSleiMessage(
      message,
      [],
      defaultProfile,
      createDesktopMessages("zh-CN"),
    );

    expect(converted?.time).toBe(expected.time);
    expect(converted?.sentAt).toBe(expected.sentAt);
  });

  it("renders local human messages with a presentation fallback when profile is unavailable", () => {
    const messages = createDesktopMessages("zh-CN");
    const message = conversationMessageToSleiMessage(
      {
        id: "msg_1",
        conversationId: "dm:agent_1",
        authorId: "human:local",
        body: "hello",
        createdAt: "2026-06-17T00:00:00Z",
      },
      [],
      null,
      messages,
    );

    expect(message.author).toBe(messages.common.you);
    expect(message.handle).toBe("@local");
  });

  it("collects multiple completed card messages from one runtime run", async () => {
    const messages: ConversationMessageView[] = [
      {
        id: "old_message",
        conversationId: "dm:agent_guide_local_node",
        authorId: "agent_guide_local_node",
        body: "old",
        status: "done",
        createdAt: "2026-06-08T08:59:00.000Z",
      },
      {
        id: "run_message_1",
        conversationId: "dm:agent_guide_local_node",
        authorId: "agent_guide_local_node",
        body: "",
        runId: "run_1",
        status: "done",
        createdAt: "2026-06-08T09:00:00.000Z",
      },
      {
        id: "card_message_1",
        conversationId: "dm:agent_guide_local_node",
        authorId: "agent_guide_local_node",
        body: "",
        status: "done",
        createdAt: "2026-06-08T09:00:01.000Z",
        cards: [
          {
            id: "card_1",
            kind: "createAgent",
            state: "pending",
            title: "创建架构师",
            summary: "架构师",
            draft: {},
            actionLabel: "创建",
            doneLabel: "DONE",
          },
        ],
      },
      {
        id: "card_message_2",
        conversationId: "dm:agent_guide_local_node",
        authorId: "agent_guide_local_node",
        body: "",
        status: "done",
        createdAt: "2026-06-08T09:00:02.000Z",
        cards: [
          {
            id: "card_2",
            kind: "createAgent",
            state: "pending",
            title: "创建 QA",
            summary: "QA",
            draft: {},
            actionLabel: "创建",
            doneLabel: "DONE",
          },
        ],
      },
    ];

    const replies = await waitForChannelAgentReplies(
      { listConversationMessages: async () => ({ messages, pageInfo: { hasMoreBefore: false } }) },
      "dm:agent_guide_local_node",
      "agent_guide_local_node",
      new Set(["old_message"]),
      { idleTimeoutMs: 20, pollIntervalMs: 1 },
    );

    expect(replies.map((reply) => reply.id)).toEqual(["card_message_1", "card_message_2"]);
  });

  it("combines multiple card replies into one channel message", () => {
    const outcome: SendChannelMessageOutcome = {
      messageId: "msg_123",
      action: "broadcast_delivered",
      assigneeAgentId: "agent_guide_local_node",
    };
    const replies: ConversationMessageView[] = [
      {
        id: "card_message_1",
        conversationId: "dm:agent_guide_local_node",
        authorId: "agent_guide_local_node",
        body: "",
        status: "done",
        createdAt: "2026-06-08T09:00:01.000Z",
        cards: [
          {
            id: "card_1",
            kind: "createAgent",
            state: "pending",
            title: "创建架构师",
            summary: "架构师",
            draft: {},
            actionLabel: "创建",
            doneLabel: "DONE",
          },
        ],
      },
      {
        id: "card_message_2",
        conversationId: "dm:agent_guide_local_node",
        authorId: "agent_guide_local_node",
        body: "",
        status: "done",
        createdAt: "2026-06-08T09:00:02.000Z",
        cards: [
          {
            id: "card_2",
            kind: "createAgent",
            state: "pending",
            title: "创建 QA",
            summary: "QA",
            draft: {},
            actionLabel: "创建",
            doneLabel: "DONE",
          },
        ],
      },
    ];

    const message = createChannelAgentReplyMessageFromReplies(replies, outcome, "all", undefined, "agent-activity-msg_123");

    expect(message.id).toBe("agent-activity-msg_123");
    expect(message.status).toBe("done");
    expect(message.cards?.map((card) => card.id)).toEqual(["card_1", "card_2"]);
  });
});

describe("global search result navigation", () => {
  it("loads the latest 50 messages for channel and conversation entries by default", () => {
    const source = readFileSync("src/app/SleiApp.tsx", "utf8");

    expect(source).toContain("const DEFAULT_CHAT_MESSAGE_LIMIT = 50");
    expect(source).toContain("const OLDER_CHAT_MESSAGE_LIMIT = 20");
    expect(source).toContain("bridge.listConversationMessages(conversation.id, { limit: DEFAULT_CHAT_MESSAGE_LIMIT })");
    expect(source).toContain("bridge.listChannelMessages(channel.id, { limit: DEFAULT_CHAT_MESSAGE_LIMIT })");
    expect(source).toContain("bridge.listChannelMessages(channelId, { limit: DEFAULT_CHAT_MESSAGE_LIMIT, ...query })");
    expect(source).toContain("bridge.listConversationMessages(conversationId, { limit: DEFAULT_CHAT_MESSAGE_LIMIT, ...query })");
    expect(source).toContain("bridge.listConversationMessages(activeConversationId, { limit: DEFAULT_CHAT_MESSAGE_LIMIT })");
    expect(source).toContain("bridge.listChannelMessages(activeChannelId, { limit: DEFAULT_CHAT_MESSAGE_LIMIT })");
    expect(source).toContain("bridge.listConversationMessages(activeConversationId, { before: oldestSequence, limit: OLDER_CHAT_MESSAGE_LIMIT })");
    expect(source).toContain("bridge.listChannelMessages(activeChannelId, { before: oldestSequence, limit: OLDER_CHAT_MESSAGE_LIMIT })");
    expect(source).not.toContain("limit: 30");
  });

  it("navigates to channel and DM messages without activating legacy sessions", () => {
    const source = readFileSync("src/app/SleiApp.tsx", "utf8");
    const handlerSource = source.slice(source.indexOf("async function handleMessageSearchResultSelect"), source.indexOf("function handleSearchResultSelect"));

    expect(handlerSource).not.toContain("activateConversationSession");
    expect(handlerSource).not.toContain("activateChannelSession");
    expect(handlerSource).toContain("loadChannelMessagesForState(channelId, data.members)");
    expect(handlerSource).toContain("replaceChannelMessages(current.messages, channelMessages, [channelId])");
    expect(handlerSource).not.toContain("handleChannelSearchResultSelect(channelId)");
  });

  it("guards async search and saved message navigation with latest-selection-wins", () => {
    const source = readFileSync("src/app/SleiApp.tsx", "utf8");
    const searchHandlerSource = source.slice(source.indexOf("async function handleMessageSearchResultSelect"), source.indexOf("function handleSearchResultSelect"));
    const savedHandlerSource = source.slice(source.indexOf("async function handleSavedMessageSelect"), source.indexOf("async function handleLocaleChange"));

    expect(source).toContain("const messageNavigationSequenceRef = useRef(0)");
    expect(source).toContain("function beginMessageNavigationSelection()");
    expect(source).toContain("function isCurrentMessageNavigationSelection(sequence: number)");
    expect(searchHandlerSource).toContain("const selectionSequence = beginMessageNavigationSelection()");
    expect(savedHandlerSource).toContain("const selectionSequence = beginMessageNavigationSelection()");
    expect(searchHandlerSource).toContain("if (!isCurrentMessageNavigationSelection(selectionSequence)) return");
    expect(savedHandlerSource).toContain("if (!isCurrentMessageNavigationSelection(selectionSequence)) return");
    expect(searchHandlerSource).toContain("focusMessageFromNavigation(result.messageId, selectionSequence)");
    expect(savedHandlerSource).toContain("focusMessageFromNavigation(savedMessage.messageId, selectionSequence)");
    expect(savedHandlerSource).toContain("aroundMessageId: savedMessage.messageId");
    expect(savedHandlerSource).toContain('setChatWorkspaceMode("chat")');
  });

  it("logs raw navigation failures but shows localized search failure copy", () => {
    const source = readFileSync("src/app/SleiApp.tsx", "utf8");
    const searchHandlerSource = source.slice(source.indexOf("async function handleMessageSearchResultSelect"), source.indexOf("function handleSearchResultSelect"));
    const savedHandlerSource = source.slice(source.indexOf("async function handleSavedMessageSelect"), source.indexOf("async function handleLocaleChange"));

    expect(searchHandlerSource).toContain("catch (error)");
    expect(savedHandlerSource).toContain("catch (error)");
    expect(searchHandlerSource).toContain("showMessageNavigationFailure(selectionSequence, error");
    expect(savedHandlerSource).toContain("showMessageNavigationFailure(selectionSequence, error");
    expect(source).toContain('logAppEvent(bridge, "message-navigation", "selection-failed"');
    expect(source).toContain("showAppToast(messages.search.errorDescription, \"error\")");
  });
});
