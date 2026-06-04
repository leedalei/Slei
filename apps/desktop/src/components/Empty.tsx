import type { EmptySize, EmptyVariant } from "../app/model";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function Empty(input: {
  title: string;
  description?: string;
  variant?: EmptyVariant;
  size?: EmptySize;
  centered?: boolean;
}) {
  const variant = input.variant ?? "nodata";
  const size = input.size ?? "md";
  const pixelFaceSize = size === "lg" ? "size-[72px]" : size === "sm" ? "size-10" : "size-14";

  return (
    <Card
      className={cn(
        "border-dashed",
        variant === "noresult" ? "bg-amber-500/10" : "bg-muted/35",
        input.centered && "mx-auto max-w-xl",
      )}
      data-empty-size={size}
      data-empty-variant={variant}
      role="status"
    >
      <CardContent className={cn("grid gap-3 text-center", size === "lg" ? "p-10" : "p-5")}>
        <div className="mx-auto grid place-items-center" aria-hidden="true" data-empty-icon="true">
          <span
            className={cn(
              "slei-empty__pixel-face relative block rounded-md border shadow-sm [image-rendering:pixelated]",
              `slei-empty--${variant}`,
              `slei-empty--${size}`,
              pixelFaceSize,
              variant === "noresult" ? "bg-amber-500/15" : "bg-background",
            )}
          >
            <span className="slei-empty__pixel slei-empty__pixel--eye slei-empty__pixel--left" />
            <span className="slei-empty__pixel slei-empty__pixel--eye slei-empty__pixel--right" />
            <span className="slei-empty__pixel slei-empty__pixel--mouth" />
            <span className="slei-empty__pixel slei-empty__pixel--mark" />
          </span>
        </div>
        <div className="space-y-1">
          <h2 className="text-base font-semibold">{input.title}</h2>
          {input.description ? <p className="text-sm text-muted-foreground">{input.description}</p> : null}
        </div>
      </CardContent>
    </Card>
  );
}
