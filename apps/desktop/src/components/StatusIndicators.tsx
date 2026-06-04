import type { SleiMessage } from "../app/fixtures";
import { cn } from "@/lib/utils";

export function MessageStatusSquare({ status }: { status?: SleiMessage["status"] }) {
  const tone = messageStatusSquare(status);
  if (!tone) return null;
  return (
    <span
      aria-label={status}
      className={cn(
        "inline-block size-2.5 shrink-0 rounded-[2px]",
        tone === "running" && "bg-sky-500",
        tone === "approval" && "bg-amber-500",
        tone === "failed" && "bg-destructive",
        tone === "pending" && "bg-muted-foreground/45",
      )}
      role="img"
      title={status}
    />
  );
}

export function StatusDot({ status }: { status: "idle" | "busy" | "offline" }) {
  return (
    <span
      aria-label={status}
      className={cn(
        "inline-block size-2 shrink-0 rounded-full align-middle",
        status === "idle" && "bg-emerald-500",
        status === "busy" && "bg-amber-500",
        status === "offline" && "bg-muted-foreground/45",
      )}
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
