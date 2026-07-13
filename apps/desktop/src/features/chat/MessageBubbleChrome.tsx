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
        "slei-message-actions pointer-events-none absolute top-0 z-20 flex h-7 -translate-y-[70%] items-center gap-0.5 rounded-xl border px-1 opacity-0 backdrop-blur-md transition-[background-color,border-color,color,box-shadow,opacity] duration-200 group-hover/bubble:pointer-events-auto group-hover/bubble:opacity-100 group-focus-within/bubble:pointer-events-auto group-focus-within/bubble:opacity-100",
        side === "outgoing" ? "left-2" : "right-2",
        className,
      )}
      data-message-side={side}
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
