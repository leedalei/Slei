import { type CSSProperties, type FormEvent, type PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  ArrowDown,
  ArrowUpDown,
  AtSign,
  Bell,
  Bookmark,
  CheckSquare,
  CircleUserRound,
  ExternalLink,
  FileText,
  FolderOpen,
  Globe2,
  Hash,
  History,
  Image as ImageIcon,
  Info,
  ListTodo,
  MessageCircle,
  MessageSquare,
  Monitor,
  Paperclip,
  Palette,
  Plus,
  Search,
  Send,
  Server,
  Settings,
  Trash2,
  X,
  type LucideIcon,
} from "lucide-react";

import {
  type AppearancePreferences,
  type AppLocale,
  type ConversationAttachmentUploadRequest,
  type ConversationAttachmentView,
  type ConversationView,
  type DesktopNodeView,
  type InteractiveCardView,
  type NotificationPreferences,
  type AgentPathTarget,
  type RuntimeSetupState,
} from "../lib/daemon-bridge";
import { createDesktopMessages, type DesktopMessages } from "../i18n";
import { ChatPage } from "../features/chat/ChatPageView";
import { ComputersPage } from "../features/computers/ComputersPageView";
import { MembersPage } from "../features/members/MembersPageView";
import { SearchPage } from "../features/search/SearchPageView";
import { SettingsPage } from "../features/settings/SettingsPageView";
import { TasksPage } from "../features/tasks/TasksPageView";
import { CheckboxControl, EditableDetailField, Empty, MemberAvatar, MessageStatusSquare, SelectControl, StatusDot } from "../components";
import { type SleiFixtures, type SleiMember, type SleiTask } from "./fixtures";
import {
  defaultAppearance,
  defaultNotifications,
  defaultProfile,
  defaultTimeZone,
  deviceOsLabel,
  stripChannelHash,
  type AgentDraftInput,
  type AppView,
  type ChatSearchFilters,
  type SettingsPanel,
  type UserProfile,
} from "./model";
import sleiSquareLogo from "../../src-tauri/icons/Square44x44Logo.png";

const navItems: Array<{ id: Exclude<AppView, "search">; icon: LucideIcon }> = [
  { id: "chat", icon: MessageCircle },
  { id: "tasks", icon: ListTodo },
  { id: "members", icon: AtSign },
  { id: "computers", icon: Monitor },
  { id: "settings", icon: Settings },
];

export function SleiAppFrame(input: {
  activeView: AppView;
  activeChannelId?: string;
  activeConversationId?: string;
  activeSessionId?: string;
  activeMemberId?: string;
  activeTaskId?: string;
  data: SleiFixtures;
  initialChatDraft?: string;
  initialComposerAttachments?: ConversationAttachmentView[];
  initialConversationHistoryOpen?: boolean;
  initialAgentCreateModalOpen?: boolean;
  initialCreateChannelModalOpen?: boolean;
  initialWindowCloseConfirmOpen?: boolean;
  guideBootstrapping?: boolean;
  initialSettingsPanel?: SettingsPanel;
  initialSearchFilters?: ChatSearchFilters;
  locale: AppLocale;
  timeZone?: string;
  appearance?: AppearancePreferences;
  notifications?: NotificationPreferences;
  profile?: UserProfile;
  runtimeSetup: RuntimeSetupState;
  searchOpen?: boolean;
  sessionDrawerOpen?: boolean;
  sendingConversationIds?: string[];
  sidebarWidth?: number;
  onAgentCreate?: (request: AgentDraftInput) => Promise<void> | void;
  onAgentUpdate?: (agentId: string, update: Partial<AgentDraftInput>) => Promise<void> | void;
  onChannelCreate?: (input: { name: string; projectName?: string }) => Promise<void> | void;
  onChannelDelete?: (channelId: string) => void;
  onChannelSelect?: (channelId: string) => void;
  onConversationNewSession?: (conversationId: string) => Promise<void> | void;
  onConversationHistoryToggle?: () => void;
  onConversationSessionSelect?: (conversationId: string, sessionId: string) => Promise<void> | void;
  onAttachmentUpload?: (request: ConversationAttachmentUploadRequest) => Promise<{ attachment: ConversationAttachmentView }>;
  onInteractiveCardComplete?: (cardId: string) => Promise<void> | void;
  onConversationSelect?: (conversationId: string) => void;
  onComputerCreate?: (name: string, osLabel: string) => void;
  onComputerDelete?: (nodeId: string) => void;
  onComputerRename?: (nodeId: string, name: string) => void;
  onAppearanceChange?: (appearance: AppearancePreferences) => Promise<void> | void;
  onLocaleChange?: (locale: AppLocale) => Promise<void> | void;
  onTimeZoneChange?: (timeZone: string) => Promise<void> | void;
  onNotificationsChange?: (notifications: NotificationPreferences) => Promise<void> | void;
  onProfileChange?: (profile: UserProfile) => void;
  onResizeStart?: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onSearchResultSelect?: (channelId: string, messageId: string) => void;
  onSearchToggle?: () => void;
  onMemberSelect?: (memberId: string) => void;
  onMemberMessage?: (memberId: string) => void;
  onOpenAgentPath?: (agentId: string, target: AgentPathTarget) => Promise<void> | void;
  onSendMessage?: (body: string, options?: { asTask?: boolean; attachmentIds?: string[]; sessionId?: string }) => Promise<void> | void;
  onTaskReply?: (taskId: string, body: string) => void;
  onViewChange?: (view: AppView) => void;
  onRenameLocalNode?: (name: string) => Promise<void> | void;
  onRefreshRuntime?: () => Promise<void> | void;
}) {
  const activeChannel = input.data.channels.find((channel) => channel.id === input.activeChannelId) ?? input.data.channels[0];
  const activeConversation = input.data.conversations.find((conversation) => conversation.id === input.activeConversationId);
  const activeSessionId = input.activeSessionId ?? activeConversation?.activeSessionId;
  const firstComputer = input.runtimeSetup.nodes[0];
  const [activeComputerId, setActiveComputerId] = useState(firstComputer?.id ?? "");
  const [computerCreateOpen, setComputerCreateOpen] = useState(false);
  const [agentCreateOpen, setAgentCreateOpen] = useState(input.initialAgentCreateModalOpen ?? false);
  const [activeSettingsPanel, setActiveSettingsPanel] = useState<SettingsPanel>(input.initialSettingsPanel ?? "account");
  const [agentDraft, setAgentDraft] = useState<Partial<AgentDraftInput> | undefined>(undefined);
  const [activeCardId, setActiveCardId] = useState<string | undefined>(undefined);
  const profile = input.profile ?? defaultProfile;
  const appearance = input.appearance ?? defaultAppearance;
  const messages = createDesktopMessages(input.locale);
  const shellStyle = {
    "--slei-sidebar-width": `${input.sidebarWidth ?? 240}px`,
    "--slei-font-size": fontSizeValue(appearance.fontSize),
  } as CSSProperties;

  useEffect(() => {
    if (input.runtimeSetup.nodes.some((node) => node.id === activeComputerId)) return;
    setActiveComputerId(firstComputer?.id ?? "");
  }, [activeComputerId, firstComputer?.id, input.runtimeSetup.nodes]);

  return (
    <div className="slei-shell" data-active-view={input.activeView} data-theme={appearance.theme} style={shellStyle}>
      <nav className="slei-rail" data-tauri-drag-region="deep" aria-label={messages.shell.mainNavigation}>
        <div className="slei-brand">
          <img alt="Slei" className="slei-brand__logo" src={sleiSquareLogo} />
        </div>
        {navItems.map((item) => (
          <button
            aria-label={messages.shell.nav[item.id]}
            aria-current={input.activeView === item.id ? "page" : undefined}
            className="slei-rail__button"
            data-nav-icon={item.id}
            key={item.id}
            onClick={() => input.onViewChange?.(item.id)}
            title={messages.shell.nav[item.id]}
            type="button"
          >
            <item.icon aria-hidden="true" size={20} strokeWidth={2.8} />
          </button>
        ))}
      </nav>

      <aside className="slei-context-sidebar">
        <WindowControls initialCloseConfirmOpen={input.initialWindowCloseConfirmOpen} messages={messages} />
        <div className="slei-sidebar__header" data-tauri-drag-region="deep">
          <strong>{messages.shell.sidebarTitle[input.activeView]}</strong>
          <span>{messages.shell.sidebarSubtitle[input.activeView]}</span>
        </div>
        {input.activeView === "chat" || input.activeView === "search" ? (
          <ChannelList
            activeChannelId={input.activeConversationId ? undefined : activeChannel.id}
            activeConversationId={input.activeConversationId}
            data={input.data}
            initialCreateChannelModalOpen={input.initialCreateChannelModalOpen}
            onChannelCreate={input.onChannelCreate}
            onChannelDelete={input.onChannelDelete}
            onChannelSelect={input.onChannelSelect}
            onConversationSelect={input.onConversationSelect}
            onSearchToggle={input.onSearchToggle}
            searchOpen={input.activeView === "search"}
            messages={messages}
          />
        ) : input.activeView === "members" ? (
          <MembersNavigator
            activeMemberId={input.activeMemberId}
            data={input.data}
            messages={messages}
            onCreateAgentRequest={() => setAgentCreateOpen(true)}
            onSelect={input.onMemberSelect}
          />
        ) : input.activeView === "computers" ? (
          <ComputersNavigator
            activeNodeId={activeComputerId}
            messages={messages}
            nodes={input.runtimeSetup.nodes}
            onAdd={() => setComputerCreateOpen(true)}
            onDelete={input.onComputerDelete}
            onSelect={setActiveComputerId}
          />
        ) : input.activeView === "settings" ? (
          <SettingsNavigator activePanel={activeSettingsPanel} messages={messages} onSelect={setActiveSettingsPanel} />
        ) : <ContextPanel activeView={input.activeView} data={input.data} messages={messages} />}
      </aside>

      <button
        aria-label={messages.common.resizeSidebar}
        aria-orientation="vertical"
        className="slei-resize-handle"
        onPointerDown={input.onResizeStart}
        role="separator"
        type="button"
      />

      <main className="slei-workspace">{renderWorkspace(input.activeView, input.data, activeChannel, activeConversation, activeSessionId, input.runtimeSetup, profile, input.locale, messages, input.timeZone ?? defaultTimeZone, appearance, input.notifications ?? defaultNotifications, activeSettingsPanel, input.onProfileChange, input.onLocaleChange, input.onTimeZoneChange, input.onAppearanceChange, input.onNotificationsChange, input.onSendMessage, input.initialChatDraft, input.initialComposerAttachments, input.initialSearchFilters, input.onSearchResultSelect, activeComputerId, () => setComputerCreateOpen(true), input.onComputerRename, input.activeMemberId, input.activeTaskId, input.onTaskReply, input.onAgentUpdate, input.onMemberMessage, input.onOpenAgentPath, input.onConversationNewSession, input.onConversationHistoryToggle, input.onConversationSessionSelect, input.onAttachmentUpload, input.sessionDrawerOpen ?? input.initialConversationHistoryOpen, input.sendingConversationIds ?? [], (draft, cardId) => {
        setAgentDraft(draft);
        setActiveCardId(cardId);
        setAgentCreateOpen(true);
      }, async (draft, cardId) => {
        await input.onChannelCreate?.({ name: String(draft.name ?? ""), projectName: typeof draft.projectName === "string" ? draft.projectName : undefined });
        if (cardId) await input.onInteractiveCardComplete?.(cardId);
      })}</main>

      {computerCreateOpen ? (
        <ComputerCreateModal
          messages={messages}
          onClose={() => setComputerCreateOpen(false)}
          onCreate={(name, osLabel) => {
            input.onComputerCreate?.(name, osLabel);
            setComputerCreateOpen(false);
          }}
        />
      ) : null}

      {agentCreateOpen ? (
        <AgentCreateModal
          draft={agentDraft}
          messages={messages}
          nodes={input.runtimeSetup.nodes}
          onClose={() => {
            setAgentCreateOpen(false);
            setAgentDraft(undefined);
            setActiveCardId(undefined);
          }}
          onCreate={async (request) => {
            await input.onAgentCreate?.(request);
            if (activeCardId) await input.onInteractiveCardComplete?.(activeCardId);
            setAgentCreateOpen(false);
            setAgentDraft(undefined);
            setActiveCardId(undefined);
          }}
        />
      ) : null}

      {!input.runtimeSetup.hasClaudeRuntimeReady ? (
        <RuntimeOnboardingModal
          loading={input.runtimeSetup.loading}
          messages={messages}
          nodes={input.runtimeSetup.nodes}
          onRefreshRuntime={input.onRefreshRuntime}
          onRenameLocalNode={input.onRenameLocalNode}
        />
      ) : null}

      {input.guideBootstrapping ? (
        <div className="slei-modal-backdrop" role="presentation">
          <section aria-live="polite" className="slei-dialog slei-guide-loading" role="status">
            <h2>{messages.onboarding.creatingGuide}</h2>
          </section>
        </div>
      ) : null}
    </div>
  );
}

export type WindowAction = "close" | "minimize" | "toggleMaximize";

type DesktopWindowControlsHandle = {
  close: () => Promise<void>;
  minimize: () => Promise<void>;
  toggleMaximize: () => Promise<void>;
};

export function runWindowAction(input: { action: WindowAction; currentWindow?: DesktopWindowControlsHandle }) {
  if (!input.currentWindow) return;

  const operation =
    input.action === "close"
      ? input.currentWindow.close()
      : input.action === "minimize"
        ? input.currentWindow.minimize()
        : input.currentWindow.toggleMaximize();
  void operation.catch(() => undefined);
}

function WindowControls({ initialCloseConfirmOpen, messages }: { initialCloseConfirmOpen?: boolean; messages: DesktopMessages }) {
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(initialCloseConfirmOpen ?? false);

  function runTauriWindowAction(action: WindowAction) {
    if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) return;
    runWindowAction({
      action,
      currentWindow: getCurrentWindow(),
    });
  }

  return (
    <>
      <div className="slei-window-controls" data-tauri-drag-region="deep">
        <button
          aria-label={messages.common.minimizeWindow}
          className="slei-window-control slei-window-control--minimize"
          onClick={() => runTauriWindowAction("minimize")}
          title={messages.common.minimizeWindow}
          type="button"
        >
          <span aria-hidden="true" className="slei-window-control__glyph" />
        </button>
        <button
          aria-label={messages.common.maximizeWindow}
          className="slei-window-control slei-window-control--maximize"
          onClick={() => runTauriWindowAction("toggleMaximize")}
          title={messages.common.maximizeWindow}
          type="button"
        >
          <span aria-hidden="true" className="slei-window-control__glyph" />
        </button>
        <button
          aria-label={messages.common.closeWindow}
          className="slei-window-control slei-window-control--close"
          onClick={() => setCloseConfirmOpen(true)}
          title={messages.common.closeWindow}
          type="button"
        >
          <span aria-hidden="true" className="slei-window-control__glyph" />
        </button>
      </div>
      {closeConfirmOpen ? (
        <WindowCloseConfirmModal
          messages={messages}
          onCancel={() => setCloseConfirmOpen(false)}
          onConfirm={() => {
            setCloseConfirmOpen(false);
            runTauriWindowAction("close");
          }}
        />
      ) : null}
    </>
  );
}

function WindowCloseConfirmModal(input: { messages: DesktopMessages; onCancel: () => void; onConfirm: () => void }) {
  return (
    <div className="slei-modal-backdrop" role="presentation">
      <section aria-modal="true" className="slei-dialog slei-window-close-confirm" role="dialog">
        <header>
          <h2>{input.messages.common.confirmCloseWindow}</h2>
        </header>
        <div className="slei-modal-actions">
          <button className="slei-button" onClick={input.onCancel} type="button">{input.messages.common.cancel}</button>
          <button className="slei-button slei-button--accent" onClick={input.onConfirm} type="button">{input.messages.common.closeWindow}</button>
        </div>
      </section>
    </div>
  );
}

function ChannelList(input: {
  activeChannelId?: string;
  activeConversationId?: string;
  data: SleiFixtures;
  initialCreateChannelModalOpen?: boolean;
  messages: DesktopMessages;
  searchOpen?: boolean;
  onChannelCreate?: (input: { name: string; projectName?: string }) => Promise<void> | void;
  onChannelDelete?: (channelId: string) => void;
  onChannelSelect?: (channelId: string) => void;
  onConversationSelect?: (conversationId: string) => void;
  onSearchToggle?: () => void;
}) {
  const [name, setName] = useState("");
  const [projectName, setProjectName] = useState("");
  const [createOpen, setCreateOpen] = useState(input.initialCreateChannelModalOpen ?? false);
  const directMessageConversations = input.data.conversations.filter((conversation) => conversation.kind === "dm");

  function submitChannel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    input.onChannelCreate?.({ name, projectName });
    setName("");
    setProjectName("");
    setCreateOpen(false);
  }

  return (
    <div className="slei-channel-list">
      <div className="slei-sidebar-tools">
        <button aria-pressed={input.searchOpen ? "true" : "false"} className="slei-sidebar-tool" onClick={input.onSearchToggle} type="button"><Search aria-hidden="true" size={14} /> {input.messages.common.search} <span>Command K</span></button>
        <button className="slei-sidebar-tool" type="button"><Bookmark aria-hidden="true" size={14} /> {input.messages.common.saved}</button>
      </div>
      <div className="slei-channel-group-header">
        <span>{input.messages.chat.channels} {input.data.channels.length}</span>
        <div><button aria-label={input.messages.chat.sortChannels} type="button"><ArrowUpDown aria-hidden="true" size={14} /></button><button aria-label={input.messages.chat.createChannel} onClick={() => setCreateOpen(true)} type="button"><Plus aria-hidden="true" size={14} /></button></div>
      </div>
      {input.data.channels.map((channel) => (
        <div className="slei-channel-row" key={channel.id}>
          <button
            aria-current={input.activeChannelId === channel.id ? "true" : undefined}
            className="slei-channel"
            onClick={() => input.onChannelSelect?.(channel.id)}
            type="button"
          >
            <span><Hash aria-hidden="true" size={14} />{stripChannelHash(channel.name)}</span>
            {channel.unread > 0 ? <b>{channel.unread}</b> : null}
            <small>{channel.projectName ? input.messages.chat.projectPrefix(channel.projectName) : channel.description}</small>
          </button>
          {channel.id !== "all" ? (
            <button aria-label={input.messages.chat.deleteChannel(stripChannelHash(channel.name))} className="slei-channel-delete" onClick={() => input.onChannelDelete?.(channel.id)} type="button"><Trash2 aria-hidden="true" size={14} /></button>
          ) : null}
        </div>
      ))}
      <div className="slei-channel-group-header"><span>{input.messages.chat.directMessages} {directMessageConversations.length}</span><div><button aria-label={input.messages.chat.sortDirectMessages} type="button"><ArrowUpDown aria-hidden="true" size={14} /></button></div></div>
      {directMessageConversations.map((conversation) => {
        const member = input.data.members.find((candidate) => candidate.id === conversation.agentId && candidate.type === "agent");
        if (!member) return null;
        const conversationId = conversation.id;
        return (
          <button
            aria-current={input.activeConversationId === conversationId ? "true" : undefined}
            className="slei-channel slei-channel--dm"
            key={conversation.id}
            onClick={() => input.onConversationSelect?.(conversationId)}
            type="button"
          >
            <span><MemberAvatar identity={member} />{member.name}</span>
            <small>{member.handle}</small>
          </button>
        );
      })}
      {createOpen ? (
        <div className="slei-modal-backdrop" role="presentation">
          <section aria-modal="true" className="slei-dialog slei-channel-modal" role="dialog">
            <header>
              <h2><Hash aria-hidden="true" size={20} />{input.messages.chat.createChannel}</h2>
              <p>{input.messages.chat.createChannelDescription}</p>
            </header>
            <form className="slei-channel-modal__form" onSubmit={submitChannel}>
              <label className="slei-field">
                <span>{input.messages.chat.channelName}</span>
                <input aria-label={input.messages.chat.channelName} className="slei-input" onChange={(event) => setName(event.currentTarget.value)} placeholder="dev-team" value={name} />
              </label>
              <label className="slei-field">
                <span>{input.messages.chat.project}</span>
                <input aria-label={input.messages.chat.project} className="slei-input" onChange={(event) => setProjectName(event.currentTarget.value)} placeholder="Slei Desktop" value={projectName} />
              </label>
              <div className="slei-modal-actions">
                <button className="slei-button" onClick={() => setCreateOpen(false)} type="button">{input.messages.common.cancel}</button>
                <button className="slei-button slei-button--accent" type="submit"><Plus aria-hidden="true" size={14} />{input.messages.common.create}</button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </div>
  );
}

function ContextPanel({ activeView, data, messages }: { activeView: AppView; data: SleiFixtures; messages: DesktopMessages }) {
  return (
    <div className="slei-context-stack">
      <div className="slei-section-label">{messages.shell.sectionLabel[activeView]}</div>
      <div className="slei-mini-card">
        <strong>{data.tasks.filter((task) => task.attention).length}</strong>
        <span>{messages.shell.attentionNeeded}</span>
      </div>
      <div className="slei-mini-card">
        <strong>{data.nodes.length}</strong>
        <span>{messages.shell.connectedComputers}</span>
      </div>
      <div className="slei-mini-card">
        <strong>{data.members.filter((member) => member.type === "agent").length}</strong>
        <span>{messages.shell.availableAgents}</span>
      </div>
    </div>
  );
}

const settingsMenu: Array<{
  title: "person" | "server" | "about";
  items: Array<{ id: SettingsPanel; labelKey: "account" | "languageRegion" | "appearance" | "notifications" | "about"; icon: LucideIcon }>;
}> = [
  {
    title: "person",
    items: [
      { id: "account", labelKey: "account", icon: CircleUserRound },
      { id: "language-region", labelKey: "languageRegion", icon: Globe2 },
      { id: "appearance", labelKey: "appearance", icon: Palette },
      { id: "notifications", labelKey: "notifications", icon: Bell },
    ],
  },
  {
    title: "server",
    items: [],
  },
  {
    title: "about",
    items: [{ id: "about", labelKey: "about", icon: Info }],
  },
];

function SettingsNavigator(input: {
  activePanel: SettingsPanel;
  messages: DesktopMessages;
  onSelect?: (panel: SettingsPanel) => void;
}) {
  return (
    <div className="slei-settings-nav" aria-label={input.messages.settings.title}>
      {settingsMenu.map((group) => (
        <div className="slei-settings-nav__group" key={group.title}>
          <div className="slei-settings-nav__label">{input.messages.settings.groups[group.title]}</div>
          {group.items.length === 0 ? (
            <p className="slei-settings-nav__empty"><Server aria-hidden="true" size={14} />{input.messages.settings.serverReserved}</p>
          ) : null}
          {group.items.map((item) => (
            <button
              aria-current={input.activePanel === item.id ? "page" : undefined}
              className="slei-settings-nav__item"
              key={item.id}
              onClick={() => input.onSelect?.(item.id)}
              type="button"
            >
              <item.icon aria-hidden="true" data-settings-icon={item.id} size={15} strokeWidth={2.8} />
              <span>{input.messages.settings[item.labelKey]}</span>
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

function MembersNavigator(input: {
  activeMemberId?: string;
  data: SleiFixtures;
  messages: DesktopMessages;
  onCreateAgentRequest?: () => void;
  onSelect?: (memberId: string) => void;
}) {
  const { data } = input;
  const agents = data.members.filter((member) => member.type === "agent");

  return (
    <div className="slei-members-navigator">
      <div className="slei-nav-group">
        <div className="slei-nav-group__header"><span>{input.messages.members.agents}</span><button aria-label={input.messages.members.newAgent} onClick={input.onCreateAgentRequest} type="button"><Plus aria-hidden="true" size={14} /></button></div>
        <small>macbookpro m4 max</small>
        {agents.length === 0 ? <p className="slei-empty-note">{input.messages.members.noAgents}</p> : null}
        {agents.map((member) => (
          <button aria-current={(input.activeMemberId ?? agents[0]?.id) === member.id ? "true" : undefined} className="slei-nav-member" key={member.id} onClick={() => input.onSelect?.(member.id)} type="button">
            <MemberAvatar identity={member} />
            <span>
              <strong>{member.name}</strong>
              <small>{member.role}</small>
            </span>
            <StatusDot status={member.runtimeStatus} />
          </button>
        ))}
      </div>
    </div>
  );
}

function ComputersNavigator(input: {
  activeNodeId: string;
  messages: DesktopMessages;
  nodes: DesktopNodeView[];
  onAdd?: () => void;
  onDelete?: (nodeId: string) => void;
  onSelect?: (nodeId: string) => void;
}) {
  return (
    <div className="slei-computers-list" aria-label={input.messages.shell.sidebarSubtitle.computers}>
      <div className="slei-computers-list__label">
        <span>{input.messages.computers.computers} {input.nodes.length}</span>
        <button aria-label={input.messages.computers.newComputer} onClick={input.onAdd} type="button"><Plus aria-hidden="true" size={14} /></button>
      </div>
      {input.nodes.map((node) => (
        <div className="slei-computer-list-item" key={node.id}>
          <button
            aria-current={input.activeNodeId === node.id ? "true" : undefined}
            className="slei-computer-list-button"
            onClick={() => input.onSelect?.(node.id)}
            type="button"
          >
            <span className="slei-computer-icon"><Monitor aria-hidden="true" size={16} /></span>
            <span>
              <strong>{node.name}</strong>
              <small>daemon {node.daemonVersion}</small>
            </span>
            <StatusDot status={node.status === "connected" ? "idle" : "offline"} />
          </button>
          {node.id !== "local-node" ? (
            <button aria-label={input.messages.computers.deleteComputer(node.name)} className="slei-computer-delete" onClick={() => input.onDelete?.(node.id)} type="button"><Trash2 aria-hidden="true" size={13} /></button>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function renderWorkspace(
  activeView: AppView,
  data: SleiFixtures,
  activeChannel: SleiFixtures["channels"][number],
  activeConversation: ConversationView | undefined,
  activeSessionId: string | undefined,
  runtimeSetup: RuntimeSetupState,
  profile: UserProfile,
  locale: AppLocale,
  messages: DesktopMessages,
  timeZone: string,
  appearance: AppearancePreferences,
  notifications: NotificationPreferences,
  activeSettingsPanel: SettingsPanel,
  onProfileChange?: (profile: UserProfile) => void,
  onLocaleChange?: (locale: AppLocale) => Promise<void> | void,
  onTimeZoneChange?: (timeZone: string) => Promise<void> | void,
  onAppearanceChange?: (appearance: AppearancePreferences) => Promise<void> | void,
  onNotificationsChange?: (notifications: NotificationPreferences) => Promise<void> | void,
  onSendMessage?: (body: string, options?: { asTask?: boolean; attachmentIds?: string[]; sessionId?: string }) => Promise<void> | void,
  initialChatDraft?: string,
  initialComposerAttachments?: ConversationAttachmentView[],
  initialSearchFilters?: ChatSearchFilters,
  onSearchResultSelect?: (channelId: string, messageId: string) => void,
  activeComputerId?: string,
  onComputerCreateRequest?: () => void,
  onComputerRename?: (nodeId: string, name: string) => void,
  activeMemberId?: string,
  activeTaskId?: string,
  onTaskReply?: (taskId: string, body: string) => void,
  onAgentUpdate?: (agentId: string, update: Partial<AgentDraftInput>) => Promise<void> | void,
  onMemberMessage?: (memberId: string) => void,
  onOpenAgentPath?: (agentId: string, target: AgentPathTarget) => Promise<void> | void,
  onConversationNewSession?: (conversationId: string) => Promise<void> | void,
  onConversationHistoryToggle?: () => void,
  onConversationSessionSelect?: (conversationId: string, sessionId: string) => Promise<void> | void,
  onAttachmentUpload?: (request: ConversationAttachmentUploadRequest) => Promise<{ attachment: ConversationAttachmentView }>,
  sessionDrawerOpen?: boolean,
  sendingConversationIds: string[] = [],
  onAgentDraftCreate?: (draft: Partial<AgentDraftInput>, cardId?: string) => void,
  onChannelDraftCreate?: (draft: Record<string, unknown>, cardId?: string) => void,
) {
  if (activeView === "search") return <SearchPage data={data} initialFilters={initialSearchFilters} messages={messages} onResultSelect={onSearchResultSelect} />;
  if (activeView === "tasks") return <TasksPage activeTaskId={activeTaskId} data={data} messages={messages} onTaskReply={onTaskReply} />;
  if (activeView === "members") return <MembersPage activeMemberId={activeMemberId} data={data} messages={messages} nodes={runtimeSetup.nodes} onAgentUpdate={onAgentUpdate} onMessage={onMemberMessage} onOpenAgentPath={onOpenAgentPath} />;
  if (activeView === "computers") {
    return (
      <ComputersPage
        activeNodeId={activeComputerId}
        members={data.members}
        messages={messages}
        nodes={runtimeSetup.nodes}
        onComputerCreateRequest={onComputerCreateRequest}
        onComputerRename={onComputerRename}
      />
    );
  }
  if (activeView === "settings") {
    return (
      <SettingsPage
        activePanel={activeSettingsPanel}
        appearance={appearance}
        locale={locale}
        messages={messages}
        notifications={notifications}
        nodes={runtimeSetup.nodes}
        onAppearanceChange={onAppearanceChange}
        onLocaleChange={onLocaleChange}
        onNotificationsChange={onNotificationsChange}
        onProfileChange={onProfileChange}
        onTimeZoneChange={onTimeZoneChange}
        profile={profile}
        timeZone={timeZone}
      />
    );
  }
  return <ChatPage activeChannel={activeChannel} activeConversation={activeConversation} activeSessionId={activeSessionId} data={data} initialAttachments={initialComposerAttachments} initialDraft={initialChatDraft} messages={messages} onAgentDraftCreate={onAgentDraftCreate} onAttachmentUpload={onAttachmentUpload} onChannelDraftCreate={onChannelDraftCreate} onConversationHistoryToggle={onConversationHistoryToggle} onConversationNewSession={onConversationNewSession} onConversationSessionSelect={onConversationSessionSelect} onSendMessage={onSendMessage} profile={profile} sending={activeConversation ? sendingConversationIds.includes(activeConversation.id) : false} sessionDrawerOpen={sessionDrawerOpen} />;
}

function ComputerCreateModal(input: {
  messages: DesktopMessages;
  onClose: () => void;
  onCreate?: (name: string, osLabel: string) => void;
}) {
  const [newName, setNewName] = useState("");
  const [newOs, setNewOs] = useState("");

  function submitCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!newName.trim()) return;
    input.onCreate?.(newName, newOs);
  }

  return (
    <div className="slei-modal-backdrop" role="presentation">
      <section aria-modal="true" className="slei-dialog slei-computer-modal" role="dialog">
        <header>
          <h2><Monitor aria-hidden="true" size={20} />{input.messages.computers.newComputer}</h2>
        </header>
        <form className="slei-channel-modal__form" onSubmit={submitCreate}>
          <label className="slei-field">
            <span>{input.messages.computers.deviceName}</span>
            <input aria-label={input.messages.computers.deviceName} className="slei-input" onChange={(event) => setNewName(event.currentTarget.value)} placeholder="Design Mac" value={newName} />
          </label>
          <label className="slei-field">
            <span>{input.messages.computers.os}</span>
            <input aria-label={input.messages.computers.os} className="slei-input" onChange={(event) => setNewOs(event.currentTarget.value)} placeholder="darwin arm64" value={newOs} />
          </label>
          <div className="slei-modal-actions">
            <button className="slei-button" onClick={input.onClose} type="button">{input.messages.common.cancel}</button>
            <button className="slei-button slei-button--accent" type="submit"><Plus aria-hidden="true" size={14} />{input.messages.common.create}</button>
          </div>
        </form>
      </section>
    </div>
  );
}

function fontSizeValue(size: AppearancePreferences["fontSize"]) {
  return {
    sm: "14px",
    md: "15px",
    lg: "16px",
  }[size];
}

function taskStatusLabel(status: SleiTask["status"], messages: DesktopMessages) {
  return messages.tasks.status[status];
}

function runtimeStatusLabel(status: "idle" | "busy" | "offline", messages: DesktopMessages) {
  return messages.status.runtime[status];
}

function AgentCreateModal(input: {
  draft?: Partial<AgentDraftInput>;
  messages: DesktopMessages;
  nodes: DesktopNodeView[];
  onClose: () => void;
  onCreate?: (request: AgentDraftInput) => void;
}) {
  const firstNode = input.nodes[0];
  const firstRuntime = firstNode?.runtimes.find((runtime) => runtime.readiness === "ready") ?? firstNode?.runtimes[0];
  const [name, setName] = useState(input.draft?.name ?? "");
  const [handle, setHandle] = useState(input.draft?.handle ?? "");
  const [runtimeKind, setRuntimeKind] = useState(input.draft?.runtimeKind ?? firstRuntime?.kind ?? "ClaudeCode");
  const [model, setModel] = useState(input.draft?.model ?? "Sonnet");
  const [nodeId, setNodeId] = useState(input.draft?.nodeId ?? firstNode?.id ?? "local-node");
  const [description, setDescription] = useState(input.draft?.description ?? "");

  function submitCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) return;
    input.onCreate?.({
      name: trimmedName,
      handle: normalizeHandleInput(handle || trimmedName),
      runtimeKind,
      model,
      nodeId,
      description: description.trim() || input.messages.agentCreate.defaultDescription(trimmedName),
    });
  }

  return (
    <div className="slei-modal-backdrop" role="presentation">
      <section aria-modal="true" className="slei-dialog slei-agent-modal" role="dialog">
        <header>
          <span className="slei-badge slei-badge--ready">{input.messages.agentCreate.fallbackAgent}</span>
          <h2><AtSign aria-hidden="true" size={20} />{input.messages.agentCreate.title}</h2>
        </header>
        <form className="slei-channel-modal__form" onSubmit={submitCreate}>
          <label className="slei-field">
            <span>Runtime</span>
            <SelectControl
              ariaLabel="Runtime"
              className="slei-input slei-agent-runtime-select"
              onChange={setRuntimeKind}
              options={input.nodes
                .flatMap((node) => node.runtimes.map((runtime) => runtime.kind))
                .filter((kind, index, all) => all.indexOf(kind) === index)
                .map((kind) => ({ label: kind, value: kind }))}
              value={runtimeKind}
            />
          </label>
          <label className="slei-field">
            <span>{input.messages.agentCreate.name}</span>
            <input className="slei-input" onChange={(event) => {
              setName(event.currentTarget.value);
              if (!handle.trim()) setHandle(normalizeHandleInput(event.currentTarget.value));
            }} value={name} />
          </label>
          <label className="slei-field">
            <span>{input.messages.agentCreate.handle}</span>
            <input className="slei-input" onChange={(event) => setHandle(event.currentTarget.value)} value={handle} />
          </label>
          <label className="slei-field">
            <span>{input.messages.agentCreate.associatedDevice}</span>
            <SelectControl
              ariaLabel={input.messages.agentCreate.associatedDevice}
              className="slei-input slei-agent-node-select"
              onChange={setNodeId}
              options={input.nodes.map((node) => ({ label: node.name, value: node.id }))}
              value={nodeId}
            />
          </label>
          <label className="slei-field">
            <span>{input.messages.agentCreate.model}</span>
            <input className="slei-input" onChange={(event) => setModel(event.currentTarget.value)} value={model} />
          </label>
          <label className="slei-field">
            <span>{input.messages.agentCreate.description}</span>
            <textarea className="slei-textarea" onChange={(event) => setDescription(event.currentTarget.value)} value={description} />
          </label>
          <div className="slei-modal-actions">
            <button className="slei-button slei-button--small" onClick={input.onClose} type="button">{input.messages.common.cancel}</button>
            <button className="slei-button slei-button--small slei-button--accent" type="submit">{input.messages.common.create}</button>
          </div>
        </form>
      </section>
    </div>
  );
}

function normalizeHandleInput(value: string) {
  const handle = value.trim().replace(/^@/, "").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  return `@${handle || "agent"}`;
}

function RuntimeOnboardingModal(input: {
  loading: boolean;
  messages: DesktopMessages;
  nodes: DesktopNodeView[];
  onRenameLocalNode?: (name: string) => Promise<void> | void;
  onRefreshRuntime?: () => Promise<void> | void;
}) {
  const localNode = input.nodes.find((node) => node.id === "local-node") ?? input.nodes[0];
  const [name, setName] = useState(localNode?.name ?? input.messages.computers.deviceName);

  return (
    <div className="slei-modal-backdrop" role="presentation">
      <section aria-modal="true" className="slei-dialog slei-runtime-modal" role="dialog">
        <div>
          <h2>{input.messages.onboarding.title}</h2>
          <p>{input.messages.onboarding.description}</p>
        </div>
        <label className="slei-field">
          <span>{input.messages.onboarding.deviceName}</span>
          <input className="slei-input" value={name} onChange={(event) => setName(event.currentTarget.value)} />
        </label>
        <div className="slei-runtime-list">
          {(localNode?.runtimes ?? []).map((runtime) => (
            <div className="slei-runtime-row" key={runtime.kind}>
              <span>{runtime.kind}</span>
              <b className={`slei-badge slei-badge--${runtime.readiness}`}>{runtime.version ?? runtime.readiness}</b>
            </div>
          ))}
        </div>
        {localNode ? (
          <dl className="slei-device-meta">
            <div><dt>{input.messages.onboarding.os}</dt><dd>{deviceOsLabel(localNode.device)}</dd></div>
            <div><dt>{input.messages.onboarding.hostname}</dt><dd>{localNode.device.hostname}</dd></div>
          </dl>
        ) : null}
        <div className="slei-modal-actions">
          <button className="slei-button" onClick={() => input.onRenameLocalNode?.(name)} type="button">{input.messages.onboarding.saveDeviceName}</button>
          <button className="slei-button slei-button--accent" disabled={input.loading} onClick={() => input.onRefreshRuntime?.()} type="button">{input.messages.onboarding.refreshRuntime}</button>
        </div>
      </section>
    </div>
  );
}
