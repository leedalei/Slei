import type { ConversationMessageView, DaemonBridge, SendChannelMessageOutcome } from "../lib/daemon-bridge";
import type { SleiMember, SleiMessage } from "../app/types";

export function channelReplyTargetIds(outcome: SendChannelMessageOutcome): string[] {
  const ids = outcome.assigneeAgentIds && outcome.assigneeAgentIds.length > 0
    ? outcome.assigneeAgentIds
    : outcome.assigneeAgentId
      ? [outcome.assigneeAgentId]
      : [];
  return ids.filter((agentId, index) => agentId && ids.indexOf(agentId) === index);
}

function channelAgentActivityId(outcome: SendChannelMessageOutcome, agentId: string): string {
  return `agent-activity-${outcome.messageId}-${agentId}`;
}

export const CHANNEL_AGENT_REPLY_IDLE_TIMEOUT_MS = 5 * 60 * 1000;
export const CHANNEL_AGENT_REPLY_POLL_INTERVAL_MS = 500;

function conversationMessageStatus(status?: string): SleiMessage["status"] {
  if (status === "running" || status === "pending") return "running";
  if (status === "failed") return "failed";
  if (status === "done") return "done";
  return undefined;
}

function completedAgentReplies(messages: ConversationMessageView[]) {
  const completed = messages.filter((message) => message.status !== "running" && message.status !== "pending");
  const displayable = completed.filter((message) => message.body.trim() || (message.cards?.length ?? 0) > 0 || message.status === "failed");
  return displayable.length > 0 ? displayable : completed.slice(-1);
}

export async function waitForChannelAgentReplies(
  bridge: Pick<DaemonBridge, "listConversationMessages">,
  conversationId: string,
  agentId: string,
  existingMessageIds: Set<string>,
  options: {
    idleTimeoutMs?: number;
    pollIntervalMs?: number;
    onProgress?: (message: ConversationMessageView) => void;
  } = {},
): Promise<ConversationMessageView[]> {
  const idleTimeoutMs = options.idleTimeoutMs ?? CHANNEL_AGENT_REPLY_IDLE_TIMEOUT_MS;
  const pollIntervalMs = options.pollIntervalMs ?? CHANNEL_AGENT_REPLY_POLL_INTERVAL_MS;
  let expiresAt = Date.now() + idleTimeoutMs;
  let lastProgressKey = "";

  while (Date.now() < expiresAt) {
    const receipt = await bridge.listConversationMessages(conversationId);
    const replies = receipt.messages
      .filter((message) => message.authorId === agentId && !existingMessageIds.has(message.id))
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    const progress = replies.findLast((message) => message.status === "running" || message.status === "pending") ?? replies.at(-1);
    if (progress) {
      const progressKey = [
        progress.id,
        progress.status ?? "",
        progress.body,
        progress.cards?.map((card) => `${card.id}:${card.state}`).join(",") ?? "",
      ].join("|");
      if (progressKey !== lastProgressKey) {
        lastProgressKey = progressKey;
        expiresAt = Date.now() + idleTimeoutMs;
        options.onProgress?.(progress);
      }
    }
    if (replies.length > 0 && replies.every((message) => message.status !== "running" && message.status !== "pending")) {
      return completedAgentReplies(replies);
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
  return [];
}

export async function waitForChannelAgentReply(
  bridge: Pick<DaemonBridge, "listConversationMessages">,
  conversationId: string,
  agentId: string,
  existingMessageIds: Set<string>,
  options: {
    idleTimeoutMs?: number;
    pollIntervalMs?: number;
    onProgress?: (message: ConversationMessageView) => void;
  } = {},
): Promise<ConversationMessageView | undefined> {
  return (await waitForChannelAgentReplies(bridge, conversationId, agentId, existingMessageIds, options)).at(-1);
}

export function createChannelAgentActivityMessage(outcome: SendChannelMessageOutcome, channelId: string, members: SleiMember[]): SleiMessage | null {
  return createChannelAgentActivityMessages(outcome, channelId, members)[0] ?? null;
}

export function createChannelAgentActivityMessages(outcome: SendChannelMessageOutcome, channelId: string, members: SleiMember[]): SleiMessage[] {
  if (outcome.action !== "create_task_and_assign" && outcome.action !== "broadcast_delivered") return [];
  const agentId = channelReplyTargetIds(outcome).find((targetId) => {
    const member = members.find((candidate) => candidate.id === targetId);
    return member?.directMessageEnabled !== false;
  });
  if (!agentId) return [];
  const member = members.find((candidate) => candidate.id === agentId);
  const author = member?.name ?? agentId;
  return [{
    id: channelAgentActivityId(outcome, agentId),
    author,
    handle: member?.handle,
    avatar: member?.avatar,
    role: "agent" as const,
    time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    body: "",
    channelId,
    status: "pending" as const,
  }];
}

export function createChannelAgentReplyMessage(
  reply: ConversationMessageView,
  outcome: SendChannelMessageOutcome,
  channelId: string,
  member?: SleiMember,
  messageId = `agent-reply-${outcome.messageId}`,
): SleiMessage {
  return {
    id: messageId,
    author: member?.name ?? reply.authorId,
    handle: member?.handle,
    avatar: member?.avatar,
    role: "agent",
    time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    body: reply.body,
    cards: reply.cards,
    channelId,
    status: conversationMessageStatus(reply.status),
  };
}

export function createChannelAgentReplyMessageFromReplies(
  replies: ConversationMessageView[],
  outcome: SendChannelMessageOutcome,
  channelId: string,
  member?: SleiMember,
  messageId = `agent-reply-${outcome.messageId}`,
): SleiMessage {
  const latest = replies.at(-1);
  if (!latest) {
    return {
      id: messageId,
      author: member?.name ?? outcome.assigneeAgentId ?? "agent",
      handle: member?.handle,
      avatar: member?.avatar,
      role: "agent",
      time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      body: "",
      channelId,
      status: "failed",
    };
  }
  const body = replies.map((reply) => reply.body.trim()).filter(Boolean).join("\n\n");
  const cards = replies.flatMap((reply) => reply.cards ?? []);
  const failed = replies.some((reply) => reply.status === "failed");
  return {
    ...createChannelAgentReplyMessage(latest, outcome, channelId, member, messageId),
    body,
    cards: cards.length > 0 ? cards : undefined,
    status: failed ? "failed" : conversationMessageStatus(latest.status),
  };
}
