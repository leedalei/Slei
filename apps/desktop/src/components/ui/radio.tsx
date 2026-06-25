"use client"

import * as React from "react"
import * as RadioGroupPrimitive from "@radix-ui/react-radio-group"
import { motion, type Variants } from "framer-motion"

import { cn } from "@/lib/utils"

const indicatorVariants: Variants = {
  initial: { scale: 0, opacity: 0 },
  checked: {
    scale: 1,
    opacity: 1,
    transition: {
      type: "spring",
      visualDuration: 0.2,
      bounce: 0.5,
    },
  },
}

const RadioGroup = React.forwardRef<
  React.ElementRef<typeof RadioGroupPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Root>
>(({ className, ...props }, ref) => (
  <RadioGroupPrimitive.Root
    ref={ref}
    data-slot="radio-group"
    className={cn("grid gap-3", className)}
    {...props}
  />
))
RadioGroup.displayName = RadioGroupPrimitive.Root.displayName

export interface RadioGroupItemProps extends React.ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Item> {
  label?: string
}

const RadioGroupItem = React.forwardRef<
  React.ElementRef<typeof RadioGroupPrimitive.Item>,
  RadioGroupItemProps
>(({ className, label, id, ...props }, ref) => {
  const fallbackId = React.useId()
  const radioId = id ?? `glass-radio-${props.value}-${fallbackId}`

  return (
    <div className="flex items-center gap-3">
      <RadioGroupPrimitive.Item
        ref={ref}
        id={radioId}
        data-slot="radio-group-item"
        className={cn(
          "aspect-square h-5 w-5 rounded-full",
          "border border-white/35 bg-transparent backdrop-blur-xl",
          "shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]",
          "transition-all duration-200",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/50 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent",
          "disabled:cursor-not-allowed disabled:opacity-50",
          "data-[state=checked]:border-cyan-400/60",
          className,
        )}
        {...props}
      >
        <RadioGroupPrimitive.Indicator className="flex h-full w-full items-center justify-center">
          <motion.div
            className="h-2.5 w-2.5 rounded-full bg-gradient-to-r from-cyan-400 to-blue-400"
            initial="initial"
            animate="checked"
            variants={indicatorVariants}
          />
        </RadioGroupPrimitive.Indicator>
      </RadioGroupPrimitive.Item>
      {label ? (
        <label htmlFor={radioId} className="cursor-pointer select-none text-sm font-medium text-foreground">
          {label}
        </label>
      ) : null}
    </div>
  )
})
RadioGroupItem.displayName = RadioGroupPrimitive.Item.displayName

const GlassRadioGroup = RadioGroup
const GlassRadioGroupItem = RadioGroupItem

export { GlassRadioGroup, GlassRadioGroupItem, RadioGroup, RadioGroupItem }
