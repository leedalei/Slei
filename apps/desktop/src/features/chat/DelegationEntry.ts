import { createDesktopMessages } from "../../i18n";

export function renderDelegationEntry(input: {
  from: string;
  to: string;
  taskTitle: string;
  pending: boolean;
  locale?: "zh-CN" | "en-US";
}): string {
  const messages = createDesktopMessages(input.locale ?? "zh-CN");
  return [
    `${input.from} → ${input.to}`,
    input.taskTitle,
    input.pending ? messages.chat.delegationPending : messages.chat.delegated,
    messages.chat.stopFollowingRuns,
  ].join(" ");
}
