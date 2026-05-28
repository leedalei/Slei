export type ActivityEntry = {
  kind: "run" | "approval" | "delegation";
  title: string;
};

export function renderActivityPanel(input: {
  locale: "zh-CN" | "en-US";
  entries: ActivityEntry[];
}): string {
  const title = input.locale === "zh-CN" ? "活动" : "Activity";
  const empty = input.locale === "zh-CN" ? "暂无活动" : "No activity";
  if (input.entries.length === 0) {
    return `${title} ${empty}`;
  }

  return [title, ...input.entries.map((entry) => `${entry.kind}: ${entry.title}`)].join("\n");
}
