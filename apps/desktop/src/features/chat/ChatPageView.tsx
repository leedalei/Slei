import { useEffect, useRef, useState } from "react";
import { Bookmark, CheckSquare, Copy, FileText, Hash, History, Image as ImageIcon, MessageCircle, Paperclip, Plus, Send, X } from "lucide-react";

import type { DesktopMessages } from "../../i18n";
import type { ConversationAttachmentUploadRequest, ConversationAttachmentView, ConversationView, InteractiveCardView, PermissionDecision } from "../../lib/daemon-bridge";
import type { SleiFixtures, SleiMember, SleiMessage } from "../../app/fixtures";
import { MarkdownMessage } from "./MarkdownMessage";
import { activeMentionQuery, composerShortcutAction, filterConversationMessages, formatMessageTime, insertMention, isComposerImeComposing, mentionSuggestions, moveMentionSelection, stripChannelHash, submitComposerDraftWithFeedback, type AgentDraftInput, type UserProfile } from "../../app/model";
import { MemberAvatar, memberFromMessage, MessageStatusSquare, StatusDot, Toast, TOAST_VISIBLE_MS } from "../../components";
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

function ChannelTaskList({ messages, tasks }: { messages: DesktopMessages; tasks: SleiFixtures["tasks"] }) {
  const [selectedTaskId, setSelectedTaskId] = useState(tasks[0]?.id);
  const selectedTask = tasks.find((task) => task.id === selectedTaskId) ?? tasks[0];
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
              onClick={() => setSelectedTaskId(task.id)}
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
  const raw = value.trim();
  if (!raw) return "";
  const direct = raw.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})/);
  if (direct) return `${direct[1]} ${direct[2]}`;

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
  return date.toISOString().slice(0, 19).replace("T", " ");
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

export function ChatPage({ activeChannel, activeConversation, activeSessionId, data, focusedMessageId, initialAttachments, initialChannelView, initialDraft, messages, onAgentDraftCreate, onAttachmentUpload, onChannelDraftCreate, onConversationHistoryToggle, onConversationNewSession, onConversationSessionSelect, onMessageSaveToggle, onPermissionResolve, onSendMessage, profile, savedMessageIds = [], sending, sessionDrawerOpen }: { activeChannel: SleiFixtures["channels"][number]; activeConversation?: ConversationView; activeSessionId?: string; data: SleiFixtures; focusedMessageId?: string; initialAttachments?: ConversationAttachmentView[]; initialChannelView?: ChannelEmbeddedView; initialDraft?: string; messages: DesktopMessages; onAgentDraftCreate?: (draft: Partial<AgentDraftInput>, cardId?: string) => void; onAttachmentUpload?: (request: ConversationAttachmentUploadRequest) => Promise<{ attachment: ConversationAttachmentView }>; onChannelDraftCreate?: (draft: Record<string, unknown>, cardId?: string) => void; onConversationHistoryToggle?: () => void; onConversationNewSession?: (conversationId: string) => Promise<void> | void; onConversationSessionSelect?: (conversationId: string, sessionId: string) => Promise<void> | void; onMessageSaveToggle?: (message: SleiMessage) => Promise<void> | void; onPermissionResolve?: (requestId: string, decision: PermissionDecision) => Promise<void> | void; onSendMessage?: (body: string, options?: { asTask?: boolean; attachmentIds?: string[]; sessionId?: string }) => Promise<void> | void; profile: UserProfile; savedMessageIds?: string[]; sending?: boolean; sessionDrawerOpen?: boolean }) {
  const [draft, setDraft] = useState(initialDraft ?? "");
  const [asTask, setAsTask] = useState(false);
  const [attachments, setAttachments] = useState<ConversationAttachmentView[]>(initialAttachments ?? []);
  const [channelView, setChannelView] = useState<ChannelEmbeddedView>(initialChannelView ?? "chat");
  const [isComposing, setIsComposing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [selectedMentionIndex, setSelectedMentionIndex] = useState(0);
  const [toastMessage, setToastMessage] = useState("");
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | undefined>(focusedMessageId);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const mentionOptionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const mention = activeMentionQuery(draft);
  const mentionTargets = mention ? mentionSuggestions(mention.query, data.members) : [];
  const dmMember = activeConversation?.kind === "dm" ? data.members.find((member) => member.id === activeConversation.agentId) : undefined;
  const activeTargetId = activeConversation?.id ?? activeChannel.id;
  const currentSessionId = activeSessionId ?? activeConversation?.activeSessionId;
  const visibleMessages = filterConversationMessages(data.messages, {
    channel: activeTargetId,
  }).filter((message) => {
    if (!activeConversation) return true;
    if (!currentSessionId) return false;
    return message.sessionId === currentSessionId;
  });
  const timelineMessages = visibleMessages.filter((message) => !isTransientAgentActivity(message));
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
  const channelTasks = data.tasks.filter((task) => task.channelId === activeChannel.id);
  const activeSessions = activeConversation ? data.conversationSessions.filter((session) => session.conversationId === activeConversation.id) : [];
  const sortedActiveSessions = [...activeSessions].sort((left, right) => sessionCreatedTime(right) - sessionCreatedTime(left));
  const activeSession = activeSessions.find((session) => session.id === currentSessionId) ?? sortedActiveSessions[0];
  const allowAsTask = !dmMember;
  const effectiveChannelView: ChannelEmbeddedView = dmMember ? "chat" : channelView;
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

  async function submitMessage() {
    if (sendDisabled) return;
    setSubmitting(true);
    try {
      const result = await submitComposerDraftWithFeedback({
        draft,
        asTask: allowAsTask ? asTask : false,
        attachments,
        sessionId: currentSessionId,
        sendFailedMessage: messages.chat.sendFailed,
        onSendFailure: showToast,
        onSendMessage,
      });
      if (result.sent) {
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
    showToast(messages.chat.copySuccess);
  }

  function showToast(message: string) {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToastMessage(message);
    toastTimerRef.current = setTimeout(() => setToastMessage(""), TOAST_VISIBLE_MS);
  }

  return (
    <section className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] bg-background" data-slot="chat-page">
      <Toast message={toastMessage} />
      <header className="flex min-h-16 items-center justify-between gap-3 border-b bg-background/95 px-4 py-3">
        <div className="min-w-0">
          <h1 aria-label={detailAriaLabel} className="flex min-w-0 items-center gap-2 text-base font-semibold">
            {dmMember ? <MessageCircle aria-hidden="true" size={20} /> : <Hash aria-hidden="true" size={20} />}
            <span className="truncate">{detailTitle}</span>
          </h1>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{detailSubtitle}</p>
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
          <Tabs className="shrink-0" onValueChange={(value) => setChannelView(value as ChannelEmbeddedView)} value={effectiveChannelView}>
            <TabsList aria-label={messages.chat.channelView}>
              <TabsTrigger aria-current={effectiveChannelView === "chat" ? "page" : undefined} value="chat"><MessageCircle aria-hidden="true" size={14} />{messages.shell.nav.chat}</TabsTrigger>
              <TabsTrigger aria-current={effectiveChannelView === "tasks" ? "page" : undefined} value="tasks"><CheckSquare aria-hidden="true" size={14} />{messages.chat.tasks}</TabsTrigger>
              <TabsTrigger aria-current={effectiveChannelView === "files" ? "page" : undefined} value="files"><FileText aria-hidden="true" size={14} />{messages.chat.files}</TabsTrigger>
            </TabsList>
          </Tabs>
        )}
      </header>
      <Sheet
        onOpenChange={(open) => {
          if (!open && sessionDrawerOpen) onConversationHistoryToggle?.();
        }}
        open={Boolean(sessionDrawerOpen && activeConversation)}
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
              {activeConversation
                ? sortedActiveSessions.map((session) => (
                    <Button
                      aria-current={session.id === currentSessionId ? "true" : undefined}
                      className={cn("h-auto w-full justify-start overflow-hidden px-3 py-2 text-left", session.id === currentSessionId && "bg-accent text-accent-foreground")}
                      key={session.id}
                      onClick={() => onConversationSessionSelect?.(activeConversation.id, session.id)}
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
      {sessionDrawerOpen && activeConversation ? (
        <aside aria-label={messages.chat.history} data-slot="sheet-ssr-fallback" hidden>
          <h2>{messages.chat.history}</h2>
          {sortedActiveSessions.map((session) => (
            <button
              aria-current={session.id === currentSessionId ? "true" : undefined}
              className="overflow-hidden text-left"
              key={session.id}
              onClick={() => onConversationSessionSelect?.(activeConversation.id, session.id)}
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
              const saved = savedMessageIds.includes(message.id);
              const saveLabel = saved ? messages.chat.unsaveMessage : messages.chat.saveMessage;
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
                    <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
                      <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                        <strong className="text-sm text-foreground">{message.author}</strong>
                        {message.handle ? <span>{message.handle}</span> : null}
                        <span aria-hidden="true">｜</span>
                        <span>{messageRoleDescription(message, data.members, messages)}</span>
                      </div>
                      <div className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                        <Button aria-label={messages.chat.copyMessage} onClick={() => void copyMessage(message)} size="icon-xs" title={messages.chat.copyMessage} type="button" variant="ghost">
                          <Copy aria-hidden="true" size={14} />
                        </Button>
                        <Button aria-label={saveLabel} aria-pressed={saved ? "true" : "false"} onClick={() => void onMessageSaveToggle?.(message)} size="icon-xs" title={saveLabel} type="button" variant="ghost">
                          <Bookmark aria-hidden="true" size={14} />
                        </Button>
                        <span aria-hidden="true">｜</span>
                        <span className="inline-flex items-center gap-1">
                          <time>{message.time}</time>
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
          </div>
        </ScrollArea>
      ) : effectiveChannelView === "tasks" ? (
        <ChannelTaskList messages={messages} tasks={channelTasks} />
      ) : (
        <ChannelFileList files={channelFiles} messages={messages} />
      )}
      {effectiveChannelView === "chat" ? (
        <footer className="border-t bg-background/95">
          {mention && mentionTargets.length > 0 ? (
            <Card aria-label={messages.chat.chooseMentionMember} className="mx-4 mt-3 max-h-[12.5rem] gap-2 overflow-hidden py-2" data-testid="slei-mention-panel" size="sm">
              <CardContent className="grid min-h-0 gap-1 px-2">
                <ScrollArea className="max-h-[10.5rem] min-h-0 pr-2">
                  <div className="grid gap-1">
                    {mentionTargets.map((member, index) => (
                      <Button
                        aria-current={index === selectedMentionIndex ? "true" : undefined}
                        className={cn("h-auto min-h-12 justify-start gap-2 px-2 py-2 text-left", index === selectedMentionIndex && "bg-accent text-accent-foreground")}
                        data-mention-option-index={index}
                        key={member.id}
                        onClick={() => selectMention(index)}
                        ref={(node) => {
                          mentionOptionRefs.current[index] = node;
                        }}
                        type="button"
                        variant="ghost"
                      >
                        <MemberAvatar identity={member} />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2">
                            <strong className="text-sm">{member.name}</strong>
                            <StatusDot status={member.runtimeStatus} />
                          </span>
                          <small className="block truncate text-xs font-normal text-muted-foreground">{member.role}</small>
                        </span>
                        <span className="text-xs font-normal text-muted-foreground">{member.handle}</span>
                      </Button>
                    ))}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
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
