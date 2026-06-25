import { cn } from "@/lib/utils";

import { SleiIcon } from "./SleiIcon";
import type { SleiIconName, SleiLucideIconProps } from "./icons";

type SleiIconSwapProps = Omit<SleiLucideIconProps, "aria-hidden" | "aria-label" | "data-slei-icon" | "name"> & {
  active: boolean;
  inactiveName: SleiIconName;
  activeName: SleiIconName;
  className?: string;
  iconClassName?: string;
};

export function SleiIconSwap({
  active,
  inactiveName,
  activeName,
  className,
  iconClassName,
  ...iconProps
}: SleiIconSwapProps) {
  return (
    <span className={cn("t-icon-swap shrink-0", className)} data-state={active ? "b" : "a"}>
      <span className="t-icon" data-icon="a">
        <SleiIcon {...iconProps} className={iconClassName} decorative name={inactiveName} />
      </span>
      <span className="t-icon" data-icon="b">
        <SleiIcon {...iconProps} className={iconClassName} decorative name={activeName} />
      </span>
    </span>
  );
}
