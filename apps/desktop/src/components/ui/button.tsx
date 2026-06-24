import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "group/button relative isolate inline-flex shrink-0 items-center justify-center overflow-hidden rounded-lg border border-[var(--slei-glass-button-border)] bg-clip-padding text-sm font-medium whitespace-nowrap shadow-[var(--slei-glass-button-shadow)] backdrop-blur-xl slei-hover-transition outline-none select-none before:pointer-events-none before:absolute before:inset-0 before:rounded-[inherit] before:bg-linear-to-b before:from-white/35 before:to-transparent before:opacity-35 hover:border-[var(--slei-glass-button-hover-border)] focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:before:from-white/18 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "bg-[var(--slei-glass-button-primary-bg)] text-primary-foreground hover:bg-[var(--slei-glass-button-primary-hover-bg)]",
        outline:
          "bg-[var(--slei-glass-button-bg)] text-foreground hover:bg-[var(--slei-glass-button-hover-bg)] hover:text-foreground aria-expanded:bg-[var(--slei-glass-button-hover-bg)] aria-expanded:text-foreground",
        secondary:
          "bg-[var(--slei-glass-button-secondary-bg)] text-secondary-foreground hover:bg-[var(--slei-glass-button-secondary-hover-bg)] aria-expanded:bg-[var(--slei-glass-button-secondary-hover-bg)] aria-expanded:text-secondary-foreground",
        ghost:
          "border-transparent bg-transparent shadow-none text-foreground/80 before:opacity-0 hover:border-[var(--slei-glass-button-border)] hover:bg-[var(--slei-glass-button-hover-bg)] hover:text-foreground aria-expanded:border-[var(--slei-glass-button-border)] aria-expanded:bg-[var(--slei-glass-button-hover-bg)] aria-expanded:text-foreground",
        destructive:
          "bg-[var(--slei-glass-button-destructive-bg)] text-destructive-foreground hover:bg-[var(--slei-glass-button-destructive-hover-bg)] focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40",
        link:
          "border-transparent bg-transparent text-primary underline-offset-4 shadow-none before:opacity-0 hover:bg-[var(--slei-glass-button-hover-bg)] hover:underline",
      },
      size: {
        default:
          "h-8 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        xs: "h-6 gap-1 rounded-sm px-2 text-xs in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1 rounded-sm px-2.5 text-[0.8rem] in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-9 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        icon: "size-8",
        "icon-xs":
          "size-6 rounded-sm in-data-[slot=button-group]:rounded-lg [&_svg:not([class*='size-'])]:size-3",
        "icon-sm":
          "size-7 rounded-sm in-data-[slot=button-group]:rounded-lg",
        "icon-lg": "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
