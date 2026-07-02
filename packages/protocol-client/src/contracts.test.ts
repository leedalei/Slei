import { describe, expect, test } from "vitest";

import {
  errorCodes,
  events,
  protocolVersion,
  type ChannelCreateRequest,
  type ChannelMemberAddRequest,
  type ChannelMemberReceipt,
  type ChannelMemberRemoveReceipt,
  type ChannelMemberView,
  type SendChannelMessageOutcome,
  type SendChannelMessageReceipt,
  type SendChannelMessageRequest,
  type TaskReplyReceipt,
  type TaskSummaryView,
  type TaskThreadView,
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
      projectPaths: ["/workspace/api"],
    } satisfies ChannelCreateRequest;
    const member = {
      channelId: "api-dev",
      agentId: "agent_alice",
      joinedAt: "2026-06-03T00:00:00Z",
      readiness: "joining",
    } satisfies ChannelMemberView;

    expect(request).toHaveProperty("agentIds");
    expect(request.agentIds).toEqual(selectedIds);
    expect(request.projectPaths).toEqual(["/workspace/api"]);
    expect(member.readiness).toBe("joining");
  });

  test("exposes channel member mutation contracts", () => {
    const request = { agentId: "agent_coda" } satisfies ChannelMemberAddRequest;
    const member = {
      channelId: "api-dev",
      agentId: "agent_coda",
      joinedAt: "2026-06-10T00:00:00Z",
      readiness: "ready",
    } satisfies ChannelMemberView;
    const addReceipt = { member } satisfies ChannelMemberReceipt;
    const removeReceipt = { removedMember: member } satisfies ChannelMemberRemoveReceipt;

    expect(request.agentId).toBe("agent_coda");
    expect(addReceipt.member.readiness).toBe("ready");
    expect(removeReceipt.removedMember?.agentId).toBe("agent_coda");
  });

  test("exposes channel message send contracts", () => {
    const request = {
      authorId: "human_lei",
      body: "实现一个 API 路由",
      attachmentIds: ["att_spec"],
    } satisfies SendChannelMessageRequest;
    const outcome = {
      messageId: "msg_1",
      action: "create_task_and_assign",
      taskId: "task_1",
      assigneeAgentId: "agent_alice",
      assigneeAgentIds: ["agent_alice", "agent_coda"],
      coordinatorRunId: "coord_run_1",
      decisionStatus: "completed",
    } satisfies SendChannelMessageOutcome;
    const receipt = { outcome } satisfies SendChannelMessageReceipt;

    expect(request.authorId).toBe("human_lei");
    expect(request.body).toContain("API");
    expect(request.attachmentIds).toEqual(["att_spec"]);
    expect(receipt.outcome.messageId).toBe("msg_1");
    expect(receipt.outcome.action).toBe("create_task_and_assign");
    expect(receipt.outcome.taskId).toBe("task_1");
    expect(receipt.outcome.assigneeAgentId).toBe("agent_alice");
    expect(receipt.outcome.assigneeAgentIds).toEqual(["agent_alice", "agent_coda"]);
    expect(receipt.outcome.coordinatorRunId).toBe("coord_run_1");
    expect(receipt.outcome.decisionStatus).toBe("completed");
  });

  test("exposes task branch contracts", () => {
    const channelRequest = {
      authorId: "human_lei",
      body: "请转成任务但正文不含动词",
      asTask: true,
    } satisfies SendChannelMessageRequest;
    const task = {
      id: "task_1",
      channelId: "all",
      creatorId: "human:local",
      title: "实现任务分支",
      status: "pending_assignment",
      attentionRequired: true,
      replyCount: 0,
      updatedAt: "1",
    } satisfies TaskSummaryView;
    const thread = {
      task,
      root: {
        id: "root_task_1",
        taskId: "task_1",
        senderId: "human:local",
        role: "human",
        body: "实现任务分支",
        createdAt: "1",
      },
      replies: [],
    } satisfies TaskThreadView;
    const receipt = {
      reply: {
        id: "reply_1",
        taskId: "task_1",
        senderId: "human:local",
        role: "human",
        body: "@coda 继续",
        createdAt: "2",
      },
      route: { handoffAgentIds: ["agent_coda"], followupAgentIds: ["agent_alice"], needsAssignment: false },
    } satisfies TaskReplyReceipt;

    expect(channelRequest.asTask).toBe(true);
    expect(thread.task.status).toBe("pending_assignment");
    expect(receipt.route.handoffAgentIds).toEqual(["agent_coda"]);
    expect(receipt.route.followupAgentIds).toEqual(["agent_alice"]);
  });
});
