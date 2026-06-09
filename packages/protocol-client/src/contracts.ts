import protocolVersionJson from "../../../tests/contract/protocol-version.json";
import errorCodesJson from "../../../tests/contract/error-codes.json";
import eventsJson from "../../../tests/contract/events.json";

export interface ProtocolVersionContract {
  version: "v1";
}

export interface ErrorCodeContract {
  code: string;
  key: string;
}

export interface EventContract {
  type: string;
  description: string;
}

export type ChannelMemberReadiness =
  | "joining"
  | "memory_syncing"
  | "ready"
  | "memory_failed"
  | "unavailable";

export interface ChannelMemberView {
  channelId: string;
  agentId: string;
  joinedAt: string;
  readiness: ChannelMemberReadiness;
}

export interface ChannelCreateRequest {
  name: string;
  description?: string;
  agentIds?: string[];
  projectPaths?: string[];
}

export interface SendChannelMessageRequest {
  authorId: string;
  body: string;
}

export interface SendChannelMessageOutcome {
  messageId: string;
  action: string;
  taskId?: string;
  assigneeAgentId?: string;
  assigneeAgentIds?: string[];
  coordinatorRunId?: string;
  decisionStatus?: "pending" | "completed" | "failed";
}

export interface SendChannelMessageReceipt {
  outcome: SendChannelMessageOutcome;
}

export const protocolVersion = protocolVersionJson as ProtocolVersionContract;
export const errorCodes = errorCodesJson as ErrorCodeContract[];
export const events = eventsJson as EventContract[];
