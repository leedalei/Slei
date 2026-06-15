import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  channelMessageToSleiMessage,
  createChannelAgentActivityMessages,
  createCoordinatorRoutingActivityMessage,
  debugLaunchEnabledFromSearch,
  findActiveAgentActivities,
  hasUnsettledChannelMemberReadiness,
  markCoordinatorActivityFailedByDiagnostic,
  shouldToastBackendServiceError,
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
import type { ChannelMessageView, ConversationMessageView, SendChannelMessageOutcome } from "../lib/daemon-bridge";
import type { SleiMember, SleiMessage } from "./types";

describe("createChannelAgentReplyMessage", () => {
  it("shows coordinator pending work in the chat sidebar agent activity area", () => {
    const outcome: SendChannelMessageOutcome = {
      messageId: "msg_route_1",
      action: "coordinator_pending",
      coordinatorRunId: "coord_run_1",
      decisionStatus: "pending",
    };
    const message = createCoordinatorRoutingActivityMessage(outcome, "all", createDesktopMessages("zh-CN"));

    expect(message).toMatchObject({
      id: "coordinator-activity-msg_route_1",
      author: "频道协调员",
      handle: "@coordinator",
      role: "agent",
      channelId: "all",
      status: "pending",
      toolCall: "coordinator_routing",
    });
    expect(
      findActiveAgentActivities(
        { channels: [{ id: "all", name: "all", description: "", unread: 0 }], messages: [message!], members: [] } as never,
        { id: "all", name: "all", description: "", unread: 0 },
      ).map((activity) => activity.message.id),
    ).toEqual(["coordinator-activity-msg_route_1"]);
  });

  it("keeps coordinator sidebar activity during pending refresh and removes it after route output appears", () => {
    const pending = {
      id: "coordinator-activity-msg_route_1",
      author: "频道协调员",
      handle: "@coordinator",
      avatar: "CO",
      role: "agent",
      time: "",
      body: "",
      channelId: "all",
      status: "pending",
      toolCall: "coordinator_routing",
    } satisfies SleiMessage;
    const human = {
      id: "msg_route_1",
      author: "Lei",
      role: "human",
      time: "",
      body: "这个方案怎么看？",
      channelId: "all",
    } satisfies SleiMessage;

    expect(replaceChannelMessages([human, pending], [human], ["all"]).map((message) => message.id)).toEqual([
      "coordinator-activity-msg_route_1",
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

    const taskCard = {
      id: "msg_task_1",
      author: "系统",
      role: "system",
      time: "",
      body: "task_card:task_1:source:msg_route_1",
      channelId: "all",
      taskCard: { taskId: "task_1", sourceMessageId: "msg_route_1" },
    } satisfies SleiMessage;
    expect(replaceChannelMessages([human, pending], [human, taskCard], ["all"]).map((message) => message.id)).toEqual([
      "msg_route_1",
      "msg_task_1",
    ]);
  });

  it("removes coordinator sidebar activity when the source message carries task metadata", () => {
    const pending = {
      id: "coordinator-activity-msg_route_1",
      author: "频道协调员",
      handle: "@coordinator",
      avatar: "CO",
      role: "agent",
      time: "",
      body: "",
      channelId: "all",
      status: "pending",
      toolCall: "coordinator_routing",
    } satisfies SleiMessage;
    const taskSource = {
      id: "msg_route_1",
      author: "Lei",
      role: "human",
      time: "",
      body: "实现任务分支",
      channelId: "all",
      task: {
        id: "task_1",
        title: "实现任务分支",
        owner: "Lei",
        status: "pending_assignment",
        channelId: "all",
        sourceMessageId: "msg_route_1",
        replyCount: 0,
      },
    } satisfies SleiMessage;

    expect(replaceChannelMessages([pending], [taskSource], ["all"]).map((message) => message.id)).toEqual([
      "msg_route_1",
    ]);
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

  it("marks pending coordinator activity failed when daemon diagnostics report the source message failure", () => {
    const pending = {
      id: "coordinator-activity-msg_route_1",
      author: "频道协调员",
      handle: "@coordinator",
      avatar: "CO",
      role: "agent",
      time: "",
      body: "",
      channelId: "content",
      status: "pending",
      toolCall: "coordinator_routing",
    } satisfies SleiMessage;
    const messages = markCoordinatorActivityFailedByDiagnostic([pending], {
      sequence: 66,
      eventType: "coordinator_runtime.failed",
      entityId: "event_66",
      payload: "run_id=coord_run_1 channel_id=content message_id=msg_route_1 decision_failed",
      createdAt: "2026-06-11 09:57:39",
    });

    expect(messages[0]).toMatchObject({
      id: "coordinator-activity-msg_route_1",
      status: "failed",
      toolCall: "coordinator_routing",
    });
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

  it("builds stable activity messages for every routed channel target", () => {
    const outcome: SendChannelMessageOutcome = {
      messageId: "msg_123",
      action: "request_agent_reply",
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
    ).toEqual(["agent-activity-msg_123-agent_alice", "agent-activity-msg_123-agent_coda"]);
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

    expect(source).toContain("messages.agentCreate.createdSuccess");
    expect(source).not.toContain('navigateToView("members");');
  });

  it("surfaces agent creation failures from the modal", () => {
    const source = readFileSync(new URL("./SleiAppFrame.tsx", import.meta.url), "utf8");

    expect(source).toContain("messages.agentCreate.createdFailed");
    expect(source).toContain("catch (error)");
    expect(source).toContain("input.onChannelCreateFailure?.");
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
      action: "request_agent_reply",
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
      action: "request_agent_reply",
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

    expect(converted?.time).toBe("09:08");
    expect(converted?.sentAt).toBe("06-16 09:08");
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
      { listConversationMessages: async () => ({ messages }) },
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
      action: "request_agent_reply",
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
