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
  const size = input.size ?? "md";

  return (
    <Card className={cn("border-dashed bg-muted/35", input.centered && "mx-auto max-w-xl")} role="status">
      <CardContent className={cn("grid gap-3 text-center", size === "lg" ? "p-10" : "p-5")}>
        <div className="mx-auto grid size-12 place-items-center rounded-md border bg-background" aria-hidden="true">
          <span className="slei-empty__pixel-face">
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
