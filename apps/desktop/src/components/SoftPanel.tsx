import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

export type SoftPanelVariant = "surface" | "flat" | "raised" | "inset" | "listItem";
export type SoftPanelInsetSize = "s" | "m" | "l" | "xl" | "small" | "medium" | "large";

const softPanelVariantClassNames: Record<SoftPanelVariant, string> = {
  surface: "border-border/60 bg-card",
  flat: "border-transparent bg-card",
  raised: "border-transparent bg-card slei-raised-large",
  inset: "border-border/60 bg-muted/40",
  listItem:
    "rounded-lg border-border/60 bg-card/80 slei-raised-small transition-[background-color,box-shadow,color] hover:bg-card hover:slei-raised-medium",
};

const softPanelInsetClassNames: Record<SoftPanelInsetSize, string> = {
  s: "slei-inset-s",
  m: "slei-inset-m",
  l: "slei-inset-l",
  xl: "slei-inset-xl",
  small: "slei-inset-small",
  medium: "slei-inset-medium",
  large: "slei-inset-large",
};

export function SoftPanel({
  children,
  className,
  insetSize = "m",
  variant = "surface",
  ...props
}: ComponentProps<"section"> & {
  insetSize?: SoftPanelInsetSize;
  variant?: SoftPanelVariant;
}) {
  return (
    <section
      {...props}
      className={cn(
        "rounded-xl border p-4 text-sm text-card-foreground",
        softPanelVariantClassNames[variant],
        variant === "inset" && softPanelInsetClassNames[insetSize],
        variant === "listItem" && "p-3",
        className,
      )}
      data-slei-panel
      data-variant={variant}
    >
      {children}
    </section>
  );
}
