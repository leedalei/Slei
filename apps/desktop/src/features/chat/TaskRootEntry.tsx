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
  return (
    <article className="group relative grid gap-2 rounded-lg border bg-card px-3 py-3 text-sm" data-task-root-entry={input.task.id}>
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <strong className="block break-words">{input.task.title}</strong>
          <small className="text-xs text-muted-foreground">{input.task.owner}</small>
        </div>
        <Button onClick={input.onOpen} size="sm" type="button" variant="outline">
          <MessageSquare aria-hidden="true" className="size-3.5" />
          {input.messages.tasks.replyCountButton(replyCount)}
        </Button>
      </div>
      <TaskStatusBadge className="justify-self-end" messages={input.messages} status={input.task.status} />
    </article>
  );
}
