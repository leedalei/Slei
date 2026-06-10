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
  type DesktopAgentView,
  type DesktopNodeView,
  type NotificationPreferences,
  type PermissionDecision,
  type SaveMessageRequest,
  type SavedMessageView,
  type AgentPathTarget,
  type AgentWorkspaceFileReceipt,
  type AgentWorkspaceListReceipt,
  type SendChannelMessageOutcome,
  type RuntimeSetupState,
  type TaskStatusView,
  type TaskSummaryView,
  type TaskThreadReceipt,
  type TaskThreadMessageView,
  type WorkspaceMountView,
} from "../lib/daemon-bridge";
import { createDesktopMessages, type DesktopMessages } from "../i18n";
import type { ToastType } from "../components";
import { SleiAppFrame, type SleiAppFrameProps } from "./SleiAppFrame";
import {
  createSleiFixtures,
  type SleiChannel,
  type SleiChannelMemberReadiness,
  type SleiFixtures,
  type SleiMember,
  type SleiMessage,
  type SleiTask,
  type SleiTaskReply,
} from "./fixtures";
import {
  createDraftComputerNode,
  createLocalChatMessage,
  createTaskFromChatMessage,
  defaultAppearance,
  defaultNotifications,
  defaultProfile,
  defaultTimeZone,
  deleteComputerNode,
  detectAgentMemoryRequest,
  formatMessageTime,
  formatMemberCreatedDate,
  isInternalCoordinatorMember,
  normalizeAppearance,
  parseTaskCardBody,
  renameComputerNode,
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
  formatMemberCreatedDate,
  insertMention,
  isComposerImeComposing,
  moveMentionSelection,
  renameComputerNode,
  shouldRefreshConversationMessages,
  sendChatComposerMessage,
  submitComposerDraftWithFeedback,
  submitComposerDraft,
} from "./model";
export { EditableDetailField, Empty } from "../components";

function conversationMessageToSleiMessage(message: ConversationMessageView, members: SleiMember[], profile: UserProfile): SleiMessage {
  const member = members.find((candidate) => candidate.id === message.authorId);
  const isHuman = message.authorId.startsWith("human:");
  return {
    id: message.id,
    author: member?.name ?? (isHuman ? profile.displayName : message.authorId),
    handle: member?.handle ?? (isHuman ? profile.handle : undefined),
    avatar: member?.avatar ?? (isHuman ? profile.avatar : undefined),
    role: member?.type ?? (isHuman ? "human" : "agent"),
    time: formatMessageTime(message.createdAt),
    body: message.body,
    sessionId: message.sessionId,
    attachments: message.attachments,
    cards: message.cards,
    channelId: message.conversationId,
    status: conversationMessageStatus(message.status),
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

function channelMessageToSleiMessage(message: ChannelMessageView, members: SleiMember[], profile: UserProfile, messages: DesktopMessages): SleiMessage | null {
  if (message.deleted || message.kind === "tombstone") return null;
  if (message.kind === "task_card") {
    const taskCard = parseTaskCardBody(message.body ?? "");
    if (!taskCard) return null;
    return {
      id: message.id,
      author: messages.common.system,
      role: "system",
      time: "",
      body: message.body ?? "",
      channelId: message.channelId,
      taskCard,
    };
  }
  const member = members.find((candidate) => candidate.id === message.authorId);
  const isHuman = message.authorId.startsWith("human:");
  return {
    id: message.id,
    author: member?.name ?? (isHuman ? profile.displayName : message.authorId),
    handle: member?.handle ?? (isHuman ? profile.handle : undefined),
    avatar: member?.avatar ?? (isHuman ? profile.avatar : undefined),
    role: member?.type ?? (isHuman ? "human" : message.kind === "agent" ? "agent" : "system"),
    time: "",
    body: message.body ?? "",
    channelId: message.channelId,
    status: message.kind === "agent" ? "done" : undefined,
  };
}

function replaceChannelMessages(current: SleiMessage[], channelMessages: SleiMessage[], channelIds: string[]): SleiMessage[] {
  const ids = new Set(channelIds);
  return [
    ...current.filter((message) => !message.channelId || message.channelId.startsWith("dm:") || !ids.has(message.channelId)),
    ...channelMessages,
  ];
}

function memberFromAgentView(agent: DesktopAgentView, nodes: DesktopNodeView[], messages: DesktopMessages = createDesktopMessages("zh-CN")): SleiMember {
  const node = nodes.find((candidate) => candidate.id === agent.nodeId);
  const isCoordinator = agent.agentKind === "coordinator";
  return {
    id: agent.id,
    name: agent.name,
    handle: agent.handle,
    avatar: agent.name.slice(0, 2).toUpperCase(),
    avatarSeed: agent.avatarSeed,
    agentKind: agent.agentKind,
    type: "agent",
    runtimeStatus: node?.status === "offline" ? "offline" : "idle",
    role: isCoordinator
      ? messages.members.channelCoordinator
      : agent.agentKind === "guide"
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
    directMessageEnabled: !isCoordinator,
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
    })
    .filter((member) => !isInternalCoordinatorMember(member));
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
    projectName: channel.projectPaths?.length ? channel.projectPaths.join(", ") : undefined,
    projectPaths: channel.projectPaths ?? [],
  };
}

function upsertConversation(conversations: ConversationView[], conversation: ConversationView) {
  return conversations.some((candidate) => candidate.id === conversation.id)
    ? conversations.map((candidate) => (candidate.id === conversation.id ? conversation : candidate))
    : [...conversations, conversation];
}

function createChannelTaskPlaceholder(outcome: SendChannelMessageOutcome, message: SleiMessage, members: SleiMember[]): SleiFixtures["tasks"][number] | null {
  if (!outcome.taskId) return null;
  const assignee = members.find((member) => member.id === outcome.assigneeAgentId);
  return {
    id: outcome.taskId,
    title: message.body.trim().split(/\n+/)[0]?.slice(0, 80) || "Untitled task",
    owner: assignee?.name ?? message.author,
    status: outcome.assigneeAgentId ? "in_progress" : "pending_assignment",
    channelId: message.channelId,
    sourceMessageId: message.id,
    replies: [{ id: `root-${message.id}`, sender: message.author, role: message.role, body: message.body }],
  };
}

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

type TaskAgentReplyInput = {
  agentId: string;
  channelId: string;
  sourceBody: string;
  taskId: string;
  triggerBody?: string;
};

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
    updatedAt: task.updatedAt,
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

function taskThreadMessageToReply(message: TaskThreadMessageView, members: SleiMember[], profile: UserProfile, messages: DesktopMessages): SleiTaskReply {
  const member = members.find((candidate) => candidate.id === message.senderId);
  const role = taskThreadMessageRole(message);
  const isLocalHuman = message.senderId === "human:local" || message.senderId === `human:${profile.handle.replace(/^@/, "")}`;
  const sender = member?.name
    ?? (role === "system"
      ? messages.common.system
      : isLocalHuman
        ? profile.displayName
        : message.senderId);
  return {
    id: message.id,
    sender,
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

function channelAgentReplyPrompt(channelId: string, body: string, target?: SleiMember, coTargets: SleiMember[] = []): string {
  const channelName = channelId.startsWith("#") ? channelId : `#${channelId}`;
  const targetLabel = target ? `${target.name} (${target.handle})` : "未知 Agent";
  const coTargetLabels = coTargets.length > 0
    ? coTargets.map((member) => `${member.name} (${member.handle})`).join(", ")
    : targetLabel;
  return [
    `你被频道协调员路由来回复 ${channelName} 里的用户消息。`,
    `目标 Agent: ${targetLabel}`,
    `同批路由目标: ${coTargetLabels}`,
    "请直接回答用户，不要解释路由过程。",
    "",
    body.trim(),
  ].join("\n");
}

function taskAgentReplyPrompt(input: { channelId: string; taskId: string; sourceBody: string; triggerBody?: string }): string {
  const channelName = input.channelId.startsWith("#") ? input.channelId : `#${input.channelId}`;
  const lines = [
    `你正在处理 ${channelName} 中的任务 ${input.taskId}。`,
    "请只基于这个任务线程继续处理；不要把回复发回外层频道。",
    "任务根消息：",
    input.sourceBody,
  ];
  if (input.triggerBody) {
    lines.push("", "用户在任务线程中的最新指令：", input.triggerBody);
  }
  return lines.join("\n");
}

export const CHANNEL_AGENT_REPLY_IDLE_TIMEOUT_MS = 5 * 60 * 1000;
export const CHANNEL_AGENT_REPLY_POLL_INTERVAL_MS = 500;

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

export function createChannelArchiveNoticeMessage(outcome: SendChannelMessageOutcome, channelId: string, messages: DesktopMessages): SleiMessage | null {
  if (outcome.action !== "local_archive_only") return null;
  return {
    id: `archive-notice-${outcome.messageId}`,
    author: messages.common.system,
    role: "system",
    time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    body: messages.chat.localArchiveOnly,
    channelId,
    status: "done",
  };
}

export function createChannelAgentActivityMessage(outcome: SendChannelMessageOutcome, channelId: string, members: SleiMember[]): SleiMessage | null {
  return createChannelAgentActivityMessages(outcome, channelId, members)[0] ?? null;
}

export function createChannelAgentActivityMessages(outcome: SendChannelMessageOutcome, channelId: string, members: SleiMember[]): SleiMessage[] {
  if (outcome.action !== "request_agent_reply") return [];
  return channelReplyTargetIds(outcome).flatMap((agentId) => {
    const member = members.find((candidate) => candidate.id === agentId);
    if (isInternalCoordinatorMember(member ?? { id: agentId })) return [];
    if (member?.directMessageEnabled === false) return [];
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
  });
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

function logAppEvent(bridge: DaemonBridge, scope: string, message: string, context?: Record<string, unknown>) {
  void bridge.logFrontendEvent({ scope, message, context }).catch((error: unknown) => {
    console.info("[slei-frontend]", scope, message, context ?? {}, error);
  });
}

function formatLogError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function loadSleiConversationMessages(
  bridge: DaemonBridge,
  conversations: ConversationView[],
  members: SleiMember[],
  profile: UserProfile,
) {
  const receipts = await Promise.all(conversations.map((conversation) => bridge.listConversationMessages(conversation.id)));
  return receipts.flatMap((receipt) => receipt.messages.map((message) => conversationMessageToSleiMessage(message, members, profile)));
}

async function loadSleiChannelMessages(
  bridge: DaemonBridge,
  channels: ChannelView[],
  members: SleiMember[],
  profile: UserProfile,
  messages: DesktopMessages,
) {
  const receipts = await Promise.all(
    channels.map((channel) => bridge.listChannelMessages(channel.id).catch(() => ({ messages: [] }))),
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

export function SleiApp() {
  const location = useLocation();
  const navigate = useNavigate();
  const [activeView, setActiveView] = useState<AppView>(() => routeViewFromPath(location.pathname));
  const [data, setData] = useState(createSleiFixtures());
  const [activeChannelId, setActiveChannelId] = useState("all");
  const [activeConversationId, setActiveConversationId] = useState<string | undefined>(undefined);
  const [activeSessionId, setActiveSessionId] = useState<string | undefined>(undefined);
  const [activeMemberId, setActiveMemberId] = useState<string | undefined>(undefined);
  const [savedMessages, setSavedMessages] = useState<SavedMessageView[]>([]);
  const [focusedMessageId, setFocusedMessageId] = useState<string | undefined>(undefined);
  const [sessionDrawerOpen, setSessionDrawerOpen] = useState(false);
  const [sendingConversationIds, setSendingConversationIds] = useState<string[]>([]);
  const [profile, setProfile] = useState<UserProfile>(defaultProfile);
  const [locale, setLocale] = useState<AppLocale>("zh-CN");
  const [timeZone, setTimeZone] = useState(defaultTimeZone);
  const [appearance, setAppearance] = useState<AppearancePreferences>(defaultAppearance);
  const [notifications, setNotifications] = useState<NotificationPreferences>(defaultNotifications);
  const [sidebarWidth, setSidebarWidth] = useState(240);
  const [guideBootstrapping, setGuideBootstrapping] = useState(false);
  const [appToast, setAppToast] = useState<{ message: string; type: ToastType }>({ message: "", type: "info" });
  const [runtimeSetup, setRuntimeSetup] = useState<RuntimeSetupState>({
    loading: true,
    error: undefined,
    hasClaudeRuntimeReady: true,
    nodes: data.nodes,
  });
  const appToastTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const bridge = useMemo(() => createDaemonBridge(), []);
  const messages = createDesktopMessages(locale);

  async function refreshTasks(channelId?: string) {
    const receipt = await bridge.listTasks(channelId ? { channelId } : {});
    setData((current) =>
      createSleiFixtures({
        ...current,
        tasks: mergeTaskSummariesIntoTasks(current.tasks, receipt.tasks, current.members, channelId),
      }),
    );
  }

  async function refreshChannelMessagesIntoState(channelId: string, members: SleiMember[] = data.members) {
    const receipt = await bridge.listChannelMessages(channelId);
    const channelMessages = receipt.messages
      .map((message) => channelMessageToSleiMessage(message, members, profile, messages))
      .filter((message): message is SleiMessage => Boolean(message));
    setData((current) =>
      createSleiFixtures({
        ...current,
        messages: replaceChannelMessages(current.messages, channelMessages, [channelId]),
      }),
    );
  }

  async function refreshChannelMembersIntoState(channelId: string): Promise<SleiMember[]> {
    const receipt = await bridge.listChannelMembers(channelId);
    let nextMembers: SleiMember[] = data.members;
    setData((current) => {
      nextMembers = applyChannelMemberReadiness(current.members, channelId, receipt.members);
      return createSleiFixtures({ ...current, members: nextMembers });
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
      return createSleiFixtures({ ...current, tasks });
    });
  }

  function appendTaskReplyReceiptToState(taskId: string, reply: TaskThreadMessageView) {
    setData((current) =>
      createSleiFixtures({
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

  async function refreshTaskThreadIntoState(taskId: string) {
    const receipt = await bridge.getTaskThread(taskId);
    applyTaskThreadReceiptToState(receipt);
  }

  function showAppToast(message: string, type: ToastType = "info") {
    if (appToastTimerRef.current) clearTimeout(appToastTimerRef.current);
    setAppToast({ message, type });
    appToastTimerRef.current = setTimeout(() => setAppToast((current) => ({ ...current, message: "" })), 4_000);
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
    return () => {
      if (appToastTimerRef.current) clearTimeout(appToastTimerRef.current);
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    bridge
      .listTasks(activeChannelId ? { channelId: activeChannelId } : {})
      .then((receipt) => {
        if (!mounted) return;
        setData((current) =>
          createSleiFixtures({
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
      const [next, preferencesReceipt, savedReceipt] = await Promise.all([refreshRuntime(bridge), bridge.listPreferences(), bridge.listSavedMessages()]);
      if (!mounted) return;
      setRuntimeSetup(next);
      setLocale(preferencesReceipt.preferences.locale);
      setTimeZone(preferencesReceipt.preferences.timeZone);
      setAppearance(normalizeAppearance(preferencesReceipt.preferences.appearance));
      setNotifications(preferencesReceipt.preferences.notifications);
      setSavedMessages(savedReceipt.savedMessages);
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
      const conversationMessages = await loadSleiConversationMessages(bridge, conversationReceipt.conversations, members, profile);
      const channelMessages = await loadSleiChannelMessages(bridge, channelReceipt.channels, members, profile, messages);
      const taskReceipt = await bridge.listTasks(activeChannelId ? { channelId: activeChannelId } : {}).catch(() => ({ tasks: [] }));
      if (!mounted) return;
      setData((current) =>
        createSleiFixtures({
          ...current,
          nodes: next.nodes,
          channels: channelReceipt.channels.map((channel) => channelFromView(channel, messagesForLocale)),
          conversations: conversationReceipt.conversations,
          conversationSessions,
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
          createSleiFixtures({
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
      const receipt = await bridge.listConversationMessages(activeConversationId);
      const conversationMessages = receipt.messages.map((message) => conversationMessageToSleiMessage(message, data.members, profile));
      setData((current) =>
        createSleiFixtures({
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

  async function handleOpenAgentPath(agentId: string, target: AgentPathTarget) {
    await bridge.openAgentPath(agentId, target);
  }

  async function handleListAgentWorkspace(agentId: string, relativePath?: string): Promise<AgentWorkspaceListReceipt> {
    return bridge.listAgentWorkspace(agentId, relativePath);
  }

  async function handleReadAgentWorkspaceFile(agentId: string, relativePath: string): Promise<AgentWorkspaceFileReceipt> {
    return bridge.readAgentWorkspaceFile(agentId, relativePath);
  }

  async function handleRenameLocalNode(name: string) {
    const receipt = await bridge.renameLocalNode(name);
    const nextNodes = data.nodes.map((node) => (node.id === receipt.node.id ? receipt.node : node));
    setData((current) => createSleiFixtures({ ...current, nodes: nextNodes }));
    setRuntimeSetup((current) => ({
      ...current,
      nodes: nextNodes,
      hasClaudeRuntimeReady: hasReadyClaudeRuntime(nextNodes),
    }));
  }

  async function handleRefreshRuntime() {
    setRuntimeSetup((current) => ({ ...current, loading: true, error: undefined }));
    const [next, preferencesReceipt, savedReceipt] = await Promise.all([refreshRuntime(bridge), bridge.listPreferences(), bridge.listSavedMessages()]);
    if (hasReadyClaudeRuntime(next.nodes)) {
      setGuideBootstrapping(true);
      await bridge.bootstrapGuideAgent();
      setGuideBootstrapping(false);
    }
    const [agentReceipt, conversationReceipt, channelReceipt] = await Promise.all([bridge.listAgents(), bridge.listConversations(), bridge.listChannels()]);
    setRuntimeSetup(next);
    setLocale(preferencesReceipt.preferences.locale);
    setTimeZone(preferencesReceipt.preferences.timeZone);
    setAppearance(normalizeAppearance(preferencesReceipt.preferences.appearance));
    setNotifications(preferencesReceipt.preferences.notifications);
    setSavedMessages(savedReceipt.savedMessages);
    const messagesForLocale = createDesktopMessages(preferencesReceipt.preferences.locale);
    let members = await loadGuideSkillsForMembers(
      bridge,
      mergeAgentViewsIntoMembers([], agentReceipt.agents, next.nodes, messagesForLocale),
    );
    members = await loadSleiChannelMemberReadiness(bridge, channelReceipt.channels, members);
    const conversationSessions = await loadSleiConversationSessions(bridge, conversationReceipt.conversations);
    const conversationMessages = await loadSleiConversationMessages(bridge, conversationReceipt.conversations, members, profile);
    const channelMessages = await loadSleiChannelMessages(bridge, channelReceipt.channels, members, profile, messages);
    const taskReceipt = await bridge.listTasks(activeChannelId ? { channelId: activeChannelId } : {}).catch(() => ({ tasks: [] }));
    setData((current) =>
      createSleiFixtures({
        ...current,
        nodes: next.nodes,
        channels: channelReceipt.channels.map((channel) => channelFromView(channel, messagesForLocale)),
        conversations: conversationReceipt.conversations,
        conversationSessions,
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
    setData((current) => createSleiFixtures({ ...current, members }));
    setActiveMemberId(receipt.agent.id);
    showAppToast(messages.agentCreate.createdSuccess, "success");
  }

  async function refreshChannelsAfterCreate(channelId: string) {
    const receipt = await bridge.listChannels();
    const channels = receipt.channels.map((channel) => channelFromView(channel, messages));
    setData((current) => createSleiFixtures({ ...current, channels }));
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
      createSleiFixtures({
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
    const message = conversationMessageToSleiMessage(receipt.message, data.members, profile);
    setData((current) =>
      createSleiFixtures({
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
      createSleiFixtures({
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
      return createSleiFixtures({
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
    setData((current) => createSleiFixtures({ ...current, nodes: [...current.nodes, node] }));
    setRuntimeSetup((current) => {
      const nextNodes = [...current.nodes, node];
      return {
        ...current,
        nodes: nextNodes,
        hasClaudeRuntimeReady: hasReadyClaudeRuntime(nextNodes),
      };
    });
  }

  function handleRenameComputer(nodeId: string, name: string) {
    setData((current) => createSleiFixtures({ ...current, nodes: renameComputerNode(current.nodes, nodeId, name) }));
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
    setData((current) => createSleiFixtures({ ...current, nodes: deleteComputerNode(current.nodes, nodeId) }));
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
    const messagesReceipt = await bridge.listConversationMessages(receipt.conversation.id);
    const conversationMessages = messagesReceipt.messages.map((message) => conversationMessageToSleiMessage(message, data.members, profile));
    setData((current) =>
      createSleiFixtures({
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
      createSleiFixtures({
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
    const messagesReceipt = await bridge.listConversationMessages(conversationId);
    const conversationMessages = messagesReceipt.messages.map((message) => conversationMessageToSleiMessage(message, data.members, profile));
    setData((current) =>
      createSleiFixtures({
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

  async function runChannelAgentReply(outcome: SendChannelMessageOutcome, channelMessage: SleiMessage, channelId: string, agentId: string) {
    const sourceChannel = data.channels.find((candidate) => candidate.id === channelId);
    const workspaceMounts: WorkspaceMountView[] = (sourceChannel?.projectPaths ?? []).map((path) => ({
      path,
      label: workspaceLabelFromPath(path),
    }));
    const coTargets = channelReplyTargetIds(outcome)
      .map((targetId) => data.members.find((candidate) => candidate.id === targetId))
      .filter((member): member is SleiMember => Boolean(member));
    logAppEvent(bridge, "channel-agent-reply", "evaluate", {
      channelId,
      messageId: outcome.messageId,
      action: outcome.action,
      assigneeAgentId: agentId,
      assigneeAgentIds: channelReplyTargetIds(outcome),
      workspaceMountCount: workspaceMounts.length,
    });
    const member = data.members.find((candidate) => candidate.id === agentId);
    if (!agentId || isInternalCoordinatorMember(member ?? { id: agentId })) {
      logAppEvent(bridge, "channel-agent-reply", "skip-no-runnable-agent", {
        channelId,
        messageId: outcome.messageId,
        assigneeAgentId: agentId,
      });
      return;
    }
    if (member?.directMessageEnabled === false) {
      logAppEvent(bridge, "channel-agent-reply", "skip-direct-message-disabled", {
        channelId,
        messageId: outcome.messageId,
        assigneeAgentId: agentId,
        memberName: member.name,
      });
      return;
    }

    const activityId = channelAgentActivityId(outcome, agentId);
    try {
      logAppEvent(bridge, "channel-agent-reply", "create-dm-conversation-start", {
        channelId,
        messageId: outcome.messageId,
        assigneeAgentId: agentId,
      });
      const conversationReceipt = await bridge.createDmConversation(agentId);
      const beforeReceipt = await bridge.listConversationMessages(conversationReceipt.conversation.id);
      const existingMessageIds = new Set(beforeReceipt.messages.map((message) => message.id));
      logAppEvent(bridge, "channel-agent-reply", "send-runtime-message-start", {
        channelId,
        messageId: outcome.messageId,
        assigneeAgentId: agentId,
        conversationId: conversationReceipt.conversation.id,
        activeSessionId: conversationReceipt.conversation.activeSessionId,
        existingMessageCount: beforeReceipt.messages.length,
      });
      await bridge.sendConversationMessage(conversationReceipt.conversation.id, {
        authorId: "human:local",
        body: channelAgentReplyPrompt(channelId, channelMessage.body, member, coTargets),
        sessionId: conversationReceipt.conversation.activeSessionId,
        workspaceMounts,
        sourceChannelId: channelId,
        sourceChannelName: sourceChannel?.name,
      });
      const replies = await waitForChannelAgentReplies(bridge, conversationReceipt.conversation.id, agentId, existingMessageIds, {
        onProgress: (progress) => {
          const progressMessage = createChannelAgentReplyMessage(progress, outcome, channelId, member, activityId);
          setData((current) =>
            createSleiFixtures({
              ...current,
              messages: current.messages.map((message) => (message.id === activityId ? progressMessage : message)),
            }),
          );
        },
      });
      const reply = replies.at(-1);
      logAppEvent(bridge, "channel-agent-reply", replies.length > 0 ? "reply-received" : "reply-timeout", {
        channelId,
        messageId: outcome.messageId,
        assigneeAgentId: agentId,
        conversationId: conversationReceipt.conversation.id,
        replyCount: replies.length,
        replyId: reply?.id,
        replyStatus: reply?.status,
      });
      const replyMessage = replies.length > 0
        ? createChannelAgentReplyMessageFromReplies(replies, outcome, channelId, member, activityId)
        : {
            id: activityId,
            author: member?.name ?? agentId,
            handle: member?.handle,
            avatar: member?.avatar,
            role: "agent" as const,
            time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
            body: "智能体回复超时。",
            channelId,
            status: "failed" as const,
          };
      if (replies.length === 0 || replies.some((message) => message.status === "failed")) {
        showAppToast(`${messages.chat.agentRunFailed}: ${reply?.body || "智能体回复超时。"}`, "error");
      }
      setData((current) =>
        createSleiFixtures({
          ...current,
          messages: current.messages.map((message) => (message.id === activityId ? replyMessage : message)),
        }),
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logAppEvent(bridge, "channel-agent-reply", "failed", {
        channelId,
        messageId: outcome.messageId,
        assigneeAgentId: agentId,
        error: errorMessage,
      });
      const replyMessage: SleiMessage = {
        id: activityId,
        author: member?.name ?? agentId,
        handle: member?.handle,
        avatar: member?.avatar,
        role: "agent",
        time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        body: errorMessage,
        channelId,
        status: "failed",
      };
      showAppToast(`${messages.chat.agentRunFailed}: ${errorMessage}`, "error");
      setData((current) =>
        createSleiFixtures({
          ...current,
          messages: current.messages.map((message) => (message.id === activityId ? replyMessage : message)),
        }),
      );
    }
  }

  async function refreshTaskAgentWriteback(taskId: string, channelId: string, status: TaskStatusView) {
    try {
      await refreshTaskThreadIntoState(taskId);
    } catch (error) {
      logAppEvent(bridge, "task-agent-reply", "thread-refresh-failed-after-writeback", { channelId, taskId, error: formatLogError(error) });
    }
    try {
      await bridge.updateTaskStatus(taskId, { status });
    } catch (error) {
      logAppEvent(bridge, "task-agent-reply", "status-update-failed-after-writeback", { channelId, taskId, status, error: formatLogError(error) });
    }
    try {
      await refreshTasks(channelId);
    } catch (error) {
      logAppEvent(bridge, "task-agent-reply", "summary-refresh-failed-after-writeback", { channelId, taskId, error: formatLogError(error) });
    }
  }

  async function writeTaskAgentReply(input: TaskAgentReplyInput, body: string, status: TaskStatusView) {
    await bridge.replyToTask(input.taskId, {
      senderId: input.agentId,
      body,
    });
    await refreshTaskAgentWriteback(input.taskId, input.channelId, status);
  }

  async function runTaskAgentReply(input: TaskAgentReplyInput) {
    const sourceChannel = data.channels.find((candidate) => candidate.id === input.channelId);
    const workspaceMounts: WorkspaceMountView[] = (sourceChannel?.projectPaths ?? []).map((path) => ({
      path,
      label: workspaceLabelFromPath(path),
    }));
    const member = data.members.find((candidate) => candidate.id === input.agentId);
    logAppEvent(bridge, "task-agent-reply", "evaluate", {
      channelId: input.channelId,
      taskId: input.taskId,
      assigneeAgentId: input.agentId,
      workspaceMountCount: workspaceMounts.length,
    });
    if (!input.agentId || isInternalCoordinatorMember(member ?? { id: input.agentId }) || member?.directMessageEnabled === false) {
      logAppEvent(bridge, "task-agent-reply", "skip-no-runnable-agent", {
        channelId: input.channelId,
        taskId: input.taskId,
        assigneeAgentId: input.agentId,
        memberName: member?.name,
      });
      try {
        await writeTaskAgentReply(input, "无法启动任务智能体回复。", "in_progress");
      } catch (writeError) {
        logAppEvent(bridge, "task-agent-reply", "writeback-failed-after-skip", {
          channelId: input.channelId,
          taskId: input.taskId,
          assigneeAgentId: input.agentId,
          error: formatLogError(writeError),
        });
      }
      return;
    }

    try {
      logAppEvent(bridge, "task-agent-reply", "create-dm-conversation-start", {
        channelId: input.channelId,
        taskId: input.taskId,
        assigneeAgentId: input.agentId,
      });
      const conversationReceipt = await bridge.createDmConversation(input.agentId);
      const beforeReceipt = await bridge.listConversationMessages(conversationReceipt.conversation.id);
      const existingMessageIds = new Set(beforeReceipt.messages.map((message) => message.id));
      logAppEvent(bridge, "task-agent-reply", "send-runtime-message-start", {
        channelId: input.channelId,
        taskId: input.taskId,
        assigneeAgentId: input.agentId,
        conversationId: conversationReceipt.conversation.id,
        activeSessionId: conversationReceipt.conversation.activeSessionId,
        existingMessageCount: beforeReceipt.messages.length,
      });
      await bridge.sendConversationMessage(conversationReceipt.conversation.id, {
        authorId: "human:local",
        body: taskAgentReplyPrompt(input),
        sessionId: conversationReceipt.conversation.activeSessionId,
        workspaceMounts,
        sourceChannelId: input.channelId,
        sourceChannelName: sourceChannel?.name,
      });
      const replies = await waitForChannelAgentReplies(bridge, conversationReceipt.conversation.id, input.agentId, existingMessageIds);
      const combinedBody = replies.map((message) => message.body).filter(Boolean).join("\n\n").trim();
      const empty = replies.length > 0 && !combinedBody;
      const failed = replies.length === 0 || empty || replies.some((message) => message.status === "failed");
      const body = replies.length > 0 ? combinedBody || "智能体回复为空。" : "智能体回复超时。";
      logAppEvent(bridge, "task-agent-reply", replies.length > 0 ? "reply-received" : "reply-timeout", {
        channelId: input.channelId,
        taskId: input.taskId,
        assigneeAgentId: input.agentId,
        conversationId: conversationReceipt.conversation.id,
        replyCount: replies.length,
        replyStatus: replies.at(-1)?.status,
      });
      if (failed) {
        showAppToast(`${messages.chat.agentRunFailed}: ${body}`);
      }
      await writeTaskAgentReply(input, body, failed ? "in_progress" : "in_review");
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logAppEvent(bridge, "task-agent-reply", "failed", {
        channelId: input.channelId,
        taskId: input.taskId,
        assigneeAgentId: input.agentId,
        error: errorMessage,
      });
      showAppToast(`${messages.chat.agentRunFailed}: ${errorMessage}`);
      try {
        await writeTaskAgentReply(input, `智能体回复失败：${errorMessage}`, "in_progress");
      } catch (writeError) {
        logAppEvent(bridge, "task-agent-reply", "writeback-failed-after-run-failure", {
          channelId: input.channelId,
          taskId: input.taskId,
          assigneeAgentId: input.agentId,
          error: formatLogError(writeError),
        });
      }
    }
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
          profile,
        });
        if (result.kind !== "conversation") return;
        const receipt = result.receipt;
        const conversationMessage = conversationMessageToSleiMessage(receipt.message, data.members, profile);
        if (memoryRequest) {
          void bridge.rememberAgentFact(memoryRequest.agentId, memoryRequest.fact);
          const agent = data.members.find((member) => member.id === memoryRequest.agentId);
          const systemMessage: SleiMessage = {
            id: `memory-${Date.now()}`,
            author: messages.common.system,
            role: "system",
            time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
            body: messages.chat.memoryUpdated(agent?.handle ?? messages.agentCreate.fallbackAgent),
            channelId: targetId,
            sessionId: options?.sessionId ?? activeSessionId,
            status: "done",
            toolCall: "remember_agent_fact",
          };
          setData((current) => createSleiFixtures({ ...current, messages: [...current.messages, conversationMessage, systemMessage] }));
          return;
        }
        setData((current) => {
          const nextTasks = options?.asTask ? [...current.tasks, createTaskFromChatMessage(conversationMessage, targetId)] : current.tasks;
          return createSleiFixtures({ ...current, messages: [...current.messages, conversationMessage], tasks: nextTasks });
        });
        const messagesReceipt = await bridge.listConversationMessages(activeConversationId);
        const conversationMessages = messagesReceipt.messages.map((message) => conversationMessageToSleiMessage(message, data.members, profile));
        setData((current) =>
          createSleiFixtures({
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
      const systemMessage: SleiMessage = {
        id: `memory-${channelMessage.id}`,
        author: messages.common.system,
        role: "system",
        time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        body: messages.chat.memoryUpdated(agent?.handle ?? messages.agentCreate.fallbackAgent),
        channelId: targetId,
        status: "done",
        toolCall: "remember_agent_fact",
      };
      setData((current) => createSleiFixtures({ ...current, messages: [...current.messages, channelMessage, systemMessage] }));
      return;
    }

    let fallbackTask: SleiTask | null = null;
    if (result.receipt.outcome.taskId) {
      try {
        await refreshTasks(targetId);
      } catch {
        fallbackTask = createChannelTaskPlaceholder(result.receipt.outcome, channelMessage, data.members);
      }
    }

    setData((current) => {
      const nextTasks = fallbackTask && !current.tasks.some((candidate) => candidate.id === fallbackTask.id) ? [...current.tasks, fallbackTask] : current.tasks;
      const archiveNotice = createChannelArchiveNoticeMessage(result.receipt.outcome, targetId, messages);
      const agentActivities = result.receipt.outcome.taskId ? [] : createChannelAgentActivityMessages(result.receipt.outcome, targetId, current.members);
      const nextMessages = [channelMessage, archiveNotice, ...agentActivities].filter((message): message is SleiMessage => Boolean(message));
      return createSleiFixtures({ ...current, messages: [...current.messages, ...nextMessages], tasks: nextTasks });
    });
    if (result.receipt.outcome.taskId && result.receipt.outcome.assigneeAgentId) {
      void runTaskAgentReply({
        agentId: result.receipt.outcome.assigneeAgentId,
        channelId: targetId,
        sourceBody: channelMessage.body,
        taskId: result.receipt.outcome.taskId,
      });
    } else if (result.receipt.outcome.action === "request_agent_reply") {
      for (const agentId of channelReplyTargetIds(result.receipt.outcome)) {
        void runChannelAgentReply(result.receipt.outcome, channelMessage, targetId, agentId);
      }
    } else {
      logAppEvent(bridge, "channel-agent-reply", "not-started-for-action", {
        channelId: targetId,
        messageId: result.receipt.outcome.messageId,
        action: result.receipt.outcome.action,
      });
    }
  }

  async function handleTaskReply(taskId: string, body: string) {
    const trimmed = body.trim();
    if (!trimmed) return;
    const task = data.tasks.find((candidate) => candidate.id === taskId);
    const channelId = task?.channelId ?? activeChannelId ?? "all";
    const fallbackSourceBody = task?.replies?.[0]?.body ?? task?.title ?? trimmed;
    const receipt = await bridge.replyToTask(taskId, { senderId: "human:local", body: trimmed });
    let sourceBody = fallbackSourceBody;
    try {
      const threadReceipt = await bridge.getTaskThread(taskId);
      sourceBody = threadReceipt.thread.root.body || fallbackSourceBody;
      applyTaskThreadReceiptToState(threadReceipt);
    } catch (error) {
      appendTaskReplyReceiptToState(taskId, receipt.reply);
      logAppEvent(bridge, "task-refresh", "task-agent-handoff-root-fallback", { channelId, taskId, error: formatLogError(error) });
    }
    void refreshTasks(channelId).catch((error: unknown) => {
      logAppEvent(bridge, "task-refresh", "summary-refresh-failed-after-reply", { channelId, taskId, error: formatLogError(error) });
    });
    for (const agentId of receipt.route.handoffAgentIds) {
      void runTaskAgentReply({ agentId, channelId, sourceBody, taskId, triggerBody: trimmed });
    }
  }

  async function handleTaskStatusChange(taskId: string, status: TaskStatusView) {
    const receipt = await bridge.updateTaskStatus(taskId, { status });
    setData((current) =>
      createSleiFixtures({
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
    const channel = { ...channelFromView(receipt.channel, messages), projectName, projectPaths };
    setData((current) => {
      if (current.channels.some((candidate) => candidate.id === channel.id || candidate.name === channel.name)) return current;
      return createSleiFixtures({ ...current, channels: [...current.channels, channel] });
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
    await bridge.addChannelMember(activeChannelId, { agentId });
    const members = await refreshChannelMembersIntoState(activeChannelId);
    await refreshChannelMessagesIntoState(activeChannelId, members);
    refreshChannelMembersInBackground(activeChannelId, members);
  }

  async function handleRemoveChannelMember(agentId: string) {
    await bridge.removeChannelMember(activeChannelId, agentId);
    const members = await refreshChannelMembersIntoState(activeChannelId);
    await refreshChannelMessagesIntoState(activeChannelId, members);
  }

  function handleDeleteChannel(channelId: string) {
    if (channelId === "all") return;
    setData((current) =>
      createSleiFixtures({
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
  }

  function handleSearchResultSelect(channelId: string) {
    setActiveChannelId(channelId);
    setActiveConversationId(undefined);
    setActiveSessionId(undefined);
    navigateToView("chat");
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

  function handleSavedMessageSelect(savedMessage: SavedMessageView) {
    if (savedMessage.sourceKind === "dm" || savedMessage.sourceId.startsWith("dm:")) {
      const conversation = data.conversations.find((candidate) => candidate.id === savedMessage.sourceId);
      setActiveConversationId(savedMessage.sourceId);
      setActiveSessionId(savedMessage.sessionId ?? conversation?.activeSessionId);
      setActiveChannelId("all");
    } else {
      setActiveChannelId(savedMessage.sourceId);
      setActiveConversationId(undefined);
      setActiveSessionId(undefined);
    }
    setSessionDrawerOpen(false);
    setFocusedMessageId(undefined);
    window.setTimeout(() => setFocusedMessageId(savedMessage.messageId), 0);
    navigateToView("chat");
  }

  async function handleLocaleChange(nextLocale: AppLocale) {
    setLocale(nextLocale);
    const receipt = await bridge.updatePreferences({ locale: nextLocale });
    setLocale(receipt.preferences.locale);
    setTimeZone(receipt.preferences.timeZone);
    setAppearance(normalizeAppearance(receipt.preferences.appearance));
    setNotifications(receipt.preferences.notifications);
  }

  async function handleTimeZoneChange(nextTimeZone: string) {
    setTimeZone(nextTimeZone);
    const receipt = await bridge.updatePreferences({ timeZone: nextTimeZone });
    setLocale(receipt.preferences.locale);
    setTimeZone(receipt.preferences.timeZone);
    setAppearance(normalizeAppearance(receipt.preferences.appearance));
    setNotifications(receipt.preferences.notifications);
  }

  async function handleAppearanceChange(nextAppearance: AppearancePreferences) {
    const normalizedAppearance = normalizeAppearance(nextAppearance);
    setAppearance(normalizedAppearance);
    const receipt = await bridge.updatePreferences({ appearance: normalizedAppearance });
    setLocale(receipt.preferences.locale);
    setTimeZone(receipt.preferences.timeZone);
    setAppearance(normalizeAppearance(receipt.preferences.appearance));
    setNotifications(receipt.preferences.notifications);
  }

  async function handleNotificationsChange(nextNotifications: NotificationPreferences) {
    setNotifications(nextNotifications);
    const receipt = await bridge.updatePreferences({ notifications: nextNotifications });
    setLocale(receipt.preferences.locale);
    setTimeZone(receipt.preferences.timeZone);
    setAppearance(normalizeAppearance(receipt.preferences.appearance));
    setNotifications(receipt.preferences.notifications);
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
    const route = routePathForView(view);
    if (location.pathname === route) return;
    navigate(route, { replace: options.replace });
  }

  return (
    <SleiAppFrame
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
      onInteractiveCardComplete={handleInteractiveCardComplete}
      onPermissionResolve={handlePermissionResolve}
      onChannelSelect={(channelId) => {
        setActiveChannelId(channelId);
        setActiveConversationId(undefined);
        setActiveSessionId(undefined);
      }}
      onComputerCreate={handleCreateComputer}
      onComputerDelete={handleDeleteComputer}
      onComputerRename={handleRenameComputer}
      onProfileChange={setProfile}
      onLocaleChange={handleLocaleChange}
      onTimeZoneChange={handleTimeZoneChange}
      onAppearanceChange={handleAppearanceChange}
      onNotificationsChange={handleNotificationsChange}
      onRefreshRuntime={handleRefreshRuntime}
      onRenameLocalNode={handleRenameLocalNode}
      onResizeStart={handleResizeStart}
      onSearchResultSelect={handleSearchResultSelect}
      onSearchToggle={() => navigateToView("search")}
      onSavedMessageSelect={handleSavedMessageSelect}
      onMessageSaveToggle={handleMessageSaveToggle}
      onSendMessage={handleSendMessage}
      onAttachmentUpload={handleUploadConversationAttachment}
      onTaskReply={handleTaskReply}
      onTaskStatusChange={handleTaskStatusChange}
      onTaskThreadOpen={refreshTaskThreadIntoState}
      onViewChange={navigateToView}
      onMemberSelect={setActiveMemberId}
      onMemberMessage={handleMessageMember}
      onOpenAgentPath={handleOpenAgentPath}
      onListAgentWorkspace={handleListAgentWorkspace}
      onReadAgentWorkspaceFile={handleReadAgentWorkspaceFile}
      onConversationNewSession={handleCreateConversationSession}
      onConversationHistoryToggle={() => setSessionDrawerOpen((current) => !current)}
      onConversationSelect={(conversationId) => {
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

function hasReadyClaudeRuntime(nodes: DesktopNodeView[]) {
  return nodes.some((node) =>
    node.runtimes.some((runtime) => runtime.kind === "ClaudeCode" && runtime.readiness === "ready"),
  );
}

export {
  AGENT_ACTIVITY_ROTATION_MS,
  channelDraftCreateInput,
  findActiveAgentActivities,
  resetChannelDraft,
  selectAgentActivityForTick,
  SleiAppFrame,
  submitChannelDraftWithFeedback,
  toggleChannelDraftAgent,
} from "./SleiAppFrame";
