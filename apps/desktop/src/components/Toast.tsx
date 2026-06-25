import { GlassNotificationItem, type NotificationType } from "@/components/ui/notification";

export const TOAST_VISIBLE_MS = 2500;

export type ToastType = "success" | "info" | "warn" | "error";

const toastTypeToNotificationType: Record<ToastType, NotificationType> = {
  success: "success",
  info: "info",
  warn: "warning",
  error: "error",
};

export function Toast({ message, onDismiss, text, type = "info" }: { message?: string; onDismiss?: () => void; text?: string; type?: ToastType }) {
  const content = (text ?? message)?.trim();
  if (!content) return null;
  const urgent = type === "error";
  const notificationType = toastTypeToNotificationType[type];

  return (
    <div className="pointer-events-none fixed top-4 left-1/2 z-[80] -translate-x-1/2">
      <GlassNotificationItem
        animationClass="slide-in-from-top-full"
        ariaLive={urgent ? "assertive" : "polite"}
        className="max-w-[70vw]"
        closeLabel="关闭通知"
        notification={{
          duration: 0,
          id: "toast",
          title: content,
          type: notificationType,
        }}
        onClose={onDismiss}
        role={urgent ? "alert" : "status"}
        toast
      />
    </div>
  );
}
