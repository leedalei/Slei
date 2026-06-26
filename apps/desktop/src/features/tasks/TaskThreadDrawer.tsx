import { type FormEvent, useEffect, useRef, useState } from "react";

import type { DesktopMessages } from "../../i18n";
import type { SleiMember, SleiTask, SleiTaskStatus } from "../../app/types";
import { activeMentionQuery, composerShortcutAction, insertMention, isComposerImeComposing, mentionSuggestions, moveMentionSelection } from "../../app/model";
import { SleiIcon } from "../../components";
import { MarkdownMessage } from "../chat/MarkdownMessage";
import { MentionPicker } from "../chat/MentionPicker";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { TaskStatusBadge } from "./TaskStatusBadge";

const CARD_INSET_CLASS = "rounded-xl border-border/60 bg-card text-card-foreground shadow-none backdrop-blur-none before:hidden after:hidden";

export function TaskThreadDrawer(input: {
  initialReplyDraft?: string;
  mentionMembers?: SleiMember[];
  messages: DesktopMessages;
  open: boolean;
  task?: SleiTask;
  onClose: () => void;
  onReply?: (taskId: string, body: string) => Promise<void> | void;
  onStatusChange?: (taskId: string, status: SleiTaskStatus) => Promise<void> | void;
}) {
  const [replyDraft, setReplyDraft] = useState(input.initialReplyDraft ?? "");
  const [replySubmitting, setReplySubmitting] = useState(false);
  const [statusSubmitting, setStatusSubmitting] = useState(false);
  const [replyError, setReplyError] = useState("");
  const [statusError, setStatusError] = useState("");
  const [selectedMentionIndex, setSelectedMentionIndex] = useState(0);
  const [isComposing, setIsComposing] = useState(false);
  const task = input.task;
  const taskId = task?.id;
  const openRef = useRef(input.open);
  const activeTaskIdRef = useRef(taskId);
  const mentionOptionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const mention = activeMentionQuery(replyDraft);
  const mentionTargets = mention ? mentionSuggestions(mention.query, input.mentionMembers ?? []) : [];
  const replyActionDisabled = replySubmitting || statusSubmitting || !input.onReply || !replyDraft.trim();
  const statusActionDisabled = replySubmitting || statusSubmitting || !input.onStatusChange;
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
    setSelectedMentionIndex(0);
    setIsComposing(false);
  }, [input.open, input.initialReplyDraft, task?.id]);

  useEffect(() => {
    if (!mention || mentionTargets.length === 0) return;
    mentionOptionRefs.current[selectedMentionIndex]?.scrollIntoView({ block: "nearest" });
  }, [mention, mentionTargets.length, selectedMentionIndex]);

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
    if (!task || !onStatusChange || replySubmitting || statusSubmitting) return;
    setStatusError("");
    setStatusSubmitting(true);
    try {
      await onStatusChange(task.id, status);
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

  function isDrawerOperationCurrent(operationTaskId: string) {
    return openRef.current && activeTaskIdRef.current === operationTaskId;
  }

  function selectMention(index = selectedMentionIndex) {
    if (!mention || !mentionTargets[index]) return;
    setReplyDraft(insertMention(replyDraft, mention, mentionTargets[index].handle));
    setSelectedMentionIndex(0);
  }

  function renderContent() {
    if (!task) return null;
    return (
      <>
        <SheetHeader className="relative border-b p-5 pr-14">
          <TaskStatusBadge messages={input.messages} status={task.status} />
          <SheetTitle className="sr-only">{task.title}</SheetTitle>
          <SheetDescription>{task.owner} - {input.messages.tasks.replyCountButton(task.replyCount ?? task.replies?.length ?? 0)}</SheetDescription>
          <Button aria-label={input.messages.tasks.closeThread} className="absolute right-3 top-3" onClick={input.onClose} size="icon-sm" type="button" variant="ghost">
            <SleiIcon className="size-4" name="x" />
          </Button>
        </SheetHeader>
        <ScrollArea className="min-h-0 flex-1">
          <div className="grid gap-3 p-5 pb-36" data-slot="task-thread-scroll-content">
            <div data-slot="task-thread-root-body">
              <MarkdownMessage markdown={task.title} />
            </div>
            {(task.replies ?? []).map((reply) => (
              <Card className={`${CARD_INSET_CLASS} grid gap-2 p-4`} data-reply-role={reply.role ?? "human"} key={reply.id}>
                <strong className="text-sm">{reply.sender}</strong>
                <MarkdownMessage markdown={reply.body} />
              </Card>
            ))}
          </div>
        </ScrollArea>
        <SheetFooter className="sticky bottom-0 z-20 block shrink-0 bg-transparent px-5 pb-5 pt-3">
          <form className="grid w-full gap-3" onSubmit={submitReply}>
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
            {task.status === "in_review" ? (
              <div className="flex justify-end">
                <Button disabled={statusActionDisabled} onClick={() => void handleStatusChange("done")} type="button" variant="outline">{input.messages.tasks.markDone}</Button>
              </div>
            ) : null}
            <div className="relative rounded-xl shadow-[0_12px_28px_rgba(15,23,42,0.12)]" data-slot="task-thread-composer">
              <Textarea
                aria-label={input.messages.tasks.replyPlaceholder}
                className="min-h-20 border border-slate-300/90 bg-white/55 pr-16 shadow-none"
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
                value={replyDraft}
              />
              <Button aria-label={input.messages.tasks.sendReply} className="absolute bottom-3 right-3 rounded-full" disabled={replyActionDisabled} size="icon" type="submit" variant="primary">
                <SleiIcon className="size-4" name="send" />
              </Button>
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
        className="w-[min(100vw,680px)] gap-0 border-white/35 bg-white/70 p-0 text-foreground shadow-[0_18px_60px_rgba(15,23,42,0.22)] backdrop-blur-xl before:hidden sm:max-w-[680px]"
        showCloseButton={false}
        showOverlay={false}
      >
        {renderContent()}
      </SheetContent>
    </Sheet>
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
