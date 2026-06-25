import { cn } from "@/lib/utils";

import { sleiIcons, type SleiIconName, type SleiLucideIconProps } from "./icons";

type SleiIconBaseProps = Omit<SleiLucideIconProps, "aria-hidden" | "aria-label" | "data-slei-icon" | "name" | "stroke" | "strokeWidth"> & {
  name: SleiIconName;
  stroke?: string | number;
  strokeWidth?: string | number;
};

type SleiIconDecorativeProps = SleiIconBaseProps & {
  decorative?: true;
  label?: never;
};

type SleiIconLabelledProps = SleiIconBaseProps & {
  decorative: false;
  label: string;
};

export type SleiIconProps = SleiIconDecorativeProps | SleiIconLabelledProps;

export function SleiIcon({
  name,
  decorative = true,
  label,
  className,
  size = 16,
  stroke = 1.9,
  strokeWidth,
  ...props
}: SleiIconProps) {
  const Icon = sleiIcons[name];

  return (
    <Icon
      {...props}
      aria-hidden={decorative ? "true" : undefined}
      aria-label={!decorative ? label : undefined}
      className={cn("shrink-0", className)}
      data-slei-icon={name}
      size={size}
      strokeWidth={strokeWidth ?? stroke}
    />
  );
}
