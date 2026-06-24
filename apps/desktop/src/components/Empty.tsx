import type { EmptySize, EmptyVariant } from "../app/model";
import { cn } from "@/lib/utils";
import emptyData from "../assets/empty-states/empty-data.png";
import emptyError from "../assets/empty-states/empty-error.png";
import emptyInput from "../assets/empty-states/empty-input.png";
import emptyOffline from "../assets/empty-states/empty-offline.png";
import emptyPermission from "../assets/empty-states/empty-permission.png";
import emptySearch from "../assets/empty-states/empty-search.png";
import { SoftPanel } from "./SoftPanel";

type EmptyIllustration = "data" | "error" | "input" | "offline" | "permission" | "search";

const EMPTY_ILLUSTRATIONS: Record<EmptyIllustration, string> = {
  data: emptyData,
  error: emptyError,
  input: emptyInput,
  offline: emptyOffline,
  permission: emptyPermission,
  search: emptySearch,
};

export function Empty(input: {
  title: string;
  chrome?: "default" | "none";
  className?: string;
  description?: string;
  framed?: boolean;
  illustration?: EmptyIllustration;
  variant?: EmptyVariant;
  size?: EmptySize;
  centered?: boolean;
}) {
  const variant = input.variant ?? "nodata";
  const size = input.size ?? "md";
  const illustrationSize = size === "lg" ? "h-28 w-44" : size === "sm" ? "h-16 w-28" : "h-24 w-40";
  const illustration = input.illustration ?? (variant === "noresult" ? "search" : "data");
  const rootClassName = cn(
    input.centered && "mx-auto max-w-xl",
    input.className,
  );
  const framed = input.framed === true || input.chrome === "default";
  const content = (
    <div className={cn("grid gap-3 text-center", size === "lg" ? "p-10" : "p-5")}>
      <div className="mx-auto grid place-items-center" aria-hidden="true" data-empty-icon="true">
        <img
          alt=""
          className={cn("slei-empty__illustration object-contain", illustrationSize)}
          data-empty-asset={illustration}
          data-empty-illustration={variant}
          draggable={false}
          src={EMPTY_ILLUSTRATIONS[illustration]}
        />
      </div>
      <div className="space-y-1">
        <h2 className="text-base font-semibold">{input.title}</h2>
        {input.description ? <p className="text-sm text-muted-foreground">{input.description}</p> : null}
      </div>
    </div>
  );

  if (framed) {
    return (
      <SoftPanel
        className={rootClassName}
        data-empty-size={size}
        data-empty-variant={variant}
        role="status"
      >
        {content}
      </SoftPanel>
    );
  }

  return (
    <div className={rootClassName} data-empty-size={size} data-empty-variant={variant} role="status">
      {content}
    </div>
  );
}
