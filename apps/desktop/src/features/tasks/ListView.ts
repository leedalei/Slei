import { createDesktopMessages } from "../../i18n";
import { renderTaskCard } from "./TaskCard";
import type { TaskView } from "./types";

export function renderListView(input: { locale: "zh-CN" | "en-US"; tasks: TaskView[] }): string {
  const title = createDesktopMessages(input.locale).tasks.list;
  return [title, ...input.tasks.map((task) => renderTaskCard(task, input.locale))].join("\n");
}
