import { cloneElement, isValidElement, useId } from "react";
import type { ComponentProps, ReactElement, ReactNode } from "react";

import { cn } from "@/lib/utils";

type PreferenceControlProps = {
  "aria-describedby"?: string;
  "aria-labelledby"?: string;
  id?: string;
};

export function PreferenceRow({
  className,
  control,
  controlId,
  description,
  error,
  label,
  labelMode = "control",
  ...props
}: Omit<ComponentProps<"div">, "children"> & {
  control: ReactNode;
  controlId?: string;
  description?: ReactNode;
  error?: ReactNode;
  label: ReactNode;
  labelMode?: "control" | "group";
}) {
  const generatedId = useId();
  const controlElement = isValidElement(control)
    ? (control as ReactElement<PreferenceControlProps>)
    : undefined;
  const id = controlElement?.props.id ?? controlId ?? generatedId;
  const labelId = `${id}-label`;
  const descriptionId = description ? `${id}-description` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const ariaDescribedBy = [descriptionId, errorId].filter(Boolean).join(" ") || undefined;
  const renderedControl = controlElement
    ? cloneElement(controlElement, {
        "aria-describedby": controlElement.props["aria-describedby"] ?? ariaDescribedBy,
        ...(labelMode === "group"
          ? { "aria-labelledby": controlElement.props["aria-labelledby"] ?? labelId }
          : { id }),
      })
    : control;

  return (
    <div
      {...props}
      className={cn("grid gap-3 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center", className)}
      data-slei-preference-row
      data-slei-preference-row-invalid={error ? "true" : undefined}
    >
      <div className="min-w-0 space-y-1">
        {labelMode === "group" ? (
          <span className="block text-sm font-medium" data-slei-preference-row-label id={labelId}>
            {label}
          </span>
        ) : (
          <label className="block text-sm font-medium" data-slei-preference-row-label htmlFor={id}>
            {label}
          </label>
        )}
        {description ? (
          <div className="text-sm text-muted-foreground" data-slei-preference-row-description id={descriptionId}>
            {description}
          </div>
        ) : null}
        {error ? (
          <div className="text-sm text-destructive" data-slei-preference-row-error id={errorId} role="alert">
            {error}
          </div>
        ) : null}
      </div>
      <div className="flex items-center justify-start sm:justify-end" data-slei-preference-row-control>
        {renderedControl}
      </div>
    </div>
  );
}
