import { MessageSquare, ScrollText } from "lucide-react";

import type { DesktopMessages } from "../../i18n";
import type { SleiTask } from "../../app/types";
import { Button } from "@/components/ui/button";
import { TaskStatusBadge } from "../tasks/TaskStatusBadge";

export function TaskRootEntry(input: {
  messages: DesktopMessages;
  onOpen: () => void;
  task: SleiTask;
}) {
  const replyCount = input.task.replyCount ?? input.task.replies?.length ?? 0;
  const replyCountLabel = input.messages.tasks.replyCountButton(replyCount);
  const openLabel = `${input.messages.tasks.commentThread}: ${input.task.title}`;
  const summary = input.task.replies?.find((reply) => reply.id.startsWith("root-") || reply.id.startsWith("root_"))?.body
    ?? input.task.replies?.[0]?.body
    ?? input.task.attention;
  return (
    <article className="group grid gap-2 rounded-lg border border-primary/20 bg-card p-2 text-sm shadow-sm transition-colors hover:border-primary/30 hover:bg-muted/20 sm:grid-cols-[minmax(0,1fr)_auto]" data-task-root-entry={input.task.id}>
      <button
        aria-label={openLabel}
        className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-3 rounded-md px-1 py-1.5 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring"
        data-task-root-entry-trigger="body"
        onClick={input.onOpen}
        type="button"
      >
        <span className="grid size-9 shrink-0 place-items-center rounded-md border border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300" data-task-root-entry-icon>
          <ScrollText aria-hidden="true" className="size-4" />
        </span>
        <span className="grid min-w-0 gap-1">
          <strong className="block break-words">{input.task.title}</strong>
          <span className="flex min-w-0 flex-wrap items-center gap-2">
            <TaskStatusBadge messages={input.messages} status={input.task.status} />
            <small className="truncate text-xs text-muted-foreground">{input.task.owner}</small>
          </span>
          {summary ? <span className="mt-1 block line-clamp-2 break-words text-xs text-muted-foreground">{summary}</span> : null}
        </span>
      </button>
      <Button
        aria-label={`${input.messages.tasks.commentThread}: ${input.task.title}, ${replyCountLabel}`}
        className="self-stretch justify-self-end rounded-md bg-background/70 px-3 group-hover:bg-background"
        data-task-root-entry-trigger="replies"
        onClick={input.onOpen}
        size="sm"
        type="button"
        variant="outline"
      >
        <MessageSquare aria-hidden="true" className="size-3.5" />
        {replyCountLabel}
      </Button>
    </article>
  );
}
