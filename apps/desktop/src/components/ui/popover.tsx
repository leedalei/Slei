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
        "t-dropdown z-50 w-72 rounded-lg border border-border/70 bg-popover p-3 text-popover-foreground",
        "shadow-[0_0_4px_rgba(0,0,0,0.12)] outline-none",
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
