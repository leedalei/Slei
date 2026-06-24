import { cn } from "@/lib/utils";

import { sleiIcons, type SleiIconName, type SleiTablerIconProps } from "./icons";

type SleiIconBaseProps = Omit<SleiTablerIconProps, "aria-hidden" | "aria-label" | "data-slei-icon" | "name"> & {
  name: SleiIconName;
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
      stroke={stroke}
    />
  );
}
