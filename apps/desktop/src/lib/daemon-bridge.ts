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

export type ChannelSessionListReceipt = {
  sessions: ChannelSessionView[];
};

export type ChannelSessionReceipt = {
  channel: ChannelView;
  session: ChannelSessionView;
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
  channelId: string;
  sessionId?: string;
  authorId: string;
  body?: string;
  cards?: InteractiveCardView[];
  kind: "human" | "agent" | "task_card" | "tombstone" | string;
  deleted?: boolean;
  edited?: boolean;
  task?: TaskSummaryView;
};

export type ChannelMessageListReceipt = {
  messages: ChannelMessageView[];
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
  coordinatorDecisionCount: number;
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
  listChannelMessages(channelId: string, sessionId?: string): Promise<ChannelMessageListReceipt>;
  listChannelSessions(channelId: string): Promise<ChannelSessionListReceipt>;
  createChannelSession(channelId: string): Promise<ChannelSessionReceipt>;
  activateChannelSession(channelId: string, sessionId: string): Promise<ChannelSessionReceipt>;
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

function defaultUserPreferences(): UserPreferences {
  return {
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
        coordinatorDecisionCount: 0,
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
      return { messages: [] };
    },
    async listChannelSessions() {
      return { sessions: [] };
    },
    createChannelSession: rejectDaemonOffline,
    activateChannelSession: rejectDaemonOffline,
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
      return { messages: [] };
    },
    sendConversationMessage: rejectDaemonOffline,
    resolvePermission: rejectDaemonOffline,
    uploadConversationAttachment: rejectDaemonOffline,
    async listSavedMessages() {
      return { savedMessages: [] };
    },
    saveMessage: rejectDaemonOffline,
    unsaveMessage: rejectDaemonOffline,
    async listPreferences() {
      return { preferences };
    },
    updatePreferences: rejectDaemonOffline,
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
      listChannelMessages: (channelId: string, sessionId?: string) => invoke<ChannelMessageListReceipt>("list_channel_messages_command", { channelId, sessionId }),
      listChannelSessions: (channelId: string) => invoke<ChannelSessionListReceipt>("list_channel_sessions_command", { channelId }),
      createChannelSession: (channelId: string) => invoke<ChannelSessionReceipt>("create_channel_session_command", { channelId }),
      activateChannelSession: (channelId: string, sessionId: string) => invoke<ChannelSessionReceipt>("activate_channel_session_command", { channelId, sessionId }),
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

  return createOfflineDaemonBridge();
}

function hasTauriRuntime() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}
