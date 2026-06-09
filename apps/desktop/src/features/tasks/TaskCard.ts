import { renderAttentionBadge } from "./AttentionBadge";
import type { TaskStatus, TaskView } from "./types";

const NEXT_STATUS: Record<TaskStatus, TaskStatus> = {
  pending_assignment: "in_progress",
  in_progress: "in_review",
  in_review: "done",
  done: "in_progress",
};

const STATUS_LABELS: Record<TaskStatus, string> = {
  pending_assignment: "Pending assignment",
  in_progress: "In progress",
  in_review: "In review",
  done: "Done",
};

export function renderTaskCard(task: TaskView, locale: "zh-CN" | "en-US"): string {
  const attention = renderAttentionBadge(task.attentionRequired, locale);
  const statusAction = `Set status: ${STATUS_LABELS[NEXT_STATUS[task.status]]}`;

  return [
    `#${task.channelName} #${task.sequence}`,
    task.title,
    `Creator: ${task.creator}`,
    task.assignee ? `Assignee: ${task.assignee}` : "",
    STATUS_LABELS[task.status],
    attention,
    statusAction,
  ]
    .filter(Boolean)
    .join(" ");
}
