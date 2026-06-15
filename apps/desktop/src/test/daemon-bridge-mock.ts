import {
  defaultSkillContent,
  defaultSkillViews,
  renderInitialMemory,
} from "../lib/default-agent-assets";
import type {
  AgentWorkspaceEntry,
  ChannelMemberView,
  ChannelMessageView,
  ChannelSessionView,
  ChannelView,
  ConversationAttachmentView,
  ConversationMessageView,
  ConversationSessionView,
  ConversationView,
  DaemonBridge,
  DiagnosticsSnapshotView,
  DesktopAgentView,
  DesktopNodeView,
  InteractiveCardView,
  SavedMessageView,
  SkillView,
  TaskSummaryView,
  TaskThreadView,
  UserPreferences,
} from "../lib/daemon-bridge";

export type DaemonBridgeMock = DaemonBridge & {
  eventSubscriptions: Array<{ after: number }>;
  setConnected(connected: boolean): void;
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

function normalizeChannelName(name: string) {
  return name.trim().replace(/^#+/, "").trim().toLowerCase().split(/\s+/).filter(Boolean).join("-");
}

function normalizeProjectPath(path: string) {
  const trimmed = path.trim();
  return trimmed.length > 1 ? trimmed.replace(/[\\/]+$/, "") : trimmed;
}

function uniqueProjectPaths(paths: string[] = []) {
  const seen = new Set<string>();
  return paths
    .map(normalizeProjectPath)
    .filter(Boolean)
    .filter((path) => {
      if (seen.has(path)) return false;
      seen.add(path);
      return true;
    });
}

export function createDaemonBridgeMock(input: {
  connected: boolean;
  nodes?: DesktopNodeView[];
  agents?: DesktopAgentView[];
  channels?: ChannelView[];
  channelSessions?: ChannelSessionView[];
  channelMembers?: ChannelMemberView[];
  channelMessages?: ChannelMessageView[];
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
  let channels: ChannelView[] = input.channels ?? [{ id: "all", name: "all", description: "默认团队频道", isDefault: true, activeSessionId: "session:channel:all:default", projectPaths: [] }];
  let channelSessions: ChannelSessionView[] = input.channelSessions ?? [{ id: "session:channel:all:default", channelId: "all", title: "新会话", status: "ready", createdAt: "0", updatedAt: "0" }];
  let channelMembers: ChannelMemberView[] = input.channelMembers ?? [];
  let channelMessages: ChannelMessageView[] = input.channelMessages ?? [];
  let tasks: TaskSummaryView[] = [];
  const taskThreads = new Map<string, TaskThreadView>();
  let channelMessageCounter = 0;
  let conversations: ConversationView[] = [];
  let conversationSessions: ConversationSessionView[] = [];
  let messages: ConversationMessageView[] = [];
  let attachments: ConversationAttachmentView[] = [];
  let savedMessages: SavedMessageView[] = [];
  let cards: InteractiveCardView[] = [];
  let preferences = defaultUserPreferences();
  const eventSubscriptions: Array<{ after: number }> = [];

  return {
    eventSubscriptions,
    async logFrontendEvent() {
      return undefined;
    },
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
    async appRuntimeFlags() {
      return { debug: false };
    },
    async listDiagnostics(): Promise<DiagnosticsSnapshotView> {
      return {
        node: connected ? "connected" : "offline",
        runtime: "unknown",
        worker: "unknown",
        protocolVersion: "v1",
        schemaVersion: "",
        coordinatorDecisionCount: 0,
        agentInboxEventCount: 0,
        memoryUpdateEventCount: 0,
        recentEvents: [],
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
      channelMembers = [...channelMembers, { channelId: "all", agentId: agent.id, joinedAt: now, readiness: "ready" }];
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
      const name = normalizeChannelName(request.name);
      const existing = channels.find((channel) => channel.id === name);
      if (existing) throw new Error("channel name already exists");
      const projectPaths = uniqueProjectPaths(request.projectPaths);
      const mountedProjectPaths = new Set(channels.flatMap((channel) => uniqueProjectPaths(channel.projectPaths ?? [])));
      if (projectPaths.some((path) => mountedProjectPaths.has(path))) throw new Error("workspace path already mounted");
      const session: ChannelSessionView = {
        id: `session:channel:${name}:default`,
        channelId: name,
        title: "新会话",
        status: "ready",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      const channel: ChannelView = { id: name, name, description: request.description, isDefault: false, activeSessionId: session.id, projectPaths };
      channels = [...channels, channel];
      channelSessions = [...channelSessions, session];
      const joinedAt = new Date().toISOString();
      const selectedMembers = (request.agentIds ?? []).map((agentId) => ({
        channelId: channel.id,
        agentId,
        joinedAt,
        readiness: "ready" as const,
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
    async addChannelMember(channelId, request) {
      const channel = channels.find((candidate) => candidate.id === channelId);
      if (!channel) throw new Error("channel not found");
      const agent = agents.find((candidate) => candidate.id === request.agentId);
      if (!agent) throw new Error("agent not found");
      if (agent.agentKind === "coordinator" || agent.id === "agent_global_coordinator" || agent.id.startsWith("agent_coordinator_")) {
        throw new Error("coordinator agents cannot join channels");
      }
      const existing = channelMembers.find((member) => member.channelId === channelId && member.agentId === request.agentId);
      const member = existing ?? {
        channelId,
        agentId: request.agentId,
        joinedAt: new Date().toISOString(),
        readiness: "ready" as const,
      };
      channelMembers = [
        ...channelMembers.filter((candidate) => candidate.channelId !== channelId || candidate.agentId !== request.agentId),
        member,
      ];
      return { member };
    },
    async removeChannelMember(channelId, agentId) {
      const removedMember = channelMembers.find((member) => member.channelId === channelId && member.agentId === agentId) ?? null;
      channelMembers = channelMembers.filter((member) => member.channelId !== channelId || member.agentId !== agentId);
      return { removedMember };
    },
    async listChannelMessages(channelId, sessionId) {
      return { messages: channelMessages.filter((message) => message.channelId === channelId && (!sessionId || message.sessionId === sessionId) && !message.deleted) };
    },
    async listChannelSessions(channelId) {
      return { sessions: channelSessions.filter((session) => session.channelId === channelId) };
    },
    async createChannelSession(channelId) {
      const existing = channels.find((candidate) => candidate.id === channelId);
      if (!existing) throw new Error("channel not found");
      const now = new Date().toISOString();
      const session: ChannelSessionView = {
        id: `session:channel:${channelId}:${Date.now()}`,
        channelId,
        title: "新会话",
        status: "ready",
        createdAt: now,
        updatedAt: now,
      };
      const channel = { ...existing, activeSessionId: session.id };
      channels = channels.map((candidate) => candidate.id === channelId ? channel : candidate);
      channelSessions = [...channelSessions, session];
      return { channel, session };
    },
    async activateChannelSession(channelId, sessionId) {
      const existing = channels.find((candidate) => candidate.id === channelId);
      if (!existing) throw new Error("channel not found");
      const session = channelSessions.find((candidate) => candidate.channelId === channelId && candidate.id === sessionId);
      if (!session) throw new Error("channel session not found");
      const channel = { ...existing, activeSessionId: session.id };
      channels = channels.map((candidate) => candidate.id === channelId ? channel : candidate);
      return { channel, session };
    },
    async sendChannelMessage(channelId, request) {
      const channel = channels.find((candidate) => candidate.id === channelId);
      if (!channel) throw new Error("channel not found");
      const body = request.body.trim();
      if (!body) throw new Error("message body is required");
      channelMessageCounter += 1;
      const messageId = `msg_channel_${channelId}_${channelMessageCounter}`;
      channelMessages = [
        ...channelMessages,
        {
          id: messageId,
          channelId,
          sessionId: channel.activeSessionId,
          authorId: request.authorId,
          body,
          kind: "human",
          deleted: false,
          edited: false,
        },
      ];
      const memberIds = channelMembers.filter((candidate) => candidate.channelId === channelId).map((member) => member.agentId);
      const explicitMember = agents.find((agent) => memberIds.includes(agent.id) && body.toLowerCase().includes(agent.handle.toLowerCase()));
      const readyMembers = channelMembers.filter((candidate) => candidate.channelId === channelId && candidate.readiness === "ready");
      const readyMember = readyMembers[0];
      const isTaskCommand = containsAny(body, ["实现", "修复", "检查", "整理", "创建", "改一下", "写一个", "生成", "调查", "验证"]);
      const isConsultation = containsAny(body, ["?", "？", "怎么看", "为什么"]);
      const action = explicitMember
        ? "request_agent_reply"
        : request.asTask || isTaskCommand
          ? readyMember
            ? "create_task_and_assign"
            : "needs_manual_assignment"
          : isConsultation && readyMember
            ? "request_agent_reply"
            : "archive_only";
      const broadcastRequest = containsAny(body, ["大家", "所有", "一起", "都"]);
      const assigneeAgentIds = explicitMember
        ? [explicitMember.id]
        : action === "request_agent_reply" && broadcastRequest
          ? readyMembers.map((member) => member.agentId)
          : action === "create_task_and_assign" || action === "request_agent_reply"
            ? readyMember
              ? [readyMember.agentId]
              : []
            : [];
      const assigneeAgentId = assigneeAgentIds[0];
      const taskId = action === "create_task_and_assign" || action === "needs_manual_assignment" ? `task_${messageId}` : undefined;
      if (taskId) {
        const now = String(Date.now());
        const task: TaskSummaryView = {
          id: taskId,
          channelId,
          creatorId: request.authorId,
          assigneeId: assigneeAgentId,
          sourceMessageId: messageId,
          title: body.slice(0, 40),
          status: assigneeAgentId ? "in_progress" : "pending_assignment",
          attentionRequired: !assigneeAgentId,
          replyCount: 0,
          updatedAt: now,
        };
        const thread: TaskThreadView = {
          task,
          root: {
            id: `root_${taskId}`,
            taskId,
            senderId: request.authorId,
            role: request.authorId.startsWith("agent") ? "agent" : "human",
            body,
            createdAt: now,
          },
          replies: [],
        };
        tasks = [task, ...tasks.filter((candidate) => candidate.id !== taskId)];
        taskThreads.set(taskId, thread);
      }
      return {
        outcome: {
          messageId,
          action,
          taskId,
          assigneeAgentId,
          assigneeAgentIds,
          decisionStatus: "completed",
        },
      };
    },
    async listTasks(query = {}) {
      return {
        tasks: tasks.filter((task) => (
          (!query.channelId || task.channelId === query.channelId)
          && (!query.creatorId || task.creatorId === query.creatorId)
          && (!query.assigneeId || task.assigneeId === query.assigneeId)
        )),
      };
    },
    async getTaskThread(taskId) {
      const thread = taskThreads.get(taskId);
      if (!thread) throw new Error("task not found");
      return { thread };
    },
    async replyToTask(taskId, request) {
      const thread = taskThreads.get(taskId);
      if (!thread) throw new Error("task not found");
      const body = request.body.trim();
      if (!body) throw new Error("reply body is required");
      const reply = {
        id: `reply-${taskId}-${thread.replies.length + 1}`,
        taskId,
        senderId: request.senderId,
        role: request.senderId.startsWith("agent") ? "agent" : "human",
        body,
        createdAt: String(Date.now()),
      };
      thread.replies.push(reply);
      thread.task.replyCount = thread.replies.length;
      thread.task.updatedAt = reply.createdAt;
      tasks = tasks.map((task) => (task.id === taskId ? thread.task : task));
      return { reply, route: { handoffAgentIds: [], needsAssignment: false } };
    },
    async updateTaskStatus(taskId, request) {
      const thread = taskThreads.get(taskId);
      if (!thread) throw new Error("task not found");
      thread.task.status = request.status;
      thread.task.attentionRequired = request.status === "pending_assignment";
      thread.task.updatedAt = String(Date.now());
      tasks = tasks.map((task) => (task.id === taskId ? thread.task : task));
      return { task: thread.task };
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
      channelMembers = [...channelMembers, { channelId: "all", agentId: agent.id, joinedAt: agent.createdAt, readiness: "ready" }];
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
    async listAgentWorkspace(agentId, relativePath = "") {
      const agent = agents.find((candidate) => candidate.id === agentId);
      if (!agent) throw new Error("agent not found");
      if (relativePath.includes("..")) throw new Error("invalid path");
      const entries = testMockAgentWorkspaceEntries(agent, relativePath);
      return { agentId, relativePath, entries };
    },
    async readAgentWorkspaceFile(agentId, relativePath) {
      const agent = agents.find((candidate) => candidate.id === agentId);
      if (!agent) throw new Error("agent not found");
      if (relativePath.includes("..")) throw new Error("invalid path");
      const name = relativePath.split("/").at(-1) ?? relativePath;
      return {
        agentId,
        content: testMockAgentWorkspaceFileContent(agent, relativePath),
        name,
        relativePath,
      };
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

function testMockAgentWorkspaceEntries(agent: DesktopAgentView, relativePath: string): AgentWorkspaceEntry[] {
  if (!relativePath) {
    return [];
  }
  if (relativePath === ".claude") {
    return [{ kind: "directory", name: "skills", relativePath: ".claude/skills" }];
  }
  if (relativePath === ".claude/skills") {
    return (agent.skills ?? defaultSkillViews({ handle: agent.handle, kind: agent.agentKind, workspacePath: agent.workspacePath })).map((skill) => ({
      kind: "directory",
      name: skill.id,
      relativePath: `.claude/skills/${skill.id}`,
    }));
  }
  if (relativePath.startsWith(".claude/skills/")) {
    return [{ kind: "file", name: "SKILL.md", relativePath: `${relativePath}/SKILL.md` }];
  }
  if (relativePath === "docs") {
    return [];
  }
  throw new Error("workspace path not found");
}

function testMockAgentWorkspaceFileContent(agent: DesktopAgentView, relativePath: string): string {
  if (relativePath === "MEMORY.md") {
    return renderInitialMemory({
      name: agent.name,
      handle: agent.handle,
      description: agent.description,
      agentKind: agent.agentKind,
      channelIds: agent.channelIds,
    });
  }
  const skill = (agent.skills ?? []).find((candidate) => candidate.path.endsWith(relativePath));
  if (skill) {
    if (skill.id === "guide-create" || skill.id === "memory") {
      return defaultSkillContent({ skillId: skill.id, handle: agent.handle });
    }
    return ["---", `name: ${skill.name}`, `description: ${skill.trigger}`, "---", "", `# ${skill.name}`].join("\n");
  }
  return "";
}

function containsAny(body: string, markers: string[]) {
  return markers.some((marker) => body.includes(marker));
}
