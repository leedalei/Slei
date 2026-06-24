import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import type { SleiTablerIcon } from "./icons";

export function DetailBlock({
  action,
  children,
  className,
  description,
  icon: Icon,
  title,
  value,
  ...props
}: Omit<React.ComponentProps<"div">, "title"> & {
  action?: ReactNode;
  description?: ReactNode;
  icon?: SleiTablerIcon;
  title?: ReactNode;
  value?: ReactNode;
}) {
  const hasHeader = Boolean(title || description || Icon || action);
  return (
    <div
      className={cn("grid gap-2 rounded-lg border bg-muted/30 p-3 text-sm", className)}
      data-slot="detail-block"
      {...props}
    >
      {hasHeader ? (
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-3" data-slot="detail-block-header">
          <div className="min-w-0">
            {title || Icon ? (
              <div className="flex min-w-0 items-center gap-2 text-sm font-medium" data-slot="detail-block-title">
                {Icon ? <Icon aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" /> : null}
                {title ? <span className="min-w-0 truncate">{title}</span> : null}
              </div>
            ) : null}
            {description ? (
              <div className="mt-1 text-sm text-muted-foreground" data-slot="detail-block-description">
                {description}
              </div>
            ) : null}
          </div>
          {action ? (
            <div className="shrink-0" data-slot="detail-block-action">
              {action}
            </div>
          ) : null}
        </div>
      ) : null}
      {value ? (
        <div className="break-words text-sm font-medium" data-slot="detail-block-value">
          {value}
        </div>
      ) : null}
      {children ? (
        <div className="grid gap-1 text-sm" data-slot="detail-block-content">
          {children}
        </div>
      ) : null}
    </div>
  );
}
