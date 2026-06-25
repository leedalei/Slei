"use client"

import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "@radix-ui/react-slot"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  cn(
    "relative inline-flex cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-xl",
    "border text-sm font-medium transition-all duration-300 ease-out",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent",
    "disabled:pointer-events-none disabled:opacity-50",
    "hover:border-white/40 hover:bg-white/20",
    "[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  ),
  {
    variants: {
      variant: {
        default: cn(
          "border-white/30 bg-white/20 text-white backdrop-blur-xl",
          "shadow-[0_4px_16px_rgba(0,0,0,0.2)]",
          "before:pointer-events-none before:absolute before:inset-0 before:rounded-xl",
          "before:bg-linear-to-b before:from-white/20 before:to-transparent",
        ),
        primary: cn(
          "border-white/30 bg-linear-to-r from-cyan-500/80 via-blue-500/80 to-purple-500/80 text-white backdrop-blur-xl",
          "shadow-[0_4px_20px_rgba(59,130,246,0.4)] hover:shadow-[0_4px_30px_rgba(59,130,246,0.6)]",
          "before:pointer-events-none before:absolute before:inset-0 before:rounded-xl",
          "before:bg-linear-to-b before:from-white/30 before:to-transparent",
        ),
        secondary: "border-white/25 bg-white/15 text-white backdrop-blur-xl shadow-[0_4px_16px_rgba(0,0,0,0.18)]",
        outline: "border-2 border-white/40 bg-transparent text-white backdrop-blur-sm hover:border-white/60 hover:bg-white/10",
        ghost: "border-transparent bg-transparent text-white/70 hover:bg-white/10 hover:text-white",
        destructive: cn(
          "border-red-400/40 bg-red-500/30 text-red-100 backdrop-blur-xl",
          "shadow-[0_4px_16px_rgba(239,68,68,0.3)] hover:border-red-400/60 hover:bg-red-500/40",
          "before:pointer-events-none before:absolute before:inset-0 before:rounded-xl",
          "before:bg-linear-to-b before:from-white/10 before:to-transparent",
        ),
        link: "border-transparent bg-transparent text-cyan-200 underline-offset-4 hover:bg-white/10 hover:underline",
      },
      size: {
        default: "h-10 px-4 py-2",
        xs: "h-6 rounded-lg px-2 text-xs [&_svg]:size-3",
        sm: "h-8 rounded-lg px-3 text-xs [&_svg]:size-3.5",
        lg: "h-12 px-6 text-base",
        icon: "h-10 w-10",
        "icon-xs": "h-6 w-6 rounded-lg [&_svg]:size-3",
        "icon-sm": "h-8 w-8 rounded-lg [&_svg]:size-3.5",
        "icon-lg": "h-12 w-12 [&_svg]:size-5",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
)

type ButtonProps = React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
    glowEffect?: boolean
  }

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, glowEffect = false, children, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    const content = asChild ? children : <span className="relative z-10 flex min-w-0 items-center gap-2">{children}</span>

    return (
      <Comp
        ref={ref}
        data-slot="button"
        data-variant={variant ?? "default"}
        data-size={size ?? "default"}
        className={cn(
          glowEffect && "shadow-[0_0_24px_rgba(34,211,238,0.35)]",
          buttonVariants({ variant, size, className }),
        )}
        {...props}
      >
        {content}
      </Comp>
    )
  },
)
Button.displayName = "Button"

const GlassButton = Button
const glassButtonVariants = buttonVariants

export { Button, GlassButton, buttonVariants, glassButtonVariants }
