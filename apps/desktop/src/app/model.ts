import type { AppLocale, AppearancePreferences, ConversationAttachmentView, DaemonBridge, DesktopNodeView, NotificationPreferences, SkillView } from "../lib/daemon-bridge";
import { createDesktopMessages, type DesktopMessages } from "../i18n";
import type { SleiChannelMemberReadiness, SleiMember, SleiMessage, SleiTask } from "./types";

export type AppView = "chat" | "search" | "tasks" | "members" | "computers" | "settings";

export type UserProfile = {
  displayName: string;
  handle: string;
  avatar: string;
};

export type ChatSearchFilters = {
  query?: string;
  user?: string;
  channel?: string;
  time?: string;
};

export type ActiveMention = {
  query: string;
  start: number;
  end: number;
};

export type ActiveSkillSlashQuery = {
  query: string;
  start: number;
  end: number;
};

export type AgentDraftInput = {
  name: string;
  handle: string;
  runtimeKind: string;
  model: string;
  nodeId: string;
  description: string;
  avatarSeed?: string;
};

export type AgentDisplayNameValidation = "required" | "format" | "duplicate";

export function agentHandleFromName(name: string): string {
  return `@${name.trim()}`;
}

export function validateAgentDisplayName(
  name: string,
  members: Array<{ name: string }>,
): AgentDisplayNameValidation | null {
  const trimmed = name.trim();
  if (!trimmed) return "required";
  if (/\s/.test(trimmed) || trimmed.includes("-")) return "format";
  if (members.some((member) => member.name.trim() === trimmed)) return "duplicate";
  return null;
}

export function agentAvatarSeedFromName(name: string): string {
  const trimmed = name.trim();
  return trimmed ? `agent-avatar-${trimmed}` : "agent-avatar-new";
}

export function refreshedAgentAvatarSeed(name: string, refreshIndex: number): string {
  return `${agentAvatarSeedFromName(name)}-${refreshIndex}`;
}

export type AgentMemoryRequest = {
  agentId: string;
  fact: string;
};

export type EmptyVariant = "nodata" | "noresult";
export type EmptySize = "sm" | "md" | "lg";
export type SettingsPanel = "account" | "language-region" | "appearance" | "notifications" | "about";

export const defaultProfile: UserProfile = {
  displayName: "Lei",
  handle: "@lei",
  avatar: "LL",
};

export function localHumanPresentation(profile: UserProfile | null, messages: DesktopMessages): UserProfile {
  return profile ?? {
    displayName: messages.common.you,
    handle: "local",
    avatar: messages.common.you.slice(0, 2),
  };
}

export const defaultNotifications: NotificationPreferences = {
  mentions: true,
  humanReplies: true,
  approvals: true,
};

export type SleiTheme = "light" | "dark";

export function normalizeAppearanceTheme(theme: AppearancePreferences["theme"] | undefined): SleiTheme {
  return theme === "dark" ? "dark" : "light";
}

export function normalizeAppearance(appearance: AppearancePreferences): AppearancePreferences {
  return {
    ...appearance,
    theme: normalizeAppearanceTheme(appearance.theme),
  };
}

export const defaultAppearance: AppearancePreferences = {
  theme: "dark",
  fontSize: "md",
};

export function localeFromSystemLanguages(languages: readonly string[]): AppLocale {
  for (const language of languages) {
    const normalized = language.trim().toLowerCase();
    if (normalized.startsWith("zh")) {
      return "zh-CN";
    }
    if (normalized.startsWith("en")) {
      return "en-US";
    }
  }
  return "zh-CN";
}

export function timeZoneFromSystemValue(timeZone: string | undefined): string {
  const normalized = timeZone?.trim();
  return normalized && normalized.includes("/") ? normalized : "Asia/Shanghai";
}

export function systemDefaultLocale(): AppLocale {
  const languages = typeof navigator === "undefined"
    ? []
    : [navigator.language, ...Array.from(navigator.languages ?? [])];
  return localeFromSystemLanguages(languages);
}

export function systemDefaultTimeZone(): string {
  const timeZone = typeof Intl === "undefined" ? undefined : Intl.DateTimeFormat().resolvedOptions().timeZone;
  return timeZoneFromSystemValue(timeZone);
}

export const defaultLocale = systemDefaultLocale();
export const defaultTimeZone = systemDefaultTimeZone();
export const desktopVersion = "0.1.0";

export const profileAvatarPresets = [
  { id: "pixel-sun", labelKey: "pixelSun", name: "Pixel Sun" },
  { id: "pixel-moon", labelKey: "pixelMoon", name: "Pixel Moon" },
  { id: "pixel-cube", labelKey: "pixelCube", name: "Pixel Cube" },
  { id: "pixel-spark", labelKey: "pixelSpark", name: "Pixel Spark" },
];

export async function submitComposerDraft(input: {
  draft: string;
  asTask: boolean;
  attachments: ConversationAttachmentView[];
  sessionId?: string;
  onSendMessage?: (body: string, options?: { asTask?: boolean; attachmentIds?: string[]; sessionId?: string }) => Promise<void> | void;
}) {
  if (!input.draft.trim() && input.attachments.length === 0) {
    return {
      sent: false,
      draft: input.draft,
      attachments: input.attachments,
      asTask: input.asTask,
    };
  }

  await input.onSendMessage?.(input.draft, {
    asTask: input.asTask,
    attachmentIds: input.attachments.map((attachment) => attachment.id),
    sessionId: input.sessionId,
  });
  return { sent: true, draft: "", attachments: [], asTask: false };
}

export async function submitComposerDraftWithFeedback(input: {
  draft: string;
  asTask: boolean;
  attachments: ConversationAttachmentView[];
  sessionId?: string;
  sendFailedMessage: string;
  onSendFailure?: (message: string) => void;
  onSendMessage?: (body: string, options?: { asTask?: boolean; attachmentIds?: string[]; sessionId?: string }) => Promise<void> | void;
}) {
  try {
    return await submitComposerDraft(input);
  } catch (error) {
    input.onSendFailure?.(formatComposerSendFailure(input.sendFailedMessage, error));
    return {
      sent: false,
      draft: input.draft,
      attachments: input.attachments,
      asTask: input.asTask,
    };
  }
}

export function formatComposerSendFailure(prefix: string, error: unknown) {
  const detail = error instanceof Error
    ? error.message
    : typeof error === "string"
      ? error
      : "";
  const trimmedDetail = detail.trim();
  return trimmedDetail ? `${prefix}：${trimmedDetail}` : prefix;
}

export async function sendChatComposerMessage(input: {
  activeChannelId: string;
  activeConversationId?: string;
  activeSessionId?: string;
  attachmentIds?: string[];
  asTask?: boolean;
  body: string;
  bridge: Pick<DaemonBridge, "sendChannelMessage" | "sendConversationMessage">;
  profile: UserProfile | null;
  messages?: DesktopMessages;
}) {
  const body = input.body.trim();
  if (input.activeConversationId) {
    return {
      kind: "conversation" as const,
      receipt: await input.bridge.sendConversationMessage(input.activeConversationId, {
        authorId: "human:local",
        asTask: Boolean(input.asTask),
        body,
        sessionId: input.activeSessionId,
        attachmentIds: input.attachmentIds,
      }),
    };
  }

  const profile = localHumanPresentation(input.profile, input.messages ?? createDesktopMessages("zh-CN"));
  const handle = profile.handle.replace(/^@/, "").trim() || "local";
  return {
    kind: "channel" as const,
    receipt: await input.bridge.sendChannelMessage(input.activeChannelId, {
      authorId: `human:${handle}`,
      asTask: Boolean(input.asTask),
      body,
    }),
  };
}

export function mergeMessagePage(
  current: SleiMessage[],
  incoming: SleiMessage[],
  mode: "replace" | "prepend" | "append",
  sourceIds: string[],
): SleiMessage[] {
  const sourceIdSet = new Set(sourceIds);
  const belongsToSource = (message: SleiMessage) => sourceIdSet.has(message.channelId ?? "");
  const dedupe = (messages: SleiMessage[]) => {
    const seen = new Set<string>();
    return messages.filter((message) => {
      if (seen.has(message.id)) return false;
      seen.add(message.id);
      return true;
    });
  };

  if (mode === "replace") {
    return dedupe([...current.filter((message) => !belongsToSource(message)), ...incoming]);
  }

  const existingForOtherSources = current.filter((message) => !belongsToSource(message));
  const existingForSources = current.filter((message) => belongsToSource(message));
  if (mode === "prepend") {
    return dedupe([...existingForOtherSources, ...incoming, ...existingForSources]);
  }
  return dedupe([...existingForOtherSources, ...existingForSources, ...incoming]);
}

export function createLocalChatMessage(input: {
  body: string;
  messages?: DesktopMessages;
  profile: UserProfile | null;
  channelId?: string;
  sessionId?: string;
}): (SleiMessage & { handle: string; avatar: string }) | null {
  const body = input.body.trim();
  if (!body) {
    return null;
  }
  const now = new Date();
  const messages = input.messages ?? createDesktopMessages("zh-CN");
  const profile = localHumanPresentation(input.profile, messages);

  return {
    id: `local-${now.getTime()}`,
    author: profile.displayName.trim() || profile.handle || messages.common.you,
    handle: profile.handle.startsWith("@") ? profile.handle : `@${profile.handle}`,
    avatar: profile.avatar.trim() || profile.displayName.slice(0, 2),
    role: "human",
    time: formatMessageTime(now.toISOString()),
    sentAt: formatMessageDateTime(now.toISOString()),
    body,
    channelId: input.channelId,
    sessionId: input.sessionId,
  };
}

export type ComposerShortcutAction = "none" | "selectMention" | "submit";

export function isComposerImeComposing(input: {
  composing?: boolean;
  nativeEvent?: { isComposing?: boolean; keyCode?: number; which?: number };
}): boolean {
  return Boolean(
    input.composing ||
      input.nativeEvent?.isComposing ||
      input.nativeEvent?.keyCode === 229 ||
      input.nativeEvent?.which === 229,
  );
}

export function composerShortcutAction(input: {
  composing?: boolean;
  hasMentionTargets?: boolean;
  key: string;
  shiftKey?: boolean;
}): ComposerShortcutAction {
  if (input.composing) return "none";
  if (input.key === "Enter" && input.shiftKey) return "none";
  if (input.hasMentionTargets && (input.key === "Enter" || input.key === "Tab")) return "selectMention";
  if (input.key === "Enter" && !input.shiftKey) return "submit";
  return "none";
}

export function createTaskFromChatMessage(message: SleiMessage, channelId: string): SleiTask {
  const title = message.body.trim().split(/\n+/)[0]?.slice(0, 80) || "Untitled task";
  return {
    id: `task-${message.id}`,
    title,
    owner: message.author,
    creatorId: "human:local",
    status: "pending_assignment",
    attentionRequired: true,
    channelId,
    sourceMessageId: message.id,
    replyCount: 0,
    replies: [{ id: `root-${message.id}`, sender: message.author, role: message.role, body: message.body }],
  };
}

export function parseTaskCardBody(body: string): { taskId: string; sourceMessageId?: string } | null {
  const match = /^task_card:([^:]+)(?::source:(.+))?$/.exec(body.trim());
  if (!match) return null;
  return { taskId: match[1], sourceMessageId: match[2] };
}

export function taskReplyRequiresWork(body: string): boolean {
  return ["实现", "修复", "检查", "整理", "创建", "改一下", "写一个", "生成", "调查", "验证", "继续"].some((marker) => body.includes(marker));
}

export function channelReadinessLabel(readiness: SleiChannelMemberReadiness | undefined, messages: DesktopMessages): string {
  switch (readiness) {
    case "joining":
      return messages.chat.memberJoining;
    case "memory_syncing":
      return messages.chat.memorySyncing;
    case "memory_failed":
      return messages.chat.memoryFailed;
    case "unavailable":
      return messages.chat.memberUnavailable;
    case "ready":
    default:
      return messages.chat.memberReady;
  }
}

export function appendTaskReply(tasks: SleiTask[], taskId: string, reply: { sender: string; role?: SleiMessage["role"]; body: string }): SleiTask[] {
  const body = reply.body.trim();
  if (!body) return tasks;
  return tasks.map((task) => {
    if (task.id !== taskId) return task;
    const replies = [
      ...(task.replies ?? []),
      { id: `reply-${taskId}-${(task.replies?.length ?? 0) + 1}`, sender: reply.sender, role: reply.role, body },
    ];
    return { ...task, replies, replyCount: replies.length };
  });
}

export function shouldRefreshConversationMessages(messages: SleiMessage[], conversationId?: string): boolean {
  if (!conversationId) return false;
  return messages.some((message) => message.channelId === conversationId && (message.status === "running" || message.status === "pending"));
}

export function shouldRefreshChannelMessages(messages: SleiMessage[], channelId?: string): boolean {
  if (!channelId) return false;
  return messages.some((message) => message.channelId === channelId && (message.status === "running" || message.status === "pending"));
}

function dateFromMessageTimeValue(value: string): Date | null {
  const raw = value.trim();
  let date: Date;
  if (/^\d+$/.test(raw)) {
    const numeric = BigInt(raw);
    const milliseconds =
      raw.length >= 16
        ? numeric / 1_000_000n
        : raw.length >= 13
          ? numeric
          : numeric * 1_000n;
    date = new Date(Number(milliseconds));
  } else if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?$/.test(raw)) {
    date = new Date(`${raw.replace(" ", "T")}Z`);
  } else {
    date = new Date(raw);
  }
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function twoDigit(value: number): string {
  return value.toString().padStart(2, "0");
}

function datePartsInTimeZone(date: Date, timeZone?: string): { year: string; month: string; day: string; hour: string; minute: string; second: string } {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date);
    const valueFor = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
    return {
      year: valueFor("year"),
      month: valueFor("month"),
      day: valueFor("day"),
      hour: valueFor("hour"),
      minute: valueFor("minute"),
      second: valueFor("second"),
    };
  } catch {
    return {
      year: date.getFullYear().toString(),
      month: twoDigit(date.getMonth() + 1),
      day: twoDigit(date.getDate()),
      hour: twoDigit(date.getHours()),
      minute: twoDigit(date.getMinutes()),
      second: twoDigit(date.getSeconds()),
    };
  }
}

export function formatMessageDateTime(value: string, timeZone?: string): string {
  const raw = value.trim();
  const date = dateFromMessageTimeValue(raw);
  if (!date) return raw;
  const parts = datePartsInTimeZone(date, timeZone);
  return [
    `${parts.month}-${parts.day}`,
    `${parts.hour}:${parts.minute}`,
  ].join(" ");
}

export function formatMessageTime(value: string, timeZone?: string): string {
  const raw = value.trim();
  const date = dateFromMessageTimeValue(raw);
  if (!date) return raw;
  const parts = datePartsInTimeZone(date, timeZone);
  return `${parts.hour}:${parts.minute}`;
}

export function formatLocalRecordDateTime(value: string, timeZone?: string): string {
  const raw = value.trim();
  if (!raw) return "";
  const date = dateFromMessageTimeValue(raw);
  if (!date) return raw;
  const parts = datePartsInTimeZone(date, timeZone);
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

export function filterConversationMessages(messages: SleiMessage[], filters: ChatSearchFilters): SleiMessage[] {
  const query = normalizeSearch(filters.query);
  const user = normalizeSearch(filters.user);
  const channel = normalizeSearch(filters.channel);
  const time = normalizeSearch(filters.time);

  return messages.filter((message) => {
    const authorText = normalizeSearch(`${message.author} ${message.handle ?? ""}`);
    const bodyText = normalizeSearch(message.body);
    const channelText = normalizeSearch(message.channelId ?? "all");
    const timeText = normalizeSearch(message.time);

    return (
      (!query || bodyText.includes(query) || authorText.includes(query)) &&
      (!user || authorText.includes(user)) &&
      (!channel || channelText.includes(channel)) &&
      (!time || timeText.includes(time))
    );
  });
}

export function activeMentionQuery(draft: string): ActiveMention | null {
  const match = /(^|\s)@([\w-]*)$/u.exec(draft);
  if (!match) return null;
  const prefix = match[1] ?? "";
  const start = match.index + prefix.length;
  return {
    query: match[2] ?? "",
    start,
    end: draft.length,
  };
}

export function activeSkillSlashQuery(draft: string): ActiveSkillSlashQuery | null {
  const match = /^\/([\w-]*)$/u.exec(draft);
  if (!match) return null;
  return {
    query: match[1] ?? "",
    start: 0,
    end: draft.length,
  };
}

export function moveMentionSelection(current: number, delta: number, count: number): number {
  if (count <= 0) return 0;
  return (current + delta + count) % count;
}

export function insertMention(draft: string, mention: ActiveMention, handle: string): string {
  const normalized = handle.startsWith("@") ? handle : `@${handle}`;
  return `${draft.slice(0, mention.start)}${normalized} ${draft.slice(mention.end)}`;
}

export function mentionSuggestions(query: string, members: SleiMember[]): SleiMember[] {
  const normalized = normalizeSearch(query.replace(/^@/, ""));
  return members.filter((member) => {
    const handle = normalizeSearch(member.handle.replace(/^@/, ""));
    const name = normalizeSearch(member.name);
    return !normalized || handle.includes(normalized) || name.includes(normalized);
  });
}

export function skillSlashSuggestions(query: string, skills: SkillView[]): SkillView[] {
  const normalized = normalizeSearch(query.replace(/^\//, ""));
  return skills.filter((skill) => {
    const name = normalizeSearch(skill.name);
    const id = normalizeSearch(skill.id);
    return Boolean(skill.name.trim()) && (!normalized || name.includes(normalized) || id.includes(normalized));
  });
}

export function insertSkillSlash(draft: string, slash: ActiveSkillSlashQuery, skill: Pick<SkillView, "name">): string {
  const name = skill.name.trim();
  if (!name) return draft;
  return `${draft.slice(0, slash.start)}/${name} ${draft.slice(slash.end)}`;
}

export function leadingSkillSlashToken(body: string, skills: SkillView[]): { skill: SkillView; token: string; rest: string } | null {
  const match = /^\/([\w-]+)(?=$|\s)/u.exec(body);
  if (!match) return null;
  const tokenName = match[1] ?? "";
  const normalized = normalizeSearch(tokenName);
  const skill = skills.find((candidate) =>
    normalizeSearch(candidate.name) === normalized || normalizeSearch(candidate.id) === normalized,
  );
  if (!skill) return null;
  return {
    skill,
    token: match[0],
    rest: body.slice(match[0].length),
  };
}

export function detectAgentMemoryRequest(message: string, members: SleiMember[]): AgentMemoryRequest | null {
  const match = /^\s*@([\w-]+)\s+(?:记住[:：]?\s*|remember\s+|learn\s+)(.+)$/iu.exec(message);
  if (!match) return null;
  const handle = `@${match[1].toLowerCase()}`;
  const member = members.find((candidate) => candidate.handle.toLowerCase() === handle && candidate.type === "agent");
  const fact = (match[2] ?? "").trim();
  if (!member || !fact) return null;
  return { agentId: member.id, fact };
}

export function createDraftComputerNode(name: string, osLabel: string): DesktopNodeView {
  const trimmedName = name.trim() || "新设备";
  const [platform = "custom", ...archParts] = osLabel.trim().split(/\s+/).filter(Boolean);
  return {
    id: `computer-${Date.now()}`,
    name: trimmedName,
    status: "offline",
    daemonVersion: "0.54.1",
    created: new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
    device: {
      platform,
      arch: archParts.join(" ") || "unknown",
      hostname: `${trimmedName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "computer"}.local`,
    },
    runtimes: [{ kind: "ClaudeCode", readiness: "unknown" }],
  };
}

export function renameComputerNode(nodes: DesktopNodeView[], nodeId: string, name: string): DesktopNodeView[] {
  const trimmedName = name.trim();
  if (!trimmedName) return nodes;
  return nodes.map((node) =>
    node.id === nodeId
      ? {
          ...node,
          name: trimmedName,
        }
      : node,
  );
}

export function deleteComputerNode(nodes: DesktopNodeView[], nodeId: string): DesktopNodeView[] {
  if (nodeId === "local-node") return nodes;
  return nodes.filter((node) => node.id !== nodeId);
}

export function deviceOsLabel(device: DesktopNodeView["device"]) {
  return [device.platform, device.arch].filter(Boolean).join(" ");
}

export function agentsForComputerNode(node: DesktopNodeView, members: SleiMember[]): SleiMember[] {
  const nodeNames = [node.name, node.device.hostname].map(normalizeSearch);
  return members.filter((member) => {
    if (member.type !== "agent") return false;
    if (member.nodeId) return member.nodeId === node.id;
    return nodeNames.includes(normalizeSearch(member.computer));
  });
}

export function formatCreatedDate(value?: string): string {
  const raw = value?.trim() ?? "";
  if (!raw) return "";
  if (/^\d{8}$/.test(raw)) return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  let date: Date;
  if (/^\d+$/.test(raw)) {
    try {
      const numeric = BigInt(raw);
      const milliseconds =
        raw.length >= 16
          ? numeric / 1_000_000n
          : raw.length >= 13
            ? numeric
            : numeric * 1_000n;
      date = new Date(Number(milliseconds));
    } catch {
      return raw;
    }
  } else {
    date = new Date(raw);
  }
  if (Number.isNaN(date.getTime())) return raw;
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function formatMemberCreatedDate(value?: string): string {
  return formatCreatedDate(value);
}

export function stripChannelHash(name: string) {
  return name.trim().replace(/^#+/, "");
}

function normalizeSearch(value?: unknown) {
  if (typeof value === "string") return value.trim().toLowerCase();
  if (typeof value === "number" || typeof value === "boolean") return String(value).trim().toLowerCase();
  return "";
}
