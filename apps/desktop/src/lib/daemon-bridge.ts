import { invoke } from "@tauri-apps/api/core";

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
  createdAt: string;
  updatedAt: string;
};

export type ConversationMessageView = {
  id: string;
  conversationId: string;
  authorId: string;
  body: string;
  cards?: InteractiveCardView[];
  createdAt: string;
};

export type ChannelView = {
  id: string;
  name: string;
  description?: string;
  isDefault?: boolean;
};

export type ChannelMemberView = {
  channelId: string;
  agentId: string;
  joinedAt: string;
};

export type ChannelListReceipt = {
  channels: ChannelView[];
};

export type ChannelReceipt = {
  channel: ChannelView;
};

export type ChannelCreateRequest = {
  name: string;
  description?: string;
};

export type ChannelMemberListReceipt = {
  members: ChannelMemberView[];
};

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

export type ConversationMessageListReceipt = {
  messages: ConversationMessageView[];
};

export type ConversationMessageReceipt = {
  message: ConversationMessageView;
};

export type ConversationMessageRequest = {
  authorId: string;
  body: string;
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
  completeInteractiveCard(cardId: string): Promise<InteractiveCardReceipt>;
  listAgents(): Promise<AgentListReceipt>;
  createAgent(request: AgentCreateRequest): Promise<AgentReceipt>;
  updateAgent(agentId: string, request: AgentUpdateRequest): Promise<AgentReceipt>;
  rememberAgentFact(agentId: string, fact: string): Promise<AgentReceipt>;
  listAgentSkills(agentId: string): Promise<SkillListReceipt>;
  openAgentPath(agentId: string, target: AgentPathTarget): Promise<AgentPathOpenReceipt>;
  listConversations(): Promise<ConversationListReceipt>;
  createDmConversation(agentId: string): Promise<ConversationReceipt>;
  listConversationMessages(conversationId: string): Promise<ConversationMessageListReceipt>;
  sendConversationMessage(conversationId: string, request: ConversationMessageRequest): Promise<ConversationMessageReceipt>;
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
  let channels: ChannelView[] = [{ id: "all", name: "all", description: "默认团队频道", isDefault: true }];
  let channelMembers: ChannelMemberView[] = [];
  let conversations: ConversationView[] = [];
  let messages: ConversationMessageView[] = [];
  let cards: InteractiveCardView[] = [];
  let preferences: UserPreferences = {
    locale: "zh-CN",
    timeZone: "Asia/Shanghai",
    appearance: {
      theme: "system",
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
        channelIds: ["all"],
        createdAt: now,
        updatedAt: now,
      };
      agents = [...agents, agent];
      channelMembers = [...channelMembers, { channelId: "all", agentId: agent.id, joinedAt: now }];
      const conversation: ConversationView = { id: `dm:${agent.id}`, kind: "dm", agentId: agent.id, createdAt: now, updatedAt: now };
      conversations = [...conversations, conversation];
      messages = [...messages, { id: "guide-welcome", conversationId: conversation.id, authorId: agent.id, body: "Yeal 已准备好，可以帮助你创建成员、频道并了解 Slei 的使用方式。", createdAt: now }];
      return { status: "created", agent, conversation };
    },
    async listChannels() {
      return { channels };
    },
    async createChannel(request) {
      const name = request.name.trim().replace(/^#+/, "").toLowerCase();
      const existing = channels.find((channel) => channel.id === name);
      if (existing) return { channel: existing };
      const channel: ChannelView = { id: name, name, description: request.description, isDefault: false };
      channels = [...channels, channel];
      return { channel };
    },
    async listChannelMembers(channelId) {
      return { members: channelMembers.filter((member) => member.channelId === channelId) };
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
      channelMembers = [...channelMembers, { channelId: "all", agentId: agent.id, joinedAt: agent.createdAt }];
      return { agent };
    },
    async updateAgent(agentId, request) {
      const existing = agents.find((agent) => agent.id === agentId);
      if (!existing) throw new Error("agent not found");
      const agent = { ...existing, ...request, updatedAt: new Date().toISOString() };
      agents = agents.map((candidate) => (candidate.id === agentId ? agent : candidate));
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
      const conversation: ConversationView = {
        id: `dm:${agentId}`,
        kind: "dm",
        agentId,
        createdAt: now,
        updatedAt: now,
      };
      conversations = [...conversations, conversation];
      return { conversation };
    },
    async listConversationMessages(conversationId) {
      return { messages: messages.filter((message) => message.conversationId === conversationId) };
    },
    async sendConversationMessage(conversationId, request) {
      const conversation = conversations.find((candidate) => candidate.id === conversationId);
      if (!conversation) throw new Error("conversation not found");
      const now = new Date().toISOString();
      const message: ConversationMessageView = {
        id: `msg_${Date.now()}`,
        conversationId,
        authorId: request.authorId,
        body: request.body,
        createdAt: now,
      };
      if (conversationId === "dm:agent_guide_local_node" && request.authorId.startsWith("human:")) {
        const card = createGuideCardFromText(request.body);
        if (card) {
          cards = [...cards, card];
          message.cards = [card];
        }
      }
      messages = [...messages, message];
      conversations = conversations.map((candidate) => (
        candidate.id === conversation.id ? { ...candidate, updatedAt: now } : candidate
      ));
      return { message };
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
  };
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
      completeInteractiveCard: (cardId: string) => invoke<InteractiveCardReceipt>("complete_interactive_card_command", { cardId }),
      listAgents: () => invoke<AgentListReceipt>("list_agents_command"),
      createAgent: (request: AgentCreateRequest) => invoke<AgentReceipt>("create_agent_command", { request }),
      updateAgent: (agentId: string, request: AgentUpdateRequest) => invoke<AgentReceipt>("update_agent_command", { agentId, request }),
      rememberAgentFact: (agentId: string, fact: string) => invoke<AgentReceipt>("remember_agent_fact_command", { agentId, fact }),
      listAgentSkills: (agentId: string) => invoke<SkillListReceipt>("list_agent_skills_command", { agentId }),
      openAgentPath: (agentId: string, target: AgentPathTarget) => invoke<AgentPathOpenReceipt>("open_agent_path_command", { agentId, target }),
      listConversations: () => invoke<ConversationListReceipt>("list_conversations_command"),
      createDmConversation: (agentId: string) => invoke<ConversationReceipt>("create_dm_conversation_command", { agentId }),
      listConversationMessages: (conversationId: string) => invoke<ConversationMessageListReceipt>("list_conversation_messages_command", { conversationId }),
      sendConversationMessage: (conversationId: string, request: ConversationMessageRequest) => invoke<ConversationMessageReceipt>("send_conversation_message_command", { conversationId, request }),
      listPreferences: () => invoke<PreferencesReceipt>("list_preferences_command"),
      updatePreferences: (request: PreferencesUpdateRequest) => invoke<PreferencesReceipt>("update_preferences_command", { request }),
      renameLocalNode: (name: string) => invoke<NodeRenameReceipt>("rename_local_node_command", { name }),
      refreshRuntimeStatus: () => invoke<NodeListReceipt>("refresh_runtime_status_command"),
      subscribeEvents: (after: number) => invoke<void>("reconnect_events_command", { after }),
    };
  }

  return createDaemonBridgeMock({ connected: false });
}

function createGuideCardFromText(text: string): InteractiveCardView | undefined {
  const lower = text.toLowerCase();
  if ((text.includes("创建") || lower.includes("create")) && (lower.includes("agent") || text.includes("成员"))) {
    const name = /(?:叫|名为|named|called)\s*([A-Za-z][\w-]*)/iu.exec(text)?.[1] ?? (lower.includes("qa") ? "Nancy" : "Coda");
    return {
      id: `card_${Date.now()}`,
      kind: "createAgent",
      state: "pending",
      title: "创建智能体草案",
      summary: `${name} · ClaudeCode / Sonnet`,
      draft: {
        name,
        handle: `@${name.toLowerCase()}`,
        runtimeKind: "ClaudeCode",
        model: "Sonnet",
        nodeId: "local-node",
        description: lower.includes("qa") ? "QA 质保员，负责审查代码质量、安全漏洞，提出改进意见。" : "研发团队开发工程师，负责基于任务分解进行实际编码工作。",
      },
      actionLabel: "创建",
      doneLabel: "DONE",
    };
  }
  if ((text.includes("创建") || lower.includes("create")) && (lower.includes("channel") || text.includes("频道"))) {
    const name = /(?:叫|名为|named|called)\s*(#?[\w-]+)/iu.exec(text)?.[1]?.replace(/^#/, "") ?? "dev-team";
    return {
      id: `card_${Date.now()}`,
      kind: "createChannel",
      state: "pending",
      title: "创建频道草案",
      summary: `#${name}`,
      draft: { name, description: "团队会话频道" },
      actionLabel: "创建",
      doneLabel: "DONE",
    };
  }
  return undefined;
}

function hasTauriRuntime() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}
