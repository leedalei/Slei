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
  const labels = {
    "zh-CN": { title: "任务", board: "看板", list: "列表" },
    "en-US": { title: "Tasks", board: "Board", list: "List" },
  }[input.locale];
  const view = input.view === "board" ? renderBoardView(input) : renderListView(input);

  return renderFeatureShell({
    active: "tasks",
    locale: input.locale,
    content: [labels.title, renderTaskFilters(input.filters), labels.board, labels.list, view].join("\n"),
  });
}
