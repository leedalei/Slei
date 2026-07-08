import type {
  SanitizedDaemonStatus,
  RuntimeReadinessView,
  DeviceMetaView,
  DesktopNodeView,
  NodeListReceipt,
  NodeRenameReceipt,
  AppLocale,
  NotificationPreferences,
  AppearancePreferences,
  UserPreferences,
  PreferencesReceipt,
  PreferencesUpdateRequest,
  UserProfileView,
  ProfileReceipt,
  ProfileUpdateRequest,
  ProfileAvatarUploadRequest,
  DesktopAgentView,
  RuntimeThreadView,
  SkillView,
  AgentCreateRequest,
  AgentUpdateRequest,
  AgentRolePresetView,
  AgentRolePresetReceipt,
  AgentListReceipt,
  AgentReceipt,
  SkillListReceipt,
  AgentPathTarget,
  AgentPathOpenReceipt,
  AgentWorkspaceEntry,
  AgentWorkspaceListReceipt,
  AgentWorkspaceFileReceipt,
  AgentActivityLogView,
  AgentActivityListReceipt,
  ConversationView,
  ConversationSessionView,
  ConversationAttachmentView,
  RuntimeSessionView,
  ConversationMessageView,
  ChannelView,
  ChannelSessionView,
  ChannelMemberReadiness,
  ChannelMemberView,
  ChannelListReceipt,
  ChannelReceipt,
  ChannelDeleteReceipt,
  ChannelCreateRequest,
  ChannelProjectPathsRequest,
  ChannelMemberAddRequest,
  ChannelMemberListReceipt,
  ChannelMemberReceipt,
  ChannelMemberRemoveReceipt,
  ChannelMessageView,
  MessagePageQuery,
  MessagePageInfo,
  ChannelMessageListReceipt,
  SendChannelMessageRequest,
  SendChannelMessageOutcome,
  SendChannelMessageReceipt,
  TaskStatusView,
  TaskListQuery,
  TaskSummaryView,
  TaskThreadMessageView,
  TaskThreadView,
  TaskListReceipt,
  TaskThreadReceipt,
  TaskReplyRequest,
  TaskReplyRoute,
  TaskReplyReceipt,
  TaskStatusUpdateRequest,
  TaskReceipt,
  InteractiveCardView,
  InteractiveCardReceipt,
  PermissionDecision,
  PermissionResolveRequest,
  GuideBootstrapReceipt,
  ConversationListReceipt,
  ConversationReceipt,
  ConversationSessionListReceipt,
  ConversationSessionReceipt,
  ConversationMessageListReceipt,
  MessageThreadSummaryView,
  MessageThreadReplyView,
  MessageThreadReceipt,
  MessageThreadReplyReceipt,
  CreateMessageThreadRequest,
  ReplyToMessageThreadRequest,
  ConversationMessageReceipt,
  WorkspaceMountView,
  ConversationMessageRequest,
  ConversationAttachmentUploadRequest,
  ConversationAttachmentReceipt,
  SavedMessageView,
  SavedMessageListReceipt,
  SavedMessageReceipt,
  SaveMessageRequest,
  GlobalSearchTimeRange,
  GlobalSearchQuery,
  GlobalSearchTotals,
  GlobalAgentSearchResult,
  GlobalChannelSearchResult,
  GlobalMessageSearchResult,
  GlobalSearchReceipt,
  RuntimeSetupState,
  FrontendEventReport,
  AppRuntimeFlagsView,
  DiagnosticEventView,
  DaemonEventView,
  EventReconnectReceipt,
  DaemonConnectionState,
  DaemonEventBatchHandler,
  DaemonStateHandler,
  DiagnosticsSnapshotView,
  DaemonBridge,
} from "./daemon-types";
import { createDesktopRpcClient } from "./desktop-rpc";

export type {
  SanitizedDaemonStatus,
  RuntimeReadinessView,
  DeviceMetaView,
  DesktopNodeView,
  NodeListReceipt,
  NodeRenameReceipt,
  AppLocale,
  NotificationPreferences,
  AppearancePreferences,
  UserPreferences,
  PreferencesReceipt,
  PreferencesUpdateRequest,
  UserProfileView,
  ProfileReceipt,
  ProfileUpdateRequest,
  ProfileAvatarUploadRequest,
  DesktopAgentView,
  RuntimeThreadView,
  SkillView,
  AgentCreateRequest,
  AgentUpdateRequest,
  AgentRolePresetView,
  AgentRolePresetReceipt,
  AgentListReceipt,
  AgentReceipt,
  SkillListReceipt,
  AgentPathTarget,
  AgentPathOpenReceipt,
  AgentWorkspaceEntry,
  AgentWorkspaceListReceipt,
  AgentWorkspaceFileReceipt,
  AgentActivityLogView,
  AgentActivityListReceipt,
  ConversationView,
  ConversationSessionView,
  ConversationAttachmentView,
  RuntimeSessionView,
  ConversationMessageView,
  ChannelView,
  ChannelSessionView,
  ChannelMemberReadiness,
  ChannelMemberView,
  ChannelListReceipt,
  ChannelReceipt,
  ChannelDeleteReceipt,
  ChannelCreateRequest,
  ChannelProjectPathsRequest,
  ChannelMemberAddRequest,
  ChannelMemberListReceipt,
  ChannelMemberReceipt,
  ChannelMemberRemoveReceipt,
  ChannelMessageView,
  MessagePageQuery,
  MessagePageInfo,
  ChannelMessageListReceipt,
  SendChannelMessageRequest,
  SendChannelMessageOutcome,
  SendChannelMessageReceipt,
  TaskStatusView,
  TaskListQuery,
  TaskSummaryView,
  TaskThreadMessageView,
  TaskThreadView,
  TaskListReceipt,
  TaskThreadReceipt,
  TaskReplyRequest,
  TaskReplyRoute,
  TaskReplyReceipt,
  TaskStatusUpdateRequest,
  TaskReceipt,
  InteractiveCardView,
  InteractiveCardReceipt,
  PermissionDecision,
  PermissionResolveRequest,
  GuideBootstrapReceipt,
  ConversationListReceipt,
  ConversationReceipt,
  ConversationSessionListReceipt,
  ConversationSessionReceipt,
  ConversationMessageListReceipt,
  MessageThreadSummaryView,
  MessageThreadReplyView,
  MessageThreadReceipt,
  MessageThreadReplyReceipt,
  CreateMessageThreadRequest,
  ReplyToMessageThreadRequest,
  ConversationMessageReceipt,
  WorkspaceMountView,
  ConversationMessageRequest,
  ConversationAttachmentUploadRequest,
  ConversationAttachmentReceipt,
  SavedMessageView,
  SavedMessageListReceipt,
  SavedMessageReceipt,
  SaveMessageRequest,
  GlobalSearchTimeRange,
  GlobalSearchQuery,
  GlobalSearchTotals,
  GlobalAgentSearchResult,
  GlobalChannelSearchResult,
  GlobalMessageSearchResult,
  GlobalSearchReceipt,
  RuntimeSetupState,
  FrontendEventReport,
  AppRuntimeFlagsView,
  DiagnosticEventView,
  DaemonEventView,
  EventReconnectReceipt,
  DaemonConnectionState,
  DaemonEventBatchHandler,
  DaemonStateHandler,
  DiagnosticsSnapshotView,
  DaemonBridge,
} from "./daemon-types";

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
    deleteChannel: rejectDaemonOffline,
    replaceChannelProjectPaths: rejectDaemonOffline,
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
    async listAgentRolePresets() {
      return { presets: [] };
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
    clearConversationMessages: rejectDaemonOffline,
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
    uploadProfileAvatar: rejectDaemonOffline,
    renameLocalNode: rejectDaemonOffline,
    async refreshRuntimeStatus() {
      return { nodes: [] };
    },
    async subscribeEvents(after) {
      return { after, events: [] };
    },
    async listenDaemonEvents() {
      return () => undefined;
    },
    async listenDaemonState() {
      return () => undefined;
    },
  };
}

export function createDaemonBridge(): DaemonBridge {
  const electronBridge = createElectronDaemonBridge();
  if (electronBridge) {
    return electronBridge;
  }

  return createOfflineDaemonBridge();
}

function createElectronDaemonBridge(): DaemonBridge | undefined {
  const runtime = electronRuntime();
  if (!runtime) {
    return undefined;
  }

  const rpc = createDesktopRpcClient({ call: runtime.rpc.call });

  return {
    logFrontendEvent: (report: FrontendEventReport) => rpc.call("frontend.event.log", { report }),
    daemonStatus: () => rpc.call("daemon.status", {}),
    appRuntimeFlags: () => rpc.call("app.runtimeFlags", {}),
    listDiagnostics: () => rpc.call("diagnostics.list", {}),
    listNodes: () => rpc.call("nodes.list", {}),
    bootstrapGuideAgent: () => rpc.call("agents.bootstrapGuide", {}),
    listChannels: () => rpc.call("channels.list", {}),
    createChannel: (request: ChannelCreateRequest) => rpc.call("channels.create", { request }),
    deleteChannel: (channelId: string) => rpc.call("channels.delete", { channelId }),
    replaceChannelProjectPaths: (channelId: string, request: ChannelProjectPathsRequest) =>
      rpc.call("channels.projectPaths.replace", { channelId, request }),
    listChannelMembers: (channelId: string) => rpc.call("channels.members.list", { channelId }),
    addChannelMember: (channelId: string, request: ChannelMemberAddRequest) =>
      rpc.call("channels.members.add", { channelId, request }),
    removeChannelMember: (channelId: string, agentId: string) =>
      rpc.call("channels.members.remove", { channelId, agentId }),
    listChannelMessages: (channelId: string, query?: MessagePageQuery) =>
      rpc.call("channels.messages.list", { channelId, query }),
    sendChannelMessage: (channelId: string, request: SendChannelMessageRequest) =>
      rpc.call("channels.messages.send", { channelId, request }),
    listTasks: (query = {}) => rpc.call("tasks.list", { query }),
    getTaskThread: (taskId: string) => rpc.call("tasks.thread.get", { taskId }),
    replyToTask: (taskId: string, request: TaskReplyRequest) => rpc.call("tasks.reply", { taskId, request }),
    updateTaskStatus: (taskId: string, request: TaskStatusUpdateRequest) =>
      rpc.call("tasks.status.update", { taskId, request }),
    completeInteractiveCard: (cardId: string) => rpc.call("interactiveCards.complete", { cardId }),
    listAgents: () => rpc.call("agents.list", {}),
    listAgentRolePresets: () => rpc.call("agentRolePresets.list", {}),
    createAgent: (request: AgentCreateRequest) => rpc.call("agents.create", { request }),
    updateAgent: (agentId: string, request: AgentUpdateRequest) => rpc.call("agents.update", { agentId, request }),
    deleteAgent: (agentId: string) => rpc.call("agents.delete", { agentId }),
    rememberAgentFact: (agentId: string, fact: string) => rpc.call("agents.remember", { agentId, fact }),
    listAgentSkills: (agentId: string) => rpc.call("agents.skills.list", { agentId }),
    openAgentPath: (agentId: string, target: AgentPathTarget) => rpc.call("agents.path.open", { agentId, target }),
    listAgentWorkspace: (agentId: string, relativePath?: string) =>
      rpc.call("agents.workspace.list", { agentId, relativePath }),
    readAgentWorkspaceFile: (agentId: string, relativePath: string) =>
      rpc.call("agents.workspace.file.read", { agentId, relativePath }),
    listAgentActivity: (agentId: string, limit = 200) => rpc.call("agents.activity.list", { agentId, limit }),
    listConversations: () => rpc.call("conversations.list", {}),
    createDmConversation: (agentId: string) => rpc.call("conversations.dm.create", { agentId }),
    resetConversationRuntimeSession: (conversationId: string) =>
      rpc.call("conversations.runtimeSession.reset", { conversationId }),
    listConversationSessions: (conversationId: string) => rpc.call("conversations.sessions.list", { conversationId }),
    createConversationSession: (conversationId: string) =>
      rpc.call("conversations.sessions.create", { conversationId }),
    activateConversationSession: (conversationId: string, sessionId: string) =>
      rpc.call("conversations.sessions.activate", { conversationId, sessionId }),
    listConversationMessages: (conversationId: string, query?: MessagePageQuery) =>
      rpc.call("conversations.messages.list", { conversationId, query }),
    clearConversationMessages: (conversationId: string) => rpc.call("conversations.messages.clear", { conversationId }),
    createMessageThreadFromSource: (request: CreateMessageThreadRequest) =>
      rpc.call("messageThreads.createFromSource", { request }),
    getMessageThread: (threadId: string) => rpc.call("messageThreads.get", { threadId }),
    replyToMessageThread: (threadId: string, request: ReplyToMessageThreadRequest) =>
      rpc.call("messageThreads.reply", { threadId, request }),
    sendConversationMessage: (conversationId: string, request: ConversationMessageRequest, sessionId?: string) =>
      rpc.call("conversations.messages.send", { conversationId, request, sessionId }),
    resolvePermission: (request: PermissionResolveRequest) => rpc.call("permissions.resolve", { request }),
    uploadConversationAttachment: (request: ConversationAttachmentUploadRequest) =>
      rpc.call("attachments.upload", { request }),
    listSavedMessages: () => rpc.call("savedMessages.list", {}),
    saveMessage: (request: SaveMessageRequest) => rpc.call("savedMessages.save", { request }),
    unsaveMessage: (messageId: string) => rpc.call("savedMessages.unsave", { messageId }),
    globalSearch: (query: GlobalSearchQuery) => rpc.call("search.global", { query }),
    listPreferences: () => rpc.call("preferences.list", {}),
    updatePreferences: (request: PreferencesUpdateRequest) => rpc.call("preferences.update", { request }),
    listProfile: () => rpc.call("profile.get", {}),
    updateProfile: (request: ProfileUpdateRequest) => rpc.call("profile.update", { request }),
    uploadProfileAvatar: (request: ProfileAvatarUploadRequest) => rpc.call("profile.avatar.upload", { request }),
    renameLocalNode: (name: string) => rpc.call("nodes.renameLocal", { name }),
    refreshRuntimeStatus: () => rpc.call("runtime.refreshStatus", {}),
    subscribeEvents: (after: number) => rpc.call("events.reconnect", { after }),
    async listenDaemonEvents(handler: DaemonEventBatchHandler) {
      return runtime.events.subscribe("daemon.events", handler as (payload: unknown) => void);
    },
    async listenDaemonState(handler: DaemonStateHandler) {
      return runtime.events.subscribe("daemon.state", handler as (payload: unknown) => void);
    },
  };
}

type ElectronRuntime = {
  rpc: {
    call(method: string, payload: unknown): Promise<unknown>;
  };
  events: {
    subscribe(channel: "daemon.events" | "daemon.state", handler: (payload: unknown) => void): () => void;
  };
};

function electronRuntime(): ElectronRuntime | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  const candidate = (window as Window & { slei?: Partial<ElectronRuntime> }).slei;
  if (
    typeof candidate?.rpc?.call !== "function" ||
    typeof candidate.events?.subscribe !== "function"
  ) {
    return undefined;
  }

  return candidate as ElectronRuntime;
}
