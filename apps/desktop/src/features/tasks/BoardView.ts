import { renderTaskCard } from "./TaskCard";
import { TASK_STATUSES, type TaskView } from "./types";

const STATUS_LABELS = {
  Todo: "TODO",
  "In Progress": "IN PROGRESS",
  "In Review": "IN REVIEW",
  Done: "DONE",
  Closed: "CLOSED",
} as const;

export function renderBoardView(input: { locale: "zh-CN" | "en-US"; tasks: TaskView[] }): string {
  return TASK_STATUSES.map((status) => {
    const tasks = input.tasks.filter((task) => task.status === status);
    const empty = `No ${status.toLowerCase()} tasks.`;
    return [
      `${STATUS_LABELS[status]} ${tasks.length}`,
      tasks.length === 0 ? empty : tasks.map((task) => renderTaskCard(task, input.locale)).join("\n"),
    ].join("\n");
  }).join("\n");
}
