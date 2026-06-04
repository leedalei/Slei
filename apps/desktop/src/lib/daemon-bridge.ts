import { invoke } from "@tauri-apps/api/core";
import type {
  ChannelCreateRequest as ProtocolChannelCreateRequest,
  ChannelMemberReadiness as ProtocolChannelMemberReadiness,
  ChannelMemberView as ProtocolChannelMemberView,
  SendChannelMessageOutcome as ProtocolSendChannelMessageOutcome,
  SendChannelMessageReceipt as ProtocolSendChannelMessageReceipt,
  SendChannelMessageRequest as ProtocolSendChannelMessageRequest,
} from "@slei/protocol-client";

export type SanitizedDaemonStatus = {
  connected: boolean;
  label: string;
  daemonVersion: string;
  protocolVersion: string;
};

export type RuntimeReadinessView = {
  kind: "ClaudeCode" | string;
  readiness: "ready" | "unknown" | "unavailable" | "error";
  version?: string;
};

export type DeviceMetaView = {
  platform: string;
  arch: string;
  hostname: string;
};

export type DesktopNodeView = {
  id: string;
  name: string;
  status: "connected" | "offline";
  daemonVersion: string;
  created?: string;
  device: DeviceMetaView;
  runtimes: RuntimeReadinessView[];
};

export type NodeListReceipt = {
  nodes: DesktopNodeView[];
};

export type NodeRenameReceipt = {
  node: DesktopNodeView;
};

export type AppLocale = "zh-CN" | "en-US";

export type NotificationPreferences = {
  mentions: boolean;
  humanReplies: boolean;
  approvals: boolean;
};

export type AppearancePreferences = {
  theme: "system" | "light" | "dark" | "highContrast";
  fontSize: "sm" | "md" | "lg";
};

export type UserPreferences = {
  locale: AppLocale;
  timeZone: string;
  appearance: AppearancePreferences;
  notifications: NotificationPreferences;
};

export type PreferencesReceipt = {
  preferences: UserPreferences;
};

export type PreferencesUpdateRequest = {
  locale?: AppLocale;
  timeZone?: string;
  appearance?: AppearancePreferences;
  notifications?: NotificationPreferences;
};

export type DesktopAgentView = {
  id: string;
  name: string;
  handle: string;
  agentKind?: "agent" | "guide" | string;
  systemOwned?: boolean;
  runtimeKind: string;
  model: string;
  nodeId: string;
  description: string;
  workspacePath: string;
  memoryPath: string;
  docsPath: string;
  avatarSeed: string;
  runtimeThread?: RuntimeThreadView;
  skills?: SkillView[];
  channelIds?: string[];
  createdAt: string;
  updatedAt: string;
};

export type RuntimeThreadView = {
  runtimeKind: string;
  status: "ready" | "pending" | "error" | string;
  createdAt: string;
};

export type SkillView = {
  id: string;
  name: string;
  trigger: string;
  path: string;
};

export type AgentCreateRequest = {
  name: string;
  handle: string;
  runtimeKind: string;
  model: string;
  nodeId: string;
  description: string;
};

export type AgentUpdateRequest = Partial<Pick<AgentCreateRequest, "name" | "runtimeKind" | "model" | "nodeId" | "description">>;

export type AgentListReceipt = {
  agents: DesktopAgentView[];
};

export type AgentReceipt = {
  agent: DesktopAgentView;
};

export type SkillListReceipt = {
  skills: SkillView[];
};

export type AgentPathTarget = "workspace" | "memory" | "docs";

export type AgentPathOpenReceipt = {
  agentId: string;
  target: AgentPathTarget | string;
};

export type ConversationView = {
  id: string;
  kind: "dm" | string;
  agentId: string;
  activeSessionId?: string;
  runtimeSession?: RuntimeSessionView;
  createdAt: string;
  updatedAt: string;
};

export type ConversationSessionView = {
  id: string;
  conversationId: string;
  title: string;
  status: "pending" | "ready" | string;
  runtimeSession?: RuntimeSessionView;
  createdAt: string;
  updatedAt: string;
};

export type ConversationAttachmentView = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  url?: string;
  cachePath?: string;
};

export type RuntimeSessionView = {
  runtimeKind: string;
  sessionId: string;
  status: "pending" | "ready" | string;
  createdAt: string;
  updatedAt: string;
};

export type ConversationMessageView = {
  id: string;
  conversationId: string;
  sessionId?: string;
  authorId: string;
  body: string;
  attachments?: ConversationAttachmentView[];
  cards?: InteractiveCardView[];
  runId?: string;
  status?: "running" | "done" | "failed" | string;
  createdAt: string;
};

export type ChannelView = {
  id: string;
  name: string;
  description?: string;
  isDefault?: boolean;
};

export type ChannelMemberReadiness = ProtocolChannelMemberReadiness;

export type ChannelMemberView = ProtocolChannelMemberView;

export type ChannelListReceipt = {
  channels: ChannelView[];
};

export type ChannelReceipt = {
  channel: ChannelView;
};

export type ChannelCreateRequest = ProtocolChannelCreateRequest;

export type ChannelMemberListReceipt = {
  members: ChannelMemberView[];
};

export type SendChannelMessageRequest = ProtocolSendChannelMessageRequest;

export type SendChannelMessageOutcome = ProtocolSendChannelMessageOutcome;

export type SendChannelMessageReceipt = ProtocolSendChannelMessageReceipt;

export type InteractiveCardView = {
  id: string;
  kind: "createAgent" | "createChannel" | string;
  state: "pending" | "done" | "dismissed" | "rejected" | string;
  title: string;
  summary: string;
  draft: Record<string, unknown>;
  actionLabel: string;
  doneLabel: string;
};

export type InteractiveCardReceipt = {
  card: InteractiveCardView;
};

export type PermissionDecision = "approve_once" | "approve_session" | "deny";

export type PermissionResolveRequest = {
  requestId: string;
  decision: PermissionDecision;
};

export type GuideBootstrapReceipt = {
  status: "created" | "alreadyExists" | "runtimeUnavailable" | "conflict" | string;
  agent?: DesktopAgentView;
  conversation?: ConversationView;
};

export type ConversationListReceipt = {
  conversations: ConversationView[];
};

export type ConversationReceipt = {
  conversation: ConversationView;
};

export type ConversationSessionListReceipt = {
  sessions: ConversationSessionView[];
};

export type ConversationSessionReceipt = {
  conversation: ConversationView;
  session: ConversationSessionView;
};

export type ConversationMessageListReceipt = {
  messages: ConversationMessageView[];
};

export type ConversationMessageReceipt = {
  message: ConversationMessageView;
};

export type ConversationMessageRequest = {
  authorId: string;
  body: string;
  sessionId?: string;
  attachmentIds?: string[];
};

export type ConversationAttachmentUploadRequest = {
  name: string;
  mimeType: string;
  bytesBase64: string;
};

export type ConversationAttachmentReceipt = {
  attachment: ConversationAttachmentView;
};

export type SavedMessageView = {
  id: string;
  messageId: string;
  sourceId: string;
  sourceKind: "channel" | "dm" | string;
  sessionId?: string;
  savedAt: string;
};

export type SavedMessageListReceipt = {
  savedMessages: SavedMessageView[];
};

export type SavedMessageReceipt = {
  savedMessage: SavedMessageView;
};

export type SaveMessageRequest = {
  messageId: string;
  sourceId: string;
  sourceKind: "channel" | "dm";
  sessionId?: string;
};

export type RuntimeSetupState = {
  loading: boolean;
  error?: string;
  hasClaudeRuntimeReady: boolean;
  nodes: DesktopNodeView[];
};

export type DaemonBridge = {
  daemonStatus(): Promise<SanitizedDaemonStatus>;
  listNodes(): Promise<NodeListReceipt>;
  bootstrapGuideAgent(): Promise<GuideBootstrapReceipt>;
  listChannels(): Promise<ChannelListReceipt>;
  createChannel(request: ChannelCreateRequest): Promise<ChannelReceipt>;
  listChannelMembers(channelId: string): Promise<ChannelMemberListReceipt>;
  sendChannelMessage(channelId: string, request: SendChannelMessageRequest): Promise<SendChannelMessageReceipt>;
  completeInteractiveCard(cardId: string): Promise<InteractiveCardReceipt>;
  listAgents(): Promise<AgentListReceipt>;
  createAgent(request: AgentCreateRequest): Promise<AgentReceipt>;
  updateAgent(agentId: string, request: AgentUpdateRequest): Promise<AgentReceipt>;
  deleteAgent(agentId: string): Promise<AgentReceipt>;
  rememberAgentFact(agentId: string, fact: string): Promise<AgentReceipt>;
  listAgentSkills(agentId: string): Promise<SkillListReceipt>;
  openAgentPath(agentId: string, target: AgentPathTarget): Promise<AgentPathOpenReceipt>;
  listConversations(): Promise<ConversationListReceipt>;
  createDmConversation(agentId: string): Promise<ConversationReceipt>;
  resetConversationRuntimeSession(conversationId: string): Promise<ConversationReceipt>;
  listConversationSessions(conversationId: string): Promise<ConversationSessionListReceipt>;
  createConversationSession(conversationId: string): Promise<ConversationSessionReceipt>;
  activateConversationSession(conversationId: string, sessionId: string): Promise<ConversationSessionReceipt>;
  listConversationMessages(conversationId: string): Promise<ConversationMessageListReceipt>;
  sendConversationMessage(conversationId: string, request: ConversationMessageRequest, sessionId?: string): Promise<ConversationMessageReceipt>;
  resolvePermission(request: PermissionResolveRequest): Promise<ConversationMessageReceipt>;
  uploadConversationAttachment(request: ConversationAttachmentUploadRequest): Promise<ConversationAttachmentReceipt>;
  listSavedMessages(): Promise<SavedMessageListReceipt>;
  saveMessage(request: SaveMessageRequest): Promise<SavedMessageReceipt>;
  unsaveMessage(messageId: string): Promise<void>;
  listPreferences(): Promise<PreferencesReceipt>;
  updatePreferences(request: PreferencesUpdateRequest): Promise<PreferencesReceipt>;
  renameLocalNode(name: string): Promise<NodeRenameReceipt>;
  refreshRuntimeStatus(): Promise<NodeListReceipt>;
  subscribeEvents(after: number): Promise<void>;
};

export type DaemonBridgeMock = DaemonBridge & {
  eventSubscriptions: Array<{ after: number }>;
  setConnected(connected: boolean): void;
};

export function createDaemonBridgeMock(input: {
  connected: boolean;
  nodes?: DesktopNodeView[];
  agents?: DesktopAgentView[];
  channels?: ChannelView[];
  channelMembers?: ChannelMemberView[];
}): DaemonBridgeMock {
  let connected = input.connected;
  let nodes = input.nodes ?? [
    {
      id: "local-node",
      name: "本机设备",
      status: connected ? "connected" : "offline",
      daemonVersion: "0.1.0",
      device: {
        platform: "darwin",
        arch: "arm64",
        hostname: "local-device",
      },
      runtimes: [{ kind: "ClaudeCode", readiness: "unknown" }],
    },
  ];
  let agents = input.agents ?? [];
  let channels: ChannelView[] = input.channels ?? [{ id: "all", name: "all", description: "默认团队频道", isDefault: true }];
  let channelMembers: ChannelMemberView[] = input.channelMembers ?? [];
  let channelMessageCounter = 0;
  let conversations: ConversationView[] = [];
  let conversationSessions: ConversationSessionView[] = [];
  let messages: ConversationMessageView[] = [];
  let attachments: ConversationAttachmentView[] = [];
  let savedMessages: SavedMessageView[] = [];
  let cards: InteractiveCardView[] = [];
  let preferences: UserPreferences = {
    locale: "zh-CN",
    timeZone: "Asia/Shanghai",
    appearance: {
      theme: "light",
      fontSize: "md",
    },
    notifications: {
      mentions: true,
      humanReplies: true,
      approvals: true,
    },
  };
  const eventSubscriptions: Array<{ after: number }> = [];

  return {
    eventSubscriptions,
    setConnected(next) {
      connected = next;
      nodes = nodes.map((node) => ({ ...node, status: next ? "connected" : "offline" }));
    },
    async daemonStatus() {
      const _nativeOnly = {
        token: "secret-token",
        endpoint: "http://127.0.0.1:4319",
        socket: "ws://127.0.0.1:4319/v1/events/ws",
      };

      return {
        connected,
        label: connected ? "connected" : "offline",
        daemonVersion: "0.1.0",
        protocolVersion: "v1",
      };
    },
    async listNodes() {
      return { nodes };
    },
    async bootstrapGuideAgent() {
      const hasReadyRuntime = nodes.some((node) => node.runtimes.some((runtime) => runtime.kind === "ClaudeCode" && runtime.readiness === "ready"));
      if (!hasReadyRuntime) return { status: "runtimeUnavailable" };
      const existing = agents.find((agent) => agent.id === "agent_guide_local_node" || agent.handle === "@yeal" || agent.handle === "@leelei");
      if (existing) {
        const normalized = normalizeGuideAgentIdentity(existing);
        agents = agents.map((agent) => (agent.id === normalized.id ? normalized : agent));
        const conversation = conversations.find((candidate) => candidate.agentId === existing.id);
        return { status: "alreadyExists", agent: normalized, conversation };
      }
      const now = new Date().toISOString();
      const workspacePath = "~/.slei/agents/agent_guide_local_node";
      const agent: DesktopAgentView = {
        id: "agent_guide_local_node",
        name: "Yeal",
        handle: "@yeal",
        agentKind: "guide",
        systemOwned: true,
        runtimeKind: "ClaudeCode",
        model: "Sonnet",
        nodeId: "local-node",
        description: "回答关于 Slei App 如何使用的问题，用于帮助和引导用户建立自己的团队。",
        workspacePath,
        memoryPath: `${workspacePath}/MEMORY.md`,
        docsPath: `${workspacePath}/docs`,
        avatarSeed: "yeal",
        runtimeThread: { runtimeKind: "ClaudeCode", status: "ready", createdAt: now },
        skills: defaultSkillViews({
          handle: "@yeal",
          kind: "guide",
          workspacePath,
        }),
        channelIds: ["all"],
        createdAt: now,
        updatedAt: now,
      };
      agents = [...agents, agent];
      channelMembers = [...channelMembers, { channelId: "all", agentId: agent.id, joinedAt: now, readiness: "joining" }];
      const session: ConversationSessionView = {
        id: `session:${agent.id}:default`,
        conversationId: `dm:${agent.id}`,
        title: "新会话",
        status: "ready",
        createdAt: now,
        updatedAt: now,
      };
      const conversation: ConversationView = { id: `dm:${agent.id}`, kind: "dm", agentId: agent.id, activeSessionId: session.id, createdAt: now, updatedAt: now };
      conversations = [...conversations, conversation];
      conversationSessions = [...conversationSessions, session];
      messages = [...messages, { id: "guide-welcome", conversationId: conversation.id, sessionId: session.id, authorId: agent.id, body: "Yeal 已准备好，可以帮助你创建成员、频道并了解 Slei 的使用方式。", createdAt: now }];
      return { status: "created", agent, conversation };
    },
    async listChannels() {
      return { channels };
    },
    async createChannel(request) {
      const name = request.name.trim().replace(/^#+/, "").toLowerCase();
      const existing = channels.find((channel) => channel.id === name);
      const channel: ChannelView = existing ?? { id: name, name, description: request.description, isDefault: false };
      if (!existing) {
        channels = [...channels, channel];
      }
      const joinedAt = new Date().toISOString();
      const selectedMembers = (request.agentIds ?? []).map((agentId) => ({
        channelId: channel.id,
        agentId,
        joinedAt,
        readiness: "joining" as const,
      }));
      channelMembers = [
        ...channelMembers.filter((member) => member.channelId !== channel.id || !selectedMembers.some((selected) => selected.agentId === member.agentId)),
        ...selectedMembers,
      ];
      return { channel };
    },
    async listChannelMembers(channelId) {
      return { members: channelMembers.filter((member) => member.channelId === channelId) };
    },
    async sendChannelMessage(channelId, request) {
      const channel = channels.find((candidate) => candidate.id === channelId);
      if (!channel) throw new Error("channel not found");
      const body = request.body.trim();
      if (!body) throw new Error("message body is required");
      channelMessageCounter += 1;
      const messageId = `msg_channel_${channelId}_${channelMessageCounter}`;
      const memberIds = channelMembers.filter((candidate) => candidate.channelId === channelId).map((member) => member.agentId);
      const explicitMember = agents.find((agent) => memberIds.includes(agent.id) && body.toLowerCase().includes(agent.handle.toLowerCase()));
      const readyMember = channelMembers.find((candidate) => candidate.channelId === channelId && candidate.readiness === "ready");
      const isTaskCommand = containsAny(body, ["实现", "修复", "检查", "整理", "创建", "改一下", "写一个", "生成", "调查", "验证"]);
      const isConsultation = containsAny(body, ["?", "？", "怎么看", "为什么"]);
      const action = explicitMember
        ? "request_agent_reply"
        : isTaskCommand
          ? readyMember
            ? "create_task_and_assign"
            : "needs_manual_assignment"
          : isConsultation && readyMember
            ? "request_agent_reply"
            : "archive_only";
      const assigneeAgentId = explicitMember?.id ?? (action === "create_task_and_assign" || action === "request_agent_reply" ? readyMember?.agentId : undefined);
      const taskId = action === "create_task_and_assign" || action === "needs_manual_assignment" ? `task_${messageId}` : undefined;
      return {
        outcome: {
          messageId,
          action,
          taskId,
          assigneeAgentId,
        },
      };
    },
    async completeInteractiveCard(cardId) {
      const card = cards.find((candidate) => candidate.id === cardId);
      if (!card) throw new Error("card not found");
      const next = { ...card, state: "done" };
      cards = cards.map((candidate) => candidate.id === cardId ? next : candidate);
      messages = messages.map((message) => ({
        ...message,
        cards: message.cards?.map((candidate) => candidate.id === cardId ? next : candidate),
      }));
      return { card: next };
    },
    async resolvePermission(request) {
      const state = request.decision === "deny" ? "rejected" : "done";
      const doneLabel = request.decision === "deny" ? "已拒绝" : "已允许";
      let updated: ConversationMessageView | undefined;
      messages = messages.map((message) => {
        const hasCard = message.cards?.some((card) => card.kind === "permissionApproval" && card.draft.requestId === request.requestId);
        if (!hasCard) return message;
        updated = {
          ...message,
          status: request.decision === "deny" ? "failed" : "done",
          cards: message.cards?.map((card) => (
            card.kind === "permissionApproval" && card.draft.requestId === request.requestId
              ? { ...card, state, doneLabel }
              : card
          )),
        };
        return updated;
      });
      if (!updated) throw new Error("permission request not found");
      return { message: updated };
    },
    async listAgents() {
      return { agents };
    },
    async createAgent(request) {
      const id = `agent_${Date.now()}`;
      const handle = request.handle.startsWith("@") ? request.handle : `@${request.handle}`;
      const workspacePath = `~/.slei/agents/${id}`;
      const agent: DesktopAgentView = {
        id,
        name: request.name,
        handle: handle.toLowerCase(),
        agentKind: "agent",
        systemOwned: false,
        runtimeKind: request.runtimeKind,
        model: request.model,
        nodeId: request.nodeId,
        description: request.description,
        workspacePath,
        memoryPath: `${workspacePath}/MEMORY.md`,
        docsPath: `${workspacePath}/docs`,
        avatarSeed: id,
        runtimeThread: { runtimeKind: request.runtimeKind, status: "ready", createdAt: new Date().toISOString() },
        channelIds: ["all"],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      agents = [...agents, agent];
      channelMembers = [...channelMembers, { channelId: "all", agentId: agent.id, joinedAt: agent.createdAt, readiness: "joining" }];
      return { agent };
    },
    async updateAgent(agentId, request) {
      const existing = agents.find((agent) => agent.id === agentId);
      if (!existing) throw new Error("agent not found");
      const agent = { ...existing, ...request, updatedAt: new Date().toISOString() };
      agents = agents.map((candidate) => (candidate.id === agentId ? agent : candidate));
      return { agent };
    },
    async deleteAgent(agentId) {
      const agent = agents.find((candidate) => candidate.id === agentId);
      if (!agent) throw new Error("agent not found");
      if (agent.systemOwned) throw new Error("system agents cannot be deleted");
      agents = agents.filter((candidate) => candidate.id !== agentId);
      channelMembers = channelMembers.filter((member) => member.agentId !== agentId);
      conversations = conversations.filter((conversation) => conversation.agentId !== agentId);
      return { agent };
    },
    async rememberAgentFact(agentId) {
      const agent = agents.find((candidate) => candidate.id === agentId);
      if (!agent) throw new Error("agent not found");
      return { agent };
    },
    async listAgentSkills(agentId) {
      const agent = agents.find((candidate) => candidate.id === agentId);
      if (!agent) throw new Error("agent not found");
      return { skills: agent.skills ?? [] };
    },
    async openAgentPath(agentId, target) {
      const agent = agents.find((candidate) => candidate.id === agentId);
      if (!agent) throw new Error("agent not found");
      if (!["workspace", "memory", "docs"].includes(target)) throw new Error("invalid target");
      return { agentId, target };
    },
    async listConversations() {
      return { conversations };
    },
    async createDmConversation(agentId) {
      const agent = agents.find((candidate) => candidate.id === agentId);
      if (!agent) throw new Error("agent not found");
      const existing = conversations.find((conversation) => conversation.kind === "dm" && conversation.agentId === agentId);
      if (existing) return { conversation: existing };
      const now = new Date().toISOString();
      const session: ConversationSessionView = {
        id: `session:${agentId}:default`,
        conversationId: `dm:${agentId}`,
        title: "新会话",
        status: "ready",
        createdAt: now,
        updatedAt: now,
      };
      const conversation: ConversationView = {
        id: `dm:${agentId}`,
        kind: "dm",
        agentId,
        activeSessionId: session.id,
        createdAt: now,
        updatedAt: now,
      };
      conversations = [...conversations, conversation];
      conversationSessions = [...conversationSessions, session];
      return { conversation };
    },
    async resetConversationRuntimeSession(conversationId) {
      const existing = conversations.find((candidate) => candidate.id === conversationId);
      if (!existing) throw new Error("conversation not found");
      const conversation = { ...existing, runtimeSession: undefined, updatedAt: new Date().toISOString() };
      conversations = conversations.map((candidate) => candidate.id === conversationId ? conversation : candidate);
      if (conversation.activeSessionId) {
        messages = messages.filter((message) => message.conversationId !== conversationId || message.sessionId !== conversation.activeSessionId);
        conversationSessions = conversationSessions.map((session) => (
          session.id === conversation.activeSessionId ? { ...session, title: "新会话", runtimeSession: undefined, status: "ready", updatedAt: conversation.updatedAt } : session
        ));
      }
      return { conversation };
    },
    async listConversationSessions(conversationId) {
      const existing = conversations.find((candidate) => candidate.id === conversationId);
      if (!existing) throw new Error("conversation not found");
      return { sessions: conversationSessions.filter((session) => session.conversationId === conversationId) };
    },
    async createConversationSession(conversationId) {
      const existing = conversations.find((candidate) => candidate.id === conversationId);
      if (!existing) throw new Error("conversation not found");
      const now = new Date().toISOString();
      const session: ConversationSessionView = {
        id: `session:${conversationId}:${Date.now()}`,
        conversationId,
        title: "新会话",
        status: "ready",
        createdAt: now,
        updatedAt: now,
      };
      const conversation = { ...existing, activeSessionId: session.id, runtimeSession: undefined, updatedAt: now };
      conversations = conversations.map((candidate) => candidate.id === conversationId ? conversation : candidate);
      conversationSessions = [...conversationSessions, session];
      return { conversation, session };
    },
    async activateConversationSession(conversationId, sessionId) {
      const existing = conversations.find((candidate) => candidate.id === conversationId);
      const session = conversationSessions.find((candidate) => candidate.conversationId === conversationId && candidate.id === sessionId);
      if (!existing || !session) throw new Error("conversation session not found");
      const conversation = { ...existing, activeSessionId: sessionId, runtimeSession: session.runtimeSession, updatedAt: new Date().toISOString() };
      conversations = conversations.map((candidate) => candidate.id === conversationId ? conversation : candidate);
      return { conversation, session };
    },
    async listConversationMessages(conversationId) {
      return { messages: messages.filter((message) => message.conversationId === conversationId) };
    },
    async sendConversationMessage(conversationId, request) {
      const conversation = conversations.find((candidate) => candidate.id === conversationId);
      if (!conversation) throw new Error("conversation not found");
      const now = new Date().toISOString();
      const sessionId = request.sessionId ?? conversation.activeSessionId;
      const selectedAttachments = attachments.filter((attachment) => request.attachmentIds?.includes(attachment.id));
      const message: ConversationMessageView = {
        id: `msg_${Date.now()}`,
        conversationId,
        sessionId,
        authorId: request.authorId,
        body: request.body,
        attachments: selectedAttachments,
        createdAt: now,
      };
      messages = [...messages, message];
      if (sessionId) {
        conversationSessions = conversationSessions.map((session) => (
          session.id === sessionId ? { ...session, title: session.title === "新会话" && request.body.trim() ? request.body.trim().slice(0, 40) : session.title, updatedAt: now } : session
        ));
      }
      conversations = conversations.map((candidate) => (
        candidate.id === conversation.id ? { ...candidate, updatedAt: now } : candidate
      ));
      return { message };
    },
    async uploadConversationAttachment(request) {
      const attachment: ConversationAttachmentView = {
        id: `att_${Date.now()}`,
        name: request.name,
        mimeType: request.mimeType || "application/octet-stream",
        size: Math.ceil(request.bytesBase64.length * 0.75),
        url: request.mimeType.startsWith("image/") ? `data:${request.mimeType};base64,${request.bytesBase64}` : undefined,
      };
      attachments = [...attachments, attachment];
      return { attachment };
    },
    async listSavedMessages() {
      return { savedMessages };
    },
    async saveMessage(request) {
      const existing = savedMessages.find((saved) => saved.messageId === request.messageId);
      if (existing) return { savedMessage: existing };
      const savedMessage: SavedMessageView = {
        id: `saved:${request.sourceKind}:${request.sourceId}:${request.messageId}`,
        messageId: request.messageId,
        sourceId: request.sourceId,
        sourceKind: request.sourceKind,
        sessionId: request.sessionId,
        savedAt: new Date().toISOString(),
      };
      savedMessages = [savedMessage, ...savedMessages];
      return { savedMessage };
    },
    async unsaveMessage(messageId) {
      savedMessages = savedMessages.filter((saved) => saved.messageId !== messageId);
    },
    async listPreferences() {
      return { preferences };
    },
    async updatePreferences(request) {
      preferences = {
        locale: request.locale ?? preferences.locale,
        timeZone: request.timeZone ?? preferences.timeZone,
        appearance: request.appearance ?? preferences.appearance,
        notifications: request.notifications ?? preferences.notifications,
      };
      return { preferences };
    },
    async renameLocalNode(name) {
      const trimmed = name.trim();
      if (!trimmed) {
        throw new Error("node name is required");
      }

      const node = { ...nodes[0], name: trimmed };
      nodes = [node, ...nodes.slice(1)];
      return { node };
    },
    async refreshRuntimeStatus() {
      return { nodes };
    },
    async subscribeEvents(after) {
      eventSubscriptions.push({ after });
    },
  };
}

function normalizeGuideAgentIdentity(agent: DesktopAgentView): DesktopAgentView {
  if (agent.id !== "agent_guide_local_node" && agent.agentKind !== "guide") return agent;
  return {
    ...agent,
    name: "Yeal",
    handle: "@yeal",
    avatarSeed: "yeal",
    skills: defaultSkillViews({
      handle: "@yeal",
      kind: "guide",
      workspacePath: agent.workspacePath,
    }),
  };
}

function defaultSkillViews(input: { handle: string; kind?: string; workspacePath: string }): SkillView[] {
  const skills: SkillView[] = [
    {
      id: "memory",
      name: "记忆",
      trigger: `提及 ${input.handle} 并使用 remember、learn 或 记住`,
      path: `${input.workspacePath}/skills/memory.skill.md`,
    },
  ];
  if (input.kind === "guide") {
    skills.unshift({
      id: "guide-create",
      name: "引导创建",
      trigger: "识别创建智能体、成员、频道的请求",
      path: `${input.workspacePath}/skills/guide-create.skill.md`,
    });
  }
  return skills;
}

function containsAny(body: string, markers: string[]) {
  return markers.some((marker) => body.includes(marker));
}

export function createDaemonBridge(): DaemonBridge {
  if (hasTauriRuntime()) {
    return {
      daemonStatus: () => invoke<SanitizedDaemonStatus>("daemon_status_command"),
      listNodes: () => invoke<NodeListReceipt>("list_nodes_command"),
      bootstrapGuideAgent: () => invoke<GuideBootstrapReceipt>("bootstrap_guide_agent_command"),
      listChannels: () => invoke<ChannelListReceipt>("list_channels_command"),
      createChannel: (request: ChannelCreateRequest) => invoke<ChannelReceipt>("create_channel_command", { request }),
      listChannelMembers: (channelId: string) => invoke<ChannelMemberListReceipt>("list_channel_members_command", { channelId }),
      sendChannelMessage: (channelId: string, request: SendChannelMessageRequest) => invoke<SendChannelMessageReceipt>("send_channel_message_command", { channelId, request }),
      completeInteractiveCard: (cardId: string) => invoke<InteractiveCardReceipt>("complete_interactive_card_command", { cardId }),
      listAgents: () => invoke<AgentListReceipt>("list_agents_command"),
      createAgent: (request: AgentCreateRequest) => invoke<AgentReceipt>("create_agent_command", { request }),
      updateAgent: (agentId: string, request: AgentUpdateRequest) => invoke<AgentReceipt>("update_agent_command", { agentId, request }),
      deleteAgent: (agentId: string) => invoke<AgentReceipt>("delete_agent_command", { agentId }),
      rememberAgentFact: (agentId: string, fact: string) => invoke<AgentReceipt>("remember_agent_fact_command", { agentId, fact }),
      listAgentSkills: (agentId: string) => invoke<SkillListReceipt>("list_agent_skills_command", { agentId }),
      openAgentPath: (agentId: string, target: AgentPathTarget) => invoke<AgentPathOpenReceipt>("open_agent_path_command", { agentId, target }),
      listConversations: () => invoke<ConversationListReceipt>("list_conversations_command"),
      createDmConversation: (agentId: string) => invoke<ConversationReceipt>("create_dm_conversation_command", { agentId }),
      resetConversationRuntimeSession: (conversationId: string) => invoke<ConversationReceipt>("reset_conversation_runtime_session_command", { conversationId }),
      listConversationSessions: (conversationId: string) => invoke<ConversationSessionListReceipt>("list_conversation_sessions_command", { conversationId }),
      createConversationSession: (conversationId: string) => invoke<ConversationSessionReceipt>("create_conversation_session_command", { conversationId }),
      activateConversationSession: (conversationId: string, sessionId: string) => invoke<ConversationSessionReceipt>("activate_conversation_session_command", { conversationId, sessionId }),
      listConversationMessages: (conversationId: string) => invoke<ConversationMessageListReceipt>("list_conversation_messages_command", { conversationId }),
      sendConversationMessage: (conversationId: string, request: ConversationMessageRequest, sessionId?: string) => invoke<ConversationMessageReceipt>("send_conversation_message_command", { conversationId, request, sessionId }),
      resolvePermission: (request: PermissionResolveRequest) => invoke<ConversationMessageReceipt>("resolve_permission_command", { request }),
      uploadConversationAttachment: (request: ConversationAttachmentUploadRequest) => invoke<ConversationAttachmentReceipt>("upload_conversation_attachment_command", { request }),
      listSavedMessages: () => invoke<SavedMessageListReceipt>("list_saved_messages_command"),
      saveMessage: (request: SaveMessageRequest) => invoke<SavedMessageReceipt>("save_message_command", { request }),
      unsaveMessage: (messageId: string) => invoke<void>("unsave_message_command", { messageId }),
      listPreferences: () => invoke<PreferencesReceipt>("list_preferences_command"),
      updatePreferences: (request: PreferencesUpdateRequest) => invoke<PreferencesReceipt>("update_preferences_command", { request }),
      renameLocalNode: (name: string) => invoke<NodeRenameReceipt>("rename_local_node_command", { name }),
      refreshRuntimeStatus: () => invoke<NodeListReceipt>("refresh_runtime_status_command"),
      subscribeEvents: (after: number) => invoke<void>("reconnect_events_command", { after }),
    };
  }

  return createDaemonBridgeMock({ connected: false });
}

function hasTauriRuntime() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}
