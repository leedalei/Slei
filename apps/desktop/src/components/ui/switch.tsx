"use client"

import * as React from "react"
import * as SwitchPrimitive from "@radix-ui/react-switch"

import { cn } from "@/lib/utils"

const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitive.Root
    ref={ref}
    data-slot="switch"
    className={cn(
      "peer inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border border-white/20 bg-white/10 backdrop-blur-xl",
      "transition-all duration-300 focus-visible:outline-none",
      "disabled:cursor-not-allowed disabled:opacity-50",
      "data-[state=checked]:border-cyan-400/40 data-[state=checked]:bg-linear-to-r data-[state=checked]:from-cyan-500/60 data-[state=checked]:to-blue-500/60",
      "data-[state=checked]:shadow-[0_0_4px_rgba(6,182,212,0.12)]",
      className,
    )}
    {...props}
  >
    <SwitchPrimitive.Thumb
      data-slot="switch-thumb"
      className={cn(
        "pointer-events-none block h-5 w-5 rounded-full bg-white shadow-[0_2px_4px_rgba(0,0,0,0.12)]",
        "transition-transform duration-300 data-[state=checked]:translate-x-5 data-[state=unchecked]:translate-x-0.5",
      )}
    />
  </SwitchPrimitive.Root>
))
Switch.displayName = SwitchPrimitive.Root.displayName

const GlassSwitch = Switch

export { GlassSwitch, Switch }
