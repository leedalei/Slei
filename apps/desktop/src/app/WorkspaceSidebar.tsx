import { type FormEvent, type ReactNode, useEffect, useRef, useState } from "react";

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
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

import { MemberAvatar, SelectableCard, SleiIcon, type ToastType } from "../components";
import type { ChannelReceipt, ConversationView } from "../lib/daemon-bridge";
import type { DesktopMessages } from "../i18n";
import { localHumanPresentation, stripChannelHash, type AppView, type SettingsOverlayPanel, type UserProfile } from "./model";
import type { SleiFixtures, SleiMember, SleiMessage } from "./types";
import type { ChatWorkspaceMode } from "./SleiAppFrame";

type SortDirection = "default" | "asc" | "desc";

export type ChannelCardDraftRequest = {
  id: number;
  draft: Record<string, unknown>;
  cardId?: string;
};

export type AgentActivityView = {
  member?: SleiMember;
  message: SleiMessage;
};

export type WorkspaceSidebarProps = {
  activeView: AppView;
  activeChannelId?: string;
  activeConversationId?: string;
  activeChatWorkspace?: ChatWorkspaceMode;
  activeAgentActivity?: AgentActivityView;
  cardDraftRequest?: ChannelCardDraftRequest;
  channels: SleiFixtures["channels"];
  conversations: ConversationView[];
  initialCreateChannelModalOpen?: boolean;
  members: SleiMember[];
  messages: DesktopMessages;
  profile: UserProfile | null;
  onViewChange?: (view: AppView) => void;
  onSettingsOpen?: (panel: SettingsOverlayPanel) => void;
  onChannelSelect?: (channelId: string) => void;
  onConversationSelect?: (conversationId: string) => void;
  onConversationMessagesClear?: (conversationId: string) => Promise<void> | void;
  onAgentDelete?: (agentId: string) => Promise<void> | void;
  onMemberCreateClick?: () => void;
  onMemberMessage?: (memberId: string) => void;
  onMemberSelect?: (memberId: string) => void;
  onSavedMessagesOpen?: () => void;
  onChannelCreate?: (input: { name: string; projectName?: string; projectPaths?: string[]; agentIds?: string[] }) => Promise<ChannelReceipt | void> | ChannelReceipt | void;
  onChannelCreateClick: () => void;
  onChannelCreateFailure?: (message: string, type?: ToastType) => void;
  onChannelCreateLog?: (message: string, context?: Record<string, unknown>) => void;
  onChannelCreateRefresh?: (channelId: string) => Promise<SleiFixtures["channels"]> | SleiFixtures["channels"];
  onInteractiveCardComplete?: (cardId: string) => Promise<void> | void;
  onChannelDelete?: (channelId: string) => void;
  onChannelEdit?: (channelId: string) => void;
};

const sidebarSortStorageKeys = {
  channels: "slei:sidebar-sort:channels",
  directMessages: "slei:sidebar-sort:direct-messages",
} as const;

const sidebarFlatActiveClassName = "bg-[var(--workspace-sidebar-active-bg)] text-foreground";
const sidebarPrimaryActionClassName =
  "h-[32px] min-h-[32px] justify-start rounded-lg border-transparent px-2.5 py-0 shadow-none hover:bg-[var(--workspace-sidebar-hover-bg)]";
const sidebarListRowClassName =
  "group/channel grid h-[32px] min-h-[32px] grid-cols-[minmax(0,1fr)_auto] items-center";
const sidebarListTriggerClassName =
  "inline-flex h-full min-h-0 w-full min-w-0 items-center justify-start rounded-lg border border-transparent bg-transparent px-2.5 py-0 text-left text-sm font-medium leading-5 text-inherit transition-colors outline-none focus-visible:border-ring";

function isSortDirection(value: string | null): value is SortDirection {
  return value === "default" || value === "asc" || value === "desc";
}

function readFrontendSortPreference(storageKey: string): SortDirection {
  if (typeof window === "undefined") return "default";
  try {
    const value = window.localStorage.getItem(storageKey);
    return isSortDirection(value) ? value : "default";
  } catch {
    return "default";
  }
}

function writeFrontendSortPreference(storageKey: string, direction: SortDirection) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey, direction);
  } catch {
    // Local storage is a UI preference cache only; sorting still works without it.
  }
}

function nextSortDirection(direction: SortDirection): SortDirection {
  if (direction === "default") return "asc";
  if (direction === "asc") return "desc";
  return "default";
}

function sortActionLabel(messages: DesktopMessages, direction: SortDirection) {
  const nextDirection = nextSortDirection(direction);
  if (nextDirection === "asc") return messages.chat.sortAscending;
  if (nextDirection === "desc") return messages.chat.sortDescending;
  return messages.chat.clearSort;
}

function compareDisplayNames(left: string, right: string, direction: Exclude<SortDirection, "default">) {
  const result = left.localeCompare(right, undefined, { sensitivity: "base", numeric: true });
  return direction === "asc" ? result : -result;
}

function sortChannelsByName(channels: SleiFixtures["channels"], direction: SortDirection) {
  if (direction === "default") return channels;
  return [...channels].sort((left, right) => compareDisplayNames(stripChannelHash(left.name), stripChannelHash(right.name), direction));
}

type DirectMessageEntry = {
  conversation?: ConversationView;
  member: SleiMember;
};

function sortDirectMessageEntriesByName(entries: DirectMessageEntry[], direction: SortDirection) {
  if (direction === "default") return entries;
  return [...entries].sort((left, right) => compareDisplayNames(left.member.name, right.member.name, direction));
}

function SortDirectionIcon(input: { direction: SortDirection }) {
  return (
    <span
      className="t-icon-swap slei-sort-icon-swap shrink-0"
      data-sort-direction={input.direction}
      data-sort-icon-swap=""
      data-state={input.direction === "default" ? "a" : "b"}
    >
      <span className="t-icon" data-icon="a">
        <SleiIcon name="sort" size={14} />
      </span>
      <span className="t-icon" data-icon="b">
        <span
          className="t-icon-swap slei-sort-direction-swap"
          data-sort-direction-swap=""
          data-state={input.direction === "desc" ? "b" : "a"}
        >
          <span className="t-icon" data-icon="a">
            <SleiIcon name="arrowUp" size={14} />
          </span>
          <span className="t-icon" data-icon="b">
            <SleiIcon name="arrowDown" size={14} />
          </span>
        </span>
      </span>
    </span>
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

export function channelDraftFromCardDraft(draft: Record<string, unknown>, members: SleiMember[]): ChannelDraftState {
  const agentMemberIds = new Set(
    members
      .filter((member) => member.type === "agent" && member.directMessageEnabled !== false)
      .map((member) => member.id),
  );
  const agentIds = Array.isArray(draft.agentIds)
    ? draft.agentIds.filter((id): id is string => typeof id === "string" && agentMemberIds.has(id))
    : [];
  const projectPaths = Array.isArray(draft.projectPaths)
    ? uniqueProjectPaths(draft.projectPaths.filter((path): path is string => typeof path === "string"))
    : [];

  return {
    name: typeof draft.name === "string" ? stripChannelHash(draft.name.trim()) : "",
    projectName: typeof draft.projectName === "string" ? draft.projectName : "",
    projectPaths,
    selectedAgentIds: [...new Set(agentIds)],
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
  return [...new Set(paths.map((path) => path.trim()).filter(isValidProjectPath))];
}

function isValidProjectPath(path: string) {
  if (!path || path === "." || path === "..") return false;
  if (/[\x00-\x1F\x7F]/.test(path)) return false;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(path)) return false;
  return !path.split(/[\\/]/).filter(Boolean).includes("..");
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

function SidebarSectionTitle(input: { children: ReactNode }) {
  return (
    <span data-slot="sidebar-section-title" className="select-none">
      {input.children}
    </span>
  );
}

function agentActivityLabel(activity: AgentActivityView, messages: DesktopMessages) {
  if (activity.message.status === "failed") return messages.chat.agentRunFailed;
  if (activity.message.activityEventKind === "tool.started") return messages.chat.agentRunningCommand;
  return messages.chat.agentThinking;
}

function AgentActivityPanel(input: { activity?: AgentActivityView; messages: DesktopMessages }) {
  const { activity } = input;
  if (!activity) return null;
  const failed = activity.message.status === "failed";
  const label = agentActivityLabel(activity, input.messages);
  const identity = activity.member ?? {
    id: activity.message.id,
    name: activity.message.author,
    handle: activity.message.handle ?? `@${activity.message.author.toLowerCase().replace(/\s+/g, "-")}`,
    avatar: activity.message.avatar ?? activity.message.author.slice(0, 2).toUpperCase(),
    avatarSeed: activity.message.author,
  };
  return (
    <section aria-live="polite" className="shrink-0 border-t p-3" data-slot="agent-activity" role="status">
      <div className={cn("flex min-w-0 items-center gap-2 rounded-lg bg-background px-2 py-2", failed && "border border-destructive/45 bg-destructive/10")}>
        <MemberAvatar identity={identity} />
        <div className="min-w-0 flex-1">
          <strong className="block truncate text-sm">{activity.member?.name ?? activity.message.author}</strong>
          <small className={cn("block truncate text-xs text-muted-foreground", failed && "font-medium text-destructive")}>
            {label}
          </small>
        </div>
      </div>
    </section>
  );
}

export function WorkspaceSidebar(input: WorkspaceSidebarProps) {
  const [channelDraft, setChannelDraft] = useState<ChannelDraftState>(() => resetChannelDraft());
  const [createOpen, setCreateOpen] = useState(input.initialCreateChannelModalOpen ?? false);
  const [creatingChannel, setCreatingChannel] = useState(false);
  const [activeChannelCardId, setActiveChannelCardId] = useState<string | undefined>(undefined);
  const [channelSortDirection, setChannelSortDirection] = useState<SortDirection>(() => readFrontendSortPreference(sidebarSortStorageKeys.channels));
  const [directMessageSortDirection, setDirectMessageSortDirection] = useState<SortDirection>(() => readFrontendSortPreference(sidebarSortStorageKeys.directMessages));
  const [openChannelMenuId, setOpenChannelMenuId] = useState<string | undefined>();
  const [openDmMenuId, setOpenDmMenuId] = useState<string | undefined>();
  const [pendingDeleteChannel, setPendingDeleteChannel] = useState<SleiFixtures["channels"][number] | undefined>();
  const [pendingClearDirectMessage, setPendingClearDirectMessage] = useState<DirectMessageEntry | undefined>();
  const [pendingDeleteDirectMessageMember, setPendingDeleteDirectMessageMember] = useState<SleiMember | undefined>();
  const projectFolderInputRef = useRef<HTMLInputElement>(null);
  const profile = localHumanPresentation(input.profile, input.messages);
  const directMessageConversations = input.conversations.filter((conversation) => {
    if (conversation.kind !== "dm") return false;
    const member = input.members.find((candidate) => candidate.id === conversation.agentId);
    return member?.directMessageEnabled !== false;
  });
  const sortedChannels = sortChannelsByName(input.channels, channelSortDirection);
  const agentMembers = input.members.filter((member) => member.type === "agent" && member.directMessageEnabled !== false);
  const conversationByAgentId = new Map(directMessageConversations.map((conversation) => [conversation.agentId, conversation]));
  const directMessageEntries = agentMembers.map((member) => ({
    conversation: conversationByAgentId.get(member.id),
    member,
  }));
  const sortedDirectMessageEntries = sortDirectMessageEntriesByName(directMessageEntries, directMessageSortDirection);

  useEffect(() => {
    const request = input.cardDraftRequest;
    if (!request) return;
    setChannelDraft(channelDraftFromCardDraft(request.draft, input.members));
    setActiveChannelCardId(request.cardId);
    setCreatingChannel(false);
    setCreateOpen(true);
  }, [input.cardDraftRequest?.id, input.members]);

  function cycleChannelSort() {
    setChannelSortDirection((current) => {
      const next = nextSortDirection(current);
      writeFrontendSortPreference(sidebarSortStorageKeys.channels, next);
      return next;
    });
  }

  function cycleDirectMessageSort() {
    setDirectMessageSortDirection((current) => {
      const next = nextSortDirection(current);
      writeFrontendSortPreference(sidebarSortStorageKeys.directMessages, next);
      return next;
    });
  }

  function openChannelCreate() {
    input.onChannelCreateClick();
    setCreateOpen(true);
  }

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
      if (result.created) {
        if (activeChannelCardId) await input.onInteractiveCardComplete?.(activeChannelCardId);
        closeCreateChannelModal();
      }
    } finally {
      setCreatingChannel(false);
    }
  }

  function closeCreateChannelModal() {
    setChannelDraft(resetChannelDraft());
    setActiveChannelCardId(undefined);
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

  function selectChannel(channelId: string) {
    input.onChannelSelect?.(channelId);
    input.onViewChange?.("chat");
  }

  function selectDirectMessage(entry: DirectMessageEntry) {
    if (entry.conversation) {
      input.onConversationSelect?.(entry.conversation.id);
      return;
    }
    input.onMemberMessage?.(entry.member.id);
  }

  return (
    <aside
      aria-label={input.messages.shell.workspaceSidebar.workspace}
      className="slei-workspace-sidebar h-full min-h-0 text-sidebar-foreground max-[760px]:hidden"
    >
      <div className="flex h-full min-h-0 flex-col">
        <div className="slei-workspace-sidebar__header shrink-0 px-3 pb-2 pt-5" data-slot="workspace-sidebar-header">
          <nav aria-label={input.messages.shell.workspaceSidebar.workspace} className="grid gap-1" data-slot="workspace-sidebar-primary-nav">
            <Button
              aria-current={input.activeView === "search" ? "page" : undefined}
              className={cn(sidebarPrimaryActionClassName, input.activeView === "search" && sidebarFlatActiveClassName)}
              onClick={() => input.onViewChange?.("search")}
              type="button"
              variant="ghost"
            >
              <SleiIcon name="search" size={15} />
              {input.messages.shell.nav.search}
            </Button>
            <Button
              aria-current={input.activeView === "tasks" ? "page" : undefined}
              className={cn(sidebarPrimaryActionClassName, input.activeView === "tasks" && sidebarFlatActiveClassName)}
              onClick={() => input.onViewChange?.("tasks")}
              type="button"
              variant="ghost"
            >
              <SleiIcon name="tasks" size={15} />
              {input.messages.shell.nav.tasks}
            </Button>
            <Button
              aria-current={input.activeChatWorkspace === "saved" ? "page" : undefined}
              className={cn(sidebarPrimaryActionClassName, input.activeChatWorkspace === "saved" && sidebarFlatActiveClassName)}
              data-testid="slei-sidebar-saved"
              onClick={() => input.onSavedMessagesOpen?.()}
              type="button"
              variant="ghost"
            >
              <SleiIcon name="bookmark" size={15} />
              {input.messages.shell.workspaceSidebar.savedMessages}
            </Button>
          </nav>
        </div>

        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-3 px-3 py-2" data-channel-scroll-content="">
            <div className="flex items-center justify-between px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <SidebarSectionTitle>{input.messages.chat.channels} {input.channels.length}</SidebarSectionTitle>
              <div className="flex items-center gap-1">
                <Button
                  aria-label={sortActionLabel(input.messages, channelSortDirection)}
                  className={cn("size-6 [&_svg]:size-3", channelSortDirection !== "default" && "bg-muted/70 text-foreground dark:bg-muted/50")}
                  data-sort-state={channelSortDirection}
                  data-sort-target="channels"
                  onClick={cycleChannelSort}
                  size="icon"
                  title={sortActionLabel(input.messages, channelSortDirection)}
                  type="button"
                  variant="ghost"
                >
                  <SortDirectionIcon direction={channelSortDirection} />
                </Button>
                <Button aria-label={input.messages.chat.createChannel} className="size-6 [&_svg]:size-3" onClick={openChannelCreate} size="icon" type="button" variant="ghost"><SleiIcon name="plus" size={14} /></Button>
              </div>
            </div>
            <div className="space-y-1">
              {sortedChannels.map((channel) => {
                const channelName = stripChannelHash(channel.name);
                const selected = input.activeChatWorkspace !== "saved" && !input.activeConversationId && input.activeChannelId === channel.id;
                return (
                  <DropdownMenu
                    key={channel.id}
                    open={openChannelMenuId === channel.id}
                    onOpenChange={(open) => setOpenChannelMenuId(open ? channel.id : undefined)}
                  >
                    <SelectableCard
                      selected={selected || openChannelMenuId === channel.id}
                      className={sidebarListRowClassName}
                      data-channel-id={channel.id}
                      data-channel-list-item=""
                      data-testid={`workspace-channel-row-${channel.id}`}
                      selectedVariant="flat"
                    >
                      <button
                        aria-current={selected ? "true" : undefined}
                        className={sidebarListTriggerClassName}
                        data-slot="channel-select-trigger"
                        onClick={() => selectChannel(channel.id)}
                        type="button"
                      >
                        <span className="flex min-w-0 flex-1 items-center gap-2">
                          <span
                            aria-hidden="true"
                            className="shrink-0 select-none text-[var(--text-color-3)] font-bold"
                            data-slot="channel-hash-mark"
                          >
                            #
                          </span>
                          <span className="truncate select-none">{channelName}</span>
                          {channel.unread > 0 ? <Badge className="ml-auto" variant="secondary">{channel.unread}</Badge> : null}
                        </span>
                      </button>
                      <DropdownMenuTrigger asChild>
                        <Button
                          aria-label={input.messages.shell.workspaceSidebar.channelMore(channelName)}
                          className="mr-1 size-6 self-center opacity-0 transition-opacity group-hover/channel:opacity-100 group-focus-within/channel:opacity-100 focus-visible:opacity-100 [&_svg]:size-3"
                          size="icon"
                          type="button"
                          variant="ghost"
                        >
                          <SleiIcon name="ellipsis" size={14} />
                        </Button>
                      </DropdownMenuTrigger>
                    </SelectableCard>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => input.onChannelEdit?.(channel.id)}>
                        <SleiIcon name="pencil" size={14} />
                        {input.messages.shell.workspaceSidebar.editChannel}
                      </DropdownMenuItem>
                      {channel.id !== "all" ? (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onSelect={() => setPendingDeleteChannel(channel)}>
                            <SleiIcon name="delete" size={14} />
                            {input.messages.shell.workspaceSidebar.deleteChannel}
                          </DropdownMenuItem>
                        </>
                      ) : null}
                    </DropdownMenuContent>
                  </DropdownMenu>
                );
              })}
            </div>
            <Separator />
            <div className="flex items-center justify-between px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <SidebarSectionTitle>{input.messages.chat.directMessages} {directMessageEntries.length}</SidebarSectionTitle>
              <div className="flex items-center gap-1">
                <Button
                  aria-label={sortActionLabel(input.messages, directMessageSortDirection)}
                  className={cn("size-6 [&_svg]:size-3", directMessageSortDirection !== "default" && "bg-muted/70 text-foreground dark:bg-muted/50")}
                  data-sort-state={directMessageSortDirection}
                  data-sort-target="direct-messages"
                  onClick={cycleDirectMessageSort}
                  size="icon"
                  title={sortActionLabel(input.messages, directMessageSortDirection)}
                  type="button"
                  variant="ghost"
                >
                  <SortDirectionIcon direction={directMessageSortDirection} />
                </Button>
                <Button
                  aria-label={input.messages.agentCreate.title}
                  className="size-6 [&_svg]:size-3"
                  data-testid="slei-direct-message-create-trigger"
                  onClick={input.onMemberCreateClick}
                  size="icon"
                  type="button"
                  variant="ghost"
                >
                  <SleiIcon name="plus" size={14} />
                </Button>
              </div>
            </div>
            <div className="space-y-1 pr-2" data-slot="direct-message-list">
              {sortedDirectMessageEntries.map((entry) => {
                const { conversation, member } = entry;
                const conversationId = conversation?.id;
                const selected = Boolean(input.activeChatWorkspace !== "saved" && conversationId && input.activeConversationId === conversationId);
                return (
                  <DropdownMenu
                    key={member.id}
                    open={openDmMenuId === member.id}
                    onOpenChange={(open) => setOpenDmMenuId(open ? member.id : undefined)}
                  >
                    <SelectableCard
                      selected={selected || openDmMenuId === member.id}
                      className={cn(sidebarListRowClassName, "h-10 min-h-10")}
                      data-conversation-id={conversationId}
                      data-direct-message-list-item=""
                      data-member-id={member.id}
                      data-testid={`workspace-dm-row-${conversation ? dmTestId(conversation) : member.id}`}
                      selectedVariant="flat"
                    >
                      <button
                        aria-current={selected ? "true" : undefined}
                        className={cn(sidebarListTriggerClassName, "gap-2")}
                        data-slot="direct-message-select-trigger"
                        onClick={() => selectDirectMessage(entry)}
                        type="button"
                      >
                        <MemberAvatar identity={member} size="sidebar" status={member.runtimeStatus} />
                        <span className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden whitespace-nowrap" data-slot="direct-message-name">
                          <span className="min-w-0 truncate text-[14px] font-normal leading-5">{member.name}</span>
                          {member.profession?.trim() || member.role?.trim() ? (
                            <Badge className="min-w-0 max-w-[55%] shrink truncate" variant="secondary">
                              {member.profession?.trim() || member.role?.trim()}
                            </Badge>
                          ) : null}
                        </span>
                      </button>
                      <DropdownMenuTrigger asChild>
                        <Button
                          aria-label={input.messages.shell.workspaceSidebar.dmMore(member.name)}
                          className="mr-1 size-6 self-center opacity-0 transition-opacity group-hover/channel:opacity-100 group-focus-within/channel:opacity-100 focus-visible:opacity-100 [&_svg]:size-3"
                          size="icon"
                          type="button"
                          variant="ghost"
                        >
                          <SleiIcon name="ellipsis" size={14} />
                        </Button>
                      </DropdownMenuTrigger>
                    </SelectableCard>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => {
                        input.onMemberSelect?.(member.id);
                        input.onViewChange?.("members");
                      }}>
                        <SleiIcon name="user" size={14} />
                        {input.messages.shell.workspaceSidebar.openMemberProfile}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      {conversation ? (
                        <DropdownMenuItem onSelect={() => setPendingClearDirectMessage(entry)}>
                          <SleiIcon name="delete" size={14} />
                          {input.messages.shell.workspaceSidebar.clearDirectMessageHistory}
                        </DropdownMenuItem>
                      ) : null}
                      {!member.systemOwned ? (
                        <DropdownMenuItem onSelect={() => setPendingDeleteDirectMessageMember(member)}>
                          <SleiIcon name="delete" size={14} />
                          {input.messages.shell.workspaceSidebar.deleteMember}
                        </DropdownMenuItem>
                      ) : null}
                    </DropdownMenuContent>
                  </DropdownMenu>
                );
              })}
            </div>
          </div>
        </ScrollArea>

        <AgentActivityPanel activity={input.activeAgentActivity} messages={input.messages} />

        <div className="slei-workspace-sidebar__footer shrink-0 border-t px-3 py-3">
          <div className="flex min-w-0 items-center gap-2 px-1">
            <MemberAvatar identity={{ id: "local-user", name: profile.displayName, handle: profile.handle, avatar: profile.avatar }} />
            <div className="min-w-0 flex-1">
              <strong className="block truncate text-sm">{profile.displayName}</strong>
              <small className="block truncate text-xs text-muted-foreground">{profile.handle}</small>
            </div>
            <Button
              aria-label={input.messages.shell.workspaceSidebar.openSettingsMenu}
              className="size-8 [&_svg]:size-3.5"
              data-testid="slei-sidebar-settings-trigger"
              onClick={() => input.onSettingsOpen?.("account")}
              size="icon"
              type="button"
              variant="ghost"
            >
              <SleiIcon name="settings" size={15} />
            </Button>
          </div>
        </div>
      </div>

      <ShellDialog closeLabel={input.messages.common.cancel} open={createOpen} onOpenChange={(open) => {
        if (!open) closeCreateChannelModal();
        else setCreateOpen(true);
      }} className="grid max-h-[min(90vh,42rem)] grid-rows-[auto_minmax(0,1fr)] overflow-hidden sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><SleiIcon name="hash" size={20} />{input.messages.chat.createChannel}</DialogTitle>
            <DialogDescription>{input.messages.chat.createChannelDescription}</DialogDescription>
          </DialogHeader>
          <form className="grid min-h-0 grid-rows-[minmax(0,1fr)_auto] gap-4" onSubmit={submitChannel}>
            <FieldGroup className="min-h-0 gap-5 overflow-y-auto pr-1">
              <Field>
                <FieldLabel className="gap-1" htmlFor="slei-channel-name">
                  {input.messages.chat.channelName}
                  <span aria-hidden="true" className="text-destructive">*</span>
                </FieldLabel>
                <Input
                  aria-label={input.messages.chat.channelName}
                  id="slei-channel-name"
                  onChange={(event) => setChannelDraft((current) => ({ ...current, name: event.currentTarget.value }))}
                  placeholder="请输入"
                  value={channelDraft.name}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="slei-channel-project-picker">{input.messages.chat.project}</FieldLabel>
                <div className="grid gap-3">
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
                      <SleiIcon name="folderPlus" size={14} />
                      {input.messages.chat.projectFolderPicker}
                    </Button>
                    <FieldDescription className="text-xs">{input.messages.chat.projectFolderHint}</FieldDescription>
                  </div>
                  {channelDraft.projectPaths.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {channelDraft.projectPaths.map((path) => (
                        <Badge className="max-w-full gap-1" key={path} variant="secondary">
                          <span className="truncate">{path}</span>
                          <Button aria-label={input.messages.chat.removeProject(path)} className="-mr-1 ml-0.5 size-6 hover:bg-background/70 [&_svg]:size-3" onClick={() => removeProjectFolder(path)} size="icon" type="button" variant="ghost">
                            <SleiIcon className="size-3" name="x" />
                          </Button>
                        </Badge>
                      ))}
                    </div>
                  ) : null}
                </div>
              </Field>
              {agentMembers.length > 0 ? (
                <FieldSet className="min-h-0">
                  <FieldLegend>{input.messages.chat.selectAgents}</FieldLegend>
                  <ScrollArea className="min-h-0 max-h-[min(16rem,34vh)] overflow-y-auto rounded-md border bg-background">
                    <div className="grid gap-1 p-2">
                      {agentMembers.map((member) => {
                        const selected = channelDraft.selectedAgentIds.includes(member.id);
                        return (
                          <SelectableCard
                            className="rounded-md"
                            data-testid="slei-create-channel-agent-option"
                            key={member.id}
                            selected={selected}
                            selectedVariant="checkboxField"
                          >
                            <Label className="flex cursor-pointer items-center gap-3 rounded-md px-3 py-3">
                              <Checkbox
                                aria-label={`${input.messages.chat.selectAgents} ${member.name}`}
                                checked={selected}
                                onCheckedChange={() => toggleSelectedAgent(member.id)}
                              />
                              <MemberAvatar identity={member} />
                              <span className="grid min-w-0 flex-1">
                                <strong className="truncate text-sm">{member.name}</strong>
                                <small className="truncate text-xs text-muted-foreground">{member.handle} / {member.role}</small>
                              </span>
                            </Label>
                          </SelectableCard>
                        );
                      })}
                    </div>
                  </ScrollArea>
                </FieldSet>
              ) : null}
            </FieldGroup>
            <DialogFooter>
              <Button disabled={creatingChannel} onClick={closeCreateChannelModal} type="button" variant="outline">{input.messages.common.cancel}</Button>
              <Button aria-label={input.messages.chat.createChannel} className="min-w-20" disabled={creatingChannel} type="submit">
                {creatingChannel ? <SleiIcon className="animate-spin" name="loader" size={14} /> : <><SleiIcon name="plus" size={14} />{input.messages.common.create}</>}
              </Button>
            </DialogFooter>
          </form>
      </ShellDialog>

      <AlertDialog open={Boolean(pendingDeleteChannel)} onOpenChange={(open) => {
        if (!open) setPendingDeleteChannel(undefined);
      }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {input.messages.chat.deleteChannel(stripChannelHash(pendingDeleteChannel?.name ?? ""))}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {input.messages.chat.deleteChannelConfirm(stripChannelHash(pendingDeleteChannel?.name ?? ""))}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{input.messages.common.cancel}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (pendingDeleteChannel) input.onChannelDelete?.(pendingDeleteChannel.id);
                setPendingDeleteChannel(undefined);
              }}
            >
              {input.messages.common.delete}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={Boolean(pendingClearDirectMessage)} onOpenChange={(open) => {
        if (!open) setPendingClearDirectMessage(undefined);
      }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {input.messages.shell.workspaceSidebar.clearDirectMessageHistoryTitle(pendingClearDirectMessage?.member.name ?? "")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {input.messages.shell.workspaceSidebar.clearDirectMessageHistoryConfirm(pendingClearDirectMessage?.member.name ?? "")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{input.messages.common.cancel}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                const conversationId = pendingClearDirectMessage?.conversation?.id;
                if (conversationId) void input.onConversationMessagesClear?.(conversationId);
                setPendingClearDirectMessage(undefined);
              }}
            >
              {input.messages.shell.workspaceSidebar.clearDirectMessageHistory}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={Boolean(pendingDeleteDirectMessageMember)} onOpenChange={(open) => {
        if (!open) setPendingDeleteDirectMessageMember(undefined);
      }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {input.messages.shell.workspaceSidebar.deleteMemberTitle(pendingDeleteDirectMessageMember?.name ?? "")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {input.messages.shell.workspaceSidebar.deleteMemberConfirm(pendingDeleteDirectMessageMember?.name ?? "")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{input.messages.common.cancel}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (pendingDeleteDirectMessageMember) void input.onAgentDelete?.(pendingDeleteDirectMessageMember.id);
                setPendingDeleteDirectMessageMember(undefined);
              }}
            >
              {input.messages.common.delete}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </aside>
  );
}

function ShellDialog(input: {
  children: ReactNode;
  className?: string;
  closeLabel?: string;
  contentTestId?: string;
  onOpenChange?: (open: boolean) => void;
  open: boolean;
}) {
  return (
    <Dialog open={input.open} onOpenChange={input.onOpenChange}>
      <DialogContent className={input.className} closeLabel={input.closeLabel} data-testid={input.contentTestId}>
        {input.children}
      </DialogContent>
    </Dialog>
  );
}

function dmTestId(conversation: ConversationView) {
  const fromConversationId = conversation.id.replace(/^dm[:/]/, "");
  return (fromConversationId || conversation.agentId).replace(/[^a-zA-Z0-9_-]/g, "_");
}
