import type { TaskFilters } from "./types";

export function renderTaskFilters(filters: TaskFilters): string {
  return [
    `# ${filters.channel ?? "CHANNEL"}`,
    `◎ ${filters.creator ?? "CREATOR"}`,
    `♙ ${filters.assignee ?? "ASSIGNEE"}`,
  ].join(" ");
}

