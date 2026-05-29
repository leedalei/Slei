import { createDesktopMessages } from "../../i18n";

export function renderInteractiveCard(input: {
  title: string;
  state: "pending" | "confirmed" | "dismissed" | "rejected";
  action: string;
  locale?: "zh-CN" | "en-US";
}): string {
  const messages = createDesktopMessages(input.locale ?? "zh-CN").chat;
  const stateLabel = {
    pending: messages.interactivePending,
    confirmed: messages.confirmed,
    dismissed: messages.dismissed,
    rejected: messages.rejected,
  }[input.state];
  return `${input.title} ${input.action} ${stateLabel}`;
}

export function renderInteractiveCardDialog(input: {
  title: string;
  fieldLabel: string;
  value: string;
  locale?: "zh-CN" | "en-US";
}): string {
  const messages = createDesktopMessages(input.locale ?? "zh-CN");
  return `${input.title} ${input.fieldLabel} ${input.value} ${messages.common.confirmExecute} ${messages.common.cancel}`;
}
