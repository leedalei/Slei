"use client"

import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "@radix-ui/react-slot"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  cn(
    "relative inline-flex cursor-pointer items-center justify-center gap-2 overflow-hidden whitespace-nowrap rounded-xl",
    "border text-sm font-medium text-foreground transition-all duration-300 ease-out",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent",
    "disabled:pointer-events-none disabled:opacity-50",
    "hover:border-white/40 hover:bg-white/10",
    "[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  ),
  {
    variants: {
      variant: {
        default: cn(
          "border-white/30 bg-transparent backdrop-blur-xl",
          "shadow-[0_2px_10px_rgba(0,0,0,0.12)]",
          "before:pointer-events-none before:absolute before:inset-0 before:rounded-xl",
          "before:bg-linear-to-b before:from-white/10 before:to-transparent",
        ),
        primary: cn(
          "border-transparent [background:linear-gradient(90deg,rgba(6,182,212,0.60),rgba(59,130,246,0.60),rgba(168,85,247,0.60))_padding-box,linear-gradient(90deg,rgba(34,211,238,0.56),rgba(96,165,250,0.48),rgba(192,132,252,0.56))_border-box] text-accent-foreground backdrop-blur-xl",
          "shadow-[0_4px_20px_rgba(59,130,246,0.4)] hover:shadow-[0_4px_30px_rgba(59,130,246,0.6)]",
          "before:pointer-events-none before:absolute before:inset-0 before:rounded-xl",
          "before:bg-linear-to-b before:from-white/30 before:to-transparent",
        ),
        secondary: "border-white/25 bg-transparent backdrop-blur-xl shadow-[0_2px_10px_rgba(0,0,0,0.1)] hover:bg-white/10",
        outline: cn(
          "border-2 border-white/35 bg-white/[0.08] backdrop-blur-sm",
          "shadow-[0_1px_10px_rgba(15,23,42,0.1)]",
          "hover:border-white/55 hover:bg-white/[0.14]",
        ),
        ghost: "border-transparent bg-transparent hover:bg-white/10",
        destructive: cn(
          "border-red-400/40 bg-red-500/30 backdrop-blur-xl",
          "shadow-[0_4px_16px_rgba(239,68,68,0.3)] hover:border-red-400/60 hover:bg-red-500/40",
          "before:pointer-events-none before:absolute before:inset-0 before:rounded-xl",
          "before:bg-linear-to-b before:from-white/10 before:to-transparent",
        ),
        link: "border-transparent bg-transparent underline-offset-4 hover:bg-white/10 hover:underline",
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
    wrapContent?: boolean
  }

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, glowEffect = false, wrapContent = true, children, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    const content = asChild || !wrapContent ? children : <span className="relative z-10 flex min-w-0 items-center gap-2">{children}</span>

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
