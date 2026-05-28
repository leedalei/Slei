export type NotificationState = {
  mentions: boolean;
  humanReplies: boolean;
  approvals: boolean;
};

export function renderNotificationSettings(
  notifications: NotificationState,
  locale: "zh-CN" | "en-US",
): string {
  const labels = {
    "zh-CN": {
      mentions: "提及通知",
      humanReplies: "人工回复通知",
      approvals: "审批通知",
    },
    "en-US": {
      mentions: "Mention notifications",
      humanReplies: "Human reply notifications",
      approvals: "Approval notifications",
    },
  }[locale];

  return [
    label(labels.mentions, notifications.mentions),
    label(labels.humanReplies, notifications.humanReplies),
    label(labels.approvals, notifications.approvals),
  ].join(" ");
}

function label(text: string, enabled: boolean): string {
  return `${text}: ${enabled ? "on" : "off"}`;
}
