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
  approval: "bg-amber-500 text-white",
  busy: "bg-amber-500 text-white",
  failed: "bg-destructive text-destructive-foreground",
  idle: "bg-emerald-500 text-white",
  info: "bg-sky-500 text-white",
  offline: "bg-muted-foreground text-background",
  pending: "bg-muted-foreground/75 text-background",
  running: "bg-sky-500 text-white",
  success: "bg-emerald-500 text-white",
  warn: "bg-amber-500 text-white",
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
