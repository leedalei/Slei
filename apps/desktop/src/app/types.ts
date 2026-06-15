import type {
  AgentWorkspaceEntry,
  AgentWorkspaceFileReceipt,
  ConversationAttachmentView,
  ConversationSessionView,
  ConversationView,
  DesktopNodeView,
  InteractiveCardView,
  SkillView,
} from "../lib/daemon-bridge";

export type SleiChannel = {
  id: string;
  name: string;
  description: string;
  unread: number;
  projectName?: string;
  projectPaths?: string[];
};

export type SleiChannelMemberReadiness = "joining" | "memory_syncing" | "ready" | "memory_failed" | "unavailable";

export type SleiMessage = {
  id: string;
  author: string;
  handle?: string;
  avatar?: string;
  role: "human" | "agent" | "system";
  time: string;
  body: string;
  sessionId?: string;
  attachments?: ConversationAttachmentView[];
  cards?: InteractiveCardView[];
  channelId?: string;
  status?: "running" | "approval" | "done" | "failed" | "pending" | "undecided";
  sourceMessageId?: string;
  task?: SleiTask;
  taskCard?: { taskId: string; sourceMessageId?: string };
  toolCall?: string;
};

export type SleiTaskStatus = "pending_assignment" | "in_progress" | "in_review" | "done";

export type SleiTask = {
  id: string;
  title: string;
  owner: string;
  status: SleiTaskStatus;
  creatorId?: string;
  assigneeId?: string;
  attention?: string;
  attentionRequired?: boolean;
  channelId?: string;
  sourceMessageId?: string;
  replyCount?: number;
  updatedAt?: string;
  replies?: SleiTaskReply[];
};

export type SleiTaskReply = {
  id: string;
  sender: string;
  role?: SleiMessage["role"];
  body: string;
};

export type SleiMember = {
  id: string;
  name: string;
  handle: string;
  avatar: string;
  avatarSeed?: string;
  agentKind?: string;
  type: "agent" | "human";
  runtimeStatus: "idle" | "busy" | "offline";
  role: string;
  description: string;
  computer: string;
  nodeId?: string;
  created: string;
  creator: string;
  runtime: string;
  model: string;
  instructions: string;
  permissions: string[];
  environmentVariables: string[];
  createdAgents: string[];
  activity: string;
  capabilities: string[];
  workspacePath?: string;
  memoryPath?: string;
  docsPath?: string;
  workspaceEntries?: AgentWorkspaceEntry[];
  workspaceFilePreview?: Pick<AgentWorkspaceFileReceipt, "content" | "name" | "relativePath">;
  skills?: SkillView[];
  channelReadiness?: Record<string, SleiChannelMemberReadiness>;
  directMessageEnabled?: boolean;
  systemOwned?: boolean;
};

export type SleiFixtures = {
  nodes: DesktopNodeView[];
  conversations: ConversationView[];
  conversationSessions: ConversationSessionView[];
  channels: SleiChannel[];
  messages: SleiMessage[];
  tasks: SleiTask[];
  members: SleiMember[];
};
