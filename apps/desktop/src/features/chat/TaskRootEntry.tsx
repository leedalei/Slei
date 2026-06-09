import { MessageSquare } from "lucide-react";

import type { DesktopMessages } from "../../i18n";
import type { SleiTask } from "../../app/fixtures";
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
  return (
    <article className="group grid gap-2 rounded-lg border bg-card p-2 text-sm sm:grid-cols-[minmax(0,1fr)_auto]" data-task-root-entry={input.task.id}>
      <button
        aria-label={openLabel}
        className="grid min-w-0 gap-2 rounded-md px-1 py-1.5 text-left outline-none transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring"
        data-task-root-entry-trigger="body"
        onClick={input.onOpen}
        type="button"
      >
        <span className="min-w-0">
          <strong className="block break-words">{input.task.title}</strong>
          <small className="text-xs text-muted-foreground">{input.task.owner}</small>
        </span>
        <TaskStatusBadge className="justify-self-start" messages={input.messages} status={input.task.status} />
      </button>
      <Button
        aria-label={`${input.messages.tasks.commentThread}: ${input.task.title}, ${replyCountLabel}`}
        className="self-start justify-self-end"
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
