import { renderTaskCard } from "./TaskCard";
import type { TaskView } from "./types";

export function renderListView(input: { locale: "zh-CN" | "en-US"; tasks: TaskView[] }): string {
  const title = input.locale === "zh-CN" ? "列表" : "List";
  return [title, ...input.tasks.map((task) => renderTaskCard(task, input.locale))].join("\n");
}

