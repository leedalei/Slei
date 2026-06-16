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
      input?: Record<string, unknown>;
      targetPath?: string;
      sessionId?: string;
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

export type RuntimeEvent = ClaudeSdkEvent;
export const mapRuntimeEvent = mapClaudeSdkEvent;

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
      return omitUndefined({
        type: "permission_requested",
        request_id: event.requestId,
        run_id: event.runId,
        tool_use_id: event.toolUseId,
        agent_id: event.agentId,
        tool_name: event.toolName,
        risk: event.risk,
        input: event.input,
        target_path: event.targetPath,
        session_id: event.sessionId,
      });
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

function omitUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}
