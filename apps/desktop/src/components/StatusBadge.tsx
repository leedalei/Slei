import type { ComponentProps } from "react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

import { SleiIcon } from "./SleiIcon";

export type SleiStatusTone =
  | "approval"
  | "busy"
  | "failed"
  | "idle"
  | "info"
  | "offline"
  | "pending"
  | "running"
  | "success"
  | "warn";

export const sleiStatusBadgeClassNames: Record<SleiStatusTone, string> = {
  approval: "border-amber-500/35 bg-amber-500/12 text-amber-900 dark:text-amber-200",
  busy: "border-amber-500/35 bg-amber-500/12 text-amber-900 dark:text-amber-200",
  failed: "bg-destructive text-destructive-foreground",
  idle: "border-emerald-500/35 bg-emerald-500/12 text-emerald-900 dark:text-emerald-200",
  info: "border-sky-500/35 bg-sky-500/12 text-sky-900 dark:text-sky-200",
  offline: "bg-muted-foreground text-background",
  pending: "bg-muted-foreground/75 text-background",
  running: "border-sky-500/35 bg-sky-500/12 text-sky-900 dark:text-sky-200",
  success: "border-emerald-500/35 bg-emerald-500/12 text-emerald-900 dark:text-emerald-200",
  warn: "border-amber-500/35 bg-amber-500/12 text-amber-900 dark:text-amber-200",
};

export const sleiStatusIndicatorClassNames: Record<SleiStatusTone, string> = {
  approval: "bg-amber-500",
  busy: "bg-amber-500",
  failed: "bg-destructive",
  idle: "bg-emerald-500",
  info: "bg-sky-500",
  offline: "bg-muted-foreground/45",
  pending: "bg-muted-foreground/45",
  running: "bg-sky-500",
  success: "bg-emerald-500",
  warn: "bg-amber-500",
};

export function getSleiStatusBadgeClassName(status: string) {
  return sleiStatusBadgeClassNames[status as SleiStatusTone] ?? "bg-muted text-muted-foreground";
}

export function getSleiStatusIndicatorClassName(status: string) {
  return sleiStatusIndicatorClassNames[status as SleiStatusTone] ?? "bg-muted-foreground/45";
}

export function StatusBadge({
  className,
  label,
  status,
  ...props
}: Omit<ComponentProps<typeof Badge>, "children" | "variant"> & {
  label: string;
  status: string;
}) {
  return (
    <Badge
      {...props}
      className={cn(getSleiStatusBadgeClassName(status), className)}
      data-slei-status={status}
      variant="filled"
    >
      <SleiIcon className="size-3" name="status" />
      {label}
    </Badge>
  );
}
