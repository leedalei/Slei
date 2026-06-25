import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

import type { DesktopMessages } from "../../i18n";
import type { ConversationAttachmentUploadRequest, ConversationAttachmentView, ConversationView, InteractiveCardView, PermissionDecision } from "../../lib/daemon-bridge";
import type { SleiFixtures, SleiMember, SleiMessage } from "../../app/types";
import { MarkdownMessage, markdownForegroundStyle } from "./MarkdownMessage";
import { activeMentionQuery, activeSkillSlashQuery, composerShortcutAction, filterConversationMessages, formatLocalRecordDateTime, insertMention, insertSkillSlash, isComposerImeComposing, leadingSkillSlashToken, mentionSuggestions, moveMentionSelection, skillSlashSuggestions, stripChannelHash, submitComposerDraftWithFeedback, type AgentDraftInput, type UserProfile } from "../../app/model";
import { Empty, MemberAvatar, memberFromMessage, MessageStatusSquare, SelectableCard, SleiIcon, SleiIconSwap, Toast, TOAST_VISIBLE_MS, TooltipButton, type ToastType } from "../../components";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";
import { Checkbox } from "../../components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "../../components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "../../components/ui/alert-dialog";
import { Popover, PopoverContent, PopoverTrigger } from "../../components/ui/popover";
import { ScrollArea } from "../../components/ui/scroll-area";
import { Separator } from "../../components/ui/separator";
import { Tabs, TabsList, TabsTrigger } from "../../components/ui/tabs";
import { Textarea } from "../../components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../components/ui/tooltip";
import { cn } from "../../lib/utils";
import { TaskThreadDrawer } from "../tasks/TaskThreadDrawer";
import { MentionPicker } from "./MentionPicker";
import { SkillSlashPicker } from "./SkillSlashPicker";
import { TaskRootEntry } from "./TaskRootEntry";

export type ChannelEmbeddedView = "chat" | "tasks" | "files";

const SCROLL_TO_BOTTOM_BUTTON_THRESHOLD_PX = 200;
const HISTORY_LOAD_SCROLL_TOP_THRESHOLD_PX = 48;
const TIMELINE_VIRTUALIZATION_THRESHOLD = 50;
const COMPOSER_RESERVE_PX = 184;
const COMPOSER_EXPANDED_RESERVE_PX = 256;
const CARD_SURFACE_CLASS = "rounded-xl border-border/60 bg-card text-card-foreground shadow-none backdrop-blur-none before:hidden after:hidden";
const CARD_FLAT_CLASS = "rounded-lg border-transparent bg-transparent text-card-foreground shadow-none backdrop-blur-none before:hidden after:hidden";
const MESSAGE_ROW_CLASS = "group grid grid-cols-[auto_minmax(0,1fr)] gap-3 rounded-lg border border-transparent bg-transparent px-2 py-2 text-card-foreground transition-colors hover:border-border/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[focused=true]:border-primary/35";

type ChatComposerReserveStyle = CSSProperties & {
  "--chat-composer-reserve": string;
};

type ChannelFileEntry = {
  attachment: ConversationAttachmentView;
  author: string;
  messageId: string;
  time: string;
};

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

function formatToastError(prefix: string, error: unknown) {
  const detail = error instanceof Error ? error.message.trim() : String(error ?? "").trim();
  return detail ? `${prefix}：${detail}` : prefix;
}

function InteractiveCard({ card, messages, onCreate, onPermissionResolve }: { card: InteractiveCardView; messages: DesktopMessages; onCreate?: () => void; onPermissionResolve?: (requestId: string, decision: PermissionDecision) => Promise<void> | void }) {
  if (card.kind === "permissionApproval") {
    const done = card.state !== "pending";
    const requestId = typeof card.draft.requestId === "string" ? card.draft.requestId : "";
    const targetPath = typeof card.draft.targetPath === "string" ? card.draft.targetPath : card.summary;
    const toolName = typeof card.draft.toolName === "string" ? card.draft.toolName : "Write";
    return (
      <Card className={cn(CARD_SURFACE_CLASS, "mt-2 grid gap-2 border-amber-500/30 bg-amber-500/5 p-3")} data-card-kind={card.kind} data-state={card.state}>
        <div className="flex flex-wrap items-center gap-2 font-medium">
          <Badge variant="outline" className="border-amber-500/40 text-amber-700 dark:text-amber-300">权限申请</Badge>
          <span>{card.title}</span>
        </div>
        <div className="space-y-1 text-sm text-muted-foreground">
          <p>{toolName} 需要写入工作区外路径：{targetPath}</p>
          <p className="text-xs">仅影响当前会话；新会话会重新申请。</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button disabled={done || !requestId} onClick={() => onPermissionResolve?.(requestId, "approve_once")} size="sm" type="button" variant="primary">
            允许一次
          </Button>
          <Button disabled={done || !requestId} onClick={() => onPermissionResolve?.(requestId, "approve_session")} size="sm" type="button" variant="outline">
            本会话始终允许
          </Button>
          <Button disabled={done || !requestId} onClick={() => onPermissionResolve?.(requestId, "deny")} size="sm" type="button" variant="destructive">
            拒绝
          </Button>
        </div>
      </Card>
    );
  }
  const done = card.state !== "pending";
  const doneLabel = card.doneLabel === "DONE" ? messages.common.done : card.doneLabel || messages.common.done;
  return (
    <Card className={cn(CARD_SURFACE_CLASS, "mt-2 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-primary/20 p-3")} data-card-kind={card.kind} data-state={card.state}>
      <div className="grid min-w-0 gap-1">
        <strong className="text-sm">{card.title}</strong>
        <p className="truncate text-xs text-muted-foreground">{card.summary}</p>
      </div>
      <Button disabled={done} onClick={onCreate} size="xs" type="button" variant="primary">
        {done ? doneLabel : card.actionLabel || messages.common.create}
      </Button>
    </Card>
  );
}

function MessageRow({
  children,
  className,
  focused,
  messageId,
  tabIndex,
}: {
  children: ReactNode;
  className?: string;
  focused?: boolean;
  messageId: string;
  tabIndex?: number;
}) {
  return (
    <article
      className={cn(MESSAGE_ROW_CLASS, className)}
      data-focused={focused ? "true" : undefined}
      data-message-id={messageId}
      data-slot="message-row"
      tabIndex={tabIndex}
    >
      {children}
    </article>
  );
}

function AttachmentList({ attachments, messageAttachments = false, onRemove }: { attachments: ConversationAttachmentView[]; messageAttachments?: boolean; onRemove?: (attachmentId: string) => void }) {
  if (attachments.length === 0) return null;
  return (
    <div className={cn("flex flex-wrap gap-2 overflow-visible", messageAttachments ? "mt-2" : "")} data-message-attachments={messageAttachments ? "true" : undefined} data-slot="attachment-list">
      {attachments.map((attachment) => {
        const isImage = attachment.mimeType.startsWith("image/");
        return (
          <Badge className="h-auto max-w-full gap-1.5 rounded-md px-2 py-1 text-xs" key={attachment.id} variant="outline">
            {isImage && attachment.url ? <img alt="" className="size-7 rounded object-cover" src={attachment.url} /> : <SleiIcon name="fileText" size={14} />}
            <span className="max-w-48 truncate">{attachment.name}</span>
            <small className="text-muted-foreground">{formatAttachmentSize(attachment.size)}</small>
            {onRemove ? (
              <Button aria-label={`Remove ${attachment.name}`} className="-mr-1" onClick={() => onRemove(attachment.id)} size="icon-xs" type="button" variant="ghost">
                <SleiIcon name="x" size={12} />
              </Button>
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
    return (
      <section className="grid h-full min-h-0 place-items-center overflow-hidden p-6">
        <Empty
          centered
          framed={false}
          title={messages.chat.channelTaskEmpty}
          variant="nodata"
        />
      </section>
    );
  }

  return (
    <section aria-label={messages.chat.tasks} className="grid h-full min-h-0 grid-cols-[minmax(14rem,20rem)_minmax(0,1fr)] gap-3 overflow-hidden p-4 max-[820px]:grid-cols-1">
      <ScrollArea className="h-full min-h-0 rounded-lg border bg-card/40">
        <div className="grid gap-1 p-2">
          {tasks.map((task) => (
            <SelectableCard asChild key={task.id} selected={selectedTask?.id === task.id}>
              <Button
                aria-current={selectedTask?.id === task.id ? "true" : undefined}
                className="h-auto min-h-16 justify-start whitespace-normal px-3 py-2 text-left text-inherit hover:text-inherit"
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
            </SelectableCard>
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
    return (
      <section className="grid min-h-0 place-items-center p-6">
        <Empty
          centered
          framed={false}
          title={messages.chat.channelFileEmpty}
          variant="nodata"
        />
      </section>
    );
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
                <span className="grid size-10 place-items-center rounded-md bg-muted text-muted-foreground"><SleiIcon name="fileText" size={16} /></span>
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

function MessageBody({ body, skillToken }: { body: string; skillToken?: ReturnType<typeof leadingSkillSlashToken> }) {
  if (!skillToken) {
    return <MarkdownMessage markdown={body} tone="card" />;
  }
  const rest = skillToken.rest;
  const inlineRest = rest && !rest.startsWith("\n") && !rest.startsWith("\r");
  return (
    <div
      className={cn("slei-markdown-message mt-1 max-w-none text-sm leading-relaxed text-card-foreground", inlineRest && "[&>.slei-markdown-message]:mt-0 [&>.slei-markdown-message]:inline [&>.slei-markdown-message>p:first-child]:inline")}
      style={markdownForegroundStyle("card")}
    >
      <span className="slei-message-skill mr-1 inline-flex items-center rounded-md bg-accent px-1.5 py-0.5 font-mono text-xs font-medium text-accent-foreground">
        {skillToken.token}
      </span>
      {rest ? <MarkdownMessage markdown={rest} tone="card" /> : null}
    </div>
  );
}

function ChannelMemberPanel(input: {
  availableMembers: SleiMember[];
  channelId: string;
  members: SleiMember[];
  messages: DesktopMessages;
  onAdd?: (agentId: string) => Promise<void> | void;
  onRemove?: (agentId: string) => Promise<void> | void;
}) {
  const [mutatingMemberId, setMutatingMemberId] = useState<string | undefined>(undefined);
  const [confirmingRemoveId, setConfirmingRemoveId] = useState<string | undefined>(undefined);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [selectedAddIds, setSelectedAddIds] = useState<string[]>([]);
  const [addingSelected, setAddingSelected] = useState(false);
  const availableAddMemberIds = input.availableMembers.map((member) => member.id).join("|");

  useEffect(() => {
    const availableIds = new Set(input.availableMembers.map((member) => member.id));
    setSelectedAddIds((current) => {
      const next = current.filter((memberId) => availableIds.has(memberId));
      return next.length === current.length ? current : next;
    });
  }, [availableAddMemberIds]);

  function closeAddDialog() {
    setAddDialogOpen(false);
    setSelectedAddIds([]);
  }

  function toggleSelectedAddMember(memberId: string) {
    if (addingSelected) return;
    setSelectedAddIds((current) =>
      current.includes(memberId)
        ? current.filter((selectedId) => selectedId !== memberId)
        : [...current, memberId],
    );
  }

  async function addSelectedMembers() {
    if (selectedAddIds.length === 0) return;
    const selectedIds = input.availableMembers
      .map((member) => member.id)
      .filter((memberId) => selectedAddIds.includes(memberId));
    setAddingSelected(true);
    try {
      for (const memberId of selectedIds) {
        await input.onAdd?.(memberId);
      }
      closeAddDialog();
    } finally {
      setAddingSelected(false);
    }
  }

  async function mutate(memberId: string, action: "add" | "remove") {
    setMutatingMemberId(memberId);
    try {
      if (action === "add") {
        await input.onAdd?.(memberId);
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
      aria-label={input.messages.chat.channelMembers}
      className="grid h-full min-h-0 w-80 grid-rows-[auto_auto_minmax(0,1fr)] gap-3 border-l bg-background/55 p-4 backdrop-blur-xl"
      data-testid="slei-channel-member-panel"
    >
      <div className="flex items-center justify-between gap-2 pr-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <h2 className="inline-flex min-w-0 items-center gap-2 text-sm font-semibold">
            <SleiIcon name="members" size={16} />
            <span className="truncate">{input.messages.chat.channelMembers}({input.members.length})</span>
          </h2>
        </div>
        <Dialog open={addDialogOpen} onOpenChange={(open) => {
          setAddDialogOpen(open);
          if (!open) setSelectedAddIds([]);
        }}>
          <Tooltip>
            <TooltipTrigger asChild>
              <DialogTrigger asChild>
                <Button aria-label={input.messages.chat.addChannelMember} size="icon-xs" type="button" variant="ghost">
                  <SleiIcon name="plus" size={18} />
                </Button>
              </DialogTrigger>
            </TooltipTrigger>
            <TooltipContent>{input.messages.chat.addChannelMember}</TooltipContent>
          </Tooltip>
          <DialogContent className="w-[min(42rem,calc(100vw-2rem))] sm:max-w-2xl" closeLabel={input.messages.common.cancel} data-testid="slei-channel-member-add-dialog">
            <DialogHeader>
              <DialogTitle>{input.messages.chat.addChannelMember}</DialogTitle>
              <DialogDescription>{input.messages.chat.addChannelMemberDescription}</DialogDescription>
            </DialogHeader>
            <div className="grid min-h-0 gap-3 sm:grid-cols-[minmax(0,1fr)_13rem]">
              <ScrollArea className="max-h-[22rem] min-h-0 rounded-lg border bg-background">
                <div aria-multiselectable="true" className="grid gap-1 p-2" role="listbox">
                  {input.availableMembers.length > 0 ? (
                    input.availableMembers.map((member) => {
                      const selected = selectedAddIds.includes(member.id);
                      return (
                        <SelectableCard
                          aria-selected={selected ? "true" : "false"}
                          className="grid cursor-pointer grid-cols-[auto_minmax(0,1fr)] items-center gap-2 rounded-md px-2 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          data-testid="slei-channel-member-add-candidate"
                          key={member.id}
                          onClick={() => toggleSelectedAddMember(member.id)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              toggleSelectedAddMember(member.id);
                            }
                          }}
                          role="option"
                          selected={selected}
                          tabIndex={0}
                        >
                          <Checkbox
                            aria-label={member.name}
                            checked={selected}
                            data-testid="slei-channel-member-add-candidate-checkbox"
                            disabled={addingSelected}
                            onCheckedChange={() => toggleSelectedAddMember(member.id)}
                            onClick={(event) => event.stopPropagation()}
                          />
                          <span className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-2 overflow-hidden text-left">
                            <MemberAvatar identity={member} />
                            <span className="grid min-w-0 gap-0.5 overflow-hidden">
                              <span className="flex min-w-0 items-baseline gap-1.5">
                                <strong className="truncate text-sm text-foreground">{member.name}</strong>
                                <small className="shrink-0 text-xs font-normal text-muted-foreground">{member.handle}</small>
                              </span>
                              <small className="block min-w-0 max-w-full overflow-hidden text-ellipsis whitespace-nowrap text-xs font-normal text-muted-foreground" data-testid="slei-channel-member-add-candidate-description">
                                {member.description}
                              </small>
                            </span>
                          </span>
                        </SelectableCard>
                      );
                    })
                  ) : (
                    <Empty
                      framed={false}
                      size="sm"
                      title={input.messages.chat.noAvailableChannelMembers}
                      variant="nodata"
                    />
                  )}
                </div>
              </ScrollArea>
              <div className="grid min-h-40 content-start gap-2 rounded-lg border bg-muted/30 p-3">
                <strong className="text-sm">{input.messages.chat.selectedChannelMembers(selectedAddIds.length)}</strong>
                {selectedAddIds.length > 0 ? (
                  <div className="grid gap-1">
                    {input.availableMembers.filter((member) => selectedAddIds.includes(member.id)).map((member) => (
                      <span className="truncate text-sm text-muted-foreground" key={member.id}>{member.name} {member.handle}</span>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">{input.messages.chat.noSelectedChannelMembers}</p>
                )}
              </div>
            </div>
            <DialogFooter>
              <Button disabled={addingSelected} onClick={closeAddDialog} type="button" variant="outline">{input.messages.common.cancel}</Button>
              <Button data-testid="slei-channel-member-add-confirm" disabled={selectedAddIds.length === 0 || addingSelected} onClick={() => void addSelectedMembers()} type="button" variant="primary">
                {input.messages.chat.confirmAddChannelMembers(selectedAddIds.length)}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
      <Separator className="border-border/60" data-testid="slei-channel-member-header-separator" />
      <ScrollArea className="min-h-0 pr-2">
        <div className="grid gap-1">
          {input.members.length > 0 ? input.members.map((member) => {
            const readiness = member.channelReadiness?.[input.channelId];
            const confirming = confirmingRemoveId === member.id;
            return (
              <div className="group/member grid gap-1 rounded-md px-1.5 py-2 hover:bg-muted/50" key={member.id}>
                <div className="flex min-w-0 items-center gap-2">
                  <span
                    aria-hidden="true"
                    className={cn("size-2 shrink-0 rounded-full", readiness === "ready" ? "bg-emerald-500" : "bg-muted-foreground/40")}
                    data-testid="slei-channel-member-status-dot"
                  />
                  <MemberAvatar identity={member} />
                  <span className="grid min-w-0 flex-1">
                    <strong className="truncate text-sm">{member.name}</strong>
                    <small className="truncate text-xs text-muted-foreground">{member.handle}</small>
                  </span>
                  <AlertDialog
                    open={confirming}
                    onOpenChange={(open) => {
                      setConfirmingRemoveId(open ? member.id : undefined);
                    }}
                  >
                    <AlertDialogTrigger asChild>
                      <Button aria-label={input.messages.chat.removeChannelMember(member.name)} className="text-destructive hover:bg-destructive/10 hover:text-destructive" disabled={mutatingMemberId === member.id} size="icon-xs" type="button" variant="ghost">
                        <SleiIcon name="delete" size={14} />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent data-testid="slei-channel-member-remove-dialog">
                      <AlertDialogHeader>
                        <AlertDialogTitle>{input.messages.chat.removeChannelMember(member.name)}</AlertDialogTitle>
                        <AlertDialogDescription>{input.messages.chat.removeChannelMemberConfirm(member.name)}</AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel disabled={mutatingMemberId === member.id}>{input.messages.common.cancel}</AlertDialogCancel>
                        <AlertDialogAction
                          data-testid="slei-channel-member-remove-confirm"
                          disabled={mutatingMemberId === member.id}
                          onClick={(event) => {
                            event.preventDefault();
                            void mutate(member.id, "remove");
                          }}
                          variant="destructive"
                        >
                          {input.messages.common.delete}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>
            );
          }) : (
            <Empty
              framed={false}
              size="sm"
              title={input.messages.chat.noChannelMembers}
              variant="nodata"
            />
          )}
        </div>
      </ScrollArea>
    </aside>
  );
}

export function ChatPage({ activeChannel, activeConversation, data, focusedMessageId, initialAttachments, initialChannelMembersOpen, initialChannelView, initialDraft, messages, onAgentDraftCreate, onAttachmentUpload, onChannelDraftCreate, onChannelMemberAdd, onChannelMemberRemove, onChannelProjectPathsChange, onMessageSaveToggle, onMessageThreadOpen, onMessageThreadReply, onMessageThreadReplyFromSource, onOlderMessagesLoad, onPermissionResolve, onSendFailure, onSendMessage, onTaskReply, onTaskStatusChange, onTaskThreadOpen, profile, savedMessageIds = [], sending }: { activeChannel: SleiFixtures["channels"][number]; activeConversation?: ConversationView; activeSessionId?: string; data: SleiFixtures; focusedMessageId?: string; initialAttachments?: ConversationAttachmentView[]; initialChannelMembersOpen?: boolean; initialChannelView?: ChannelEmbeddedView; initialDraft?: string; messages: DesktopMessages; onAgentDraftCreate?: (draft: Partial<AgentDraftInput>, cardId?: string) => void; onAttachmentUpload?: (request: ConversationAttachmentUploadRequest) => Promise<{ attachment: ConversationAttachmentView }>; onChannelDraftCreate?: (draft: Record<string, unknown>, cardId?: string) => void; onChannelMemberAdd?: (agentId: string) => Promise<void> | void; onChannelMemberRemove?: (agentId: string) => Promise<void> | void; onChannelProjectPathsChange?: (channelId: string, projectPaths: string[]) => Promise<void> | void; onConversationHistoryToggle?: () => void; onConversationNewSession?: (conversationId: string) => Promise<void> | void; onConversationSessionSelect?: (conversationId: string, sessionId: string) => Promise<void> | void; onMessageSaveToggle?: (message: SleiMessage) => Promise<void> | void; onMessageThreadOpen?: (message: SleiMessage) => Promise<void> | void; onMessageThreadReply?: (threadId: string, body: string) => Promise<void> | void; onMessageThreadReplyFromSource?: (message: SleiMessage, body: string) => Promise<void> | void; onOlderMessagesLoad?: () => Promise<void> | void; onPermissionResolve?: (requestId: string, decision: PermissionDecision) => Promise<void> | void; onSendFailure?: (message: string, type?: ToastType) => void; onSendMessage?: (body: string, options?: { asTask?: boolean; attachmentIds?: string[]; sessionId?: string }) => Promise<void> | void; onTaskReply?: (taskId: string, body: string) => Promise<void> | void; onTaskStatusChange?: (taskId: string, status: SleiFixtures["tasks"][number]["status"]) => Promise<void> | void; onTaskThreadOpen?: (taskId: string) => Promise<void> | void; profile: UserProfile; savedMessageIds?: string[]; sending?: boolean; sessionDrawerOpen?: boolean }) {
  const [draft, setDraft] = useState(initialDraft ?? "");
  const [asTask, setAsTask] = useState(false);
  const [attachments, setAttachments] = useState<ConversationAttachmentView[]>(initialAttachments ?? []);
  const [channelView, setChannelView] = useState<ChannelEmbeddedView>(initialChannelView ?? "chat");
  const [channelMembersOpen, setChannelMembersOpen] = useState(initialChannelMembersOpen ?? false);
  const [isComposing, setIsComposing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [selectedMentionIndex, setSelectedMentionIndex] = useState(0);
  const [selectedSkillIndex, setSelectedSkillIndex] = useState(0);
  const [toast, setToast] = useState<{ message: string; type: ToastType }>({ message: "", type: "info" });
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | undefined>(focusedMessageId);
  const [selectedTaskId, setSelectedTaskId] = useState<string | undefined>(undefined);
  const [selectedThreadMessageId, setSelectedThreadMessageId] = useState<string | undefined>(undefined);
  const [projectEditorOpen, setProjectEditorOpen] = useState(false);
  const [projectDraftPaths, setProjectDraftPaths] = useState<string[]>(activeChannel.projectPaths ?? []);
  const [projectSaving, setProjectSaving] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const projectFolderInputRef = useRef<HTMLInputElement>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const mentionOptionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const skillOptionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const timelineViewportRef = useRef<HTMLDivElement | null>(null);
  const pendingScrollToBottomRef = useRef(false);
  const initialTimelineScrollTargetRef = useRef<string | undefined>(undefined);
  const lastTimelineMessageIdRef = useRef<string | undefined>(undefined);
  const timelineAtBottomRef = useRef(true);
  const scrollFrameRef = useRef<number | undefined>(undefined);
  const olderMessagesRequestInFlightRef = useRef(false);
  const pendingOlderMessagesScrollRestoreRef = useRef<{ scrollHeight: number; scrollTop: number } | undefined>(undefined);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [olderMessagesLoading, setOlderMessagesLoading] = useState(false);
  const mention = activeMentionQuery(draft);
  const mentionTargets = mention ? mentionSuggestions(mention.query, data.members) : [];
  const dmMember = activeConversation?.kind === "dm" ? data.members.find((member) => member.id === activeConversation.agentId) : undefined;
  const skillSlash = dmMember ? activeSkillSlashQuery(draft) : null;
  const skillSlashTargets = skillSlash && dmMember ? skillSlashSuggestions(skillSlash.query, dmMember.skills ?? []) : [];
  const activeTargetId = activeConversation?.id ?? activeChannel.id;
  const visibleMessages = filterConversationMessages(data.messages, {
    channel: activeTargetId,
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
  const timelineUsesVirtualization = timelineMessages.length > TIMELINE_VIRTUALIZATION_THRESHOLD;
  const latestTimelineMessage = timelineMessages.at(-1);
  const timelineVirtualizer = useVirtualizer({
    count: timelineUsesVirtualization ? timelineMessages.length : 0,
    getScrollElement: () => timelineViewportRef.current,
    estimateSize: () => 96,
    overscan: 8,
    getItemKey: (index) => timelineMessages[index]?.id ?? index,
  });
  const timelineVirtualItems = timelineUsesVirtualization && typeof document !== "undefined" ? timelineVirtualizer.getVirtualItems() : [];
  const renderedTimelineItems = timelineUsesVirtualization && timelineVirtualItems.length > 0
    ? timelineVirtualItems.map((item) => ({ key: item.key, message: timelineMessages[item.index], virtualItem: item }))
    : timelineMessages.map((message, index) => ({ key: message.id, message, virtualItem: undefined, fallbackIndex: index }));
  const composerReservePx = attachments.length > 0 || (mention && mentionTargets.length > 0) || (skillSlash && skillSlashTargets.length > 0)
    ? COMPOSER_EXPANDED_RESERVE_PX
    : COMPOSER_RESERVE_PX;
  const composerReserveStyle: ChatComposerReserveStyle = {
    "--chat-composer-reserve": `${composerReservePx}px`,
  };
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
  const selectedThreadMessage = selectedThreadMessageId
    ? data.messages.find((message) => message.id === selectedThreadMessageId)
    : undefined;
  const selectedMessageThreadTask = selectedThreadMessage
    ? {
        id: selectedThreadMessage.thread?.id ?? `draft-thread-${selectedThreadMessage.id}`,
        title: selectedThreadMessage.body || selectedThreadMessage.author,
        owner: selectedThreadMessage.author,
        status: "in_progress" as const,
        channelId: selectedThreadMessage.channelId,
        sourceMessageId: selectedThreadMessage.id,
        replyCount: selectedThreadMessage.thread?.replyCount ?? 0,
        replies: selectedThreadMessage.thread?.replies ?? [],
      }
    : undefined;
  const allowAsTask = true;
  const effectiveChannelView: ChannelEmbeddedView = dmMember ? "chat" : channelView;
  const timelineScrollTarget = activeTargetId;
  const detailTitle = dmMember ? dmMember.name : stripChannelHash(activeChannel.name);
  const detailAriaLabel = dmMember ? detailTitle : `# ${detailTitle}`;
  const activeChannelProjectName = activeChannel.projectPaths?.length ? activeChannel.projectPaths.join(", ") : activeChannel.projectName;
  const detailSubtitle = dmMember
    ? formatConversationDateTime(activeConversation?.createdAt ?? "")
    : messages.chat.projectPrefix(activeChannelProjectName || messages.chat.noLinkedProjects);
  const showProjectEditor = !dmMember && activeChannel.id !== "all";
  const sessionBusy = Boolean(activeConversation && visibleMessages.some((message) => message.status === "running" || message.status === "pending"));
  const sendDisabled = Boolean((!draft.trim() && attachments.length === 0) || sessionBusy || sending || submitting);
  const showChannelMembersPanel = !dmMember && channelMembersOpen && effectiveChannelView === "chat";
  const renderChannelMemberPanelRegion = !dmMember && effectiveChannelView === "chat";

  useEffect(() => {
    setChannelView(initialChannelView ?? "chat");
  }, [activeChannel.id, activeConversation?.id, initialChannelView]);

  useEffect(() => {
    setProjectDraftPaths(activeChannel.projectPaths ?? []);
    setProjectEditorOpen(false);
    setProjectSaving(false);
  }, [activeChannel.id, activeChannel.projectPaths]);

  useEffect(() => {
    if (dmMember || typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const media = window.matchMedia("(max-width: 899px)");
    const collapseIfCompact = () => {
      if (media.matches) setChannelMembersOpen(false);
    };
    collapseIfCompact();
    media.addEventListener?.("change", collapseIfCompact);
    return () => media.removeEventListener?.("change", collapseIfCompact);
  }, [activeChannel.id, dmMember]);

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
    if (!skillSlash || skillSlashTargets.length === 0) return;
    skillOptionRefs.current[selectedSkillIndex]?.scrollIntoView({ block: "nearest" });
  }, [skillSlash, skillSlashTargets.length, selectedSkillIndex]);

  useEffect(() => {
    setSelectedSkillIndex(0);
  }, [skillSlash?.query, dmMember?.id]);

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
    return requestTimelineScrollToBottom();
  }, [timelineMessages.length, timelineScrollTarget, effectiveChannelView]);

  useLayoutEffect(() => {
    restoreOlderMessagesScrollPosition();
  }, [timelineMessages.length]);

  useEffect(() => {
    const latestMessage = latestTimelineMessage;
    const previousMessageId = lastTimelineMessageIdRef.current;
    lastTimelineMessageIdRef.current = latestMessage?.id;
    if (!latestMessage || !previousMessageId || latestMessage.id === previousMessageId) return;
    if (latestMessage.role !== "agent") return;
    if (timelineAtBottomRef.current) {
      requestTimelineScrollToBottom();
      return;
    }
    setShowScrollToBottom(true);
  }, [latestTimelineMessage]);

  useEffect(() => {
    return () => {
      if (scrollFrameRef.current !== undefined) window.cancelAnimationFrame(scrollFrameRef.current);
    };
  }, []);

  async function submitMessage() {
    if (sendDisabled) return;
    setSubmitting(true);
    try {
      const sendFailureToast = onSendFailure ?? showToast;
      const result = await submitComposerDraftWithFeedback({
        draft,
        asTask: allowAsTask ? asTask : false,
        attachments,
        sendFailedMessage: messages.chat.sendFailed,
        onSendFailure: (message) => sendFailureToast(message, "error"),
        onSendMessage,
      });
      if (result.sent) {
        pendingScrollToBottomRef.current = true;
        requestTimelineScrollToBottom();
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

  function selectSkillSlash(index = selectedSkillIndex) {
    if (!skillSlash || !skillSlashTargets[index]) return;
    setDraft(insertSkillSlash(draft, skillSlash, skillSlashTargets[index]));
    setSelectedSkillIndex(0);
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

  async function toggleMessageSave(message: SleiMessage, currentlySaved: boolean) {
    if (!onMessageSaveToggle) return;
    try {
      await onMessageSaveToggle(message);
      showToast(currentlySaved ? messages.chat.unsaveMessageSuccess : messages.chat.saveMessageSuccess, "success");
    } catch (error) {
      showToast(formatToastError(currentlySaved ? messages.chat.unsaveMessageFailed : messages.chat.saveMessageFailed, error), "error");
    }
  }

  function showToast(message: string, type: ToastType = "info") {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({ message, type });
    toastTimerRef.current = setTimeout(() => setToast((current) => ({ ...current, message: "" })), TOAST_VISIBLE_MS);
  }

  function dismissToast() {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = undefined;
    setToast((current) => ({ ...current, message: "" }));
  }

  function openTaskThread(taskId: string) {
    setSelectedTaskId(taskId);
    void Promise.resolve(onTaskThreadOpen?.(taskId)).catch(() => undefined);
  }

  function openMessageThread(message: SleiMessage) {
    setSelectedThreadMessageId(message.id);
    if (message.thread) {
      void Promise.resolve(onMessageThreadOpen?.(message)).catch(() => undefined);
    }
  }

  async function replyToSelectedMessageThread(_threadId: string, body: string) {
    if (!selectedThreadMessage) return;
    if (selectedThreadMessage.thread?.id) {
      await onMessageThreadReply?.(selectedThreadMessage.thread.id, body);
      return;
    }
    await onMessageThreadReplyFromSource?.(selectedThreadMessage, body);
  }

  function isTimelineAtBottom() {
    return timelineDistanceFromBottom() <= 24;
  }

  function timelineDistanceFromBottom() {
    const viewport = timelineViewportRef.current;
    if (!viewport) return 0;
    return viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
  }

  function updateTimelineBottomState() {
    const distanceFromBottom = timelineDistanceFromBottom();
    const atBottom = distanceFromBottom <= 24;
    timelineAtBottomRef.current = atBottom;
    setShowScrollToBottom(distanceFromBottom >= SCROLL_TO_BOTTOM_BUTTON_THRESHOLD_PX);
  }

  function requestOlderMessagesIfNearTop() {
    const viewport = timelineViewportRef.current;
    if (!viewport || viewport.scrollTop > HISTORY_LOAD_SCROLL_TOP_THRESHOLD_PX || olderMessagesRequestInFlightRef.current) return;
    olderMessagesRequestInFlightRef.current = true;
    pendingOlderMessagesScrollRestoreRef.current = {
      scrollHeight: viewport.scrollHeight,
      scrollTop: viewport.scrollTop,
    };
    setOlderMessagesLoading(true);
    void Promise.resolve(onOlderMessagesLoad?.())
      .catch(() => undefined)
      .finally(() => {
        olderMessagesRequestInFlightRef.current = false;
        setOlderMessagesLoading(false);
        if (typeof window !== "undefined") {
          window.requestAnimationFrame(() => restoreOlderMessagesScrollPosition());
        } else {
          restoreOlderMessagesScrollPosition();
        }
      });
  }

  function handleTimelineScroll() {
    updateTimelineBottomState();
    requestOlderMessagesIfNearTop();
  }

  function requestTimelineScrollToBottom() {
    if (typeof window === "undefined") return undefined;
    if (scrollFrameRef.current !== undefined) window.cancelAnimationFrame(scrollFrameRef.current);
    timelineAtBottomRef.current = true;
    setShowScrollToBottom(false);
    const frame = window.requestAnimationFrame(() => {
      const viewport = timelineViewportRef.current;
      if (!viewport) {
        scrollFrameRef.current = undefined;
        return;
      }
      if (timelineUsesVirtualization && timelineMessages.length > 0) {
        timelineVirtualizer.scrollToOffset(timelineVirtualizer.getTotalSize() + composerReservePx, {
          align: "end",
          behavior: "smooth",
        });
        scrollFrameRef.current = undefined;
        return;
      }
      if (typeof viewport.scrollTo === "function") {
        viewport.scrollTo({
          top: viewport.scrollHeight,
          behavior: "smooth",
        });
      } else {
        viewport.scrollTop = viewport.scrollHeight;
      }
      scrollFrameRef.current = undefined;
    });
    scrollFrameRef.current = frame;
    return () => {
      window.cancelAnimationFrame(frame);
      if (scrollFrameRef.current === frame) scrollFrameRef.current = undefined;
    };
  }

  function addProjectFolders(files: FileList | null) {
    const paths = Array.from(files ?? []).map(projectPathFromPickedFile).filter(Boolean);
    if (paths.length === 0) return;
    setProjectDraftPaths((current) => uniqueProjectPaths([...current, ...paths]));
  }

  function removeProjectFolder(path: string) {
    setProjectDraftPaths((current) => current.filter((candidate) => candidate !== path));
  }

  async function saveProjectPaths() {
    if (!onChannelProjectPathsChange) return;
    setProjectSaving(true);
    try {
      const paths = uniqueProjectPaths(projectDraftPaths);
      await onChannelProjectPathsChange(activeChannel.id, paths);
      setProjectDraftPaths(paths);
      setProjectEditorOpen(false);
    } catch {
    } finally {
      setProjectSaving(false);
    }
  }

  function restoreOlderMessagesScrollPosition() {
    const restore = pendingOlderMessagesScrollRestoreRef.current;
    const viewport = timelineViewportRef.current;
    if (!restore || !viewport) return;
    const delta = viewport.scrollHeight - restore.scrollHeight;
    if (delta > 0) viewport.scrollTop = restore.scrollTop + delta;
    pendingOlderMessagesScrollRestoreRef.current = undefined;
  }

  return (
    <section className={cn("relative grid h-full min-h-0 bg-transparent", dmMember ? "grid-rows-[auto_minmax(0,1fr)]" : "grid-rows-[auto_auto_minmax(0,1fr)]")} data-slot="chat-page">
      <Toast message={toast.message} onDismiss={dismissToast} type={toast.type} />
      <header className="flex min-h-16 select-none items-center justify-between gap-3 border-b bg-transparent px-4 py-3" data-testid="slei-channel-header" data-tauri-drag-region="deep">
        <div className="min-w-0" data-slot="workspace-titlebar" data-tauri-drag-region="deep">
          <div className="min-w-0" data-tauri-drag-region="deep">
            <h1 aria-label={detailAriaLabel} className="inline-flex max-w-full min-w-0 items-center gap-2 text-xl font-semibold" data-tauri-drag-region="deep">
              <span className="inline-flex shrink-0" data-tauri-drag-region="deep">
                {dmMember ? <SleiIcon name="chat" size={20} /> : <SleiIcon name="hash" size={20} />}
              </span>
              <span className="min-w-0" data-tauri-drag-region="deep">
                <span className="truncate" data-tauri-drag-region="deep">{detailTitle}</span>
              </span>
              {!dmMember ? (
                <TooltipButton aria-label={messages.chat.copyMessage} onClick={() => void copyChannelTitle()} size="icon-xs" tooltip={messages.chat.copyMessage} type="button" variant="ghost">
                  <SleiIcon name="copy" size={14} />
                </TooltipButton>
              ) : null}
            </h1>
            <div className="mt-0.5 flex min-w-0 items-center gap-1 text-xs text-muted-foreground" data-tauri-drag-region="deep">
              <p className="truncate" data-tauri-drag-region="deep">{detailSubtitle}</p>
              {showProjectEditor ? (
                <Popover open={projectEditorOpen} onOpenChange={setProjectEditorOpen}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <PopoverTrigger asChild>
                        <Button
                          aria-label={messages.chat.editProjects}
                          className="size-6 shrink-0 text-muted-foreground hover:text-foreground"
                          data-testid="slei-channel-project-edit"
                          size="icon-xs"
                          type="button"
                          variant="ghost"
                        >
                          <SleiIcon name="pencil" size={13} />
                        </Button>
                      </PopoverTrigger>
                    </TooltipTrigger>
                    <TooltipContent>{messages.chat.editProjects}</TooltipContent>
                  </Tooltip>
                  <PopoverContent align="start" className="w-80 p-3">
                    <div className="grid gap-3">
                      <input
                        aria-label={messages.chat.projectFolderPicker}
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
                      <div className="flex items-center justify-between gap-2">
                        <strong className="text-sm text-foreground">{messages.chat.project}</strong>
                        <Button onClick={() => projectFolderInputRef.current?.click()} size="sm" type="button">
                          <SleiIcon name="folderPlus" size={14} />
                          {messages.chat.projectFolderPicker}
                        </Button>
                      </div>
                      {projectDraftPaths.length > 0 ? (
                        <div className="flex max-h-32 flex-wrap gap-2 overflow-auto">
                          {projectDraftPaths.map((path) => (
                            <Badge className="max-w-full gap-1" key={path} variant="secondary">
                              <span className="truncate">{path}</span>
                              <Button aria-label={messages.chat.removeProject(path)} className="-mr-1 ml-0.5 hover:bg-background/70" onClick={() => removeProjectFolder(path)} size="icon-xs" type="button" variant="ghost">
                                <SleiIcon className="size-3" name="x" />
                              </Button>
                            </Badge>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground">{messages.chat.noLinkedProjects}</p>
                      )}
                      <div className="flex justify-end gap-2">
                        <Button disabled={projectSaving} onClick={() => setProjectEditorOpen(false)} size="sm" type="button" variant="ghost">{messages.common.cancel}</Button>
                        <Button disabled={projectSaving || !onChannelProjectPathsChange} onClick={() => void saveProjectPaths()} size="sm" type="button" variant="primary">{messages.common.save}</Button>
                      </div>
                    </div>
                  </PopoverContent>
                </Popover>
              ) : null}
            </div>
          </div>
        </div>
        {dmMember ? null : (
          <div className="flex shrink-0 items-center gap-2" data-testid="slei-channel-header-actions">
            <TooltipButton
              aria-expanded={showChannelMembersPanel ? "true" : "false"}
              aria-label={messages.chat.channelMembers}
              className={cn(showChannelMembersPanel && "border-primary/20 bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary")}
              data-testid="slei-channel-members-header-toggle"
              onClick={() => {
                if (effectiveChannelView !== "chat") {
                  setChannelView("chat");
                  setChannelMembersOpen(true);
                  return;
                }
                setChannelMembersOpen((current) => !current);
              }}
              tooltip={messages.chat.channelMembers}
              type="button"
              variant="outline"
              size="icon-sm"
            >
              <SleiIconSwap active={showChannelMembersPanel} activeName="panelClose" inactiveName="panelOpen" size={15} />
            </TooltipButton>
          </div>
        )}
      </header>
      {!dmMember ? (
        <Tabs className="gap-0" onValueChange={(value) => setChannelView(value as ChannelEmbeddedView)} value={effectiveChannelView}>
          <div className="border-b bg-transparent px-4 py-2" data-testid="slei-channel-view-tabs">
            <TabsList aria-label={messages.chat.channelView} variant="soft">
              <TabsTrigger aria-current={effectiveChannelView === "chat" ? "page" : undefined} value="chat"><SleiIcon name="chat" size={14} />{messages.shell.nav.chat}</TabsTrigger>
              <TabsTrigger aria-current={effectiveChannelView === "tasks" ? "page" : undefined} value="tasks"><SleiIcon name="tasks" size={14} />{messages.chat.tasks}</TabsTrigger>
              <TabsTrigger aria-current={effectiveChannelView === "files" ? "page" : undefined} value="files"><SleiIcon name="fileText" size={14} />{messages.chat.files}</TabsTrigger>
            </TabsList>
          </div>
        </Tabs>
      ) : null}
      <section
        className={cn(
          "grid min-h-0 transition-[grid-template-columns] duration-200 ease-out",
          renderChannelMemberPanelRegion
            ? showChannelMembersPanel
              ? "grid-cols-[minmax(0,1fr)_20rem]"
              : "grid-cols-[minmax(0,1fr)_0rem]"
            : "grid-cols-1",
        )}
        data-testid="slei-channel-main-region"
      >
        <div className="grid min-h-0 overflow-visible" data-testid="slei-channel-workspace">
          {effectiveChannelView === "chat" ? (
            <div className="relative h-full min-h-0 overflow-visible" data-testid="slei-channel-chat-column" style={composerReserveStyle}>
              <div className="relative h-full min-h-0 overflow-visible">
                {olderMessagesLoading ? (
                  <div className="pointer-events-none absolute left-0 right-0 top-0 z-10 flex justify-center bg-transparent px-4 py-2 text-xs text-muted-foreground" data-testid="slei-older-messages-loading" role="status">
                    {messages.chat.loadingOlderMessages}
                  </div>
                ) : null}
                <div className="h-full min-h-0 overflow-y-auto" data-testid="slei-chat-timeline" onScroll={handleTimelineScroll} ref={timelineViewportRef}>
                  <div
                    className={cn("relative", timelineVirtualItems.length === 0 && "grid gap-1 px-4 py-3 pb-[var(--chat-composer-reserve)]")}
                    data-testid="slei-chat-timeline-content"
                    style={timelineVirtualItems.length > 0 ? { height: `${timelineVirtualizer.getTotalSize() + composerReservePx}px` } : undefined}
                  >
                    {renderedTimelineItems.length === 0 ? (
                      <div className="grid min-h-60 place-items-center px-4 py-8">
                        <Empty
                          centered
                          framed={false}
                          title={messages.empty.defaultTitle.nodata}
                          variant="nodata"
                        />
                      </div>
                    ) : null}
                    {renderedTimelineItems.map(({ key, message, virtualItem }) => {
                      const sourceTask = message.task && message.task.channelId === activeChannel.id && message.task.sourceMessageId === message.id
                        ? message.task
                        : taskBySourceMessageId.get(message.id);
                      if (sourceTask) {
                        const saved = savedMessageIds.includes(message.id);
                        const saveLabel = saved ? messages.chat.unsaveMessage : messages.chat.saveMessage;
                        const timestamp = messageTimestampLabel(message);
                        return (
                          <div
                            className={cn(virtualItem && "absolute left-0 top-0 w-full px-4")}
                            data-index={virtualItem?.index}
                            key={key}
                            ref={virtualItem ? timelineVirtualizer.measureElement : undefined}
                            style={virtualItem ? { transform: `translateY(${virtualItem.start}px)` } : undefined}
                          >
                            <TaskRootEntry
                              copyLabel={messages.chat.copyMessage}
                              messages={messages}
                              onCopy={() => copyMessage(message)}
                              onOpen={() => openTaskThread(sourceTask.id)}
                              onSaveToggle={() => toggleMessageSave(message, saved)}
                              avatarIdentity={memberFromMessage(message, data.members)}
                              roleDescription={messageRoleDescription(message, data.members, messages)}
                              saved={saved}
                              saveLabel={saveLabel}
                              sourceMessage={message}
                              task={sourceTask}
                              timestamp={timestamp}
                            />
                          </div>
                        );
                      }
                      const saved = savedMessageIds.includes(message.id);
                      const saveLabel = saved ? messages.chat.unsaveMessage : messages.chat.saveMessage;
                      const timestamp = messageTimestampLabel(message);
                      return (
                        <div
                          className={cn("pt-3", virtualItem && "absolute left-0 top-0 w-full px-4")}
                          data-index={virtualItem?.index}
                          data-slot="timeline-message-frame"
                          key={key}
                          ref={virtualItem ? timelineVirtualizer.measureElement : undefined}
                          style={virtualItem ? { transform: `translateY(${virtualItem.start}px)` } : undefined}
                        >
                          <MessageRow
                            className={highlightedMessageId === message.id ? "slei-message--blink-border" : undefined}
                            focused={highlightedMessageId === message.id}
                            messageId={message.id}
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
                                  <TooltipButton aria-label={`${messages.tasks.commentThread}: ${message.author}`} data-message-thread-open={message.id} onClick={() => openMessageThread(message)} size="icon-xs" tooltip={messages.tasks.commentThread} type="button" variant="ghost">
                                    <SleiIcon name="messageSquare" size={14} />
                                  </TooltipButton>
                                  <TooltipButton aria-label={messages.chat.copyMessage} onClick={() => void copyMessage(message)} size="icon-xs" tooltip={messages.chat.copyMessage} type="button" variant="ghost">
                                    <SleiIcon name="copy" size={14} />
                                  </TooltipButton>
                                  <TooltipButton aria-label={saveLabel} aria-pressed={saved ? "true" : "false"} onClick={() => void toggleMessageSave(message, saved)} size="icon-xs" tooltip={saveLabel} type="button" variant="ghost">
                                    <SleiIconSwap active={saved} activeName="bookmark" inactiveName="bookmarkOutline" size={14} />
                                  </TooltipButton>
                                  <span aria-hidden="true">｜</span>
                                  <span className="inline-flex items-center gap-1">
                                    <time className="whitespace-nowrap tabular-nums" dateTime={timestamp}>
                                      {timestamp}
                                    </time>
                                    <MessageStatusSquare status={message.status} />
                                  </span>
                                </div>
                              </div>
                              <MessageBody
                                body={message.body}
                                skillToken={dmMember ? leadingSkillSlashToken(message.body, dmMember.skills ?? []) : null}
                              />
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
                          </MessageRow>
                        </div>
                      );
                    })}
                  </div>
                </div>
                {showScrollToBottom ? (
                  <Button
                    className="absolute bottom-[var(--chat-composer-reserve)] left-1/2 z-20 h-8 -translate-x-1/2 border-white/25 bg-white/85 px-3.5 text-xs shadow-[0_8px_24px_rgba(0,0,0,0.24)] backdrop-blur-xl hover:bg-white/95"
                    data-testid="slei-scroll-to-bottom"
                    onClick={requestTimelineScrollToBottom}
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    <SleiIcon className="size-3.5" name="arrowDown" />
                    {messages.chat.backToBottom}
                  </Button>
                ) : null}
              </div>
              <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 overflow-visible p-3" data-testid="slei-composer-shell">
                <div className="slei-composer-glass pointer-events-auto mx-auto grid max-w-full gap-3 overflow-visible rounded-2xl border border-transparent p-3 shadow-[0_18px_48px_rgba(15,23,42,0.18)] backdrop-blur-xl">
                {mention && mentionTargets.length > 0 ? (
                  <div className="min-w-0 overflow-visible">
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
                {skillSlash && skillSlashTargets.length > 0 ? (
                  <div className="min-w-0 overflow-visible">
                    <SkillSlashPicker
                      messages={messages}
                      onSelect={selectSkillSlash}
                      optionRef={(index, node) => {
                        skillOptionRefs.current[index] = node;
                      }}
                      selectedIndex={selectedSkillIndex}
                      skills={skillSlashTargets}
                    />
                  </div>
                ) : null}
                <form className="grid gap-0 overflow-visible" onSubmit={(event) => { event.preventDefault(); void submitMessage(); }}>
                  <Card className={cn(CARD_FLAT_CLASS, "grid gap-2 overflow-visible p-1")} data-testid="slei-composer-surface">
                    {attachments.length > 0 ? (
                      <AttachmentList
                        attachments={attachments}
                        onRemove={(attachmentId) => setAttachments((current) => current.filter((attachment) => attachment.id !== attachmentId))}
                      />
                    ) : null}
                    <Textarea
                      aria-label={dmMember ? messages.chat.inputToMember(dmMember.name) : messages.chat.inputToChannel(stripChannelHash(activeChannel.name))}
                      className="slei-composer-input min-h-20 resize-none px-3 py-3"
                      data-testid="slei-composer-input"
                      onChange={(event) => setDraft(event.currentTarget.value)}
                      onCompositionEnd={() => setIsComposing(false)}
                      onCompositionStart={() => setIsComposing(true)}
                      onKeyDown={(event) => {
                      const composing = isComposerImeComposing({ composing: isComposing, nativeEvent: event.nativeEvent });
                      const hasMentionTargets = Boolean(mention && mentionTargets.length > 0);
                      const hasSkillSlashTargets = Boolean(skillSlash && skillSlashTargets.length > 0);
                      if (!composing && skillSlash && hasSkillSlashTargets) {
                        if (event.key === "ArrowDown") {
                          event.preventDefault();
                          setSelectedSkillIndex((current) => moveMentionSelection(current, 1, skillSlashTargets.length));
                          return;
                        }
                        if (event.key === "ArrowUp") {
                          event.preventDefault();
                          setSelectedSkillIndex((current) => moveMentionSelection(current, -1, skillSlashTargets.length));
                          return;
                        }
                        if (event.key === "Escape") {
                          event.preventDefault();
                          setDraft(draft.slice(0, skillSlash.start));
                          setSelectedSkillIndex(0);
                          return;
                        }
                        if ((event.key === "Enter" && !event.shiftKey) || event.key === "Tab") {
                          event.preventDefault();
                          selectSkillSlash();
                          return;
                        }
                      }
                      if (!composing && mention && hasMentionTargets) {
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
                    <div className="flex flex-wrap items-center justify-between gap-2 overflow-visible">
                      {allowAsTask ? (
                        <label className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                          <Checkbox checked={asTask} onCheckedChange={(checked) => setAsTask(checked === true)} />
                          <span>{messages.chat.asTask}</span>
                        </label>
                      ) : <span />}
                      <div className="flex items-center gap-2 overflow-visible">
                        <input accept="image/*" hidden onChange={(event) => void addFiles(event.currentTarget.files)} ref={imageInputRef} type="file" />
                        <input hidden onChange={(event) => void addFiles(event.currentTarget.files)} ref={fileInputRef} type="file" />
                        <Button aria-label={messages.common.addImage} onClick={() => imageInputRef.current?.click()} size="icon-sm" type="button" variant="ghost"><SleiIcon name="image" size={15} /></Button>
                        <Button aria-label={messages.common.addAttachment} onClick={() => fileInputRef.current?.click()} size="icon-sm" type="button" variant="ghost"><SleiIcon name="attachment" size={15} /></Button>
                        <Button data-testid="slei-send-button" disabled={sendDisabled} type="submit" variant="primary"><SleiIcon name="send" size={15} />{messages.common.send}</Button>
                      </div>
                    </div>
                  </Card>
                </form>
                </div>
              </div>
            </div>
          ) : effectiveChannelView === "tasks" ? (
            <ChannelTaskList messages={messages} onTaskThreadOpen={onTaskThreadOpen} tasks={channelTasks} />
          ) : (
            <ChannelFileList files={channelFiles} messages={messages} />
          )}
        </div>
        {renderChannelMemberPanelRegion ? (
          <div
            aria-hidden={showChannelMembersPanel ? "false" : "true"}
            className="min-h-0 overflow-hidden"
            data-testid="slei-channel-member-panel-shell"
          >
            <div
              className={cn(
                "h-full w-80 transform-gpu transition-[opacity,transform] duration-200 ease-out",
                showChannelMembersPanel ? "translate-x-0 opacity-100" : "pointer-events-none translate-x-full opacity-0",
              )}
            >
              <ChannelMemberPanel
                availableMembers={availableChannelMembers}
                channelId={activeChannel.id}
                members={channelMembers}
                messages={messages}
                onAdd={onChannelMemberAdd}
                onRemove={onChannelMemberRemove}
              />
            </div>
          </div>
        ) : null}
      </section>
      <TaskThreadDrawer
        messages={messages}
        onClose={() => setSelectedThreadMessageId(undefined)}
        onReply={selectedThreadMessage && (selectedThreadMessage.thread?.id ? onMessageThreadReply : onMessageThreadReplyFromSource) ? replyToSelectedMessageThread : undefined}
        mentionMembers={data.members}
        open={Boolean(selectedMessageThreadTask)}
        task={selectedMessageThreadTask}
      />
      <TaskThreadDrawer
        messages={messages}
        onClose={() => setSelectedTaskId(undefined)}
        onReply={onTaskReply}
        onStatusChange={onTaskStatusChange}
        mentionMembers={data.members}
        open={Boolean(selectedTask)}
        task={selectedTask}
      />
    </section>
  );
}

function escapeAttributeSelector(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
}
