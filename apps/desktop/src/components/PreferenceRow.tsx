import type { ComponentProps, ReactNode } from "react";

import { cn } from "@/lib/utils";

export function PreferenceRow({
  className,
  control,
  description,
  error,
  label,
  ...props
}: Omit<ComponentProps<"div">, "children"> & {
  control: ReactNode;
  description?: ReactNode;
  error?: ReactNode;
  label: ReactNode;
}) {
  return (
    <div
      {...props}
      className={cn("grid gap-3 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center", className)}
      data-slei-preference-row
      data-slei-preference-row-invalid={error ? "true" : undefined}
    >
      <div className="min-w-0 space-y-1">
        <div className="text-sm font-medium" data-slei-preference-row-label>
          {label}
        </div>
        {description ? (
          <div className="text-sm text-muted-foreground" data-slei-preference-row-description>
            {description}
          </div>
        ) : null}
        {error ? (
          <div className="text-sm text-destructive" data-slei-preference-row-error role="alert">
            {error}
          </div>
        ) : null}
      </div>
      <div className="flex items-center justify-start sm:justify-end" data-slei-preference-row-control>
        {control}
      </div>
    </div>
  );
}
