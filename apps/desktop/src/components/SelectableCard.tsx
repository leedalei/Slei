import * as React from "react";
import { Slot } from "@radix-ui/react-slot";

import { cn } from "@/lib/utils";

export const selectableCardSelectedClassName =
  "relative overflow-hidden border border-white/30 bg-white/20 text-foreground shadow-[0_2px_4px_rgba(6,182,212,0.10)] backdrop-blur-xl before:pointer-events-none before:absolute before:inset-0 before:block before:rounded-lg before:bg-linear-to-b before:from-white/25 before:to-transparent";

export const selectableCardFlatSelectedClassName =
  "border-transparent bg-[var(--workspace-sidebar-active-bg)] text-foreground shadow-none backdrop-blur-none";

type SelectableCardProps = React.HTMLAttributes<HTMLElement> & {
  asChild?: boolean;
  interactive?: boolean;
  selected?: boolean;
  selectedVariant?: "glass" | "flat";
};

export const SelectableCard = React.forwardRef<HTMLElement, SelectableCardProps>(
  ({ asChild = false, className, interactive = true, selected = false, selectedVariant = "glass", ...props }, ref) => {
    const Comp = (asChild ? Slot : "div") as React.ElementType;

    return (
      <Comp
        ref={ref}
        data-selected={selected ? "true" : "false"}
        data-slot="selectable-card"
        className={cn(
          "relative rounded-lg border border-transparent transition-colors",
          className,
          interactive && !selected && (selectedVariant === "flat" ? "hover:bg-[var(--workspace-sidebar-hover-bg)]" : "hover:bg-muted/60"),
          selected && (selectedVariant === "flat" ? selectableCardFlatSelectedClassName : selectableCardSelectedClassName),
        )}
        {...props}
      />
    );
  },
);
SelectableCard.displayName = "SelectableCard";
