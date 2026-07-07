import type {
  AgentActivityListReceipt,
  AgentCreateRequest,
  AgentListReceipt,
  AgentPathOpenReceipt,
  AgentPathTarget,
  AgentReceipt,
  AgentRolePresetReceipt,
  AgentUpdateRequest,
  AgentWorkspaceFileReceipt,
  AgentWorkspaceListReceipt,
  AppRuntimeFlagsView,
  ChannelCreateRequest,
  ChannelListReceipt,
  ChannelDeleteReceipt,
  ChannelMemberAddRequest,
  ChannelMemberListReceipt,
  ChannelMemberReceipt,
  ChannelMemberRemoveReceipt,
  ChannelMessageListReceipt,
  ChannelProjectPathsRequest,
  ChannelReceipt,
  ConversationAttachmentReceipt,
  ConversationAttachmentUploadRequest,
  ConversationListReceipt,
  ConversationMessageListReceipt,
  ConversationMessageReceipt,
  ConversationMessageRequest,
  ConversationReceipt,
  ConversationSessionListReceipt,
  ConversationSessionReceipt,
  CreateMessageThreadRequest,
  DaemonConnectionState,
  DiagnosticsSnapshotView,
  EventReconnectReceipt,
  GlobalSearchQuery,
  GlobalSearchReceipt,
  GuideBootstrapReceipt,
  InteractiveCardReceipt,
  MessagePageQuery,
  MessageThreadReceipt,
  MessageThreadReplyReceipt,
  NodeRenameReceipt,
  NodeListReceipt,
  PermissionResolveRequest,
  PreferencesReceipt,
  PreferencesUpdateRequest,
  ProfileAvatarUploadRequest,
  ProfileReceipt,
  ProfileUpdateRequest,
  ReplyToMessageThreadRequest,
  SavedMessageListReceipt,
  SavedMessageReceipt,
  SaveMessageRequest,
  SanitizedDaemonStatus,
  SendChannelMessageReceipt,
  SendChannelMessageRequest,
  SkillListReceipt,
  TaskListQuery,
  TaskListReceipt,
  TaskReceipt,
  TaskReplyReceipt,
  TaskReplyRequest,
  TaskStatusUpdateRequest,
  TaskThreadReceipt,
} from "./daemon-types.js";

export const desktopRpcMethods = [
  "daemon.status",
  "app.runtimeFlags",
  "diagnostics.list",
  "nodes.list",
  "nodes.renameLocal",
  "runtime.refreshStatus",
  "channels.list",
  "channels.create",
  "channels.delete",
  "channels.projectPaths.replace",
  "channels.members.list",
  "channels.members.add",
  "channels.members.remove",
  "channels.messages.list",
  "channels.messages.send",
  "tasks.list",
  "tasks.thread.get",
  "tasks.reply",
  "tasks.status.update",
  "interactiveCards.complete",
  "agents.bootstrapGuide",
  "agents.list",
  "agentRolePresets.list",
  "agents.create",
  "agents.update",
  "agents.delete",
  "agents.remember",
  "agents.skills.list",
  "agents.path.open",
  "agents.workspace.list",
  "agents.workspace.file.read",
  "agents.activity.list",
  "conversations.list",
  "conversations.dm.create",
  "conversations.runtimeSession.reset",
  "conversations.sessions.list",
  "conversations.sessions.create",
  "conversations.sessions.activate",
  "conversations.messages.list",
  "conversations.messages.clear",
  "conversations.messages.send",
  "permissions.resolve",
  "attachments.upload",
  "messageThreads.createFromSource",
  "messageThreads.get",
  "messageThreads.reply",
  "savedMessages.list",
  "savedMessages.save",
  "savedMessages.unsave",
  "search.global",
  "preferences.list",
  "preferences.update",
  "profile.get",
  "profile.update",
  "profile.avatar.upload",
  "events.reconnect",
  "frontend.crash.log",
  "frontend.event.log",
] as const;

export type DesktopRpcMethod = (typeof desktopRpcMethods)[number] | string;

export type DesktopRpcRequestMap = {
  "daemon.status": Record<string, never>;
  "app.runtimeFlags": Record<string, never>;
  "diagnostics.list": Record<string, never>;
  "nodes.list": Record<string, never>;
  "nodes.renameLocal": { name: string };
  "runtime.refreshStatus": Record<string, never>;
  "channels.list": Record<string, never>;
  "channels.create": { request: ChannelCreateRequest };
  "channels.delete": { channelId: string };
  "channels.projectPaths.replace": { channelId: string; request: ChannelProjectPathsRequest };
  "channels.members.list": { channelId: string };
  "channels.members.add": { channelId: string; request: ChannelMemberAddRequest };
  "channels.members.remove": { channelId: string; agentId: string };
  "channels.messages.list": { channelId: string; query?: MessagePageQuery };
  "channels.messages.send": { channelId: string; request: SendChannelMessageRequest };
  "tasks.list": { query: TaskListQuery };
  "tasks.thread.get": { taskId: string };
  "tasks.reply": { taskId: string; request: TaskReplyRequest };
  "tasks.status.update": { taskId: string; request: TaskStatusUpdateRequest };
  "interactiveCards.complete": { cardId: string };
  "agents.bootstrapGuide": Record<string, never>;
  "agents.list": Record<string, never>;
  "agentRolePresets.list": Record<string, never>;
  "agents.create": { request: AgentCreateRequest };
  "agents.update": { agentId: string; request: AgentUpdateRequest };
  "agents.delete": { agentId: string };
  "agents.remember": { agentId: string; fact: string };
  "agents.skills.list": { agentId: string };
  "agents.path.open": { agentId: string; target: AgentPathTarget };
  "agents.workspace.list": { agentId: string; relativePath?: string };
  "agents.workspace.file.read": { agentId: string; relativePath: string };
  "agents.activity.list": { agentId: string; limit: number };
  "conversations.list": Record<string, never>;
  "conversations.dm.create": { agentId: string };
  "conversations.runtimeSession.reset": { conversationId: string };
  "conversations.sessions.list": { conversationId: string };
  "conversations.sessions.create": { conversationId: string };
  "conversations.sessions.activate": { conversationId: string; sessionId: string };
  "conversations.messages.list": { conversationId: string; query?: MessagePageQuery };
  "conversations.messages.clear": { conversationId: string };
  "conversations.messages.send": { conversationId: string; request: ConversationMessageRequest; sessionId?: string };
  "permissions.resolve": { request: PermissionResolveRequest };
  "attachments.upload": { request: ConversationAttachmentUploadRequest };
  "messageThreads.createFromSource": { request: CreateMessageThreadRequest };
  "messageThreads.get": { threadId: string };
  "messageThreads.reply": { threadId: string; request: ReplyToMessageThreadRequest };
  "savedMessages.list": Record<string, never>;
  "savedMessages.save": { request: SaveMessageRequest };
  "savedMessages.unsave": { messageId: string };
  "search.global": { query: GlobalSearchQuery };
  "preferences.list": Record<string, never>;
  "preferences.update": { request: PreferencesUpdateRequest };
  "profile.get": Record<string, never>;
  "profile.update": { request: ProfileUpdateRequest };
  "profile.avatar.upload": { request: ProfileAvatarUploadRequest };
  "events.reconnect": { after: number };
  "frontend.crash.log": { report: unknown };
  "frontend.event.log": { report: unknown };
};

export type DesktopRpcResponseMap = {
  "daemon.status": SanitizedDaemonStatus;
  "app.runtimeFlags": AppRuntimeFlagsView;
  "diagnostics.list": DiagnosticsSnapshotView;
  "nodes.list": NodeListReceipt;
  "nodes.renameLocal": NodeRenameReceipt;
  "runtime.refreshStatus": NodeListReceipt;
  "channels.list": ChannelListReceipt;
  "channels.create": ChannelReceipt;
  "channels.delete": ChannelDeleteReceipt;
  "channels.projectPaths.replace": ChannelReceipt;
  "channels.members.list": ChannelMemberListReceipt;
  "channels.members.add": ChannelMemberReceipt;
  "channels.members.remove": ChannelMemberRemoveReceipt;
  "channels.messages.list": ChannelMessageListReceipt;
  "channels.messages.send": SendChannelMessageReceipt;
  "tasks.list": TaskListReceipt;
  "tasks.thread.get": TaskThreadReceipt;
  "tasks.reply": TaskReplyReceipt;
  "tasks.status.update": TaskReceipt;
  "interactiveCards.complete": InteractiveCardReceipt;
  "agents.bootstrapGuide": GuideBootstrapReceipt;
  "agents.list": AgentListReceipt;
  "agentRolePresets.list": AgentRolePresetReceipt;
  "agents.create": AgentReceipt;
  "agents.update": AgentReceipt;
  "agents.delete": AgentReceipt;
  "agents.remember": AgentReceipt;
  "agents.skills.list": SkillListReceipt;
  "agents.path.open": AgentPathOpenReceipt;
  "agents.workspace.list": AgentWorkspaceListReceipt;
  "agents.workspace.file.read": AgentWorkspaceFileReceipt;
  "agents.activity.list": AgentActivityListReceipt;
  "conversations.list": ConversationListReceipt;
  "conversations.dm.create": ConversationReceipt;
  "conversations.runtimeSession.reset": ConversationReceipt;
  "conversations.sessions.list": ConversationSessionListReceipt;
  "conversations.sessions.create": ConversationSessionReceipt;
  "conversations.sessions.activate": ConversationSessionReceipt;
  "conversations.messages.list": ConversationMessageListReceipt;
  "conversations.messages.clear": void;
  "conversations.messages.send": ConversationMessageReceipt;
  "permissions.resolve": ConversationMessageReceipt;
  "attachments.upload": ConversationAttachmentReceipt;
  "messageThreads.createFromSource": MessageThreadReceipt;
  "messageThreads.get": MessageThreadReceipt;
  "messageThreads.reply": MessageThreadReplyReceipt;
  "savedMessages.list": SavedMessageListReceipt;
  "savedMessages.save": SavedMessageReceipt;
  "savedMessages.unsave": void;
  "search.global": GlobalSearchReceipt;
  "preferences.list": PreferencesReceipt;
  "preferences.update": PreferencesReceipt;
  "profile.get": ProfileReceipt;
  "profile.update": ProfileReceipt;
  "profile.avatar.upload": ProfileReceipt;
  "events.reconnect": EventReconnectReceipt;
  "frontend.crash.log": void;
  "frontend.event.log": void;
};

export type DesktopEventMap = {
  "daemon.events": EventReconnectReceipt;
  "daemon.state": DaemonConnectionState;
};

export type DesktopRpcTransport = {
  call(method: string, payload: unknown): Promise<unknown>;
};

export function createDesktopRpcClient(transport: DesktopRpcTransport) {
  return {
    call<M extends keyof DesktopRpcRequestMap>(
      method: M,
      payload: DesktopRpcRequestMap[M],
    ): Promise<DesktopRpcResponseMap[M]> {
      return transport.call(method, payload) as Promise<DesktopRpcResponseMap[M]>;
    },
  };
}
