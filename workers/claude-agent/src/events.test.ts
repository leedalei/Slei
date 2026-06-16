import { describe, expect, it } from "vitest";

import workerRpc from "../../../tests/contract/worker-rpc.json";
import { mapClaudeSdkEvent } from "./events.js";
import type {
  HelloCommand,
  PermissionRequestedEvent,
  ProductToolRequestedEvent,
  StartRunCommand,
} from "./protocol.js";

describe("worker RPC contract", () => {
  it("covers every private command and event required by the daemon", () => {
    expect(Object.keys(workerRpc.commands).sort()).toEqual([
      "cancel",
      "hello",
      "resolve_human_question",
      "resolve_permission",
      "start_run",
    ]);
    expect(Object.keys(workerRpc.events).sort()).toEqual([
      "completed",
      "failed",
      "human_question_requested",
      "output_delta",
      "permission_requested",
      "product_tool_requested",
      "tool_completed",
      "tool_started",
    ]);
  });

  it("models commands with protocol version, launch secret and persistent session fields", () => {
    const hello = workerRpc.commands.hello as HelloCommand;
    const startRun = workerRpc.commands.start_run as StartRunCommand;

    expect(hello.protocol_version).toBe("v1");
    expect(hello.launch_secret).toBeTruthy();
    expect(startRun.session.persist_session).toBe(true);
    expect(startRun.session.resume_session).toBe(false);
    expect(startRun.input.system_prompt).toContain("Slei system prompt");
  });

  it("maps Claude SDK output and tool events before crossing into daemon code", () => {
    const output = mapClaudeSdkEvent({
      type: "assistant",
      runId: "run_1",
      message: { content: [{ type: "text", text: "hello" }] },
    });
    const toolStarted = mapClaudeSdkEvent({
      type: "tool_use",
      runId: "run_1",
      id: "tool_1",
      name: "Read",
    });
    const toolCompleted = mapClaudeSdkEvent({
      type: "tool_result",
      runId: "run_1",
      toolUseId: "tool_1",
      isError: false,
    });

    expect(output).toEqual(workerRpc.events.output_delta);
    expect(toolStarted).toEqual(workerRpc.events.tool_started);
    expect(toolCompleted).toEqual(workerRpc.events.tool_completed);
  });

  it("maps permission, human question and product tool requests with stable correlation ids", () => {
    const permission = mapClaudeSdkEvent({
      type: "permission_request",
      requestId: "perm_1",
      runId: "run_1",
      toolUseId: "tool_1",
      agentId: "agent_coda",
      toolName: "Write",
      risk: "controlled",
    });
    const question = mapClaudeSdkEvent({
      type: "human_question",
      requestId: "question_1",
      runId: "run_1",
      agentId: "agent_coda",
      question: "Which option should I use?",
    });
    const productTool = mapClaudeSdkEvent({
      type: "product_tool",
      runId: "run_1",
      toolUseId: "tool_1",
      agentId: "agent_coda",
      toolName: "slei_request_visible_delegation",
      payload: { target: "@alice", summary: "Please review" },
    });

    expect(permission).toEqual(workerRpc.events.permission_requested);
    expect(question).toEqual(workerRpc.events.human_question_requested);
    expect(productTool).toEqual(workerRpc.events.product_tool_requested);
    const productToolRequest = productTool as ProductToolRequestedEvent;
    expect(productToolRequest.tool_use_id).toBe("tool_1");
    const permissionRequest = permission as PermissionRequestedEvent;
    expect(permissionRequest.request_id).toBe("perm_1");
    expect(permissionRequest.tool_use_id).toBe("tool_1");
    expect(permissionRequest.agent_id).toBe("agent_coda");
  });
});
