import { useEffect, useRef, useState } from "react";
import { Bookmark, CheckSquare, Copy, FileText, Hash, History, Image as ImageIcon, MessageCircle, Paperclip, Plus, Send, Trash2, Users, X } from "lucide-react";

import type { DesktopMessages } from "../../i18n";
import type { ConversationAttachmentUploadRequest, ConversationAttachmentView, ConversationView, InteractiveCardView, PermissionDecision } from "../../lib/daemon-bridge";
import type { SleiFixtures, SleiMember, SleiMessage } from "../../app/types";
import { MarkdownMessage } from "./MarkdownMessage";
import { activeMentionQuery, channelReadinessLabel, composerShortcutAction, filterConversationMessages, formatLocalRecordDateTime, insertMention, isComposerImeComposing, mentionSuggestions, moveMentionSelection, stripChannelHash, submitComposerDraftWithFeedback, type AgentDraftInput, type UserProfile } from "../../app/model";
import { MemberAvatar, memberFromMessage, MessageStatusSquare, Toast, TOAST_VISIBLE_MS, type ToastType } from "../../components";
import { Alert, AlertDescription, AlertTitle } from "../../components/ui/alert";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";
import { Checkbox } from "../../components/ui/checkbox";
import { ScrollArea } from "../../components/ui/scroll-area";
import { Sheet, SheetClose, SheetContent, SheetHeader, SheetTitle } from "../../components/ui/sheet";
import { Tabs, TabsList, TabsTrigger } from "../../components/ui/tabs";
import { Textarea } from "../../components/ui/textarea";
import { cn } from "../../lib/utils";
import { TaskThreadDrawer } from "../tasks/TaskThreadDrawer";
import { MentionPicker } from "./MentionPicker";
import { TaskRootEntry } from "./TaskRootEntry";

export type ChannelEmbeddedView = "chat" | "tasks" | "files";

type ChannelFileEntry = {
  attachment: ConversationAttachmentView;
  author: string;
  messageId: string;
  time: string;
};

function InteractiveCard({ card, messages, onCreate, onPermissionResolve }: { card: InteractiveCardView; messages: DesktopMessages; onCreate?: () => void; onPermissionResolve?: (requestId: string, decision: PermissionDecision) => Promise<void> | void }) {
  if (card.kind === "permissionApproval") {
    const done = card.state !== "pending";
    const requestId = typeof card.draft.requestId === "string" ? card.draft.requestId : "";
    const targetPath = typeof card.draft.targetPath === "string" ? card.draft.targetPath : card.summary;
    const toolName = typeof card.draft.toolName === "string" ? card.draft.toolName : "Write";
    return (
      <Alert className="mt-2 border-amber-500/30 bg-amber-500/5" data-card-kind={card.kind} data-state={card.state}>
        <AlertTitle className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="border-amber-500/40 text-amber-700 dark:text-amber-300">权限申请</Badge>
          <span>{card.title}</span>
        </AlertTitle>
        <AlertDescription className="space-y-1">
          <p>{toolName} 需要写入工作区外路径：{targetPath}</p>
          <p className="text-xs">仅影响当前会话；新会话会重新申请。</p>
        </AlertDescription>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button disabled={done || !requestId} onClick={() => onPermissionResolve?.(requestId, "approve_once")} size="sm" type="button">
            允许一次
          </Button>
          <Button disabled={done || !requestId} onClick={() => onPermissionResolve?.(requestId, "approve_session")} size="sm" type="button" variant="outline">
            本会话始终允许
          </Button>
          <Button disabled={done || !requestId} onClick={() => onPermissionResolve?.(requestId, "deny")} size="sm" type="button" variant="destructive">
            拒绝
          </Button>
        </div>
      </Alert>
    );
  }
  const done = card.state !== "pending";
  const doneLabel = card.doneLabel === "DONE" ? messages.common.done : card.doneLabel || messages.common.done;
  return (
    <Card className="mt-2 border-primary/20 bg-card/80 py-3" data-card-kind={card.kind} data-state={card.state} size="sm">
      <CardHeader className="gap-1 px-3">
        <CardTitle className="text-sm">{card.title}</CardTitle>
        <CardDescription className="text-xs">{card.summary}</CardDescription>
        <CardAction className="self-center">
          <Button disabled={done} onClick={onCreate} size="sm" type="button">
            {done ? doneLabel : card.actionLabel || messages.common.create}
          </Button>
        </CardAction>
      </CardHeader>
    </Card>
  );
}

function AttachmentList({ attachments, messageAttachments = false, onRemove }: { attachments: ConversationAttachmentView[]; messageAttachments?: boolean; onRemove?: (attachmentId: string) => void }) {
  if (attachments.length === 0) return null;
  return (
    <div className={cn("flex flex-wrap gap-2", messageAttachments ? "mt-2" : "")} data-message-attachments={messageAttachments ? "true" : undefined} data-slot="attachment-list">
      {attachments.map((attachment) => {
        const isImage = attachment.mimeType.startsWith("image/");
        return (
          <Badge className="h-auto max-w-full gap-1.5 rounded-md px-2 py-1 text-xs" key={attachment.id} variant="outline">
            {isImage && attachment.url ? <img alt="" className="size-7 rounded object-cover" src={attachment.url} /> : <FileText aria-hidden="true" size={14} />}
            <span className="max-w-48 truncate">{attachment.name}</span>
            <small className="text-muted-foreground">{formatAttachmentSize(attachment.size)}</small>
            {onRemove ? (
              <button aria-label={`Remove ${attachment.name}`} className="grid size-5 place-items-center rounded hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => onRemove(attachment.id)} type="button">
                <X aria-hidden="true" size={12} />
              </button>
            ) : null}
          </Badge>
        );
      })}
    </div>
  );
}

function formatAttachmentSize(size: number) {
  if (size < 1024) return `${size} B`;
  const kilobytes = size / 1024;
  if (kilobytes < 1024) return `${Math.round(kilobytes)} KB`;
  return `${(kilobytes / 1024).toFixed(1)} MB`;
}

function taskStatusLabel(status: SleiFixtures["tasks"][number]["status"], messages: DesktopMessages) {
  return messages.tasks.status[status];
}

function isTransientAgentActivity(message: SleiMessage) {
  return message.role === "agent" && (message.status === "running" || message.status === "pending");
}

function isTaskCardControlMessage(message: SleiMessage) {
  return Boolean(message.taskCard) || (message.role === "system" && message.body.trim().startsWith("task_card:"));
}

function isLinkedTaskAgentReply(message: SleiMessage, sourceMessageIds: Set<string>) {
  if (message.role !== "agent") return false;
  for (const sourceMessageId of sourceMessageIds) {
    if (message.id === `agent-activity-${sourceMessageId}` || message.id === `agent-reply-${sourceMessageId}`) return true;
  }
  return false;
}

function ChannelTaskList({ messages, onTaskThreadOpen, tasks }: { messages: DesktopMessages; onTaskThreadOpen?: (taskId: string) => Promise<void> | void; tasks: SleiFixtures["tasks"] }) {
  const [selectedTaskId, setSelectedTaskId] = useState(tasks[0]?.id);
  const loadedTaskThreadIdRef = useRef<string | undefined>(undefined);
  const selectedTask = tasks.find((task) => task.id === selectedTaskId) ?? tasks[0];

  useEffect(() => {
    const taskId = selectedTask?.id;
    if (!taskId || loadedTaskThreadIdRef.current === taskId) return;
    loadedTaskThreadIdRef.current = taskId;
    void Promise.resolve(onTaskThreadOpen?.(taskId)).catch(() => undefined);
  }, [selectedTask?.id, onTaskThreadOpen]);

  function selectTask(taskId: string) {
    setSelectedTaskId(taskId);
  }

  if (tasks.length === 0) {
    return <section className="grid h-full min-h-0 place-items-center overflow-hidden p-6 text-sm text-muted-foreground">{messages.chat.channelTaskEmpty}</section>;
  }

  return (
    <section aria-label={messages.chat.tasks} className="grid h-full min-h-0 grid-cols-[minmax(14rem,20rem)_minmax(0,1fr)] gap-3 overflow-hidden p-4 max-[820px]:grid-cols-1">
      <ScrollArea className="h-full min-h-0 rounded-lg border bg-card/40">
        <div className="grid gap-1 p-2">
          {tasks.map((task) => (
            <Button
              aria-current={selectedTask?.id === task.id ? "true" : undefined}
              className={cn("h-auto min-h-16 justify-start whitespace-normal px-3 py-2 text-left", selectedTask?.id === task.id && "bg-accent text-accent-foreground")}
              key={task.id}
              onClick={() => selectTask(task.id)}
              type="button"
              variant="ghost"
            >
              <span className="grid min-w-0 gap-1">
                <span className="flex min-w-0 flex-wrap items-center gap-2">
                  <Badge variant="outline">{taskStatusLabel(task.status, messages)}</Badge>
                  {task.attention ? <Badge variant="secondary">{task.attention}</Badge> : null}
                </span>
                <strong className="truncate text-sm">{task.title}</strong>
                <small className="text-xs font-normal text-muted-foreground">{task.owner} · {messages.chat.replyCount(task.replies?.length ?? 0)}</small>
              </span>
            </Button>
          ))}
        </div>
      </ScrollArea>
      {selectedTask ? (
        <Card className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)]">
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">{taskStatusLabel(selectedTask.status, messages)}</Badge>
              <span>{selectedTask.title}</span>
            </CardTitle>
            <CardDescription>{selectedTask.owner} · {messages.chat.replyCount(selectedTask.replies?.length ?? 0)}</CardDescription>
          </CardHeader>
          <CardContent className="min-h-0">
          <ScrollArea className="h-full min-h-0">
            <div className="grid gap-2 pr-3">
            {(selectedTask.replies ?? []).map((reply, index) => (
              <article className="rounded-lg border bg-muted/20 p-3 text-sm" key={reply.id}>
                <strong className="text-xs text-muted-foreground">{index === 0 ? messages.chat.rootMessage : reply.sender}</strong>
                <p className="mt-1 leading-relaxed">{reply.body}</p>
              </article>
            ))}
            </div>
          </ScrollArea>
          </CardContent>
        </Card>
      ) : null}
    </section>
  );
}

function ChannelFileList({ files, messages }: { files: ChannelFileEntry[]; messages: DesktopMessages }) {
  if (files.length === 0) {
    return <section className="grid min-h-0 place-items-center p-6 text-sm text-muted-foreground">{messages.chat.channelFileEmpty}</section>;
  }

  function openAttachment(attachment: ConversationAttachmentView) {
    if (!attachment.url || typeof window === "undefined") return;
    window.open(attachment.url, "_blank", "noopener,noreferrer");
  }

  return (
    <ScrollArea aria-label={messages.chat.files} className="min-h-0 p-4">
      <section className="grid gap-2">
        {files.map(({ attachment, author, messageId, time }) => {
          const isImage = attachment.mimeType.startsWith("image/");
          const canOpen = Boolean(attachment.url);
          return (
            <Button
              aria-label={messages.chat.openAttachment(attachment.name)}
              className="h-auto justify-start gap-3 rounded-lg border bg-card px-3 py-2 text-left"
              disabled={!canOpen}
              key={`${messageId}-${attachment.id}`}
              onClick={() => openAttachment(attachment)}
              type="button"
              variant="ghost"
            >
              {isImage && attachment.url ? (
                <img alt="" className="size-10 rounded-md object-cover" src={attachment.url} />
              ) : (
                <span className="grid size-10 place-items-center rounded-md bg-muted text-muted-foreground"><FileText aria-hidden="true" size={16} /></span>
              )}
              <span className="grid min-w-0 flex-1 gap-0.5">
                <strong className="truncate text-sm">{attachment.name}</strong>
                <small className="text-xs font-normal text-muted-foreground">{author} · {time}</small>
              </span>
              <small className="text-xs font-normal text-muted-foreground">{formatAttachmentSize(attachment.size)}</small>
            </Button>
          );
        })}
      </section>
    </ScrollArea>
  );
}

function memberMatchingMessage(message: SleiMessage, members: SleiMember[]): SleiMember | undefined {
  const normalizedHandle = message.handle?.toLowerCase();
  const normalizedAuthor = message.author.toLowerCase();
  return members.find(
    (member) =>
      member.handle.toLowerCase() === normalizedHandle ||
      member.name.toLowerCase() === normalizedAuthor,
  );
}

function messageRoleDescription(message: SleiMessage, members: SleiMember[], messages: DesktopMessages): string {
  return memberMatchingMessage(message, members)?.role ?? messages.chat.roleLabels[message.role];
}

function messageTimestampLabel(message: SleiMessage): string {
  const raw = (message.sentAt ?? message.time).trim();
  const match = raw.match(/^(?:(\d{4})-)?(\d{2}-\d{2})[T ](\d{2}:\d{2})(?::\d{2})?/);
  if (match) return `${match[2]} ${match[3]}`;
  return raw;
}

async function copyMessageBody(body: string) {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(body);
    return true;
  }
  if (typeof document === "undefined") return false;

  const textarea = document.createElement("textarea");
  textarea.value = body;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  return copied;
}

function formatConversationDateTime(value: string): string {
  return formatLocalRecordDateTime(value);
}

function sessionCreatedTime(session: { createdAt: string }) {
  const parsed = Date.parse(session.createdAt);
  return Number.isNaN(parsed) ? 0 : parsed;
}

async function uploadComposerFile(
  file: File,
  onAttachmentUpload?: (request: ConversationAttachmentUploadRequest) => Promise<{ attachment: ConversationAttachmentView }>,
): Promise<ConversationAttachmentView | null> {
  const bytesBase64 = await fileToBase64(file);
  if (onAttachmentUpload) {
    return (await onAttachmentUpload({ name: file.name, mimeType: file.type || "application/octet-stream", bytesBase64 })).attachment;
  }
  return {
    id: `local-${file.name}-${file.size}`,
    name: file.name,
    mimeType: file.type || "application/octet-stream",
    size: file.size,
    url: file.type.startsWith("image/") ? `data:${file.type};base64,${bytesBase64}` : undefined,
  };
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      const result = String(reader.result ?? "");
      resolve(result.includes(",") ? result.split(",").pop() ?? "" : result);
    });
    reader.addEventListener("error", () => reject(reader.error ?? new Error("file read failed")));
    reader.readAsDataURL(file);
  });
}

function ChannelMemberPanel(input: {
  availableMembers: SleiMember[];
  channelId: string;
  members: SleiMember[];
  messages: DesktopMessages;
  open: boolean;
  onAdd?: (agentId: string) => Promise<void> | void;
  onRemove?: (agentId: string) => Promise<void> | void;
}) {
  const [mutatingMemberId, setMutatingMemberId] = useState<string | undefined>(undefined);
  const [confirmingAddId, setConfirmingAddId] = useState<string | undefined>(undefined);
  const [confirmingRemoveId, setConfirmingRemoveId] = useState<string | undefined>(undefined);
  const [addMenuOpen, setAddMenuOpen] = useState(false);

  async function mutate(memberId: string, action: "add" | "remove") {
    setMutatingMemberId(memberId);
    try {
      if (action === "add") {
        await input.onAdd?.(memberId);
        setConfirmingAddId(undefined);
        setAddMenuOpen(false);
      } else {
        await input.onRemove?.(memberId);
        setConfirmingRemoveId(undefined);
      }
    } finally {
      setMutatingMemberId(undefined);
    }
  }

  return (
    <aside
      aria-hidden={input.open ? undefined : "true"}
      aria-label={input.messages.chat.channelMembers}
      className={cn(
        "absolute bottom-0 right-0 top-[calc(4rem+1px)] z-20 grid w-[min(20rem,calc(100%-2rem))] grid-rows-[auto_minmax(0,1fr)] gap-3 border-l bg-popover p-3 text-popover-foreground shadow-lg transition-transform duration-200 ease-out",
        input.open ? "translate-x-0" : "pointer-events-none translate-x-full",
      )}
      data-testid="slei-channel-member-panel"
      inert={input.open ? undefined : true}
    >
      <div className="relative flex items-center justify-between gap-2">
        <h2 className="inline-flex min-w-0 items-center gap-2 text-sm font-semibold">
          <Users aria-hidden="true" size={16} />
          <span className="truncate">{input.messages.chat.channelMembers}</span>
          <Badge variant="secondary">{input.members.length}</Badge>
        </h2>
        <Button aria-expanded={addMenuOpen ? "true" : "false"} aria-label={input.messages.chat.addChannelMember} onClick={() => setAddMenuOpen((current) => !current)} size="icon-xs" title={input.messages.chat.addChannelMember} type="button" variant="ghost">
          <Plus aria-hidden="true" size={14} />
        </Button>
        {addMenuOpen ? (
          <div className="absolute right-0 top-8 z-30 grid w-64 gap-1 rounded-lg border bg-popover p-2 shadow-lg" data-testid="slei-channel-member-add-menu">
            {input.availableMembers.length > 0 ? input.availableMembers.map((member) => {
              const confirming = confirmingAddId === member.id;
              return (
                <div className="grid gap-1 rounded-md px-1 py-1" key={member.id}>
                  <Button className="h-auto justify-start gap-2 px-2 py-2" disabled={mutatingMemberId === member.id} onClick={() => setConfirmingAddId(member.id)} type="button" variant="ghost">
                    <MemberAvatar identity={member} />
                    <span className="grid min-w-0 text-left">
                      <strong className="truncate text-sm">{member.name}</strong>
                      <small className="truncate text-xs font-normal text-muted-foreground">{member.handle}</small>
                    </span>
                  </Button>
                  {confirming ? (
                    <div className="flex justify-end gap-2 px-1">
                      <Button onClick={() => setConfirmingAddId(undefined)} size="sm" type="button" variant="ghost">{input.messages.common.cancel}</Button>
                      <Button disabled={mutatingMemberId === member.id} onClick={() => void mutate(member.id, "add")} size="sm" type="button">{input.messages.chat.addChannelMember}</Button>
                    </div>
                  ) : null}
                </div>
              );
            }) : (
              <p className="rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground">{input.messages.chat.noAvailableChannelMembers}</p>
            )}
          </div>
        ) : null}
      </div>
      <ScrollArea className="min-h-0 pr-2">
        <div className="grid gap-1.5">
          {input.members.length > 0 ? input.members.map((member) => {
            const readiness = member.channelReadiness?.[input.channelId];
            const confirming = confirmingRemoveId === member.id;
            return (
              <div className="group/member grid gap-1 rounded-md border bg-background px-2 py-2" key={member.id}>
                <div className="flex min-w-0 items-center gap-2">
                  <MemberAvatar identity={member} />
                  <span className="grid min-w-0 flex-1">
                    <strong className="truncate text-sm">{member.name}</strong>
                    <small className="truncate text-xs text-muted-foreground">{member.handle}</small>
                  </span>
                  <Badge variant={readiness === "ready" ? "secondary" : "outline"}>{channelReadinessLabel(readiness, input.messages)}</Badge>
                  <Button aria-label={input.messages.chat.removeChannelMember(member.name)} className="opacity-0 transition-opacity group-hover/member:opacity-100 group-focus-within/member:opacity-100 focus-visible:opacity-100" disabled={mutatingMemberId === member.id} onClick={() => setConfirmingRemoveId(member.id)} size="icon-xs" type="button" variant="ghost">
                    <Trash2 aria-hidden="true" size={14} />
                  </Button>
                </div>
                {confirming ? (
                  <div className="flex justify-end gap-2">
                    <Button onClick={() => setConfirmingRemoveId(undefined)} size="sm" type="button" variant="ghost">{input.messages.common.cancel}</Button>
                    <Button disabled={mutatingMemberId === member.id} onClick={() => void mutate(member.id, "remove")} size="sm" type="button" variant="destructive">{input.messages.common.delete}</Button>
                  </div>
                ) : null}
              </div>
            );
          }) : (
            <p className="rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground">{input.messages.chat.noChannelMembers}</p>
          )}
        </div>
      </ScrollArea>
    </aside>
  );
}

export function ChatPage({ activeChannel, activeConversation, activeSessionId, data, focusedMessageId, initialAttachments, initialChannelMembersOpen, initialChannelView, initialDraft, messages, onAgentDraftCreate, onAttachmentUpload, onChannelDraftCreate, onChannelMemberAdd, onChannelMemberRemove, onChannelNewSession, onChannelSessionSelect, onConversationHistoryToggle, onConversationNewSession, onConversationSessionSelect, onMessageSaveToggle, onPermissionResolve, onSendFailure, onSendMessage, onTaskReply, onTaskStatusChange, onTaskThreadOpen, profile, savedMessageIds = [], sending, sessionDrawerOpen }: { activeChannel: SleiFixtures["channels"][number]; activeConversation?: ConversationView; activeSessionId?: string; data: SleiFixtures; focusedMessageId?: string; initialAttachments?: ConversationAttachmentView[]; initialChannelMembersOpen?: boolean; initialChannelView?: ChannelEmbeddedView; initialDraft?: string; messages: DesktopMessages; onAgentDraftCreate?: (draft: Partial<AgentDraftInput>, cardId?: string) => void; onAttachmentUpload?: (request: ConversationAttachmentUploadRequest) => Promise<{ attachment: ConversationAttachmentView }>; onChannelDraftCreate?: (draft: Record<string, unknown>, cardId?: string) => void; onChannelMemberAdd?: (agentId: string) => Promise<void> | void; onChannelMemberRemove?: (agentId: string) => Promise<void> | void; onChannelNewSession?: (channelId: string) => Promise<void> | void; onChannelSessionSelect?: (channelId: string, sessionId: string) => Promise<void> | void; onConversationHistoryToggle?: () => void; onConversationNewSession?: (conversationId: string) => Promise<void> | void; onConversationSessionSelect?: (conversationId: string, sessionId: string) => Promise<void> | void; onMessageSaveToggle?: (message: SleiMessage) => Promise<void> | void; onPermissionResolve?: (requestId: string, decision: PermissionDecision) => Promise<void> | void; onSendFailure?: (message: string, type?: ToastType) => void; onSendMessage?: (body: string, options?: { asTask?: boolean; attachmentIds?: string[]; sessionId?: string }) => Promise<void> | void; onTaskReply?: (taskId: string, body: string) => Promise<void> | void; onTaskStatusChange?: (taskId: string, status: SleiFixtures["tasks"][number]["status"]) => Promise<void> | void; onTaskThreadOpen?: (taskId: string) => Promise<void> | void; profile: UserProfile; savedMessageIds?: string[]; sending?: boolean; sessionDrawerOpen?: boolean }) {
  const [draft, setDraft] = useState(initialDraft ?? "");
  const [asTask, setAsTask] = useState(false);
  const [attachments, setAttachments] = useState<ConversationAttachmentView[]>(initialAttachments ?? []);
  const [channelView, setChannelView] = useState<ChannelEmbeddedView>(initialChannelView ?? "chat");
  const [channelMembersOpen, setChannelMembersOpen] = useState(initialChannelMembersOpen ?? false);
  const [isComposing, setIsComposing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [selectedMentionIndex, setSelectedMentionIndex] = useState(0);
  const [toast, setToast] = useState<{ message: string; type: ToastType }>({ message: "", type: "info" });
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | undefined>(focusedMessageId);
  const [selectedTaskId, setSelectedTaskId] = useState<string | undefined>(undefined);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const mentionOptionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const timelineEndRef = useRef<HTMLDivElement | null>(null);
  const pendingScrollToBottomRef = useRef(false);
  const initialTimelineScrollTargetRef = useRef<string | undefined>(undefined);
  const mention = activeMentionQuery(draft);
  const mentionTargets = mention ? mentionSuggestions(mention.query, data.members) : [];
  const dmMember = activeConversation?.kind === "dm" ? data.members.find((member) => member.id === activeConversation.agentId) : undefined;
  const activeTargetId = activeConversation?.id ?? activeChannel.id;
  const currentSessionId = activeConversation ? activeSessionId ?? activeConversation.activeSessionId : activeChannel.activeSessionId;
  const visibleMessages = filterConversationMessages(data.messages, {
    channel: activeTargetId,
  }).filter((message) => {
    if (!currentSessionId) return !message.sessionId;
    return message.sessionId === currentSessionId || (!activeConversation && !message.sessionId);
  });
  const visibleMessageIds = new Set(visibleMessages.map((message) => message.id));
  const channelTasks = data.tasks.filter((task) => task.channelId === activeChannel.id && (!task.sourceMessageId || visibleMessageIds.has(task.sourceMessageId)));
  const taskBySourceMessageId = new Map(
    channelTasks
      .filter((task) => task.sourceMessageId)
      .map((task) => [task.sourceMessageId!, task]),
  );
  const messageTaskSourceIds = new Set(
    visibleMessages
      .map((message) =>
        (message.task && message.task.channelId === activeChannel.id && message.task.sourceMessageId === message.id) || taskBySourceMessageId.has(message.id)
          ? message.id
          : undefined,
      )
      .filter((id): id is string => Boolean(id)),
  );
  const taskSourceIds = new Set([...messageTaskSourceIds]);
  const timelineMessages = visibleMessages
    .filter((message) => !isTransientAgentActivity(message))
    .filter((message) => !isLinkedTaskAgentReply(message, taskSourceIds))
    .filter((message) => !isTaskCardControlMessage(message));
  const channelFiles: ChannelFileEntry[] = visibleMessages
    .flatMap((message) =>
      (message.attachments ?? []).map((attachment) => ({
        attachment,
        author: message.author,
        messageId: message.id,
        time: message.time,
      })),
    )
    .reverse();
  const channelMembers = data.members.filter((member) => member.type === "agent" && Boolean(member.channelReadiness?.[activeChannel.id]));
  const availableChannelMembers = data.members.filter((member) =>
    member.type === "agent" &&
    member.directMessageEnabled !== false &&
    !member.channelReadiness?.[activeChannel.id],
  );
  const selectedTask = data.tasks.find((task) => task.id === selectedTaskId);
  const activeSessions = activeConversation ? data.conversationSessions.filter((session) => session.conversationId === activeConversation.id) : data.channelSessions.filter((session) => session.channelId === activeChannel.id);
  const sortedActiveSessions = [...activeSessions].sort((left, right) => sessionCreatedTime(right) - sessionCreatedTime(left));
  const activeSession = activeSessions.find((session) => session.id === currentSessionId) ?? sortedActiveSessions[0];
  const allowAsTask = !dmMember;
  const effectiveChannelView: ChannelEmbeddedView = dmMember ? "chat" : channelView;
  const timelineScrollTarget = `${activeTargetId}:${currentSessionId ?? "default"}`;
  const detailTitle = dmMember ? activeSession?.title.trim() || messages.chat.newSession : stripChannelHash(activeChannel.name);
  const detailAriaLabel = dmMember ? detailTitle : `# ${detailTitle}`;
  const detailSubtitle = dmMember
    ? `${dmMember.name} ｜ ${formatConversationDateTime(activeSession?.createdAt ?? activeConversation?.createdAt ?? "")}`
    : activeChannel.projectName ? messages.chat.projectPrefix(activeChannel.projectName) : activeChannel.description;
  const sessionBusy = Boolean(activeConversation && visibleMessages.some((message) => message.status === "running" || message.status === "pending"));
  const sendDisabled = Boolean((!draft.trim() && attachments.length === 0) || sessionBusy || sending || submitting);

  useEffect(() => {
    setChannelView(initialChannelView ?? "chat");
  }, [activeChannel.id, activeConversation?.id, initialChannelView]);

  useEffect(() => {
    if (!focusedMessageId || typeof document === "undefined") return;
    const target = document.querySelector<HTMLElement>(`[data-message-id="${escapeAttributeSelector(focusedMessageId)}"]`);
    if (!target) return;
    target.scrollIntoView({ block: "center" });
    target.focus({ preventScroll: true });
    setHighlightedMessageId(focusedMessageId);
    const timer = window.setTimeout(() => setHighlightedMessageId(undefined), 2200);
    return () => window.clearTimeout(timer);
  }, [focusedMessageId, visibleMessages.length]);

  useEffect(() => {
    if (!mention || mentionTargets.length === 0) return;
    mentionOptionRefs.current[selectedMentionIndex]?.scrollIntoView({ block: "nearest" });
  }, [mention, mentionTargets.length, selectedMentionIndex]);

  useEffect(() => {
    if (effectiveChannelView !== "chat" || focusedMessageId) return;
    if (initialTimelineScrollTargetRef.current === timelineScrollTarget) return;
    initialTimelineScrollTargetRef.current = timelineScrollTarget;
    pendingScrollToBottomRef.current = true;
  }, [timelineScrollTarget, effectiveChannelView, focusedMessageId]);

  useEffect(() => {
    if (!pendingScrollToBottomRef.current) return;
    if (timelineMessages.length === 0) return;
    pendingScrollToBottomRef.current = false;
    const frame = window.requestAnimationFrame(() => {
      timelineEndRef.current?.scrollIntoView({ block: "end" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [timelineMessages.length, timelineScrollTarget, effectiveChannelView]);

  async function submitMessage() {
    if (sendDisabled) return;
    setSubmitting(true);
    try {
      const sendFailureToast = onSendFailure ?? showToast;
      const result = await submitComposerDraftWithFeedback({
        draft,
        asTask: allowAsTask ? asTask : false,
        attachments,
        sessionId: currentSessionId,
        sendFailedMessage: messages.chat.sendFailed,
        onSendFailure: (message) => sendFailureToast(message, "error"),
        onSendMessage,
      });
      if (result.sent) {
        pendingScrollToBottomRef.current = true;
        setDraft(result.draft);
        setAttachments(result.attachments);
        setAsTask(result.asTask);
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function addFiles(fileList: FileList | null) {
    if (!fileList) return;
    const files = Array.from(fileList);
    const uploaded = await Promise.all(files.map((file) => uploadComposerFile(file, onAttachmentUpload)));
    setAttachments((current) => [...current, ...uploaded.filter((attachment): attachment is ConversationAttachmentView => Boolean(attachment))]);
  }

  function selectMention(index = selectedMentionIndex) {
    if (!mention || !mentionTargets[index]) return;
    setDraft(insertMention(draft, mention, mentionTargets[index].handle));
    setSelectedMentionIndex(0);
  }

  async function copyMessage(message: SleiMessage) {
    const copied = await copyMessageBody(message.body);
    if (!copied) return;
    showToast(messages.chat.copySuccess, "success");
  }

  async function copyChannelTitle() {
    const copied = await copyMessageBody(detailTitle);
    if (!copied) return;
    showToast(messages.chat.copySuccess, "success");
  }

  function showToast(message: string, type: ToastType = "info") {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({ message, type });
    toastTimerRef.current = setTimeout(() => setToast((current) => ({ ...current, message: "" })), TOAST_VISIBLE_MS);
  }

  function openTaskThread(taskId: string) {
    setSelectedTaskId(taskId);
    void Promise.resolve(onTaskThreadOpen?.(taskId)).catch(() => undefined);
  }

  return (
    <section className="relative grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] bg-background" data-slot="chat-page">
      <Toast message={toast.message} type={toast.type} />
      <header className="flex min-h-16 items-center justify-between gap-3 border-b bg-background/95 px-4 py-3">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-1.5">
            <div className="min-w-0" data-slot="workspace-titlebar" data-tauri-drag-region="deep">
              <h1 aria-label={detailAriaLabel} className="flex min-w-0 items-center gap-2 text-xl font-semibold">
                {dmMember ? <MessageCircle aria-hidden="true" size={20} /> : <Hash aria-hidden="true" size={20} />}
                <span className={cn("truncate", !dmMember && "select-none")}>{detailTitle}</span>
              </h1>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">{detailSubtitle}</p>
            </div>
            {!dmMember ? (
              <Button aria-label={messages.chat.copyMessage} onClick={() => void copyChannelTitle()} size="icon-xs" title={messages.chat.copyMessage} type="button" variant="ghost">
                <Copy aria-hidden="true" size={14} />
              </Button>
            ) : null}
          </div>
        </div>
        {dmMember && activeConversation ? (
          <div className="flex shrink-0 items-center gap-2">
            <Button onClick={() => onConversationNewSession?.(activeConversation.id)} size="sm" type="button" variant="outline">
              <Plus aria-hidden="true" size={14} />{messages.chat.newSession}
            </Button>
            <Button onClick={onConversationHistoryToggle} size="sm" type="button" variant="outline">
              <History aria-hidden="true" size={14} />{messages.chat.history}
            </Button>
          </div>
        ) : (
          <div className="flex shrink-0 items-center gap-2">
            <Tabs className="shrink-0" onValueChange={(value) => setChannelView(value as ChannelEmbeddedView)} value={effectiveChannelView}>
              <TabsList aria-label={messages.chat.channelView}>
                <TabsTrigger aria-current={effectiveChannelView === "chat" ? "page" : undefined} value="chat"><MessageCircle aria-hidden="true" size={14} />{messages.shell.nav.chat}</TabsTrigger>
                <TabsTrigger aria-current={effectiveChannelView === "tasks" ? "page" : undefined} value="tasks"><CheckSquare aria-hidden="true" size={14} />{messages.chat.tasks}</TabsTrigger>
                <TabsTrigger aria-current={effectiveChannelView === "files" ? "page" : undefined} value="files"><FileText aria-hidden="true" size={14} />{messages.chat.files}</TabsTrigger>
              </TabsList>
            </Tabs>
            <Button onClick={() => onChannelNewSession?.(activeChannel.id)} size="sm" type="button" variant="outline">
              <Plus aria-hidden="true" size={14} />{messages.chat.newSession}
            </Button>
            <Button onClick={onConversationHistoryToggle} size="sm" type="button" variant="outline">
              <History aria-hidden="true" size={14} />{messages.chat.history}
            </Button>
          </div>
        )}
      </header>
      {!dmMember ? (
        <Button
          aria-expanded={channelMembersOpen ? "true" : "false"}
          aria-label={messages.chat.channelMembers}
          className={cn(
            "absolute top-[20%] z-30 h-12 w-8 rounded-r-none rounded-l-md border-r-0 shadow-sm transition-[right,background-color,color] duration-200 ease-out active:!translate-y-0",
            channelMembersOpen ? "right-[min(20rem,calc(100%-2rem))]" : "right-0 bg-popover text-popover-foreground",
          )}
          data-testid="slei-channel-members-edge-toggle"
          onClick={() => setChannelMembersOpen((current) => !current)}
          title={messages.chat.channelMembers}
          type="button"
          variant={channelMembersOpen ? "outline" : "secondary"}
        >
          <Users aria-hidden="true" size={15} />
        </Button>
      ) : null}
      {!dmMember ? (
        <ChannelMemberPanel
          availableMembers={availableChannelMembers}
          channelId={activeChannel.id}
          members={channelMembers}
          messages={messages}
          open={channelMembersOpen}
          onAdd={onChannelMemberAdd}
          onRemove={onChannelMemberRemove}
        />
      ) : null}
      <Sheet
        onOpenChange={(open) => {
          if (!open && sessionDrawerOpen) onConversationHistoryToggle?.();
        }}
        open={Boolean(sessionDrawerOpen && (activeConversation || activeChannel))}
      >
        <SheetContent aria-label={messages.chat.history} className="w-80 p-0" showCloseButton={false}>
          <SheetHeader className="flex-row items-center justify-between border-b">
            <SheetTitle>{messages.chat.history}</SheetTitle>
            <SheetClose asChild>
              <Button aria-label={messages.common.cancel} size="icon-sm" type="button" variant="ghost"><X aria-hidden="true" size={14} /></Button>
            </SheetClose>
          </SheetHeader>
          <ScrollArea className="min-h-0 flex-1 px-3">
            <div className="grid gap-1 py-3">
              {sortedActiveSessions.length > 0
                ? sortedActiveSessions.map((session) => (
                    <Button
                      aria-current={session.id === currentSessionId ? "true" : undefined}
                      className={cn("h-auto w-full justify-start overflow-hidden px-3 py-2 text-left", session.id === currentSessionId && "bg-accent text-accent-foreground")}
                      key={session.id}
                      onClick={() => activeConversation ? onConversationSessionSelect?.(activeConversation.id, session.id) : onChannelSessionSelect?.(activeChannel.id, session.id)}
                      type="button"
                      variant="ghost"
                    >
                      <span className="grid min-w-0 flex-1 gap-0.5">
                        <strong className="block truncate">{session.title || messages.chat.newSession}</strong>
                        <small className="truncate text-xs font-normal text-muted-foreground">{formatConversationDateTime(session.createdAt)}</small>
                      </span>
                    </Button>
                  ))
                : null}
            </div>
          </ScrollArea>
        </SheetContent>
      </Sheet>
      {sessionDrawerOpen && (activeConversation || activeChannel) ? (
        <aside aria-label={messages.chat.history} data-slot="sheet-ssr-fallback" hidden>
          <h2>{messages.chat.history}</h2>
          {sortedActiveSessions.map((session) => (
            <button
              aria-current={session.id === currentSessionId ? "true" : undefined}
              className="overflow-hidden text-left"
              key={session.id}
              onClick={() => activeConversation ? onConversationSessionSelect?.(activeConversation.id, session.id) : onChannelSessionSelect?.(activeChannel.id, session.id)}
              type="button"
            >
              <strong className="block truncate">{session.title || messages.chat.newSession}</strong>
              <small className="block truncate">{formatConversationDateTime(session.createdAt)}</small>
            </button>
          ))}
        </aside>
      ) : null}
      {effectiveChannelView === "chat" ? (
        <ScrollArea className="min-h-0" data-testid="slei-chat-timeline">
          <div className="grid gap-1 px-4 py-3">
            {timelineMessages.map((message) => {
              const sourceTask = message.task && message.task.channelId === activeChannel.id && message.task.sourceMessageId === message.id
                ? message.task
                : taskBySourceMessageId.get(message.id);
              if (sourceTask) {
                const saved = savedMessageIds.includes(message.id);
                const saveLabel = saved ? messages.chat.unsaveMessage : messages.chat.saveMessage;
                const timestamp = messageTimestampLabel(message);
                return (
                  <TaskRootEntry
                    copyLabel={messages.chat.copyMessage}
                    key={message.id}
                    messages={messages}
                    onCopy={() => copyMessage(message)}
                    onOpen={() => openTaskThread(sourceTask.id)}
                    onSaveToggle={() => onMessageSaveToggle?.(message)}
                    avatarIdentity={memberFromMessage(message, data.members)}
                    roleDescription={messageRoleDescription(message, data.members, messages)}
                    saved={saved}
                    saveLabel={saveLabel}
                    sourceMessage={message}
                    task={sourceTask}
                    timestamp={timestamp}
                  />
                );
              }
              const saved = savedMessageIds.includes(message.id);
              const saveLabel = saved ? messages.chat.unsaveMessage : messages.chat.saveMessage;
              const timestamp = messageTimestampLabel(message);
              return (
                <article
                  className="group grid grid-cols-[auto_minmax(0,1fr)] gap-3 rounded-lg px-2 py-2 text-sm transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[focused=true]:bg-primary/5 data-[focused=true]:ring-1 data-[focused=true]:ring-primary/25"
                  data-focused={highlightedMessageId === message.id ? "true" : undefined}
                  data-message-id={message.id}
                  key={message.id}
                  tabIndex={focusedMessageId === message.id ? -1 : undefined}
                >
                  <MemberAvatar identity={memberFromMessage(message, data.members)} />
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center justify-between gap-2">
                      <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden whitespace-nowrap text-xs text-muted-foreground">
                        <strong className="shrink-0 text-sm text-foreground">{message.author}</strong>
                        {message.handle ? <span className="shrink-0">{message.handle}</span> : null}
                        <span aria-hidden="true">｜</span>
                        <span className="min-w-0 flex-1 truncate">{messageRoleDescription(message, data.members, messages)}</span>
                      </div>
                      <div className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground" data-slot="message-actions">
                        <Button aria-label={messages.chat.copyMessage} onClick={() => void copyMessage(message)} size="icon-xs" title={messages.chat.copyMessage} type="button" variant="ghost">
                          <Copy aria-hidden="true" size={14} />
                        </Button>
                        <Button aria-label={saveLabel} aria-pressed={saved ? "true" : "false"} onClick={() => void onMessageSaveToggle?.(message)} size="icon-xs" title={saveLabel} type="button" variant="ghost">
                          <Bookmark aria-hidden="true" size={14} />
                        </Button>
                        <span aria-hidden="true">｜</span>
                        <span className="inline-flex items-center gap-1">
                          <time className="whitespace-nowrap tabular-nums" dateTime={timestamp}>
                            {timestamp}
                          </time>
                          <MessageStatusSquare status={message.status} />
                        </span>
                      </div>
                    </div>
                    <MarkdownMessage markdown={message.body} />
                    <AttachmentList attachments={message.attachments ?? []} messageAttachments />
                    {message.toolCall ? <code className="mt-2 block rounded-md border bg-muted px-2 py-1 font-mono text-xs text-muted-foreground" data-slot="tool-call">{message.toolCall}</code> : null}
                    {message.cards?.map((card) => (
                      <InteractiveCard
                        card={card}
                        key={card.id}
                        messages={messages}
                        onCreate={() => {
                          if (card.kind === "createAgent") {
                            onAgentDraftCreate?.(card.draft as Partial<AgentDraftInput>, card.id);
                          } else if (card.kind === "createChannel") {
                            onChannelDraftCreate?.(card.draft, card.id);
                          }
                        }}
                        onPermissionResolve={onPermissionResolve}
                      />
                    ))}
                  </div>
                </article>
              );
            })}
            <div ref={timelineEndRef} />
          </div>
        </ScrollArea>
      ) : effectiveChannelView === "tasks" ? (
        <ChannelTaskList messages={messages} onTaskThreadOpen={onTaskThreadOpen} tasks={channelTasks} />
      ) : (
        <ChannelFileList files={channelFiles} messages={messages} />
      )}
      <TaskThreadDrawer
        messages={messages}
        onClose={() => setSelectedTaskId(undefined)}
        onReply={onTaskReply}
        onStatusChange={onTaskStatusChange}
        mentionMembers={data.members}
        open={Boolean(selectedTask)}
        task={selectedTask}
      />
      {effectiveChannelView === "chat" ? (
        <footer className="border-t bg-background/95">
          {mention && mentionTargets.length > 0 ? (
            <div className="px-4 pt-3">
              <MentionPicker
                members={mentionTargets}
                messages={messages}
                onSelect={selectMention}
                optionRef={(index, node) => {
                  mentionOptionRefs.current[index] = node;
                }}
                selectedIndex={selectedMentionIndex}
              />
            </div>
          ) : null}
          <form className="grid gap-2 px-4 py-3" onSubmit={(event) => { event.preventDefault(); void submitMessage(); }}>
            {attachments.length > 0 ? (
              <AttachmentList
                attachments={attachments}
                onRemove={(attachmentId) => setAttachments((current) => current.filter((attachment) => attachment.id !== attachmentId))}
              />
            ) : null}
            <Textarea
              aria-label={dmMember ? messages.chat.inputToMember(dmMember.name) : messages.chat.inputToChannel(stripChannelHash(activeChannel.name))}
              className="min-h-20 resize-none"
              data-testid="slei-composer-input"
              onChange={(event) => setDraft(event.currentTarget.value)}
              onCompositionEnd={() => setIsComposing(false)}
              onCompositionStart={() => setIsComposing(true)}
              onKeyDown={(event) => {
                const composing = isComposerImeComposing({ composing: isComposing, nativeEvent: event.nativeEvent });
                const hasMentionTargets = Boolean(mention && mentionTargets.length > 0);
                if (!composing && mention && mentionTargets.length > 0) {
                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    setSelectedMentionIndex((current) => moveMentionSelection(current, 1, mentionTargets.length));
                    return;
                  }
                  if (event.key === "ArrowUp") {
                    event.preventDefault();
                    setSelectedMentionIndex((current) => moveMentionSelection(current, -1, mentionTargets.length));
                    return;
                  }
                  if (event.key === "Escape") {
                    event.preventDefault();
                    setDraft(draft.slice(0, mention.start));
                    return;
                  }
                }
                const action = composerShortcutAction({ key: event.key, shiftKey: event.shiftKey, composing, hasMentionTargets });
                if (action === "selectMention") {
                  event.preventDefault();
                  selectMention();
                  return;
                }
                if (action === "submit") {
                  event.preventDefault();
                  void submitMessage();
                }
              }}
              placeholder={dmMember ? messages.chat.inputToMember(dmMember.name) : messages.chat.inputToChannel(stripChannelHash(activeChannel.name))}
              value={draft}
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
              {allowAsTask ? (
                <label className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                  <Checkbox checked={asTask} onCheckedChange={(checked) => setAsTask(checked === true)} />
                  <span>{messages.chat.asTask}</span>
                </label>
              ) : <span />}
              <div className="flex items-center gap-2">
                <input accept="image/*" hidden onChange={(event) => void addFiles(event.currentTarget.files)} ref={imageInputRef} type="file" />
                <input hidden onChange={(event) => void addFiles(event.currentTarget.files)} ref={fileInputRef} type="file" />
                <Button aria-label={messages.common.addImage} onClick={() => imageInputRef.current?.click()} size="icon-sm" type="button" variant="ghost"><ImageIcon aria-hidden="true" size={15} /></Button>
                <Button aria-label={messages.common.addAttachment} onClick={() => fileInputRef.current?.click()} size="icon-sm" type="button" variant="ghost"><Paperclip aria-hidden="true" size={15} /></Button>
                <Button data-testid="slei-send-button" disabled={sendDisabled} type="submit"><Send aria-hidden="true" size={15} />{messages.common.send}</Button>
              </div>
            </div>
          </form>
        </footer>
      ) : null}
    </section>
  );
}

function escapeAttributeSelector(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
}
