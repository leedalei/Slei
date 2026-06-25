"use client"

import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "@radix-ui/react-slot"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  cn(
    "inline-flex w-fit shrink-0 items-center justify-center gap-1 rounded-full px-3 py-1 text-xs font-medium",
    "border backdrop-blur-xl transition-all duration-300",
    "[&>svg]:pointer-events-none [&>svg]:size-3",
  ),
  {
    variants: {
      variant: {
        default: "border-white/25 bg-white/15 text-foreground",
        primary: "border-cyan-400/30 bg-linear-to-r from-cyan-500/30 to-blue-500/30 text-cyan-100",
        filled: "border-cyan-400/30 bg-linear-to-r from-cyan-500/30 to-blue-500/30 text-cyan-100",
        secondary: "border-white/20 bg-white/10 text-muted-foreground",
        soft: "border-white/20 bg-white/10 text-muted-foreground",
        success: "border-emerald-400/30 bg-emerald-500/20 text-emerald-100",
        warning: "border-amber-400/30 bg-amber-500/20 text-amber-100",
        destructive: "border-red-400/30 bg-red-500/20 text-red-100",
        outline: "border-white/30 bg-transparent text-foreground",
        ghost: "border-transparent bg-transparent text-muted-foreground hover:bg-white/10 hover:text-foreground",
        link: "border-transparent bg-transparent text-cyan-200 underline-offset-4 hover:underline",
      },
      size: {
        sm: "px-2 py-0.5 text-xs",
        md: "px-3 py-1 text-sm",
        lg: "px-4 py-2 text-base",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "sm",
    },
  },
)

type BadgeProps = React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & {
    asChild?: boolean
  }

function Badge({ className, variant, size, asChild = false, ...props }: BadgeProps) {
  const Comp = asChild ? Slot : "span"
  return (
    <Comp
      data-slot="badge"
      data-variant={variant ?? "default"}
      className={cn(badgeVariants({ variant, size }), className)}
      {...props}
    />
  )
}

const GlassBadge = Badge
const glassBadgeVariants = badgeVariants

export { Badge, GlassBadge, badgeVariants, glassBadgeVariants }
