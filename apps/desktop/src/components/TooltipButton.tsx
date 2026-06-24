import { useEffect, useRef, useState, type ComponentProps, type PointerEvent, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

type TooltipButtonProps = ComponentProps<typeof Button> & {
  ripple?: boolean;
  rippleColor?: "cyan" | "purple" | "white" | "blue";
  tooltip: ReactNode;
  tooltipSide?: ComponentProps<typeof TooltipContent>["side"];
};

type Ripple = {
  id: number;
  size: number;
  x: number;
  y: number;
};

const rippleColors: Record<NonNullable<TooltipButtonProps["rippleColor"]>, string> = {
  blue: "bg-blue-400/30",
  cyan: "bg-cyan-400/30",
  purple: "bg-purple-400/30",
  white: "bg-white/30",
};

export function TooltipButton({
  children,
  disabled,
  onPointerDown,
  ripple = false,
  rippleColor = "white",
  tooltip,
  tooltipSide,
  ...buttonProps
}: TooltipButtonProps) {
  const [ripples, setRipples] = useState<Ripple[]>([]);
  const nextRippleId = useRef(0);
  const rippleTimers = useRef<Array<ReturnType<typeof setTimeout>>>([]);

  useEffect(() => {
    return () => {
      for (const timer of rippleTimers.current) clearTimeout(timer);
      rippleTimers.current = [];
    };
  }, []);

  function handlePointerDown(event: PointerEvent<HTMLButtonElement>) {
    onPointerDown?.(event);
    if (!ripple || disabled || event.defaultPrevented) return;

    const rect = event.currentTarget.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height) * 2;
    const newRipple = {
      id: ++nextRippleId.current,
      size,
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };

    setRipples((current) => [...current, newRipple]);

    const timer = setTimeout(() => {
      setRipples((current) => current.filter((candidate) => candidate.id !== newRipple.id));
    }, 600);
    rippleTimers.current.push(timer);
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button {...buttonProps} disabled={disabled} onPointerDown={handlePointerDown}>
          {ripple ? (
            <>
              {ripples.map((item) => (
                <span
                  className={`pointer-events-none absolute rounded-full animate-[slei-ripple_600ms_ease-out_forwards] ${rippleColors[rippleColor]}`}
                  data-slot="button-ripple"
                  key={item.id}
                  style={{
                    height: item.size,
                    left: item.x - item.size / 2,
                    top: item.y - item.size / 2,
                    width: item.size,
                  }}
                />
              ))}
              <span className="pointer-events-none relative z-10 inline-flex items-center justify-center gap-2">{children}</span>
            </>
          ) : children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side={tooltipSide}>{tooltip}</TooltipContent>
    </Tooltip>
  );
}
