import type { ComponentProps, ReactNode } from "react";

import { cn } from "@/lib/utils";

import type { SleiLucideIcon } from "./icons";

export function PageHeader({
  actions,
  className,
  icon: Icon,
  subtitle,
  title,
  ...props
}: Omit<ComponentProps<"header">, "title"> & {
  actions?: ReactNode;
  icon?: SleiLucideIcon;
  subtitle?: ReactNode;
  title: ReactNode;
}) {
  return (
    <header
      {...props}
      className={cn("flex min-w-0 items-start justify-between gap-4", className)}
      data-slei-page-header
    >
      <div className="flex min-w-0 items-start gap-3">
        {Icon ? (
          <span
            aria-hidden="true"
            className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg border border-border/60 text-muted-foreground"
            data-slei-page-header-icon
          >
            <Icon className="size-4" />
          </span>
        ) : null}
        <div className="min-w-0 space-y-1">
          <h1 className="font-heading text-xl font-semibold leading-tight" data-slei-page-header-title>
            {title}
          </h1>
          {subtitle ? (
            <p className="text-sm text-muted-foreground" data-slei-page-header-subtitle>
              {subtitle}
            </p>
          ) : null}
        </div>
      </div>
      {actions ? (
        <div className="flex shrink-0 items-center gap-2" data-slei-page-header-actions>
          {actions}
        </div>
      ) : null}
    </header>
  );
}
