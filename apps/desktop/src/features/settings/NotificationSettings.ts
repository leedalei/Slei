export type NotificationState = {
  mentions: boolean;
  humanReplies: boolean;
  approvals: boolean;
};

export function renderNotificationSettings(
  notifications: NotificationState,
  locale: "zh-CN" | "en-US",
): string {
  const labels = createDesktopMessages(locale).settings;

  return [
    label(labels.mentionNotifications, notifications.mentions),
    label(labels.humanReplyNotifications, notifications.humanReplies),
    label(labels.approvalNotifications, notifications.approvals),
  ].join(" ");
}

function label(text: string, enabled: boolean): string {
  return `${text}: ${enabled ? "on" : "off"}`;
}
import { createDesktopMessages } from "../../i18n";
