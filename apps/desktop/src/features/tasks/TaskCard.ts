import { renderAttentionBadge } from "./AttentionBadge";
import type { TaskStatus, TaskView } from "./types";

const NEXT_STATUS: Record<TaskStatus, TaskStatus> = {
  Todo: "In Progress",
  "In Progress": "In Review",
  "In Review": "Done",
  Done: "Closed",
  Closed: "Closed",
};

export function renderTaskCard(task: TaskView, locale: "zh-CN" | "en-US"): string {
  const attention = renderAttentionBadge(task.attentionRequired, locale);
  const statusAction = `Set status: ${NEXT_STATUS[task.status]}`;

  return [
    `#${task.channelName} #${task.sequence}`,
    task.title,
    `Creator: ${task.creator}`,
    task.assignee ? `Assignee: ${task.assignee}` : "",
    task.status,
    attention,
    statusAction,
  ]
    .filter(Boolean)
    .join(" ");
}

