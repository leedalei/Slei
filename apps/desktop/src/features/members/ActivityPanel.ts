export type ActivityEntry = {
  kind: "run" | "approval" | "delegation";
  title: string;
};

export function renderActivityPanel(input: {
  locale: "zh-CN" | "en-US";
  entries: ActivityEntry[];
}): string {
  const messages = createDesktopMessages(input.locale).members;
  const title = messages.activity;
  const empty = messages.noActivity;
  if (input.entries.length === 0) {
    return `${title} ${empty}`;
  }

  return [title, ...input.entries.map((entry) => `${entry.kind}: ${entry.title}`)].join("\n");
}
import { createDesktopMessages } from "../../i18n";
