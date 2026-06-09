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
  asTask?: boolean;
}

export interface SendChannelMessageOutcome {
  messageId: string;
  action: string;
  taskId?: string;
  assigneeAgentId?: string;
}

export interface SendChannelMessageReceipt {
  outcome: SendChannelMessageOutcome;
}

export type TaskStatus = "pending_assignment" | "in_progress" | "in_review" | "done";

export interface TaskSummaryView {
  id: string;
  channelId: string;
  creatorId: string;
  assigneeId?: string;
  sourceMessageId?: string;
  title: string;
  status: TaskStatus;
  attentionRequired: boolean;
  replyCount: number;
  updatedAt: string;
}

export interface TaskThreadMessageView {
  id: string;
  taskId: string;
  senderId: string;
  role: "human" | "agent" | "system" | string;
  body: string;
  status?: string;
  createdAt: string;
}

export interface TaskThreadView {
  task: TaskSummaryView;
  root: TaskThreadMessageView;
  replies: TaskThreadMessageView[];
}

export interface TaskReplyRequest {
  senderId: string;
  body: string;
}

export interface TaskReplyRoute {
  handoffAgentIds: string[];
  needsAssignment: boolean;
}

export interface TaskReplyReceipt {
  reply: TaskThreadMessageView;
  route: TaskReplyRoute;
}

export const protocolVersion = protocolVersionJson as ProtocolVersionContract;
export const errorCodes = errorCodesJson as ErrorCodeContract[];
export const events = eventsJson as EventContract[];
