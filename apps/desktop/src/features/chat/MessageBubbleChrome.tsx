import type { HTMLAttributes, ReactNode } from "react";

import { cn } from "../../lib/utils";

export type MessageBubbleSide = "incoming" | "outgoing";

export const MESSAGE_BUBBLE_ACTION_BUTTON_CLASS = "size-4 rounded-sm p-0 hover:bg-transparent hover:text-foreground dark:hover:bg-transparent [&_svg]:size-3";
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
        "slei-message-actions pointer-events-none absolute top-0 z-20 flex -translate-y-[70%] items-center gap-0.5 rounded border px-1 py-0.5 opacity-0 backdrop-blur-md transition-[border-color,color,box-shadow,opacity] duration-200 group-hover/bubble:pointer-events-auto group-hover/bubble:opacity-100 group-focus-within/bubble:pointer-events-auto group-focus-within/bubble:opacity-100",
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
