import { type CSSProperties, type FormEvent, type PointerEvent as ReactPointerEvent, type ReactNode, useEffect, useRef, useState } from "react";
import {
  ArrowUpDown,
  AtSign,
  Bell,
  Bookmark,
  CheckSquare,
  CircleUserRound,
  FolderPlus,
  Globe2,
  Hash,
  Info,
  MessageCircle,
  Monitor,
  Palette,
  Plus,
  Search,
  Server,
  Settings,
  Trash2,
  X,
  type LucideIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

import {
  type AppearancePreferences,
  type AppLocale,
  type ConversationAttachmentUploadRequest,
  type ConversationAttachmentView,
  type ConversationView,
  type DesktopNodeView,
  type InteractiveCardView,
  type NotificationPreferences,
  type PermissionDecision,
  type SavedMessageView,
  type AgentPathTarget,
  type AgentWorkspaceFileReceipt,
  type AgentWorkspaceListReceipt,
  type RuntimeSetupState,
} from "../lib/daemon-bridge";
import { createDesktopMessages, type DesktopMessages } from "../i18n";
import type { ChannelEmbeddedView } from "../features/chat/ChatPageView";
import { MemberAvatar, StatusDot, Toast } from "../components";
import { ChatRoute } from "./routes/ChatRoute";
import { ComputersRoute } from "./routes/ComputersRoute";
import { MembersRoute } from "./routes/MembersRoute";
import { SearchRoute } from "./routes/SearchRoute";
import { SettingsRoute } from "./routes/SettingsRoute";
import { TasksRoute } from "./routes/TasksRoute";
import { type SleiFixtures, type SleiMember, type SleiMessage } from "./fixtures";
import {
  channelReadinessLabel,
  defaultAppearance,
  defaultNotifications,
  defaultProfile,
  defaultTimeZone,
  deviceOsLabel,
  normalizeAppearanceTheme,
  stripChannelHash,
  type AgentDraftInput,
  type AppView,
  type ChatSearchFilters,
  type SettingsPanel,
  type UserProfile,
} from "./model";

const navItems: Array<{ id: Exclude<AppView, "search">; icon: LucideIcon }> = [
  { id: "chat", icon: MessageCircle },
  { id: "tasks", icon: CheckSquare },
  { id: "members", icon: CircleUserRound },
  { id: "computers", icon: Monitor },
  { id: "settings", icon: Settings },
];

export const AGENT_ACTIVITY_ROTATION_MS = 2_000;

export type SleiAppFrameProps = {
  activeView: AppView;
  activeChannelId?: string;
  activeConversationId?: string;
  activeSessionId?: string;
  activeMemberId?: string;
  activeTaskId?: string;
  focusedMessageId?: string;
  data: SleiFixtures;
  initialChatDraft?: string;
  initialChannelView?: ChannelEmbeddedView;
  initialComposerAttachments?: ConversationAttachmentView[];
  initialConversationHistoryOpen?: boolean;
  initialSavedPanelOpen?: boolean;
  initialAgentCreateModalOpen?: boolean;
  initialCreateChannelModalOpen?: boolean;
  guideBootstrapping?: boolean;
  initialSettingsPanel?: SettingsPanel;
  initialSearchFilters?: ChatSearchFilters;
  locale: AppLocale;
  timeZone?: string;
  appearance?: AppearancePreferences;
  notifications?: NotificationPreferences;
  profile?: UserProfile;
  runtimeSetup: RuntimeSetupState;
  runtimeErrorToastMessage?: string;
  searchOpen?: boolean;
  sessionDrawerOpen?: boolean;
  sendingConversationIds?: string[];
  sidebarWidth?: number;
  savedMessages?: SavedMessageView[];
  onAgentCreate?: (request: AgentDraftInput) => Promise<void> | void;
  onAgentDelete?: (agentId: string) => Promise<void> | void;
  onAgentUpdate?: (agentId: string, update: Partial<AgentDraftInput>) => Promise<void> | void;
  onChannelCreate?: (input: { name: string; projectName?: string; projectPaths?: string[]; agentIds?: string[] }) => Promise<void> | void;
  onChannelDelete?: (channelId: string) => void;
  onChannelSelect?: (channelId: string) => void;
  onConversationNewSession?: (conversationId: string) => Promise<void> | void;
  onConversationHistoryToggle?: () => void;
  onConversationSessionSelect?: (conversationId: string, sessionId: string) => Promise<void> | void;
  onAttachmentUpload?: (request: ConversationAttachmentUploadRequest) => Promise<{ attachment: ConversationAttachmentView }>;
  onInteractiveCardComplete?: (cardId: string) => Promise<void> | void;
  onPermissionResolve?: (requestId: string, decision: PermissionDecision) => Promise<void> | void;
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
  onSavedMessageSelect?: (savedMessage: SavedMessageView) => void;
  onMessageSaveToggle?: (message: SleiMessage) => Promise<void> | void;
  onMemberSelect?: (memberId: string) => void;
  onMemberMessage?: (memberId: string) => void;
  onOpenAgentPath?: (agentId: string, target: AgentPathTarget) => Promise<void> | void;
  onListAgentWorkspace?: (agentId: string, relativePath?: string) => Promise<AgentWorkspaceListReceipt> | AgentWorkspaceListReceipt;
  onReadAgentWorkspaceFile?: (agentId: string, relativePath: string) => Promise<AgentWorkspaceFileReceipt> | AgentWorkspaceFileReceipt;
  onSendMessage?: (body: string, options?: { asTask?: boolean; attachmentIds?: string[]; sessionId?: string }) => Promise<void> | void;
  onTaskReply?: (taskId: string, body: string) => Promise<void> | void;
  onTaskStatusChange?: (taskId: string, status: SleiFixtures["tasks"][number]["status"]) => Promise<void> | void;
  onTaskThreadOpen?: (taskId: string) => Promise<void> | void;
  onViewChange?: (view: AppView) => void;
  onRenameLocalNode?: (name: string) => Promise<void> | void;
  onRefreshRuntime?: () => Promise<void> | void;
};

export function SleiAppFrame(input: SleiAppFrameProps) {
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
  const [agentActivityTick, setAgentActivityTick] = useState(0);
  const profile = input.profile ?? defaultProfile;
  const appearance = input.appearance ?? defaultAppearance;
  const normalizedTheme = normalizeAppearanceTheme(appearance.theme);
  const normalizedAppearance = { ...appearance, theme: normalizedTheme };
  const messages = createDesktopMessages(input.locale);
  const sidebarTitle = input.activeView === "search" ? messages.common.search : messages.shell.nav[input.activeView];
  const activeAgentActivities = input.activeView === "chat" || input.activeView === "search"
    ? findActiveAgentActivities(input.data, activeChannel, activeConversation, activeSessionId)
    : [];
  const activeAgentActivity = selectAgentActivityForTick(activeAgentActivities, agentActivityTick);
  const shellStyle = {
    "--slei-sidebar-width": `${input.sidebarWidth ?? 240}px`,
    "--slei-font-size": fontSizeValue(appearance.fontSize),
    gridTemplateColumns: "5.5rem var(--slei-sidebar-width, 15rem) 0.5rem minmax(0, 1fr)",
  } as CSSProperties;

  useEffect(() => {
    if (input.runtimeSetup.nodes.some((node) => node.id === activeComputerId)) return;
    setActiveComputerId(firstComputer?.id ?? "");
  }, [activeComputerId, firstComputer?.id, input.runtimeSetup.nodes]);

  useEffect(() => {
    setAgentActivityTick(0);
  }, [activeChannel.id, activeConversation?.id, activeSessionId]);

  useEffect(() => {
    if (activeAgentActivities.length <= 1) return;
    const timer = window.setInterval(() => {
      setAgentActivityTick((current) => current + 1);
    }, AGENT_ACTIVITY_ROTATION_MS);
    return () => window.clearInterval(timer);
  }, [activeAgentActivities.length, activeChannel.id, activeConversation?.id, activeSessionId]);

  return (
    <div
      className={cn("grid h-screen min-h-0 overflow-hidden bg-background text-foreground", normalizedTheme === "dark" && "dark")}
      data-active-view={input.activeView}
      data-theme={normalizedTheme}
      style={shellStyle}
    >
      <Toast message={input.runtimeErrorToastMessage} />
      <nav className="flex min-h-0 flex-col items-center gap-2 border-r bg-sidebar px-2 pb-3 pt-10 text-sidebar-foreground" data-tauri-drag-region="deep" aria-label={messages.shell.mainNavigation}>
        <div className="slei-brand">
          <span className="slei-brand__mark" aria-hidden="true">
            SLei
          </span>
        </div>
        {navItems.map((item) => (
          <Button
            aria-label={messages.shell.nav[item.id]}
            aria-current={input.activeView === item.id ? "page" : undefined}
            className={cn(
              "grid h-16 w-16 grid-rows-[1fr_auto] justify-items-center gap-1 rounded-lg px-1 py-2 text-[11px] leading-none",
              input.activeView === item.id && "shadow-sm",
            )}
            data-nav-icon={item.id}
            key={item.id}
            onClick={() => input.onViewChange?.(item.id)}
            size="lg"
            title={messages.shell.nav[item.id]}
            type="button"
            variant={input.activeView === item.id ? "default" : "ghost"}
          >
            <item.icon aria-hidden="true" size={20} strokeWidth={2.8} />
            <span className="text-[11px] leading-none">{messages.shell.nav[item.id]}</span>
          </Button>
        ))}
      </nav>

      <aside className="slei-context-sidebar min-h-0 border-r bg-sidebar/70 text-sidebar-foreground max-[760px]:hidden">
        <SidebarFrame title={sidebarTitle}>
          {input.activeView === "chat" || input.activeView === "search" ? (
            <ChannelList
              activeChannelId={input.activeConversationId ? undefined : activeChannel.id}
              activeConversationId={input.activeConversationId}
              data={input.data}
              initialCreateChannelModalOpen={input.initialCreateChannelModalOpen}
              initialSavedPanelOpen={input.initialSavedPanelOpen}
              activeAgentActivity={activeAgentActivity}
              onChannelCreate={input.onChannelCreate}
              onChannelDelete={input.onChannelDelete}
              onChannelSelect={input.onChannelSelect}
              onConversationSelect={input.onConversationSelect}
              onSavedMessageSelect={input.onSavedMessageSelect}
              onSearchToggle={input.onSearchToggle}
              savedMessages={input.savedMessages ?? []}
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
        </SidebarFrame>
      </aside>

      <button
        aria-label={messages.common.resizeSidebar}
        aria-orientation="vertical"
        className="w-2 cursor-col-resize border-x bg-border/40 outline-none transition-colors hover:bg-border focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0"
        onPointerDown={input.onResizeStart}
        role="separator"
        type="button"
      />

      <main className="slei-workspace min-h-0 min-w-0 overflow-hidden bg-background">{renderWorkspace(input.activeView, input.data, activeChannel, activeConversation, activeSessionId, input.runtimeSetup, profile, input.locale, messages, input.timeZone ?? defaultTimeZone, normalizedAppearance, input.notifications ?? defaultNotifications, activeSettingsPanel, input.onProfileChange, input.onLocaleChange, input.onTimeZoneChange, input.onAppearanceChange, input.onNotificationsChange, input.onSendMessage, input.initialChatDraft, input.initialChannelView, input.initialComposerAttachments, input.initialSearchFilters, input.onSearchResultSelect, activeComputerId, () => setComputerCreateOpen(true), input.onComputerRename, input.activeMemberId, input.activeTaskId, input.onTaskReply, input.onTaskStatusChange, input.onTaskThreadOpen, input.onAgentUpdate, input.onAgentDelete, input.onMemberMessage, input.onOpenAgentPath, input.onListAgentWorkspace, input.onReadAgentWorkspaceFile, input.onConversationNewSession, input.onConversationHistoryToggle, input.onConversationSessionSelect, input.onAttachmentUpload, input.onPermissionResolve, input.sessionDrawerOpen ?? input.initialConversationHistoryOpen, input.sendingConversationIds ?? [], input.savedMessages ?? [], input.focusedMessageId, input.onMessageSaveToggle, (draft, cardId) => {
        setAgentDraft(draft);
        setActiveCardId(cardId);
        setAgentCreateOpen(true);
      }, async (draft, cardId) => {
        const projectPaths = Array.isArray(draft.projectPaths) ? draft.projectPaths.filter((path): path is string => typeof path === "string") : [];
        await input.onChannelCreate?.({
          name: String(draft.name ?? ""),
          projectName: typeof draft.projectName === "string" ? draft.projectName : undefined,
          projectPaths,
          agentIds: Array.isArray(draft.agentIds) ? draft.agentIds.filter((id): id is string => typeof id === "string") : [],
        });
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
        <div className="fixed inset-0 z-50 grid place-items-center bg-background/70 backdrop-blur-sm" data-slot="guide-status-overlay" role="presentation">
          <section aria-live="polite" className="rounded-xl bg-popover p-6 text-popover-foreground ring-1 ring-border shadow-lg" data-slot="guide-status" role="status">
            <h2 className="text-base font-medium">{messages.onboarding.creatingGuide}</h2>
          </section>
        </div>
      ) : null}
    </div>
  );
}

export type ChannelDraftState = {
  name: string;
  projectName: string;
  projectPaths: string[];
  selectedAgentIds: string[];
};

export function resetChannelDraft(): ChannelDraftState {
  return { name: "", projectName: "", projectPaths: [], selectedAgentIds: [] };
}

export function toggleChannelDraftAgent(draft: ChannelDraftState, agentId: string): ChannelDraftState {
  return {
    ...draft,
    selectedAgentIds: draft.selectedAgentIds.includes(agentId)
      ? draft.selectedAgentIds.filter((id) => id !== agentId)
      : [...draft.selectedAgentIds, agentId],
  };
}

export function channelDraftCreateInput(draft: ChannelDraftState): { name: string; projectName?: string; projectPaths?: string[]; agentIds: string[] } {
  const projectPaths = uniqueProjectPaths(draft.projectPaths);
  const projectName = projectPaths.length > 0 ? projectPaths.join(", ") : draft.projectName;
  return {
    name: draft.name,
    projectName,
    projectPaths,
    agentIds: draft.selectedAgentIds,
  };
}

function uniqueProjectPaths(paths: string[]) {
  return [...new Set(paths.map((path) => path.trim()).filter(Boolean))];
}

function projectPathFromPickedFile(file: File) {
  const metadata = file as File & { path?: string; webkitRelativePath?: string };
  const relativePath = metadata.webkitRelativePath ?? "";
  const rootFolder = relativePath.split("/").filter(Boolean)[0];
  if (metadata.path && relativePath && rootFolder) {
    const separator = metadata.path.includes("\\") ? "\\" : "/";
    const suffix = relativePath.split("/").join(separator);
    if (metadata.path.endsWith(suffix)) {
      return `${metadata.path.slice(0, -suffix.length)}${rootFolder}`;
    }
  }
  return rootFolder ?? metadata.path ?? file.name;
}

function formatChannelProjectLabel(channel: SleiFixtures["channels"][number], messages: DesktopMessages) {
  const projects = channel.projectPaths?.length ? channel.projectPaths.join(", ") : channel.projectName;
  return projects ? messages.chat.projectPrefix(projects) : channel.description;
}

function SidebarFrame(input: { children: ReactNode; title: string }) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b px-3 pb-3 pt-4">
        <h2 className="text-base font-bold leading-none">{input.title}</h2>
      </div>
      <div className="min-h-0 flex-1">{input.children}</div>
    </div>
  );
}

export type AgentActivityView = {
  member?: SleiMember;
  message: SleiMessage;
};

export function findActiveAgentActivities(
  data: SleiFixtures,
  activeChannel: SleiFixtures["channels"][number],
  activeConversation?: ConversationView,
  activeSessionId?: string,
): AgentActivityView[] {
  const targetId = activeConversation?.id ?? activeChannel.id;
  const activeMessages = data.messages.filter((message) => {
    if (message.channelId !== targetId) return false;
    if (activeConversation && activeSessionId && message.sessionId !== activeSessionId) return false;
    if (message.role !== "agent" || (message.status !== "running" && message.status !== "pending" && message.status !== "failed")) return false;
    const member = data.members.find((candidate) => candidate.name === message.author || candidate.handle === message.handle);
    return member?.directMessageEnabled !== false && !member?.id.startsWith("agent_coordinator_");
  });

  return activeMessages.map((message) => {
    const member = data.members.find((candidate) => candidate.name === message.author || candidate.handle === message.handle)
      ?? data.members.find((candidate) => activeConversation?.agentId && candidate.id === activeConversation.agentId);
    return { member, message };
  });
}

export function selectAgentActivityForTick(activities: AgentActivityView[], tick: number): AgentActivityView | undefined {
  if (activities.length === 0) return undefined;
  return activities[Math.abs(tick) % activities.length];
}

function AgentActivityPanel(input: { activity?: AgentActivityView; messages: DesktopMessages }) {
  const { activity } = input;
  if (!activity) return null;
  const failed = activity.message.status === "failed";
  const identity = activity.member ?? {
    id: activity.message.id,
    name: activity.message.author,
    handle: activity.message.handle ?? `@${activity.message.author.toLowerCase().replace(/\s+/g, "-")}`,
    avatar: activity.message.avatar ?? activity.message.author.slice(0, 2).toUpperCase(),
    avatarSeed: activity.message.author,
  };
  return (
    <section aria-live="polite" className="shrink-0 border-t bg-sidebar/80 p-3" data-slot="agent-activity" role="status">
      <div className={cn("flex min-w-0 items-center gap-2 rounded-lg bg-background px-2 py-2", failed && "border border-destructive/45 bg-destructive/10")}>
        <MemberAvatar identity={identity} />
        <div className="min-w-0 flex-1">
          <strong className="block truncate text-sm">{activity.member?.name ?? activity.message.author}</strong>
          <small className={cn("block truncate text-xs text-muted-foreground", failed && "font-medium text-destructive")}>
            {failed ? input.messages.chat.agentRunFailed : input.messages.chat.agentThinking}
          </small>
        </div>
      </div>
    </section>
  );
}

function ChannelList(input: {
  activeChannelId?: string;
  activeConversationId?: string;
  activeAgentActivity?: AgentActivityView;
  data: SleiFixtures;
  initialCreateChannelModalOpen?: boolean;
  initialSavedPanelOpen?: boolean;
  messages: DesktopMessages;
  savedMessages: SavedMessageView[];
  searchOpen?: boolean;
  onChannelCreate?: (input: { name: string; projectName?: string; projectPaths?: string[]; agentIds?: string[] }) => Promise<void> | void;
  onChannelDelete?: (channelId: string) => void;
  onChannelSelect?: (channelId: string) => void;
  onConversationSelect?: (conversationId: string) => void;
  onSavedMessageSelect?: (savedMessage: SavedMessageView) => void;
  onSearchToggle?: () => void;
}) {
  const [channelDraft, setChannelDraft] = useState<ChannelDraftState>(() => resetChannelDraft());
  const [createOpen, setCreateOpen] = useState(input.initialCreateChannelModalOpen ?? false);
  const [activePanel, setActivePanel] = useState<"channels" | "saved">(input.initialSavedPanelOpen ? "saved" : "channels");
  const projectFolderInputRef = useRef<HTMLInputElement>(null);
  const directMessageConversations = input.data.conversations.filter((conversation) => {
    if (conversation.kind !== "dm") return false;
    const member = input.data.members.find((candidate) => candidate.id === conversation.agentId);
    return member?.directMessageEnabled !== false;
  });
  const agentMembers = input.data.members.filter((member) => member.type === "agent" && member.directMessageEnabled !== false);

  async function submitChannel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await input.onChannelCreate?.(channelDraftCreateInput(channelDraft));
    closeCreateChannelModal();
  }

  function closeCreateChannelModal() {
    setChannelDraft(resetChannelDraft());
    setCreateOpen(false);
  }

  function toggleSelectedAgent(agentId: string) {
    setChannelDraft((current) => toggleChannelDraftAgent(current, agentId));
  }

  function addProjectFolders(files: FileList | null) {
    const paths = Array.from(files ?? []).map(projectPathFromPickedFile).filter(Boolean);
    if (paths.length === 0) return;
    setChannelDraft((current) => ({ ...current, projectPaths: uniqueProjectPaths([...current.projectPaths, ...paths]) }));
  }

  function removeProjectFolder(path: string) {
    setChannelDraft((current) => ({ ...current, projectPaths: current.projectPaths.filter((candidate) => candidate !== path) }));
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-3">
      <div className="grid gap-2">
        <Button aria-pressed={input.searchOpen ? "true" : "false"} className="w-full justify-between" onClick={input.onSearchToggle} type="button" variant={input.searchOpen ? "secondary" : "outline"}>
          <span className="inline-flex items-center gap-2"><Search aria-hidden="true" size={14} />{input.messages.common.search}</span>
          <span className="text-[10px] text-muted-foreground">Command K</span>
        </Button>
        <Button aria-pressed={activePanel === "saved" ? "true" : "false"} className="w-full justify-start" onClick={() => setActivePanel("saved")} type="button" variant={activePanel === "saved" ? "secondary" : "ghost"}>
          <Bookmark aria-hidden="true" size={14} />{input.messages.common.saved}
        </Button>
      </div>
      {activePanel === "saved" ? (
        <SavedMessagesPanel
          data={input.data}
          messages={input.messages}
          onClose={() => setActivePanel("channels")}
          onSelect={input.onSavedMessageSelect}
          savedMessages={input.savedMessages}
        />
      ) : (
        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-4 pr-2">
            <div className="flex items-center justify-between text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <span>{input.messages.chat.channels} {input.data.channels.length}</span>
              <div className="flex items-center gap-1">
                <Button aria-label={input.messages.chat.sortChannels} size="icon-xs" type="button" variant="ghost"><ArrowUpDown aria-hidden="true" size={14} /></Button>
                <Button aria-label={input.messages.chat.createChannel} onClick={() => setCreateOpen(true)} size="icon-xs" type="button" variant="ghost"><Plus aria-hidden="true" size={14} /></Button>
              </div>
            </div>
            <div className="space-y-1">
              {input.data.channels.map((channel) => (
                <div className="group flex items-start gap-1" key={channel.id}>
                  <Button
                    aria-current={input.activeChannelId === channel.id ? "true" : undefined}
                    className={cn("h-auto min-h-12 flex-1 justify-start whitespace-normal px-2 py-2 text-left", input.activeChannelId === channel.id && "bg-accent text-accent-foreground")}
                    onClick={() => input.onChannelSelect?.(channel.id)}
                    type="button"
                    variant="ghost"
                  >
                    <span className="grid min-w-0 flex-1 gap-1">
                      <span className="flex min-w-0 items-center gap-2">
                        <Hash aria-hidden="true" size={14} />
                        <span className="truncate">{stripChannelHash(channel.name)}</span>
                        {channel.unread > 0 ? <Badge className="ml-auto" variant="secondary">{channel.unread}</Badge> : null}
                      </span>
                      <small className="line-clamp-2 text-xs font-normal text-muted-foreground">{formatChannelProjectLabel(channel, input.messages)}</small>
                    </span>
                  </Button>
                  {channel.id !== "all" ? (
                    <Button aria-label={input.messages.chat.deleteChannel(stripChannelHash(channel.name))} className="mt-1 opacity-80 group-hover:opacity-100" onClick={() => input.onChannelDelete?.(channel.id)} size="icon-xs" type="button" variant="ghost"><Trash2 aria-hidden="true" size={14} /></Button>
                  ) : null}
                </div>
              ))}
            </div>
            <Separator />
            <div className="flex items-center justify-between text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <span>{input.messages.chat.directMessages} {directMessageConversations.length}</span>
              <Button aria-label={input.messages.chat.sortDirectMessages} size="icon-xs" type="button" variant="ghost"><ArrowUpDown aria-hidden="true" size={14} /></Button>
            </div>
            <div className="space-y-1">
              {directMessageConversations.map((conversation) => {
                const member = input.data.members.find((candidate) => candidate.id === conversation.agentId && candidate.type === "agent");
                if (!member) return null;
                const conversationId = conversation.id;
                return (
                  <Button
                    aria-current={input.activeConversationId === conversationId ? "true" : undefined}
                    className={cn("slei-channel slei-channel--dm h-auto min-h-14 w-full justify-start whitespace-normal px-2 py-2 text-left", input.activeConversationId === conversationId && "bg-accent text-accent-foreground")}
                    key={conversation.id}
                    onClick={() => input.onConversationSelect?.(conversationId)}
                    type="button"
                    variant="ghost"
                  >
                    <MemberAvatar identity={member} />
                    <span className="slei-channel__dm-copy grid min-w-0 flex-1 gap-1">
                      <strong>{member.name}</strong>
                      <small className="line-clamp-2 text-xs font-normal text-muted-foreground">{member.description}</small>
                    </span>
                  </Button>
                );
              })}
            </div>
          </div>
        </ScrollArea>
      )}
      <AgentActivityPanel activity={input.activeAgentActivity} messages={input.messages} />
      <ShellDialog closeLabel={input.messages.common.cancel} open={createOpen} onOpenChange={(open) => {
        if (!open) closeCreateChannelModal();
        else setCreateOpen(true);
      }} className="max-h-[min(90vh,42rem)] overflow-hidden sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Hash aria-hidden="true" size={20} />{input.messages.chat.createChannel}</DialogTitle>
            <DialogDescription>{input.messages.chat.createChannelDescription}</DialogDescription>
          </DialogHeader>
          <form className="grid min-h-0 gap-4" onSubmit={submitChannel}>
            <div className="grid gap-2">
              <Label htmlFor="slei-channel-name">{input.messages.chat.channelName}</Label>
              <Input
                aria-label={input.messages.chat.channelName}
                id="slei-channel-name"
                onChange={(event) => setChannelDraft((current) => ({ ...current, name: event.currentTarget.value }))}
                placeholder="dev-team"
                value={channelDraft.name}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="slei-channel-project">{input.messages.chat.project}</Label>
              <div className="grid gap-2">
                <Input
                  aria-label={input.messages.chat.project}
                  id="slei-channel-project"
                  onChange={(event) => setChannelDraft((current) => ({ ...current, projectName: event.currentTarget.value }))}
                  placeholder="Slei Desktop"
                  value={channelDraft.projectName}
                />
                <input
                  aria-label={input.messages.chat.projectFolderPicker}
                  className="sr-only"
                  multiple
                  onChange={(event) => {
                    addProjectFolders(event.currentTarget.files);
                    event.currentTarget.value = "";
                  }}
                  ref={projectFolderInputRef}
                  type="file"
                  {...{ directory: "", webkitdirectory: "" }}
                />
                <div className="flex flex-wrap items-center gap-2">
                  <Button onClick={() => projectFolderInputRef.current?.click()} type="button" variant="outline">
                    <FolderPlus aria-hidden="true" size={14} />
                    {input.messages.chat.projectFolderPicker}
                  </Button>
                  <span className="text-xs text-muted-foreground">{input.messages.chat.projectFolderHint}</span>
                </div>
                {channelDraft.projectPaths.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {channelDraft.projectPaths.map((path) => (
                      <Badge className="max-w-full gap-1" key={path} variant="secondary">
                        <span className="truncate">{path}</span>
                        <button aria-label={input.messages.chat.removeProject(path)} className="ml-1 rounded-sm hover:bg-background/70" onClick={() => removeProjectFolder(path)} type="button">
                          <X aria-hidden="true" className="size-3" />
                        </button>
                      </Badge>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
            {agentMembers.length > 0 ? (
              <fieldset className="grid gap-2">
                <legend className="text-sm font-medium">{input.messages.chat.selectAgents}</legend>
                <ScrollArea className="max-h-60 rounded-lg border">
                  <div className="grid gap-1 p-2">
                    {agentMembers.map((member) => {
                      const readiness = member.channelReadiness?.[stripChannelHash(channelDraft.name)] ?? member.channelReadiness?.__create__ ?? "memory_syncing";
                      return (
                        <Label className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 hover:bg-muted" key={member.id}>
                          <Checkbox
                            aria-label={`${input.messages.chat.selectAgents} ${member.name}`}
                            checked={channelDraft.selectedAgentIds.includes(member.id)}
                            onCheckedChange={() => toggleSelectedAgent(member.id)}
                          />
                          <MemberAvatar identity={member} />
                          <span className="grid min-w-0 flex-1">
                            <strong className="truncate text-sm">{member.name}</strong>
                            <small className="truncate text-xs text-muted-foreground">{member.handle} / {member.role}</small>
                          </span>
                          <Badge variant="outline">{channelReadinessLabel(readiness, input.messages)}</Badge>
                        </Label>
                      );
                    })}
                  </div>
                </ScrollArea>
              </fieldset>
            ) : null}
            <DialogFooter>
              <Button onClick={closeCreateChannelModal} type="button" variant="outline">{input.messages.common.cancel}</Button>
              <Button type="submit"><Plus aria-hidden="true" size={14} />{input.messages.common.create}</Button>
            </DialogFooter>
          </form>
      </ShellDialog>
    </div>
  );
}

function SavedMessagesPanel(input: {
  data: SleiFixtures;
  messages: DesktopMessages;
  onClose: () => void;
  onSelect?: (savedMessage: SavedMessageView) => void;
  savedMessages: SavedMessageView[];
}) {
  const entries = input.savedMessages
    .map((savedMessage) => {
      const message = input.data.messages.find((candidate) => candidate.id === savedMessage.messageId);
      return { savedMessage, message };
    })
    .filter((entry): entry is { savedMessage: SavedMessageView; message: SleiMessage } => Boolean(entry.message));

  return (
    <section aria-label={input.messages.common.saved} className="slei-saved-panel flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex items-center justify-between text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <span>{input.messages.common.saved} {entries.length}</span>
        <Button onClick={input.onClose} size="sm" type="button" variant="ghost"><Hash aria-hidden="true" size={13} />{input.messages.chat.channels}</Button>
      </div>
      {entries.length === 0 ? (
        <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">{input.messages.search.noResultDescription}</p>
      ) : null}
      <ScrollArea className="min-h-0 flex-1">
        <div className="grid gap-2 pr-2">
          {entries.map(({ savedMessage, message }) => (
            <Button
              aria-label={input.messages.search.openConversation(message.id)}
              className="h-auto w-full justify-start whitespace-normal rounded-lg border bg-background px-3 py-2 text-left"
              key={savedMessage.id}
              onClick={() => input.onSelect?.(savedMessage)}
              type="button"
              variant="ghost"
            >
              <span className="grid min-w-0 gap-1">
                <span className="text-xs font-normal text-muted-foreground">{savedMessageSourceLabel(savedMessage, input.data)}</span>
                <strong className="text-sm">{message.author}</strong>
                <span className="line-clamp-3 text-xs font-normal text-muted-foreground">{message.body}</span>
              </span>
            </Button>
          ))}
        </div>
      </ScrollArea>
    </section>
  );
}

function savedMessageSourceLabel(savedMessage: SavedMessageView, data: SleiFixtures) {
  const date = formatSavedDate(savedMessage.savedAt);
  if (savedMessage.sourceKind === "dm" || savedMessage.sourceId.startsWith("dm:")) {
    const conversation = data.conversations.find((candidate) => candidate.id === savedMessage.sourceId);
    const member = data.members.find((candidate) => candidate.id === conversation?.agentId);
    const session = data.conversationSessions.find((candidate) => candidate.id === savedMessage.sessionId);
    const title = [member?.name ?? conversation?.agentId ?? savedMessage.sourceId, session?.title].filter(Boolean).join(" / ");
    return `私聊 · ${title} · ${date}`;
  }

  const channel = data.channels.find((candidate) => candidate.id === savedMessage.sourceId);
  return `群聊 · #${stripChannelHash(channel?.name ?? savedMessage.sourceId)} · ${date}`;
}

function formatSavedDate(value: string) {
  const raw = value.trim();
  if (!raw) return "";
  const direct = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (direct) return direct[1];
  let date: Date;
  if (/^\d+$/.test(raw)) {
    const numeric = BigInt(raw);
    const milliseconds =
      raw.length >= 16
        ? numeric / 1_000_000n
        : raw.length >= 13
          ? numeric
          : numeric * 1_000n;
    date = new Date(Number(milliseconds));
  } else {
    date = new Date(raw);
  }
  if (Number.isNaN(date.getTime())) return raw;
  return date.toISOString().slice(0, 10);
}

function ContextPanel({ activeView, data, messages }: { activeView: AppView; data: SleiFixtures; messages: DesktopMessages }) {
  return (
    <ScrollArea className="h-full">
      <div className="grid gap-3 p-3">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{messages.shell.sectionLabel[activeView]}</div>
      <div className="rounded-lg border bg-background p-3">
        <strong>{data.tasks.filter((task) => task.attention).length}</strong>
        <span className="ml-2 text-sm text-muted-foreground">{messages.shell.attentionNeeded}</span>
      </div>
      <div className="rounded-lg border bg-background p-3">
        <strong>{data.nodes.length}</strong>
        <span className="ml-2 text-sm text-muted-foreground">{messages.shell.connectedComputers}</span>
      </div>
      <div className="rounded-lg border bg-background p-3">
        <strong>{data.members.filter((member) => member.type === "agent").length}</strong>
        <span className="ml-2 text-sm text-muted-foreground">{messages.shell.availableAgents}</span>
      </div>
      </div>
    </ScrollArea>
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
    <ScrollArea className="h-full" aria-label={input.messages.settings.title}>
      <div className="grid gap-4 p-3">
      {settingsMenu.map((group) => (
        <div className="grid gap-2" key={group.title}>
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{input.messages.settings.groups[group.title]}</div>
          {group.items.length === 0 ? (
            <p className="flex items-center gap-2 rounded-lg border border-dashed p-3 text-sm text-muted-foreground"><Server aria-hidden="true" size={14} />{input.messages.settings.serverReserved}</p>
          ) : null}
          {group.items.map((item) => (
            <Button
              aria-current={input.activePanel === item.id ? "page" : undefined}
              className={cn("w-full justify-start", input.activePanel === item.id && "bg-accent text-accent-foreground")}
              key={item.id}
              onClick={() => input.onSelect?.(item.id)}
              type="button"
              variant="ghost"
            >
              <item.icon aria-hidden="true" data-settings-icon={item.id} size={15} strokeWidth={2.8} />
              <span>{input.messages.settings[item.labelKey]}</span>
            </Button>
          ))}
        </div>
      ))}
      </div>
    </ScrollArea>
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
    <ScrollArea className="slei-members-navigator h-full">
      <div className="grid gap-3 p-3">
        <div className="flex items-center justify-between text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <span>{input.messages.members.agents}</span>
          <Button aria-label={input.messages.members.newAgent} onClick={input.onCreateAgentRequest} size="icon-xs" type="button" variant="ghost"><Plus aria-hidden="true" size={14} /></Button>
        </div>
        <small className="text-muted-foreground">macbookpro m4 max</small>
        {agents.length === 0 ? <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">{input.messages.members.noAgents}</p> : null}
        {agents.map((member) => (
          <Button
            aria-current={(input.activeMemberId ?? agents[0]?.id) === member.id ? "true" : undefined}
            className={cn("h-auto w-full justify-start px-2 py-2 text-left", (input.activeMemberId ?? agents[0]?.id) === member.id && "bg-accent text-accent-foreground")}
            key={member.id}
            onClick={() => input.onSelect?.(member.id)}
            type="button"
            variant="ghost"
          >
            <MemberAvatar identity={member} />
            <span className="grid min-w-0 flex-1 gap-1">
              <strong className="truncate text-sm">{member.name}</strong>
              <small className="truncate text-xs font-normal text-muted-foreground">{member.role}</small>
            </span>
            <StatusDot status={member.runtimeStatus} />
          </Button>
        ))}
      </div>
    </ScrollArea>
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
    <ScrollArea className="slei-computers-list h-full" aria-label={input.messages.shell.sidebarSubtitle.computers}>
      <div className="grid gap-3 p-3">
      <div className="flex items-center justify-between text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <span>{input.messages.computers.computers} {input.nodes.length}</span>
        <Button aria-label={input.messages.computers.newComputer} onClick={input.onAdd} size="icon-xs" type="button" variant="ghost"><Plus aria-hidden="true" size={14} /></Button>
      </div>
      {input.nodes.map((node) => (
        <div className="group flex items-start gap-1" key={node.id}>
          <Button
            aria-current={input.activeNodeId === node.id ? "true" : undefined}
            className={cn("h-auto min-h-12 flex-1 justify-start px-2 py-2 text-left", input.activeNodeId === node.id && "bg-accent text-accent-foreground")}
            onClick={() => input.onSelect?.(node.id)}
            type="button"
            variant="ghost"
          >
            <span className="grid size-8 place-items-center rounded-md bg-muted"><Monitor aria-hidden="true" size={16} /></span>
            <span className="grid min-w-0 flex-1 gap-1">
              <strong className="truncate text-sm">{node.name}</strong>
              <small className="truncate text-xs font-normal text-muted-foreground">daemon {node.daemonVersion}</small>
            </span>
            <StatusDot status={node.status === "connected" ? "idle" : "offline"} />
          </Button>
          {node.id !== "local-node" ? (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button aria-label={input.messages.computers.deleteComputer(node.name)} className="mt-1 opacity-80 group-hover:opacity-100" size="icon-xs" type="button" variant="ghost"><Trash2 aria-hidden="true" size={13} /></Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{input.messages.computers.deleteComputer(node.name)}</AlertDialogTitle>
                  <AlertDialogDescription>
                    {input.messages.computers.deleteComputer(node.name)}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{input.messages.common.cancel}</AlertDialogCancel>
                  <AlertDialogAction onClick={() => input.onDelete?.(node.id)} variant="destructive">
                    {input.messages.common.delete}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          ) : null}
        </div>
      ))}
      </div>
    </ScrollArea>
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
  initialChannelView?: ChannelEmbeddedView,
  initialComposerAttachments?: ConversationAttachmentView[],
  initialSearchFilters?: ChatSearchFilters,
  onSearchResultSelect?: (channelId: string, messageId: string) => void,
  activeComputerId?: string,
  onComputerCreateRequest?: () => void,
  onComputerRename?: (nodeId: string, name: string) => void,
  activeMemberId?: string,
  activeTaskId?: string,
  onTaskReply?: (taskId: string, body: string) => Promise<void> | void,
  onTaskStatusChange?: (taskId: string, status: SleiFixtures["tasks"][number]["status"]) => Promise<void> | void,
  onTaskThreadOpen?: (taskId: string) => Promise<void> | void,
  onAgentUpdate?: (agentId: string, update: Partial<AgentDraftInput>) => Promise<void> | void,
  onAgentDelete?: (agentId: string) => Promise<void> | void,
  onMemberMessage?: (memberId: string) => void,
  onOpenAgentPath?: (agentId: string, target: AgentPathTarget) => Promise<void> | void,
  onListAgentWorkspace?: (agentId: string, relativePath?: string) => Promise<AgentWorkspaceListReceipt> | AgentWorkspaceListReceipt,
  onReadAgentWorkspaceFile?: (agentId: string, relativePath: string) => Promise<AgentWorkspaceFileReceipt> | AgentWorkspaceFileReceipt,
  onConversationNewSession?: (conversationId: string) => Promise<void> | void,
  onConversationHistoryToggle?: () => void,
  onConversationSessionSelect?: (conversationId: string, sessionId: string) => Promise<void> | void,
  onAttachmentUpload?: (request: ConversationAttachmentUploadRequest) => Promise<{ attachment: ConversationAttachmentView }>,
  onPermissionResolve?: (requestId: string, decision: PermissionDecision) => Promise<void> | void,
  sessionDrawerOpen?: boolean,
  sendingConversationIds: string[] = [],
  savedMessages: SavedMessageView[] = [],
  focusedMessageId?: string,
  onMessageSaveToggle?: (message: SleiMessage) => Promise<void> | void,
  onAgentDraftCreate?: (draft: Partial<AgentDraftInput>, cardId?: string) => void,
  onChannelDraftCreate?: (draft: Record<string, unknown>, cardId?: string) => void,
) {
  if (activeView === "search") return <SearchRoute data={data} initialFilters={initialSearchFilters} messages={messages} onResultSelect={onSearchResultSelect} />;
  if (activeView === "tasks") return <TasksRoute activeTaskId={activeTaskId} data={data} messages={messages} onTaskReply={onTaskReply} onTaskStatusChange={onTaskStatusChange} onTaskThreadOpen={onTaskThreadOpen} />;
  if (activeView === "members") return <MembersRoute activeMemberId={activeMemberId} data={data} messages={messages} nodes={runtimeSetup.nodes} onAgentDelete={onAgentDelete} onAgentUpdate={onAgentUpdate} onMessage={onMemberMessage} onOpenAgentPath={onOpenAgentPath} onListAgentWorkspace={onListAgentWorkspace} onReadAgentWorkspaceFile={onReadAgentWorkspaceFile} />;
  if (activeView === "computers") {
    return (
      <ComputersRoute
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
      <SettingsRoute
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
  return <ChatRoute activeChannel={activeChannel} activeConversation={activeConversation} activeSessionId={activeSessionId} data={data} focusedMessageId={focusedMessageId} initialAttachments={initialComposerAttachments} initialChannelView={initialChannelView} initialDraft={initialChatDraft} messages={messages} onAgentDraftCreate={onAgentDraftCreate} onAttachmentUpload={onAttachmentUpload} onChannelDraftCreate={onChannelDraftCreate} onConversationHistoryToggle={onConversationHistoryToggle} onConversationNewSession={onConversationNewSession} onConversationSessionSelect={onConversationSessionSelect} onMessageSaveToggle={onMessageSaveToggle} onPermissionResolve={onPermissionResolve} onSendMessage={onSendMessage} onTaskReply={onTaskReply} onTaskStatusChange={onTaskStatusChange} onTaskThreadOpen={onTaskThreadOpen} profile={profile} savedMessageIds={savedMessages.map((savedMessage) => savedMessage.messageId)} sending={activeConversation ? sendingConversationIds.includes(activeConversation.id) : false} sessionDrawerOpen={sessionDrawerOpen} />;
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
    <ShellDialog closeLabel={input.messages.common.cancel} open onOpenChange={(open) => {
      if (!open) input.onClose();
    }}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Monitor aria-hidden="true" size={20} />{input.messages.computers.newComputer}</DialogTitle>
          <DialogDescription>{input.messages.computers.deviceName} / {input.messages.computers.os}</DialogDescription>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={submitCreate}>
          <div className="grid gap-2">
            <Label htmlFor="slei-computer-name">{input.messages.computers.deviceName}</Label>
            <Input aria-label={input.messages.computers.deviceName} id="slei-computer-name" onChange={(event) => setNewName(event.currentTarget.value)} placeholder="Design Mac" value={newName} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="slei-computer-os">{input.messages.computers.os}</Label>
            <Input aria-label={input.messages.computers.os} id="slei-computer-os" onChange={(event) => setNewOs(event.currentTarget.value)} placeholder="darwin arm64" value={newOs} />
          </div>
          <DialogFooter>
            <Button onClick={input.onClose} type="button" variant="outline">{input.messages.common.cancel}</Button>
            <Button type="submit"><Plus aria-hidden="true" size={14} />{input.messages.common.create}</Button>
          </DialogFooter>
        </form>
    </ShellDialog>
  );
}

function fontSizeValue(size: AppearancePreferences["fontSize"]) {
  return {
    sm: "14px",
    md: "15px",
    lg: "16px",
  }[size];
}

function ShellDialog(input: {
  children: ReactNode;
  className?: string;
  closeLabel?: string;
  onOpenChange?: (open: boolean) => void;
  open: boolean;
  showCloseButton?: boolean;
}) {
  if (typeof document === "undefined") {
    if (!input.open) return null;
    return (
      <Dialog open={input.open} onOpenChange={input.onOpenChange}>
        <div data-slot="dialog-portal">
          <div className="fixed inset-0 isolate z-50 bg-black/10" data-slot="dialog-overlay" />
          <div
            aria-modal="true"
            className={cn("fixed top-1/2 left-1/2 z-50 grid w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-xl bg-popover p-4 text-sm text-popover-foreground ring-1 ring-foreground/10 sm:max-w-sm", input.className)}
            data-slot="dialog-content"
            role="dialog"
          >
            {input.children}
            {input.showCloseButton !== false ? (
              <button className="absolute top-2 right-2" data-slot="dialog-close" type="button">
                <span className="sr-only">{input.closeLabel ?? "Close"}</span>
              </button>
            ) : null}
          </div>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog open={input.open} onOpenChange={input.onOpenChange}>
      <DialogContent className={input.className} closeLabel={input.closeLabel} showCloseButton={input.showCloseButton}>
        {input.children}
      </DialogContent>
    </Dialog>
  );
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
    <ShellDialog closeLabel={input.messages.common.cancel} open onOpenChange={(open) => {
      if (!open) input.onClose();
    }} className="slei-agent-modal max-h-[min(90vh,44rem)] overflow-hidden sm:max-w-lg">
        <DialogHeader>
          <Badge className="w-fit" variant="secondary">{input.messages.agentCreate.fallbackAgent}</Badge>
          <DialogTitle className="flex items-center gap-2"><AtSign aria-hidden="true" size={20} />{input.messages.agentCreate.title}</DialogTitle>
          <DialogDescription>{input.messages.agentCreate.associatedDevice} / {input.messages.agentCreate.model} / {input.messages.agentCreate.description}</DialogDescription>
        </DialogHeader>
        <form className="grid min-h-0 gap-4" onSubmit={submitCreate}>
          <div className="grid gap-2">
            <Label htmlFor="slei-agent-runtime">Runtime</Label>
            <Select value={runtimeKind} onValueChange={setRuntimeKind}>
              <SelectTrigger aria-label="Runtime" className="w-full" id="slei-agent-runtime">
                <SelectValue placeholder="Runtime" />
              </SelectTrigger>
              <SelectContent>
                {input.nodes
                  .flatMap((node) => node.runtimes.map((runtime) => runtime.kind))
                  .filter((kind, index, all) => all.indexOf(kind) === index)
                  .map((kind) => <SelectItem key={kind} value={kind}>{kind}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="slei-agent-name">{input.messages.agentCreate.name}</Label>
            <Input id="slei-agent-name" onChange={(event) => {
              setName(event.currentTarget.value);
              if (!handle.trim()) setHandle(normalizeHandleInput(event.currentTarget.value));
            }} value={name} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="slei-agent-handle">{input.messages.agentCreate.handle}</Label>
            <Input id="slei-agent-handle" onChange={(event) => setHandle(event.currentTarget.value)} value={handle} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="slei-agent-node">{input.messages.agentCreate.associatedDevice}</Label>
            <Select value={nodeId} onValueChange={setNodeId}>
              <SelectTrigger aria-label={input.messages.agentCreate.associatedDevice} className="w-full" id="slei-agent-node">
                <SelectValue placeholder={input.messages.agentCreate.associatedDevice} />
              </SelectTrigger>
              <SelectContent>
                {input.nodes.map((node) => <SelectItem key={node.id} value={node.id}>{node.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="slei-agent-model">{input.messages.agentCreate.model}</Label>
            <Input id="slei-agent-model" onChange={(event) => setModel(event.currentTarget.value)} value={model} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="slei-agent-description">{input.messages.agentCreate.description}</Label>
            <Textarea id="slei-agent-description" onChange={(event) => setDescription(event.currentTarget.value)} value={description} />
          </div>
          <DialogFooter>
            <Button onClick={input.onClose} type="button" variant="outline">{input.messages.common.cancel}</Button>
            <Button type="submit">{input.messages.common.create}</Button>
          </DialogFooter>
        </form>
    </ShellDialog>
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
    <ShellDialog closeLabel={input.messages.common.cancel} open className="sm:max-w-lg" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{input.messages.onboarding.title}</DialogTitle>
          <DialogDescription>{input.messages.onboarding.description}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="slei-runtime-device-name">{input.messages.onboarding.deviceName}</Label>
            <Input id="slei-runtime-device-name" value={name} onChange={(event) => setName(event.currentTarget.value)} />
          </div>
          <div className="rounded-lg border">
            {(localNode?.runtimes ?? []).map((runtime, index) => (
              <div className={cn("flex items-center justify-between gap-3 px-3 py-2", index > 0 && "border-t")} key={runtime.kind}>
                <span>{runtime.kind}</span>
                <Badge variant={runtime.readiness === "ready" ? "secondary" : "outline"}>{runtime.version ?? runtime.readiness}</Badge>
              </div>
            ))}
          </div>
          {localNode ? (
            <dl className="grid gap-2 text-sm">
              <div className="flex items-center justify-between gap-3"><dt className="text-muted-foreground">{input.messages.onboarding.os}</dt><dd>{deviceOsLabel(localNode.device)}</dd></div>
              <div className="flex items-center justify-between gap-3"><dt className="text-muted-foreground">{input.messages.onboarding.hostname}</dt><dd>{localNode.device.hostname}</dd></div>
            </dl>
          ) : null}
        </div>
        <DialogFooter>
          <Button onClick={() => input.onRenameLocalNode?.(name)} type="button" variant="outline">{input.messages.onboarding.saveDeviceName}</Button>
          <Button disabled={input.loading} onClick={() => input.onRefreshRuntime?.()} type="button">{input.messages.onboarding.refreshRuntime}</Button>
        </DialogFooter>
    </ShellDialog>
  );
}
