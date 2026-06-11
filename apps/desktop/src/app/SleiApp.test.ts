import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  channelReplyTargetIds,
  createChannelAgentActivityMessages,
  createChannelAgentReplyMessage,
  createChannelAgentReplyMessageFromReplies,
  hasUnsettledChannelMemberReadiness,
  waitForChannelAgentReplies,
} from "./SleiApp";
import type { ConversationMessageView, SendChannelMessageOutcome } from "../lib/daemon-bridge";
import type { SleiMember } from "./types";

describe("createChannelAgentReplyMessage", () => {
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

  it("keeps the current chat view after a member is created from an interactive card", () => {
    const source = readFileSync(new URL("./SleiApp.tsx", import.meta.url), "utf8");

    expect(source).toContain("messages.agentCreate.createdSuccess");
    expect(source).not.toContain('navigateToView("members");');
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
