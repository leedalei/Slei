import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

export type SoftPanelVariant = "surface" | "flat" | "raised" | "inset" | "listItem" | "outline";
export type SoftPanelInsetSize = "s" | "m" | "l" | "xl" | "small" | "medium" | "large";

const softPanelVariantClassNames: Record<SoftPanelVariant, string> = {
  surface: "border-border/60 bg-card",
  flat: "border-transparent bg-card",
  raised: "border-transparent bg-card shadow-[0_8px_24px_rgba(0,0,0,0.24)]",
  inset: "border-border/60 bg-muted/40",
  listItem:
    "rounded-lg border-border/60 bg-card/80 shadow-[0_6px_18px_rgba(0,0,0,0.18)] transition-[background-color,border-color,box-shadow,color] duration-300 hover:bg-card hover:shadow-[0_10px_26px_rgba(0,0,0,0.22)]",
  outline: "border-border/60",
};

const softPanelInsetClassNames: Record<SoftPanelInsetSize, string> = {
  s: "shadow-[inset_0_1px_2px_rgba(0,0,0,0.18)]",
  m: "shadow-[inset_0_1px_2px_rgba(0,0,0,0.18)]",
  l: "shadow-[inset_0_1px_2px_rgba(0,0,0,0.18)]",
  xl: "shadow-[inset_0_1px_2px_rgba(0,0,0,0.18)]",
  small: "shadow-[inset_0_1px_2px_rgba(0,0,0,0.18)]",
  medium: "shadow-[inset_0_1px_2px_rgba(0,0,0,0.18)]",
  large: "shadow-[inset_0_1px_2px_rgba(0,0,0,0.18)]",
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
