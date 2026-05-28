export function renderNotificationCenter(input: {
  locale: "zh-CN" | "en-US";
  notifications: Array<{ taskTitle: string; payload: string; read: boolean }>;
}): string {
  const title = input.locale === "zh-CN" ? "通知" : "Notifications";
  return [
    title,
    ...input.notifications.map((notification) =>
      [
        notification.taskTitle,
        sanitizeNotification(notification.payload),
        notification.read ? "read" : "unread",
      ].join(" "),
    ),
  ].join("\n");
}

function sanitizeNotification(payload: string): string {
  return payload.replace(/\/workspace\/\S+/g, "[redacted]");
}
