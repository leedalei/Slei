import { renderTaskCard } from "./TaskCard";
import { TASK_STATUSES, type TaskStatus, type TaskView } from "./types";

const STATUS_LABELS: Record<TaskStatus, string> = {
  pending_assignment: "PENDING ASSIGNMENT",
  in_progress: "IN PROGRESS",
  in_review: "IN REVIEW",
  done: "DONE",
};

export function renderBoardView(input: { locale: "zh-CN" | "en-US"; tasks: TaskView[] }): string {
  return TASK_STATUSES.map((status) => {
    const tasks = input.tasks.filter((task) => task.status === status);
    const label = STATUS_LABELS[status];
    const empty = `No ${label.toLowerCase()} tasks.`;
    return [
      `${label} ${tasks.length}`,
      tasks.length === 0 ? empty : tasks.map((task) => renderTaskCard(task, input.locale)).join("\n"),
    ].join("\n");
  }).join("\n");
}
