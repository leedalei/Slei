import { type CSSProperties, type FormEvent, type PointerEvent as ReactPointerEvent, type ReactNode, useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
  type AgentRolePresetReceipt,
  type AgentRolePresetView,
  type GlobalMessageSearchResult,
  type GlobalSearchQuery,
  type GlobalSearchReceipt,
  type RuntimeSetupState,
} from "../lib/daemon-bridge";
import { createDesktopMessages, type DesktopMessages } from "../i18n";
import type { ChannelEmbeddedView } from "../features/chat/ChatPageView";
import { Empty, MemberAvatar, PageHeader, SleiIcon, Toast, sleiIcons, type ToastType } from "../components";
import { ChatRoute } from "./routes/ChatRoute";
import { ComputersRoute } from "./routes/ComputersRoute";
import { MembersRoute } from "./routes/MembersRoute";
import { SearchRoute } from "./routes/SearchRoute";
import { SettingsRoute } from "./routes/SettingsRoute";
import { TasksRoute } from "./routes/TasksRoute";
import { WorkspaceSidebar, type ChannelCardDraftRequest } from "./WorkspaceSidebar";
import sleiBubbleIcon from "../assets/brand/slei-bubble.svg";
import type { SleiFixtures, SleiMember, SleiMessage } from "./types";
import {
  channelReadinessLabel,
  agentAvatarSeedFromName,
  agentHandleFromName,
  defaultAppearance,
  defaultNotifications,
  defaultTimeZone,
  deviceOsLabel,
  localHumanPresentation,
  normalizeAppearanceTheme,
  refreshedAgentAvatarSeed,
  type AgentDraftInput,
  type AppView,
  type ChatSearchFilters,
  type SettingsPanel,
  type UserProfile,
  validateAgentDisplayName,
} from "./model";

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
  onRuntimeToastDismiss?: () => void;
  computerRenameError?: string;
  renamingComputerId?: string;
  sessionDrawerOpen?: boolean;
  sendingConversationIds?: string[];
  sidebarWidth?: number;
  savedMessages?: SavedMessageView[];
  onAgentCreate?: (request: AgentDraftInput) => Promise<void> | void;
  onAgentRolePresetsLoad?: () => Promise<AgentRolePresetReceipt> | AgentRolePresetReceipt;
  onAgentDelete?: (agentId: string) => Promise<void> | void;
  onAgentUpdate?: (agentId: string, update: Partial<AgentDraftInput>) => Promise<void> | void;
  onChannelCreate?: (input: { name: string; projectName?: string; projectPaths?: string[]; agentIds?: string[] }) => Promise<ChannelReceipt | void> | ChannelReceipt | void;
  onChannelCreateFailure?: (message: string, type?: ToastType) => void;
  onChannelCreateLog?: (message: string, context?: Record<string, unknown>) => void;
  onChannelCreateRefresh?: (channelId: string) => Promise<SleiFixtures["channels"]> | SleiFixtures["channels"];
  onChannelDelete?: (channelId: string) => void;
  onChannelEdit?: (channelId: string) => void;
  onChannelMemberAdd?: (agentId: string) => Promise<void> | void;
  onChannelMemberRemove?: (agentId: string) => Promise<void> | void;
  onChannelProjectPathsChange?: (channelId: string, projectPaths: string[]) => Promise<void> | void;
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
  onProfileAvatarUpload?: (file: File) => Promise<void> | void;
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
  onMessageThreadReplyFromSource?: (message: SleiMessage, body: string) => Promise<void> | void;
  onOlderMessagesLoad?: () => Promise<void> | void;
  onMemberSelect?: (memberId: string) => void;
  onMemberMessage?: (memberId: string) => void;
  onOpenAgentPath?: (agentId: string, target: AgentPathTarget) => Promise<void> | void;
  onListAgentActivity?: (agentId: string, limit?: number) => Promise<AgentActivityListReceipt> | AgentActivityListReceipt;
  onListAgentWorkspace?: (agentId: string, relativePath?: string) => Promise<AgentWorkspaceListReceipt> | AgentWorkspaceListReceipt;
  onReadAgentWorkspaceFile?: (agentId: string, relativePath: string) => Promise<AgentWorkspaceFileReceipt> | AgentWorkspaceFileReceipt;
  onSendMessage?: (body: string, options?: { asTask?: boolean; attachmentIds?: string[]; attachments?: ConversationAttachmentView[]; sessionId?: string }) => Promise<void> | void;
  onMessageSendFailure?: (message: string, type?: ToastType) => void;
  onTaskReply?: (taskId: string, body: string) => Promise<void> | void;
  onTaskStatusChange?: (taskId: string, status: SleiFixtures["tasks"][number]["status"]) => Promise<void> | void;
  onTaskThreadClose?: (taskId: string) => void;
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
  const [channelCardDraftRequest, setChannelCardDraftRequest] = useState<ChannelCardDraftRequest | undefined>(undefined);
  const appearance = input.appearance ?? defaultAppearance;
  const normalizedTheme = normalizeAppearanceTheme(appearance.theme);
  const normalizedAppearance = { ...appearance, theme: normalizedTheme };
  const messages = createDesktopMessages(input.locale);
  const profile = input.profile ?? null;
  const activeAgentActivities = input.activeView === "chat"
    ? findActiveAgentActivities(input.data, activeChannel, activeConversation, activeSessionId)
    : [];
  const activeAgentActivity = selectAgentActivityForTick(activeAgentActivities, 0);
  const fontSize = fontSizeValue(appearance.fontSize);
  const textTokenValues = useMemo(() => fontSizeTextTokenValues(appearance.fontSize), [appearance.fontSize]);
  const shellStyle = {
    "--app-sidebar-width": `${input.sidebarWidth ?? 260}px`,
    "--app-font-size": fontSize,
  } as CSSProperties;

  useEffect(() => {
    if (typeof document === "undefined") return undefined;

    const root = document.documentElement;
    const previousFontSize = root.style.fontSize;
    const previousAppFontSize = root.style.getPropertyValue("--app-font-size");
    const previousTextTokenValues = Object.fromEntries(
      Object.keys(textTokenValues).map((key) => [key, root.style.getPropertyValue(key)]),
    );

    root.style.fontSize = fontSize;
    root.style.setProperty("--app-font-size", fontSize);
    for (const [key, value] of Object.entries(textTokenValues)) {
      root.style.setProperty(key, value);
    }

    return () => {
      root.style.fontSize = previousFontSize;
      if (previousAppFontSize) {
        root.style.setProperty("--app-font-size", previousAppFontSize);
      } else {
        root.style.removeProperty("--app-font-size");
      }
      for (const key of Object.keys(textTokenValues)) {
        const previousValue = previousTextTokenValues[key];
        if (previousValue) {
          root.style.setProperty(key, previousValue);
        } else {
          root.style.removeProperty(key);
        }
      }
    };
  }, [fontSize, textTokenValues]);

  useEffect(() => {
    if (typeof document === "undefined") return undefined;

    const root = document.documentElement;
    const hadDarkClass = root.classList.contains("dark");
    const hadLightClass = root.classList.contains("light");
    root.classList.toggle("dark", normalizedTheme === "dark");
    root.classList.toggle("light", normalizedTheme === "light");

    return () => {
      root.classList.toggle("dark", hadDarkClass);
      root.classList.toggle("light", hadLightClass);
    };
  }, [normalizedTheme]);

  useEffect(() => {
    if (input.runtimeSetup.nodes.some((node) => node.id === activeComputerId)) return;
    setActiveComputerId(firstComputer?.id ?? "");
  }, [activeComputerId, firstComputer?.id, input.runtimeSetup.nodes]);

  function handleChannelEdit(channelId: string) {
    if (input.onChannelEdit) {
      input.onChannelEdit(channelId);
      return;
    }
    input.onChannelSelect?.(channelId);
    input.onViewChange?.("chat");
  }

  return (
    <TooltipProvider>
    <div
      className={cn("slei-app-shell grid h-screen min-h-0 overflow-hidden bg-transparent text-foreground", normalizedTheme)}
      data-active-view={input.activeView}
      data-font-size={appearance.fontSize}
      data-theme={normalizedTheme}
      data-tauri-drag-region="deep"
      style={shellStyle}
    >
      <Toast message={input.runtimeErrorToastMessage} onDismiss={input.onRuntimeToastDismiss} type={input.runtimeToastType} />
      <header className="slei-app-chrome" data-slot="app-chrome">
        <span aria-hidden="true" className="slei-native-window-controls-space" data-slot="native-window-controls-space" />
        <span aria-hidden="true" className="slei-app-chrome__divider" data-slot="app-chrome-divider" />
        <div className="slei-brand" data-slot="app-brand">
          <img alt="" className="slei-brand__icon" src={sleiBubbleIcon} />
          <span className="slei-brand__name">Slei</span>
        </div>
      </header>

      <div className="slei-app-content min-h-0 min-w-0" data-slot="app-content">
        <div className="slei-workspace-sidebar-card min-h-0 max-[760px]:hidden" data-slot="sidebar-card">
          <WorkspaceSidebar
            activeAgentActivity={activeAgentActivity}
            activeChannelId={input.activeChatWorkspace === "saved" || input.activeConversationId ? undefined : activeChannel?.id}
            activeChatWorkspace={input.activeChatWorkspace}
            activeConversationId={input.activeChatWorkspace === "saved" ? undefined : input.activeConversationId}
            activeView={input.activeView}
            cardDraftRequest={channelCardDraftRequest}
            channels={input.data.channels}
            conversations={input.data.conversations}
            initialCreateChannelModalOpen={input.initialCreateChannelModalOpen}
            members={input.data.members}
            messages={messages}
            onChannelCreate={input.onChannelCreate}
            onChannelCreateClick={() => undefined}
            onChannelCreateFailure={input.onChannelCreateFailure}
            onChannelCreateLog={input.onChannelCreateLog}
            onChannelCreateRefresh={input.onChannelCreateRefresh}
            onChannelDelete={input.onChannelDelete}
            onChannelEdit={handleChannelEdit}
            onChannelSelect={input.onChannelSelect}
            onConversationSelect={input.onConversationSelect}
            onInteractiveCardComplete={input.onInteractiveCardComplete}
            onMemberSelect={input.onMemberSelect}
            onSavedMessagesOpen={input.onSavedMessagesOpen}
            onSettingsPanelSelect={setActiveSettingsPanel}
            onViewChange={input.onViewChange}
            profile={profile}
          />
        </div>

        <Button
          aria-label={messages.common.resizeSidebar}
          aria-orientation="vertical"
          className="slei-resize-handle h-full w-[var(--app-resize-width)] !cursor-col-resize rounded-none border-0 p-0"
          onPointerDown={input.onResizeStart}
          role="separator"
          type="button"
          variant="ghost"
        />

        <main className="slei-workspace slei-workspace-card slei-glass-workspace min-h-0 min-w-0 overflow-hidden bg-transparent" data-slot="workspace-card">{renderWorkspace(input.activeView, input.activeChatWorkspace ?? "chat", input.data, activeChannel, activeConversation, activeSessionId, input.runtimeSetup, profile, input.locale, messages, input.timeZone ?? defaultTimeZone, normalizedAppearance, input.notifications ?? defaultNotifications, activeSettingsPanel, input.onProfileChange, input.onProfileAvatarUpload, input.onLocaleChange, input.onTimeZoneChange, input.onAppearanceChange, input.onNotificationsChange, input.onSendMessage, input.onMessageSendFailure, input.initialChatDraft, input.initialChannelView, input.initialComposerAttachments, input.initialSearchFilters, input.onGlobalSearch, input.onAgentResultSelect, input.onChannelResultSelect, input.onMessageResultSelect, input.onSearchResultSelect, activeComputerId, () => setComputerCreateOpen(true), input.onComputerRename, input.activeMemberId, input.activeTaskId, input.onTaskReply, input.onTaskStatusChange, input.onTaskThreadOpen, input.onTaskThreadClose, input.onAgentUpdate, input.onAgentDelete, input.onMemberMessage, input.onOpenAgentPath, input.onListAgentActivity, input.onListAgentWorkspace, input.onReadAgentWorkspaceFile, input.onConversationNewSession, input.onConversationHistoryToggle, input.onConversationSessionSelect, input.onAttachmentUpload, input.onPermissionResolve, input.onChannelMemberAdd, input.onChannelMemberRemove, input.onChannelProjectPathsChange, input.sessionDrawerOpen ?? input.initialConversationHistoryOpen, input.sendingConversationIds ?? [], input.savedMessages ?? [], input.onSavedMessageSelect, input.focusedMessageId, input.onMessageSaveToggle, input.onMessageThreadOpen, input.onMessageThreadReply, input.onMessageThreadReplyFromSource, input.onOlderMessagesLoad, (draft, cardId) => {
          setAgentDraft(draft);
          setActiveCardId(cardId);
          setAgentCreateOpen(true);
        }, async (draft, cardId) => {
          setChannelCardDraftRequest((current) => ({
            id: (current?.id ?? 0) + 1,
            draft,
            cardId,
          }));
        }, input.pendingPreference, input.preferenceError, input.pendingProfileField, input.profileErrors, input.memberFieldErrors, input.savingMemberField, input.computerRenameError, input.renamingComputerId)}</main>
      </div>

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
          members={input.data.members}
          messages={messages}
          nodes={input.runtimeSetup.nodes}
          onRolePresetsLoad={input.onAgentRolePresetsLoad}
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
          <section aria-live="polite" className="rounded-xl bg-popover p-6 text-popover-foreground ring-1 ring-border shadow-[var(--overlay-shadow-md)]" data-slot="guide-status" role="status">
            <h2 className="text-base font-medium">{messages.onboarding.creatingGuide}</h2>
          </section>
        </div>
      ) : null}
    </div>
    </TooltipProvider>
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

function SavedMessagesWorkspace(input: {
  messages: DesktopMessages;
  onSelect?: (savedMessage: SavedMessageView) => void;
  savedMessages: SavedMessageView[];
}) {
  const entries = input.savedMessages;

  return (
    <section aria-label={input.messages.common.saved} className="slei-saved-workspace flex h-full min-h-0 flex-col bg-transparent" data-testid="slei-saved-workspace">
      <PageHeader
        className="border-b px-6 py-4"
        icon={sleiIcons.bookmark}
        subtitle={input.messages.chat.savedMessagesCount(entries.length)}
        title={input.messages.common.saved}
      />
      {entries.length === 0 ? (
        <div className="grid h-full place-items-center p-6">
          <Empty
            centered
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
              <Card
                className="gap-0 rounded-lg py-0 text-card-foreground shadow-none transition-colors hover:bg-muted/35 dark:hover:bg-muted/25"
                data-saved-message-row
                key={savedMessage.id}
              >
                <CardContent className="px-3 py-2.5">
                  <Button
                    aria-label={input.messages.search.openConversation(savedMessage.messageId)}
                    className={cn("h-auto w-full justify-start whitespace-normal rounded-[inherit] bg-transparent p-0 text-left hover:border-transparent hover:bg-transparent", isUnavailable && "opacity-70")}
                    disabled={isUnavailable}
                    onClick={() => input.onSelect?.(savedMessage)}
                    type="button"
                    variant="ghost"
                  >
                    <span className="grid min-w-0 flex-1 gap-1.5">
                      <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs font-normal text-muted-foreground">
                        <span className="inline-flex items-center gap-1">
                          <SleiIcon className="size-3.5" name="bookmark" />
                          {savedMessage.sourceLabel || savedMessage.sourceName || savedMessage.sourceId}
                        </span>
                        <span>{savedMessage.authorName || savedMessage.authorId || input.messages.common.system}</span>
                        {messageTime ? <span>{input.messages.chat.messageTimeLabel(messageTime)}</span> : null}
                        {savedTime ? <span>{input.messages.chat.savedTimeLabel(savedTime)}</span> : null}
                      </span>
                      <strong className={cn("line-clamp-3 text-sm font-medium", isUnavailable && "text-muted-foreground")}>
                        {isUnavailable ? input.messages.chat.savedMessageUnavailable : savedMessage.body}
                      </strong>
                    </span>
                  </Button>
                </CardContent>
              </Card>
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
  onProfileAvatarUpload?: (file: File) => Promise<void> | void,
  onLocaleChange?: (locale: AppLocale) => Promise<void> | void,
  onTimeZoneChange?: (timeZone: string) => Promise<void> | void,
  onAppearanceChange?: (appearance: AppearancePreferences) => Promise<void> | void,
  onNotificationsChange?: (notifications: NotificationPreferences) => Promise<void> | void,
  onSendMessage?: (body: string, options?: { asTask?: boolean; attachmentIds?: string[]; attachments?: ConversationAttachmentView[]; sessionId?: string }) => Promise<void> | void,
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
  onTaskThreadClose?: (taskId: string) => void,
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
  onChannelProjectPathsChange?: (channelId: string, projectPaths: string[]) => Promise<void> | void,
  sessionDrawerOpen?: boolean,
  sendingConversationIds: string[] = [],
  savedMessages: SavedMessageView[] = [],
  onSavedMessageSelect?: (savedMessage: SavedMessageView) => void,
  focusedMessageId?: string,
  onMessageSaveToggle?: (message: SleiMessage) => Promise<void> | void,
  onMessageThreadOpen?: (message: SleiMessage) => Promise<void> | void,
  onMessageThreadReply?: (threadId: string, body: string) => Promise<void> | void,
  onMessageThreadReplyFromSource?: (message: SleiMessage, body: string) => Promise<void> | void,
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
  if (activeView === "tasks") return <TasksRoute activeTaskId={activeTaskId} data={data} messages={messages} onTaskReply={onTaskReply} onTaskStatusChange={onTaskStatusChange} onTaskThreadClose={onTaskThreadClose} onTaskThreadOpen={onTaskThreadOpen} />;
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
        onProfileAvatarUpload={onProfileAvatarUpload}
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
        <Empty centered size="lg" title={messages.empty.defaultTitle.nodata} />
      </div>
    );
  }
  return <ChatRoute activeChannel={activeChannel} activeConversation={activeConversation} activeSessionId={activeSessionId} data={data} focusedMessageId={focusedMessageId} initialAttachments={initialComposerAttachments} initialChannelView={initialChannelView} initialDraft={initialChatDraft} messages={messages} onAgentDraftCreate={onAgentDraftCreate} onAttachmentUpload={onAttachmentUpload} onChannelDraftCreate={onChannelDraftCreate} onChannelMemberAdd={onChannelMemberAdd} onChannelMemberRemove={onChannelMemberRemove} onChannelProjectPathsChange={onChannelProjectPathsChange} onConversationHistoryToggle={onConversationHistoryToggle} onConversationNewSession={onConversationNewSession} onConversationSessionSelect={onConversationSessionSelect} onMessageSaveToggle={onMessageSaveToggle} onMessageThreadOpen={onMessageThreadOpen} onMessageThreadReply={onMessageThreadReply} onMessageThreadReplyFromSource={onMessageThreadReplyFromSource} onOlderMessagesLoad={onOlderMessagesLoad} onPermissionResolve={onPermissionResolve} onSendFailure={onMessageSendFailure} onSendMessage={onSendMessage} onTaskReply={onTaskReply} onTaskStatusChange={onTaskStatusChange} onTaskThreadClose={onTaskThreadClose} onTaskThreadOpen={onTaskThreadOpen} profile={localHumanPresentation(profile, messages)} savedMessageIds={savedMessages.map((savedMessage) => savedMessage.messageId)} sending={activeConversation ? sendingConversationIds.includes(activeConversation.id) : false} sessionDrawerOpen={sessionDrawerOpen} />;
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
          <DialogTitle className="flex items-center gap-2"><SleiIcon name="computer" size={20} />{input.messages.computers.newComputer}</DialogTitle>
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
            <Button type="submit"><SleiIcon name="plus" size={14} />{input.messages.common.create}</Button>
          </DialogFooter>
        </form>
    </ShellDialog>
  );
}

function fontSizeValue(size: AppearancePreferences["fontSize"]) {
  return {
    sm: "14px",
    md: "14px",
    lg: "16px",
  }[size];
}

function fontSizeTextTokenValues(size: AppearancePreferences["fontSize"]) {
  const tokenValues = {
    sm: {
      "--text-xs": "10px",
      "--text-sm": "12px",
      "--text-base": "14px",
      "--text-md": "14px",
      "--text-lg": "15px",
      "--text-xl": "17px",
      "--text-2xl": "23px",
      "--text-display": "29px",
    },
    md: {
      "--text-xs": "11px",
      "--text-sm": "13px",
      "--text-base": "14px",
      "--text-md": "14px",
      "--text-lg": "16px",
      "--text-xl": "18px",
      "--text-2xl": "24px",
      "--text-display": "30px",
    },
    lg: {
      "--text-xs": "12px",
      "--text-sm": "14px",
      "--text-base": "16px",
      "--text-md": "16px",
      "--text-lg": "17px",
      "--text-xl": "19px",
      "--text-2xl": "25px",
      "--text-display": "31px",
    },
  } as const;

  return tokenValues[size];
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
            <Button className="absolute top-2 right-2 size-8 [&_svg]:size-3.5" data-slot="dialog-close" size="icon" type="button" variant="ghost">
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

function formatChannelCreateFailure(prefix: string, error: unknown) {
  const detail = error instanceof Error
    ? error.message
    : typeof error === "string"
      ? error
      : "";
  const trimmedDetail = detail.trim();
  return trimmedDetail ? `${prefix}：${trimmedDetail}` : prefix;
}

function AgentCreateModal(input: {
  draft?: Partial<AgentDraftInput>;
  members: SleiMember[];
  messages: DesktopMessages;
  nodes: DesktopNodeView[];
  onRolePresetsLoad?: () => Promise<AgentRolePresetReceipt> | AgentRolePresetReceipt;
  onClose: () => void;
  onCreate?: (request: AgentDraftInput) => void;
}) {
  const firstNode = input.nodes[0];
  const firstRuntime = firstNode?.runtimes.find((runtime) => runtime.readiness === "ready") ?? firstNode?.runtimes[0];
  const [name, setName] = useState(input.draft?.name ?? "");
  const [runtimeKind, setRuntimeKind] = useState(input.draft?.runtimeKind ?? firstRuntime?.kind ?? "ClaudeCode");
  const [model, setModel] = useState(input.draft?.model ?? "Sonnet");
  const [nodeId, setNodeId] = useState(input.draft?.nodeId ?? firstNode?.id ?? "local-node");
  const [description, setDescription] = useState(input.draft?.description ?? "");
  const [descriptionMode, setDescriptionMode] = useState<"custom" | "preset">("custom");
  const [rolePresets, setRolePresets] = useState<AgentRolePresetView[]>([]);
  const [rolePresetsLoading, setRolePresetsLoading] = useState(false);
  const [rolePresetsError, setRolePresetsError] = useState<string | undefined>();
  const [selectedPresetId, setSelectedPresetId] = useState<string | undefined>();
  const [avatarRefreshIndex, setAvatarRefreshIndex] = useState(0);
  const [avatarManuallyRefreshed, setAvatarManuallyRefreshed] = useState(false);
  const trimmedName = name.trim();
  const nameError = validateAgentDisplayName(trimmedName, input.members);
  const selectedPreset = rolePresets.find((preset) => preset.id === selectedPresetId);
  const avatarSeed = avatarManuallyRefreshed
    ? refreshedAgentAvatarSeed(trimmedName, avatarRefreshIndex)
    : agentAvatarSeedFromName(trimmedName);
  const createDisabled = Boolean(nameError) || (descriptionMode === "preset" && !selectedPreset);

  async function loadRolePresets() {
    if (!input.onRolePresetsLoad) {
      setRolePresets([]);
      return;
    }
    setRolePresetsLoading(true);
    setRolePresetsError(undefined);
    try {
      const receipt = await input.onRolePresetsLoad();
      setRolePresets(receipt.presets);
      setSelectedPresetId((current) => current && receipt.presets.some((preset) => preset.id === current) ? current : undefined);
    } catch (error) {
      setRolePresets([]);
      setRolePresetsError(error instanceof Error ? error.message : String(error));
    } finally {
      setRolePresetsLoading(false);
    }
  }

  useEffect(() => {
    void loadRolePresets();
  }, []);

  function submitCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (createDisabled) return;
    input.onCreate?.({
      name: trimmedName,
      handle: agentHandleFromName(trimmedName),
      runtimeKind,
      model,
      nodeId,
      description: descriptionMode === "preset"
        ? selectedPreset?.description ?? input.messages.agentCreate.defaultDescription(trimmedName)
        : description.trim() || input.messages.agentCreate.defaultDescription(trimmedName),
      avatarSeed,
    });
  }

  return (
    <ShellDialog closeLabel={input.messages.common.cancel} open onOpenChange={(open) => {
      if (!open) input.onClose();
    }} className="slei-agent-modal max-h-[min(90vh,46rem)] overflow-hidden sm:max-w-4xl">
        <DialogHeader>
          <Badge className="w-fit" variant="secondary">{input.messages.agentCreate.fallbackAgent}</Badge>
          <DialogTitle>{input.messages.agentCreate.title}</DialogTitle>
          <DialogDescription>{input.messages.agentCreate.associatedDevice} / {input.messages.agentCreate.model} / {input.messages.agentCreate.description}</DialogDescription>
        </DialogHeader>
        <form className="grid min-h-0 gap-4" onSubmit={submitCreate}>
          <div className="grid min-h-0 gap-5 md:grid-cols-[minmax(14rem,0.78fr)_minmax(0,1.22fr)]">
            <section className="grid content-start gap-4">
              <h3 className="text-sm font-semibold text-foreground">{input.messages.agentCreate.runtimeSection}</h3>
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
                <Label htmlFor="slei-agent-model">{input.messages.agentCreate.model}</Label>
                <Input id="slei-agent-model" onChange={(event) => setModel(event.currentTarget.value)} value={model} />
              </div>
            </section>
            <section className="grid min-h-0 content-start gap-4">
              <h3 className="text-sm font-semibold text-foreground">{input.messages.agentCreate.memberSection}</h3>
              <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3">
                <button
                  aria-label={input.messages.agentCreate.refreshAvatar}
                  className="group relative size-14 shrink-0 rounded-full"
                  data-agent-create-avatar
                  onClick={() => {
                    setAvatarRefreshIndex((current) => current + 1);
                    setAvatarManuallyRefreshed(true);
                  }}
                  type="button"
                >
                  <MemberAvatar
                    identity={{
                      id: "agent-create-preview",
                      name: trimmedName || input.messages.agentCreate.fallbackAgent,
                      handle: agentHandleFromName(trimmedName || "agent"),
                      avatar: (trimmedName || input.messages.agentCreate.fallbackAgent).slice(0, 2).toUpperCase(),
                      avatarSeed,
                    }}
                    large
                  />
                  <span className="absolute inset-0 hidden place-items-center rounded-full bg-background/75 text-foreground group-hover:grid">
                    <SleiIcon name="refreshCw" size={16} />
                  </span>
                </button>
                <div className="grid min-w-0 gap-2">
                  <Label className="gap-1" htmlFor="slei-agent-name">
                    {input.messages.agentCreate.name}
                    <span aria-hidden="true" className="text-destructive">*</span>
                  </Label>
                  <Input
                    aria-invalid={Boolean(nameError)}
                    id="slei-agent-name"
                    onChange={(event) => setName(event.currentTarget.value)}
                    required
                    value={name}
                  />
                  {nameError ? (
                    <p className="text-xs text-destructive">
                      {nameError === "required"
                        ? input.messages.agentCreate.nameRequired
                        : nameError === "duplicate"
                          ? input.messages.agentCreate.nameDuplicate
                          : nameError === "length"
                            ? input.messages.agentCreate.nameTooLong
                          : input.messages.agentCreate.nameInvalid}
                    </p>
                  ) : null}
                </div>
              </div>
              <div className="grid gap-3">
                <Label>{input.messages.agentCreate.descriptionMode}</Label>
                <RadioGroup className="flex flex-wrap gap-4" onValueChange={(value) => setDescriptionMode(value as "custom" | "preset")} value={descriptionMode}>
                  <RadioGroupItem label={input.messages.agentCreate.customDescription} value="custom" />
                  <RadioGroupItem label={input.messages.agentCreate.presetDescription} value="preset" />
                </RadioGroup>
              </div>
              {descriptionMode === "custom" ? (
                <div className="grid gap-2">
                  <Label htmlFor="slei-agent-description">{input.messages.agentCreate.description}</Label>
                  <Textarea id="slei-agent-description" onChange={(event) => setDescription(event.currentTarget.value)} value={description} />
                </div>
              ) : (
                <div className="grid gap-2">
                  <div className="max-h-72 overflow-y-auto pr-1" data-agent-preset-list>
                    {rolePresetsLoading ? (
                      <p className="flex items-center gap-2 rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                        <SleiIcon className="animate-spin" name="loader" size={14} />
                        {input.messages.agentCreate.rolePresetsLoading}
                      </p>
                    ) : rolePresetsError ? (
                      <div className="grid gap-2 rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                        <p>{input.messages.agentCreate.rolePresetsFailed}</p>
                        <Button onClick={() => void loadRolePresets()} size="sm" type="button" variant="outline">{input.messages.agentCreate.retryRolePresets}</Button>
                      </div>
                    ) : rolePresets.length === 0 ? (
                      <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">{input.messages.agentCreate.rolePresetsEmpty}</p>
                    ) : (
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        {rolePresets.map((preset) => (
                          <button
                            aria-pressed={selectedPresetId === preset.id}
                            className={cn(
                              "grid gap-1 rounded-md border p-3 text-left text-sm transition-colors",
                              selectedPresetId === preset.id
                                ? "border-primary bg-primary/10 text-foreground"
                                : "border-border bg-card/70 text-muted-foreground hover:border-primary/60 hover:text-foreground",
                            )}
                            data-selected={selectedPresetId === preset.id ? "true" : "false"}
                            key={preset.id}
                            onClick={() => setSelectedPresetId(preset.id)}
                            type="button"
                          >
                            <span className="font-medium text-foreground">{preset.title}</span>
                            <span className="line-clamp-3">{preset.description}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </section>
          </div>
          <DialogFooter>
            <Button onClick={input.onClose} type="button" variant="outline">{input.messages.common.cancel}</Button>
            <Button disabled={createDisabled} type="submit">{input.messages.common.create}</Button>
          </DialogFooter>
        </form>
    </ShellDialog>
  );
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
