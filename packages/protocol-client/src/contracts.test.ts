import { describe, expect, test } from "vitest";

import {
  errorCodes,
  events,
  protocolVersion,
  type ChannelCreateRequest,
  type ChannelMemberView,
  type SendChannelMessageOutcome,
  type SendChannelMessageReceipt,
  type SendChannelMessageRequest,
} from "./contracts";

describe("Slei protocol contract fixtures", () => {
  test("exposes the v1 protocol version", () => {
    expect(protocolVersion.version).toBe("v1");
  });

  test("exposes localized error code contracts", () => {
    expect(errorCodes).toContainEqual({
      code: "E403",
      key: "error.permission_violation",
    });
  });

  test("exposes realtime event contracts", () => {
    expect(events).toContainEqual(expect.objectContaining({ type: "approval.created" }));
  });

  test("exposes channel membership create contracts", () => {
    const selectedIds = ["agent_alice", "agent_coda"];
    const request = {
      name: "api-dev",
      agentIds: selectedIds,
    } satisfies ChannelCreateRequest;
    const member = {
      channelId: "api-dev",
      agentId: "agent_alice",
      joinedAt: "2026-06-03T00:00:00Z",
      readiness: "joining",
    } satisfies ChannelMemberView;

    expect(request).toHaveProperty("agentIds");
    expect(request.agentIds).toEqual(selectedIds);
    expect(member.readiness).toBe("joining");
  });

  test("exposes channel message send contracts", () => {
    const request = {
      authorId: "human_lei",
      body: "实现一个 API 路由",
    } satisfies SendChannelMessageRequest;
    const outcome = {
      messageId: "msg_1",
      action: "create_task_and_assign",
      taskId: "task_1",
      assigneeAgentId: "agent_alice",
    } satisfies SendChannelMessageOutcome;
    const receipt = { outcome } satisfies SendChannelMessageReceipt;

    expect(request.authorId).toBe("human_lei");
    expect(request.body).toContain("API");
    expect(receipt.outcome.messageId).toBe("msg_1");
    expect(receipt.outcome.action).toBe("create_task_and_assign");
    expect(receipt.outcome.taskId).toBe("task_1");
    expect(receipt.outcome.assigneeAgentId).toBe("agent_alice");
  });
});
