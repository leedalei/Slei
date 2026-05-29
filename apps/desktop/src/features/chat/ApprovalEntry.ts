import { createDesktopMessages } from "../../i18n";

export function renderApprovalEntry(input: {
  taskTitle: string;
  action: string;
  risk: string;
  pending: boolean;
  locale?: "zh-CN" | "en-US";
}): string {
  const messages = createDesktopMessages(input.locale ?? "zh-CN");
  return [
    input.pending ? messages.chat.approvalPending : messages.chat.approvalHandled,
    input.taskTitle,
    input.action,
    input.risk,
    messages.common.allow,
    messages.common.deny,
  ].join(" ");
}
