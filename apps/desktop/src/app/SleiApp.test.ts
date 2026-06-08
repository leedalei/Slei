import { describe, expect, it } from "vitest";

import { createChannelAgentReplyMessage } from "./SleiApp";
import type { ConversationMessageView, SendChannelMessageOutcome } from "../lib/daemon-bridge";

describe("createChannelAgentReplyMessage", () => {
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
});
