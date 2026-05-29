import { createDesktopMessages } from "../../i18n";

export function renderNotificationCenter(input: {
  locale: "zh-CN" | "en-US";
  notifications: Array<{ taskTitle: string; payload: string; read: boolean }>;
}): string {
  const title = createDesktopMessages(input.locale).settings.notifications;
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
