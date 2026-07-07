import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
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
  DiagnosticsSnapshotView,
  DaemonBridge,
} from "./daemon-types";

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
      deleteChannel: (channelId: string) => invoke<ChannelDeleteReceipt>("delete_channel_command", { channelId }),
      replaceChannelProjectPaths: (channelId: string, request: ChannelProjectPathsRequest) => invoke<ChannelReceipt>("replace_channel_project_paths_command", { channelId, request }),
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
      listAgentRolePresets: () => invoke<AgentRolePresetReceipt>("list_agent_role_presets_command"),
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
      clearConversationMessages: (conversationId: string) => invoke<void>("clear_conversation_messages_command", { conversationId }),
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
      uploadProfileAvatar: (request: ProfileAvatarUploadRequest) => invoke<ProfileReceipt>("upload_profile_avatar_command", { request }),
      renameLocalNode: (name: string) => invoke<NodeRenameReceipt>("rename_local_node_command", { name }),
      refreshRuntimeStatus: () => invoke<NodeListReceipt>("refresh_runtime_status_command"),
      subscribeEvents: (after: number) => invoke<EventReconnectReceipt>("reconnect_events_command", { after }),
      listenDaemonEvents: async (handler: DaemonEventBatchHandler) =>
        listen<EventReconnectReceipt>("slei://daemon-events", (event) => handler(event.payload)),
    };
  }

  return createOfflineDaemonBridge();
}

function hasTauriRuntime() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}
