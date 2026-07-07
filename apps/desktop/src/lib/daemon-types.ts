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

export type ProfileAvatarUploadRequest = {
  fileName: string;
  mimeType: string;
  bytesBase64: string;
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
  avatarSeed?: string;
};

export type AgentUpdateRequest = Partial<Pick<AgentCreateRequest, "name" | "runtimeKind" | "model" | "nodeId" | "description">>;

export type AgentRolePresetView = {
  id: string;
  title: string;
  description: string;
  sortOrder: number;
};

export type AgentRolePresetReceipt = {
  presets: AgentRolePresetView[];
};

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

export type ChannelDeleteReceipt = {
  deletedChannel: ChannelView;
};

export type ChannelCreateRequest = ProtocolChannelCreateRequest;

export type ChannelProjectPathsRequest = {
  projectPaths: string[];
};

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
  attachments?: ConversationAttachmentView[];
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

export type TaskListQuery = {
  channelId?: string;
  creatorId?: string;
  assigneeId?: string;
};

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

export type TaskReplyRoute = { handoffAgentIds: string[]; followupAgentIds: string[]; needsAssignment: boolean };

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

export type DaemonEventView = {
  sequence: number;
  eventType: string;
  occurredAtUnixMs: number;
  payload: unknown;
};

export type EventReconnectReceipt = {
  after: number;
  events: DaemonEventView[];
};

export type DaemonConnectionState =
  | { state: "starting" }
  | { state: "connected" }
  | { state: "offline"; code: "daemon_unavailable" | "daemon_auth_failed" | "daemon_start_timeout" };

export type DaemonEventBatchHandler = (receipt: EventReconnectReceipt) => void;

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
  deleteChannel(channelId: string): Promise<ChannelDeleteReceipt>;
  replaceChannelProjectPaths(channelId: string, request: ChannelProjectPathsRequest): Promise<ChannelReceipt>;
  listChannelMembers(channelId: string): Promise<ChannelMemberListReceipt>;
  addChannelMember(channelId: string, request: ChannelMemberAddRequest): Promise<ChannelMemberReceipt>;
  removeChannelMember(channelId: string, agentId: string): Promise<ChannelMemberRemoveReceipt>;
  listChannelMessages(channelId: string, query?: MessagePageQuery): Promise<ChannelMessageListReceipt>;
  sendChannelMessage(channelId: string, request: SendChannelMessageRequest): Promise<SendChannelMessageReceipt>;
  listTasks(query?: TaskListQuery): Promise<TaskListReceipt>;
  getTaskThread(taskId: string): Promise<TaskThreadReceipt>;
  replyToTask(taskId: string, request: TaskReplyRequest): Promise<TaskReplyReceipt>;
  updateTaskStatus(taskId: string, request: TaskStatusUpdateRequest): Promise<TaskReceipt>;
  completeInteractiveCard(cardId: string): Promise<InteractiveCardReceipt>;
  listAgents(): Promise<AgentListReceipt>;
  listAgentRolePresets(): Promise<AgentRolePresetReceipt>;
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
  clearConversationMessages(conversationId: string): Promise<void>;
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
  uploadProfileAvatar(request: ProfileAvatarUploadRequest): Promise<ProfileReceipt>;
  renameLocalNode(name: string): Promise<NodeRenameReceipt>;
  refreshRuntimeStatus(): Promise<NodeListReceipt>;
  subscribeEvents(after: number): Promise<EventReconnectReceipt>;
  listenDaemonEvents(handler: DaemonEventBatchHandler): Promise<() => void>;
};
