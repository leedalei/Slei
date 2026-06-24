import type { ComponentProps, ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

type TooltipButtonProps = ComponentProps<typeof Button> & {
  tooltip: ReactNode;
  tooltipSide?: ComponentProps<typeof TooltipContent>["side"];
};

export function TooltipButton({
  children,
  tooltip,
  tooltipSide,
  ...buttonProps
}: TooltipButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button {...buttonProps}>{children}</Button>
      </TooltipTrigger>
      <TooltipContent side={tooltipSide}>{tooltip}</TooltipContent>
    </Tooltip>
  );
}
