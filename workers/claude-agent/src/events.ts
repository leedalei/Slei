import type { WorkerEvent } from "./protocol.js";

export type ClaudeSdkEvent =
  | {
      type: "assistant";
      runId: string;
      message: { content: Array<{ type: "text"; text: string }> };
    }
  | {
      type: "tool_use";
      runId: string;
      id: string;
      name: string;
    }
  | {
      type: "tool_result";
      runId: string;
      toolUseId: string;
      isError: boolean;
    }
  | {
      type: "permission_request";
      requestId: string;
      runId: string;
      toolUseId: string;
      agentId: string;
      toolName: string;
      risk: "read_only" | "controlled" | "dangerous";
    }
  | {
      type: "human_question";
      requestId: string;
      runId: string;
      agentId: string;
      question: string;
    }
  | {
      type: "product_tool";
      runId: string;
      toolUseId: string;
      agentId: string;
      toolName:
        | "slei_propose_interactive_card"
        | "slei_request_visible_delegation"
        | "slei_request_human_reply";
      payload: Record<string, unknown>;
    }
  | {
      type: "completed";
      runId: string;
    }
  | {
      type: "failed";
      runId: string;
      message: string;
    };

export function mapClaudeSdkEvent(event: ClaudeSdkEvent): WorkerEvent {
  switch (event.type) {
    case "assistant":
      return {
        type: "output_delta",
        run_id: event.runId,
        delta: event.message.content
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join(""),
      };
    case "tool_use":
      return {
        type: "tool_started",
        run_id: event.runId,
        tool_use_id: event.id,
        name: event.name,
      };
    case "tool_result":
      return {
        type: "tool_completed",
        run_id: event.runId,
        tool_use_id: event.toolUseId,
        ok: !event.isError,
      };
    case "permission_request":
      return {
        type: "permission_requested",
        request_id: event.requestId,
        run_id: event.runId,
        tool_use_id: event.toolUseId,
        agent_id: event.agentId,
        tool_name: event.toolName,
        risk: event.risk,
      };
    case "human_question":
      return {
        type: "human_question_requested",
        request_id: event.requestId,
        run_id: event.runId,
        agent_id: event.agentId,
        question: event.question,
      };
    case "product_tool":
      return {
        type: "product_tool_requested",
        run_id: event.runId,
        tool_use_id: event.toolUseId,
        agent_id: event.agentId,
        tool_name: event.toolName,
        payload: event.payload,
      };
    case "completed":
      return {
        type: "completed",
        run_id: event.runId,
      };
    case "failed":
      return {
        type: "failed",
        run_id: event.runId,
        message: event.message,
      };
  }
}
