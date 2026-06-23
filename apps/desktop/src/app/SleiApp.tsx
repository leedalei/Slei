import { type PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";

import {
  createDaemonBridge,
  type AppearancePreferences,
  type AppLocale,
  type ChannelMemberView,
  type ChannelMessageView,
  type ChannelView,
  type ConversationAttachmentUploadRequest,
  type ConversationView,
  type ConversationMessageView,
  type ConversationSessionView,
  type DaemonBridge,
  type DiagnosticEventView,
  type DesktopAgentView,
  type DesktopNodeView,
  type MessageThreadReceipt,
  type MessageThreadReplyView,
  type MessageThreadSummaryView,
  type NotificationPreferences,
  type PermissionDecision,
  type GlobalMessageSearchResult,
  type MessagePageQuery,
  type SaveMessageRequest,
  type SavedMessageView,
  type AgentActivityListReceipt,
  type AgentPathTarget,
  type AgentWorkspaceFileReceipt,
  type AgentWorkspaceListReceipt,
  type SendChannelMessageOutcome,
  type RuntimeSetupState,
  type TaskStatusView,
  type TaskSummaryView,
  type TaskThreadReceipt,
  type TaskThreadMessageView,
  type UserPreferences,
} from "../lib/daemon-bridge";
import { createDesktopMessages, type DesktopMessages } from "../i18n";
import type { ToastType } from "../components";
import { SleiAppFrame, type ChatWorkspaceMode, type SleiAppFrameProps } from "./SleiAppFrame";
import { createEmptySleiData } from "./empty-data";
import {
  type SleiChannel,
  type SleiChannelMemberReadiness,
  type SleiMember,
  type SleiMessage,
  type SleiTask,
  type SleiTaskReply,
} from "./types";
import {
  createDraftComputerNode,
  createLocalChatMessage,
  createTaskFromChatMessage,
  defaultAppearance,
  defaultLocale,
  defaultNotifications,
  defaultTimeZone,
  deleteComputerNode,
  detectAgentMemoryRequest,
  formatMessageDateTime,
  formatMessageTime,
  formatMemberCreatedDate,
  localHumanPresentation,
  mergeMessagePage,
  normalizeAppearance,
  parseTaskCardBody,
  renameComputerNode,
  shouldRefreshChannelMessages,
  shouldRefreshConversationMessages,
  sendChatComposerMessage,
  stripChannelHash,
  type AgentDraftInput,
  type SettingsPanel,
  type UserProfile,
} from "./model";
import { routePathForView, routeViewFromPath, type AppView } from "./router";

export type {
  AgentDraftInput,
  AgentMemoryRequest,
  AppView,
  ChatSearchFilters,
  EmptySize,
  EmptyVariant,
  SettingsPanel,
  UserProfile,
} from "./model";

export {
  activeMentionQuery,
  agentsForComputerNode,
  channelReadinessLabel,
  composerShortcutAction,
  createDraftComputerNode,
  createLocalChatMessage,
  createTaskFromChatMessage,
  deleteComputerNode,
  detectAgentMemoryRequest,
  filterConversationMessages,
  formatMessageDateTime,
  formatMemberCreatedDate,
  insertMention,
  isComposerImeComposing,
  moveMentionSelection,
  renameComputerNode,
  shouldRefreshChannelMessages,
  shouldRefreshConversationMessages,
  sendChatComposerMessage,
  submitComposerDraftWithFeedback,
  submitComposerDraft,
} from "./model";
export { EditableDetailField, Empty } from "../components";

export function conversationMessageToSleiMessage(message: ConversationMessageView, members: SleiMember[], profile: UserProfile | null, messages: DesktopMessages): SleiMessage {
  const member = members.find((candidate) => candidate.id === message.authorId);
  const isHuman = message.authorId.startsWith("human:");
  const humanProfile = localHumanPresentation(profile, messages);
  return {
    id: message.id,
    sequence: message.sequence,
    author: member?.name ?? (isHuman ? humanProfile.displayName : message.authorId),
    handle: member?.handle ?? (isHuman ? displayUserHandle(humanProfile.handle) : undefined),
    avatar: member?.avatar ?? (isHuman ? humanProfile.avatar : undefined),
    role: member?.type ?? (isHuman ? "human" : "agent"),
    time: formatMessageTime(message.createdAt),
    sentAt: formatMessageDateTime(message.createdAt),
    body: message.body,
    sessionId: message.sessionId,
    attachments: message.attachments,
    cards: message.cards,
    channelId: message.conversationId,
    status: conversationMessageStatus(message.status),
    thread: message.thread ? messageThreadSummaryToSleiThread(message.thread) : undefined,
  };
}

function conversationMessageStatus(status?: string): SleiMessage["status"] | undefined {
  return status === "running" || status === "done" || status === "failed" || status === "approval" || status === "pending" || status === "undecided"
    ? status
    : undefined;
}

function workspaceLabelFromPath(path: string) {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

function replaceConversationMessages(current: SleiMessage[], conversationMessages: SleiMessage[], conversationIds?: string[]): SleiMessage[] {
  const ids = new Set(conversationIds ?? conversationMessages.map((message) => message.channelId).filter((id): id is string => Boolean(id)));
  return [
    ...current.filter((message) => !message.channelId || !ids.has(message.channelId)),
    ...conversationMessages,
  ];
}

export function channelMessageToSleiMessage(message: ChannelMessageView, members: SleiMember[], profile: UserProfile | null, messages: DesktopMessages): SleiMessage | null {
  if (message.deleted || message.kind === "tombstone") return null;
  const time = message.createdAt ? formatMessageTime(message.createdAt) : "";
  const sentAt = message.createdAt ? formatMessageDateTime(message.createdAt) : undefined;
  if (message.kind === "task_card") {
    const taskCard = parseTaskCardBody(message.body ?? "");
    if (!taskCard) return null;
    return {
      id: message.id,
      sequence: message.sequence,
      author: messages.common.system,
      role: "system",
      time,
      sentAt,
      body: message.body ?? "",
      channelId: message.channelId,
      sessionId: message.sessionId,
      taskCard,
    };
  }
  const member = members.find((candidate) => candidate.id === message.authorId);
  const isHuman = message.authorId.startsWith("human:");
  const humanProfile = localHumanPresentation(profile, messages);
  return {
    id: message.id,
    sequence: message.sequence,
    author: member?.name ?? (isHuman ? humanProfile.displayName : message.authorId),
    handle: member?.handle ?? (isHuman ? displayUserHandle(humanProfile.handle) : undefined),
    avatar: member?.avatar ?? (isHuman ? humanProfile.avatar : undefined),
    role: member?.type ?? (isHuman ? "human" : message.kind === "agent" ? "agent" : "system"),
    time,
    sentAt,
    body: message.body ?? "",
    cards: message.cards,
    channelId: message.channelId,
    sessionId: message.sessionId,
    status: message.kind === "agent" ? "done" : undefined,
    task: message.task ? taskSummaryToSleiTask(message.task, members) : undefined,
    thread: message.thread ? messageThreadSummaryToSleiThread(message.thread) : undefined,
  };
}

function displayUserHandle(handle: string) {
  const trimmed = handle.trim();
  if (!trimmed) return "@local";
  return trimmed.startsWith("@") ? trimmed : `@${trimmed}`;
}

function channelAgentActivitySourceId(message: SleiMessage): string | undefined {
  if (message.toolCall !== "channel_agent_reply") return undefined;
  return message.sourceMessageId ?? message.id.match(/^agent-activity-(.+)-agent[_-]/)?.[1];
}

function hasRoutedChannelResultAfterSource(channelMessages: SleiMessage[], sourceMessageId: string): boolean {
  const sourceIndex = channelMessages.findIndex((message) => message.id === sourceMessageId);
  if (sourceIndex < 0) return false;
  if (channelMessages[sourceIndex].task?.sourceMessageId === sourceMessageId) return true;
  return channelMessages.slice(sourceIndex + 1).some((message) => {
    if (message.role === "agent") return true;
    return message.taskCard?.sourceMessageId === sourceMessageId;
  });
}

function hasChannelAgentResultAfterSource(channelMessages: SleiMessage[], sourceMessageId: string): boolean {
  const sourceIndex = channelMessages.findIndex((message) => message.id === sourceMessageId);
  if (sourceIndex < 0) return false;
  const task = channelMessages[sourceIndex].task;
  if (task?.sourceMessageId === sourceMessageId && (task.replyCount ?? task.replies?.length ?? 0) > 0) return true;
  return channelMessages.slice(sourceIndex + 1).some((message) => message.role === "agent");
}

export function replaceChannelMessages(current: SleiMessage[], channelMessages: SleiMessage[], channelIds: string[]): SleiMessage[] {
  const ids = new Set(channelIds);
  return [
    ...current.filter((message) => {
      if (!message.channelId || message.channelId.startsWith("dm:") || !ids.has(message.channelId)) return true;
      const agentSourceId = channelAgentActivitySourceId(message);
      if (agentSourceId) return !hasChannelAgentResultAfterSource(channelMessages, agentSourceId);
      return false;
    }),
    ...channelMessages,
  ];
}

function memberFromAgentView(agent: DesktopAgentView, nodes: DesktopNodeView[], messages: DesktopMessages = createDesktopMessages("zh-CN")): SleiMember {
  const node = nodes.find((candidate) => candidate.id === agent.nodeId);
  return {
    id: agent.id,
    name: agent.name,
    handle: agent.handle,
    avatar: agent.name.slice(0, 2).toUpperCase(),
    avatarSeed: agent.avatarSeed,
    agentKind: agent.agentKind,
    type: "agent",
    runtimeStatus: node?.status === "offline" ? "offline" : "idle",
    role: agent.agentKind === "guide"
        ? messages.chat.guide
        : agent.description.split("。")[0] || messages.agentCreate.fallbackAgent,
    description: agent.description,
    computer: node?.name ?? agent.nodeId,
    nodeId: agent.nodeId,
    created: formatMemberCreatedDate(agent.createdAt),
    creator: "lei lee @lei-lee",
    runtime: agent.runtimeKind,
    model: agent.model,
    instructions: agent.description,
    permissions: [],
    environmentVariables: [],
    createdAgents: [],
    activity: messages.members.noActivity,
    capabilities: [agent.runtimeKind],
    workspacePath: agent.workspacePath,
    memoryPath: agent.memoryPath,
    docsPath: agent.docsPath,
    skills: agent.skills,
    directMessageEnabled: true,
    systemOwned: agent.systemOwned ?? false,
  };
}

function mergeAgentViewsIntoMembers(current: SleiMember[], agents: DesktopAgentView[], nodes: DesktopNodeView[], messages: DesktopMessages = createDesktopMessages("zh-CN")) {
  const currentById = new Map(current.map((member) => [member.id, member]));
  return agents
    .map((agent) => {
      const member = memberFromAgentView(agent, nodes, messages);
      const existing = currentById.get(member.id);
      return {
        ...member,
        channelReadiness: existing?.channelReadiness,
      };
    });
}

function applyChannelMemberReadiness(members: SleiMember[], channelId: string, channelMembers: ChannelMemberView[]): SleiMember[] {
  const readinessByAgentId = new Map(channelMembers.map((member) => [member.agentId, member.readiness]));
  return members.map((member) => {
    const nextReadiness = { ...(member.channelReadiness ?? {}) };
    delete nextReadiness[channelId];
    const readiness = readinessByAgentId.get(member.id);
    if (readiness) {
      nextReadiness[channelId] = readiness;
    }
    return {
      ...member,
      channelReadiness: Object.keys(nextReadiness).length > 0 ? nextReadiness : undefined,
    };
  });
}

const CHANNEL_MEMBER_READINESS_POLL_INTERVAL_MS = 1_000;
const CHANNEL_MEMBER_READINESS_POLL_ATTEMPTS = 8;
const UNSETTLED_CHANNEL_MEMBER_READINESS = new Set<SleiChannelMemberReadiness>(["joining", "memory_syncing"]);
const DEFAULT_CHAT_MESSAGE_LIMIT = 50;
const OLDER_CHAT_MESSAGE_LIMIT = 20;

export function hasUnsettledChannelMemberReadiness(members: SleiMember[], channelId: string): boolean {
  return members.some((member) => {
    const readiness = member.channelReadiness?.[channelId];
    return readiness ? UNSETTLED_CHANNEL_MEMBER_READINESS.has(readiness) : false;
  });
}

async function loadSleiChannelMemberReadiness(bridge: DaemonBridge, channels: ChannelView[], members: SleiMember[]): Promise<SleiMember[]> {
  const receipts = await Promise.all(
    channels.map((channel) => bridge.listChannelMembers(channel.id).catch(() => ({ members: [] }))),
  );
  return receipts.reduce(
    (nextMembers, receipt, index) => applyChannelMemberReadiness(nextMembers, channels[index].id, receipt.members),
    members,
  );
}

async function loadGuideSkillsForMembers(bridge: DaemonBridge, members: SleiMember[]): Promise<SleiMember[]> {
  return Promise.all(
    members.map(async (member) => {
      if (member.type !== "agent" || member.skills || !isGuideMember(member)) return member;
      try {
        const receipt = await bridge.listAgentSkills(member.id);
        return { ...member, skills: receipt.skills };
      } catch {
        return member;
      }
    }),
  );
}

function isGuideMember(member: SleiMember): boolean {
  return member.id === "agent_guide_local_node" || member.handle.toLowerCase() === "@yeal";
}

function channelFromView(channel: ChannelView, messages: DesktopMessages): SleiChannel {
  return {
    id: channel.id,
    name: stripChannelHash(channel.name),
    description: channel.description ?? messages.chat.channel,
    unread: 0,
    activeSessionId: channel.activeSessionId,
    projectName: channel.projectPaths?.length ? channel.projectPaths.join(", ") : undefined,
    projectPaths: channel.projectPaths ?? [],
  };
}

function upsertConversation(conversations: ConversationView[], conversation: ConversationView) {
  return conversations.some((candidate) => candidate.id === conversation.id)
    ? conversations.map((candidate) => (candidate.id === conversation.id ? conversation : candidate))
    : [...conversations, conversation];
}

function upsertConversationSession(sessions: ConversationSessionView[], session: ConversationSessionView) {
  return sessions.some((candidate) => candidate.id === session.id)
    ? sessions.map((candidate) => (candidate.id === session.id ? session : candidate))
    : [...sessions, session];
}

function taskSummaryToSleiTask(task: TaskSummaryView, members: SleiMember[]): SleiTask {
  const assignee = task.assigneeId ? members.find((member) => member.id === task.assigneeId) : undefined;
  const creator = members.find((member) => member.id === task.creatorId);
  return {
    id: task.id,
    title: task.title,
    owner: assignee?.name ?? task.assigneeId ?? creator?.name ?? task.creatorId,
    creatorId: task.creatorId,
    assigneeId: task.assigneeId,
    status: task.status,
    attention: task.attentionRequired ? "需要关注" : undefined,
    attentionRequired: task.attentionRequired,
    channelId: task.channelId,
    sourceMessageId: task.sourceMessageId,
    replyCount: task.replyCount,
    threadId: task.threadId,
    updatedAt: task.updatedAt,
  };
}

function messageThreadSummaryToSleiThread(thread: MessageThreadSummaryView, replies?: SleiTaskReply[]) {
  return {
    id: thread.id,
    sourceMessageId: thread.sourceMessageId,
    sourceKind: thread.sourceKind,
    sourceId: thread.sourceId,
    replyCount: thread.replyCount,
    updatedAt: thread.updatedAt,
    replies,
  };
}

function mergeTaskSummariesIntoTasks(currentTasks: SleiTask[], summaries: TaskSummaryView[], members: SleiMember[], channelId?: string): SleiTask[] {
  const summaryIds = new Set(summaries.map((task) => task.id));
  const scopedChannelId = channelId ? new Set([channelId]) : undefined;
  const mergedSummaries = summaries.map((summary) => {
    const existing = currentTasks.find((task) => task.id === summary.id);
    return {
      ...taskSummaryToSleiTask(summary, members),
      replies: existing?.replies,
    };
  });
  const retained = currentTasks.filter((task) => {
    if (summaryIds.has(task.id)) return false;
    return scopedChannelId ? task.channelId !== channelId : true;
  });
  return [...mergedSummaries, ...retained];
}

function taskThreadMessageToReply(message: TaskThreadMessageView, members: SleiMember[], profile: UserProfile | null, messages: DesktopMessages): SleiTaskReply {
  const member = members.find((candidate) => candidate.id === message.senderId);
  const role = taskThreadMessageRole(message);
  const humanProfile = localHumanPresentation(profile, messages);
  const isLocalHuman = message.senderId === "human:local" || message.senderId === `human:${humanProfile.handle.replace(/^@/, "")}`;
  const sender = member?.name
    ?? (role === "system"
      ? messages.common.system
      : isLocalHuman
        ? humanProfile.displayName
        : message.senderId);
  return {
    id: message.id,
    sender,
    role,
    body: message.body,
  };
}

function messageThreadReplyToReply(message: MessageThreadReplyView, members: SleiMember[], profile: UserProfile | null, messages: DesktopMessages): SleiTaskReply {
  const member = members.find((candidate) => candidate.id === message.senderId);
  const role = message.role === "system" || message.role === "agent" || message.role === "human" ? message.role : "human";
  const humanProfile = localHumanPresentation(profile, messages);
  const isLocalHuman = message.senderId === "human:local" || message.senderId === `human:${humanProfile.handle.replace(/^@/, "")}`;
  return {
    id: message.id,
    sender: member?.name ?? (role === "system" ? messages.common.system : isLocalHuman ? humanProfile.displayName : message.senderId),
    role,
    body: message.body,
  };
}

function taskThreadMessageRole(message: TaskThreadMessageView): SleiMessage["role"] {
  if (message.role === "human" || message.role === "agent" || message.role === "system") return message.role;
  if (message.senderId.startsWith("human:")) return "human";
  if (message.senderId.startsWith("agent")) return "agent";
  return "system";
}

export function createChannelArchiveNoticeMessage(outcome: SendChannelMessageOutcome, channelId: string, messages: DesktopMessages): SleiMessage | null {
  if (outcome.action !== "local_archive_only") return null;
  const now = new Date().toISOString();
  return {
    id: `archive-notice-${outcome.messageId}`,
    author: messages.common.system,
    role: "system",
    time: formatMessageTime(now),
    sentAt: formatMessageDateTime(now),
    body: messages.chat.localArchiveOnly,
    channelId,
    status: "done",
  };
}

function channelReplyTargetIds(outcome: SendChannelMessageOutcome): string[] {
  const ids = outcome.assigneeAgentIds && outcome.assigneeAgentIds.length > 0
    ? outcome.assigneeAgentIds
    : outcome.assigneeAgentId
      ? [outcome.assigneeAgentId]
      : [];
  return ids.filter((agentId, index) => agentId && ids.indexOf(agentId) === index);
}

export function createChannelAgentActivityMessages(outcome: SendChannelMessageOutcome, channelId: string, members: SleiMember[]): SleiMessage[] {
  if (outcome.action !== "create_task_and_assign" && outcome.action !== "broadcast_delivered") return [];
  const now = new Date().toISOString();
  const agentId = channelReplyTargetIds(outcome).find((targetId) => {
    const member = members.find((candidate) => candidate.id === targetId);
    return member?.directMessageEnabled !== false;
  });
  if (!agentId) return [];
  const member = members.find((candidate) => candidate.id === agentId);
  return [{
    id: `agent-activity-${outcome.messageId}-${agentId}`,
    author: member?.name ?? agentId,
    handle: member?.handle,
    avatar: member?.avatar,
    role: "agent" as const,
    time: formatMessageTime(now),
    sentAt: formatMessageDateTime(now),
    body: "",
    channelId,
    status: "pending" as const,
    sourceMessageId: outcome.messageId,
    toolCall: "channel_agent_reply",
  }];
}

function createClaimedAgentActivityMessage(messageId: string, agentId: string, source: SleiMessage, member?: SleiMember): SleiMessage {
  const now = new Date().toISOString();
  return {
    id: `agent-activity-${messageId}-${agentId}`,
    author: member?.name ?? source.author,
    handle: member?.handle,
    avatar: member?.avatar,
    role: "agent",
    time: source.time || formatMessageTime(now),
    sentAt: source.sentAt || formatMessageDateTime(now),
    body: "",
    channelId: source.channelId,
    status: "pending",
    sourceMessageId: messageId,
    toolCall: "channel_agent_reply",
  };
}

function replaceChannelAgentActivityForClaim(messages: SleiMessage[], messageId: string, agentId: string, members: SleiMember[] = []): SleiMessage[] {
  const claimedActivityId = `agent-activity-${messageId}-${agentId}`;
  const existingClaimedActivity = messages.find((message) => message.id === claimedActivityId && message.toolCall === "channel_agent_reply");
  const sourceActivity = messages.find((message) => message.toolCall === "channel_agent_reply" && channelAgentActivitySourceId(message) === messageId);
  const sourceMessage = sourceActivity ?? messages.find((message) => message.id === messageId);
  if (!sourceMessage) return messages;
  const member = members.find((candidate) => candidate.id === agentId);
  const claimedActivity = existingClaimedActivity
    ? {
        ...existingClaimedActivity,
        author: member?.name ?? existingClaimedActivity.author,
        handle: member?.handle ?? existingClaimedActivity.handle,
        avatar: member?.avatar ?? existingClaimedActivity.avatar,
      }
    : createClaimedAgentActivityMessage(messageId, agentId, sourceMessage, member);
  let changed = false;
  const nextMessages = messages.flatMap((message) => {
    const matchesSameSource = message.toolCall === "channel_agent_reply" && channelAgentActivitySourceId(message) === messageId;
    if (!matchesSameSource) return [message];
    if (message.id === claimedActivityId) return [message];
    changed = true;
    return [];
  });
  if (!nextMessages.some((message) => message.id === claimedActivityId)) {
    const insertAt = messages.findIndex((message) => message.toolCall === "channel_agent_reply" && channelAgentActivitySourceId(message) === messageId);
    const boundedInsertAt = insertAt >= 0 ? insertAt : nextMessages.length;
    nextMessages.splice(boundedInsertAt, 0, claimedActivity);
    changed = true;
  }
  return changed ? nextMessages : messages;
}

function logAppEvent(bridge: DaemonBridge, scope: string, message: string, context?: Record<string, unknown>) {
  void bridge.logFrontendEvent({ scope, message, context }).catch((error: unknown) => {
    console.info("[slei-frontend]", scope, message, context ?? {}, error);
  });
}

function formatLogError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isDaemonUnavailableError(error: unknown): boolean {
  const message = formatLogError(error).toLowerCase();
  return message.includes("daemon unavailable") || message.includes("daemon offline");
}

export function markNodesOfflineForDaemonUnavailable(nodes: DesktopNodeView[], error: unknown): DesktopNodeView[] {
  if (!isDaemonUnavailableError(error)) return nodes;
  let changed = false;
  const nextNodes = nodes.map((node) => {
    if (node.status === "offline") return node;
    changed = true;
    return { ...node, status: "offline" as const };
  });
  return changed ? nextNodes : nodes;
}

export function debugLaunchEnabledFromSearch(search: string): boolean {
  const params = new URLSearchParams(search.startsWith("?") ? search : `?${search}`);
  const value = params.get("debug");
  return value !== null && value !== "0" && value.toLowerCase() !== "false";
}

export function shouldToastBackendServiceError(debugEnabled: boolean): boolean {
  return debugEnabled;
}

function diagnosticEventNeedsToast(event: DiagnosticEventView): boolean {
  return (
    event.eventType.endsWith(".failed") ||
    event.eventType.endsWith(".failed_event") ||
    event.eventType.endsWith(".start_failed") ||
    event.eventType.includes("failed")
  );
}

function diagnosticPayloadValue(event: DiagnosticEventView, key: string): string | undefined {
  const match = event.payload.match(new RegExp(`(?:^|\\s)${key}=([^\\s]+)`));
  return match?.[1];
}

export function markAgentActivityFailedByDiagnostic(messages: SleiMessage[], event: DiagnosticEventView): SleiMessage[] {
  if (!diagnosticEventNeedsToast(event)) return messages;
  const messageId = diagnosticPayloadValue(event, "message_id") ?? diagnosticPayloadValue(event, "source_message_id");
  if (!messageId) return messages;
  let changed = false;
  const nextMessages = messages.map((message) => {
    const matchesAgent = message.toolCall === "channel_agent_reply" && channelAgentActivitySourceId(message) === messageId;
    if (!matchesAgent || message.status === "failed") {
      return message;
    }
    changed = true;
    return { ...message, status: "failed" as const };
  });
  return changed ? nextMessages : messages;
}

export function keepOnlyClaimedAgentActivityByDiagnostic(messages: SleiMessage[], event: DiagnosticEventView, members: SleiMember[] = []): SleiMessage[] {
  if (event.eventType !== "message_claimed") return messages;
  const messageId = diagnosticPayloadValue(event, "message_id");
  const agentId = diagnosticPayloadValue(event, "agent_id");
  if (!messageId || !agentId) return messages;
  return replaceChannelAgentActivityForClaim(messages, messageId, agentId, members);
}

export function updateAgentActivityByDiagnostic(messages: SleiMessage[], event: DiagnosticEventView, members: SleiMember[] = []): SleiMessage[] {
  if (event.eventType !== "agent_activity.updated") return messages;
  const messageId = diagnosticPayloadValue(event, "message_id");
  const agentId = diagnosticPayloadValue(event, "agent_id");
  if (!messageId || messageId === "none" || !agentId) return messages;
  const state = diagnosticPayloadValue(event, "state");
  const phase = diagnosticPayloadValue(event, "phase")?.replaceAll("_", " ") ?? "";
  const activityEventKind = diagnosticPayloadValue(event, "event_kind");
  const activityToolName = diagnosticPayloadValue(event, "tool_name");
  const replacedMessages = replaceChannelAgentActivityForClaim(messages, messageId, agentId, members);
  let changed = replacedMessages !== messages;
  const nextMessages = replacedMessages.map((message) => {
    const matchesActivity = message.toolCall === "channel_agent_reply" && channelAgentActivitySourceId(message) === messageId;
    if (!matchesActivity) return message;
    changed = true;
    return {
      ...message,
      body: phase,
      status: state === "failed" ? "failed" as const : "running" as const,
      activityEventKind,
      activityToolName,
    };
  });
  return changed ? nextMessages : messages;
}

export function removeCompletedAgentActivityByDiagnostic(messages: SleiMessage[], event: DiagnosticEventView): SleiMessage[] {
  if (event.eventType !== "channel_agent_runtime.delivery_completed") return messages;
  const messageId = diagnosticPayloadValue(event, "source_message_id") ?? diagnosticPayloadValue(event, "message_id");
  const agentId = diagnosticPayloadValue(event, "agent_id");
  if (!messageId || !agentId) return messages;
  const activityId = `agent-activity-${messageId}-${agentId}`;
  const nextMessages = messages.filter((message) =>
    !(message.id === activityId && message.toolCall === "channel_agent_reply")
  );
  return nextMessages.length === messages.length ? messages : nextMessages;
}

export const CHANNEL_AGENT_ACTIVITY_STALE_MS = 120_000;

export function failStaleAgentActivities(
  messages: SleiMessage[],
  nowMs = Date.now(),
  staleMs = CHANNEL_AGENT_ACTIVITY_STALE_MS,
): { messages: SleiMessage[]; failedActivities: SleiMessage[] } {
  const failedActivities: SleiMessage[] = [];
  const nextMessages = messages.map((message) => {
    if (!isPendingAgentActivity(message)) return message;
    const sentAtMs = Date.parse(message.sentAt ?? "");
    if (!Number.isFinite(sentAtMs) || nowMs - sentAtMs < staleMs) return message;
    const failed = { ...message, status: "failed" as const };
    failedActivities.push(failed);
    return failed;
  });
  return {
    messages: failedActivities.length > 0 ? nextMessages : messages,
    failedActivities,
  };
}

function isPendingAgentActivity(message: SleiMessage) {
  return (
    message.role === "agent" &&
    (message.status === "pending" || message.status === "running") &&
    message.toolCall === "channel_agent_reply"
  );
}

export function hasPendingAgentActivity(messages: SleiMessage[], channelId?: string): boolean {
  return messages.some((message) =>
    isPendingAgentActivity(message) &&
    (!channelId || message.channelId === channelId)
  );
}

export async function applyPreferenceMutation<TPreferences>(input: {
  current: TPreferences;
  optimistic: TPreferences;
  applyOptimistic: (value: TPreferences) => void;
  persist: () => Promise<TPreferences>;
  applyConfirmed: (value: TPreferences) => void;
  onError: (error: unknown) => void;
  onSuccess?: () => void;
}) {
  input.applyOptimistic(input.optimistic);
  try {
    const confirmed = await input.persist();
    input.applyConfirmed(confirmed);
    input.onSuccess?.();
    return confirmed;
  } catch (error) {
    input.applyOptimistic(input.current);
    input.onError(error);
    throw error;
  }
}

function formatAppErrorToast(prefix: string, error: unknown) {
  const detail = formatLogError(error).trim();
  return detail ? `${prefix}：${detail}` : prefix;
}

function formatDiagnosticEventToast(prefix: string, event: DiagnosticEventView) {
  const detail = [event.eventType, event.payload].filter(Boolean).join(" ");
  return formatAppErrorToast(prefix, detail);
}

async function loadSleiConversationMessages(
  bridge: DaemonBridge,
  conversations: ConversationView[],
  members: SleiMember[],
  profile: UserProfile | null,
  messages: DesktopMessages,
) {
  const receipts = await Promise.all(conversations.map((conversation) => bridge.listConversationMessages(conversation.id, { limit: DEFAULT_CHAT_MESSAGE_LIMIT })));
  return receipts.flatMap((receipt) => receipt.messages.map((message) => conversationMessageToSleiMessage(message, members, profile, messages)));
}

async function loadSleiChannelMessages(
  bridge: DaemonBridge,
  channels: ChannelView[],
  members: SleiMember[],
  profile: UserProfile | null,
  messages: DesktopMessages,
) {
  const receipts = await Promise.all(
    channels.map((channel) => bridge.listChannelMessages(channel.id, { limit: DEFAULT_CHAT_MESSAGE_LIMIT }).catch(() => ({ messages: [], pageInfo: { hasMoreBefore: false } }))),
  );
  return receipts.flatMap((receipt) =>
    receipt.messages
      .map((message) => channelMessageToSleiMessage(message, members, profile, messages))
      .filter((message): message is SleiMessage => Boolean(message)),
  );
}

async function loadSleiConversationSessions(bridge: DaemonBridge, conversations: ConversationView[]) {
  const receipts = await Promise.all(conversations.map((conversation) => bridge.listConversationSessions(conversation.id)));
  return receipts.flatMap((receipt) => receipt.sessions);
}

export function handleAppSelectAllShortcut(event: KeyboardEvent) {
  if (event.defaultPrevented || event.key.toLowerCase() !== "a" || (!event.ctrlKey && !event.metaKey) || event.altKey) return;
  if (isEditableSelectAllTarget(event.target)) return;
  event.preventDefault();
  window.getSelection()?.removeAllRanges();
}

export function isEditableSelectAllTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  for (let element: Element | null = target; element; element = element.parentElement) {
    if (element instanceof HTMLTextAreaElement) return true;
    if (element instanceof HTMLInputElement) return isTextSelectionInput(element);
    if (isContentEditableElement(element)) return true;
  }
  return false;
}

function isTextSelectionInput(input: HTMLInputElement): boolean {
  return ![
    "button",
    "checkbox",
    "color",
    "file",
    "hidden",
    "image",
    "radio",
    "range",
    "reset",
    "submit",
  ].includes(input.type);
}

function isContentEditableElement(element: Element): boolean {
  if (!(element instanceof HTMLElement)) return false;
  return element.isContentEditable || element.contentEditable === "true" || element.contentEditable === "plaintext-only";
}

export function SleiApp() {
  const location = useLocation();
  const navigate = useNavigate();
  const [activeView, setActiveView] = useState<AppView>(() => routeViewFromPath(location.pathname));
  const [data, setData] = useState(createEmptySleiData());
  const [activeChannelId, setActiveChannelId] = useState("all");
  const [activeConversationId, setActiveConversationId] = useState<string | undefined>(undefined);
  const [activeSessionId, setActiveSessionId] = useState<string | undefined>(undefined);
  const [activeMemberId, setActiveMemberId] = useState<string | undefined>(undefined);
  const [savedMessages, setSavedMessages] = useState<SavedMessageView[]>([]);
  const [chatWorkspaceMode, setChatWorkspaceMode] = useState<ChatWorkspaceMode>("chat");
  const [focusedMessageId, setFocusedMessageId] = useState<string | undefined>(undefined);
  const [sessionDrawerOpen, setSessionDrawerOpen] = useState(false);
  const [sendingConversationIds, setSendingConversationIds] = useState<string[]>([]);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [locale, setLocale] = useState<AppLocale>(defaultLocale);
  const [timeZone, setTimeZone] = useState(defaultTimeZone);
  const [appearance, setAppearance] = useState<AppearancePreferences>(defaultAppearance);
  const [notifications, setNotifications] = useState<NotificationPreferences>(defaultNotifications);
  const [pendingPreference, setPendingPreference] = useState<"locale" | "timeZone" | "appearance" | "notifications" | undefined>();
  const [preferenceError, setPreferenceError] = useState<string | undefined>();
  const [pendingProfileField, setPendingProfileField] = useState<"displayName" | "avatar" | undefined>();
  const [profileErrors, setProfileErrors] = useState<Partial<Record<"displayName" | "avatar", string>>>({});
  const [sidebarWidth, setSidebarWidth] = useState(240);
  const [guideBootstrapping, setGuideBootstrapping] = useState(false);
  const [appToast, setAppToast] = useState<{ message: string; type: ToastType }>({ message: "", type: "info" });
  const [backendErrorToastsEnabled, setBackendErrorToastsEnabled] = useState(() => debugLaunchEnabledFromSearch(window.location.search));
  const [runtimeSetup, setRuntimeSetup] = useState<RuntimeSetupState>({
    loading: true,
    error: undefined,
    hasClaudeRuntimeReady: true,
    nodes: data.nodes,
  });
  const pendingPreferenceRef = useRef<typeof pendingPreference>(undefined);
  const pendingProfileFieldRef = useRef<typeof pendingProfileField>(undefined);
  const appToastTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lastDiagnosticToastSequenceRef = useRef(0);
  const olderMessagesLoadingRef = useRef(false);
  const exhaustedOlderMessageTargetsRef = useRef(new Set<string>());
  const messageNavigationSequenceRef = useRef(0);
  const bridge = useMemo(() => createDaemonBridge(), []);
  const messages = createDesktopMessages(locale);

  async function refreshTasks(channelId?: string) {
    const receipt = await bridge.listTasks(channelId ? { channelId } : {});
    setData((current) =>
      createEmptySleiData({
        ...current,
        tasks: mergeTaskSummariesIntoTasks(current.tasks, receipt.tasks, current.members, channelId),
      }),
    );
  }

  async function loadChannelMessagesForState(channelId: string, members: SleiMember[] = data.members, query: MessagePageQuery = {}) {
    const receipt = await bridge.listChannelMessages(channelId, { limit: DEFAULT_CHAT_MESSAGE_LIMIT, ...query });
    return receipt.messages
      .map((message) => channelMessageToSleiMessage(message, members, profile, messages))
      .filter((message): message is SleiMessage => Boolean(message));
  }

  async function refreshChannelMessagesIntoState(channelId: string, members: SleiMember[] = data.members) {
    const channelMessages = await loadChannelMessagesForState(channelId, members);
    setData((current) =>
      createEmptySleiData({
        ...current,
        messages: replaceChannelMessages(current.messages, channelMessages, [channelId]),
      }),
    );
  }

  async function loadConversationMessagesForState(conversationId: string, query: MessagePageQuery = {}) {
    const receipt = await bridge.listConversationMessages(conversationId, { limit: DEFAULT_CHAT_MESSAGE_LIMIT, ...query });
    return receipt.messages.map((message) => conversationMessageToSleiMessage(message, data.members, profile, messages));
  }

  async function refreshConversationMessagesIntoState(conversationId: string) {
    const conversationMessages = await loadConversationMessagesForState(conversationId);
    setData((current) =>
      createEmptySleiData({
        ...current,
        messages: replaceConversationMessages(current.messages, conversationMessages, [conversationId]),
      }),
    );
  }

  async function refreshChannelMembersIntoState(channelId: string): Promise<SleiMember[]> {
    const receipt = await bridge.listChannelMembers(channelId);
    let nextMembers: SleiMember[] = data.members;
    setData((current) => {
      nextMembers = applyChannelMemberReadiness(current.members, channelId, receipt.members);
      return createEmptySleiData({ ...current, members: nextMembers });
    });
    return nextMembers;
  }

  async function refreshChannelMembersUntilSettled(channelId: string, initialMembers?: SleiMember[]): Promise<SleiMember[]> {
    let nextMembers = initialMembers ?? await refreshChannelMembersIntoState(channelId);
    for (let attempt = 0; attempt < CHANNEL_MEMBER_READINESS_POLL_ATTEMPTS && hasUnsettledChannelMemberReadiness(nextMembers, channelId); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, CHANNEL_MEMBER_READINESS_POLL_INTERVAL_MS));
      nextMembers = await refreshChannelMembersIntoState(channelId);
    }
    return nextMembers;
  }

  function refreshChannelMembersInBackground(channelId: string, initialMembers: SleiMember[]) {
    if (!hasUnsettledChannelMemberReadiness(initialMembers, channelId)) return;
    void refreshChannelMembersUntilSettled(channelId, initialMembers)
      .then((members) => refreshChannelMessagesIntoState(channelId, members))
      .catch((error: unknown) => {
        logAppEvent(bridge, "channel-members", "readiness-refresh-failed", { channelId, error: formatLogError(error) });
        showBackendServiceErrorToast(error);
      });
  }

  function applyTaskThreadReceiptToState(receipt: TaskThreadReceipt) {
    setData((current) => {
      const task = taskSummaryToSleiTask(receipt.thread.task, current.members);
      const taskId = receipt.thread.task.id;
      const replies = [receipt.thread.root, ...receipt.thread.replies].map((message) =>
        taskThreadMessageToReply(message, current.members, profile, messages),
      );
      const nextTask = { ...task, replies };
      const tasks = current.tasks.some((candidate) => candidate.id === taskId)
        ? current.tasks.map((candidate) => (candidate.id === taskId ? nextTask : candidate))
        : [nextTask, ...current.tasks];
      return createEmptySleiData({ ...current, tasks });
    });
  }

  function appendTaskReplyReceiptToState(taskId: string, reply: TaskThreadMessageView) {
    setData((current) =>
      createEmptySleiData({
        ...current,
        tasks: current.tasks.map((task) => {
          if (task.id !== taskId) return task;
          const existingReplies = task.replies ?? [];
          if (existingReplies.some((candidate) => candidate.id === reply.id)) return task;
          const replies = [
            ...existingReplies,
            taskThreadMessageToReply(reply, current.members, profile, messages),
          ];
          return { ...task, replies, replyCount: Math.max(task.replyCount ?? 0, replies.length) };
        }),
      }),
    );
  }

  function applyMessageThreadReceiptToState(receipt: MessageThreadReceipt) {
    setData((current) => {
      const replies = (receipt.replies ?? []).map((reply) => messageThreadReplyToReply(reply, current.members, profile, messages));
      const nextThread = messageThreadSummaryToSleiThread(receipt.thread, replies);
      return createEmptySleiData({
        ...current,
        messages: current.messages.map((message) =>
          message.id === receipt.thread.sourceMessageId
            ? { ...message, thread: nextThread }
            : message,
        ),
      });
    });
  }

  function appendMessageThreadReplyToState(threadId: string, reply: MessageThreadReplyView) {
    setData((current) =>
      createEmptySleiData({
        ...current,
        messages: current.messages.map((message) => {
          if (message.thread?.id !== threadId) return message;
          const existingReplies = message.thread.replies ?? [];
          if (existingReplies.some((candidate) => candidate.id === reply.id)) return message;
          const replies = [
            ...existingReplies,
            messageThreadReplyToReply(reply, current.members, profile, messages),
          ];
          return {
            ...message,
            thread: {
              ...message.thread,
              replyCount: Math.max(message.thread.replyCount, replies.length),
              replies,
            },
          };
        }),
      }),
    );
  }

  async function refreshTaskThreadIntoState(taskId: string) {
    const receipt = await bridge.getTaskThread(taskId);
    applyTaskThreadReceiptToState(receipt);
  }

  function showAppToast(message: string, type: ToastType = "info") {
    if (appToastTimerRef.current) clearTimeout(appToastTimerRef.current);
    setAppToast({ message, type });
    appToastTimerRef.current = setTimeout(() => setAppToast((current) => ({ ...current, message: "" })), 4_000);
  }

  function markCachedNodesOfflineForDaemonUnavailable(error: unknown) {
    if (!isDaemonUnavailableError(error)) return;
    setData((current) => {
      const nodes = markNodesOfflineForDaemonUnavailable(current.nodes, error);
      return nodes === current.nodes ? current : createEmptySleiData({ ...current, nodes });
    });
    setRuntimeSetup((current) => {
      const nodes = markNodesOfflineForDaemonUnavailable(current.nodes, error);
      return nodes === current.nodes ? current : { ...current, nodes };
    });
  }

  function showBackendServiceErrorToast(error: unknown) {
    markCachedNodesOfflineForDaemonUnavailable(error);
    if (!shouldToastBackendServiceError(backendErrorToastsEnabled)) return;
    showAppToast(formatAppErrorToast(messages.common.operationFailed, error), "error");
  }

  useEffect(() => {
    const nextView = routeViewFromPath(location.pathname);
    setActiveView((current) => (current === nextView ? current : nextView));
    const canonicalPath = routePathForView(nextView);
    if (location.pathname !== canonicalPath) {
      navigate(canonicalPath, { replace: true });
    }
  }, [location.pathname, navigate]);

  useEffect(() => {
    window.addEventListener("keydown", handleAppSelectAllShortcut, { capture: true });
    return () => {
      window.removeEventListener("keydown", handleAppSelectAllShortcut, { capture: true });
    };
  }, []);

  useEffect(() => {
    return () => {
      if (appToastTimerRef.current) clearTimeout(appToastTimerRef.current);
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    bridge
      .appRuntimeFlags()
      .then((flags) => {
        if (!mounted) return;
        if (flags.debug) setBackendErrorToastsEnabled(true);
      })
      .catch((error: unknown) => {
        logAppEvent(bridge, "runtime-flags", "read-failed", { error: formatLogError(error) });
      });
    return () => {
      mounted = false;
    };
  }, [bridge]);

  useEffect(() => {
    function handleWindowError(event: ErrorEvent) {
      const error = event.error ?? event.message;
      showAppToast(formatAppErrorToast(messages.common.operationFailed, error), "error");
      logAppEvent(bridge, "global-error", "window-error", { error: formatLogError(error) });
    }

    function handleUnhandledRejection(event: PromiseRejectionEvent) {
      showAppToast(formatAppErrorToast(messages.common.operationFailed, event.reason), "error");
      logAppEvent(bridge, "global-error", "unhandled-rejection", { error: formatLogError(event.reason) });
    }

    window.addEventListener("error", handleWindowError);
    window.addEventListener("unhandledrejection", handleUnhandledRejection);
    return () => {
      window.removeEventListener("error", handleWindowError);
      window.removeEventListener("unhandledrejection", handleUnhandledRejection);
    };
  }, [bridge, messages.common.operationFailed]);

  useEffect(() => {
    let mounted = true;
    const pollDiagnostics = async () => {
      const snapshot = await bridge.listDiagnostics();
      if (!mounted) return;
      const events = [...snapshot.recentEvents]
        .filter((event) => event.sequence > lastDiagnosticToastSequenceRef.current)
        .sort((left, right) => left.sequence - right.sequence);
      for (const event of events) {
        lastDiagnosticToastSequenceRef.current = Math.max(lastDiagnosticToastSequenceRef.current, event.sequence);
        setData((current) => {
          const claimedMessages = keepOnlyClaimedAgentActivityByDiagnostic(current.messages, event, current.members);
          const updatedMessages = updateAgentActivityByDiagnostic(claimedMessages, event, current.members);
          return createEmptySleiData({ ...current, messages: removeCompletedAgentActivityByDiagnostic(updatedMessages, event) });
        });
        if (diagnosticEventNeedsToast(event)) {
          setData((current) => createEmptySleiData({ ...current, messages: markAgentActivityFailedByDiagnostic(current.messages, event) }));
          showAppToast(formatDiagnosticEventToast(messages.common.operationFailed, event), "error");
        }
      }
    };
    void pollDiagnostics().catch((error: unknown) => {
      logAppEvent(bridge, "diagnostics", "poll-failed", { error: formatLogError(error) });
    });
    const interval = window.setInterval(() => {
      void pollDiagnostics().catch((error: unknown) => {
        logAppEvent(bridge, "diagnostics", "poll-failed", { error: formatLogError(error) });
      });
    }, 2000);
    return () => {
      mounted = false;
      window.clearInterval(interval);
    };
  }, [bridge, messages.common.operationFailed]);

  useEffect(() => {
    const failStaleActivities = () => {
      let failedActivities: SleiMessage[] = [];
      setData((current) => {
        const result = failStaleAgentActivities(current.messages);
        failedActivities = result.failedActivities;
        if (failedActivities.length === 0) return current;
        return createEmptySleiData({ ...current, messages: result.messages });
      });
      if (failedActivities.length === 0) return;
      const names = failedActivities.map((message) => message.author).filter(Boolean).join(", ");
      showAppToast(names ? `${messages.chat.agentRunFailed}：${names}` : messages.chat.agentRunFailed, "error");
      logAppEvent(bridge, "channel-agent-reply", "stale-activity-timeout", {
        activityIds: failedActivities.map((message) => message.id),
      });
    };
    failStaleActivities();
    const interval = window.setInterval(failStaleActivities, 10_000);
    return () => window.clearInterval(interval);
  }, [bridge, messages.chat.agentRunFailed]);

  useEffect(() => {
    if (!activeChannelId || !hasPendingAgentActivity(data.messages, activeChannelId)) return;
    const refreshActiveTaskSummaries = () => {
      void refreshTasks(activeChannelId).catch((error: unknown) => {
        logAppEvent(bridge, "task-refresh", "summary-refresh-failed-while-agent-pending", { channelId: activeChannelId, error: formatLogError(error) });
        showBackendServiceErrorToast(error);
      });
    };
    refreshActiveTaskSummaries();
    const interval = window.setInterval(refreshActiveTaskSummaries, 1500);
    return () => window.clearInterval(interval);
  }, [activeChannelId, backendErrorToastsEnabled, bridge, data.messages]);

  useEffect(() => {
    let mounted = true;
    bridge
      .listTasks(activeChannelId ? { channelId: activeChannelId } : {})
      .then((receipt) => {
        if (!mounted) return;
        setData((current) =>
          createEmptySleiData({
            ...current,
            tasks: mergeTaskSummariesIntoTasks(current.tasks, receipt.tasks, current.members, activeChannelId),
          }),
        );
      })
      .catch(() => undefined);
    return () => {
      mounted = false;
    };
  }, [activeChannelId, bridge]);

  useEffect(() => {
    let mounted = true;
    async function loadInitialState() {
      const [next, preferencesReceipt, savedReceipt, profileReceipt] = await Promise.all([
        refreshRuntime(bridge),
        bridge.listPreferences(),
        bridge.listSavedMessages(),
        bridge.listProfile(),
      ]);
      if (!mounted) return;
      setRuntimeSetup(next);
      applyPreferencesReceipt(preferencesReceipt.preferences);
      setSavedMessages(savedReceipt.savedMessages);
      setProfile(profileReceipt.profile);
      let activeConversation: string | undefined;
      if (hasReadyClaudeRuntime(next.nodes)) {
        setGuideBootstrapping(true);
        const guideReceipt = await bridge.bootstrapGuideAgent();
        activeConversation = guideReceipt.status === "created" ? guideReceipt.conversation?.id : undefined;
      }
      const [agentReceipt, conversationReceipt, channelReceipt] = await Promise.all([
        bridge.listAgents(),
        bridge.listConversations(),
        bridge.listChannels(),
      ]);
      if (!mounted) return;
      setGuideBootstrapping(false);
      const messagesForLocale = createDesktopMessages(preferencesReceipt.preferences.locale);
      let members = await loadGuideSkillsForMembers(
        bridge,
        mergeAgentViewsIntoMembers([], agentReceipt.agents, next.nodes, messagesForLocale),
      );
      members = await loadSleiChannelMemberReadiness(bridge, channelReceipt.channels, members);
      const conversationSessions = await loadSleiConversationSessions(bridge, conversationReceipt.conversations);
      const conversationMessages = await loadSleiConversationMessages(bridge, conversationReceipt.conversations, members, profileReceipt.profile, messagesForLocale);
      const channelMessages = await loadSleiChannelMessages(bridge, channelReceipt.channels, members, profileReceipt.profile, messagesForLocale);
      const taskReceipt = await bridge.listTasks(activeChannelId ? { channelId: activeChannelId } : {}).catch(() => ({ tasks: [] }));
      if (!mounted) return;
      setData((current) =>
        createEmptySleiData({
          ...current,
          nodes: next.nodes,
          channels: channelReceipt.channels.map((channel) => channelFromView(channel, messagesForLocale)),
          conversations: conversationReceipt.conversations,
          conversationSessions,
          channelSessions: [],
          messages: replaceChannelMessages(
            replaceConversationMessages(current.messages, conversationMessages, conversationReceipt.conversations.map((conversation) => conversation.id)),
            channelMessages,
            channelReceipt.channels.map((channel) => channel.id),
          ),
          members,
          tasks: mergeTaskSummariesIntoTasks(current.tasks, taskReceipt.tasks, members, activeChannelId),
        }),
      );
      setActiveMemberId((current) => current ?? members[0]?.id);
      if (activeConversation) {
        const conversation = conversationReceipt.conversations.find((candidate) => candidate.id === activeConversation);
        setActiveConversationId(activeConversation);
        setActiveSessionId(conversation?.activeSessionId);
        setActiveChannelId("all");
      }
    }
    loadInitialState()
      .catch((error: unknown) => {
        if (!mounted) return;
        setGuideBootstrapping(false);
        setRuntimeSetup({
          loading: false,
          error: error instanceof Error ? error.message : createDesktopMessages("zh-CN").common.runtimeCheckFailed,
          hasClaudeRuntimeReady: false,
          nodes: data.nodes,
        });
      });
    return () => {
      mounted = false;
    };
  }, [bridge]);

  useEffect(() => {
    if (!activeMemberId) return;
    const member = data.members.find((candidate) => candidate.id === activeMemberId);
    if (!member || member.type !== "agent" || member.skills) return;
    let mounted = true;
    bridge
      .listAgentSkills(activeMemberId)
      .then((receipt) => {
        if (!mounted) return;
        setData((current) =>
          createEmptySleiData({
            ...current,
            members: current.members.map((candidate) =>
              candidate.id === activeMemberId ? { ...candidate, skills: receipt.skills } : candidate,
            ),
          }),
        );
      })
      .catch(() => undefined);
    return () => {
      mounted = false;
    };
  }, [activeMemberId, bridge, data.members]);

  useEffect(() => {
    if (!activeConversationId) return;
    if (!shouldRefreshConversationMessages(data.messages, activeConversationId)) return;
    const refreshConversation = async () => {
      const receipt = await bridge.listConversationMessages(activeConversationId, { limit: DEFAULT_CHAT_MESSAGE_LIMIT });
      const conversationMessages = receipt.messages.map((message) => conversationMessageToSleiMessage(message, data.members, profile, messages));
      setData((current) =>
        createEmptySleiData({
          ...current,
          messages: replaceConversationMessages(current.messages, conversationMessages, [activeConversationId]),
        }),
      );
    };
    const interval = window.setInterval(() => {
      void refreshConversation();
    }, 300);
    return () => window.clearInterval(interval);
  }, [activeConversationId, bridge, data.members, data.messages, profile]);

  useEffect(() => {
    if (activeConversationId || !activeChannelId) return;
    if (!shouldRefreshChannelMessages(data.messages, activeChannelId)) return;
    const refreshChannel = async () => {
      const receipt = await bridge.listChannelMessages(activeChannelId, { limit: DEFAULT_CHAT_MESSAGE_LIMIT });
      const channelMessages = receipt.messages
        .map((message) => channelMessageToSleiMessage(message, data.members, profile, messages))
        .filter((message): message is SleiMessage => Boolean(message));
      setData((current) =>
        createEmptySleiData({
          ...current,
          messages: replaceChannelMessages(current.messages, channelMessages, [activeChannelId]),
        }),
      );
    };
    const interval = window.setInterval(() => {
      void refreshChannel();
    }, 1500);
    return () => window.clearInterval(interval);
  }, [activeChannelId, activeConversationId, bridge, data.channels, data.members, data.messages, messages, profile]);

  useEffect(() => {
    if (activeConversationId || !activeChannelId) return;
    if (!hasUnsettledChannelMemberReadiness(data.members, activeChannelId)) return;
    const interval = window.setInterval(() => {
      void refreshChannelMembersIntoState(activeChannelId)
        .then((members) => refreshChannelMessagesIntoState(activeChannelId, members))
        .catch((error: unknown) => {
          logAppEvent(bridge, "channel-members-readiness-interval", "readiness-refresh-failed", { channelId: activeChannelId, error: formatLogError(error) });
          showBackendServiceErrorToast(error);
        });
    }, 1500);
    return () => window.clearInterval(interval);
  }, [activeChannelId, activeConversationId, backendErrorToastsEnabled, bridge, data.members]);

  async function handleOpenAgentPath(agentId: string, target: AgentPathTarget) {
    await bridge.openAgentPath(agentId, target);
  }

  async function handleListAgentActivity(agentId: string, limit = 200): Promise<AgentActivityListReceipt> {
    return bridge.listAgentActivity(agentId, limit);
  }

  async function handleListAgentWorkspace(agentId: string, relativePath?: string): Promise<AgentWorkspaceListReceipt> {
    return bridge.listAgentWorkspace(agentId, relativePath);
  }

  async function handleReadAgentWorkspaceFile(agentId: string, relativePath: string): Promise<AgentWorkspaceFileReceipt> {
    return bridge.readAgentWorkspaceFile(agentId, relativePath);
  }

  function applyComputerNodeReceipt(node: DesktopNodeView) {
    setData((current) => createEmptySleiData({ ...current, nodes: upsertComputerNode(current.nodes, node) }));
    setRuntimeSetup((current) => {
      const nextNodes = upsertComputerNode(current.nodes, node);
      return {
        ...current,
        nodes: nextNodes,
        hasClaudeRuntimeReady: hasReadyClaudeRuntime(nextNodes),
      };
    });
  }

  async function handleRenameLocalNode(name: string) {
    const receipt = await bridge.renameLocalNode(name);
    applyComputerNodeReceipt(receipt.node);
  }

  async function handleRefreshRuntime() {
    setRuntimeSetup((current) => ({ ...current, loading: true, error: undefined }));
    const [next, preferencesReceipt, savedReceipt, profileReceipt] = await Promise.all([
      refreshRuntime(bridge),
      bridge.listPreferences(),
      bridge.listSavedMessages(),
      bridge.listProfile(),
    ]);
    if (hasReadyClaudeRuntime(next.nodes)) {
      setGuideBootstrapping(true);
      await bridge.bootstrapGuideAgent();
      setGuideBootstrapping(false);
    }
    const [agentReceipt, conversationReceipt, channelReceipt] = await Promise.all([bridge.listAgents(), bridge.listConversations(), bridge.listChannels()]);
    setRuntimeSetup(next);
    applyPreferencesReceipt(preferencesReceipt.preferences);
    setSavedMessages(savedReceipt.savedMessages);
    setProfile(profileReceipt.profile);
    const messagesForLocale = createDesktopMessages(preferencesReceipt.preferences.locale);
    let members = await loadGuideSkillsForMembers(
      bridge,
      mergeAgentViewsIntoMembers([], agentReceipt.agents, next.nodes, messagesForLocale),
    );
    members = await loadSleiChannelMemberReadiness(bridge, channelReceipt.channels, members);
    const conversationSessions = await loadSleiConversationSessions(bridge, conversationReceipt.conversations);
    const conversationMessages = await loadSleiConversationMessages(bridge, conversationReceipt.conversations, members, profileReceipt.profile, messagesForLocale);
    const channelMessages = await loadSleiChannelMessages(bridge, channelReceipt.channels, members, profileReceipt.profile, messagesForLocale);
    const taskReceipt = await bridge.listTasks(activeChannelId ? { channelId: activeChannelId } : {}).catch(() => ({ tasks: [] }));
    setData((current) =>
      createEmptySleiData({
        ...current,
        nodes: next.nodes,
        channels: channelReceipt.channels.map((channel) => channelFromView(channel, messagesForLocale)),
        conversations: conversationReceipt.conversations,
        conversationSessions,
        channelSessions: [],
        messages: replaceChannelMessages(
          replaceConversationMessages(current.messages, conversationMessages, conversationReceipt.conversations.map((conversation) => conversation.id)),
          channelMessages,
          channelReceipt.channels.map((channel) => channel.id),
        ),
        members,
        tasks: mergeTaskSummariesIntoTasks(current.tasks, taskReceipt.tasks, members, activeChannelId),
      }),
    );
    setActiveMemberId((current) => current ?? members[0]?.id);
  }

  async function handleCreateAgent(request: AgentDraftInput) {
    const receipt = await bridge.createAgent(request);
    const agentReceipt = await bridge.listAgents();
    let members = await loadGuideSkillsForMembers(
      bridge,
      mergeAgentViewsIntoMembers(data.members, agentReceipt.agents, runtimeSetup.nodes, messages),
    );
    members = await loadSleiChannelMemberReadiness(bridge, data.channels, members);
    setData((current) => createEmptySleiData({ ...current, members }));
    setActiveMemberId(receipt.agent.id);
    showAppToast(messages.agentCreate.createdSuccess, "success");
  }

  async function refreshChannelsAfterCreate(channelId: string) {
    const receipt = await bridge.listChannels();
    const channels = receipt.channels.map((channel) => channelFromView(channel, messages));
    setData((current) => createEmptySleiData({ ...current, channels, channelSessions: [] }));
    if (channels.some((channel) => channel.id === channelId)) {
      setActiveChannelId(channelId);
      setActiveConversationId(undefined);
      setActiveSessionId(undefined);
    }
    return channels;
  }

  async function handleInteractiveCardComplete(cardId: string) {
    const receipt = await bridge.completeInteractiveCard(cardId);
    setData((current) =>
      createEmptySleiData({
        ...current,
        messages: current.messages.map((message) => ({
          ...message,
          cards: message.cards?.map((card) => (card.id === cardId ? receipt.card : card)),
        })),
      }),
    );
  }

  async function handlePermissionResolve(requestId: string, decision: PermissionDecision) {
    const receipt = await bridge.resolvePermission({ requestId, decision });
    const message = conversationMessageToSleiMessage(receipt.message, data.members, profile, messages);
    setData((current) =>
      createEmptySleiData({
        ...current,
        messages: current.messages.some((candidate) => candidate.id === message.id)
          ? current.messages.map((candidate) => (candidate.id === message.id ? message : candidate))
          : [...current.messages, message],
      }),
    );
  }

  async function handleUpdateAgent(agentId: string, update: Partial<AgentDraftInput>) {
    const receipt = await bridge.updateAgent(agentId, update);
    const member = memberFromAgentView(receipt.agent, runtimeSetup.nodes, messages);
    setData((current) =>
      createEmptySleiData({
        ...current,
        members: current.members.map((candidate) => (candidate.id === member.id ? { ...member, channelReadiness: candidate.channelReadiness } : candidate)),
      }),
    );
  }

  async function handleDeleteAgent(agentId: string) {
    await bridge.deleteAgent(agentId);
    setData((current) => {
      const removedConversationIds = current.conversations
        .filter((conversation) => conversation.agentId === agentId)
        .map((conversation) => conversation.id);
      const removedConversationIdSet = new Set(removedConversationIds);
      return createEmptySleiData({
        ...current,
        members: current.members.filter((member) => member.id !== agentId),
        conversations: current.conversations.filter((conversation) => conversation.agentId !== agentId),
        conversationSessions: current.conversationSessions.filter((session) => !removedConversationIdSet.has(session.conversationId)),
        messages: current.messages.filter((message) => !message.channelId || !removedConversationIdSet.has(message.channelId)),
      });
    });
    setActiveMemberId((current) => {
      if (current !== agentId) return current;
      return data.members.find((member) => member.id !== agentId)?.id;
    });
    setActiveConversationId((current) => {
      const removed = data.conversations.find((conversation) => conversation.id === current && conversation.agentId === agentId);
      return removed ? undefined : current;
    });
    setActiveSessionId((current) => {
      const removed = data.conversationSessions.find((session) => session.id === current);
      if (!removed) return current;
      const conversation = data.conversations.find((candidate) => candidate.id === removed.conversationId);
      return conversation?.agentId === agentId ? undefined : current;
    });
  }

  function handleCreateComputer(name: string, osLabel: string) {
    const node = createDraftComputerNode(name, osLabel);
    setData((current) => createEmptySleiData({ ...current, nodes: [...current.nodes, node] }));
    setRuntimeSetup((current) => {
      const nextNodes = [...current.nodes, node];
      return {
        ...current,
        nodes: nextNodes,
        hasClaudeRuntimeReady: hasReadyClaudeRuntime(nextNodes),
      };
    });
  }

  async function handleRenameComputer(nodeId: string, name: string) {
    if (nodeId === "local-node") {
      const receipt = await bridge.renameLocalNode(name);
      applyComputerNodeReceipt(receipt.node);
      return;
    }

    setData((current) => createEmptySleiData({ ...current, nodes: renameComputerNode(current.nodes, nodeId, name) }));
    setRuntimeSetup((current) => {
      const nextNodes = renameComputerNode(current.nodes, nodeId, name);
      return {
        ...current,
        nodes: nextNodes,
        hasClaudeRuntimeReady: hasReadyClaudeRuntime(nextNodes),
      };
    });
  }

  function handleDeleteComputer(nodeId: string) {
    setData((current) => createEmptySleiData({ ...current, nodes: deleteComputerNode(current.nodes, nodeId) }));
    setRuntimeSetup((current) => {
      const nextNodes = deleteComputerNode(current.nodes, nodeId);
      return {
        ...current,
        nodes: nextNodes,
        hasClaudeRuntimeReady: hasReadyClaudeRuntime(nextNodes),
      };
    });
  }

  async function handleMessageMember(memberId: string) {
    const member = data.members.find((candidate) => candidate.id === memberId);
    if (member?.directMessageEnabled === false) return;
    const receipt = await bridge.createDmConversation(memberId);
    const sessionsReceipt = await bridge.listConversationSessions(receipt.conversation.id);
    const messagesReceipt = await bridge.listConversationMessages(receipt.conversation.id, { limit: DEFAULT_CHAT_MESSAGE_LIMIT });
    const conversationMessages = messagesReceipt.messages.map((message) => conversationMessageToSleiMessage(message, data.members, profile, messages));
    setData((current) =>
      createEmptySleiData({
        ...current,
        conversations: upsertConversation(current.conversations, receipt.conversation),
        conversationSessions: [
          ...current.conversationSessions.filter((session) => session.conversationId !== receipt.conversation.id),
          ...sessionsReceipt.sessions,
        ],
        messages: replaceConversationMessages(current.messages, conversationMessages, [receipt.conversation.id]),
      }),
    );
    setActiveConversationId(receipt.conversation.id);
    setActiveSessionId(receipt.conversation.activeSessionId ?? sessionsReceipt.sessions[0]?.id);
    setActiveChannelId("all");
    setActiveMemberId(memberId);
    navigateToView("chat");
  }

  async function handleCreateConversationSession(conversationId: string) {
    const receipt = await bridge.createConversationSession(conversationId);
    setData((current) =>
      createEmptySleiData({
        ...current,
        conversations: upsertConversation(current.conversations, receipt.conversation),
        conversationSessions: [
          ...current.conversationSessions.filter((session) => session.id !== receipt.session.id),
          receipt.session,
        ],
      }),
    );
    setActiveSessionId(receipt.session.id);
    setSessionDrawerOpen(false);
  }

  async function handleConversationSessionSelect(conversationId: string, sessionId: string) {
    const receipt = await bridge.activateConversationSession(conversationId, sessionId);
    const messagesReceipt = await bridge.listConversationMessages(conversationId, { limit: DEFAULT_CHAT_MESSAGE_LIMIT });
    const conversationMessages = messagesReceipt.messages.map((message) => conversationMessageToSleiMessage(message, data.members, profile, messages));
    setData((current) =>
      createEmptySleiData({
        ...current,
        conversations: upsertConversation(current.conversations, receipt.conversation),
        conversationSessions: current.conversationSessions.map((session) => (session.id === receipt.session.id ? receipt.session : session)),
        messages: replaceConversationMessages(current.messages, conversationMessages, [conversationId]),
      }),
    );
    setActiveConversationId(conversationId);
    setActiveSessionId(sessionId);
    setSessionDrawerOpen(false);
  }

  async function handleUploadConversationAttachment(request: ConversationAttachmentUploadRequest) {
    return bridge.uploadConversationAttachment(request);
  }

  async function handleSendMessage(body: string, options?: { asTask?: boolean; attachmentIds?: string[]; sessionId?: string }) {
    const targetId = activeConversationId ?? activeChannelId;
    const memoryRequest = detectAgentMemoryRequest(body, data.members);
    if (activeConversationId) {
      const attachmentIds = options?.attachmentIds ?? [];
      if (!body.trim() && attachmentIds.length === 0) return;
      setSendingConversationIds((current) => [...new Set([...current, activeConversationId])]);
      try {
        const result = await sendChatComposerMessage({
          activeChannelId,
          activeConversationId,
          activeSessionId: options?.sessionId ?? activeSessionId,
          attachmentIds,
          asTask: options?.asTask,
          body,
          bridge,
          messages,
          profile,
        });
        if (result.kind !== "conversation") return;
        const receipt = result.receipt;
        const conversationMessage = conversationMessageToSleiMessage(receipt.message, data.members, profile, messages);
        if (memoryRequest) {
          void bridge.rememberAgentFact(memoryRequest.agentId, memoryRequest.fact);
          const agent = data.members.find((member) => member.id === memoryRequest.agentId);
          const now = new Date().toISOString();
          const systemMessage: SleiMessage = {
            id: `memory-${Date.now()}`,
            author: messages.common.system,
            role: "system",
            time: formatMessageTime(now),
            sentAt: formatMessageDateTime(now),
            body: messages.chat.memoryUpdated(agent?.handle ?? messages.agentCreate.fallbackAgent),
            channelId: targetId,
            sessionId: options?.sessionId ?? activeSessionId,
            status: "done",
            toolCall: "remember_agent_fact",
          };
          setData((current) => createEmptySleiData({ ...current, messages: [...current.messages, conversationMessage, systemMessage] }));
          return;
        }
        setData((current) => {
          const nextTasks = options?.asTask ? [...current.tasks, createTaskFromChatMessage(conversationMessage, targetId)] : current.tasks;
          return createEmptySleiData({ ...current, messages: [...current.messages, conversationMessage], tasks: nextTasks });
        });
        const messagesReceipt = await bridge.listConversationMessages(activeConversationId, { limit: DEFAULT_CHAT_MESSAGE_LIMIT });
        const conversationMessages = messagesReceipt.messages.map((message) => conversationMessageToSleiMessage(message, data.members, profile, messages));
        setData((current) =>
          createEmptySleiData({
            ...current,
            messages: replaceConversationMessages(current.messages, conversationMessages, [activeConversationId]),
          }),
        );
      } finally {
        setSendingConversationIds((current) => current.filter((id) => id !== activeConversationId));
      }
        return;
    }
    const message = createLocalChatMessage({ body, messages, profile, channelId: targetId });
    if (!message) return;
    const result = await sendChatComposerMessage({
      activeChannelId,
      asTask: options?.asTask,
      body,
      bridge,
      messages,
      profile,
    });
    if (result.kind !== "channel") return;
    const channelMessage = { ...message, id: result.receipt.outcome.messageId };
    logAppEvent(bridge, "channel-send", "daemon-outcome", {
      channelId: targetId,
      messageId: result.receipt.outcome.messageId,
      action: result.receipt.outcome.action,
      taskId: result.receipt.outcome.taskId,
      assigneeAgentId: result.receipt.outcome.assigneeAgentId,
      assigneeAgentIds: result.receipt.outcome.assigneeAgentIds,
      coordinatorRunId: result.receipt.outcome.coordinatorRunId,
      decisionStatus: result.receipt.outcome.decisionStatus,
    });
    if (memoryRequest) {
      void bridge.rememberAgentFact(memoryRequest.agentId, memoryRequest.fact);
      const agent = data.members.find((member) => member.id === memoryRequest.agentId);
      const now = new Date().toISOString();
      const systemMessage: SleiMessage = {
        id: `memory-${channelMessage.id}`,
        author: messages.common.system,
        role: "system",
        time: formatMessageTime(now),
        sentAt: formatMessageDateTime(now),
        body: messages.chat.memoryUpdated(agent?.handle ?? messages.agentCreate.fallbackAgent),
        channelId: targetId,
        status: "done",
        toolCall: "remember_agent_fact",
      };
      setData((current) => createEmptySleiData({ ...current, messages: [...current.messages, channelMessage, systemMessage] }));
      return;
    }

    if (result.receipt.outcome.taskId) {
      void refreshTasks(targetId).catch((error: unknown) => {
        logAppEvent(bridge, "task-refresh", "summary-refresh-failed-after-channel-send", { channelId: targetId, error: formatLogError(error) });
        showBackendServiceErrorToast(error);
      });
    }

    setData((current) => {
      const archiveNotice = createChannelArchiveNoticeMessage(result.receipt.outcome, targetId, messages);
      const agentActivities = createChannelAgentActivityMessages(result.receipt.outcome, targetId, current.members);
      const nextMessages = [channelMessage, archiveNotice, ...agentActivities].filter((message): message is SleiMessage => Boolean(message));
      return createEmptySleiData({ ...current, messages: [...current.messages, ...nextMessages] });
    });
    void refreshChannelMessagesIntoState(targetId, data.members).catch((error: unknown) => {
      logAppEvent(bridge, "channel-refresh", "messages-refresh-failed-after-send", { channelId: targetId, error: formatLogError(error) });
      showBackendServiceErrorToast(error);
    });
    if ((result.receipt.outcome.assigneeAgentIds ?? []).length > 0 || result.receipt.outcome.taskId) {
      logAppEvent(bridge, "channel-agent-reply", "delegated-to-daemon", {
        channelId: targetId,
        messageId: result.receipt.outcome.messageId,
        action: result.receipt.outcome.action,
        taskId: result.receipt.outcome.taskId,
        assigneeAgentId: result.receipt.outcome.assigneeAgentId,
        assigneeAgentIds: result.receipt.outcome.assigneeAgentIds,
      });
    }
  }

  async function handleSendMessageWithBackendState(body: string, options?: { asTask?: boolean; attachmentIds?: string[]; sessionId?: string }) {
    try {
      await handleSendMessage(body, options);
    } catch (error) {
      markCachedNodesOfflineForDaemonUnavailable(error);
      throw error;
    }
  }

  async function handleTaskReply(taskId: string, body: string) {
    const trimmed = body.trim();
    if (!trimmed) return;
    const task = data.tasks.find((candidate) => candidate.id === taskId);
    const channelId = task?.channelId ?? activeChannelId ?? "all";
    const receipt = await bridge.replyToTask(taskId, { senderId: "human:local", body: trimmed });
    try {
      const threadReceipt = await bridge.getTaskThread(taskId);
      applyTaskThreadReceiptToState(threadReceipt);
    } catch (error) {
      appendTaskReplyReceiptToState(taskId, receipt.reply);
      logAppEvent(bridge, "task-refresh", "thread-refresh-failed-after-reply", { channelId, taskId, error: formatLogError(error) });
      showBackendServiceErrorToast(error);
    }
    void refreshTasks(channelId).catch((error: unknown) => {
      logAppEvent(bridge, "task-refresh", "summary-refresh-failed-after-reply", { channelId, taskId, error: formatLogError(error) });
      showBackendServiceErrorToast(error);
    });
    if (receipt.route.handoffAgentIds.length > 0) {
      logAppEvent(bridge, "task-agent-reply", "delegated-to-daemon", {
        channelId,
        taskId,
        handoffAgentIds: receipt.route.handoffAgentIds,
      });
    }
  }

  async function handleMessageThreadOpen(message: SleiMessage) {
    const created = await bridge.createMessageThreadFromSource({
      sourceMessageId: message.id,
      createdBy: "human:local",
    });
    const receipt = await bridge.getMessageThread(created.thread.id);
    applyMessageThreadReceiptToState(receipt);
  }

  async function handleMessageThreadReply(threadId: string, body: string) {
    const trimmed = body.trim();
    if (!trimmed) return;
    const receipt = await bridge.replyToMessageThread(threadId, {
      senderId: "human:local",
      role: "human",
      body: trimmed,
    });
    appendMessageThreadReplyToState(threadId, receipt.reply);
  }

  async function handleLoadOlderMessages() {
    const targetId = activeConversationId ?? activeChannelId;
    if (!targetId || olderMessagesLoadingRef.current || exhaustedOlderMessageTargetsRef.current.has(targetId)) return;
    const targetMessages = data.messages
      .filter((message) => message.channelId === targetId && typeof message.sequence === "number")
      .sort((left, right) => (left.sequence ?? 0) - (right.sequence ?? 0));
    const oldestSequence = targetMessages[0]?.sequence;
    if (oldestSequence === undefined) return;
    olderMessagesLoadingRef.current = true;
    try {
      let hasMoreBefore = false;
      let olderMessages: SleiMessage[] = [];
      if (activeConversationId) {
        const receipt = await bridge.listConversationMessages(activeConversationId, { before: oldestSequence, limit: OLDER_CHAT_MESSAGE_LIMIT });
        hasMoreBefore = receipt.pageInfo.hasMoreBefore;
        olderMessages = receipt.messages.map((message) => conversationMessageToSleiMessage(message, data.members, profile, messages));
      } else {
        const receipt = await bridge.listChannelMessages(activeChannelId, { before: oldestSequence, limit: OLDER_CHAT_MESSAGE_LIMIT });
        hasMoreBefore = receipt.pageInfo.hasMoreBefore;
        olderMessages = receipt.messages
          .map((message) => channelMessageToSleiMessage(message, data.members, profile, messages))
          .filter((message): message is SleiMessage => Boolean(message));
      }
      if (!hasMoreBefore) {
        exhaustedOlderMessageTargetsRef.current.add(targetId);
      }
      if (olderMessages.length === 0) return;
      setData((current) =>
        createEmptySleiData({
          ...current,
          messages: mergeMessagePage(current.messages, olderMessages, "prepend", [targetId]),
        }),
      );
    } finally {
      olderMessagesLoadingRef.current = false;
    }
  }

  async function handleTaskStatusChange(taskId: string, status: TaskStatusView) {
    const receipt = await bridge.updateTaskStatus(taskId, { status });
    setData((current) =>
      createEmptySleiData({
        ...current,
        tasks: current.tasks.map((task) =>
          task.id === taskId
            ? {
                ...taskSummaryToSleiTask(receipt.task, current.members),
                replies: task.replies,
              }
            : task,
        ),
      }),
    );
    void refreshTasks(activeChannelId).catch((error: unknown) => {
      logAppEvent(bridge, "task-refresh", "summary-refresh-failed-after-status", { channelId: activeChannelId, taskId, error: formatLogError(error) });
      showBackendServiceErrorToast(error);
    });
  }

  async function handleCreateChannel(input: { name: string; projectName?: string; projectPaths?: string[]; agentIds?: string[] }) {
    const name = stripChannelHash(input.name);
    const projectPaths = [...new Set((input.projectPaths ?? []).map((path) => path.trim()).filter(Boolean))];
    const projectName = projectPaths.length > 0 ? projectPaths.join(", ") : input.projectName?.trim() || undefined;
    const receipt = await bridge.createChannel({
      name,
      description: projectName,
      projectPaths,
      agentIds: input.agentIds ?? [],
    });
    const createdProjectPaths = receipt.channel.projectPaths ?? projectPaths;
    const channel = {
      ...channelFromView(receipt.channel, messages),
      projectName: createdProjectPaths.length > 0 ? createdProjectPaths.join(", ") : projectName,
      projectPaths: createdProjectPaths,
    };
    setData((current) => {
      if (current.channels.some((candidate) => candidate.id === channel.id || candidate.name === channel.name)) return current;
      return createEmptySleiData({ ...current, channels: [...current.channels, channel] });
    });
    setActiveChannelId(channel.id);
    setActiveConversationId(undefined);
    setActiveSessionId(undefined);
    const members = await refreshChannelMembersIntoState(channel.id);
    await refreshChannelMessagesIntoState(channel.id, members);
    refreshChannelMembersInBackground(channel.id, members);
    return receipt;
  }

  async function handleAddChannelMember(agentId: string) {
    try {
      await bridge.addChannelMember(activeChannelId, { agentId });
      const members = await refreshChannelMembersIntoState(activeChannelId);
      await refreshChannelMessagesIntoState(activeChannelId, members);
      refreshChannelMembersInBackground(activeChannelId, members);
      showAppToast(messages.chat.addChannelMemberSuccess, "success");
    } catch (error) {
      showAppToast(formatAppErrorToast(messages.chat.addChannelMemberFailed, error), "error");
    }
  }

  async function handleRemoveChannelMember(agentId: string) {
    try {
      await bridge.removeChannelMember(activeChannelId, agentId);
      const members = await refreshChannelMembersIntoState(activeChannelId);
      await refreshChannelMessagesIntoState(activeChannelId, members);
      showAppToast(messages.chat.removeChannelMemberSuccess, "success");
    } catch (error) {
      showAppToast(formatAppErrorToast(messages.chat.removeChannelMemberFailed, error), "error");
    }
  }

  async function handleDeleteChannel(channelId: string) {
    if (channelId === "all") return;
    const channelName = stripChannelHash(data.channels.find((channel) => channel.id === channelId)?.name ?? channelId);
    try {
      await bridge.deleteChannel(channelId);
    } catch (error) {
      showAppToast(formatAppErrorToast(messages.chat.deleteChannelFailed, error), "error");
      return;
    }
    setData((current) =>
      createEmptySleiData({
        ...current,
        channels: current.channels.filter((channel) => channel.id !== channelId),
        messages: current.messages.filter((message) => (message.channelId ?? "all") !== channelId),
        members: current.members.map((member) => {
          const nextReadiness = { ...(member.channelReadiness ?? {}) };
          delete nextReadiness[channelId];
          return { ...member, channelReadiness: Object.keys(nextReadiness).length > 0 ? nextReadiness : undefined };
        }),
      }),
    );
    setActiveChannelId((current) => (current === channelId ? "all" : current));
    showAppToast(messages.chat.deleteChannelSuccess(channelName), "success");
  }

  async function handleReplaceChannelProjectPaths(channelId: string, projectPaths: string[]) {
    try {
      const receipt = await bridge.replaceChannelProjectPaths(channelId, { projectPaths });
      const updatedChannel = channelFromView(receipt.channel, messages);
      setData((current) =>
        createEmptySleiData({
          ...current,
          channels: current.channels.map((channel) => channel.id === channelId ? { ...channel, ...updatedChannel } : channel),
        }),
      );
      showAppToast(messages.chat.projectUpdateSuccess, "success");
    } catch (error) {
      showAppToast(formatAppErrorToast(messages.chat.projectUpdateFailed, error), "error");
      throw error;
    }
  }

  function handleAgentSearchResultSelect(agentId: string) {
    beginMessageNavigationSelection();
    setActiveMemberId(agentId);
    navigateToView("members");
  }

  function handleChannelSearchResultSelect(channelId: string) {
    beginMessageNavigationSelection();
    setActiveChannelId(channelId);
    setActiveConversationId(undefined);
    setActiveSessionId(undefined);
    setChatWorkspaceMode("chat");
    navigateToView("chat");
  }

  function beginMessageNavigationSelection() {
    messageNavigationSequenceRef.current += 1;
    return messageNavigationSequenceRef.current;
  }

  function isCurrentMessageNavigationSelection(sequence: number) {
    return messageNavigationSequenceRef.current === sequence;
  }

  function showMessageNavigationFailure(selectionSequence: number, error: unknown, context: Record<string, unknown>) {
    if (!isCurrentMessageNavigationSelection(selectionSequence)) return;
    logAppEvent(bridge, "message-navigation", "selection-failed", { ...context, error: formatLogError(error) });
    showAppToast(messages.search.errorDescription, "error");
  }

  function focusMessageFromNavigation(messageId: string, selectionSequence: number) {
    setFocusedMessageId(undefined);
    window.setTimeout(() => {
      if (!isCurrentMessageNavigationSelection(selectionSequence)) return;
      setFocusedMessageId(messageId);
    }, 0);
  }

  async function handleMessageSearchResultSelect(result: GlobalMessageSearchResult) {
    const selectionSequence = beginMessageNavigationSelection();
    try {
      if (result.sourceKind === "dm" || result.conversationId?.startsWith("dm:")) {
        const conversationId = result.conversationId;
        if (conversationId) {
          const conversation = data.conversations.find((candidate) => candidate.id === conversationId);
          const conversationMessages = await loadConversationMessagesForState(conversationId);
          if (!isCurrentMessageNavigationSelection(selectionSequence)) return;
          setData((current) =>
            createEmptySleiData({
              ...current,
              conversations: current.conversations,
              conversationSessions: current.conversationSessions,
              messages: replaceConversationMessages(current.messages, conversationMessages, [conversationId]),
            }),
          );
          setActiveConversationId(conversationId);
          setActiveSessionId(conversation?.activeSessionId);
        }
        setActiveChannelId("all");
      } else {
        const channelId = result.channelId ?? "all";
        const channelMessages = await loadChannelMessagesForState(channelId, data.members);
        if (!isCurrentMessageNavigationSelection(selectionSequence)) return;
        setData((current) =>
          createEmptySleiData({
            ...current,
            channels: current.channels,
            channelSessions: current.channelSessions,
            messages: replaceChannelMessages(current.messages, channelMessages, [channelId]),
          }),
        );
        setActiveChannelId(channelId);
        setActiveConversationId(undefined);
        setActiveSessionId(undefined);
      }
      setSessionDrawerOpen(false);
      setChatWorkspaceMode("chat");
      focusMessageFromNavigation(result.messageId, selectionSequence);
      navigateToView("chat");
    } catch (error) {
      showMessageNavigationFailure(selectionSequence, error, {
        source: "search",
        messageId: result.messageId,
        channelId: result.channelId,
        conversationId: result.conversationId,
        sessionId: result.sessionId ?? undefined,
      });
    }
  }

  function handleSearchResultSelect(channelId: string) {
    handleChannelSearchResultSelect(channelId);
  }

  async function handleMessageSaveToggle(message: SleiMessage) {
    const existing = savedMessages.find((saved) => saved.messageId === message.id);
    if (existing) {
      await bridge.unsaveMessage(message.id);
      setSavedMessages((current) => current.filter((saved) => saved.messageId !== message.id));
      return;
    }

    const sourceId = message.channelId ?? activeConversationId ?? activeChannelId;
    const request: SaveMessageRequest = {
      messageId: message.id,
      sourceId,
      sourceKind: sourceId.startsWith("dm:") || activeConversationId ? "dm" : "channel",
      sessionId: message.sessionId,
    };
    const receipt = await bridge.saveMessage(request);
    setSavedMessages((current) =>
      current.some((saved) => saved.messageId === receipt.savedMessage.messageId)
        ? current
        : [receipt.savedMessage, ...current],
    );
  }

  async function handleSavedMessageSelect(savedMessage: SavedMessageView) {
    const selectionSequence = beginMessageNavigationSelection();
    try {
      if (savedMessage.sourceKind === "dm" || savedMessage.sourceId.startsWith("dm:")) {
        const conversation = data.conversations.find((candidate) => candidate.id === savedMessage.sourceId);
        const conversationMessages = await loadConversationMessagesForState(savedMessage.sourceId, {
          aroundMessageId: savedMessage.messageId,
          limit: DEFAULT_CHAT_MESSAGE_LIMIT,
        });
        if (!isCurrentMessageNavigationSelection(selectionSequence)) return;
        setData((current) =>
          createEmptySleiData({
            ...current,
            conversations: current.conversations,
            conversationSessions: current.conversationSessions,
            messages: replaceConversationMessages(current.messages, conversationMessages, [savedMessage.sourceId]),
          }),
        );
        setActiveConversationId(savedMessage.sourceId);
        setActiveSessionId(conversation?.activeSessionId);
        setActiveChannelId("all");
      } else {
        const channelMessages = await loadChannelMessagesForState(savedMessage.sourceId, data.members, {
          aroundMessageId: savedMessage.messageId,
          limit: DEFAULT_CHAT_MESSAGE_LIMIT,
        });
        if (!isCurrentMessageNavigationSelection(selectionSequence)) return;
        setData((current) =>
          createEmptySleiData({
            ...current,
            channels: current.channels,
            channelSessions: current.channelSessions,
            messages: replaceChannelMessages(current.messages, channelMessages, [savedMessage.sourceId]),
          }),
        );
        setActiveChannelId(savedMessage.sourceId);
        setActiveConversationId(undefined);
        setActiveSessionId(undefined);
      }
      setSessionDrawerOpen(false);
      setChatWorkspaceMode("chat");
      focusMessageFromNavigation(savedMessage.messageId, selectionSequence);
      navigateToView("chat");
    } catch (error) {
      showMessageNavigationFailure(selectionSequence, error, {
        source: "saved-message",
        messageId: savedMessage.messageId,
        sourceId: savedMessage.sourceId,
        sourceKind: savedMessage.sourceKind,
        sessionId: savedMessage.sessionId ?? undefined,
      });
    }
  }

  async function handleLocaleChange(nextLocale: AppLocale) {
    await handlePreferenceMutation("locale", (current) => ({ ...current, locale: nextLocale }), () =>
      bridge.updatePreferences({ locale: nextLocale }),
    );
  }

  async function handleTimeZoneChange(nextTimeZone: string) {
    await handlePreferenceMutation("timeZone", (current) => ({ ...current, timeZone: nextTimeZone }), () =>
      bridge.updatePreferences({ timeZone: nextTimeZone }),
    );
  }

  async function handleAppearanceChange(nextAppearance: AppearancePreferences) {
    const normalizedAppearance = normalizeAppearance(nextAppearance);
    await handlePreferenceMutation("appearance", (current) => ({ ...current, appearance: normalizedAppearance }), () =>
      bridge.updatePreferences({ appearance: normalizedAppearance }),
    );
  }

  async function handleNotificationsChange(nextNotifications: NotificationPreferences) {
    await handlePreferenceMutation("notifications", (current) => ({ ...current, notifications: nextNotifications }), () =>
      bridge.updatePreferences({ notifications: nextNotifications }),
    );
  }

  async function handlePreferenceMutation(
    pendingKey: NonNullable<typeof pendingPreference>,
    buildOptimistic: (current: UserPreferences) => UserPreferences,
    persist: () => Promise<{ preferences: UserPreferences }>,
  ) {
    if (pendingPreferenceRef.current) return;
    const current = currentPreferences();
    pendingPreferenceRef.current = pendingKey;
    setPendingPreference(pendingKey);
    setPreferenceError(undefined);
    try {
      await applyPreferenceMutation({
        current,
        optimistic: buildOptimistic(current),
        applyOptimistic: applyPreferencesReceipt,
        persist: async () => {
          const receipt = await persist();
          return receipt.preferences;
        },
        applyConfirmed: applyPreferencesReceipt,
        onError: (error) => {
          const message = formatAppErrorToast(messages.settings.updateFailed, error);
          setPreferenceError(message);
          showAppToast(message, "error");
        },
        onSuccess: () => showAppToast(messages.settings.updateSuccess, "success"),
      });
    } finally {
      pendingPreferenceRef.current = undefined;
      setPendingPreference(undefined);
    }
  }

  function currentPreferences(): UserPreferences {
    return {
      locale,
      timeZone,
      appearance,
      notifications,
    };
  }

  function applyPreferencesReceipt(preferences: UserPreferences) {
    setLocale(preferences.locale);
    setTimeZone(preferences.timeZone);
    setAppearance(normalizeAppearance(preferences.appearance));
    setNotifications(preferences.notifications);
  }

  async function handleProfileChange(patch: Partial<Pick<UserProfile, "displayName" | "avatar">>) {
    const field = patch.displayName !== undefined ? "displayName" : patch.avatar !== undefined ? "avatar" : undefined;
    if (!field) return;
    if (pendingProfileFieldRef.current) return;
    if (!profile) {
      const message = messages.settings.profileUnavailable;
      setProfileErrors((current) => ({ ...current, [field]: message }));
      showAppToast(message, "error");
      throw new Error(message);
    }

    const previous = profile;
    pendingProfileFieldRef.current = field;
    setPendingProfileField(field);
    setProfileErrors((current) => {
      const next = { ...current };
      delete next[field];
      return next;
    });
    setProfile({ ...profile, ...patch });
    try {
      const receipt = await bridge.updateProfile(patch);
      setProfile(receipt.profile);
      if (field === "avatar") showAppToast(messages.settings.updateSuccess, "success");
    } catch (error) {
      setProfile(previous);
      const message = formatAppErrorToast(field === "avatar" ? messages.settings.updateFailed : messages.settings.saveFailed, error);
      setProfileErrors((current) => ({ ...current, [field]: message }));
      showAppToast(message, "error");
      throw error;
    } finally {
      pendingProfileFieldRef.current = undefined;
      setPendingProfileField(undefined);
    }
  }

  function handleResizeStart(event: ReactPointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = sidebarWidth;
    const handleMove = (moveEvent: PointerEvent) => {
      const nextWidth = Math.min(340, Math.max(160, startWidth + moveEvent.clientX - startX));
      setSidebarWidth(nextWidth);
    };
    const handleUp = () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
  }

  function navigateToView(view: AppView, options: { replace?: boolean } = {}) {
    setActiveView(view);
    if (view !== "chat") setChatWorkspaceMode("chat");
    const route = routePathForView(view);
    if (location.pathname === route) return;
    navigate(route, { replace: options.replace });
  }

  function handleSavedMessagesOpen() {
    beginMessageNavigationSelection();
    setChatWorkspaceMode("saved");
    navigateToView("chat");
  }

  return (
    <SleiAppFrame
      activeChatWorkspace={chatWorkspaceMode}
      activeView={activeView}
      activeChannelId={activeChannelId}
      activeConversationId={activeConversationId}
      activeSessionId={activeSessionId}
      activeMemberId={activeMemberId}
      focusedMessageId={focusedMessageId}
      data={data}
      guideBootstrapping={guideBootstrapping}
      onAgentCreate={handleCreateAgent}
      onAgentDelete={handleDeleteAgent}
      onAgentUpdate={handleUpdateAgent}
      locale={locale}
      timeZone={timeZone}
      appearance={appearance}
      notifications={notifications}
      onChannelCreate={handleCreateChannel}
      onChannelCreateFailure={showAppToast}
      onChannelCreateLog={(message, context) => logAppEvent(bridge, "channel-create", message, context)}
      onChannelCreateRefresh={refreshChannelsAfterCreate}
      onChannelDelete={handleDeleteChannel}
      onChannelMemberAdd={handleAddChannelMember}
      onChannelMemberRemove={handleRemoveChannelMember}
      onChannelProjectPathsChange={handleReplaceChannelProjectPaths}
      onInteractiveCardComplete={handleInteractiveCardComplete}
      onPermissionResolve={handlePermissionResolve}
      onChannelSelect={(channelId) => {
        setChatWorkspaceMode("chat");
        setActiveChannelId(channelId);
        setActiveConversationId(undefined);
        setActiveSessionId(undefined);
      }}
      onComputerCreate={handleCreateComputer}
      onComputerDelete={handleDeleteComputer}
      onComputerRename={handleRenameComputer}
      onGlobalSearch={(query) => bridge.globalSearch(query)}
      onProfileChange={handleProfileChange}
      onLocaleChange={handleLocaleChange}
      onTimeZoneChange={handleTimeZoneChange}
      onAppearanceChange={handleAppearanceChange}
      onNotificationsChange={handleNotificationsChange}
      pendingPreference={pendingPreference}
      preferenceError={preferenceError}
      pendingProfileField={pendingProfileField}
      profileErrors={profileErrors}
      onRefreshRuntime={handleRefreshRuntime}
      onRenameLocalNode={handleRenameLocalNode}
      onResizeStart={handleResizeStart}
      onAgentResultSelect={handleAgentSearchResultSelect}
      onChannelResultSelect={handleChannelSearchResultSelect}
      onMessageResultSelect={handleMessageSearchResultSelect}
      onSearchResultSelect={handleSearchResultSelect}
      onSavedMessageSelect={handleSavedMessageSelect}
      onSavedMessagesOpen={handleSavedMessagesOpen}
      onMessageSaveToggle={handleMessageSaveToggle}
      onMessageThreadOpen={handleMessageThreadOpen}
      onMessageThreadReply={handleMessageThreadReply}
      onOlderMessagesLoad={handleLoadOlderMessages}
      onSendMessage={handleSendMessageWithBackendState}
      onMessageSendFailure={showAppToast}
      onAttachmentUpload={handleUploadConversationAttachment}
      onTaskReply={handleTaskReply}
      onTaskStatusChange={handleTaskStatusChange}
      onTaskThreadOpen={refreshTaskThreadIntoState}
      onViewChange={navigateToView}
      onMemberSelect={setActiveMemberId}
      onMemberMessage={handleMessageMember}
      onOpenAgentPath={handleOpenAgentPath}
      onListAgentActivity={handleListAgentActivity}
      onListAgentWorkspace={handleListAgentWorkspace}
      onReadAgentWorkspaceFile={handleReadAgentWorkspaceFile}
      onConversationNewSession={handleCreateConversationSession}
      onConversationHistoryToggle={() => setSessionDrawerOpen((current) => !current)}
      onConversationSelect={(conversationId) => {
        setChatWorkspaceMode("chat");
        const conversation = data.conversations.find((candidate) => candidate.id === conversationId);
        setActiveConversationId(conversationId);
        setActiveSessionId(conversation?.activeSessionId);
        navigateToView("chat");
      }}
      onConversationSessionSelect={handleConversationSessionSelect}
      profile={profile}
      runtimeSetup={runtimeSetup}
      runtimeErrorToastMessage={appToast.message}
      runtimeToastType={appToast.type}
      savedMessages={savedMessages}
      sessionDrawerOpen={sessionDrawerOpen}
      sendingConversationIds={sendingConversationIds}
      sidebarWidth={sidebarWidth}
    />
  );
}

export function SleiAppFrameRoutes(input: Omit<SleiAppFrameProps, "activeView"> & { activeView?: AppView }) {
  const location = useLocation();
  const navigate = useNavigate();
  const activeView = input.activeView ?? routeViewFromPath(location.pathname);

  return (
    <SleiAppFrame
      {...input}
      activeView={activeView}
      onViewChange={(view) => {
        input.onViewChange?.(view);
        navigate(routePathForView(view));
      }}
    />
  );
}

async function refreshRuntime(bridge: DaemonBridge): Promise<RuntimeSetupState> {
  const receipt = await bridge.refreshRuntimeStatus();
  return {
    loading: false,
    error: undefined,
    hasClaudeRuntimeReady: hasReadyClaudeRuntime(receipt.nodes),
    nodes: receipt.nodes,
  };
}

function upsertComputerNode(nodes: DesktopNodeView[], node: DesktopNodeView) {
  if (nodes.some((candidate) => candidate.id === node.id)) {
    return nodes.map((candidate) => (candidate.id === node.id ? node : candidate));
  }
  return [...nodes, node];
}

function hasReadyClaudeRuntime(nodes: DesktopNodeView[]) {
  return nodes.some((node) =>
    node.runtimes.some((runtime) => runtime.kind === "ClaudeCode" && runtime.readiness === "ready"),
  );
}

export {
  channelDraftCreateInput,
  findActiveAgentActivities,
  resetChannelDraft,
  selectAgentActivityForTick,
  SleiAppFrame,
  submitChannelDraftWithFeedback,
  toggleChannelDraftAgent,
} from "./SleiAppFrame";
