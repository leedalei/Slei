import { createDesktopMessages } from "../../i18n";
import { renderFeatureShell } from "../shell/AppShell";
import { renderBoardView } from "./BoardView";
import { renderListView } from "./ListView";
import { renderTaskFilters } from "./TaskFilters";
import type { TaskFilters, TaskView } from "./types";

export function renderTasksPage(input: {
  locale: "zh-CN" | "en-US";
  view: "board" | "list";
  filters: TaskFilters;
  tasks: TaskView[];
}): string {
  const labels = createDesktopMessages(input.locale).tasks;
  const view = input.view === "board" ? renderBoardView(input) : renderListView(input);

  return renderFeatureShell({
    active: "tasks",
    locale: input.locale,
    content: [labels.title, renderTaskFilters(input.filters), labels.board, labels.list, view].join("\n"),
  });
}
