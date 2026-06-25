import * as React from "react";
import { Slot } from "@radix-ui/react-slot";

import { cn } from "@/lib/utils";

export const selectableCardSelectedClassName =
  "relative overflow-hidden border border-white/30 bg-white/20 text-foreground shadow-[0_10px_28px_rgba(6,182,212,0.18)] backdrop-blur-xl before:pointer-events-none before:absolute before:inset-0 before:block before:rounded-lg before:bg-linear-to-b before:from-white/25 before:to-transparent";

type SelectableCardProps = React.HTMLAttributes<HTMLElement> & {
  asChild?: boolean;
  interactive?: boolean;
  selected?: boolean;
};

export const SelectableCard = React.forwardRef<HTMLElement, SelectableCardProps>(
  ({ asChild = false, className, interactive = true, selected = false, ...props }, ref) => {
    const Comp = (asChild ? Slot : "div") as React.ElementType;

    return (
      <Comp
        ref={ref}
        data-selected={selected ? "true" : "false"}
        data-slot="selectable-card"
        className={cn(
          "relative rounded-lg border border-transparent transition-colors",
          className,
          interactive && !selected && "hover:bg-muted/60",
          selected && selectableCardSelectedClassName,
        )}
        {...props}
      />
    );
  },
);
SelectableCard.displayName = "SelectableCard";
