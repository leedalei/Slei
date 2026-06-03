import type { AppearancePreferences, ConversationAttachmentView, DaemonBridge, DesktopNodeView, NotificationPreferences } from "../lib/daemon-bridge";
import { createDesktopMessages, type DesktopMessages } from "../i18n";
import type { SleiChannelMemberReadiness, SleiMember, SleiMessage, SleiTask } from "./fixtures";
import type { AppView } from "./router";

export type { AppView } from "./router";

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

export type AgentDraftInput = {
  name: string;
  handle: string;
  runtimeKind: string;
  model: string;
  nodeId: string;
  description: string;
};

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

export const defaultNotifications: NotificationPreferences = {
  mentions: true,
  humanReplies: true,
  approvals: true,
};

export const defaultAppearance: AppearancePreferences = {
  theme: "system",
  fontSize: "md",
};

export const defaultTimeZone = "Asia/Shanghai";
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

export async function sendChatComposerMessage(input: {
  activeChannelId: string;
  activeConversationId?: string;
  activeSessionId?: string;
  attachmentIds?: string[];
  body: string;
  bridge: Pick<DaemonBridge, "sendChannelMessage" | "sendConversationMessage">;
  profile: UserProfile;
}) {
  const body = input.body.trim();
  if (input.activeConversationId) {
    return {
      kind: "conversation" as const,
      receipt: await input.bridge.sendConversationMessage(input.activeConversationId, {
        authorId: "human:local",
        body,
        sessionId: input.activeSessionId,
        attachmentIds: input.attachmentIds,
      }),
    };
  }

  const handle = input.profile.handle.replace(/^@/, "").trim() || "local";
  return {
    kind: "channel" as const,
    receipt: await input.bridge.sendChannelMessage(input.activeChannelId, {
      authorId: `human:${handle}`,
      body,
    }),
  };
}

export function createLocalChatMessage(input: {
  body: string;
  messages?: DesktopMessages;
  profile: UserProfile;
  channelId?: string;
}): (SleiMessage & { handle: string; avatar: string }) | null {
  const body = input.body.trim();
  if (!body) {
    return null;
  }

  return {
    id: `local-${Date.now()}`,
    author: input.profile.displayName.trim() || input.profile.handle || input.messages?.common.you || createDesktopMessages("zh-CN").common.you,
    handle: input.profile.handle.startsWith("@") ? input.profile.handle : `@${input.profile.handle}`,
    avatar: input.profile.avatar.trim() || input.profile.displayName.slice(0, 2),
    role: "human",
    time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    body,
    channelId: input.channelId,
  };
}

export type ComposerShortcutAction = "none" | "selectMention" | "submit";

export function isComposerImeComposing(input: { composing?: boolean; nativeEvent?: { isComposing?: boolean } }): boolean {
  return Boolean(input.composing || input.nativeEvent?.isComposing);
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
    status: "todo",
    channelId,
    sourceMessageId: message.id,
    replies: [{ id: `root-${message.id}`, sender: message.author, role: message.role, body: message.body }],
  };
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
  return tasks.map((task) =>
    task.id === taskId
      ? {
          ...task,
          replies: [
            ...(task.replies ?? []),
            { id: `reply-${taskId}-${(task.replies?.length ?? 0) + 1}`, sender: reply.sender, role: reply.role, body },
          ],
        }
      : task,
  );
}

export function shouldRefreshConversationMessages(messages: SleiMessage[], conversationId?: string): boolean {
  if (!conversationId) return false;
  return messages.some((message) => message.channelId === conversationId && (message.status === "running" || message.status === "pending"));
}

export function formatMessageTime(value: string): string {
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
  } else {
    date = new Date(raw);
  }
  if (Number.isNaN(date.getTime())) return raw;
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
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

export function formatMemberCreatedDate(value?: string): string {
  const raw = value?.trim() ?? "";
  if (!raw) return "";
  if (/^\d{8}$/.test(raw)) return raw;
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
  return `${year}${month}${day}`;
}

export function stripChannelHash(name: string) {
  return name.trim().replace(/^#+/, "");
}

function normalizeSearch(value?: unknown) {
  if (typeof value === "string") return value.trim().toLowerCase();
  if (typeof value === "number" || typeof value === "boolean") return String(value).trim().toLowerCase();
  return "";
}
