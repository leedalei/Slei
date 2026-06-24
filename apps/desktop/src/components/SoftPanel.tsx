import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

export type SoftPanelVariant = "surface" | "flat" | "raised" | "inset" | "listItem" | "outline";
export type SoftPanelInsetSize = "s" | "m" | "l" | "xl" | "small" | "medium" | "large";

const softPanelVariantClassNames: Record<SoftPanelVariant, string> = {
  surface: "border-border/60 bg-card",
  flat: "border-transparent bg-card",
  raised: "border-transparent bg-card slei-raised-small",
  inset: "border-border/60 bg-muted/40",
  listItem:
    "rounded-lg border-border/60 bg-card/80 slei-raised-small slei-hover-transition hover:bg-card hover:slei-raised-small",
  outline: "border-border/60",
};

const softPanelInsetClassNames: Record<SoftPanelInsetSize, string> = {
  s: "slei-inset-small",
  m: "slei-inset-small",
  l: "slei-inset-small",
  xl: "slei-inset-small",
  small: "slei-inset-small",
  medium: "slei-inset-small",
  large: "slei-inset-small",
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
