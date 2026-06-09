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
  const task = input.task;

  async function submitReply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = replyDraft.trim();
    if (!task || !body) return;
    await input.onReply?.(task.id, body);
    setReplyDraft("");
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
              onChange={(event) => setReplyDraft(event.currentTarget.value)}
              placeholder={input.messages.tasks.replyPlaceholder}
              value={replyDraft}
            />
            <div className="flex flex-wrap justify-end gap-2">
              {task.status === "in_progress" ? <Button onClick={() => input.onStatusChange?.(task.id, "in_review")} type="button" variant="outline">{input.messages.tasks.markInReview}</Button> : null}
              {task.status === "in_review" ? <Button onClick={() => input.onStatusChange?.(task.id, "done")} type="button" variant="outline">{input.messages.tasks.markDone}</Button> : null}
              <Button type="submit">
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
      {typeof document === "undefined" && task ? <div hidden>{renderContent()}</div> : null}
      <SheetContent aria-label={input.messages.tasks.thread} className="w-[min(100vw,680px)] gap-0 p-0 sm:max-w-[680px]" showCloseButton={false}>
        {renderContent()}
      </SheetContent>
    </Sheet>
  );
}
