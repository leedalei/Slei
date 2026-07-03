import * as React from "react";
import { Slot } from "@radix-ui/react-slot";

import { cn } from "@/lib/utils";

export const selectableCardSelectedClassName =
  "border-border bg-accent text-accent-foreground shadow-none";

export const selectableCardFlatSelectedClassName =
  "border-transparent bg-[var(--workspace-sidebar-active-bg)] text-foreground shadow-none backdrop-blur-none";

export const selectableCardCheckboxFieldSelectedClassName =
  "border-input bg-muted/30 text-foreground shadow-none";

type SelectableCardProps = React.HTMLAttributes<HTMLElement> & {
  asChild?: boolean;
  interactive?: boolean;
  selected?: boolean;
  selectedVariant?: "glass" | "flat" | "checkboxField";
};

function selectableCardIdleClassName(selectedVariant: NonNullable<SelectableCardProps["selectedVariant"]>) {
  if (selectedVariant === "flat") return "hover:bg-[var(--workspace-sidebar-hover-bg)]";
  if (selectedVariant === "checkboxField") return "hover:border-input hover:bg-muted/30";
  return "hover:bg-muted/60";
}

function selectableCardSelectedClassNameFor(selectedVariant: NonNullable<SelectableCardProps["selectedVariant"]>) {
  if (selectedVariant === "flat") return selectableCardFlatSelectedClassName;
  if (selectedVariant === "checkboxField") return selectableCardCheckboxFieldSelectedClassName;
  return selectableCardSelectedClassName;
}

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
          interactive && !selected && selectableCardIdleClassName(selectedVariant),
          selected && selectableCardSelectedClassNameFor(selectedVariant),
        )}
        {...props}
      />
    );
  },
);
SelectableCard.displayName = "SelectableCard";
