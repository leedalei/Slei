"use client"

import * as React from "react"
import * as PopoverPrimitive from "@radix-ui/react-popover"

import { cn } from "@/lib/utils"

const Popover = PopoverPrimitive.Root
const PopoverTrigger = PopoverPrimitive.Trigger
const PopoverAnchor = PopoverPrimitive.Anchor

const PopoverContent = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(({ className, align = "center", sideOffset = 4, ...props }, ref) => (
  <PopoverPrimitive.Portal>
    <PopoverPrimitive.Content
      ref={ref}
      data-slot="popover-content"
      align={align}
      sideOffset={sideOffset}
      className={cn(
        "t-dropdown z-50 w-72 rounded-xl border border-white/20 bg-white/10 p-4 text-popover-foreground backdrop-blur-2xl",
        "shadow-[0_8px_32px_rgba(0,0,0,0.4)] outline-none",
        className,
      )}
      {...props}
    />
  </PopoverPrimitive.Portal>
))
PopoverContent.displayName = PopoverPrimitive.Content.displayName

const GlassPopover = Popover
const GlassPopoverTrigger = PopoverTrigger
const GlassPopoverContent = PopoverContent
const GlassPopoverAnchor = PopoverAnchor

export {
  GlassPopover,
  GlassPopoverAnchor,
  GlassPopoverContent,
  GlassPopoverTrigger,
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
}
