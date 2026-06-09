import { type FormEvent, useState } from "react";
import { Send, X } from "lucide-react";

import type { DesktopMessages } from "../../i18n";
import type { SleiTask, SleiTaskStatus } from "../../app/fixtures";
import { MarkdownMessage } from "../chat/MarkdownMessage";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { TaskStatusBadge } from "./TaskStatusBadge";

export function TaskThreadDrawer(input: {
  messages: DesktopMessages;
  open: boolean;
  task?: SleiTask;
  onClose: () => void;
  onReply?: (taskId: string, body: string) => Promise<void> | void;
  onStatusChange?: (taskId: string, status: SleiTaskStatus) => Promise<void> | void;
}) {
  const [replyDraft, setReplyDraft] = useState("");
  const [replySubmitting, setReplySubmitting] = useState(false);
  const [statusSubmitting, setStatusSubmitting] = useState(false);
  const [replyError, setReplyError] = useState("");
  const [statusError, setStatusError] = useState("");
  const task = input.task;
  const statusActionDisabled = statusSubmitting || !input.onStatusChange;

  async function submitReply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = replyDraft.trim();
    if (!task || !body || !input.onReply || replySubmitting) return;
    setReplyError("");
    setReplySubmitting(true);
    try {
      await input.onReply(task.id, body);
      setReplyDraft("");
    } catch (error) {
      setReplyError(formatTaskActionError("回复失败", error));
    } finally {
      setReplySubmitting(false);
    }
  }

  async function handleStatusChange(status: SleiTaskStatus) {
    if (!task || !input.onStatusChange || statusSubmitting) return;
    setStatusError("");
    setStatusSubmitting(true);
    try {
      await input.onStatusChange(task.id, status);
    } catch (error) {
      setStatusError(formatTaskActionError("状态更新失败", error));
    } finally {
      setStatusSubmitting(false);
    }
  }

  function renderContent() {
    if (!task) return null;
    return (
      <>
        <SheetHeader className="relative border-b p-5 pr-14">
          <TaskStatusBadge messages={input.messages} status={task.status} />
          <SheetTitle>{task.title}</SheetTitle>
          <SheetDescription>{task.owner} - {input.messages.tasks.replyCountButton(task.replyCount ?? task.replies?.length ?? 0)}</SheetDescription>
          <Button aria-label={input.messages.tasks.closeThread} className="absolute right-3 top-3" onClick={input.onClose} size="icon-sm" type="button" variant="ghost">
            <X aria-hidden="true" className="size-4" />
          </Button>
        </SheetHeader>
        <ScrollArea className="min-h-0 flex-1">
          <div className="grid gap-3 p-5">
            {(task.replies ?? []).map((reply) => (
              <article className="grid gap-2 rounded-lg border bg-muted/30 p-3" data-reply-role={reply.role ?? "human"} key={reply.id}>
                <strong className="text-sm">{reply.sender}</strong>
                <MarkdownMessage markdown={reply.body} />
              </article>
            ))}
          </div>
        </ScrollArea>
        <SheetFooter className="border-t p-4">
          <form className="grid gap-3" onSubmit={submitReply}>
            <Textarea
              aria-label={input.messages.tasks.replyPlaceholder}
              disabled={replySubmitting}
              onChange={(event) => setReplyDraft(event.currentTarget.value)}
              placeholder={input.messages.tasks.replyPlaceholder}
              value={replyDraft}
            />
            {replyError ? <p className="text-sm text-destructive" role="alert">{replyError}</p> : null}
            {statusError ? <p className="text-sm text-destructive" role="alert">{statusError}</p> : null}
            <div className="flex flex-wrap justify-end gap-2">
              {task.status === "in_progress" ? <Button disabled={statusActionDisabled} onClick={() => void handleStatusChange("in_review")} type="button" variant="outline">{input.messages.tasks.markInReview}</Button> : null}
              {task.status === "in_review" ? <Button disabled={statusActionDisabled} onClick={() => void handleStatusChange("done")} type="button" variant="outline">{input.messages.tasks.markDone}</Button> : null}
              <Button disabled={replySubmitting || !input.onReply} type="submit">
                <Send aria-hidden="true" className="size-4" />
                {input.messages.tasks.sendReply}
              </Button>
            </div>
          </form>
        </SheetFooter>
      </>
    );
  }

  return (
    <Sheet open={input.open} onOpenChange={(open) => !open && input.onClose()}>
      {/* Radix portal content is omitted from renderToStaticMarkup; keep static tests observing the drawer body. */}
      {typeof document === "undefined" && input.open && task ? <div hidden>{renderContent()}</div> : null}
      <SheetContent aria-label={input.messages.tasks.thread} className="w-[min(100vw,680px)] gap-0 p-0 sm:max-w-[680px]" showCloseButton={false}>
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
