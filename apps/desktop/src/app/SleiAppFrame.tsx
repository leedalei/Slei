import { type CSSProperties, type FormEvent, type PointerEvent as ReactPointerEvent, type ReactNode, useEffect, useRef, useState } from "react";
import {
  ArrowUpDown,
  Bell,
  Bookmark,
  CheckSquare,
  CircleUserRound,
  FolderPlus,
  Globe2,
  Hash,
  Info,
  LoaderCircle,
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
import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import {
  type AppearancePreferences,
  type AppLocale,
  type ConversationAttachmentUploadRequest,
  type ConversationAttachmentView,
  type ConversationView,
  type DesktopNodeView,
  type ChannelReceipt,
  type InteractiveCardView,
  type NotificationPreferences,
  type PermissionDecision,
  type SavedMessageView,
  type AgentPathTarget,
  type AgentActivityListReceipt,
  type AgentWorkspaceFileReceipt,
  type AgentWorkspaceListReceipt,
  type GlobalMessageSearchResult,
  type GlobalSearchQuery,
  type GlobalSearchReceipt,
  type RuntimeSetupState,
} from "../lib/daemon-bridge";
import { createDesktopMessages, type DesktopMessages } from "../i18n";
import type { ChannelEmbeddedView } from "../features/chat/ChatPageView";
import { Empty, MemberAvatar, StatusDot, Toast, TooltipButton, type ToastType } from "../components";
import { ChatRoute } from "./routes/ChatRoute";
import { ComputersRoute } from "./routes/ComputersRoute";
import { MembersRoute } from "./routes/MembersRoute";
import { SearchRoute } from "./routes/SearchRoute";
import { SettingsRoute } from "./routes/SettingsRoute";
import { TasksRoute } from "./routes/TasksRoute";
import type { SleiFixtures, SleiMember, SleiMessage } from "./types";
import {
  channelReadinessLabel,
  defaultAppearance,
  defaultNotifications,
  defaultTimeZone,
  deviceOsLabel,
  localHumanPresentation,
  normalizeAppearanceTheme,
  stripChannelHash,
  type AgentDraftInput,
  type AppView,
  type ChatSearchFilters,
  type SettingsPanel,
  type UserProfile,
} from "./model";

const navItems: Array<{ id: AppView; icon: LucideIcon }> = [
  { id: "search", icon: Search },
  { id: "chat", icon: MessageCircle },
  { id: "tasks", icon: CheckSquare },
  { id: "members", icon: CircleUserRound },
  { id: "computers", icon: Monitor },
  { id: "settings", icon: Settings },
];

export type ChatWorkspaceMode = "chat" | "saved";

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
  activeChatWorkspace?: ChatWorkspaceMode;
  initialAgentCreateModalOpen?: boolean;
  initialCreateChannelModalOpen?: boolean;
  guideBootstrapping?: boolean;
  initialSettingsPanel?: SettingsPanel;
  initialSearchFilters?: ChatSearchFilters;
  locale: AppLocale;
  timeZone?: string;
  appearance?: AppearancePreferences;
  notifications?: NotificationPreferences;
  profile?: UserProfile | null;
  pendingPreference?: "locale" | "timeZone" | "appearance" | "notifications";
  preferenceError?: string;
  pendingProfileField?: "displayName" | "avatar";
  profileErrors?: Partial<Record<"displayName" | "avatar", string>>;
  memberFieldErrors?: Record<string, string>;
  savingMemberField?: string;
  runtimeSetup: RuntimeSetupState;
  runtimeErrorToastMessage?: string;
  runtimeToastType?: ToastType;
  computerRenameError?: string;
  renamingComputerId?: string;
  sessionDrawerOpen?: boolean;
  sendingConversationIds?: string[];
  sidebarWidth?: number;
  savedMessages?: SavedMessageView[];
  onAgentCreate?: (request: AgentDraftInput) => Promise<void> | void;
  onAgentDelete?: (agentId: string) => Promise<void> | void;
  onAgentUpdate?: (agentId: string, update: Partial<AgentDraftInput>) => Promise<void> | void;
  onChannelCreate?: (input: { name: string; projectName?: string; projectPaths?: string[]; agentIds?: string[] }) => Promise<ChannelReceipt | void> | ChannelReceipt | void;
  onChannelCreateFailure?: (message: string, type?: ToastType) => void;
  onChannelCreateLog?: (message: string, context?: Record<string, unknown>) => void;
  onChannelCreateRefresh?: (channelId: string) => Promise<SleiFixtures["channels"]> | SleiFixtures["channels"];
  onChannelDelete?: (channelId: string) => void;
  onChannelMemberAdd?: (agentId: string) => Promise<void> | void;
  onChannelMemberRemove?: (agentId: string) => Promise<void> | void;
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
  onComputerRename?: (nodeId: string, name: string) => Promise<void> | void;
  onGlobalSearch?: (query: GlobalSearchQuery) => Promise<GlobalSearchReceipt> | GlobalSearchReceipt;
  onAppearanceChange?: (appearance: AppearancePreferences) => Promise<void> | void;
  onLocaleChange?: (locale: AppLocale) => Promise<void> | void;
  onTimeZoneChange?: (timeZone: string) => Promise<void> | void;
  onNotificationsChange?: (notifications: NotificationPreferences) => Promise<void> | void;
  onProfileChange?: (patch: Partial<Pick<UserProfile, "displayName" | "avatar">>) => Promise<void> | void;
  onResizeStart?: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onAgentResultSelect?: (agentId: string) => void;
  onChannelResultSelect?: (channelId: string) => void;
  onMessageResultSelect?: (result: GlobalMessageSearchResult) => void;
  onSearchResultSelect?: (channelId: string, messageId: string) => void;
  onSavedMessageSelect?: (savedMessage: SavedMessageView) => void;
  onSavedMessagesOpen?: () => void;
  onMessageSaveToggle?: (message: SleiMessage) => Promise<void> | void;
  onMessageThreadOpen?: (message: SleiMessage) => Promise<void> | void;
  onMessageThreadReply?: (threadId: string, body: string) => Promise<void> | void;
  onOlderMessagesLoad?: () => Promise<void> | void;
  onMemberSelect?: (memberId: string) => void;
  onMemberMessage?: (memberId: string) => void;
  onOpenAgentPath?: (agentId: string, target: AgentPathTarget) => Promise<void> | void;
  onListAgentActivity?: (agentId: string, limit?: number) => Promise<AgentActivityListReceipt> | AgentActivityListReceipt;
  onListAgentWorkspace?: (agentId: string, relativePath?: string) => Promise<AgentWorkspaceListReceipt> | AgentWorkspaceListReceipt;
  onReadAgentWorkspaceFile?: (agentId: string, relativePath: string) => Promise<AgentWorkspaceFileReceipt> | AgentWorkspaceFileReceipt;
  onSendMessage?: (body: string, options?: { asTask?: boolean; attachmentIds?: string[]; sessionId?: string }) => Promise<void> | void;
  onMessageSendFailure?: (message: string, type?: ToastType) => void;
  onTaskReply?: (taskId: string, body: string) => Promise<void> | void;
  onTaskStatusChange?: (taskId: string, status: SleiFixtures["tasks"][number]["status"]) => Promise<void> | void;
  onTaskThreadOpen?: (taskId: string) => Promise<void> | void;
  onViewChange?: (view: AppView) => void;
  onRenameLocalNode?: (name: string) => Promise<void> | void;
  onRefreshRuntime?: () => Promise<void> | void;
};

export function SleiAppFrame(input: SleiAppFrameProps) {
  const activeChannel = input.data.channels.find((channel) => channel.id === input.activeChannelId) ?? input.data.channels[0];
  const activeTargetId = activeChannel?.id ?? "";
  const activeConversation = input.data.conversations.find((conversation) => conversation.id === input.activeConversationId);
  const activeSessionId = input.activeSessionId ?? activeConversation?.activeSessionId;
  const firstComputer = input.runtimeSetup.nodes[0];
  const [activeComputerId, setActiveComputerId] = useState(firstComputer?.id ?? "");
  const [computerCreateOpen, setComputerCreateOpen] = useState(false);
  const [agentCreateOpen, setAgentCreateOpen] = useState(input.initialAgentCreateModalOpen ?? false);
  const [activeSettingsPanel, setActiveSettingsPanel] = useState<SettingsPanel>(input.initialSettingsPanel ?? "account");
  const [agentDraft, setAgentDraft] = useState<Partial<AgentDraftInput> | undefined>(undefined);
  const [activeCardId, setActiveCardId] = useState<string | undefined>(undefined);
  const appearance = input.appearance ?? defaultAppearance;
  const normalizedTheme = normalizeAppearanceTheme(appearance.theme);
  const normalizedAppearance = { ...appearance, theme: normalizedTheme };
  const messages = createDesktopMessages(input.locale);
  const profile = input.profile ?? null;
  const sidebarTitle = messages.shell.nav[input.activeView];
  const hasContextSidebar = input.activeView !== "tasks" && input.activeView !== "search";
  const activeAgentActivities = input.activeView === "chat"
    ? findActiveAgentActivities(input.data, activeChannel, activeConversation, activeSessionId)
    : [];
  const activeAgentActivity = selectAgentActivityForTick(activeAgentActivities, 0);
  const shellStyle = {
    "--slei-sidebar-width": `${input.sidebarWidth ?? 240}px`,
    "--slei-font-size": fontSizeValue(appearance.fontSize),
    gridTemplateColumns: hasContextSidebar ? "5.5rem var(--slei-sidebar-width, 15rem) 0.5rem minmax(0, 1fr)" : "5.5rem minmax(0, 1fr)",
  } as CSSProperties;

  useEffect(() => {
    if (input.runtimeSetup.nodes.some((node) => node.id === activeComputerId)) return;
    setActiveComputerId(firstComputer?.id ?? "");
  }, [activeComputerId, firstComputer?.id, input.runtimeSetup.nodes]);

  return (
    <TooltipProvider>
    <div
      className={cn("grid h-screen min-h-0 overflow-hidden bg-background text-foreground", normalizedTheme === "dark" && "dark")}
      data-active-view={input.activeView}
      data-theme={normalizedTheme}
      style={shellStyle}
    >
      <Toast message={input.runtimeErrorToastMessage} type={input.runtimeToastType} />
      <nav className="flex min-h-0 flex-col items-center gap-2 border-r bg-sidebar px-2 pb-3 pt-10 text-sidebar-foreground" data-tauri-drag-region="deep" aria-label={messages.shell.mainNavigation}>
        <div className="slei-brand">
          <span className="slei-brand__mark" aria-hidden="true">
            SLei
          </span>
        </div>
        {navItems.map((item) => (
          <TooltipButton
            aria-label={messages.shell.nav[item.id]}
            aria-current={input.activeView === item.id ? "page" : undefined}
            className={cn(
              "grid h-16 w-16 place-items-center rounded-lg p-0",
              input.activeView === item.id && "shadow-sm",
            )}
            data-nav-icon={item.id}
            key={item.id}
            onClick={() => input.onViewChange?.(item.id)}
            size="lg"
            tooltip={messages.shell.nav[item.id]}
            type="button"
            variant={input.activeView === item.id ? "default" : "ghost"}
          >
            <item.icon aria-hidden="true" className="size-5" strokeWidth={2.8} />
          </TooltipButton>
        ))}
      </nav>

      {hasContextSidebar ? (
        <>
          <aside className="slei-context-sidebar min-h-0 border-r bg-sidebar/70 text-sidebar-foreground max-[760px]:hidden">
            <SidebarFrame title={sidebarTitle}>
              {input.activeView === "chat" || input.activeView === "search" ? (
                <ChannelList
                  activeChannelId={input.activeConversationId ? undefined : activeChannel?.id}
                  activeConversationId={input.activeConversationId}
                  data={input.data}
                  initialCreateChannelModalOpen={input.initialCreateChannelModalOpen}
                  savedOpen={input.activeChatWorkspace === "saved"}
                  activeAgentActivity={activeAgentActivity}
                  onChannelCreate={input.onChannelCreate}
                  onChannelCreateFailure={input.onChannelCreateFailure}
                  onChannelCreateLog={input.onChannelCreateLog}
                  onChannelCreateRefresh={input.onChannelCreateRefresh}
                  onChannelDelete={input.onChannelDelete}
                  onChannelSelect={input.onChannelSelect}
                  onConversationSelect={input.onConversationSelect}
                  onSavedMessagesOpen={input.onSavedMessagesOpen}
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

          <Button
            aria-label={messages.common.resizeSidebar}
            aria-orientation="vertical"
            className="h-full w-1 !cursor-col-resize rounded-none border-0 bg-border/50 p-0 hover:bg-border focus-visible:ring-offset-0"
            onPointerDown={input.onResizeStart}
            role="separator"
            type="button"
            variant="ghost"
          />
        </>
      ) : null}

      <main className="slei-workspace min-h-0 min-w-0 overflow-hidden bg-background">{renderWorkspace(input.activeView, input.activeChatWorkspace ?? "chat", input.data, activeChannel, activeConversation, activeSessionId, input.runtimeSetup, profile, input.locale, messages, input.timeZone ?? defaultTimeZone, normalizedAppearance, input.notifications ?? defaultNotifications, activeSettingsPanel, input.onProfileChange, input.onLocaleChange, input.onTimeZoneChange, input.onAppearanceChange, input.onNotificationsChange, input.onSendMessage, input.onMessageSendFailure, input.initialChatDraft, input.initialChannelView, input.initialComposerAttachments, input.initialSearchFilters, input.onGlobalSearch, input.onAgentResultSelect, input.onChannelResultSelect, input.onMessageResultSelect, input.onSearchResultSelect, activeComputerId, () => setComputerCreateOpen(true), input.onComputerRename, input.activeMemberId, input.activeTaskId, input.onTaskReply, input.onTaskStatusChange, input.onTaskThreadOpen, input.onAgentUpdate, input.onAgentDelete, input.onMemberMessage, input.onOpenAgentPath, input.onListAgentActivity, input.onListAgentWorkspace, input.onReadAgentWorkspaceFile, input.onConversationNewSession, input.onConversationHistoryToggle, input.onConversationSessionSelect, input.onAttachmentUpload, input.onPermissionResolve, input.onChannelMemberAdd, input.onChannelMemberRemove, input.sessionDrawerOpen ?? input.initialConversationHistoryOpen, input.sendingConversationIds ?? [], input.savedMessages ?? [], input.onSavedMessageSelect, input.focusedMessageId, input.onMessageSaveToggle, input.onMessageThreadOpen, input.onMessageThreadReply, input.onOlderMessagesLoad, (draft, cardId) => {
        setAgentDraft(draft);
        setActiveCardId(cardId);
        setAgentCreateOpen(true);
      }, async (draft, cardId) => {
        const projectPaths = Array.isArray(draft.projectPaths) ? draft.projectPaths.filter((path): path is string => typeof path === "string") : [];
        const result = await submitChannelDraftWithFeedback({
          draft: {
            name: String(draft.name ?? ""),
            projectName: typeof draft.projectName === "string" ? draft.projectName : "",
            projectPaths,
            selectedAgentIds: Array.isArray(draft.agentIds) ? draft.agentIds.filter((id): id is string => typeof id === "string") : [],
          },
          createFailedMessage: messages.chat.createChannelFailed,
          createPartialFailureMessage: messages.chat.createChannelPartialFailure,
          channelNameRequiredMessage: messages.chat.channelNameRequired,
          createdMessage: messages.chat.createChannelCreated,
          onCreateFailure: input.onChannelCreateFailure,
          onCreateSuccess: input.onChannelCreateFailure,
          onChannelCreate: input.onChannelCreate,
          onChannelRefresh: input.onChannelCreateRefresh,
          onLog: input.onChannelCreateLog,
        });
        if (!result.created) return;
        if (cardId) await input.onInteractiveCardComplete?.(cardId);
      }, input.pendingPreference, input.preferenceError, input.pendingProfileField, input.profileErrors, input.memberFieldErrors, input.savingMemberField, input.computerRenameError, input.renamingComputerId)}</main>

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
            try {
              await input.onAgentCreate?.(request);
              if (activeCardId) await input.onInteractiveCardComplete?.(activeCardId);
              setAgentCreateOpen(false);
              setAgentDraft(undefined);
              setActiveCardId(undefined);
            } catch (error) {
              input.onChannelCreateFailure?.(formatChannelCreateFailure(messages.agentCreate.createdFailed, error), "error");
            }
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
    </TooltipProvider>
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

export async function submitChannelDraftWithFeedback(input: {
  draft: ChannelDraftState;
  createFailedMessage: string;
  createPartialFailureMessage: string;
  channelNameRequiredMessage: string;
  createdMessage?: string;
  onCreateFailure?: (message: string, type?: ToastType) => void;
  onCreateSuccess?: (message: string, type?: ToastType) => void;
  onChannelCreate?: (input: { name: string; projectName?: string; projectPaths?: string[]; agentIds?: string[] }) => Promise<ChannelReceipt | void> | ChannelReceipt | void;
  onChannelRefresh?: (channelId: string) => Promise<SleiFixtures["channels"]> | SleiFixtures["channels"];
  onLog?: (message: string, context?: Record<string, unknown>) => void;
}) {
  const channelName = stripChannelHash(input.draft.name);
  input.onLog?.("submit", {
    name: channelName,
    agentCount: input.draft.selectedAgentIds.length,
    projectPathCount: input.draft.projectPaths.length,
  });
  if (!channelName) {
    input.onCreateFailure?.(input.channelNameRequiredMessage, "error");
    return { created: false, draft: input.draft };
  }

  try {
    input.onLog?.("request-start", { name: channelName });
    const receipt = await input.onChannelCreate?.(channelDraftCreateInput(input.draft));
    const channelId = receipt?.channel.id ?? channelName;
    input.onLog?.("request-success", { channelId });
    const channels = await refreshCreatedChannels(input, channelId);
    input.onCreateSuccess?.(input.createdMessage ?? "", "success");
    return { created: true, draft: resetChannelDraft(), channelId, channels };
  } catch (error) {
    const detail = channelCreateErrorDetail(error);
    input.onLog?.("request-failed", { name: channelName, error: detail });
    const fallback = await tryRefreshCreatedChannel(input, channelName, detail);
    if (fallback) return fallback;
    input.onCreateFailure?.(formatChannelCreateFailure(input.createFailedMessage, error), "error");
    return { created: false, draft: input.draft };
  }
}

async function refreshCreatedChannels(input: {
  onChannelRefresh?: (channelId: string) => Promise<SleiFixtures["channels"]> | SleiFixtures["channels"];
  onLog?: (message: string, context?: Record<string, unknown>) => void;
}, channelId: string) {
  if (!input.onChannelRefresh) return undefined;
  input.onLog?.("refresh-start", { channelId });
  try {
    const channels = await input.onChannelRefresh(channelId);
    input.onLog?.("refresh-success", { channelId, channelCount: channels.length });
    return channels;
  } catch (error) {
    input.onLog?.("refresh-failed", { channelId, error: channelCreateErrorDetail(error) });
    return undefined;
  }
}

async function tryRefreshCreatedChannel(input: {
  draft: ChannelDraftState;
  createPartialFailureMessage: string;
  onCreateFailure?: (message: string, type?: ToastType) => void;
  onChannelRefresh?: (channelId: string) => Promise<SleiFixtures["channels"]> | SleiFixtures["channels"];
  onLog?: (message: string, context?: Record<string, unknown>) => void;
}, channelName: string, detail: string) {
  const channels = await refreshCreatedChannels(input, channelName);
  const createdChannel = channels?.find((channel) => channel.id === channelName || stripChannelHash(channel.name) === channelName);
  if (!createdChannel) return undefined;
  input.onCreateFailure?.(formatChannelCreateFailure(input.createPartialFailureMessage, detail), "warn");
  return {
    created: true,
    draft: resetChannelDraft(),
    channelId: createdChannel.id,
    channels,
    partialFailure: detail,
  };
}

function formatChannelCreateFailure(prefix: string, error: unknown) {
  const detail = channelCreateErrorDetail(error);
  const trimmedDetail = detail.trim();
  return trimmedDetail ? `${prefix}：${trimmedDetail}` : prefix;
}

function channelCreateErrorDetail(error: unknown) {
  return error instanceof Error
    ? error.message
    : typeof error === "string"
      ? error
      : "";
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
      <div className="shrink-0 border-b px-3 pb-3 pt-4" data-slot="sidebar-titlebar" data-tauri-drag-region="deep">
        <h2 className="select-none text-base font-bold leading-none">{input.title}</h2>
      </div>
      <div className="min-h-0 flex-1">{input.children}</div>
    </div>
  );
}

function SidebarSectionTitle(input: { children: ReactNode }) {
  return (
    <span data-slot="sidebar-section-title" className="select-none">
      {input.children}
    </span>
  );
}

export type AgentActivityView = {
  member?: SleiMember;
  message: SleiMessage;
};

export function findActiveAgentActivities(
  data: SleiFixtures,
  activeChannel?: SleiFixtures["channels"][number],
  activeConversation?: ConversationView,
  activeSessionId?: string,
): AgentActivityView[] {
  const targetId = activeConversation?.id ?? activeChannel?.id;
  if (!targetId) return [];
  const activeMessages = data.messages.filter((message) => {
    if (message.channelId !== targetId) return false;
    if (activeConversation && activeSessionId && message.sessionId !== activeSessionId) return false;
    if (message.role !== "agent" || (message.status !== "running" && message.status !== "pending" && message.status !== "failed")) return false;
    const member = data.members.find((candidate) => candidate.name === message.author || candidate.handle === message.handle);
    return member?.directMessageEnabled !== false;
  });

  return activeMessages.map((message) => {
    const member = data.members.find((candidate) => candidate.name === message.author || candidate.handle === message.handle)
      ?? data.members.find((candidate) => activeConversation?.agentId && candidate.id === activeConversation.agentId);
    return { member, message };
  });
}

export function selectAgentActivityForTick(activities: AgentActivityView[], _tick: number): AgentActivityView | undefined {
  if (activities.length === 0) return undefined;
  return activities[0];
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
  savedOpen?: boolean;
  messages: DesktopMessages;
  onChannelCreate?: (input: { name: string; projectName?: string; projectPaths?: string[]; agentIds?: string[] }) => Promise<ChannelReceipt | void> | ChannelReceipt | void;
  onChannelCreateFailure?: (message: string) => void;
  onChannelCreateLog?: (message: string, context?: Record<string, unknown>) => void;
  onChannelCreateRefresh?: (channelId: string) => Promise<SleiFixtures["channels"]> | SleiFixtures["channels"];
  onChannelDelete?: (channelId: string) => void;
  onChannelSelect?: (channelId: string) => void;
  onConversationSelect?: (conversationId: string) => void;
  onSavedMessagesOpen?: () => void;
}) {
  const [channelDraft, setChannelDraft] = useState<ChannelDraftState>(() => resetChannelDraft());
  const [createOpen, setCreateOpen] = useState(input.initialCreateChannelModalOpen ?? false);
  const [creatingChannel, setCreatingChannel] = useState(false);
  const projectFolderInputRef = useRef<HTMLInputElement>(null);
  const directMessageConversations = input.data.conversations.filter((conversation) => {
    if (conversation.kind !== "dm") return false;
    const member = input.data.members.find((candidate) => candidate.id === conversation.agentId);
    return member?.directMessageEnabled !== false;
  });
  const agentMembers = input.data.members.filter((member) => member.type === "agent" && member.directMessageEnabled !== false);

  async function submitChannel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (creatingChannel) return;
    setCreatingChannel(true);
    try {
      const result = await submitChannelDraftWithFeedback({
        draft: channelDraft,
        createFailedMessage: input.messages.chat.createChannelFailed,
        createPartialFailureMessage: input.messages.chat.createChannelPartialFailure,
        channelNameRequiredMessage: input.messages.chat.channelNameRequired,
        createdMessage: input.messages.chat.createChannelCreated,
        onCreateFailure: input.onChannelCreateFailure,
        onCreateSuccess: input.onChannelCreateFailure,
        onChannelCreate: input.onChannelCreate,
        onChannelRefresh: input.onChannelCreateRefresh,
        onLog: input.onChannelCreateLog,
      });
      if (result.created) closeCreateChannelModal();
    } finally {
      setCreatingChannel(false);
    }
  }

  function closeCreateChannelModal() {
    setChannelDraft(resetChannelDraft());
    setCreateOpen(false);
    setCreatingChannel(false);
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
        <Button aria-pressed={input.savedOpen ? "true" : "false"} className="w-full justify-start" onClick={input.onSavedMessagesOpen} type="button" variant={input.savedOpen ? "secondary" : "ghost"}>
          <Bookmark aria-hidden="true" size={14} />{input.messages.common.saved}
        </Button>
      </div>
      <ScrollArea className="min-h-0 flex-1">
            <div className="space-y-4">
              <div className="flex items-center justify-between text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <SidebarSectionTitle>{input.messages.chat.channels} {input.data.channels.length}</SidebarSectionTitle>
              <div className="flex items-center gap-1">
                <Button aria-label={input.messages.chat.sortChannels} size="icon-xs" type="button" variant="ghost"><ArrowUpDown aria-hidden="true" size={14} /></Button>
                <Button aria-label={input.messages.chat.createChannel} onClick={() => setCreateOpen(true)} size="icon-xs" type="button" variant="ghost"><Plus aria-hidden="true" size={14} /></Button>
              </div>
            </div>
            <div className="space-y-1">
              {input.data.channels.map((channel) => (
                <div
                  className={cn(
                    "group/channel grid min-h-12 grid-cols-[minmax(0,1fr)_auto] items-start rounded-lg",
                    input.activeChannelId !== channel.id && "hover:bg-muted/60",
                    input.activeChannelId === channel.id && "bg-accent text-accent-foreground",
                  )}
                  key={channel.id}
                >
                  <Button
                    aria-current={input.activeChannelId === channel.id ? "true" : undefined}
                    className={cn(
                      "h-auto min-h-12 justify-start whitespace-normal px-2 py-2 text-left hover:bg-transparent hover:text-inherit",
                      input.activeChannelId === channel.id && "bg-transparent text-inherit",
                    )}
                    onClick={() => input.onChannelSelect?.(channel.id)}
                    type="button"
                    variant="ghost"
                  >
                    <span className="grid min-w-0 flex-1 gap-1">
                      <span className="flex min-w-0 items-center gap-2">
                        <Hash aria-hidden="true" size={14} />
                        <span className="truncate select-none">{stripChannelHash(channel.name)}</span>
                        {channel.unread > 0 ? <Badge className="ml-auto" variant="secondary">{channel.unread}</Badge> : null}
                      </span>
                      <small className="line-clamp-2 text-xs font-normal text-muted-foreground">{formatChannelProjectLabel(channel, input.messages)}</small>
                    </span>
                  </Button>
                  {channel.id !== "all" ? (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          aria-label={input.messages.chat.deleteChannel(stripChannelHash(channel.name))}
                          className="mr-1 self-center text-destructive opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover/channel:opacity-100 group-focus-within/channel:opacity-100 focus-visible:opacity-100"
                          size="icon-xs"
                          type="button"
                          variant="ghost"
                        >
                          <Trash2 aria-hidden="true" size={14} />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>{input.messages.chat.deleteChannel(stripChannelHash(channel.name))}</AlertDialogTitle>
                          <AlertDialogDescription>{input.messages.chat.deleteChannelConfirm(stripChannelHash(channel.name))}</AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>{input.messages.common.cancel}</AlertDialogCancel>
                          <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => input.onChannelDelete?.(channel.id)}>{input.messages.common.delete}</AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  ) : null}
                </div>
              ))}
            </div>
            <Separator />
            <div className="flex items-center justify-between text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <SidebarSectionTitle>{input.messages.chat.directMessages} {directMessageConversations.length}</SidebarSectionTitle>
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
              <Label className="gap-1" htmlFor="slei-channel-name">
                {input.messages.chat.channelName}
                <span aria-hidden="true" className="text-destructive">*</span>
              </Label>
              <Input
                aria-label={input.messages.chat.channelName}
                id="slei-channel-name"
                onChange={(event) => setChannelDraft((current) => ({ ...current, name: event.currentTarget.value }))}
                placeholder="请输入"
                value={channelDraft.name}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="slei-channel-project-picker">{input.messages.chat.project}</Label>
              <div className="grid gap-2">
                <input
                  aria-label={input.messages.chat.projectFolderPicker}
                  className="sr-only"
                  id="slei-channel-project-picker"
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
                        <Button aria-label={input.messages.chat.removeProject(path)} className="-mr-1 ml-0.5 hover:bg-background/70" onClick={() => removeProjectFolder(path)} size="icon-xs" type="button" variant="ghost">
                          <X aria-hidden="true" className="size-3" />
                        </Button>
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
              <Button disabled={creatingChannel} onClick={closeCreateChannelModal} type="button" variant="outline">{input.messages.common.cancel}</Button>
              <Button aria-label={input.messages.chat.createChannel} className="min-w-20" disabled={creatingChannel} type="submit">
                {creatingChannel ? <LoaderCircle aria-hidden="true" className="animate-spin" size={14} /> : <><Plus aria-hidden="true" size={14} />{input.messages.common.create}</>}
              </Button>
            </DialogFooter>
          </form>
      </ShellDialog>
    </div>
  );
}

function SavedMessagesWorkspace(input: {
  messages: DesktopMessages;
  onSelect?: (savedMessage: SavedMessageView) => void;
  savedMessages: SavedMessageView[];
}) {
  const entries = input.savedMessages;

  return (
    <section aria-label={input.messages.common.saved} className="slei-saved-workspace flex h-full min-h-0 flex-col bg-background" data-testid="slei-saved-workspace">
      <div className="flex items-center justify-between border-b px-6 py-4">
        <div className="grid gap-1">
          <h1 className="text-xl font-semibold">{input.messages.common.saved}</h1>
          <p className="text-sm text-muted-foreground">{input.messages.chat.savedMessagesCount(entries.length)}</p>
        </div>
      </div>
      {entries.length === 0 ? (
        <div className="grid h-full place-items-center p-6">
          <Empty
            centered
            description={input.messages.search.noResultDescription}
            size="lg"
            title={input.messages.chat.savedMessagesEmpty}
            variant="noresult"
          />
        </div>
      ) : null}
      <ScrollArea className="min-h-0 flex-1">
        <div className="grid gap-2 p-4">
          {entries.map((savedMessage) => {
            const isUnavailable = savedMessage.messageDeleted || !savedMessage.messageCreatedAt;
            const messageTime = formatSavedDate(savedMessage.messageCreatedAt);
            const savedTime = formatSavedDate(savedMessage.savedAt);
            return (
            <Button
              aria-label={input.messages.search.openConversation(savedMessage.messageId)}
              className={cn("h-auto w-full justify-start whitespace-normal rounded-lg border bg-background px-4 py-3 text-left", isUnavailable && "opacity-70")}
              disabled={isUnavailable}
              key={savedMessage.id}
              onClick={() => input.onSelect?.(savedMessage)}
              type="button"
              variant="ghost"
            >
              <span className="grid min-w-0 flex-1 gap-2">
                <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs font-normal text-muted-foreground">
                  <span>{savedMessage.sourceLabel || savedMessage.sourceName || savedMessage.sourceId}</span>
                  <span>{savedMessage.authorName || savedMessage.authorId || input.messages.common.system}</span>
                  {messageTime ? <span>{input.messages.chat.messageTimeLabel(messageTime)}</span> : null}
                  {savedTime ? <span>{input.messages.chat.savedTimeLabel(savedTime)}</span> : null}
                </span>
                <strong className={cn("line-clamp-3 text-sm font-medium", isUnavailable && "text-muted-foreground")}>
                  {isUnavailable ? input.messages.chat.savedMessageUnavailable : savedMessage.body}
                </strong>
              </span>
            </Button>
            );
          })}
        </div>
      </ScrollArea>
    </section>
  );
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
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <SidebarSectionTitle>{messages.shell.sectionLabel[activeView]}</SidebarSectionTitle>
      </div>
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
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <SidebarSectionTitle>{input.messages.settings.groups[group.title]}</SidebarSectionTitle>
          </div>
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
          <SidebarSectionTitle>{input.messages.members.agents}</SidebarSectionTitle>
          <Button aria-label={input.messages.members.newAgent} onClick={input.onCreateAgentRequest} size="icon-xs" type="button" variant="ghost"><Plus aria-hidden="true" size={14} /></Button>
        </div>
        <small className="text-muted-foreground">macbookpro m4 max</small>
        {agents.length === 0 ? (
          <Empty
            description={input.messages.members.emptyDescription}
            framed={false}
            size="sm"
            title={input.messages.members.noAgents}
            variant="nodata"
          />
        ) : null}
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
        <SidebarSectionTitle>{input.messages.computers.computers} {input.nodes.length}</SidebarSectionTitle>
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
  activeChatWorkspace: ChatWorkspaceMode,
  data: SleiFixtures,
  activeChannel: SleiFixtures["channels"][number] | undefined,
  activeConversation: ConversationView | undefined,
  activeSessionId: string | undefined,
  runtimeSetup: RuntimeSetupState,
  profile: UserProfile | null,
  locale: AppLocale,
  messages: DesktopMessages,
  timeZone: string,
  appearance: AppearancePreferences,
  notifications: NotificationPreferences,
  activeSettingsPanel: SettingsPanel,
  onProfileChange?: (patch: Partial<Pick<UserProfile, "displayName" | "avatar">>) => Promise<void> | void,
  onLocaleChange?: (locale: AppLocale) => Promise<void> | void,
  onTimeZoneChange?: (timeZone: string) => Promise<void> | void,
  onAppearanceChange?: (appearance: AppearancePreferences) => Promise<void> | void,
  onNotificationsChange?: (notifications: NotificationPreferences) => Promise<void> | void,
  onSendMessage?: (body: string, options?: { asTask?: boolean; attachmentIds?: string[]; sessionId?: string }) => Promise<void> | void,
  onMessageSendFailure?: (message: string, type?: ToastType) => void,
  initialChatDraft?: string,
  initialChannelView?: ChannelEmbeddedView,
  initialComposerAttachments?: ConversationAttachmentView[],
  initialSearchFilters?: ChatSearchFilters,
  onGlobalSearch?: (query: GlobalSearchQuery) => Promise<GlobalSearchReceipt> | GlobalSearchReceipt,
  onAgentResultSelect?: (agentId: string) => void,
  onChannelResultSelect?: (channelId: string) => void,
  onMessageResultSelect?: (result: GlobalMessageSearchResult) => void,
  onSearchResultSelect?: (channelId: string, messageId: string) => void,
  activeComputerId?: string,
  onComputerCreateRequest?: () => void,
  onComputerRename?: (nodeId: string, name: string) => Promise<void> | void,
  activeMemberId?: string,
  activeTaskId?: string,
  onTaskReply?: (taskId: string, body: string) => Promise<void> | void,
  onTaskStatusChange?: (taskId: string, status: SleiFixtures["tasks"][number]["status"]) => Promise<void> | void,
  onTaskThreadOpen?: (taskId: string) => Promise<void> | void,
  onAgentUpdate?: (agentId: string, update: Partial<AgentDraftInput>) => Promise<void> | void,
  onAgentDelete?: (agentId: string) => Promise<void> | void,
  onMemberMessage?: (memberId: string) => void,
  onOpenAgentPath?: (agentId: string, target: AgentPathTarget) => Promise<void> | void,
  onListAgentActivity?: (agentId: string, limit?: number) => Promise<AgentActivityListReceipt> | AgentActivityListReceipt,
  onListAgentWorkspace?: (agentId: string, relativePath?: string) => Promise<AgentWorkspaceListReceipt> | AgentWorkspaceListReceipt,
  onReadAgentWorkspaceFile?: (agentId: string, relativePath: string) => Promise<AgentWorkspaceFileReceipt> | AgentWorkspaceFileReceipt,
  onConversationNewSession?: (conversationId: string) => Promise<void> | void,
  onConversationHistoryToggle?: () => void,
  onConversationSessionSelect?: (conversationId: string, sessionId: string) => Promise<void> | void,
  onAttachmentUpload?: (request: ConversationAttachmentUploadRequest) => Promise<{ attachment: ConversationAttachmentView }>,
  onPermissionResolve?: (requestId: string, decision: PermissionDecision) => Promise<void> | void,
  onChannelMemberAdd?: (agentId: string) => Promise<void> | void,
  onChannelMemberRemove?: (agentId: string) => Promise<void> | void,
  sessionDrawerOpen?: boolean,
  sendingConversationIds: string[] = [],
  savedMessages: SavedMessageView[] = [],
  onSavedMessageSelect?: (savedMessage: SavedMessageView) => void,
  focusedMessageId?: string,
  onMessageSaveToggle?: (message: SleiMessage) => Promise<void> | void,
  onMessageThreadOpen?: (message: SleiMessage) => Promise<void> | void,
  onMessageThreadReply?: (threadId: string, body: string) => Promise<void> | void,
  onOlderMessagesLoad?: () => Promise<void> | void,
  onAgentDraftCreate?: (draft: Partial<AgentDraftInput>, cardId?: string) => void,
  onChannelDraftCreate?: (draft: Record<string, unknown>, cardId?: string) => void,
  pendingPreference?: "locale" | "timeZone" | "appearance" | "notifications",
  preferenceError?: string,
  pendingProfileField?: "displayName" | "avatar",
  profileErrors?: Partial<Record<"displayName" | "avatar", string>>,
  memberFieldErrors?: Record<string, string>,
  savingMemberField?: string,
  computerRenameError?: string,
  renamingComputerId?: string,
) {
  if (activeView === "search") {
    return (
      <SearchRoute
        data={data}
        messages={messages}
        onAgentResultSelect={onAgentResultSelect}
        onChannelResultSelect={onChannelResultSelect}
        onGlobalSearch={onGlobalSearch}
        onMessageResultSelect={onMessageResultSelect}
        onResultSelect={onSearchResultSelect}
        profile={profile}
        timeZone={timeZone}
      />
    );
  }
  if (activeView === "tasks") return <TasksRoute activeTaskId={activeTaskId} data={data} messages={messages} onTaskReply={onTaskReply} onTaskStatusChange={onTaskStatusChange} onTaskThreadOpen={onTaskThreadOpen} />;
  if (activeView === "members") return <MembersRoute activeMemberId={activeMemberId} data={data} memberFieldErrors={memberFieldErrors} messages={messages} nodes={runtimeSetup.nodes} onAgentDelete={onAgentDelete} onAgentUpdate={onAgentUpdate} onMessage={onMemberMessage} onOpenAgentPath={onOpenAgentPath} onListAgentActivity={onListAgentActivity} onListAgentWorkspace={onListAgentWorkspace} onReadAgentWorkspaceFile={onReadAgentWorkspaceFile} savingMemberField={savingMemberField} />;
  if (activeView === "computers") {
    return (
      <ComputersRoute
        activeNodeId={activeComputerId}
        computerRenameError={computerRenameError}
        members={data.members}
        messages={messages}
        nodes={runtimeSetup.nodes}
        onComputerCreateRequest={onComputerCreateRequest}
        onComputerRename={onComputerRename}
        renamingComputerId={renamingComputerId}
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
        pendingPreference={pendingPreference}
        preferenceError={preferenceError}
        profile={profile}
        pendingProfileField={pendingProfileField}
        profileErrors={profileErrors}
        timeZone={timeZone}
      />
    );
  }
  if (activeChatWorkspace === "saved") {
    return <SavedMessagesWorkspace messages={messages} onSelect={onSavedMessageSelect} savedMessages={savedMessages} />;
  }
  if (!activeChannel) {
    return (
      <div className="grid h-full place-items-center p-6">
        <Empty centered description={messages.empty.defaultDescription.nodata} size="lg" title={messages.empty.defaultTitle.nodata} />
      </div>
    );
  }
  return <ChatRoute activeChannel={activeChannel} activeConversation={activeConversation} activeSessionId={activeSessionId} data={data} focusedMessageId={focusedMessageId} initialAttachments={initialComposerAttachments} initialChannelView={initialChannelView} initialDraft={initialChatDraft} messages={messages} onAgentDraftCreate={onAgentDraftCreate} onAttachmentUpload={onAttachmentUpload} onChannelDraftCreate={onChannelDraftCreate} onChannelMemberAdd={onChannelMemberAdd} onChannelMemberRemove={onChannelMemberRemove} onConversationHistoryToggle={onConversationHistoryToggle} onConversationNewSession={onConversationNewSession} onConversationSessionSelect={onConversationSessionSelect} onMessageSaveToggle={onMessageSaveToggle} onMessageThreadOpen={onMessageThreadOpen} onMessageThreadReply={onMessageThreadReply} onOlderMessagesLoad={onOlderMessagesLoad} onPermissionResolve={onPermissionResolve} onSendFailure={onMessageSendFailure} onSendMessage={onSendMessage} onTaskReply={onTaskReply} onTaskStatusChange={onTaskStatusChange} onTaskThreadOpen={onTaskThreadOpen} profile={localHumanPresentation(profile, messages)} savedMessageIds={savedMessages.map((savedMessage) => savedMessage.messageId)} sending={activeConversation ? sendingConversationIds.includes(activeConversation.id) : false} sessionDrawerOpen={sessionDrawerOpen} />;
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
              <Button className="absolute top-2 right-2" data-slot="dialog-close" size="icon-sm" type="button" variant="ghost">
                <span className="sr-only">{input.closeLabel ?? "Close"}</span>
              </Button>
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
    const trimmedHandle = handle.trim();
    if (!trimmedName || !trimmedHandle) return;
    input.onCreate?.({
      name: trimmedName,
      handle: normalizeHandleInput(trimmedHandle),
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
          <DialogTitle>{input.messages.agentCreate.title}</DialogTitle>
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
            <Label className="gap-1" htmlFor="slei-agent-name">
              {input.messages.agentCreate.name}
              <span aria-hidden="true" className="text-destructive">*</span>
            </Label>
            <Input id="slei-agent-name" onChange={(event) => {
              setName(event.currentTarget.value);
              if (!handle.trim()) setHandle(normalizeHandleInput(event.currentTarget.value));
            }} required value={name} />
          </div>
          <div className="grid gap-2">
            <Label className="gap-1" htmlFor="slei-agent-handle">
              {input.messages.agentCreate.handle}
              <span aria-hidden="true" className="text-destructive">*</span>
            </Label>
            <Input id="slei-agent-handle" onChange={(event) => setHandle(event.currentTarget.value)} required value={handle} />
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
