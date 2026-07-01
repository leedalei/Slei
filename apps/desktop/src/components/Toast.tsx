import { AlertCircle, AlertTriangle, CheckCircle2, Info, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const TOAST_VISIBLE_MS = 2500;

export type ToastType = "success" | "info" | "warn" | "error";

const toastTypeConfig = {
  success: {
    icon: CheckCircle2,
    type: "success",
    className: "border-emerald-400/30",
    iconClassName: "text-emerald-600 dark:text-emerald-400",
  },
  info: {
    icon: Info,
    type: "info",
    className: "border-cyan-400/30",
    iconClassName: "text-cyan-600 dark:text-cyan-400",
  },
  warn: {
    icon: AlertTriangle,
    type: "warning",
    className: "border-amber-400/30",
    iconClassName: "text-amber-600 dark:text-amber-400",
  },
  error: {
    icon: AlertCircle,
    type: "error",
    className: "border-red-400/30",
    iconClassName: "text-destructive",
  },
};

export function Toast({ message, onDismiss, text, type = "info" }: { message?: string; onDismiss?: () => void; text?: string; type?: ToastType }) {
  const content = (text ?? message)?.trim();
  if (!content) return null;
  const urgent = type === "error";
  const config = toastTypeConfig[type];
  const Icon = config.icon;

  return (
    <div className="pointer-events-none fixed top-4 left-1/2 z-[80] -translate-x-1/2">
      <div
        aria-live={urgent ? "assertive" : "polite"}
        className={cn(
          "pointer-events-auto flex max-w-[70vw] items-center gap-3 rounded-md border bg-popover px-3.5 py-2.5 text-popover-foreground shadow-lg",
          "animate-in fade-in slide-in-from-top-2 duration-200",
          config.className,
        )}
        data-slot="toast"
        data-type={config.type}
        role={urgent ? "alert" : "status"}
      >
        <div className="flex min-w-0 flex-1 items-center gap-3" data-slot="toast-content">
          <Icon className={cn("h-4 w-4 shrink-0", config.iconClassName)} aria-hidden="true" data-slot="toast-icon" />
          <div className="min-w-0 flex-1">
            <p className="whitespace-normal break-words text-sm font-medium" data-slot="toast-title">{content}</p>
          </div>
        </div>
        {onDismiss ? (
          <Button
            aria-label="关闭通知"
            className="-mr-1 size-7 shrink-0 opacity-70 hover:opacity-100 [&_svg]:size-3.5"
            data-slot="toast-close"
            onClick={onDismiss}
            size="icon"
            type="button"
            variant="ghost"
          >
            <X aria-hidden="true" />
          </Button>
        ) : null}
      </div>
    </div>
  );
}
