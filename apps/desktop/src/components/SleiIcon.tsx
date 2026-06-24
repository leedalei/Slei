import { cn } from "@/lib/utils";

import { sleiIcons, type SleiIconName, type SleiTablerIconProps } from "./icons";

export type SleiIconProps = Omit<SleiTablerIconProps, "name"> & {
  name: SleiIconName;
  decorative?: boolean;
  label?: string;
};

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
      aria-hidden={decorative ? "true" : undefined}
      aria-label={!decorative ? label : undefined}
      className={cn("shrink-0", className)}
      data-slei-icon={name}
      size={size}
      stroke={stroke}
      {...props}
    />
  );
}
