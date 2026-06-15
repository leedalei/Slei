import { MessageSquare, ScrollText } from "lucide-react";

import type { DesktopMessages } from "../../i18n";
import type { SleiMessage, SleiTask } from "../../app/types";
import { TaskStatusBadge } from "../tasks/TaskStatusBadge";

export function TaskRootEntry(input: {
  messages: DesktopMessages;
  onOpen: () => void;
  sourceMessage?: SleiMessage;
  task: SleiTask;
}) {
  const replyCount = input.task.replyCount ?? input.task.replies?.length ?? 0;
  const replyCountLabel = input.messages.tasks.replyCountButton(replyCount);
  const openLabel = `${input.messages.tasks.commentThread}: ${input.task.title}, ${replyCountLabel}`;
  const body = input.sourceMessage?.body
    ?? input.task.replies?.find((reply) => reply.id.startsWith("root-") || reply.id.startsWith("root_"))?.body
    ?? input.task.replies?.[0]?.body
    ?? input.task.attention;
  return (
    <article className="group rounded-lg border border-primary/20 bg-card p-2 text-sm shadow-sm transition-colors hover:border-primary/30 hover:bg-muted/20" data-source-message-id={input.sourceMessage?.id} data-task-root-entry={input.task.id}>
      <button
        aria-label={openLabel}
        className="grid w-full min-w-0 gap-3 rounded-md px-1 py-1.5 text-left outline-none transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring"
        data-task-root-entry-trigger="body"
        onClick={input.onOpen}
        type="button"
      >
        <span className="flex min-w-0 items-start justify-between gap-3">
          <span className="grid min-w-0 gap-1">
            {input.sourceMessage ? (
              <span className="flex min-w-0 items-center gap-1.5 overflow-hidden whitespace-nowrap text-xs text-muted-foreground">
                <strong className="shrink-0 text-sm text-foreground">{input.sourceMessage.author}</strong>
                {input.sourceMessage.handle ? <span className="shrink-0">{input.sourceMessage.handle}</span> : null}
              </span>
            ) : null}
            <strong className="block break-words">{body ?? input.task.title}</strong>
          </span>
          <span className="flex shrink-0 items-center gap-1.5">
            <span className="grid size-7 place-items-center rounded-md border border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300" data-task-root-entry-icon>
              <ScrollText aria-hidden="true" className="size-3.5" />
            </span>
            <TaskStatusBadge messages={input.messages} status={input.task.status} />
          </span>
        </span>
        <span className="flex min-w-0 items-end justify-between gap-3">
          <span className="min-w-0 truncate text-xs text-muted-foreground">
            {input.task.title !== body ? input.task.title : input.task.owner}
          </span>
          <span className="inline-flex shrink-0 items-center gap-1 rounded-md border bg-background/70 px-2 py-1 text-xs text-muted-foreground" data-task-root-entry-trigger="replies">
            <MessageSquare aria-hidden="true" className="size-3.5" />
            {replyCountLabel}
          </span>
        </span>
      </button>
    </article>
  );
}
