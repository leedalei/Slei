import type { HTMLAttributes, ReactNode } from "react";

import { cn } from "../../lib/utils";

export type MessageBubbleSide = "incoming" | "outgoing";

export const MESSAGE_BUBBLE_ACTION_BUTTON_CLASS = "size-6 [&_svg]:size-3";
export const MESSAGE_BUBBLE_ACTION_ICON_CLASS = "size-3";

export function MessageBubbleActionToolbar({
  children,
  className,
  side,
  slot = "message-actions",
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
  side: MessageBubbleSide;
  slot?: string;
}) {
  return (
    <div
      {...props}
      className={cn(
        "pointer-events-none absolute top-0 z-20 flex h-8 -translate-y-1/2 items-center gap-0.5 rounded-xl border border-border/70 bg-background/95 px-1 text-muted-foreground opacity-0 shadow-sm backdrop-blur transition-opacity duration-150 group-hover/bubble:pointer-events-auto group-hover/bubble:opacity-100 group-focus-within/bubble:pointer-events-auto group-focus-within/bubble:opacity-100",
        side === "outgoing" ? "left-2" : "right-2",
        className,
      )}
      data-slot={slot}
    >
      {children}
    </div>
  );
}

export function MessageBubbleTime({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span className={cn("flex shrink-0 items-center gap-1 pb-1 text-xs text-muted-foreground tabular-nums", className)} data-slot="message-time">
      {children}
    </span>
  );
}
