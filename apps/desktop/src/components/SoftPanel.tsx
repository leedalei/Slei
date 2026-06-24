import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

export type SoftPanelVariant = "surface" | "raised" | "inset" | "listItem";

const softPanelVariantClassNames: Record<SoftPanelVariant, string> = {
  surface: "border-border/60 bg-card",
  raised: "border-transparent bg-card shadow-[var(--slei-shadow-raised-md)]",
  inset: "border-border/60 bg-muted/40 shadow-[var(--slei-shadow-inset-md)]",
  listItem:
    "rounded-lg border-border/60 bg-card/80 shadow-[var(--slei-shadow-raised-xs)] transition-[background-color,box-shadow,color] hover:bg-card hover:shadow-[var(--slei-shadow-raised-md)]",
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
