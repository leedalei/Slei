import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

export type SoftPanelVariant = "surface" | "flat" | "raised" | "inset" | "listItem";

const softPanelVariantClassNames: Record<SoftPanelVariant, string> = {
  surface: "border-border/60 bg-card",
  flat: "border-transparent bg-card",
  raised: "border-transparent bg-card slei-raised-large",
  inset: "border-border/60 bg-muted/40 slei-inset-large",
  listItem:
    "rounded-lg border-border/60 bg-card/80 slei-raised-small transition-[background-color,box-shadow,color] hover:bg-card hover:slei-raised-medium",
};

export function SoftPanel({
  children,
  className,
  variant = "surface",
  ...props
}: ComponentProps<"section"> & {
  variant?: SoftPanelVariant;
}) {
  return (
    <section
      {...props}
      className={cn(
        "rounded-xl border p-4 text-sm text-card-foreground",
        softPanelVariantClassNames[variant],
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
