import type { DesktopMessages } from "../../i18n";
import type { SleiTaskStatus } from "../../app/types";
import { StatusBadge } from "../../components";
import { cn } from "@/lib/utils";

const STATUS_CLASS: Record<SleiTaskStatus, string> = {
  pending_assignment: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  in_progress: "border-blue-500/40 bg-blue-500/10 text-blue-700 dark:text-blue-300",
  in_review: "border-violet-500/40 bg-violet-500/10 text-violet-700 dark:text-violet-300",
  done: "border-green-500/40 bg-green-500/10 text-green-700 dark:text-green-300",
};

export function TaskStatusBadge({ className, messages, status }: { className?: string; messages: DesktopMessages; status: SleiTaskStatus }) {
  return (
    <StatusBadge
      className={cn("w-fit", STATUS_CLASS[status], className)}
      label={messages.tasks.status[status]}
      status={status}
    />
  );
}
