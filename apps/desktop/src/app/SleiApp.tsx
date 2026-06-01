import { type CSSProperties, type FormEvent, type PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  ArrowDown,
  ArrowUpDown,
  AtSign,
  Bell,
  Bookmark,
  Check,
  CheckSquare,
  ChevronDown,
  CircleUserRound,
  ExternalLink,
  FileText,
  FolderOpen,
  Globe2,
  Hash,
  History,
  Image as ImageIcon,
  Info,
  ListTodo,
  MessageCircle,
  MessageSquare,
  Monitor,
  Paperclip,
  Palette,
  Pencil,
  Plus,
  RefreshCcw,
  Search,
  Send,
  Server,
  Settings,
  Trash2,
  X,
  type LucideIcon,
} from "lucide-react";

import {
  createDaemonBridge,
  type AppearancePreferences,
  type AppLocale,
  type ChannelView,
  type ConversationAttachmentView,
  type ConversationAttachmentUploadRequest,
  type ConversationView,
  type ConversationMessageView,
  type ConversationSessionView,
  type DaemonBridge,
  type DesktopAgentView,
  type DesktopNodeView,
  type InteractiveCardView,
  type NotificationPreferences,
  type AgentPathTarget,
  type RuntimeSetupState,
} from "../lib/daemon-bridge";
import { createDesktopMessages, type DesktopMessages } from "../i18n";
import { MarkdownMessage } from "../features/chat/MarkdownMessage";
import { createSleiFixtures, type SleiChannel, type SleiFixtures, type SleiMember, type SleiMessage, type SleiTask } from "./fixtures";
import { createMemberAvatar, memberFromMessage, type AvatarIdentity } from "./member-avatar";
import sleiSquareLogo from "../../src-tauri/icons/Square44x44Logo.png";
import "./app.css";

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

const defaultProfile: UserProfile = {
  displayName: "Lei",
  handle: "@lei",
  avatar: "LL",
};

const defaultNotifications: NotificationPreferences = {
  mentions: true,
  humanReplies: true,
  approvals: true,
};

const defaultAppearance: AppearancePreferences = {
  theme: "system",
  fontSize: "md",
};

const defaultTimeZone = "Asia/Shanghai";
const desktopVersion = "0.1.0";

const profileAvatarPresets = [
  { id: "pixel-sun", labelKey: "pixelSun", name: "Pixel Sun" },
  { id: "pixel-moon", labelKey: "pixelMoon", name: "Pixel Moon" },
  { id: "pixel-cube", labelKey: "pixelCube", name: "Pixel Cube" },
  { id: "pixel-spark", labelKey: "pixelSpark", name: "Pixel Spark" },
];

const navItems: Array<{ id: Exclude<AppView, "search">; icon: LucideIcon }> = [
  { id: "chat", icon: MessageCircle },
  { id: "tasks", icon: ListTodo },
  { id: "members", icon: AtSign },
  { id: "computers", icon: Monitor },
  { id: "settings", icon: Settings },
];

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

export function shouldRefreshConversationMessages(messages: SleiMessage[], conversationId?: string): boolean {
  if (!conversationId) return false;
  return messages.some((message) => message.channelId === conversationId && (message.status === "running" || message.status === "pending"));
}

function messageStatusSquare(status?: SleiMessage["status"]): "running" | "approval" | "failed" | "pending" | undefined {
  if (status === "running") return "running";
  if (status === "approval") return "approval";
  if (status === "failed") return "failed";
  if (status === "pending" || status === "undecided") return "pending";
  return undefined;
}

function MessageStatusSquare({ status }: { status?: SleiMessage["status"] }) {
  const tone = messageStatusSquare(status);
  if (!tone) return null;
  return (
    <span
      aria-label={status}
      className={`slei-message-status-square slei-message-status-square--${tone}`}
      role="img"
      title={status}
    />
  );
}

function formatMessageTime(value: string): string {
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

function replaceConversationMessages(current: SleiMessage[], conversationMessages: SleiMessage[], conversationIds?: string[]): SleiMessage[] {
  const ids = new Set(conversationIds ?? conversationMessages.map((message) => message.channelId).filter((id): id is string => Boolean(id)));
  return [
    ...current.filter((message) => !message.channelId || !ids.has(message.channelId)),
    ...conversationMessages,
  ];
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

function normalizeSearch(value?: string) {
  return (value ?? "").trim().toLowerCase();
}

function mentionSuggestions(query: string, members: SleiMember[]): SleiMember[] {
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

function deviceOsLabel(device: DesktopNodeView["device"]) {
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

function memberFromAgentView(agent: DesktopAgentView, nodes: DesktopNodeView[], messages: DesktopMessages = createDesktopMessages("zh-CN")): SleiMember {
  const node = nodes.find((candidate) => candidate.id === agent.nodeId);
  return {
    id: agent.id,
    name: agent.name,
    handle: agent.handle,
    avatar: agent.name.slice(0, 2).toUpperCase(),
    avatarSeed: agent.avatarSeed,
    type: "agent",
    runtimeStatus: node?.status === "offline" ? "offline" : "idle",
    role: agent.agentKind === "guide" ? messages.chat.guide : agent.description.split("。")[0] || messages.agentCreate.fallbackAgent,
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
  };
}

function mergeAgentViewsIntoMembers(current: SleiMember[], agents: DesktopAgentView[], nodes: DesktopNodeView[], messages: DesktopMessages = createDesktopMessages("zh-CN")) {
  void current;
  return agents.map((agent) => memberFromAgentView(agent, nodes, messages));
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
  };
}

function stripChannelHash(name: string) {
  return name.trim().replace(/^#+/, "");
}

function upsertConversation(conversations: ConversationView[], conversation: ConversationView) {
  return conversations.some((candidate) => candidate.id === conversation.id)
    ? conversations.map((candidate) => (candidate.id === conversation.id ? conversation : candidate))
    : [...conversations, conversation];
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

async function loadSleiConversationSessions(bridge: DaemonBridge, conversations: ConversationView[]) {
  const receipts = await Promise.all(conversations.map((conversation) => bridge.listConversationSessions(conversation.id)));
  return receipts.flatMap((receipt) => receipt.sessions);
}

function MemberAvatar({ identity, large = false }: { identity: AvatarIdentity; large?: boolean }) {
  const fallback = identity.avatar || identity.name.slice(0, 2);
  return (
    <span className={`slei-avatar${large ? " slei-avatar--large" : ""}`} title={identity.name}>
      <img alt="" aria-hidden="true" className="slei-avatar__image" src={createMemberAvatar(identity)} />
      <span className="slei-avatar__fallback">{fallback}</span>
    </span>
  );
}

function SelectControl<TValue extends string>(input: {
  ariaLabel?: string;
  className?: string;
  onChange: (value: TValue) => void;
  options: Array<{ label: string; value: TValue; disabled?: boolean }>;
  value: TValue;
}) {
  return (
    <span className={`slei-select${input.className ? ` ${input.className}` : ""}`}>
      <select
        aria-label={input.ariaLabel}
        className="slei-select__control"
        onChange={(event) => input.onChange(event.currentTarget.value as TValue)}
        value={input.value}
      >
        {input.options.map((option) => (
          <option disabled={option.disabled} key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
      <ChevronDown aria-hidden="true" className="slei-select__icon" size={16} strokeWidth={2.8} />
    </span>
  );
}

function CheckboxControl(input: {
  checked?: boolean;
  className?: string;
  disabled?: boolean;
  label: string;
  onChange?: (checked: boolean) => void;
}) {
  return (
    <label className={`slei-checkbox${input.className ? ` ${input.className}` : ""}`}>
      <input
        checked={input.checked ?? false}
        className="slei-checkbox__control"
        disabled={input.disabled}
        onChange={(event) => input.onChange?.(event.currentTarget.checked)}
        type="checkbox"
      />
      <span className="slei-checkbox__box" aria-hidden="true">
        <Check size={14} strokeWidth={3.2} />
      </span>
      <span className="slei-checkbox__label">{input.label}</span>
    </label>
  );
}

export function Empty(input: {
  title: string;
  description?: string;
  variant?: EmptyVariant;
  size?: EmptySize;
  centered?: boolean;
}) {
  const variant = input.variant ?? "nodata";
  const size = input.size ?? "md";

  return (
    <section className={`slei-empty slei-empty--${variant} slei-empty--${size}${input.centered ? " slei-empty-detail" : ""}`} role="status">
      <div className="slei-empty__pixel-face" aria-hidden="true">
        <span className="slei-empty__pixel slei-empty__pixel--eye slei-empty__pixel--left" />
        <span className="slei-empty__pixel slei-empty__pixel--eye slei-empty__pixel--right" />
        <span className="slei-empty__pixel slei-empty__pixel--mouth" />
        <span className="slei-empty__pixel slei-empty__pixel--mark" />
      </div>
      <div className="slei-empty__copy">
        <h2>{input.title}</h2>
        {input.description ? <p>{input.description}</p> : null}
      </div>
    </section>
  );
}

export function SleiApp() {
  const [activeView, setActiveView] = useState<AppView>("chat");
  const [data, setData] = useState(createSleiFixtures());
  const [activeChannelId, setActiveChannelId] = useState("all");
  const [activeConversationId, setActiveConversationId] = useState<string | undefined>(undefined);
  const [activeSessionId, setActiveSessionId] = useState<string | undefined>(undefined);
  const [activeMemberId, setActiveMemberId] = useState<string | undefined>(undefined);
  const [sessionDrawerOpen, setSessionDrawerOpen] = useState(false);
  const [sendingConversationIds, setSendingConversationIds] = useState<string[]>([]);
  const [profile, setProfile] = useState<UserProfile>(defaultProfile);
  const [locale, setLocale] = useState<AppLocale>("zh-CN");
  const [timeZone, setTimeZone] = useState(defaultTimeZone);
  const [appearance, setAppearance] = useState<AppearancePreferences>(defaultAppearance);
  const [notifications, setNotifications] = useState<NotificationPreferences>(defaultNotifications);
  const [sidebarWidth, setSidebarWidth] = useState(240);
  const [guideBootstrapping, setGuideBootstrapping] = useState(false);
  const [runtimeSetup, setRuntimeSetup] = useState<RuntimeSetupState>({
    loading: true,
    error: undefined,
    hasClaudeRuntimeReady: true,
    nodes: data.nodes,
  });
  const bridge = useMemo(() => createDaemonBridge(), []);
  const messages = createDesktopMessages(locale);

  useEffect(() => {
    let mounted = true;
    async function loadInitialState() {
      const [next, preferencesReceipt] = await Promise.all([refreshRuntime(bridge), bridge.listPreferences()]);
      if (!mounted) return;
      setRuntimeSetup(next);
      setLocale(preferencesReceipt.preferences.locale);
      setTimeZone(preferencesReceipt.preferences.timeZone);
      setAppearance(preferencesReceipt.preferences.appearance);
      setNotifications(preferencesReceipt.preferences.notifications);
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
      const members = await loadGuideSkillsForMembers(
        bridge,
        mergeAgentViewsIntoMembers([], agentReceipt.agents, next.nodes, messagesForLocale),
      );
      const conversationSessions = await loadSleiConversationSessions(bridge, conversationReceipt.conversations);
      const conversationMessages = await loadSleiConversationMessages(bridge, conversationReceipt.conversations, members, profile);
      if (!mounted) return;
      setData((current) =>
        createSleiFixtures({
          ...current,
          nodes: next.nodes,
          channels: channelReceipt.channels.map((channel) => channelFromView(channel, messagesForLocale)),
          conversations: conversationReceipt.conversations,
          conversationSessions,
          messages: replaceConversationMessages(current.messages, conversationMessages, conversationReceipt.conversations.map((conversation) => conversation.id)),
          members,
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
    const [next, preferencesReceipt] = await Promise.all([refreshRuntime(bridge), bridge.listPreferences()]);
    if (hasReadyClaudeRuntime(next.nodes)) {
      setGuideBootstrapping(true);
      await bridge.bootstrapGuideAgent();
      setGuideBootstrapping(false);
    }
    const [agentReceipt, conversationReceipt, channelReceipt] = await Promise.all([bridge.listAgents(), bridge.listConversations(), bridge.listChannels()]);
    setRuntimeSetup(next);
    setLocale(preferencesReceipt.preferences.locale);
    setTimeZone(preferencesReceipt.preferences.timeZone);
    setAppearance(preferencesReceipt.preferences.appearance);
    setNotifications(preferencesReceipt.preferences.notifications);
    const messagesForLocale = createDesktopMessages(preferencesReceipt.preferences.locale);
    const members = await loadGuideSkillsForMembers(
      bridge,
      mergeAgentViewsIntoMembers([], agentReceipt.agents, next.nodes, messagesForLocale),
    );
    const conversationSessions = await loadSleiConversationSessions(bridge, conversationReceipt.conversations);
    const conversationMessages = await loadSleiConversationMessages(bridge, conversationReceipt.conversations, members, profile);
    setData((current) =>
      createSleiFixtures({
        ...current,
        nodes: next.nodes,
        channels: channelReceipt.channels.map((channel) => channelFromView(channel, messagesForLocale)),
        conversations: conversationReceipt.conversations,
        conversationSessions,
        messages: replaceConversationMessages(current.messages, conversationMessages, conversationReceipt.conversations.map((conversation) => conversation.id)),
        members,
      }),
    );
    setActiveMemberId((current) => current ?? members[0]?.id);
  }

  async function handleCreateAgent(request: AgentDraftInput) {
    const receipt = await bridge.createAgent(request);
    const member = memberFromAgentView(receipt.agent, runtimeSetup.nodes, messages);
    setData((current) => createSleiFixtures({ ...current, members: [...current.members, member] }));
    setActiveMemberId(member.id);
    setActiveView("members");
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

  async function handleUpdateAgent(agentId: string, update: Partial<AgentDraftInput>) {
    const receipt = await bridge.updateAgent(agentId, update);
    const member = memberFromAgentView(receipt.agent, runtimeSetup.nodes, messages);
    setData((current) =>
      createSleiFixtures({
        ...current,
        members: current.members.map((candidate) => (candidate.id === member.id ? member : candidate)),
      }),
    );
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
    setActiveView("chat");
  }

  async function handleResetConversationRuntimeSession(conversationId: string) {
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

  async function handleSendMessage(body: string, options?: { asTask?: boolean; attachmentIds?: string[]; sessionId?: string }) {
    const targetId = activeConversationId ?? activeChannelId;
    const memoryRequest = detectAgentMemoryRequest(body, data.members);
    if (activeConversationId) {
      const attachmentIds = options?.attachmentIds ?? [];
      if (!body.trim() && attachmentIds.length === 0) return;
      setSendingConversationIds((current) => [...new Set([...current, activeConversationId])]);
      try {
        const receipt = await bridge.sendConversationMessage(activeConversationId, {
          authorId: "human:local",
          body: body.trim(),
          sessionId: options?.sessionId ?? activeSessionId,
          attachmentIds,
        });
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
        status: "done",
        toolCall: "remember_agent_fact",
      };
      setData((current) => createSleiFixtures({ ...current, messages: [...current.messages, message, systemMessage] }));
      return;
    }

    setData((current) => {
      const nextTasks = options?.asTask ? [...current.tasks, createTaskFromChatMessage(message, targetId)] : current.tasks;
      return createSleiFixtures({ ...current, messages: [...current.messages, message], tasks: nextTasks });
    });
  }

  function handleTaskReply(taskId: string, body: string) {
    setData((current) => createSleiFixtures({ ...current, tasks: appendTaskReply(current.tasks, taskId, { sender: profile.displayName, role: "human", body }) }));
  }

  async function handleCreateChannel(input: { name: string; projectName?: string }) {
    const name = stripChannelHash(input.name);
    if (!name) return;
    const receipt = await bridge.createChannel({
      name,
      description: input.projectName?.trim() ? messages.chat.projectPrefix(input.projectName.trim()) : messages.chat.channel,
    });
    const channel = channelFromView(receipt.channel, messages);
    setData((current) => {
      if (current.channels.some((candidate) => candidate.id === channel.id || candidate.name === channel.name)) return current;
      return createSleiFixtures({ ...current, channels: [...current.channels, channel] });
    });
    setActiveChannelId(channel.id);
  }

  function handleDeleteChannel(channelId: string) {
    if (channelId === "all") return;
    setData((current) =>
      createSleiFixtures({
        ...current,
        channels: current.channels.filter((channel) => channel.id !== channelId),
        messages: current.messages.filter((message) => (message.channelId ?? "all") !== channelId),
      }),
    );
    setActiveChannelId((current) => (current === channelId ? "all" : current));
  }

  function handleSearchResultSelect(channelId: string) {
    setActiveChannelId(channelId);
    setActiveConversationId(undefined);
    setActiveView("chat");
  }

  async function handleLocaleChange(nextLocale: AppLocale) {
    setLocale(nextLocale);
    const receipt = await bridge.updatePreferences({ locale: nextLocale });
    setLocale(receipt.preferences.locale);
    setTimeZone(receipt.preferences.timeZone);
    setAppearance(receipt.preferences.appearance);
    setNotifications(receipt.preferences.notifications);
  }

  async function handleTimeZoneChange(nextTimeZone: string) {
    setTimeZone(nextTimeZone);
    const receipt = await bridge.updatePreferences({ timeZone: nextTimeZone });
    setLocale(receipt.preferences.locale);
    setTimeZone(receipt.preferences.timeZone);
    setAppearance(receipt.preferences.appearance);
    setNotifications(receipt.preferences.notifications);
  }

  async function handleAppearanceChange(nextAppearance: AppearancePreferences) {
    setAppearance(nextAppearance);
    const receipt = await bridge.updatePreferences({ appearance: nextAppearance });
    setLocale(receipt.preferences.locale);
    setTimeZone(receipt.preferences.timeZone);
    setAppearance(receipt.preferences.appearance);
    setNotifications(receipt.preferences.notifications);
  }

  async function handleNotificationsChange(nextNotifications: NotificationPreferences) {
    setNotifications(nextNotifications);
    const receipt = await bridge.updatePreferences({ notifications: nextNotifications });
    setLocale(receipt.preferences.locale);
    setTimeZone(receipt.preferences.timeZone);
    setAppearance(receipt.preferences.appearance);
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

  return (
    <SleiAppFrame
      activeView={activeView}
      activeChannelId={activeChannelId}
      activeConversationId={activeConversationId}
      activeSessionId={activeSessionId}
      activeMemberId={activeMemberId}
      data={data}
      guideBootstrapping={guideBootstrapping}
      onAgentCreate={handleCreateAgent}
      onAgentUpdate={handleUpdateAgent}
      locale={locale}
      timeZone={timeZone}
      appearance={appearance}
      notifications={notifications}
      onChannelCreate={handleCreateChannel}
      onChannelDelete={handleDeleteChannel}
      onInteractiveCardComplete={handleInteractiveCardComplete}
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
      onSearchToggle={() => setActiveView("search")}
      onSendMessage={handleSendMessage}
      onAttachmentUpload={handleUploadConversationAttachment}
      onTaskReply={handleTaskReply}
      onViewChange={setActiveView}
      onMemberSelect={setActiveMemberId}
      onMemberMessage={handleMessageMember}
      onOpenAgentPath={handleOpenAgentPath}
      onConversationRuntimeReset={handleResetConversationRuntimeSession}
      onConversationHistoryToggle={() => setSessionDrawerOpen((current) => !current)}
      onConversationSelect={(conversationId) => {
        const conversation = data.conversations.find((candidate) => candidate.id === conversationId);
        setActiveConversationId(conversationId);
        setActiveSessionId(conversation?.activeSessionId);
        setActiveView("chat");
      }}
      onConversationSessionSelect={handleConversationSessionSelect}
      profile={profile}
      runtimeSetup={runtimeSetup}
      sessionDrawerOpen={sessionDrawerOpen}
      sendingConversationIds={sendingConversationIds}
      sidebarWidth={sidebarWidth}
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

export function SleiAppFrame(input: {
  activeView: AppView;
  activeChannelId?: string;
  activeConversationId?: string;
  activeSessionId?: string;
  activeMemberId?: string;
  activeTaskId?: string;
  data: SleiFixtures;
  initialChatDraft?: string;
  initialComposerAttachments?: ConversationAttachmentView[];
  initialConversationHistoryOpen?: boolean;
  initialAgentCreateModalOpen?: boolean;
  initialCreateChannelModalOpen?: boolean;
  initialWindowCloseConfirmOpen?: boolean;
  guideBootstrapping?: boolean;
  initialSettingsPanel?: SettingsPanel;
  initialSearchFilters?: ChatSearchFilters;
  locale: AppLocale;
  timeZone?: string;
  appearance?: AppearancePreferences;
  notifications?: NotificationPreferences;
  profile?: UserProfile;
  runtimeSetup: RuntimeSetupState;
  searchOpen?: boolean;
  sessionDrawerOpen?: boolean;
  sendingConversationIds?: string[];
  sidebarWidth?: number;
  onAgentCreate?: (request: AgentDraftInput) => Promise<void> | void;
  onAgentUpdate?: (agentId: string, update: Partial<AgentDraftInput>) => Promise<void> | void;
  onChannelCreate?: (input: { name: string; projectName?: string }) => Promise<void> | void;
  onChannelDelete?: (channelId: string) => void;
  onChannelSelect?: (channelId: string) => void;
  onConversationRuntimeReset?: (conversationId: string) => Promise<void> | void;
  onConversationHistoryToggle?: () => void;
  onConversationSessionSelect?: (conversationId: string, sessionId: string) => Promise<void> | void;
  onAttachmentUpload?: (request: ConversationAttachmentUploadRequest) => Promise<{ attachment: ConversationAttachmentView }>;
  onInteractiveCardComplete?: (cardId: string) => Promise<void> | void;
  onConversationSelect?: (conversationId: string) => void;
  onComputerCreate?: (name: string, osLabel: string) => void;
  onComputerDelete?: (nodeId: string) => void;
  onComputerRename?: (nodeId: string, name: string) => void;
  onAppearanceChange?: (appearance: AppearancePreferences) => Promise<void> | void;
  onLocaleChange?: (locale: AppLocale) => Promise<void> | void;
  onTimeZoneChange?: (timeZone: string) => Promise<void> | void;
  onNotificationsChange?: (notifications: NotificationPreferences) => Promise<void> | void;
  onProfileChange?: (profile: UserProfile) => void;
  onResizeStart?: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onSearchResultSelect?: (channelId: string, messageId: string) => void;
  onSearchToggle?: () => void;
  onMemberSelect?: (memberId: string) => void;
  onMemberMessage?: (memberId: string) => void;
  onOpenAgentPath?: (agentId: string, target: AgentPathTarget) => Promise<void> | void;
  onSendMessage?: (body: string, options?: { asTask?: boolean; attachmentIds?: string[]; sessionId?: string }) => Promise<void> | void;
  onTaskReply?: (taskId: string, body: string) => void;
  onViewChange?: (view: AppView) => void;
  onRenameLocalNode?: (name: string) => Promise<void> | void;
  onRefreshRuntime?: () => Promise<void> | void;
}) {
  const activeChannel = input.data.channels.find((channel) => channel.id === input.activeChannelId) ?? input.data.channels[0];
  const activeConversation = input.data.conversations.find((conversation) => conversation.id === input.activeConversationId);
  const activeSessionId = input.activeSessionId ?? activeConversation?.activeSessionId;
  const firstComputer = input.runtimeSetup.nodes[0];
  const [activeComputerId, setActiveComputerId] = useState(firstComputer?.id ?? "");
  const [computerCreateOpen, setComputerCreateOpen] = useState(false);
  const [agentCreateOpen, setAgentCreateOpen] = useState(input.initialAgentCreateModalOpen ?? false);
  const [activeSettingsPanel, setActiveSettingsPanel] = useState<SettingsPanel>(input.initialSettingsPanel ?? "account");
  const [agentDraft, setAgentDraft] = useState<Partial<AgentDraftInput> | undefined>(undefined);
  const [activeCardId, setActiveCardId] = useState<string | undefined>(undefined);
  const profile = input.profile ?? defaultProfile;
  const appearance = input.appearance ?? defaultAppearance;
  const messages = createDesktopMessages(input.locale);
  const shellStyle = {
    "--slei-sidebar-width": `${input.sidebarWidth ?? 240}px`,
    "--slei-font-size": fontSizeValue(appearance.fontSize),
  } as CSSProperties;

  useEffect(() => {
    if (input.runtimeSetup.nodes.some((node) => node.id === activeComputerId)) return;
    setActiveComputerId(firstComputer?.id ?? "");
  }, [activeComputerId, firstComputer?.id, input.runtimeSetup.nodes]);

  return (
    <div className="slei-shell" data-active-view={input.activeView} data-theme={appearance.theme} style={shellStyle}>
      <nav className="slei-rail" data-tauri-drag-region="deep" aria-label={messages.shell.mainNavigation}>
        <div className="slei-brand">
          <img alt="Slei" className="slei-brand__logo" src={sleiSquareLogo} />
        </div>
        {navItems.map((item) => (
          <button
            aria-label={messages.shell.nav[item.id]}
            aria-current={input.activeView === item.id ? "page" : undefined}
            className="slei-rail__button"
            data-nav-icon={item.id}
            key={item.id}
            onClick={() => input.onViewChange?.(item.id)}
            title={messages.shell.nav[item.id]}
            type="button"
          >
            <item.icon aria-hidden="true" size={20} strokeWidth={2.8} />
          </button>
        ))}
      </nav>

      <aside className="slei-context-sidebar">
        <WindowControls initialCloseConfirmOpen={input.initialWindowCloseConfirmOpen} messages={messages} />
        <div className="slei-sidebar__header" data-tauri-drag-region="deep">
          <strong>{messages.shell.sidebarTitle[input.activeView]}</strong>
          <span>{messages.shell.sidebarSubtitle[input.activeView]}</span>
        </div>
        {input.activeView === "chat" || input.activeView === "search" ? (
          <ChannelList
            activeChannelId={input.activeConversationId ? undefined : activeChannel.id}
            activeConversationId={input.activeConversationId}
            data={input.data}
            initialCreateChannelModalOpen={input.initialCreateChannelModalOpen}
            onChannelCreate={input.onChannelCreate}
            onChannelDelete={input.onChannelDelete}
            onChannelSelect={input.onChannelSelect}
            onConversationSelect={input.onConversationSelect}
            onSearchToggle={input.onSearchToggle}
            searchOpen={input.activeView === "search"}
            messages={messages}
          />
        ) : input.activeView === "members" ? (
          <MembersNavigator
            activeMemberId={input.activeMemberId}
            data={input.data}
            messages={messages}
            onCreateAgentRequest={() => setAgentCreateOpen(true)}
            onSelect={input.onMemberSelect}
          />
        ) : input.activeView === "computers" ? (
          <ComputersNavigator
            activeNodeId={activeComputerId}
            messages={messages}
            nodes={input.runtimeSetup.nodes}
            onAdd={() => setComputerCreateOpen(true)}
            onDelete={input.onComputerDelete}
            onSelect={setActiveComputerId}
          />
        ) : input.activeView === "settings" ? (
          <SettingsNavigator activePanel={activeSettingsPanel} messages={messages} onSelect={setActiveSettingsPanel} />
        ) : <ContextPanel activeView={input.activeView} data={input.data} messages={messages} />}
      </aside>

      <button
        aria-label={messages.common.resizeSidebar}
        aria-orientation="vertical"
        className="slei-resize-handle"
        onPointerDown={input.onResizeStart}
        role="separator"
        type="button"
      />

      <main className="slei-workspace">{renderWorkspace(input.activeView, input.data, activeChannel, activeConversation, activeSessionId, input.runtimeSetup, profile, input.locale, messages, input.timeZone ?? defaultTimeZone, appearance, input.notifications ?? defaultNotifications, activeSettingsPanel, input.onProfileChange, input.onLocaleChange, input.onTimeZoneChange, input.onAppearanceChange, input.onNotificationsChange, input.onSendMessage, input.initialChatDraft, input.initialComposerAttachments, input.initialSearchFilters, input.onSearchResultSelect, activeComputerId, () => setComputerCreateOpen(true), input.onComputerRename, input.activeMemberId, input.activeTaskId, input.onTaskReply, input.onAgentUpdate, input.onMemberMessage, input.onOpenAgentPath, input.onConversationRuntimeReset, input.onConversationHistoryToggle, input.onConversationSessionSelect, input.onAttachmentUpload, input.sessionDrawerOpen ?? input.initialConversationHistoryOpen, input.sendingConversationIds ?? [], (draft, cardId) => {
        setAgentDraft(draft);
        setActiveCardId(cardId);
        setAgentCreateOpen(true);
      }, async (draft, cardId) => {
        await input.onChannelCreate?.({ name: String(draft.name ?? ""), projectName: typeof draft.projectName === "string" ? draft.projectName : undefined });
        if (cardId) await input.onInteractiveCardComplete?.(cardId);
      })}</main>

      {computerCreateOpen ? (
        <ComputerCreateModal
          messages={messages}
          onClose={() => setComputerCreateOpen(false)}
          onCreate={(name, osLabel) => {
            input.onComputerCreate?.(name, osLabel);
            setComputerCreateOpen(false);
          }}
        />
      ) : null}

      {agentCreateOpen ? (
        <AgentCreateModal
          draft={agentDraft}
          messages={messages}
          nodes={input.runtimeSetup.nodes}
          onClose={() => {
            setAgentCreateOpen(false);
            setAgentDraft(undefined);
            setActiveCardId(undefined);
          }}
          onCreate={async (request) => {
            await input.onAgentCreate?.(request);
            if (activeCardId) await input.onInteractiveCardComplete?.(activeCardId);
            setAgentCreateOpen(false);
            setAgentDraft(undefined);
            setActiveCardId(undefined);
          }}
        />
      ) : null}

      {!input.runtimeSetup.hasClaudeRuntimeReady ? (
        <RuntimeOnboardingModal
          loading={input.runtimeSetup.loading}
          messages={messages}
          nodes={input.runtimeSetup.nodes}
          onRefreshRuntime={input.onRefreshRuntime}
          onRenameLocalNode={input.onRenameLocalNode}
        />
      ) : null}

      {input.guideBootstrapping ? (
        <div className="slei-modal-backdrop" role="presentation">
          <section aria-live="polite" className="slei-dialog slei-guide-loading" role="status">
            <span className="slei-badge slei-badge--attention">{messages.chat.guide}</span>
            <h2>{messages.onboarding.creatingGuide}</h2>
          </section>
        </div>
      ) : null}
    </div>
  );
}

export type WindowAction = "close" | "minimize" | "toggleMaximize";

type DesktopWindowControlsHandle = {
  close: () => Promise<void>;
  minimize: () => Promise<void>;
  toggleMaximize: () => Promise<void>;
};

export function runWindowAction(input: { action: WindowAction; currentWindow?: DesktopWindowControlsHandle }) {
  if (!input.currentWindow) return;

  const operation =
    input.action === "close"
      ? input.currentWindow.close()
      : input.action === "minimize"
        ? input.currentWindow.minimize()
        : input.currentWindow.toggleMaximize();
  void operation.catch(() => undefined);
}

function WindowControls({ initialCloseConfirmOpen, messages }: { initialCloseConfirmOpen?: boolean; messages: DesktopMessages }) {
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(initialCloseConfirmOpen ?? false);

  function runTauriWindowAction(action: WindowAction) {
    if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) return;
    runWindowAction({
      action,
      currentWindow: getCurrentWindow(),
    });
  }

  return (
    <>
      <div className="slei-window-controls" data-tauri-drag-region="deep">
        <button
          aria-label={messages.common.minimizeWindow}
          className="slei-window-control slei-window-control--minimize"
          onClick={() => runTauriWindowAction("minimize")}
          title={messages.common.minimizeWindow}
          type="button"
        >
          <span aria-hidden="true" className="slei-window-control__glyph" />
        </button>
        <button
          aria-label={messages.common.maximizeWindow}
          className="slei-window-control slei-window-control--maximize"
          onClick={() => runTauriWindowAction("toggleMaximize")}
          title={messages.common.maximizeWindow}
          type="button"
        >
          <span aria-hidden="true" className="slei-window-control__glyph" />
        </button>
        <button
          aria-label={messages.common.closeWindow}
          className="slei-window-control slei-window-control--close"
          onClick={() => setCloseConfirmOpen(true)}
          title={messages.common.closeWindow}
          type="button"
        >
          <span aria-hidden="true" className="slei-window-control__glyph" />
        </button>
      </div>
      {closeConfirmOpen ? (
        <WindowCloseConfirmModal
          messages={messages}
          onCancel={() => setCloseConfirmOpen(false)}
          onConfirm={() => {
            setCloseConfirmOpen(false);
            runTauriWindowAction("close");
          }}
        />
      ) : null}
    </>
  );
}

function WindowCloseConfirmModal(input: { messages: DesktopMessages; onCancel: () => void; onConfirm: () => void }) {
  return (
    <div className="slei-modal-backdrop" role="presentation">
      <section aria-modal="true" className="slei-dialog slei-window-close-confirm" role="dialog">
        <header>
          <span className="slei-badge slei-badge--attention">{input.messages.common.closeWindow}</span>
          <h2>{input.messages.common.confirmCloseWindow}</h2>
        </header>
        <div className="slei-modal-actions">
          <button className="slei-button" onClick={input.onCancel} type="button">{input.messages.common.cancel}</button>
          <button className="slei-button slei-button--accent" onClick={input.onConfirm} type="button">{input.messages.common.closeWindow}</button>
        </div>
      </section>
    </div>
  );
}

function ChannelList(input: {
  activeChannelId?: string;
  activeConversationId?: string;
  data: SleiFixtures;
  initialCreateChannelModalOpen?: boolean;
  messages: DesktopMessages;
  searchOpen?: boolean;
  onChannelCreate?: (input: { name: string; projectName?: string }) => Promise<void> | void;
  onChannelDelete?: (channelId: string) => void;
  onChannelSelect?: (channelId: string) => void;
  onConversationSelect?: (conversationId: string) => void;
  onSearchToggle?: () => void;
}) {
  const [name, setName] = useState("");
  const [projectName, setProjectName] = useState("");
  const [createOpen, setCreateOpen] = useState(input.initialCreateChannelModalOpen ?? false);
  const directMessageConversations = input.data.conversations.filter((conversation) => conversation.kind === "dm");

  function submitChannel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    input.onChannelCreate?.({ name, projectName });
    setName("");
    setProjectName("");
    setCreateOpen(false);
  }

  return (
    <div className="slei-channel-list">
      <div className="slei-sidebar-tools">
        <button aria-pressed={input.searchOpen ? "true" : "false"} className="slei-sidebar-tool" onClick={input.onSearchToggle} type="button"><Search aria-hidden="true" size={14} /> {input.messages.common.search} <span>Command K</span></button>
        <button className="slei-sidebar-tool" type="button"><Bookmark aria-hidden="true" size={14} /> {input.messages.common.saved}</button>
      </div>
      <div className="slei-channel-group-header">
        <span>{input.messages.chat.channels} {input.data.channels.length}</span>
        <div><button aria-label={input.messages.chat.sortChannels} type="button"><ArrowUpDown aria-hidden="true" size={14} /></button><button aria-label={input.messages.chat.createChannel} onClick={() => setCreateOpen(true)} type="button"><Plus aria-hidden="true" size={14} /></button></div>
      </div>
      {input.data.channels.map((channel) => (
        <div className="slei-channel-row" key={channel.id}>
          <button
            aria-current={input.activeChannelId === channel.id ? "true" : undefined}
            className="slei-channel"
            onClick={() => input.onChannelSelect?.(channel.id)}
            type="button"
          >
            <span><Hash aria-hidden="true" size={14} />{stripChannelHash(channel.name)}</span>
            {channel.unread > 0 ? <b>{channel.unread}</b> : null}
            <small>{channel.projectName ? input.messages.chat.projectPrefix(channel.projectName) : channel.description}</small>
          </button>
          {channel.id !== "all" ? (
            <button aria-label={input.messages.chat.deleteChannel(stripChannelHash(channel.name))} className="slei-channel-delete" onClick={() => input.onChannelDelete?.(channel.id)} type="button"><Trash2 aria-hidden="true" size={14} /></button>
          ) : null}
        </div>
      ))}
      <div className="slei-channel-group-header"><span>{input.messages.chat.directMessages} {directMessageConversations.length}</span><div><button aria-label={input.messages.chat.sortDirectMessages} type="button"><ArrowUpDown aria-hidden="true" size={14} /></button></div></div>
      {directMessageConversations.map((conversation) => {
        const member = input.data.members.find((candidate) => candidate.id === conversation.agentId && candidate.type === "agent");
        if (!member) return null;
        const conversationId = conversation.id;
        return (
          <button
            aria-current={input.activeConversationId === conversationId ? "true" : undefined}
            className="slei-channel slei-channel--dm"
            key={conversation.id}
            onClick={() => input.onConversationSelect?.(conversationId)}
            type="button"
          >
            <span><MemberAvatar identity={member} />{member.name}</span>
            <small>{member.handle}</small>
          </button>
        );
      })}
      {createOpen ? (
        <div className="slei-modal-backdrop" role="presentation">
          <section aria-modal="true" className="slei-dialog slei-channel-modal" role="dialog">
            <header>
              <h2><Hash aria-hidden="true" size={20} />{input.messages.chat.createChannel}</h2>
              <p>{input.messages.chat.createChannelDescription}</p>
            </header>
            <form className="slei-channel-modal__form" onSubmit={submitChannel}>
              <label className="slei-field">
                <span>{input.messages.chat.channelName}</span>
                <input aria-label={input.messages.chat.channelName} className="slei-input" onChange={(event) => setName(event.currentTarget.value)} placeholder="dev-team" value={name} />
              </label>
              <label className="slei-field">
                <span>{input.messages.chat.project}</span>
                <input aria-label={input.messages.chat.project} className="slei-input" onChange={(event) => setProjectName(event.currentTarget.value)} placeholder="Slei Desktop" value={projectName} />
              </label>
              <div className="slei-modal-actions">
                <button className="slei-button" onClick={() => setCreateOpen(false)} type="button">{input.messages.common.cancel}</button>
                <button className="slei-button slei-button--accent" type="submit"><Plus aria-hidden="true" size={14} />{input.messages.common.create}</button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </div>
  );
}

function ContextPanel({ activeView, data, messages }: { activeView: AppView; data: SleiFixtures; messages: DesktopMessages }) {
  return (
    <div className="slei-context-stack">
      <div className="slei-section-label">{messages.shell.sectionLabel[activeView]}</div>
      <div className="slei-mini-card">
        <strong>{data.tasks.filter((task) => task.attention).length}</strong>
        <span>{messages.shell.attentionNeeded}</span>
      </div>
      <div className="slei-mini-card">
        <strong>{data.nodes.length}</strong>
        <span>{messages.shell.connectedComputers}</span>
      </div>
      <div className="slei-mini-card">
        <strong>{data.members.filter((member) => member.type === "agent").length}</strong>
        <span>{messages.shell.availableAgents}</span>
      </div>
    </div>
  );
}

const settingsMenu: Array<{
  title: "person" | "server" | "about";
  items: Array<{ id: SettingsPanel; labelKey: "account" | "languageRegion" | "appearance" | "notifications" | "about"; icon: LucideIcon }>;
}> = [
  {
    title: "person",
    items: [
      { id: "account", labelKey: "account", icon: CircleUserRound },
      { id: "language-region", labelKey: "languageRegion", icon: Globe2 },
      { id: "appearance", labelKey: "appearance", icon: Palette },
      { id: "notifications", labelKey: "notifications", icon: Bell },
    ],
  },
  {
    title: "server",
    items: [],
  },
  {
    title: "about",
    items: [{ id: "about", labelKey: "about", icon: Info }],
  },
];

function SettingsNavigator(input: {
  activePanel: SettingsPanel;
  messages: DesktopMessages;
  onSelect?: (panel: SettingsPanel) => void;
}) {
  return (
    <div className="slei-settings-nav" aria-label={input.messages.settings.title}>
      {settingsMenu.map((group) => (
        <div className="slei-settings-nav__group" key={group.title}>
          <div className="slei-settings-nav__label">{input.messages.settings.groups[group.title]}</div>
          {group.items.length === 0 ? (
            <p className="slei-settings-nav__empty"><Server aria-hidden="true" size={14} />{input.messages.settings.serverReserved}</p>
          ) : null}
          {group.items.map((item) => (
            <button
              aria-current={input.activePanel === item.id ? "page" : undefined}
              className="slei-settings-nav__item"
              key={item.id}
              onClick={() => input.onSelect?.(item.id)}
              type="button"
            >
              <item.icon aria-hidden="true" data-settings-icon={item.id} size={15} strokeWidth={2.8} />
              <span>{input.messages.settings[item.labelKey]}</span>
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

function MembersNavigator(input: {
  activeMemberId?: string;
  data: SleiFixtures;
  messages: DesktopMessages;
  onCreateAgentRequest?: () => void;
  onSelect?: (memberId: string) => void;
}) {
  const { data } = input;
  const agents = data.members.filter((member) => member.type === "agent");

  return (
    <div className="slei-members-navigator">
      <div className="slei-nav-group">
        <div className="slei-nav-group__header"><span>{input.messages.members.agents}</span><button aria-label={input.messages.members.newAgent} onClick={input.onCreateAgentRequest} type="button"><Plus aria-hidden="true" size={14} /></button></div>
        <small>macbookpro m4 max</small>
        {agents.length === 0 ? <p className="slei-empty-note">{input.messages.members.noAgents}</p> : null}
        {agents.map((member) => (
          <button aria-current={(input.activeMemberId ?? agents[0]?.id) === member.id ? "true" : undefined} className="slei-nav-member" key={member.id} onClick={() => input.onSelect?.(member.id)} type="button">
            <MemberAvatar identity={member} />
            <span>
              <strong>{member.name}</strong>
              <small>{member.role}</small>
            </span>
            <StatusDot status={member.runtimeStatus} />
          </button>
        ))}
      </div>
    </div>
  );
}

function ComputersNavigator(input: {
  activeNodeId: string;
  messages: DesktopMessages;
  nodes: DesktopNodeView[];
  onAdd?: () => void;
  onDelete?: (nodeId: string) => void;
  onSelect?: (nodeId: string) => void;
}) {
  return (
    <div className="slei-computers-list" aria-label={input.messages.shell.sidebarSubtitle.computers}>
      <div className="slei-computers-list__label">
        <span>{input.messages.computers.computers} {input.nodes.length}</span>
        <button aria-label={input.messages.computers.newComputer} onClick={input.onAdd} type="button"><Plus aria-hidden="true" size={14} /></button>
      </div>
      {input.nodes.map((node) => (
        <div className="slei-computer-list-item" key={node.id}>
          <button
            aria-current={input.activeNodeId === node.id ? "true" : undefined}
            className="slei-computer-list-button"
            onClick={() => input.onSelect?.(node.id)}
            type="button"
          >
            <span className="slei-computer-icon"><Monitor aria-hidden="true" size={16} /></span>
            <span>
              <strong>{node.name}</strong>
              <small>daemon {node.daemonVersion}</small>
            </span>
            <StatusDot status={node.status === "connected" ? "idle" : "offline"} />
          </button>
          {node.id !== "local-node" ? (
            <button aria-label={input.messages.computers.deleteComputer(node.name)} className="slei-computer-delete" onClick={() => input.onDelete?.(node.id)} type="button"><Trash2 aria-hidden="true" size={13} /></button>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function renderWorkspace(
  activeView: AppView,
  data: SleiFixtures,
  activeChannel: SleiFixtures["channels"][number],
  activeConversation: ConversationView | undefined,
  activeSessionId: string | undefined,
  runtimeSetup: RuntimeSetupState,
  profile: UserProfile,
  locale: AppLocale,
  messages: DesktopMessages,
  timeZone: string,
  appearance: AppearancePreferences,
  notifications: NotificationPreferences,
  activeSettingsPanel: SettingsPanel,
  onProfileChange?: (profile: UserProfile) => void,
  onLocaleChange?: (locale: AppLocale) => Promise<void> | void,
  onTimeZoneChange?: (timeZone: string) => Promise<void> | void,
  onAppearanceChange?: (appearance: AppearancePreferences) => Promise<void> | void,
  onNotificationsChange?: (notifications: NotificationPreferences) => Promise<void> | void,
  onSendMessage?: (body: string, options?: { asTask?: boolean; attachmentIds?: string[]; sessionId?: string }) => Promise<void> | void,
  initialChatDraft?: string,
  initialComposerAttachments?: ConversationAttachmentView[],
  initialSearchFilters?: ChatSearchFilters,
  onSearchResultSelect?: (channelId: string, messageId: string) => void,
  activeComputerId?: string,
  onComputerCreateRequest?: () => void,
  onComputerRename?: (nodeId: string, name: string) => void,
  activeMemberId?: string,
  activeTaskId?: string,
  onTaskReply?: (taskId: string, body: string) => void,
  onAgentUpdate?: (agentId: string, update: Partial<AgentDraftInput>) => Promise<void> | void,
  onMemberMessage?: (memberId: string) => void,
  onOpenAgentPath?: (agentId: string, target: AgentPathTarget) => Promise<void> | void,
  onConversationRuntimeReset?: (conversationId: string) => Promise<void> | void,
  onConversationHistoryToggle?: () => void,
  onConversationSessionSelect?: (conversationId: string, sessionId: string) => Promise<void> | void,
  onAttachmentUpload?: (request: ConversationAttachmentUploadRequest) => Promise<{ attachment: ConversationAttachmentView }>,
  sessionDrawerOpen?: boolean,
  sendingConversationIds: string[] = [],
  onAgentDraftCreate?: (draft: Partial<AgentDraftInput>, cardId?: string) => void,
  onChannelDraftCreate?: (draft: Record<string, unknown>, cardId?: string) => void,
) {
  if (activeView === "search") return <SearchPage data={data} initialFilters={initialSearchFilters} messages={messages} onResultSelect={onSearchResultSelect} />;
  if (activeView === "tasks") return <TasksPage activeTaskId={activeTaskId} data={data} messages={messages} onTaskReply={onTaskReply} />;
  if (activeView === "members") return <MembersPage activeMemberId={activeMemberId} data={data} messages={messages} nodes={runtimeSetup.nodes} onAgentUpdate={onAgentUpdate} onMessage={onMemberMessage} onOpenAgentPath={onOpenAgentPath} />;
  if (activeView === "computers") {
    return (
      <ComputersPage
        activeNodeId={activeComputerId}
        members={data.members}
        messages={messages}
        nodes={runtimeSetup.nodes}
        onComputerCreateRequest={onComputerCreateRequest}
        onComputerRename={onComputerRename}
      />
    );
  }
  if (activeView === "settings") {
    return (
      <SettingsPage
        activePanel={activeSettingsPanel}
        appearance={appearance}
        locale={locale}
        messages={messages}
        notifications={notifications}
        nodes={runtimeSetup.nodes}
        onAppearanceChange={onAppearanceChange}
        onLocaleChange={onLocaleChange}
        onNotificationsChange={onNotificationsChange}
        onProfileChange={onProfileChange}
        onTimeZoneChange={onTimeZoneChange}
        profile={profile}
        timeZone={timeZone}
      />
    );
  }
  return <ChatPage activeChannel={activeChannel} activeConversation={activeConversation} activeSessionId={activeSessionId} data={data} initialAttachments={initialComposerAttachments} initialDraft={initialChatDraft} messages={messages} onAgentDraftCreate={onAgentDraftCreate} onAttachmentUpload={onAttachmentUpload} onChannelDraftCreate={onChannelDraftCreate} onConversationHistoryToggle={onConversationHistoryToggle} onConversationRuntimeReset={onConversationRuntimeReset} onConversationSessionSelect={onConversationSessionSelect} onSendMessage={onSendMessage} profile={profile} sending={activeConversation ? sendingConversationIds.includes(activeConversation.id) : false} sessionDrawerOpen={sessionDrawerOpen} />;
}

function SearchPage({ data, initialFilters, messages, onResultSelect }: { data: SleiFixtures; initialFilters?: ChatSearchFilters; messages: DesktopMessages; onResultSelect?: (channelId: string, messageId: string) => void }) {
  const [filters, setFilters] = useState<ChatSearchFilters>(initialFilters ?? {});
  const results = filterConversationMessages(data.messages, filters);

  function channelName(channelId?: string) {
    return stripChannelHash(data.channels.find((channel) => channel.id === (channelId ?? "all"))?.name ?? channelId ?? "all");
  }

  return (
    <section className="slei-search-page">
      <header className="slei-workspace-header" data-tauri-drag-region="deep">
        <div>
          <h1><Search aria-hidden="true" size={22} />{messages.search.title}</h1>
          <p>{messages.search.description}</p>
        </div>
      </header>
      <section className="slei-search-panel" aria-label={messages.search.title}>
        <label><span>{messages.search.query}</span><input className="slei-input" defaultValue={filters.query ?? ""} onChange={(event) => setFilters((current) => ({ ...current, query: event.currentTarget.value }))} placeholder={messages.search.query} /></label>
        <label><span>{messages.search.user}</span><input className="slei-input" defaultValue={filters.user ?? ""} onChange={(event) => setFilters((current) => ({ ...current, user: event.currentTarget.value }))} placeholder="@Coda" /></label>
        <label><span>{messages.search.channel}</span><input className="slei-input" defaultValue={filters.channel ?? ""} onChange={(event) => setFilters((current) => ({ ...current, channel: event.currentTarget.value }))} placeholder="#all" /></label>
        <label><span>{messages.search.time}</span><input className="slei-input" defaultValue={filters.time ?? ""} onChange={(event) => setFilters((current) => ({ ...current, time: event.currentTarget.value }))} placeholder="10:15" /></label>
      </section>
      <div className="slei-search-results">
        {results.length === 0 ? (
          <Empty
            description={messages.search.noResultDescription}
            size="md"
            title={messages.search.noResultTitle}
            variant="noresult"
          />
        ) : null}
        {results.map((message) => (
          <button
            aria-label={messages.search.openConversation(message.id)}
            className="slei-search-result"
            key={message.id}
            onClick={() => onResultSelect?.(message.channelId ?? "all", message.id)}
            type="button"
          >
            <span><Hash aria-hidden="true" size={14} /># {channelName(message.channelId)}</span>
            <strong>{message.author}</strong>
            <small>{message.handle ? `${message.handle} · ` : ""}{message.time}</small>
            <p>{message.body}</p>
          </button>
        ))}
      </div>
    </section>
  );
}

function InteractiveCard({ card, messages, onCreate }: { card: InteractiveCardView; messages: DesktopMessages; onCreate?: () => void }) {
  const done = card.state === "done";
  return (
    <article className={`slei-agent-draft-card slei-interactive-card slei-interactive-card--${card.kind}`}>
      <div>
        <span className="slei-badge slei-badge--attention">{messages.chat.guide}</span>
        <h2>{card.title}</h2>
        <p>{card.summary}</p>
      </div>
      <button className="slei-button slei-button--accent" disabled={done} onClick={onCreate} type="button">
        {done ? card.doneLabel || messages.common.done : card.actionLabel || messages.common.create}
      </button>
    </article>
  );
}

function AttachmentList({ attachments, messageAttachments = false, onRemove }: { attachments: ConversationAttachmentView[]; messageAttachments?: boolean; onRemove?: (attachmentId: string) => void }) {
  if (attachments.length === 0) return null;
  return (
    <div className={messageAttachments ? "slei-message-attachments" : "slei-composer-attachments"}>
      {attachments.map((attachment) => {
        const isImage = attachment.mimeType.startsWith("image/");
        return (
          <span className="slei-attachment-chip" key={attachment.id}>
            {isImage && attachment.url ? <img alt="" className="slei-attachment-preview" src={attachment.url} /> : <FileText aria-hidden="true" size={14} />}
            <span>{attachment.name}</span>
            <small>{formatAttachmentSize(attachment.size)}</small>
            {onRemove ? (
              <button aria-label={`Remove ${attachment.name}`} onClick={() => onRemove(attachment.id)} type="button">
                <X aria-hidden="true" size={12} />
              </button>
            ) : null}
          </span>
        );
      })}
    </div>
  );
}

function formatAttachmentSize(size: number) {
  if (size < 1024) return `${size} B`;
  const kilobytes = size / 1024;
  if (kilobytes < 1024) return `${Math.round(kilobytes)} KB`;
  return `${(kilobytes / 1024).toFixed(1)} MB`;
}

async function uploadComposerFile(
  file: File,
  onAttachmentUpload?: (request: ConversationAttachmentUploadRequest) => Promise<{ attachment: ConversationAttachmentView }>,
): Promise<ConversationAttachmentView | null> {
  const bytesBase64 = await fileToBase64(file);
  if (onAttachmentUpload) {
    return (await onAttachmentUpload({ name: file.name, mimeType: file.type || "application/octet-stream", bytesBase64 })).attachment;
  }
  return {
    id: `local-${file.name}-${file.size}`,
    name: file.name,
    mimeType: file.type || "application/octet-stream",
    size: file.size,
    url: file.type.startsWith("image/") ? `data:${file.type};base64,${bytesBase64}` : undefined,
  };
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      const result = String(reader.result ?? "");
      resolve(result.includes(",") ? result.split(",").pop() ?? "" : result);
    });
    reader.addEventListener("error", () => reject(reader.error ?? new Error("file read failed")));
    reader.readAsDataURL(file);
  });
}

function ChatPage({ activeChannel, activeConversation, activeSessionId, data, initialAttachments, initialDraft, messages, onAgentDraftCreate, onAttachmentUpload, onChannelDraftCreate, onConversationHistoryToggle, onConversationRuntimeReset, onConversationSessionSelect, onSendMessage, profile, sending, sessionDrawerOpen }: { activeChannel: SleiFixtures["channels"][number]; activeConversation?: ConversationView; activeSessionId?: string; data: SleiFixtures; initialAttachments?: ConversationAttachmentView[]; initialDraft?: string; messages: DesktopMessages; onAgentDraftCreate?: (draft: Partial<AgentDraftInput>, cardId?: string) => void; onAttachmentUpload?: (request: ConversationAttachmentUploadRequest) => Promise<{ attachment: ConversationAttachmentView }>; onChannelDraftCreate?: (draft: Record<string, unknown>, cardId?: string) => void; onConversationHistoryToggle?: () => void; onConversationRuntimeReset?: (conversationId: string) => Promise<void> | void; onConversationSessionSelect?: (conversationId: string, sessionId: string) => Promise<void> | void; onSendMessage?: (body: string, options?: { asTask?: boolean; attachmentIds?: string[]; sessionId?: string }) => Promise<void> | void; profile: UserProfile; sending?: boolean; sessionDrawerOpen?: boolean }) {
  const [draft, setDraft] = useState(initialDraft ?? "");
  const [asTask, setAsTask] = useState(false);
  const [attachments, setAttachments] = useState<ConversationAttachmentView[]>(initialAttachments ?? []);
  const [isComposing, setIsComposing] = useState(false);
  const [selectedMentionIndex, setSelectedMentionIndex] = useState(0);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mention = activeMentionQuery(draft);
  const mentionTargets = mention ? mentionSuggestions(mention.query, data.members) : [];
  const dmMember = activeConversation?.kind === "dm" ? data.members.find((member) => member.id === activeConversation.agentId) : undefined;
  const activeTargetId = activeConversation?.id ?? activeChannel.id;
  const currentSessionId = activeSessionId ?? activeConversation?.activeSessionId;
  const visibleMessages = filterConversationMessages(data.messages, {
    channel: activeTargetId,
  }).filter((message) => !activeConversation || !currentSessionId || !message.sessionId || message.sessionId === currentSessionId);
  const activeSessions = activeConversation ? data.conversationSessions.filter((session) => session.conversationId === activeConversation.id) : [];
  const activeSession = activeSessions.find((session) => session.id === currentSessionId) ?? activeSessions[0];
  const detailTitle = dmMember ? activeSession?.title.trim() || messages.chat.newSession : `# ${stripChannelHash(activeChannel.name)}`;
  const sessionBusy = Boolean(activeConversation && visibleMessages.some((message) => message.status === "running" || message.status === "pending"));
  const sendDisabled = Boolean((!draft.trim() && attachments.length === 0) || sessionBusy || sending);

  function submitMessage() {
    if (sendDisabled) return;
    const attachmentIds = attachments.map((attachment) => attachment.id);
    onSendMessage?.(draft, { asTask, attachmentIds, sessionId: currentSessionId });
    setDraft("");
    setAttachments([]);
    setAsTask(false);
  }

  async function addFiles(fileList: FileList | null) {
    if (!fileList) return;
    const files = Array.from(fileList);
    const uploaded = await Promise.all(files.map((file) => uploadComposerFile(file, onAttachmentUpload)));
    setAttachments((current) => [...current, ...uploaded.filter((attachment): attachment is ConversationAttachmentView => Boolean(attachment))]);
  }

  function selectMention(index = selectedMentionIndex) {
    if (!mention || !mentionTargets[index]) return;
    setDraft(insertMention(draft, mention, mentionTargets[index].handle));
    setSelectedMentionIndex(0);
  }

  return (
    <section className="slei-chat-page">
      <header className="slei-workspace-header" data-tauri-drag-region="deep">
        <div>
          <h1>{dmMember ? <MessageCircle aria-hidden="true" size={22} /> : <Hash aria-hidden="true" size={22} />}{detailTitle}</h1>
          <p>{dmMember ? `${dmMember.handle} · ${messages.chat.directMessage}` : activeChannel.projectName ? messages.chat.projectPrefix(activeChannel.projectName) : activeChannel.description}</p>
        </div>
        {dmMember && activeConversation ? (
          <div className="slei-chat-header-actions">
            <button className="slei-button slei-button--small" onClick={() => onConversationRuntimeReset?.(activeConversation.id)} type="button">
              <RefreshCcw aria-hidden="true" size={14} />{messages.chat.resetSession}
            </button>
            <button className="slei-button slei-button--small" onClick={onConversationHistoryToggle} type="button">
              <History aria-hidden="true" size={14} />{messages.chat.history}
            </button>
          </div>
        ) : (
          <>
            <nav aria-label={messages.chat.channelView} className="slei-chat-tabs">
              <button aria-current="page" type="button"><MessageCircle aria-hidden="true" size={14} />{messages.shell.nav.chat}</button>
              <button type="button"><CheckSquare aria-hidden="true" size={14} />{messages.chat.tasks}</button>
              <button type="button"><FileText aria-hidden="true" size={14} />{messages.chat.files}</button>
            </nav>
            <span className="slei-badge slei-badge--ready">{messages.chat.runtimeDetected}</span>
          </>
        )}
      </header>
      {sessionDrawerOpen && activeConversation ? (
        <aside aria-label={messages.chat.history} className="slei-session-drawer">
          <header>
            <h2>{messages.chat.history}</h2>
            <button aria-label={messages.common.cancel} className="slei-icon-button" onClick={onConversationHistoryToggle} type="button"><X aria-hidden="true" size={14} /></button>
          </header>
          <div className="slei-session-list">
            {activeSessions.map((session) => (
              <button
                aria-current={session.id === currentSessionId ? "true" : undefined}
                className="slei-session-item"
                key={session.id}
                onClick={() => onConversationSessionSelect?.(activeConversation.id, session.id)}
                type="button"
              >
                <strong>{session.title || messages.chat.newSession}</strong>
                <small>{formatMessageTime(session.updatedAt)}</small>
              </button>
            ))}
          </div>
        </aside>
      ) : null}
      <div className="slei-timeline">
        {visibleMessages.map((message) => (
          <article className="slei-message" key={message.id}>
            <MemberAvatar identity={memberFromMessage(message, data.members)} />
            <div>
              <div className="slei-message__meta">
                <strong>{message.author}</strong>
                {message.handle ? <span>{message.handle}</span> : null}
                <span>{message.time}</span>
                <MessageStatusSquare status={message.status} />
              </div>
              <MarkdownMessage markdown={message.body} />
              <AttachmentList attachments={message.attachments ?? []} messageAttachments />
              {message.toolCall ? <code className="slei-tool-call">{message.toolCall}</code> : null}
              {message.cards?.map((card) => (
                <InteractiveCard
                  card={card}
                  key={card.id}
                  messages={messages}
                  onCreate={() => {
                    if (card.kind === "createAgent") {
                      onAgentDraftCreate?.(card.draft as Partial<AgentDraftInput>, card.id);
                    } else if (card.kind === "createChannel") {
                      onChannelDraftCreate?.(card.draft, card.id);
                    }
                  }}
                />
              ))}
            </div>
          </article>
        ))}
      </div>
      {mention && mentionTargets.length > 0 ? (
        <section aria-label={messages.chat.chooseMentionMember} className="slei-mention-panel">
          {mentionTargets.map((member, index) => (
            <button
              aria-current={index === selectedMentionIndex ? "true" : undefined}
              className="slei-mention-option"
              key={member.id}
              onClick={() => selectMention(index)}
              type="button"
            >
              <MemberAvatar identity={member} />
              <strong>{member.name}</strong>
              <StatusDot status={member.runtimeStatus} />
              <small>{member.role}</small>
              <span><AtSign aria-hidden="true" size={12} />{member.handle}</span>
            </button>
          ))}
          <button className="slei-back-bottom" type="button"><ArrowDown aria-hidden="true" size={14} />{messages.chat.backToBottom}</button>
        </section>
      ) : null}
      <form className="slei-composer" onSubmit={(event) => { event.preventDefault(); submitMessage(); }}>
        {attachments.length > 0 ? (
          <AttachmentList
            attachments={attachments}
            onRemove={(attachmentId) => setAttachments((current) => current.filter((attachment) => attachment.id !== attachmentId))}
          />
        ) : null}
        <textarea
          className="slei-textarea"
          onCompositionEnd={() => setIsComposing(false)}
          onCompositionStart={() => setIsComposing(true)}
          onChange={(event) => setDraft(event.currentTarget.value)}
          onKeyDown={(event) => {
            const composing = isComposerImeComposing({ composing: isComposing, nativeEvent: event.nativeEvent });
            const hasMentionTargets = Boolean(mention && mentionTargets.length > 0);
            if (!composing && mention && mentionTargets.length > 0) {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setSelectedMentionIndex((current) => moveMentionSelection(current, 1, mentionTargets.length));
                return;
              }
              if (event.key === "ArrowUp") {
                event.preventDefault();
                setSelectedMentionIndex((current) => moveMentionSelection(current, -1, mentionTargets.length));
                return;
              }
              if (event.key === "Escape") {
                event.preventDefault();
                setDraft(draft.slice(0, mention.start));
                return;
              }
            }
            const action = composerShortcutAction({ key: event.key, shiftKey: event.shiftKey, composing, hasMentionTargets });
            if (action === "selectMention") {
              event.preventDefault();
              selectMention();
              return;
            }
            if (action === "submit") {
              event.preventDefault();
              submitMessage();
            }
          }}
          placeholder={dmMember ? messages.chat.inputToMember(dmMember.name) : messages.chat.inputToChannel(stripChannelHash(activeChannel.name))}
          aria-label={dmMember ? messages.chat.inputToMember(dmMember.name) : messages.chat.inputToChannel(stripChannelHash(activeChannel.name))}
          value={draft}
        />
        <div className="slei-composer__actions">
          <CheckboxControl checked={asTask} className="slei-task-toggle" label={messages.chat.asTask} onChange={setAsTask} />
          <div className="slei-composer__tools">
            <input accept="image/*" hidden onChange={(event) => void addFiles(event.currentTarget.files)} ref={imageInputRef} type="file" />
            <input hidden onChange={(event) => void addFiles(event.currentTarget.files)} ref={fileInputRef} type="file" />
            <button aria-label={messages.common.addImage} className="slei-icon-button" onClick={() => imageInputRef.current?.click()} type="button"><ImageIcon aria-hidden="true" size={15} /></button>
            <button aria-label={messages.common.addAttachment} className="slei-icon-button" onClick={() => fileInputRef.current?.click()} type="button"><Paperclip aria-hidden="true" size={15} /></button>
          </div>
          <button className="slei-button slei-button--primary slei-send-button" data-testid="slei-send-button" disabled={sendDisabled} type="submit"><Send aria-hidden="true" size={15} />{messages.common.send}</button>
        </div>
      </form>
    </section>
  );
}

function TasksPage({ activeTaskId, data, messages, onTaskReply }: { activeTaskId?: string; data: SleiFixtures; messages: DesktopMessages; onTaskReply?: (taskId: string, body: string) => void }) {
  const columns: SleiTask["status"][] = ["todo", "in_progress", "in_review", "done"];
  const [selectedTaskId, setSelectedTaskId] = useState(activeTaskId);
  const [replyDraft, setReplyDraft] = useState("");
  const selectedTask = data.tasks.find((task) => task.id === selectedTaskId);

  function submitReply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = replyDraft.trim();
    if (!selectedTask || !body) return;
    onTaskReply?.(selectedTask.id, body);
    setReplyDraft("");
  }

  return (
    <section className="slei-tasks-page">
      <header className="slei-workspace-header" data-tauri-drag-region="deep">
        <div>
          <h1>{messages.tasks.title}</h1>
          <p>{messages.tasks.description}</p>
        </div>
        <div className="slei-segmented"><button type="button">{messages.tasks.board}</button><button type="button">{messages.tasks.list}</button></div>
      </header>
      <div className="slei-board">
        {columns.map((column) => (
          <div className="slei-column" key={column}>
            <h2>{taskStatusLabel(column, messages)}</h2>
            {data.tasks.filter((task) => task.status === column).map((task) => (
              <article className="slei-card slei-task-card" key={task.id}>
                <div className="slei-task-card__toolbar">
                  <span>{task.id}</span>
                  <button aria-label={messages.tasks.commentThread} className="slei-icon-button slei-task-comment-button" onClick={() => setSelectedTaskId(task.id)} type="button">
                    <MessageSquare aria-hidden="true" size={15} />
                    <span>{task.replies?.length ?? 0}</span>
                  </button>
                </div>
                <strong>{task.title}</strong>
                <small>{task.owner}</small>
                {task.attention ? <b className="slei-badge slei-badge--attention">{task.attention}</b> : null}
              </article>
            ))}
          </div>
        ))}
      </div>
      {selectedTask ? (
        <aside aria-label={messages.tasks.thread} className="slei-task-thread-drawer" style={{ "--task-thread-width": "680px" } as CSSProperties}>
          <header>
            <div>
              <span className="slei-badge">{taskStatusLabel(selectedTask.status, messages)}</span>
              <h2>{selectedTask.title}</h2>
              <p>{selectedTask.owner} · {(selectedTask.replies?.length ?? 0)} {messages.tasks.replies}</p>
            </div>
            <button aria-label={messages.tasks.closeThread} className="slei-icon-button" onClick={() => setSelectedTaskId(undefined)} type="button">
              <X aria-hidden="true" size={16} />
            </button>
          </header>
          <div className="slei-task-thread-replies">
            {(selectedTask.replies ?? []).map((reply) => (
              <article className={`slei-task-thread-reply slei-task-thread-reply--${reply.role ?? "human"}`} key={reply.id}>
                <strong>{reply.sender}</strong>
                <MarkdownMessage markdown={reply.body} />
              </article>
            ))}
          </div>
          <form className="slei-task-thread-composer" onSubmit={submitReply}>
            <textarea
              aria-label={messages.tasks.replyPlaceholder}
              className="slei-textarea"
              onChange={(event) => setReplyDraft(event.currentTarget.value)}
              placeholder={messages.tasks.replyPlaceholder}
              value={replyDraft}
            />
            <button className="slei-button slei-button--accent" type="submit"><Send aria-hidden="true" size={15} />{messages.tasks.sendReply}</button>
          </form>
        </aside>
      ) : null}
    </section>
  );
}

function MembersPage(input: {
  activeMemberId?: string;
  data: SleiFixtures;
  messages: DesktopMessages;
  nodes: DesktopNodeView[];
  onAgentUpdate?: (agentId: string, update: Partial<AgentDraftInput>) => Promise<void> | void;
  onMessage?: (memberId: string) => void;
  onOpenAgentPath?: (agentId: string, target: AgentPathTarget) => Promise<void> | void;
}) {
  const selectedMember = input.data.members.find((member) => member.id === input.activeMemberId) ?? input.data.members[0];
  const tabs = [input.messages.members.profile, input.messages.members.workspace];
  const selectedNode = input.nodes.find((node) => node.id === selectedMember?.nodeId);
  const [memberDetails, setMemberDetails] = useState({
    description: selectedMember?.description ?? "",
    model: selectedMember?.model ?? "",
    name: selectedMember?.name ?? "",
    runtime: selectedMember?.runtime ?? "",
  });
  const [workspaceOpenError, setWorkspaceOpenError] = useState<string | undefined>(undefined);

  useEffect(() => {
    setMemberDetails({
      description: selectedMember?.description ?? "",
      model: selectedMember?.model ?? "",
      name: selectedMember?.name ?? "",
      runtime: selectedMember?.runtime ?? "",
    });
  }, [selectedMember?.id]);

  function updateMemberDetail(key: keyof typeof memberDetails, value: string) {
    setMemberDetails((current) => ({ ...current, [key]: value }));
    const updateKey = key === "runtime" ? "runtimeKind" : key;
    if (selectedMember?.type === "agent") {
      input.onAgentUpdate?.(selectedMember.id, { [updateKey]: value });
    }
  }

  async function openAgentPath(target: AgentPathTarget) {
    if (!selectedMember || selectedMember.type !== "agent") return;
    setWorkspaceOpenError(undefined);
    try {
      await input.onOpenAgentPath?.(selectedMember.id, target);
    } catch {
      setWorkspaceOpenError(input.messages.members.openWorkspaceFailed);
    }
  }

  if (!selectedMember) {
    return (
      <section className="slei-members-page slei-detail-empty-page">
        <Empty
          centered
          description={input.messages.members.emptyDescription}
          size="lg"
          title={input.messages.members.emptyTitle}
          variant="nodata"
        />
      </section>
    );
  }

  return (
    <section className="slei-members-page">
      <header className="slei-member-topbar">
        <div className="slei-member-titleline">
          <MemberAvatar identity={selectedMember} />
          <div>
            <h1>{memberDetails.name}</h1>
            <p>{memberDetails.description}</p>
          </div>
        </div>
        <div>
          <button className="slei-button" onClick={() => input.onMessage?.(selectedMember.id)} type="button">{input.messages.members.message}</button>
        </div>
      </header>
      <nav className="slei-member-tabs" aria-label={input.messages.members.memberConfig}>
        {tabs.map((tab, index) => (
          <button aria-current={index === 0 ? "page" : undefined} key={tab} type="button">{tab}</button>
        ))}
      </nav>
      <div className="slei-members-layout">
        <article aria-label={input.messages.members.detail} className="slei-member-detail">
          <header className="slei-profile-hero">
            <MemberAvatar identity={selectedMember} large />
            <div>
              <h2>{memberDetails.name} <StatusDot status={selectedMember.runtimeStatus} /> <span>{input.messages.members.online}</span></h2>
              <p><StatusDot status={selectedMember.runtimeStatus} />{memberDetails.name} · {selectedMember.handle}</p>
            </div>
          </header>
          <EditableDetailField ariaLabel={input.messages.members.editDisplayName} label={input.messages.members.displayName} messages={input.messages} onSave={(value) => updateMemberDetail("name", value)} value={memberDetails.name} />
          <EditableDetailField ariaLabel={input.messages.members.editDescription} label={input.messages.members.description} messages={input.messages} multiline onSave={(value) => updateMemberDetail("description", value)} value={memberDetails.description} />
          <section className="slei-detail-section">
            <h3>{input.messages.members.info}</h3>
            <dl>
              <div><dt>{input.messages.members.computer}</dt><dd>{selectedNode?.name ?? selectedMember.computer} <StatusDot status={selectedNode?.status === "offline" ? "offline" : "idle"} /> {selectedNode?.status ?? "connected"} · daemon {selectedNode?.daemonVersion ?? "v0.54.1"}</dd></div>
              <div><dt>{input.messages.members.created}</dt><dd>{formatMemberCreatedDate(selectedMember.created)}</dd></div>
              <div><dt>{input.messages.members.creator}</dt><dd>{selectedMember.creator}</dd></div>
            </dl>
          </section>
          <section className="slei-detail-section slei-runtime-config-section">
            <h3>{input.messages.members.runtimeConfig}</h3>
            <div className="slei-config-pills">
              <EditableDetailField ariaLabel={input.messages.members.editRuntime} label="Runtime" messages={input.messages} onSave={(value) => updateMemberDetail("runtime", value)} readClassName="slei-badge slei-badge--ready" sectionClassName="slei-config-editable" value={memberDetails.runtime} />
              <EditableDetailField ariaLabel={input.messages.members.editModel} label={input.messages.members.model} messages={input.messages} onSave={(value) => updateMemberDetail("model", value)} readClassName="slei-badge" sectionClassName="slei-config-editable" value={memberDetails.model} />
            </div>
          </section>
          <section className="slei-detail-section">
            <h3>{input.messages.members.workspace}</h3>
            <dl>
              <WorkspacePathRow
                icon={FolderOpen}
                label={input.messages.members.workspacePath}
                onOpen={() => openAgentPath("workspace")}
                path={selectedMember.workspacePath ?? "~/.slei/agents/" + selectedMember.id}
              />
              <WorkspacePathRow
                icon={FileText}
                label={input.messages.members.memoryFile}
                onOpen={() => openAgentPath("memory")}
                path={selectedMember.memoryPath ?? "~/.slei/agents/" + selectedMember.id + "/MEMORY.md"}
              />
              <WorkspacePathRow
                icon={FolderOpen}
                label={input.messages.members.docsFolder}
                onOpen={() => openAgentPath("docs")}
                path={selectedMember.docsPath ?? "~/.slei/agents/" + selectedMember.id + "/docs"}
              />
            </dl>
            {workspaceOpenError ? <p className="slei-inline-error">{workspaceOpenError}</p> : null}
            <p>{input.messages.members.defaultSkill(selectedMember.handle.replace(/^@/, ""))}</p>
          </section>
          <section className="slei-detail-section">
            <h3>{input.messages.members.skills}</h3>
            {selectedMember.skills?.length ? (
              <div className="slei-skill-grid">
                {selectedMember.skills.map((skill) => (
                  <article className="slei-skill-card" key={skill.id}>
                    <strong>{skill.name}</strong>
                    <p>{skill.trigger}</p>
                  </article>
                ))}
              </div>
            ) : (
              <Empty
                description={input.messages.members.noSkillsDescription}
                size="sm"
                title={input.messages.members.noSkills}
                variant="nodata"
              />
            )}
          </section>
        </article>
      </div>
    </section>
  );
}

function WorkspacePathRow(input: {
  icon: LucideIcon;
  label: string;
  onOpen: () => void;
  path: string;
}) {
  return (
    <div>
      <dt>{input.label}</dt>
      <dd>
        <button className="slei-workspace-link" onClick={input.onOpen} type="button">
          <input.icon aria-hidden="true" size={15} />
          <span>{input.path}</span>
          <ExternalLink aria-hidden="true" size={14} />
        </button>
      </dd>
    </div>
  );
}

function ComputersPage(input: {
  activeNodeId?: string;
  members: SleiMember[];
  messages: DesktopMessages;
  nodes: DesktopNodeView[];
  onComputerCreateRequest?: () => void;
  onComputerRename?: (nodeId: string, name: string) => void;
}) {
  const firstNode = input.nodes[0];
  const selectedNode = input.nodes.find((node) => node.id === input.activeNodeId) ?? firstNode;
  if (!selectedNode) {
    return (
      <section className="slei-computers-page slei-detail-empty-page">
        <Empty
          centered
          description={input.messages.computers.emptyDescription}
          size="lg"
          title={input.messages.computers.emptyTitle}
          variant="nodata"
        />
      </section>
    );
  }

  const hostedAgents = agentsForComputerNode(selectedNode, input.members);

  return (
    <section className="slei-computers-page">
      <article className="slei-computer-detail" aria-label={input.messages.computers.computer}>
        <header className="slei-computer-detail__top">
          <span className="slei-computer-icon slei-computer-icon--large"><Monitor aria-hidden="true" size={24} /></span>
          <div>
            <h1>{selectedNode.name}</h1>
            <p><StatusDot status={selectedNode.status === "connected" ? "idle" : "offline"} /> {selectedNode.status === "connected" ? input.messages.computers.connected : input.messages.computers.offline}</p>
            <small>{selectedNode.device.hostname}</small>
          </div>
        </header>

        <EditableDetailField
          ariaLabel={input.messages.computers.editDeviceName}
          label="NAME"
          messages={input.messages}
          onSave={(value) => input.onComputerRename?.(selectedNode.id, value)}
          sectionClassName="slei-computer-section"
          titleTag="h2"
          value={selectedNode.name}
        />

        <section className="slei-computer-section">
          <h2>{input.messages.computers.info}</h2>
          <dl className="slei-computer-info">
            <div><dt>{input.messages.computers.os}</dt><dd>{deviceOsLabel(selectedNode.device)}</dd></div>
            <div><dt>{input.messages.computers.hostname}</dt><dd>{selectedNode.device.hostname}</dd></div>
            <div><dt>{input.messages.computers.daemonVersion}</dt><dd><strong>{selectedNode.daemonVersion}</strong></dd></div>
            <div><dt>{input.messages.computers.created}</dt><dd>{selectedNode.created ?? "May 26, 2026"}</dd></div>
          </dl>
          <div className="slei-computer-runtimes">
            <h3>{input.messages.computers.detectedRuntimes}</h3>
            <div>
              {selectedNode.runtimes.map((runtime) => (
                <span className={`slei-runtime-pill slei-runtime-pill--${runtime.readiness}`} key={runtime.kind}>
                  {runtime.kind}{runtime.version ? ` ${runtime.version}` : runtime.readiness === "ready" ? "" : ` (${input.messages.computers.offline})`}
                </span>
              ))}
            </div>
          </div>
        </section>

        <section className="slei-computer-section slei-computer-agents">
          <div className="slei-computer-section__toolbar">
            <h2>{input.messages.computers.agentsOnThisComputer} <span>{hostedAgents.length}</span></h2>
          </div>
          <div className="slei-computer-agent-list">
            {hostedAgents.length ? hostedAgents.map((member) => (
              <div className="slei-computer-agent-row" key={member.id}>
                <MemberAvatar identity={member} />
                <strong>{member.name}</strong>
                <small>{member.runtime}</small>
                <span><StatusDot status={member.runtimeStatus} /> {runtimeStatusLabel(member.runtimeStatus, input.messages)}</span>
              </div>
            )) : <p>{input.messages.computers.noAgents}</p>}
          </div>
        </section>
      </article>

    </section>
  );
}

function ComputerCreateModal(input: {
  messages: DesktopMessages;
  onClose: () => void;
  onCreate?: (name: string, osLabel: string) => void;
}) {
  const [newName, setNewName] = useState("");
  const [newOs, setNewOs] = useState("");

  function submitCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!newName.trim()) return;
    input.onCreate?.(newName, newOs);
  }

  return (
    <div className="slei-modal-backdrop" role="presentation">
      <section aria-modal="true" className="slei-dialog slei-computer-modal" role="dialog">
        <header>
          <span className="slei-badge slei-badge--attention">{input.messages.computers.computer}</span>
          <h2><Monitor aria-hidden="true" size={20} />{input.messages.computers.newComputer}</h2>
        </header>
        <form className="slei-channel-modal__form" onSubmit={submitCreate}>
          <label className="slei-field">
            <span>{input.messages.computers.deviceName}</span>
            <input aria-label={input.messages.computers.deviceName} className="slei-input" onChange={(event) => setNewName(event.currentTarget.value)} placeholder="Design Mac" value={newName} />
          </label>
          <label className="slei-field">
            <span>{input.messages.computers.os}</span>
            <input aria-label={input.messages.computers.os} className="slei-input" onChange={(event) => setNewOs(event.currentTarget.value)} placeholder="darwin arm64" value={newOs} />
          </label>
          <div className="slei-modal-actions">
            <button className="slei-button" onClick={input.onClose} type="button">{input.messages.common.cancel}</button>
            <button className="slei-button slei-button--accent" type="submit"><Plus aria-hidden="true" size={14} />{input.messages.common.create}</button>
          </div>
        </form>
      </section>
    </div>
  );
}

function SettingsPage(input: {
  activePanel: SettingsPanel;
  appearance: AppearancePreferences;
  locale: AppLocale;
  messages: DesktopMessages;
  notifications: NotificationPreferences;
  nodes: DesktopNodeView[];
  onAppearanceChange?: (appearance: AppearancePreferences) => Promise<void> | void;
  onLocaleChange?: (locale: AppLocale) => Promise<void> | void;
  onNotificationsChange?: (notifications: NotificationPreferences) => Promise<void> | void;
  onProfileChange?: (profile: UserProfile) => void;
  onTimeZoneChange?: (timeZone: string) => Promise<void> | void;
  profile: UserProfile;
  timeZone: string;
}) {
  const { appearance, locale, notifications, profile } = input;
  const labels = input.messages.settings;

  function updateProfile(patch: Partial<UserProfile>) {
    input.onProfileChange?.({ ...profile, ...patch });
  }

  function updateNotification(field: keyof NotificationPreferences, value: boolean) {
    input.onNotificationsChange?.({
      ...notifications,
      [field]: value,
    });
  }

  function updateAppearance(patch: Partial<AppearancePreferences>) {
    input.onAppearanceChange?.({
      ...appearance,
      ...patch,
    });
  }

  return (
    <section className="slei-settings-page" data-settings-panel={input.activePanel}>
      <header className="slei-workspace-header" data-tauri-drag-region="deep">
        <div>
          <h1>{labels.panelTitle[input.activePanel]}</h1>
          <p>{labels.panelSubtitle[input.activePanel]}</p>
        </div>
      </header>
      <div className="slei-settings-stack">
        {input.activePanel === "account" ? (
        <section className="slei-settings-section">
          <h2>{labels.profile}</h2>
          <div className="slei-settings-fields">
            <label className="slei-field"><span>{labels.displayName}</span><input className="slei-input" onChange={(event) => updateProfile({ displayName: event.currentTarget.value })} value={profile.displayName} /></label>
            <label className="slei-field"><span>@</span><input className="slei-input" onChange={(event) => updateProfile({ handle: event.currentTarget.value })} value={profile.handle} /></label>
          </div>
          <section aria-label={labels.avatarPresets} className="slei-profile-avatar-presets">
            <div>
              <h3>{labels.avatar}</h3>
              <p>{labels.avatarHint}</p>
            </div>
            <div className="slei-avatar-preset-list">
              {profileAvatarPresets.map((preset) => (
                <button
                  aria-label={preset.name}
                  aria-pressed={profile.avatar === preset.id ? "true" : "false"}
                  className="slei-avatar-preset"
                  key={preset.id}
                  onClick={() => updateProfile({ avatar: preset.id })}
                  type="button"
                >
                  <MemberAvatar
                    identity={{
                      id: preset.id,
                      name: preset.name,
                      handle: `@${preset.id}`,
                      avatar: preset.name.slice(0, 2),
                      avatarSeed: preset.id,
                    }}
                  />
                  <span>{preset.name}</span>
                </button>
              ))}
            </div>
          </section>
        </section>
        ) : null}
        {input.activePanel === "language-region" ? (
        <section className="slei-settings-section">
          <h2>{labels.languageRegion}</h2>
          <div className="slei-settings-fields">
            <label className="slei-field slei-language-field">
              <span>{labels.language}</span>
              <SelectControl
                ariaLabel={labels.language}
                className="slei-input slei-language-select"
                onChange={(value) => input.onLocaleChange?.(value)}
                options={[
                  { label: labels.languageNames["zh-CN"], value: "zh-CN" },
                  { label: labels.languageNames["en-US"], value: "en-US" },
                ]}
                value={locale}
              />
            </label>
            <label className="slei-field slei-language-field">
              <span>{labels.timeZone}</span>
              <SelectControl
                ariaLabel={labels.timeZone}
                className="slei-input slei-timezone-select"
                onChange={(value) => input.onTimeZoneChange?.(value)}
                options={timeZoneOptions}
                value={input.timeZone}
              />
            </label>
          </div>
        </section>
        ) : null}
        {input.activePanel === "appearance" ? (
        <section className="slei-settings-section">
          <h2>{labels.appearance}</h2>
          <div className="slei-settings-fields">
            <label className="slei-field slei-language-field">
              <span>{labels.theme}</span>
              <SelectControl
                ariaLabel={labels.theme}
                className="slei-input slei-theme-select"
                onChange={(value) => updateAppearance({ theme: value })}
                options={[
                  { label: labels.themeSystem, value: "system" },
                  { label: labels.themeLight, value: "light" },
                  { label: labels.themeDark, value: "dark" },
                  { label: labels.themeHighContrast, value: "highContrast" },
                ]}
                value={appearance.theme}
              />
            </label>
            <div className="slei-field">
              <span>{labels.fontSize}</span>
              <div className="slei-segmented-control" role="group" aria-label={labels.fontSize}>
                {(["sm", "md", "lg"] as const).map((size) => (
                  <button
                    aria-pressed={appearance.fontSize === size ? "true" : "false"}
                    className="slei-segmented-control__button"
                    key={size}
                    onClick={() => updateAppearance({ fontSize: size })}
                    type="button"
                  >
                    {labels.fontSizes[size]}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>
        ) : null}
        {input.activePanel === "notifications" ? (
        <section className="slei-settings-section">
          <h2>{labels.notifications}</h2>
          <div className="slei-settings-toggle-list">
            <CheckboxControl
              checked={notifications.mentions}
              className="slei-notification-toggle"
              label={labels.mentionNotifications}
              onChange={(checked) => updateNotification("mentions", checked)}
            />
            <CheckboxControl
              checked={notifications.humanReplies}
              className="slei-notification-toggle"
              label={labels.humanReplyNotifications}
              onChange={(checked) => updateNotification("humanReplies", checked)}
            />
            <CheckboxControl
              checked={notifications.approvals}
              className="slei-notification-toggle"
              label={labels.approvalNotifications}
              onChange={(checked) => updateNotification("approvals", checked)}
            />
          </div>
        </section>
        ) : null}
        {input.activePanel === "about" ? (
        <section className="slei-settings-section">
          <h2>{labels.about}</h2>
          <div className="slei-about-list">
            <div><span>{labels.desktopVersion}</span><strong>{desktopVersion}</strong></div>
            <div><span>{labels.daemonVersion}</span><strong>{input.nodes[0]?.daemonVersion ?? "unknown"}</strong></div>
            <div><span>{labels.connectedComputers}</span><strong>{input.nodes.length}</strong></div>
          </div>
        </section>
        ) : null}
      </div>
    </section>
  );
}

const timeZoneOptions = [
  { value: "Asia/Shanghai", label: "Asia/Shanghai" },
  { value: "America/Los_Angeles", label: "America/Los_Angeles" },
  { value: "America/New_York", label: "America/New_York" },
  { value: "Europe/London", label: "Europe/London" },
  { value: "UTC", label: "UTC" },
];

function fontSizeValue(size: AppearancePreferences["fontSize"]) {
  return {
    sm: "14px",
    md: "15px",
    lg: "16px",
  }[size];
}

function StatusDot({ status }: { status: "idle" | "busy" | "offline" }) {
  return <span aria-label={status} className={`slei-status-dot slei-status-dot--${status}`} role="img" />;
}

function taskStatusLabel(status: SleiTask["status"], messages: DesktopMessages) {
  return messages.tasks.status[status];
}

function runtimeStatusLabel(status: "idle" | "busy" | "offline", messages: DesktopMessages) {
  return messages.status.runtime[status];
}

export function EditableDetailField(input: {
  ariaLabel: string;
  inputAriaLabel?: string;
  initialEditing?: boolean;
  label: string;
  messages?: DesktopMessages;
  multiline?: boolean;
  onSave?: (value: string) => void;
  readClassName?: string;
  sectionClassName?: string;
  titleTag?: "h2" | "h3";
  value: string;
}) {
  const [editing, setEditing] = useState(input.initialEditing ?? false);
  const [draft, setDraft] = useState(input.value);
  const messages = input.messages ?? createDesktopMessages("zh-CN");
  const Heading = input.titleTag ?? "h3";

  useEffect(() => {
    if (editing) return;
    setDraft(input.value);
  }, [editing, input.value]);

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextValue = draft.trim();
    if (!nextValue) return;
    input.onSave?.(nextValue);
    setEditing(false);
  }

  function cancel() {
    setDraft(input.value);
    setEditing(false);
  }

  return (
    <section className={`${input.sectionClassName ?? "slei-detail-section"} slei-editable-field`}>
      <div className="slei-editable-field__label">
        <Heading>{input.label}</Heading>
        {!editing ? (
          <button aria-label={input.ariaLabel} className="slei-editable-field__edit" onClick={() => setEditing(true)} type="button">
            <Pencil aria-hidden="true" size={14} />
          </button>
        ) : null}
      </div>
      {editing ? (
        <form className="slei-editable-field__editor" onSubmit={save}>
          {input.multiline ? (
            <textarea
              aria-label={input.inputAriaLabel ?? `${input.label}${messages.common.input}`}
              className="slei-textarea"
              onChange={(event) => setDraft(event.currentTarget.value)}
              value={draft}
            />
          ) : (
            <input
              aria-label={input.inputAriaLabel ?? `${input.label}${messages.common.input}`}
              className="slei-input"
              onChange={(event) => setDraft(event.currentTarget.value)}
              value={draft}
            />
          )}
          <div className="slei-editable-field__actions">
            <button className="slei-button slei-button--small slei-button--accent" type="submit">{messages.common.save}</button>
            <button className="slei-button slei-button--small" onClick={cancel} type="button">{messages.common.cancel}</button>
          </div>
        </form>
      ) : (
        <p className={input.readClassName}>{input.value}</p>
      )}
    </section>
  );
}

function AgentCreateModal(input: {
  draft?: Partial<AgentDraftInput>;
  messages: DesktopMessages;
  nodes: DesktopNodeView[];
  onClose: () => void;
  onCreate?: (request: AgentDraftInput) => void;
}) {
  const firstNode = input.nodes[0];
  const firstRuntime = firstNode?.runtimes.find((runtime) => runtime.readiness === "ready") ?? firstNode?.runtimes[0];
  const [name, setName] = useState(input.draft?.name ?? "");
  const [handle, setHandle] = useState(input.draft?.handle ?? "");
  const [runtimeKind, setRuntimeKind] = useState(input.draft?.runtimeKind ?? firstRuntime?.kind ?? "ClaudeCode");
  const [model, setModel] = useState(input.draft?.model ?? "Sonnet");
  const [nodeId, setNodeId] = useState(input.draft?.nodeId ?? firstNode?.id ?? "local-node");
  const [description, setDescription] = useState(input.draft?.description ?? "");

  function submitCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) return;
    input.onCreate?.({
      name: trimmedName,
      handle: normalizeHandleInput(handle || trimmedName),
      runtimeKind,
      model,
      nodeId,
      description: description.trim() || input.messages.agentCreate.defaultDescription(trimmedName),
    });
  }

  return (
    <div className="slei-modal-backdrop" role="presentation">
      <section aria-modal="true" className="slei-dialog slei-agent-modal" role="dialog">
        <header>
          <span className="slei-badge slei-badge--ready">{input.messages.agentCreate.fallbackAgent}</span>
          <h2><AtSign aria-hidden="true" size={20} />{input.messages.agentCreate.title}</h2>
        </header>
        <form className="slei-channel-modal__form" onSubmit={submitCreate}>
          <label className="slei-field">
            <span>Runtime</span>
            <SelectControl
              ariaLabel="Runtime"
              className="slei-input slei-agent-runtime-select"
              onChange={setRuntimeKind}
              options={input.nodes
                .flatMap((node) => node.runtimes.map((runtime) => runtime.kind))
                .filter((kind, index, all) => all.indexOf(kind) === index)
                .map((kind) => ({ label: kind, value: kind }))}
              value={runtimeKind}
            />
          </label>
          <label className="slei-field">
            <span>{input.messages.agentCreate.name}</span>
            <input className="slei-input" onChange={(event) => {
              setName(event.currentTarget.value);
              if (!handle.trim()) setHandle(normalizeHandleInput(event.currentTarget.value));
            }} value={name} />
          </label>
          <label className="slei-field">
            <span>{input.messages.agentCreate.handle}</span>
            <input className="slei-input" onChange={(event) => setHandle(event.currentTarget.value)} value={handle} />
          </label>
          <label className="slei-field">
            <span>{input.messages.agentCreate.associatedDevice}</span>
            <SelectControl
              ariaLabel={input.messages.agentCreate.associatedDevice}
              className="slei-input slei-agent-node-select"
              onChange={setNodeId}
              options={input.nodes.map((node) => ({ label: node.name, value: node.id }))}
              value={nodeId}
            />
          </label>
          <label className="slei-field">
            <span>{input.messages.agentCreate.model}</span>
            <input className="slei-input" onChange={(event) => setModel(event.currentTarget.value)} value={model} />
          </label>
          <label className="slei-field">
            <span>{input.messages.agentCreate.description}</span>
            <textarea className="slei-textarea" onChange={(event) => setDescription(event.currentTarget.value)} value={description} />
          </label>
          <div className="slei-modal-actions">
            <button className="slei-button slei-button--small" onClick={input.onClose} type="button">{input.messages.common.cancel}</button>
            <button className="slei-button slei-button--small slei-button--accent" type="submit">{input.messages.common.create}</button>
          </div>
        </form>
      </section>
    </div>
  );
}

function normalizeHandleInput(value: string) {
  const handle = value.trim().replace(/^@/, "").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  return `@${handle || "agent"}`;
}

function RuntimeOnboardingModal(input: {
  loading: boolean;
  messages: DesktopMessages;
  nodes: DesktopNodeView[];
  onRenameLocalNode?: (name: string) => Promise<void> | void;
  onRefreshRuntime?: () => Promise<void> | void;
}) {
  const localNode = input.nodes.find((node) => node.id === "local-node") ?? input.nodes[0];
  const [name, setName] = useState(localNode?.name ?? input.messages.computers.deviceName);

  return (
    <div className="slei-modal-backdrop" role="presentation">
      <section aria-modal="true" className="slei-dialog slei-runtime-modal" role="dialog">
        <div>
          <span className="slei-badge slei-badge--attention">{input.messages.onboarding.runtimeSetup}</span>
          <h2>{input.messages.onboarding.title}</h2>
          <p>{input.messages.onboarding.description}</p>
        </div>
        <label className="slei-field">
          <span>{input.messages.onboarding.deviceName}</span>
          <input className="slei-input" value={name} onChange={(event) => setName(event.currentTarget.value)} />
        </label>
        <div className="slei-runtime-list">
          {(localNode?.runtimes ?? []).map((runtime) => (
            <div className="slei-runtime-row" key={runtime.kind}>
              <span>{runtime.kind}</span>
              <b className={`slei-badge slei-badge--${runtime.readiness}`}>{runtime.version ?? runtime.readiness}</b>
            </div>
          ))}
        </div>
        {localNode ? (
          <dl className="slei-device-meta">
            <div><dt>{input.messages.onboarding.os}</dt><dd>{deviceOsLabel(localNode.device)}</dd></div>
            <div><dt>{input.messages.onboarding.hostname}</dt><dd>{localNode.device.hostname}</dd></div>
          </dl>
        ) : null}
        <div className="slei-modal-actions">
          <button className="slei-button" onClick={() => input.onRenameLocalNode?.(name)} type="button">{input.messages.onboarding.saveDeviceName}</button>
          <button className="slei-button slei-button--accent" disabled={input.loading} onClick={() => input.onRefreshRuntime?.()} type="button">{input.messages.onboarding.refreshRuntime}</button>
        </div>
      </section>
    </div>
  );
}
