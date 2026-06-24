import { cn } from "../lib/utils";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { SoftPanel } from "./SoftPanel";

export const TOAST_VISIBLE_MS = 2500;

export type ToastType = "success" | "info" | "warn" | "error";

type ToastClipboard = {
  writeText: (text: string) => Promise<void> | void;
};

const toastVariantClassNames: Record<ToastType, string> = {
  success: "border-emerald-500/50 text-emerald-950 dark:text-emerald-50",
  info: "border-sky-500/50 text-sky-950 dark:text-sky-50",
  warn: "border-amber-500/60 text-amber-950 dark:text-amber-50",
  error: "border-destructive/60 text-destructive",
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

export function Toast({ message, text, type }: { message?: string; text?: string; type?: ToastType }) {
  const content = (text ?? message)?.trim();
  if (!content) return null;
  const urgent = type === "error";
  const variantClassName = type ? toastVariantClassNames[type] : "border-border text-popover-foreground";

  return (
    <div aria-live={urgent ? "assertive" : "polite"} className="pointer-events-none fixed top-4 left-1/2 z-[80] -translate-x-1/2" role={urgent ? "alert" : "status"}>
      <SoftPanel className={cn("pointer-events-auto max-w-[70vw] p-0", variantClassName)} variant="raised">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              className="h-auto w-full justify-start rounded-[inherit] border-0 bg-transparent px-4 py-3 text-left text-sm text-inherit whitespace-normal break-words shadow-none hover:bg-transparent"
              onClick={() => void copyToastContent(content)}
              type="button"
              variant="ghost"
            >
              {content}
            </Button>
          </TooltipTrigger>
          <TooltipContent>点击复制</TooltipContent>
        </Tooltip>
      </SoftPanel>
    </div>
  );
}
