import { type PointerEvent as ReactPointerEvent, useEffect, useMemo, useState } from "react";

import {
  createDaemonBridge,
  type AppearancePreferences,
  type AppLocale,
  type ChannelView,
  type ConversationAttachmentUploadRequest,
  type ConversationView,
  type ConversationMessageView,
  type ConversationSessionView,
  type DaemonBridge,
  type DesktopAgentView,
  type DesktopNodeView,
  type NotificationPreferences,
  type PermissionDecision,
  type SaveMessageRequest,
  type SavedMessageView,
  type AgentPathTarget,
  type SendChannelMessageOutcome,
  type RuntimeSetupState,
} from "../lib/daemon-bridge";
import { createDesktopMessages, type DesktopMessages } from "../i18n";
import { SleiAppFrame } from "./SleiAppFrame";
import { createSleiFixtures, type SleiChannel, type SleiFixtures, type SleiMember, type SleiMessage } from "./fixtures";
import {
  appendTaskReply,
  createDraftComputerNode,
  createLocalChatMessage,
  createTaskFromChatMessage,
  defaultAppearance,
  defaultNotifications,
  defaultProfile,
  defaultTimeZone,
  deleteComputerNode,
  detectAgentMemoryRequest,
  formatMessageTime,
  formatMemberCreatedDate,
  normalizeAppearance,
  renameComputerNode,
  shouldRefreshConversationMessages,
  sendChatComposerMessage,
  stripChannelHash,
  type AgentDraftInput,
  type SettingsPanel,
  type UserProfile,
} from "./model";
import { routeForView, viewForPath, type AppView } from "./router";
import "./app.css";

export type {
  AgentDraftInput,
  AgentMemoryRequest,
  AppView,
  ChatSearchFilters,
  EmptySize,
  EmptyVariant,
  SettingsPanel,
  UserProfile,
} from "./model";

export {
  activeMentionQuery,
  agentsForComputerNode,
  appendTaskReply,
  channelReadinessLabel,
  composerShortcutAction,
  createDraftComputerNode,
  createLocalChatMessage,
  createTaskFromChatMessage,
  deleteComputerNode,
  detectAgentMemoryRequest,
  filterConversationMessages,
  formatMemberCreatedDate,
  insertMention,
  isComposerImeComposing,
  moveMentionSelection,
  renameComputerNode,
  shouldRefreshConversationMessages,
  sendChatComposerMessage,
  submitComposerDraft,
} from "./model";
export { EditableDetailField, Empty } from "../components";

function conversationMessageToSleiMessage(message: ConversationMessageView, members: SleiMember[], profile: UserProfile): SleiMessage {
  const member = members.find((candidate) => candidate.id === message.authorId);
  const isHuman = message.authorId.startsWith("human:");
  return {
    id: message.id,
    author: member?.name ?? (isHuman ? profile.displayName : message.authorId),
    handle: member?.handle ?? (isHuman ? profile.handle : undefined),
    avatar: member?.avatar ?? (isHuman ? profile.avatar : undefined),
    role: member?.type ?? (isHuman ? "human" : "agent"),
    time: formatMessageTime(message.createdAt),
    body: message.body,
    sessionId: message.sessionId,
    attachments: message.attachments,
    cards: message.cards,
    channelId: message.conversationId,
    status: conversationMessageStatus(message.status),
  };
}

function conversationMessageStatus(status?: string): SleiMessage["status"] | undefined {
  return status === "running" || status === "done" || status === "failed" || status === "approval" || status === "pending" || status === "undecided"
    ? status
    : undefined;
}

function replaceConversationMessages(current: SleiMessage[], conversationMessages: SleiMessage[], conversationIds?: string[]): SleiMessage[] {
  const ids = new Set(conversationIds ?? conversationMessages.map((message) => message.channelId).filter((id): id is string => Boolean(id)));
  return [
    ...current.filter((message) => !message.channelId || !ids.has(message.channelId)),
    ...conversationMessages,
  ];
}

function memberFromAgentView(agent: DesktopAgentView, nodes: DesktopNodeView[], messages: DesktopMessages = createDesktopMessages("zh-CN")): SleiMember {
  const node = nodes.find((candidate) => candidate.id === agent.nodeId);
  const isCoordinator = agent.agentKind === "coordinator";
  return {
    id: agent.id,
    name: agent.name,
    handle: agent.handle,
    avatar: agent.name.slice(0, 2).toUpperCase(),
    avatarSeed: agent.avatarSeed,
    type: "agent",
    runtimeStatus: node?.status === "offline" ? "offline" : "idle",
    role: isCoordinator
      ? messages.members.channelCoordinator
      : agent.agentKind === "guide"
        ? messages.chat.guide
        : agent.description.split("。")[0] || messages.agentCreate.fallbackAgent,
    description: agent.description,
    computer: node?.name ?? agent.nodeId,
    nodeId: agent.nodeId,
    created: formatMemberCreatedDate(agent.createdAt),
    creator: "lei lee @lei-lee",
    runtime: agent.runtimeKind,
    model: agent.model,
    instructions: agent.description,
    permissions: [],
    environmentVariables: [],
    createdAgents: [],
    activity: messages.members.noActivity,
    capabilities: [agent.runtimeKind],
    workspacePath: agent.workspacePath,
    memoryPath: agent.memoryPath,
    docsPath: agent.docsPath,
    skills: agent.skills,
    directMessageEnabled: !isCoordinator,
    systemOwned: agent.systemOwned ?? false,
  };
}

function mergeAgentViewsIntoMembers(current: SleiMember[], agents: DesktopAgentView[], nodes: DesktopNodeView[], messages: DesktopMessages = createDesktopMessages("zh-CN")) {
  void current;
  return agents.map((agent) => memberFromAgentView(agent, nodes, messages));
}

async function loadGuideSkillsForMembers(bridge: DaemonBridge, members: SleiMember[]): Promise<SleiMember[]> {
  return Promise.all(
    members.map(async (member) => {
      if (member.type !== "agent" || member.skills || !isGuideMember(member)) return member;
      try {
        const receipt = await bridge.listAgentSkills(member.id);
        return { ...member, skills: receipt.skills };
      } catch {
        return member;
      }
    }),
  );
}

function isGuideMember(member: SleiMember): boolean {
  return member.id === "agent_guide_local_node" || member.handle.toLowerCase() === "@yeal";
}

function channelFromView(channel: ChannelView, messages: DesktopMessages): SleiChannel {
  return {
    id: channel.id,
    name: stripChannelHash(channel.name),
    description: channel.description ?? messages.chat.channel,
    unread: 0,
  };
}

function upsertConversation(conversations: ConversationView[], conversation: ConversationView) {
  return conversations.some((candidate) => candidate.id === conversation.id)
    ? conversations.map((candidate) => (candidate.id === conversation.id ? conversation : candidate))
    : [...conversations, conversation];
}

function createChannelTaskPlaceholder(outcome: SendChannelMessageOutcome, message: SleiMessage, members: SleiMember[]): SleiFixtures["tasks"][number] | null {
  if (!outcome.taskId) return null;
  const assignee = members.find((member) => member.id === outcome.assigneeAgentId);
  return {
    id: outcome.taskId,
    title: message.body.trim().split(/\n+/)[0]?.slice(0, 80) || "Untitled task",
    owner: assignee?.name ?? message.author,
    status: outcome.assigneeAgentId ? "in_progress" : "todo",
    channelId: message.channelId,
    sourceMessageId: message.id,
    replies: [{ id: `root-${message.id}`, sender: message.author, role: message.role, body: message.body }],
  };
}

async function loadSleiConversationMessages(
  bridge: DaemonBridge,
  conversations: ConversationView[],
  members: SleiMember[],
  profile: UserProfile,
) {
  const receipts = await Promise.all(conversations.map((conversation) => bridge.listConversationMessages(conversation.id)));
  return receipts.flatMap((receipt) => receipt.messages.map((message) => conversationMessageToSleiMessage(message, members, profile)));
}

async function loadSleiConversationSessions(bridge: DaemonBridge, conversations: ConversationView[]) {
  const receipts = await Promise.all(conversations.map((conversation) => bridge.listConversationSessions(conversation.id)));
  return receipts.flatMap((receipt) => receipt.sessions);
}

function currentBrowserView(): AppView {
  if (typeof window === "undefined") return "chat";
  return viewForPath(window.location.pathname);
}

export function SleiApp() {
  const [activeView, setActiveView] = useState<AppView>(() => currentBrowserView());
  const [data, setData] = useState(createSleiFixtures());
  const [activeChannelId, setActiveChannelId] = useState("all");
  const [activeConversationId, setActiveConversationId] = useState<string | undefined>(undefined);
  const [activeSessionId, setActiveSessionId] = useState<string | undefined>(undefined);
  const [activeMemberId, setActiveMemberId] = useState<string | undefined>(undefined);
  const [savedMessages, setSavedMessages] = useState<SavedMessageView[]>([]);
  const [focusedMessageId, setFocusedMessageId] = useState<string | undefined>(undefined);
  const [sessionDrawerOpen, setSessionDrawerOpen] = useState(false);
  const [sendingConversationIds, setSendingConversationIds] = useState<string[]>([]);
  const [profile, setProfile] = useState<UserProfile>(defaultProfile);
  const [locale, setLocale] = useState<AppLocale>("zh-CN");
  const [timeZone, setTimeZone] = useState(defaultTimeZone);
  const [appearance, setAppearance] = useState<AppearancePreferences>(defaultAppearance);
  const [notifications, setNotifications] = useState<NotificationPreferences>(defaultNotifications);
  const [sidebarWidth, setSidebarWidth] = useState(240);
  const [guideBootstrapping, setGuideBootstrapping] = useState(false);
  const [runtimeSetup, setRuntimeSetup] = useState<RuntimeSetupState>({
    loading: true,
    error: undefined,
    hasClaudeRuntimeReady: true,
    nodes: data.nodes,
  });
  const bridge = useMemo(() => createDaemonBridge(), []);
  const messages = createDesktopMessages(locale);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const route = routeForView(viewForPath(window.location.pathname));
    if (window.location.pathname !== route) {
      window.history.replaceState({}, "", route);
    }
    const handlePopState = () => {
      setActiveView(viewForPath(window.location.pathname));
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    let mounted = true;
    async function loadInitialState() {
      const [next, preferencesReceipt, savedReceipt] = await Promise.all([refreshRuntime(bridge), bridge.listPreferences(), bridge.listSavedMessages()]);
      if (!mounted) return;
      setRuntimeSetup(next);
      setLocale(preferencesReceipt.preferences.locale);
      setTimeZone(preferencesReceipt.preferences.timeZone);
      setAppearance(normalizeAppearance(preferencesReceipt.preferences.appearance));
      setNotifications(preferencesReceipt.preferences.notifications);
      setSavedMessages(savedReceipt.savedMessages);
      let activeConversation: string | undefined;
      if (hasReadyClaudeRuntime(next.nodes)) {
        setGuideBootstrapping(true);
        const guideReceipt = await bridge.bootstrapGuideAgent();
        activeConversation = guideReceipt.status === "created" ? guideReceipt.conversation?.id : undefined;
      }
      const [agentReceipt, conversationReceipt, channelReceipt] = await Promise.all([
        bridge.listAgents(),
        bridge.listConversations(),
        bridge.listChannels(),
      ]);
      if (!mounted) return;
      setGuideBootstrapping(false);
      const messagesForLocale = createDesktopMessages(preferencesReceipt.preferences.locale);
      const members = await loadGuideSkillsForMembers(
        bridge,
        mergeAgentViewsIntoMembers([], agentReceipt.agents, next.nodes, messagesForLocale),
      );
      const conversationSessions = await loadSleiConversationSessions(bridge, conversationReceipt.conversations);
      const conversationMessages = await loadSleiConversationMessages(bridge, conversationReceipt.conversations, members, profile);
      if (!mounted) return;
      setData((current) =>
        createSleiFixtures({
          ...current,
          nodes: next.nodes,
          channels: channelReceipt.channels.map((channel) => channelFromView(channel, messagesForLocale)),
          conversations: conversationReceipt.conversations,
          conversationSessions,
          messages: replaceConversationMessages(current.messages, conversationMessages, conversationReceipt.conversations.map((conversation) => conversation.id)),
          members,
        }),
      );
      setActiveMemberId((current) => current ?? members[0]?.id);
      if (activeConversation) {
        const conversation = conversationReceipt.conversations.find((candidate) => candidate.id === activeConversation);
        setActiveConversationId(activeConversation);
        setActiveSessionId(conversation?.activeSessionId);
        setActiveChannelId("all");
      }
    }
    loadInitialState()
      .catch((error: unknown) => {
        if (!mounted) return;
        setGuideBootstrapping(false);
        setRuntimeSetup({
          loading: false,
          error: error instanceof Error ? error.message : createDesktopMessages("zh-CN").common.runtimeCheckFailed,
          hasClaudeRuntimeReady: false,
          nodes: data.nodes,
        });
      });
    return () => {
      mounted = false;
    };
  }, [bridge]);

  useEffect(() => {
    if (!activeMemberId) return;
    const member = data.members.find((candidate) => candidate.id === activeMemberId);
    if (!member || member.type !== "agent" || member.skills) return;
    let mounted = true;
    bridge
      .listAgentSkills(activeMemberId)
      .then((receipt) => {
        if (!mounted) return;
        setData((current) =>
          createSleiFixtures({
            ...current,
            members: current.members.map((candidate) =>
              candidate.id === activeMemberId ? { ...candidate, skills: receipt.skills } : candidate,
            ),
          }),
        );
      })
      .catch(() => undefined);
    return () => {
      mounted = false;
    };
  }, [activeMemberId, bridge, data.members]);

  useEffect(() => {
    if (!activeConversationId) return;
    if (!shouldRefreshConversationMessages(data.messages, activeConversationId)) return;
    const refreshConversation = async () => {
      const receipt = await bridge.listConversationMessages(activeConversationId);
      const conversationMessages = receipt.messages.map((message) => conversationMessageToSleiMessage(message, data.members, profile));
      setData((current) =>
        createSleiFixtures({
          ...current,
          messages: replaceConversationMessages(current.messages, conversationMessages, [activeConversationId]),
        }),
      );
    };
    const interval = window.setInterval(() => {
      void refreshConversation();
    }, 300);
    return () => window.clearInterval(interval);
  }, [activeConversationId, bridge, data.members, data.messages, profile]);

  async function handleOpenAgentPath(agentId: string, target: AgentPathTarget) {
    await bridge.openAgentPath(agentId, target);
  }

  async function handleRenameLocalNode(name: string) {
    const receipt = await bridge.renameLocalNode(name);
    const nextNodes = data.nodes.map((node) => (node.id === receipt.node.id ? receipt.node : node));
    setData((current) => createSleiFixtures({ ...current, nodes: nextNodes }));
    setRuntimeSetup((current) => ({
      ...current,
      nodes: nextNodes,
      hasClaudeRuntimeReady: hasReadyClaudeRuntime(nextNodes),
    }));
  }

  async function handleRefreshRuntime() {
    setRuntimeSetup((current) => ({ ...current, loading: true, error: undefined }));
    const [next, preferencesReceipt, savedReceipt] = await Promise.all([refreshRuntime(bridge), bridge.listPreferences(), bridge.listSavedMessages()]);
    if (hasReadyClaudeRuntime(next.nodes)) {
      setGuideBootstrapping(true);
      await bridge.bootstrapGuideAgent();
      setGuideBootstrapping(false);
    }
    const [agentReceipt, conversationReceipt, channelReceipt] = await Promise.all([bridge.listAgents(), bridge.listConversations(), bridge.listChannels()]);
    setRuntimeSetup(next);
    setLocale(preferencesReceipt.preferences.locale);
    setTimeZone(preferencesReceipt.preferences.timeZone);
    setAppearance(normalizeAppearance(preferencesReceipt.preferences.appearance));
    setNotifications(preferencesReceipt.preferences.notifications);
    setSavedMessages(savedReceipt.savedMessages);
    const messagesForLocale = createDesktopMessages(preferencesReceipt.preferences.locale);
    const members = await loadGuideSkillsForMembers(
      bridge,
      mergeAgentViewsIntoMembers([], agentReceipt.agents, next.nodes, messagesForLocale),
    );
    const conversationSessions = await loadSleiConversationSessions(bridge, conversationReceipt.conversations);
    const conversationMessages = await loadSleiConversationMessages(bridge, conversationReceipt.conversations, members, profile);
    setData((current) =>
      createSleiFixtures({
        ...current,
        nodes: next.nodes,
        channels: channelReceipt.channels.map((channel) => channelFromView(channel, messagesForLocale)),
        conversations: conversationReceipt.conversations,
        conversationSessions,
        messages: replaceConversationMessages(current.messages, conversationMessages, conversationReceipt.conversations.map((conversation) => conversation.id)),
        members,
      }),
    );
    setActiveMemberId((current) => current ?? members[0]?.id);
  }

  async function handleCreateAgent(request: AgentDraftInput) {
    const receipt = await bridge.createAgent(request);
    const agentReceipt = await bridge.listAgents();
    const members = await loadGuideSkillsForMembers(
      bridge,
      mergeAgentViewsIntoMembers([], agentReceipt.agents, runtimeSetup.nodes, messages),
    );
    setData((current) => createSleiFixtures({ ...current, members }));
    setActiveMemberId(receipt.agent.id);
    navigateToView("members");
  }

  async function handleInteractiveCardComplete(cardId: string) {
    const receipt = await bridge.completeInteractiveCard(cardId);
    setData((current) =>
      createSleiFixtures({
        ...current,
        messages: current.messages.map((message) => ({
          ...message,
          cards: message.cards?.map((card) => (card.id === cardId ? receipt.card : card)),
        })),
      }),
    );
  }

  async function handlePermissionResolve(requestId: string, decision: PermissionDecision) {
    const receipt = await bridge.resolvePermission({ requestId, decision });
    const message = conversationMessageToSleiMessage(receipt.message, data.members, profile);
    setData((current) =>
      createSleiFixtures({
        ...current,
        messages: current.messages.some((candidate) => candidate.id === message.id)
          ? current.messages.map((candidate) => (candidate.id === message.id ? message : candidate))
          : [...current.messages, message],
      }),
    );
  }

  async function handleUpdateAgent(agentId: string, update: Partial<AgentDraftInput>) {
    const receipt = await bridge.updateAgent(agentId, update);
    const member = memberFromAgentView(receipt.agent, runtimeSetup.nodes, messages);
    setData((current) =>
      createSleiFixtures({
        ...current,
        members: current.members.map((candidate) => (candidate.id === member.id ? member : candidate)),
      }),
    );
  }

  async function handleDeleteAgent(agentId: string) {
    await bridge.deleteAgent(agentId);
    setData((current) => {
      const removedConversationIds = current.conversations
        .filter((conversation) => conversation.agentId === agentId)
        .map((conversation) => conversation.id);
      const removedConversationIdSet = new Set(removedConversationIds);
      return createSleiFixtures({
        ...current,
        members: current.members.filter((member) => member.id !== agentId),
        conversations: current.conversations.filter((conversation) => conversation.agentId !== agentId),
        conversationSessions: current.conversationSessions.filter((session) => !removedConversationIdSet.has(session.conversationId)),
        messages: current.messages.filter((message) => !message.channelId || !removedConversationIdSet.has(message.channelId)),
      });
    });
    setActiveMemberId((current) => {
      if (current !== agentId) return current;
      return data.members.find((member) => member.id !== agentId)?.id;
    });
    setActiveConversationId((current) => {
      const removed = data.conversations.find((conversation) => conversation.id === current && conversation.agentId === agentId);
      return removed ? undefined : current;
    });
    setActiveSessionId((current) => {
      const removed = data.conversationSessions.find((session) => session.id === current);
      if (!removed) return current;
      const conversation = data.conversations.find((candidate) => candidate.id === removed.conversationId);
      return conversation?.agentId === agentId ? undefined : current;
    });
  }

  function handleCreateComputer(name: string, osLabel: string) {
    const node = createDraftComputerNode(name, osLabel);
    setData((current) => createSleiFixtures({ ...current, nodes: [...current.nodes, node] }));
    setRuntimeSetup((current) => {
      const nextNodes = [...current.nodes, node];
      return {
        ...current,
        nodes: nextNodes,
        hasClaudeRuntimeReady: hasReadyClaudeRuntime(nextNodes),
      };
    });
  }

  function handleRenameComputer(nodeId: string, name: string) {
    setData((current) => createSleiFixtures({ ...current, nodes: renameComputerNode(current.nodes, nodeId, name) }));
    setRuntimeSetup((current) => {
      const nextNodes = renameComputerNode(current.nodes, nodeId, name);
      return {
        ...current,
        nodes: nextNodes,
        hasClaudeRuntimeReady: hasReadyClaudeRuntime(nextNodes),
      };
    });
  }

  function handleDeleteComputer(nodeId: string) {
    setData((current) => createSleiFixtures({ ...current, nodes: deleteComputerNode(current.nodes, nodeId) }));
    setRuntimeSetup((current) => {
      const nextNodes = deleteComputerNode(current.nodes, nodeId);
      return {
        ...current,
        nodes: nextNodes,
        hasClaudeRuntimeReady: hasReadyClaudeRuntime(nextNodes),
      };
    });
  }

  async function handleMessageMember(memberId: string) {
    const member = data.members.find((candidate) => candidate.id === memberId);
    if (member?.directMessageEnabled === false) return;
    const receipt = await bridge.createDmConversation(memberId);
    const sessionsReceipt = await bridge.listConversationSessions(receipt.conversation.id);
    const messagesReceipt = await bridge.listConversationMessages(receipt.conversation.id);
    const conversationMessages = messagesReceipt.messages.map((message) => conversationMessageToSleiMessage(message, data.members, profile));
    setData((current) =>
      createSleiFixtures({
        ...current,
        conversations: upsertConversation(current.conversations, receipt.conversation),
        conversationSessions: [
          ...current.conversationSessions.filter((session) => session.conversationId !== receipt.conversation.id),
          ...sessionsReceipt.sessions,
        ],
        messages: replaceConversationMessages(current.messages, conversationMessages, [receipt.conversation.id]),
      }),
    );
    setActiveConversationId(receipt.conversation.id);
    setActiveSessionId(receipt.conversation.activeSessionId ?? sessionsReceipt.sessions[0]?.id);
    setActiveChannelId("all");
    setActiveMemberId(memberId);
    navigateToView("chat");
  }

  async function handleCreateConversationSession(conversationId: string) {
    const receipt = await bridge.createConversationSession(conversationId);
    setData((current) =>
      createSleiFixtures({
        ...current,
        conversations: upsertConversation(current.conversations, receipt.conversation),
        conversationSessions: [
          ...current.conversationSessions.filter((session) => session.id !== receipt.session.id),
          receipt.session,
        ],
      }),
    );
    setActiveSessionId(receipt.session.id);
    setSessionDrawerOpen(false);
  }

  async function handleConversationSessionSelect(conversationId: string, sessionId: string) {
    const receipt = await bridge.activateConversationSession(conversationId, sessionId);
    const messagesReceipt = await bridge.listConversationMessages(conversationId);
    const conversationMessages = messagesReceipt.messages.map((message) => conversationMessageToSleiMessage(message, data.members, profile));
    setData((current) =>
      createSleiFixtures({
        ...current,
        conversations: upsertConversation(current.conversations, receipt.conversation),
        conversationSessions: current.conversationSessions.map((session) => (session.id === receipt.session.id ? receipt.session : session)),
        messages: replaceConversationMessages(current.messages, conversationMessages, [conversationId]),
      }),
    );
    setActiveConversationId(conversationId);
    setActiveSessionId(sessionId);
    setSessionDrawerOpen(false);
  }

  async function handleUploadConversationAttachment(request: ConversationAttachmentUploadRequest) {
    return bridge.uploadConversationAttachment(request);
  }

  async function handleSendMessage(body: string, options?: { asTask?: boolean; attachmentIds?: string[]; sessionId?: string }) {
    const targetId = activeConversationId ?? activeChannelId;
    const memoryRequest = detectAgentMemoryRequest(body, data.members);
    if (activeConversationId) {
      const attachmentIds = options?.attachmentIds ?? [];
      if (!body.trim() && attachmentIds.length === 0) return;
      setSendingConversationIds((current) => [...new Set([...current, activeConversationId])]);
      try {
        const result = await sendChatComposerMessage({
          activeChannelId,
          activeConversationId,
          activeSessionId: options?.sessionId ?? activeSessionId,
          attachmentIds,
          body,
          bridge,
          profile,
        });
        if (result.kind !== "conversation") return;
        const receipt = result.receipt;
        const conversationMessage = conversationMessageToSleiMessage(receipt.message, data.members, profile);
        if (memoryRequest) {
          void bridge.rememberAgentFact(memoryRequest.agentId, memoryRequest.fact);
          const agent = data.members.find((member) => member.id === memoryRequest.agentId);
          const systemMessage: SleiMessage = {
            id: `memory-${Date.now()}`,
            author: messages.common.system,
            role: "system",
            time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
            body: messages.chat.memoryUpdated(agent?.handle ?? messages.agentCreate.fallbackAgent),
            channelId: targetId,
            sessionId: options?.sessionId ?? activeSessionId,
            status: "done",
            toolCall: "remember_agent_fact",
          };
          setData((current) => createSleiFixtures({ ...current, messages: [...current.messages, conversationMessage, systemMessage] }));
          return;
        }
        setData((current) => {
          const nextTasks = options?.asTask ? [...current.tasks, createTaskFromChatMessage(conversationMessage, targetId)] : current.tasks;
          return createSleiFixtures({ ...current, messages: [...current.messages, conversationMessage], tasks: nextTasks });
        });
        const messagesReceipt = await bridge.listConversationMessages(activeConversationId);
        const conversationMessages = messagesReceipt.messages.map((message) => conversationMessageToSleiMessage(message, data.members, profile));
        setData((current) =>
          createSleiFixtures({
            ...current,
            messages: replaceConversationMessages(current.messages, conversationMessages, [activeConversationId]),
          }),
        );
      } finally {
        setSendingConversationIds((current) => current.filter((id) => id !== activeConversationId));
      }
        return;
    }
    const message = createLocalChatMessage({ body, messages, profile, channelId: targetId });
    if (!message) return;
    const result = await sendChatComposerMessage({
      activeChannelId,
      body,
      bridge,
      profile,
    });
    if (result.kind !== "channel") return;
    const channelMessage = { ...message, id: result.receipt.outcome.messageId };
    if (memoryRequest) {
      void bridge.rememberAgentFact(memoryRequest.agentId, memoryRequest.fact);
      const agent = data.members.find((member) => member.id === memoryRequest.agentId);
      const systemMessage: SleiMessage = {
        id: `memory-${channelMessage.id}`,
        author: messages.common.system,
        role: "system",
        time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        body: messages.chat.memoryUpdated(agent?.handle ?? messages.agentCreate.fallbackAgent),
        channelId: targetId,
        status: "done",
        toolCall: "remember_agent_fact",
      };
      setData((current) => createSleiFixtures({ ...current, messages: [...current.messages, channelMessage, systemMessage] }));
      return;
    }

    setData((current) => {
      const task = createChannelTaskPlaceholder(result.receipt.outcome, channelMessage, current.members);
      const nextTasks = task && !current.tasks.some((candidate) => candidate.id === task.id) ? [...current.tasks, task] : current.tasks;
      return createSleiFixtures({ ...current, messages: [...current.messages, channelMessage], tasks: nextTasks });
    });
  }

  function handleTaskReply(taskId: string, body: string) {
    setData((current) => createSleiFixtures({ ...current, tasks: appendTaskReply(current.tasks, taskId, { sender: profile.displayName, role: "human", body }) }));
  }

  async function handleCreateChannel(input: { name: string; projectName?: string; agentIds?: string[] }) {
    const name = stripChannelHash(input.name);
    if (!name) return;
    const projectName = input.projectName?.trim() || undefined;
    const receipt = await bridge.createChannel({
      name,
      description: projectName,
      agentIds: input.agentIds ?? [],
    });
    const channel = { ...channelFromView(receipt.channel, messages), projectName };
    setData((current) => {
      if (current.channels.some((candidate) => candidate.id === channel.id || candidate.name === channel.name)) return current;
      return createSleiFixtures({ ...current, channels: [...current.channels, channel] });
    });
    setActiveChannelId(channel.id);
  }

  function handleDeleteChannel(channelId: string) {
    if (channelId === "all") return;
    setData((current) =>
      createSleiFixtures({
        ...current,
        channels: current.channels.filter((channel) => channel.id !== channelId),
        messages: current.messages.filter((message) => (message.channelId ?? "all") !== channelId),
      }),
    );
    setActiveChannelId((current) => (current === channelId ? "all" : current));
  }

  function handleSearchResultSelect(channelId: string) {
    setActiveChannelId(channelId);
    setActiveConversationId(undefined);
    setActiveSessionId(undefined);
    navigateToView("chat");
  }

  async function handleMessageSaveToggle(message: SleiMessage) {
    const existing = savedMessages.find((saved) => saved.messageId === message.id);
    if (existing) {
      await bridge.unsaveMessage(message.id);
      setSavedMessages((current) => current.filter((saved) => saved.messageId !== message.id));
      return;
    }

    const sourceId = message.channelId ?? activeConversationId ?? activeChannelId;
    const request: SaveMessageRequest = {
      messageId: message.id,
      sourceId,
      sourceKind: sourceId.startsWith("dm:") || activeConversationId ? "dm" : "channel",
      sessionId: message.sessionId,
    };
    const receipt = await bridge.saveMessage(request);
    setSavedMessages((current) =>
      current.some((saved) => saved.messageId === receipt.savedMessage.messageId)
        ? current
        : [receipt.savedMessage, ...current],
    );
  }

  function handleSavedMessageSelect(savedMessage: SavedMessageView) {
    if (savedMessage.sourceKind === "dm" || savedMessage.sourceId.startsWith("dm:")) {
      const conversation = data.conversations.find((candidate) => candidate.id === savedMessage.sourceId);
      setActiveConversationId(savedMessage.sourceId);
      setActiveSessionId(savedMessage.sessionId ?? conversation?.activeSessionId);
      setActiveChannelId("all");
    } else {
      setActiveChannelId(savedMessage.sourceId);
      setActiveConversationId(undefined);
      setActiveSessionId(undefined);
    }
    setSessionDrawerOpen(false);
    setFocusedMessageId(undefined);
    window.setTimeout(() => setFocusedMessageId(savedMessage.messageId), 0);
    navigateToView("chat");
  }

  async function handleLocaleChange(nextLocale: AppLocale) {
    setLocale(nextLocale);
    const receipt = await bridge.updatePreferences({ locale: nextLocale });
    setLocale(receipt.preferences.locale);
    setTimeZone(receipt.preferences.timeZone);
    setAppearance(normalizeAppearance(receipt.preferences.appearance));
    setNotifications(receipt.preferences.notifications);
  }

  async function handleTimeZoneChange(nextTimeZone: string) {
    setTimeZone(nextTimeZone);
    const receipt = await bridge.updatePreferences({ timeZone: nextTimeZone });
    setLocale(receipt.preferences.locale);
    setTimeZone(receipt.preferences.timeZone);
    setAppearance(normalizeAppearance(receipt.preferences.appearance));
    setNotifications(receipt.preferences.notifications);
  }

  async function handleAppearanceChange(nextAppearance: AppearancePreferences) {
    const normalizedAppearance = normalizeAppearance(nextAppearance);
    setAppearance(normalizedAppearance);
    const receipt = await bridge.updatePreferences({ appearance: normalizedAppearance });
    setLocale(receipt.preferences.locale);
    setTimeZone(receipt.preferences.timeZone);
    setAppearance(normalizeAppearance(receipt.preferences.appearance));
    setNotifications(receipt.preferences.notifications);
  }

  async function handleNotificationsChange(nextNotifications: NotificationPreferences) {
    setNotifications(nextNotifications);
    const receipt = await bridge.updatePreferences({ notifications: nextNotifications });
    setLocale(receipt.preferences.locale);
    setTimeZone(receipt.preferences.timeZone);
    setAppearance(normalizeAppearance(receipt.preferences.appearance));
    setNotifications(receipt.preferences.notifications);
  }

  function handleResizeStart(event: ReactPointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = sidebarWidth;
    const handleMove = (moveEvent: PointerEvent) => {
      const nextWidth = Math.min(340, Math.max(160, startWidth + moveEvent.clientX - startX));
      setSidebarWidth(nextWidth);
    };
    const handleUp = () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
  }

  function navigateToView(view: AppView, options: { replace?: boolean } = {}) {
    setActiveView(view);
    if (typeof window === "undefined") return;
    const route = routeForView(view);
    if (window.location.pathname === route) return;
    if (options.replace) {
      window.history.replaceState({}, "", route);
    } else {
      window.history.pushState({}, "", route);
    }
  }

  return (
    <SleiAppFrame
      activeView={activeView}
      activeChannelId={activeChannelId}
      activeConversationId={activeConversationId}
      activeSessionId={activeSessionId}
      activeMemberId={activeMemberId}
      focusedMessageId={focusedMessageId}
      data={data}
      guideBootstrapping={guideBootstrapping}
      onAgentCreate={handleCreateAgent}
      onAgentDelete={handleDeleteAgent}
      onAgentUpdate={handleUpdateAgent}
      locale={locale}
      timeZone={timeZone}
      appearance={appearance}
      notifications={notifications}
      onChannelCreate={handleCreateChannel}
      onChannelDelete={handleDeleteChannel}
      onInteractiveCardComplete={handleInteractiveCardComplete}
      onPermissionResolve={handlePermissionResolve}
      onChannelSelect={(channelId) => {
        setActiveChannelId(channelId);
        setActiveConversationId(undefined);
        setActiveSessionId(undefined);
      }}
      onComputerCreate={handleCreateComputer}
      onComputerDelete={handleDeleteComputer}
      onComputerRename={handleRenameComputer}
      onProfileChange={setProfile}
      onLocaleChange={handleLocaleChange}
      onTimeZoneChange={handleTimeZoneChange}
      onAppearanceChange={handleAppearanceChange}
      onNotificationsChange={handleNotificationsChange}
      onRefreshRuntime={handleRefreshRuntime}
      onRenameLocalNode={handleRenameLocalNode}
      onResizeStart={handleResizeStart}
      onSearchResultSelect={handleSearchResultSelect}
      onSearchToggle={() => navigateToView("search")}
      onSavedMessageSelect={handleSavedMessageSelect}
      onMessageSaveToggle={handleMessageSaveToggle}
      onSendMessage={handleSendMessage}
      onAttachmentUpload={handleUploadConversationAttachment}
      onTaskReply={handleTaskReply}
      onViewChange={navigateToView}
      onMemberSelect={setActiveMemberId}
      onMemberMessage={handleMessageMember}
      onOpenAgentPath={handleOpenAgentPath}
      onConversationNewSession={handleCreateConversationSession}
      onConversationHistoryToggle={() => setSessionDrawerOpen((current) => !current)}
      onConversationSelect={(conversationId) => {
        const conversation = data.conversations.find((candidate) => candidate.id === conversationId);
        setActiveConversationId(conversationId);
        setActiveSessionId(conversation?.activeSessionId);
        navigateToView("chat");
      }}
      onConversationSessionSelect={handleConversationSessionSelect}
      profile={profile}
      runtimeSetup={runtimeSetup}
      savedMessages={savedMessages}
      sessionDrawerOpen={sessionDrawerOpen}
      sendingConversationIds={sendingConversationIds}
      sidebarWidth={sidebarWidth}
    />
  );
}

async function refreshRuntime(bridge: DaemonBridge): Promise<RuntimeSetupState> {
  const receipt = await bridge.refreshRuntimeStatus();
  return {
    loading: false,
    error: undefined,
    hasClaudeRuntimeReady: hasReadyClaudeRuntime(receipt.nodes),
    nodes: receipt.nodes,
  };
}

function hasReadyClaudeRuntime(nodes: DesktopNodeView[]) {
  return nodes.some((node) =>
    node.runtimes.some((runtime) => runtime.kind === "ClaudeCode" && runtime.readiness === "ready"),
  );
}

export {
  channelDraftCreateInput,
  resetChannelDraft,
  SleiAppFrame,
  toggleChannelDraftAgent,
} from "./SleiAppFrame";
