import type { SleiMessage } from "../app/types";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { getSleiStatusIndicatorClassName } from "./StatusBadge";

export function MessageStatusSquare({ status }: { status?: SleiMessage["status"] }) {
  const tone = messageStatusSquare(status);
  if (!tone) return null;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          aria-label={status}
          className={cn(
            "inline-block size-2.5 shrink-0 rounded-[2px]",
            getSleiStatusIndicatorClassName(tone),
          )}
          role="img"
        />
      </TooltipTrigger>
      <TooltipContent>{status}</TooltipContent>
    </Tooltip>
  );
}

export function StatusDot({ status }: { status: "idle" | "busy" | "offline" }) {
  return (
    <span
      aria-label={status}
      className={cn("inline-block size-2 shrink-0 rounded-full align-middle", getSleiStatusIndicatorClassName(status))}
      role="img"
    />
  );
}

function messageStatusSquare(status?: SleiMessage["status"]): "running" | "approval" | "failed" | "pending" | undefined {
  if (status === "running") return "running";
  if (status === "approval") return "approval";
  if (status === "failed") return "failed";
  if (status === "pending" || status === "undecided") return "pending";
  return undefined;
}
