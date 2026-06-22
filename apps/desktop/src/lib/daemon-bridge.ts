import { invoke } from "@tauri-apps/api/core";
import type {
  ChannelCreateRequest as ProtocolChannelCreateRequest,
  ChannelMemberAddRequest as ProtocolChannelMemberAddRequest,
  ChannelMemberReadiness as ProtocolChannelMemberReadiness,
  ChannelMemberReceipt as ProtocolChannelMemberReceipt,
  ChannelMemberRemoveReceipt as ProtocolChannelMemberRemoveReceipt,
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

export type UserProfileView = {
  displayName: string;
  handle: string;
  avatar: string;
};

export type ProfileReceipt = {
  profile: UserProfileView | null;
};

export type ProfileUpdateRequest = {
  displayName?: string;
  avatar?: string;
  handle?: string;
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

export type AgentWorkspaceEntry = {
  kind: "directory" | "file" | string;
  name: string;
  relativePath: string;
};

export type AgentWorkspaceListReceipt = {
  agentId: string;
  relativePath: string;
  entries: AgentWorkspaceEntry[];
};

export type AgentWorkspaceFileReceipt = {
  agentId: string;
  content: string;
  name: string;
  relativePath: string;
};

export type AgentActivityLogView = {
  id: string;
  agentId: string;
  runId?: string | null;
  channelId?: string | null;
  messageId?: string | null;
  taskId?: string | null;
  state: string;
  phase?: string | null;
  reason?: string | null;
  eventKind: string;
  severity: string;
  summary: string;
  payloadPreview?: string | null;
  toolName?: string | null;
  ok?: boolean | null;
  createdAt: string;
};

export type AgentActivityListReceipt = {
  logs: AgentActivityLogView[];
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
  sequence?: number;
  conversationId: string;
  sessionId?: string;
  authorId: string;
  body: string;
  attachments?: ConversationAttachmentView[];
  cards?: InteractiveCardView[];
  thread?: MessageThreadSummaryView;
  runId?: string;
  status?: "running" | "done" | "failed" | string;
  createdAt: string;
};

export type ChannelView = {
  id: string;
  name: string;
  description?: string;
  isDefault?: boolean;
  activeSessionId?: string;
  projectPaths?: string[];
};

export type ChannelSessionView = {
  id: string;
  channelId: string;
  title: string;
  status: "pending" | "ready" | string;
  createdAt: string;
  updatedAt: string;
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

export type ChannelMemberAddRequest = ProtocolChannelMemberAddRequest;

export type ChannelMemberListReceipt = {
  members: ChannelMemberView[];
};

export type ChannelMemberReceipt = ProtocolChannelMemberReceipt;

export type ChannelMemberRemoveReceipt = ProtocolChannelMemberRemoveReceipt;

export type ChannelMessageView = {
  id: string;
  sequence?: number;
  channelId: string;
  sessionId?: string;
  authorId: string;
  body?: string;
  cards?: InteractiveCardView[];
  kind: "human" | "agent" | "task_card" | "tombstone" | string;
  deleted?: boolean;
  edited?: boolean;
  createdAt?: string;
  thread?: MessageThreadSummaryView;
  task?: TaskSummaryView;
};

export type MessagePageQuery = {
  before?: number;
  aroundMessageId?: string;
  limit?: number;
};

export type MessagePageInfo = {
  hasMoreBefore: boolean;
  oldestCursor?: number;
  newestCursor?: number;
};

export type ChannelMessageListReceipt = {
  messages: ChannelMessageView[];
  pageInfo: MessagePageInfo;
};

export type SendChannelMessageRequest = ProtocolSendChannelMessageRequest;

export type SendChannelMessageOutcome = ProtocolSendChannelMessageOutcome;

export type SendChannelMessageReceipt = ProtocolSendChannelMessageReceipt;

export type TaskStatusView = "pending_assignment" | "in_progress" | "in_review" | "done";

export type TaskSummaryView = {
  id: string;
  channelId: string;
  creatorId: string;
  assigneeId?: string;
  sourceMessageId?: string;
  threadId?: string;
  title: string;
  status: TaskStatusView;
  attentionRequired: boolean;
  replyCount: number;
  updatedAt: string;
};

export type TaskThreadMessageView = {
  id: string;
  taskId: string;
  senderId: string;
  role: "human" | "agent" | "system" | string;
  body: string;
  status?: string;
  createdAt: string;
};

export type TaskThreadView = {
  task: TaskSummaryView;
  root: TaskThreadMessageView;
  replies: TaskThreadMessageView[];
};

export type TaskListReceipt = { tasks: TaskSummaryView[] };

export type TaskThreadReceipt = { thread: TaskThreadView };

export type TaskReplyRequest = { senderId: string; body: string };

export type TaskReplyRoute = { handoffAgentIds: string[]; needsAssignment: boolean };

export type TaskReplyReceipt = { reply: TaskThreadMessageView; route: TaskReplyRoute };

export type TaskStatusUpdateRequest = { status: TaskStatusView };

export type TaskReceipt = { task: TaskSummaryView };

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
  pageInfo: MessagePageInfo;
};

export type MessageThreadSummaryView = {
  id: string;
  sourceMessageId: string;
  sourceKind: "channel" | "dm" | string;
  sourceId: string;
  replyCount: number;
  updatedAt: string;
};

export type MessageThreadReplyView = {
  id: string;
  threadId: string;
  senderId: string;
  role: "human" | "agent" | "system" | string;
  body: string;
  status?: string;
  runId?: string;
  createdAt: string;
};

export type MessageThreadReceipt = {
  thread: MessageThreadSummaryView;
  replies?: MessageThreadReplyView[];
};

export type MessageThreadReplyReceipt = {
  reply: MessageThreadReplyView;
};

export type CreateMessageThreadRequest = {
  sourceMessageId: string;
  createdBy: string;
};

export type ReplyToMessageThreadRequest = {
  senderId: string;
  role?: string;
  body: string;
};

export type ConversationMessageReceipt = {
  message: ConversationMessageView;
};

export type WorkspaceMountView = {
  path: string;
  label?: string;
};

export type ConversationMessageRequest = {
  authorId: string;
  body: string;
  asTask?: boolean;
  sessionId?: string;
  attachmentIds?: string[];
  workspaceMounts?: WorkspaceMountView[];
  sourceChannelId?: string;
  sourceChannelName?: string;
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
  body: string;
  authorId: string;
  authorName: string;
  messageCreatedAt: string;
  sourceName: string;
  sourceLabel: string;
  messageDeleted: boolean;
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

export type GlobalSearchTimeRange = "any" | "today" | "last7Days" | "last30Days";

export type GlobalSearchQuery = {
  q: string;
  fromId?: string;
  channelId?: string;
  timeRange?: GlobalSearchTimeRange;
  timeZone?: string;
  includeAgents?: boolean;
  includeChannels?: boolean;
  includeMessages?: boolean;
  agentLimit?: number;
  channelLimit?: number;
  messageLimit?: number;
};

export type GlobalSearchTotals = {
  agents: number;
  channels: number;
  messages: number;
};

export type GlobalAgentSearchResult = {
  kind: "agent" | string;
  agentId: string;
  title: string;
  subtitle: string;
  avatarSeed: string;
  matchedFields: string[];
};

export type GlobalChannelSearchResult = {
  kind: "channel" | string;
  channelId: string;
  title: string;
  subtitle: string;
  matchedFields: string[];
};

export type GlobalMessageSearchResult = {
  kind: "message" | string;
  sourceKind: "channel" | "dm" | string;
  messageId: string;
  channelId?: string | null;
  conversationId?: string | null;
  sessionId?: string | null;
  authorId?: string;
  authorName?: string;
  authorHandle?: string;
  authorLabel?: string;
  title?: string;
  sourceLabel?: string;
  snippet: string;
  createdAt: string;
  matchedFields?: string[];
};

export type GlobalSearchReceipt = {
  query: string;
  totals: GlobalSearchTotals;
  agents: GlobalAgentSearchResult[];
  channels: GlobalChannelSearchResult[];
  messages: GlobalMessageSearchResult[];
};

export type RuntimeSetupState = {
  loading: boolean;
  error?: string;
  hasClaudeRuntimeReady: boolean;
  nodes: DesktopNodeView[];
};

export type FrontendEventReport = {
  scope: string;
  message: string;
  context?: Record<string, unknown>;
};

export type AppRuntimeFlagsView = {
  debug: boolean;
};

export type DiagnosticEventView = {
  sequence: number;
  eventType: string;
  entityId: string;
  payload: string;
  createdAt: string;
};

export type DiagnosticsSnapshotView = {
  node: string;
  runtime: string;
  worker: string;
  protocolVersion: string;
  schemaVersion: string;
  failureSummary?: string;
  agentInboxEventCount: number;
  memoryUpdateEventCount: number;
  recentEvents: DiagnosticEventView[];
};

export type DaemonBridge = {
  logFrontendEvent(report: FrontendEventReport): Promise<void>;
  daemonStatus(): Promise<SanitizedDaemonStatus>;
  appRuntimeFlags(): Promise<AppRuntimeFlagsView>;
  listDiagnostics(): Promise<DiagnosticsSnapshotView>;
  listNodes(): Promise<NodeListReceipt>;
  bootstrapGuideAgent(): Promise<GuideBootstrapReceipt>;
  listChannels(): Promise<ChannelListReceipt>;
  createChannel(request: ChannelCreateRequest): Promise<ChannelReceipt>;
  listChannelMembers(channelId: string): Promise<ChannelMemberListReceipt>;
  addChannelMember(channelId: string, request: ChannelMemberAddRequest): Promise<ChannelMemberReceipt>;
  removeChannelMember(channelId: string, agentId: string): Promise<ChannelMemberRemoveReceipt>;
  listChannelMessages(channelId: string, query?: MessagePageQuery): Promise<ChannelMessageListReceipt>;
  sendChannelMessage(channelId: string, request: SendChannelMessageRequest): Promise<SendChannelMessageReceipt>;
  listTasks(query?: { channelId?: string; creatorId?: string; assigneeId?: string }): Promise<TaskListReceipt>;
  getTaskThread(taskId: string): Promise<TaskThreadReceipt>;
  replyToTask(taskId: string, request: TaskReplyRequest): Promise<TaskReplyReceipt>;
  updateTaskStatus(taskId: string, request: TaskStatusUpdateRequest): Promise<TaskReceipt>;
  completeInteractiveCard(cardId: string): Promise<InteractiveCardReceipt>;
  listAgents(): Promise<AgentListReceipt>;
  createAgent(request: AgentCreateRequest): Promise<AgentReceipt>;
  updateAgent(agentId: string, request: AgentUpdateRequest): Promise<AgentReceipt>;
  deleteAgent(agentId: string): Promise<AgentReceipt>;
  rememberAgentFact(agentId: string, fact: string): Promise<AgentReceipt>;
  listAgentSkills(agentId: string): Promise<SkillListReceipt>;
  openAgentPath(agentId: string, target: AgentPathTarget): Promise<AgentPathOpenReceipt>;
  listAgentWorkspace(agentId: string, relativePath?: string): Promise<AgentWorkspaceListReceipt>;
  readAgentWorkspaceFile(agentId: string, relativePath: string): Promise<AgentWorkspaceFileReceipt>;
  listAgentActivity(agentId: string, limit?: number): Promise<AgentActivityListReceipt>;
  listConversations(): Promise<ConversationListReceipt>;
  createDmConversation(agentId: string): Promise<ConversationReceipt>;
  resetConversationRuntimeSession(conversationId: string): Promise<ConversationReceipt>;
  listConversationSessions(conversationId: string): Promise<ConversationSessionListReceipt>;
  createConversationSession(conversationId: string): Promise<ConversationSessionReceipt>;
  activateConversationSession(conversationId: string, sessionId: string): Promise<ConversationSessionReceipt>;
  listConversationMessages(conversationId: string, query?: MessagePageQuery): Promise<ConversationMessageListReceipt>;
  createMessageThreadFromSource(request: CreateMessageThreadRequest): Promise<MessageThreadReceipt>;
  getMessageThread(threadId: string): Promise<MessageThreadReceipt>;
  replyToMessageThread(threadId: string, request: ReplyToMessageThreadRequest): Promise<MessageThreadReplyReceipt>;
  sendConversationMessage(conversationId: string, request: ConversationMessageRequest, sessionId?: string): Promise<ConversationMessageReceipt>;
  resolvePermission(request: PermissionResolveRequest): Promise<ConversationMessageReceipt>;
  uploadConversationAttachment(request: ConversationAttachmentUploadRequest): Promise<ConversationAttachmentReceipt>;
  listSavedMessages(): Promise<SavedMessageListReceipt>;
  saveMessage(request: SaveMessageRequest): Promise<SavedMessageReceipt>;
  unsaveMessage(messageId: string): Promise<void>;
  globalSearch(query: GlobalSearchQuery): Promise<GlobalSearchReceipt>;
  listPreferences(): Promise<PreferencesReceipt>;
  updatePreferences(request: PreferencesUpdateRequest): Promise<PreferencesReceipt>;
  listProfile(): Promise<ProfileReceipt>;
  updateProfile(request: ProfileUpdateRequest): Promise<ProfileReceipt>;
  renameLocalNode(name: string): Promise<NodeRenameReceipt>;
  refreshRuntimeStatus(): Promise<NodeListReceipt>;
  subscribeEvents(after: number): Promise<void>;
};

function defaultAppLocale(): AppLocale {
  const languages = typeof navigator === "undefined"
    ? []
    : [navigator.language, ...Array.from(navigator.languages ?? [])];
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

function defaultAppTimeZone(): string {
  const timeZone = typeof Intl === "undefined" ? undefined : Intl.DateTimeFormat().resolvedOptions().timeZone;
  const normalized = timeZone?.trim();
  return normalized && normalized.includes("/") ? normalized : "Asia/Shanghai";
}

function defaultUserPreferences(): UserPreferences {
  return {
    locale: defaultAppLocale(),
    timeZone: defaultAppTimeZone(),
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
}

function rejectDaemonOffline(): Promise<never> {
  return Promise.reject(new Error("daemon offline"));
}

export function createOfflineDaemonBridge(): DaemonBridge {
  const preferences = defaultUserPreferences();

  return {
    async logFrontendEvent() {
      return undefined;
    },
    async daemonStatus() {
      return {
        connected: false,
        label: "offline",
        daemonVersion: "",
        protocolVersion: "",
      };
    },
    async appRuntimeFlags() {
      return { debug: false };
    },
    async listDiagnostics() {
      return {
        node: "offline",
        runtime: "unknown",
        worker: "unknown",
        protocolVersion: "",
        schemaVersion: "",
        agentInboxEventCount: 0,
        memoryUpdateEventCount: 0,
        recentEvents: [],
      };
    },
    async listNodes() {
      return { nodes: [] };
    },
    async bootstrapGuideAgent() {
      return { status: "runtimeUnavailable" };
    },
    async listChannels() {
      return { channels: [] };
    },
    createChannel: rejectDaemonOffline,
    async listChannelMembers() {
      return { members: [] };
    },
    addChannelMember: rejectDaemonOffline,
    removeChannelMember: rejectDaemonOffline,
    async listChannelMessages() {
      return { messages: [], pageInfo: { hasMoreBefore: false } };
    },
    sendChannelMessage: rejectDaemonOffline,
    async listTasks() {
      return { tasks: [] };
    },
    getTaskThread: rejectDaemonOffline,
    replyToTask: rejectDaemonOffline,
    updateTaskStatus: rejectDaemonOffline,
    completeInteractiveCard: rejectDaemonOffline,
    async listAgents() {
      return { agents: [] };
    },
    createAgent: rejectDaemonOffline,
    updateAgent: rejectDaemonOffline,
    deleteAgent: rejectDaemonOffline,
    rememberAgentFact: rejectDaemonOffline,
    async listAgentSkills() {
      return { skills: [] };
    },
    openAgentPath: rejectDaemonOffline,
    listAgentWorkspace: rejectDaemonOffline,
    readAgentWorkspaceFile: rejectDaemonOffline,
    async listAgentActivity() {
      return { logs: [] };
    },
    async listConversations() {
      return { conversations: [] };
    },
    createDmConversation: rejectDaemonOffline,
    resetConversationRuntimeSession: rejectDaemonOffline,
    async listConversationSessions() {
      return { sessions: [] };
    },
    createConversationSession: rejectDaemonOffline,
    activateConversationSession: rejectDaemonOffline,
    async listConversationMessages() {
      return { messages: [], pageInfo: { hasMoreBefore: false } };
    },
    createMessageThreadFromSource: rejectDaemonOffline,
    getMessageThread: rejectDaemonOffline,
    replyToMessageThread: rejectDaemonOffline,
    sendConversationMessage: rejectDaemonOffline,
    resolvePermission: rejectDaemonOffline,
    uploadConversationAttachment: rejectDaemonOffline,
    async listSavedMessages() {
      return { savedMessages: [] };
    },
    saveMessage: rejectDaemonOffline,
    unsaveMessage: rejectDaemonOffline,
    async globalSearch(query) {
      return {
        query: query.q.trim(),
        totals: { agents: 0, channels: 0, messages: 0 },
        agents: [],
        channels: [],
        messages: [],
      };
    },
    async listPreferences() {
      return { preferences };
    },
    updatePreferences: rejectDaemonOffline,
    async listProfile() {
      return { profile: null };
    },
    updateProfile: rejectDaemonOffline,
    renameLocalNode: rejectDaemonOffline,
    async refreshRuntimeStatus() {
      return { nodes: [] };
    },
    async subscribeEvents() {
      return undefined;
    },
  };
}

export function createDaemonBridge(): DaemonBridge {
  if (hasTauriRuntime()) {
    return {
      logFrontendEvent: (report: FrontendEventReport) => invoke<void>("log_frontend_event_command", { report }),
      daemonStatus: () => invoke<SanitizedDaemonStatus>("daemon_status_command"),
      appRuntimeFlags: () => invoke<AppRuntimeFlagsView>("app_runtime_flags_command"),
      listDiagnostics: () => invoke<DiagnosticsSnapshotView>("list_diagnostics_command"),
      listNodes: () => invoke<NodeListReceipt>("list_nodes_command"),
      bootstrapGuideAgent: () => invoke<GuideBootstrapReceipt>("bootstrap_guide_agent_command"),
      listChannels: () => invoke<ChannelListReceipt>("list_channels_command"),
      createChannel: (request: ChannelCreateRequest) => invoke<ChannelReceipt>("create_channel_command", { request }),
      listChannelMembers: (channelId: string) => invoke<ChannelMemberListReceipt>("list_channel_members_command", { channelId }),
      addChannelMember: (channelId: string, request: ChannelMemberAddRequest) => invoke<ChannelMemberReceipt>("add_channel_member_command", { channelId, request }),
      removeChannelMember: (channelId: string, agentId: string) => invoke<ChannelMemberRemoveReceipt>("remove_channel_member_command", { channelId, agentId }),
      listChannelMessages: (channelId: string, query?: MessagePageQuery) => invoke<ChannelMessageListReceipt>("list_channel_messages_command", { channelId, query }),
      sendChannelMessage: (channelId: string, request: SendChannelMessageRequest) => invoke<SendChannelMessageReceipt>("send_channel_message_command", { channelId, request }),
      listTasks: (query = {}) => invoke<TaskListReceipt>("list_tasks_command", { query }),
      getTaskThread: (taskId: string) => invoke<TaskThreadReceipt>("get_task_thread_command", { taskId }),
      replyToTask: (taskId: string, request: TaskReplyRequest) => invoke<TaskReplyReceipt>("reply_to_task_command", { taskId, request }),
      updateTaskStatus: (taskId: string, request: TaskStatusUpdateRequest) => invoke<TaskReceipt>("update_task_status_command", { taskId, request }),
      completeInteractiveCard: (cardId: string) => invoke<InteractiveCardReceipt>("complete_interactive_card_command", { cardId }),
      listAgents: () => invoke<AgentListReceipt>("list_agents_command"),
      createAgent: (request: AgentCreateRequest) => invoke<AgentReceipt>("create_agent_command", { request }),
      updateAgent: (agentId: string, request: AgentUpdateRequest) => invoke<AgentReceipt>("update_agent_command", { agentId, request }),
      deleteAgent: (agentId: string) => invoke<AgentReceipt>("delete_agent_command", { agentId }),
      rememberAgentFact: (agentId: string, fact: string) => invoke<AgentReceipt>("remember_agent_fact_command", { agentId, fact }),
      listAgentSkills: (agentId: string) => invoke<SkillListReceipt>("list_agent_skills_command", { agentId }),
      openAgentPath: (agentId: string, target: AgentPathTarget) => invoke<AgentPathOpenReceipt>("open_agent_path_command", { agentId, target }),
      listAgentWorkspace: (agentId: string, relativePath?: string) => invoke<AgentWorkspaceListReceipt>("list_agent_workspace_command", { agentId, relativePath }),
      readAgentWorkspaceFile: (agentId: string, relativePath: string) => invoke<AgentWorkspaceFileReceipt>("read_agent_workspace_file_command", { agentId, relativePath }),
      listAgentActivity: (agentId: string, limit = 200) => invoke<AgentActivityListReceipt>("list_agent_activity_command", { agentId, limit }),
      listConversations: () => invoke<ConversationListReceipt>("list_conversations_command"),
      createDmConversation: (agentId: string) => invoke<ConversationReceipt>("create_dm_conversation_command", { agentId }),
      resetConversationRuntimeSession: (conversationId: string) => invoke<ConversationReceipt>("reset_conversation_runtime_session_command", { conversationId }),
      listConversationSessions: (conversationId: string) => invoke<ConversationSessionListReceipt>("list_conversation_sessions_command", { conversationId }),
      createConversationSession: (conversationId: string) => invoke<ConversationSessionReceipt>("create_conversation_session_command", { conversationId }),
      activateConversationSession: (conversationId: string, sessionId: string) => invoke<ConversationSessionReceipt>("activate_conversation_session_command", { conversationId, sessionId }),
      listConversationMessages: (conversationId: string, query?: MessagePageQuery) => invoke<ConversationMessageListReceipt>("list_conversation_messages_command", { conversationId, query }),
      createMessageThreadFromSource: (request: CreateMessageThreadRequest) => invoke<MessageThreadReceipt>("create_message_thread_from_source_command", { request }),
      getMessageThread: (threadId: string) => invoke<MessageThreadReceipt>("get_message_thread_command", { threadId }),
      replyToMessageThread: (threadId: string, request: ReplyToMessageThreadRequest) => invoke<MessageThreadReplyReceipt>("reply_to_message_thread_command", { threadId, request }),
      sendConversationMessage: (conversationId: string, request: ConversationMessageRequest, sessionId?: string) => invoke<ConversationMessageReceipt>("send_conversation_message_command", { conversationId, request, sessionId }),
      resolvePermission: (request: PermissionResolveRequest) => invoke<ConversationMessageReceipt>("resolve_permission_command", { request }),
      uploadConversationAttachment: (request: ConversationAttachmentUploadRequest) => invoke<ConversationAttachmentReceipt>("upload_conversation_attachment_command", { request }),
      listSavedMessages: () => invoke<SavedMessageListReceipt>("list_saved_messages_command"),
      saveMessage: (request: SaveMessageRequest) => invoke<SavedMessageReceipt>("save_message_command", { request }),
      unsaveMessage: (messageId: string) => invoke<void>("unsave_message_command", { messageId }),
      globalSearch: (query: GlobalSearchQuery) => invoke<GlobalSearchReceipt>("global_search_command", { query }),
      listPreferences: () => invoke<PreferencesReceipt>("list_preferences_command"),
      updatePreferences: (request: PreferencesUpdateRequest) => invoke<PreferencesReceipt>("update_preferences_command", { request }),
      listProfile: () => invoke<ProfileReceipt>("list_profile_command"),
      updateProfile: (request: ProfileUpdateRequest) => invoke<ProfileReceipt>("update_profile_command", { request }),
      renameLocalNode: (name: string) => invoke<NodeRenameReceipt>("rename_local_node_command", { name }),
      refreshRuntimeStatus: () => invoke<NodeListReceipt>("refresh_runtime_status_command"),
      subscribeEvents: (after: number) => invoke<void>("reconnect_events_command", { after }),
    };
  }

  return createOfflineDaemonBridge();
}

function hasTauriRuntime() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}
