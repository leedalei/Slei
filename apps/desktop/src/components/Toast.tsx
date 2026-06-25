import { cn } from "../lib/utils";
import { Button } from "@/components/ui/button";
import { GlassNotificationItem, type NotificationType } from "@/components/ui/notification";
import { SleiIcon } from "./SleiIcon";

export const TOAST_VISIBLE_MS = 2500;

export type ToastType = "success" | "info" | "warn" | "error";

type ToastClipboard = {
  writeText: (text: string) => Promise<void> | void;
};

const toastTypeToNotificationType: Record<ToastType, NotificationType> = {
  success: "success",
  info: "info",
  warn: "warning",
  error: "error",
};

export async function copyToastContent(text: string, environment?: { clipboard?: ToastClipboard }) {
  const content = text.trim();
  if (!content) return false;
  const clipboard = environment?.clipboard ?? (typeof navigator !== "undefined" ? navigator.clipboard : undefined);
  if (clipboard?.writeText) {
    await clipboard.writeText(content);
    return true;
  }
  if (typeof document === "undefined") return false;

  const textarea = document.createElement("textarea");
  textarea.value = content;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  return copied;
}

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
          action: (
            <Button
              aria-label="复制通知内容"
              className={cn(
                "h-auto justify-start rounded-md border-white/10 bg-white/5 px-2 py-1.5 text-left text-xs text-white/70 shadow-none hover:bg-white/10 hover:text-white",
                "focus-visible:ring-white/40",
              )}
              data-slot="notification-action"
              onClick={() => void copyToastContent(content)}
              type="button"
              variant="ghost"
            >
              <SleiIcon className="size-3.5 shrink-0" name="copy" />
              复制
            </Button>
          ),
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
