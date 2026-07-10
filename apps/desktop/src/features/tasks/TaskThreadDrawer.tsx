import { type FormEvent, useEffect, useRef, useState } from "react";

import type { DesktopMessages } from "../../i18n";
import type { SleiMember, SleiTask, SleiTaskReply, SleiTaskStatus } from "../../app/types";
import { activeMentionQuery, composerShortcutAction, insertMention, isComposerImeComposing, mentionSuggestions, moveMentionSelection } from "../../app/model";
import { MemberAvatar, SleiIcon, Toast, TOAST_VISIBLE_MS, TooltipButton, type MemberAvatarIdentity, type SleiIconName, type ToastType } from "../../components";
import { useAutosizeTextarea } from "../../components/useAutosizeTextarea";
import { copyPlainText } from "../../lib/clipboard";
import { MarkdownMessage } from "../chat/MarkdownMessage";
import { MentionPicker } from "../chat/MentionPicker";
import { AgentProfilePopover } from "../chat/AgentProfilePopover";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

const TASK_STATUSES: SleiTaskStatus[] = ["pending_assignment", "in_progress", "in_review", "done"];
const TASK_STATUS_ICONS: Record<SleiTaskStatus, SleiIconName> = {
  pending_assignment: "user",
  in_progress: "loader",
  in_review: "approval",
  done: "check",
};

export function TaskThreadDrawer(input: {
  initialReplyDraft?: string;
  mentionMembers?: SleiMember[];
  messages: DesktopMessages;
  open: boolean;
  task?: SleiTask;
  onClose: () => void;
  onReply?: (taskId: string, body: string) => Promise<void> | void;
  onStatusChange?: (taskId: string, status: SleiTaskStatus) => Promise<void> | void;
  onMemberMessage?: (memberId: string) => void;
}) {
  const [replyDraft, setReplyDraft] = useState(input.initialReplyDraft ?? "");
  const [replySubmitting, setReplySubmitting] = useState(false);
  const [statusSubmitting, setStatusSubmitting] = useState(false);
  const [replyError, setReplyError] = useState("");
  const [statusError, setStatusError] = useState("");
  const [pendingStatus, setPendingStatus] = useState<SleiTaskStatus | null>(null);
  const [toast, setToast] = useState<{ message: string; type: ToastType }>({ message: "", type: "info" });
  const [activeProfileReplyId, setActiveProfileReplyId] = useState<string | undefined>();
  const [selectedMentionIndex, setSelectedMentionIndex] = useState(0);
  const [isComposing, setIsComposing] = useState(false);
  const task = input.task;
  const taskId = task?.id;
  const openRef = useRef(input.open);
  const activeTaskIdRef = useRef(taskId);
  const scrollAreaRef = useRef<HTMLDivElement | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const mentionOptionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const mention = activeMentionQuery(replyDraft);
  const mentionTargets = mention ? mentionSuggestions(mention.query, input.mentionMembers ?? []) : [];
  const replyCount = task?.replies?.length ?? 0;
  const latestReplyId = task?.replies?.at(-1)?.id ?? "";
  const replyActionDisabled = replySubmitting || statusSubmitting || !input.onReply || !replyDraft.trim();
  const statusActionDisabled = replySubmitting || statusSubmitting;
  const replyTextareaRef = useAutosizeTextarea(replyDraft, { maxHeight: () => Math.min(320, window.innerHeight * 0.4) });
  openRef.current = input.open;
  activeTaskIdRef.current = taskId;

  useEffect(() => {
    openRef.current = input.open;
    activeTaskIdRef.current = task?.id;
    setReplyDraft(input.initialReplyDraft ?? "");
    setReplySubmitting(false);
    setStatusSubmitting(false);
    setReplyError("");
    setStatusError("");
    setPendingStatus(null);
    dismissToast();
    setSelectedMentionIndex(0);
    setIsComposing(false);
  }, [input.open, input.initialReplyDraft, task?.id]);

  useEffect(() => () => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
  }, []);

  useEffect(() => {
    if (!mention || mentionTargets.length === 0) return;
    mentionOptionRefs.current[selectedMentionIndex]?.scrollIntoView({ block: "nearest" });
  }, [mention, mentionTargets.length, selectedMentionIndex]);

  useEffect(() => {
    if (!input.open || !taskId || typeof window === "undefined") return undefined;
    const scrollToBottom = () => {
      const viewport = scrollAreaRef.current?.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]');
      if (!viewport) return;
      if (typeof viewport.scrollTo === "function") {
        viewport.scrollTo({ top: viewport.scrollHeight, behavior: "smooth" });
      } else {
        viewport.scrollTop = viewport.scrollHeight;
      }
    };
    if (typeof window.requestAnimationFrame !== "function") {
      scrollToBottom();
      return undefined;
    }
    const frame = window.requestAnimationFrame(scrollToBottom);
    return () => window.cancelAnimationFrame(frame);
  }, [input.open, latestReplyId, replyCount, taskId]);

  async function submitReply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = replyDraft.trim();
    const onReply = input.onReply;
    if (!task || !body || !onReply || replySubmitting || statusSubmitting) return;
    setReplyError("");
    setReplySubmitting(true);
    try {
      await onReply(task.id, body);
      if (isDrawerOperationCurrent(task.id)) {
        setReplyDraft("");
      }
    } catch (error) {
      if (isDrawerOperationCurrent(task.id)) {
        setReplyError(formatTaskActionError("回复失败", error));
      }
    } finally {
      if (isDrawerOperationCurrent(task.id)) {
        setReplySubmitting(false);
      }
    }
  }

  async function handleStatusChange(status: SleiTaskStatus) {
    const onStatusChange = input.onStatusChange;
    if (!task || !onStatusChange || replySubmitting || statusSubmitting || status === task.status) return;
    setStatusError("");
    setStatusSubmitting(true);
    try {
      await onStatusChange(task.id, status);
      if (isDrawerOperationCurrent(task.id)) {
        setPendingStatus(null);
      }
    } catch (error) {
      if (isDrawerOperationCurrent(task.id)) {
        setStatusError(formatTaskActionError("状态更新失败", error));
      }
    } finally {
      if (isDrawerOperationCurrent(task.id)) {
        setStatusSubmitting(false);
      }
    }
  }

  async function copyTaskReply(reply: SleiTaskReply) {
    const copied = await copyPlainText(reply.body);
    if (copied) showToast(input.messages.chat.copySuccess, "success");
  }

  function isDrawerOperationCurrent(operationTaskId: string) {
    return openRef.current && activeTaskIdRef.current === operationTaskId;
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

  function selectMention(index = selectedMentionIndex) {
    if (!mention || !mentionTargets[index]) return;
    setReplyDraft(insertMention(replyDraft, mention, mentionTargets[index].handle));
    setSelectedMentionIndex(0);
  }

  function renderContent() {
    if (!task) return null;
    const pendingStatusLabel = pendingStatus ? input.messages.tasks.status[pendingStatus] : "";
    const replyCount = task.replyCount ?? task.replies?.length ?? 0;
    const timelineStatus = replyCount === 0 && (task.status === "pending_assignment" || task.status === "in_progress")
      ? "pending_assignment"
      : task.status;
    const blockedStatusTargets = replyCount === 0
      ? (["in_progress", "in_review", "done"] satisfies SleiTaskStatus[])
      : [];
    return (
      <>
        <Toast message={toast.message} onDismiss={dismissToast} type={toast.type} />
        <SheetHeader className="slei-task-thread-header relative p-5 pb-0 pr-14">
          <TaskStatusTimeline
            blockedStatuses={blockedStatusTargets}
            disabled={statusActionDisabled}
            messages={input.messages}
            onStatusRequest={setPendingStatus}
            status={timelineStatus}
          />
          <div aria-hidden="true" className="-mx-5 mt-4 border-t border-border" data-slot="task-status-divider" />
          {pendingStatus ? (
            <div
              className="absolute left-5 top-[4.65rem] z-30 grid w-[min(24rem,calc(100%-6rem))] gap-3 rounded-lg border border-border/70 bg-popover/95 p-3 text-popover-foreground shadow-lg backdrop-blur-xl"
              data-slot="task-status-confirm"
              role="alertdialog"
            >
              <div className="grid gap-1">
                <strong className="text-sm">{input.messages.tasks.confirmStatusChange}</strong>
                <p className="text-xs text-muted-foreground">
                  {input.messages.tasks.confirmStatusChangeDescription(input.messages.tasks.status[task.status], pendingStatusLabel)}
                </p>
              </div>
              <div className="flex justify-end gap-2">
                <Button disabled={statusSubmitting} onClick={() => setPendingStatus(null)} size="sm" type="button" variant="outline">
                  {input.messages.common.cancel}
                </Button>
                <Button data-slot="task-status-confirm-action" disabled={statusSubmitting || !input.onStatusChange} onClick={() => void handleStatusChange(pendingStatus)} size="sm" type="button">
                  {input.messages.tasks.confirmStatusChangeAction}
                </Button>
              </div>
            </div>
          ) : null}
          <SheetTitle className="sr-only">{task.title}</SheetTitle>
          <SheetDescription className="sr-only">{input.messages.tasks.thread}</SheetDescription>
          <Button aria-label={input.messages.tasks.closeThread} className="absolute right-3 top-3 size-8 [&_svg]:size-3.5" onClick={input.onClose} size="icon" type="button" variant="ghost">
            <SleiIcon className="size-4" name="x" />
          </Button>
        </SheetHeader>
        <ScrollArea className="min-h-0 flex-1" ref={scrollAreaRef}>
          <div className="grid gap-3 p-5 pb-36" data-slot="task-thread-scroll-content">
            {(task.replies ?? []).map((reply) => {
              const identity = taskReplyAvatarIdentity(reply, input.mentionMembers ?? []);
              const timestamp = taskReplyTimestampLabel(reply);
              const side = (reply.role ?? "human") === "human" ? "outgoing" : "incoming";
              const roleDescription = taskReplyRoleDescription(reply, input.mentionMembers ?? [], input.messages);
              const replyMember = taskReplyMember(reply, input.mentionMembers ?? []);
              const showIdentity = side !== "outgoing";
              const showRoleDescription = showIdentity && Boolean(roleDescription);
              return (
                <article
                  className={cn(
                    "group relative grid gap-3 px-2 py-1",
                    side === "outgoing"
                      ? "grid-cols-[minmax(0,42rem)_auto] justify-end justify-items-end"
                      : "grid-cols-[auto_minmax(min(42rem,100%),1fr)] justify-start justify-items-start",
                  )}
                  data-message-side={side}
                  data-reply-role={reply.role ?? "human"}
                  key={reply.id}
                >
                  {side === "incoming" ? (
                    replyMember?.type === "agent" ? (
                      <AgentProfilePopover
                        align="start"
                        member={replyMember}
                        messages={input.messages}
                        onMessage={replyMember.directMessageEnabled === false ? undefined : () => input.onMemberMessage?.(replyMember.id)}
                        onOpenChange={(open) => setActiveProfileReplyId(open ? reply.id : undefined)}
                        open={activeProfileReplyId === reply.id}
                        status={{ kind: "runtime", status: replyMember.runtimeStatus }}
                        triggerClassName="size-8"
                      >
                        <MemberAvatar identity={replyMember} />
                      </AgentProfilePopover>
                    ) : <MemberAvatar identity={identity} />
                  ) : null}
                  <div className={cn("grid min-w-0 gap-1.5", side === "outgoing" ? "justify-items-end" : "justify-items-start")} data-slot="message-content">
                    <div className={cn("flex w-full min-w-0 items-center gap-2", side === "outgoing" ? "max-w-[min(42rem,100%)] justify-end" : "max-w-full justify-between")}>
                      {showIdentity ? (
                        <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden whitespace-nowrap text-xs text-muted-foreground" data-slot="task-reply-metadata">
                          <strong className="shrink-0 text-sm text-foreground">{identity.name}</strong>
                          {identity.handle ? <span className="shrink-0">{identity.handle}</span> : null}
                          {showRoleDescription ? <Badge className="max-w-full truncate" variant="secondary">{roleDescription}</Badge> : null}
                        </div>
                      ) : null}
                      <div className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground" data-slot="task-reply-actions">
                        <TooltipButton aria-label={input.messages.chat.copyMessage} className="size-6" onClick={() => void copyTaskReply(reply)} size="icon" tooltip={input.messages.chat.copyMessage} type="button" variant="ghost">
                          <SleiIcon className="size-3" name="copy" />
                        </TooltipButton>
                        {timestamp ? (
                          <>
                            <span aria-hidden="true">｜</span>
                            <time className="whitespace-nowrap tabular-nums" dateTime={reply.sentAt ?? timestamp}>
                              {timestamp}
                            </time>
                          </>
                        ) : null}
                      </div>
                    </div>
                    <div
                      className={cn(
                        "grid gap-2 rounded-2xl px-3.5 py-2.5",
                        side === "outgoing"
                          ? "w-fit max-w-[min(42rem,100%)] rounded-tr-sm bg-primary text-primary-foreground shadow-sm"
                          : "w-full max-w-full rounded-tl-sm bg-muted/60 text-card-foreground shadow-sm ring-1 ring-border/60",
                      )}
                      data-slot="message-bubble"
                    >
                      <MarkdownMessage
                        copyCodeLabel={input.messages.chat.copyMessage}
                        markdown={reply.body}
                        onCodeCopied={() => showToast(input.messages.chat.copySuccess, "success")}
                        tone={side === "outgoing" ? "primary" : "card"}
                      />
                    </div>
                  </div>
                  {side === "outgoing" ? <MemberAvatar identity={identity} /> : null}
                </article>
              );
            })}
          </div>
        </ScrollArea>
        <SheetFooter className="absolute inset-x-0 bottom-0 z-20 block bg-transparent px-5 pb-5 pt-3 pointer-events-none">
          <form className="grid w-full gap-3 pointer-events-auto" onSubmit={submitReply}>
            {mention && mentionTargets.length > 0 ? (
              <MentionPicker
                members={mentionTargets}
                messages={input.messages}
                onSelect={selectMention}
                optionRef={(index, node) => {
                  mentionOptionRefs.current[index] = node;
                }}
                selectedIndex={selectedMentionIndex}
              />
            ) : null}
            <div
              className="slei-composer-glass slei-modal-composer slei-task-thread-composer relative rounded-2xl border border-border/60 p-3 backdrop-blur-xl"
              data-slot="task-thread-composer"
            >
              <div className="relative grid" data-slot="task-thread-composer-inner">
                <Textarea
                  aria-label={input.messages.tasks.replyPlaceholder}
                  className="slei-composer-input slei-task-thread-input max-h-[min(320px,40vh)] min-h-20 resize-none border-0 bg-transparent pr-16 shadow-none placeholder:text-muted-foreground"
                  disabled={replySubmitting || statusSubmitting}
                  onChange={(event) => setReplyDraft(event.currentTarget.value)}
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
                        setReplyDraft(replyDraft.slice(0, mention.start));
                        return;
                      }
                    }
                    const action = composerShortcutAction({ key: event.key, shiftKey: event.shiftKey, composing, hasMentionTargets });
                    if (action === "selectMention") {
                      event.preventDefault();
                      selectMention();
                    }
                    if (action === "submit") {
                      event.preventDefault();
                      event.currentTarget.form?.requestSubmit();
                    }
                  }}
                  placeholder={input.messages.tasks.replyPlaceholder}
                  ref={replyTextareaRef}
                  value={replyDraft}
                />
                <Button aria-label={input.messages.tasks.sendReply} className="absolute bottom-3 right-3 rounded-full" disabled={replyActionDisabled} size="icon" type="submit">
                  <SleiIcon className="size-4" name="arrowUp" />
                </Button>
              </div>
            </div>
            {replyError ? <p className="text-sm text-destructive" role="alert">{replyError}</p> : null}
            {statusError ? <p className="text-sm text-destructive" role="alert">{statusError}</p> : null}
          </form>
        </SheetFooter>
      </>
    );
  }

  return (
    <Sheet open={input.open} onOpenChange={(open) => !open && input.onClose()}>
      {/* Radix portal content is omitted from renderToStaticMarkup; keep static tests observing the drawer body. */}
      {typeof document === "undefined" && input.open && task ? <div hidden>{renderContent()}</div> : null}
      <SheetContent
        aria-label={input.messages.tasks.thread}
        className="slei-task-thread-surface w-[min(100vw,680px)] gap-0 p-0 text-foreground before:hidden sm:max-w-[680px]"
        showCloseButton={false}
        showOverlay={false}
      >
        {renderContent()}
      </SheetContent>
    </Sheet>
  );
}

function TaskStatusTimeline(input: {
  blockedStatuses?: SleiTaskStatus[];
  disabled: boolean;
  messages: DesktopMessages;
  onStatusRequest: (status: SleiTaskStatus) => void;
  status: SleiTaskStatus;
}) {
  const currentIndex = TASK_STATUSES.indexOf(input.status);
  const blockedStatuses = new Set(input.blockedStatuses ?? []);
  return (
    <div
      aria-label={input.messages.tasks.changeStatus}
      className="inline-grid w-auto grid-cols-[repeat(4,4.75rem)] justify-start gap-0"
      data-slot="task-status-timeline"
      role="list"
    >
      {TASK_STATUSES.map((status, index) => {
        const isCurrent = status === input.status;
        const isComplete = index < currentIndex;
        const isReached = isCurrent || isComplete;
        const isBlocked = blockedStatuses.has(status);
        return (
          <button
            aria-current={isCurrent ? "step" : undefined}
            aria-label={`${input.messages.tasks.changeStatus}: ${input.messages.tasks.status[status]}`}
            className={cn(
              "group relative grid min-w-0 rounded-md py-1 text-xs transition-colors",
              "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
              isCurrent ? "text-foreground" : "text-muted-foreground hover:text-foreground",
              input.disabled || isBlocked ? "cursor-not-allowed opacity-60" : "cursor-pointer",
              index === 0 ? "justify-items-start" : index === TASK_STATUSES.length - 1 ? "justify-items-end" : "justify-items-center",
            )}
            data-current={isCurrent ? "true" : undefined}
            data-task-status-node={status}
            disabled={input.disabled || isBlocked}
            key={status}
            onClick={() => {
              if (isCurrent || isBlocked) return;
              input.onStatusRequest(status);
            }}
            role="listitem"
            type="button"
          >
            {index > 0 ? <span className="absolute left-0 top-3.5 h-px w-1/2 bg-border" aria-hidden="true" /> : null}
            {index < TASK_STATUSES.length - 1 ? <span className="absolute right-0 top-3.5 h-px w-1/2 bg-border" aria-hidden="true" /> : null}
            <span className="relative z-10 grid justify-items-center gap-2" data-task-status-node-content={status}>
              <span
                className={cn(
                  "grid size-6 place-items-center rounded-full border ring-4 ring-background transition-colors",
                  isReached
                    ? "border-primary/40 bg-primary text-primary-foreground shadow-xs"
                    : "border-border bg-muted text-muted-foreground shadow-none",
                )}
                data-reached={isReached ? "true" : "false"}
                data-task-status-icon={status}
              >
                <SleiIcon className={cn("size-3.5", status === "in_progress" && isCurrent ? "animate-spin" : "")} name={TASK_STATUS_ICONS[status]} />
              </span>
              <span className="max-w-full truncate text-center text-[10px] leading-4" data-task-status-label={status}>{input.messages.tasks.status[status]}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

function formatTaskActionError(prefix: string, error: unknown) {
  const detail = error instanceof Error
    ? error.message
    : typeof error === "string"
      ? error
      : "";
  return detail.trim() ? `${prefix}：${detail}` : prefix;
}

function taskReplyAvatarIdentity(reply: SleiTaskReply, members: SleiMember[]): MemberAvatarIdentity {
  const member = taskReplyMember(reply, members);
  if (member) return member;
  const handle = reply.handle ?? (reply.sender.startsWith("@") ? reply.sender : `@${reply.sender}`);
  return {
    id: `${reply.role ?? "reply"}-${reply.sender}`,
    name: reply.sender,
    handle,
    avatar: reply.avatar ?? reply.sender.slice(0, 2).toUpperCase(),
  };
}

function taskReplyMember(reply: SleiTaskReply, members: SleiMember[]): SleiMember | undefined {
  if (reply.memberId) {
    const member = members.find((candidate) => candidate.id === reply.memberId);
    if (member) return member;
  }
  const normalizedSender = normalizeTaskReplyAuthor(reply.sender);
  const normalizedHandle = reply.handle ? normalizeTaskReplyAuthor(reply.handle) : "";
  return members.find((candidate) => {
    const normalizedName = normalizeTaskReplyAuthor(candidate.name);
    const candidateHandle = normalizeTaskReplyAuthor(candidate.handle);
    return normalizedName === normalizedSender || candidateHandle === normalizedSender || (normalizedHandle && candidateHandle === normalizedHandle);
  });
}

function taskReplyRoleDescription(reply: SleiTaskReply, members: SleiMember[], messages: DesktopMessages): string {
  if ((reply.role ?? "human") === "human") return "";
  const member = taskReplyMember(reply, members);
  return member?.profession ?? member?.role ?? messages.chat.roleLabels[reply.role ?? "human"];
}

function taskReplyTimestampLabel(reply: SleiTaskReply): string {
  const raw = (reply.sentAt ?? reply.time ?? "").trim();
  const match = raw.match(/^(?:(\d{4})-)?(\d{2}-\d{2})[T ](\d{2}:\d{2})(?::\d{2})?/);
  if (match) return `${match[2]} ${match[3]}`;
  return raw;
}

function normalizeTaskReplyAuthor(author: string) {
  return author.trim().replace(/^@/, "").toLowerCase();
}
