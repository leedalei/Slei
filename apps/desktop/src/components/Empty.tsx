import type { EmptySize, EmptyVariant } from "../app/model";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function Empty(input: {
  title: string;
  className?: string;
  description?: string;
  framed?: boolean;
  variant?: EmptyVariant;
  size?: EmptySize;
  centered?: boolean;
}) {
  const variant = input.variant ?? "nodata";
  const size = input.size ?? "md";
  const illustrationSize = size === "lg" ? "h-28 w-44" : size === "sm" ? "h-16 w-28" : "h-24 w-40";
  const framed = input.framed ?? true;
  const rootClassName = cn(
    "border-dashed",
    variant === "noresult" ? "bg-amber-500/10" : "bg-muted/35",
    input.centered && "mx-auto max-w-xl",
    !framed && "rounded-lg border",
    input.className,
  );
  const content = (
    <div className={cn("grid gap-3 text-center", size === "lg" ? "p-10" : "p-5")}>
      <div className="mx-auto grid place-items-center" aria-hidden="true" data-empty-icon="true">
        <svg
          className={cn(
            "slei-empty__illustration",
            `slei-empty__illustration--${variant}`,
            `slei-empty__illustration--${size}`,
            illustrationSize,
          )}
          data-empty-illustration={variant}
          fill="none"
          viewBox="0 0 144 96"
          xmlns="http://www.w3.org/2000/svg"
        >
          <rect className="slei-empty__illustration-shadow" height="60" rx="16" width="94" x="20" y="24" />
          <rect className="slei-empty__illustration-panel slei-empty__illustration-panel--back" height="48" rx="14" width="78" x="42" y="10" />
          <rect className="slei-empty__illustration-panel" height="56" rx="16" width="96" x="18" y="22" />
          <path className="slei-empty__illustration-line" d="M36 42H74" />
          <path className="slei-empty__illustration-line slei-empty__illustration-line--muted" d="M36 56H62" />
          <path className="slei-empty__illustration-line slei-empty__illustration-line--muted" d="M36 66H84" />
          <circle className="slei-empty__illustration-node" cx="96" cy="42" r="5" />
          <circle className="slei-empty__illustration-node slei-empty__illustration-node--muted" cx="92" cy="63" r="4" />
          <circle className="slei-empty__illustration-search" cx="104" cy="58" r="14" />
          <path className="slei-empty__illustration-search" d="M114 68L126 80" />
        </svg>
      </div>
      <div className="space-y-1">
        <h2 className="text-base font-semibold">{input.title}</h2>
        {input.description ? <p className="text-sm text-muted-foreground">{input.description}</p> : null}
      </div>
    </div>
  );

  if (!framed) {
    return (
      <div
        className={rootClassName}
        data-empty-size={size}
        data-empty-variant={variant}
        role="status"
      >
        {content}
      </div>
    );
  }

  return (
    <Card
      className={rootClassName}
      data-empty-size={size}
      data-empty-variant={variant}
      role="status"
    >
      <CardContent className="p-0">{content}</CardContent>
    </Card>
  );
}
