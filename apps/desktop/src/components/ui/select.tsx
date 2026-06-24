"use client"

import * as React from "react"
import { Select as SelectPrimitive } from "radix-ui"
import { IconCheck, IconChevronDown, IconChevronUp } from "@tabler/icons-react"

import { cn } from "@/lib/utils"

function Select({
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Root>) {
  return <SelectPrimitive.Root data-slot="select" {...props} />
}

function SelectGroup({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Group>) {
  return (
    <SelectPrimitive.Group
      data-slot="select-group"
      className={cn("scroll-my-1 p-1", className)}
      {...props}
    />
  )
}

function SelectValue({
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Value>) {
  return <SelectPrimitive.Value data-slot="select-value" {...props} />
}

function SelectTrigger({
  className,
  size = "default",
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger> & {
  size?: "sm" | "default"
}) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      data-size={size}
      className={cn(
        "flex w-fit items-center justify-between gap-2 rounded-lg border border-white/20 bg-white/10 px-4 py-2 text-sm text-foreground whitespace-nowrap shadow-[0_4px_16px_rgba(0,0,0,0.2)] backdrop-blur-xl transition-all duration-300 ease-out outline-none select-none hover:border-white/30 hover:bg-white/15 focus:border-white/40 focus:bg-white/15 focus:ring-2 focus:ring-ring/30 focus:ring-offset-0 focus-visible:border-white/40 focus-visible:ring-2 focus-visible:ring-ring/35 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive/60 aria-invalid:ring-2 aria-invalid:ring-destructive/20 data-[state=open]:border-white/40 data-[state=open]:bg-white/15 data-[state=open]:[&_svg:last-child]:rotate-180 data-placeholder:text-muted-foreground data-[size=default]:h-10 data-[size=sm]:h-8 data-[size=sm]:rounded-sm *:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center *:data-[slot=select-value]:gap-1.5 dark:border-white/15 dark:bg-white/10 dark:hover:border-white/25 dark:hover:bg-white/15 dark:data-[state=open]:bg-white/15 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:last-child]:transition-transform [&_svg:last-child]:duration-300 [&_svg:last-child]:ease-out [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <IconChevronDown className="pointer-events-none size-4 text-muted-foreground" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  )
}

function SelectContent({
  className,
  children,
  position = "popper",
  align = "center",
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Content>) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        data-slot="select-content"
        data-align-trigger={position === "item-aligned"}
        className={cn(
          "t-dropdown relative z-50 max-h-(--radix-select-content-available-height) min-w-36 origin-(--radix-select-content-transform-origin) overflow-x-hidden overflow-y-auto rounded-xl border border-white/20 bg-white/10 p-1 text-popover-foreground shadow-[var(--slei-shadow-overlay-xs)] backdrop-blur-2xl",
          "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
          position === "popper" &&
            "data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1",
          className
        )}
        position={position}
        align={align}
        {...props}
      >
        <SelectScrollUpButton />
        <SelectPrimitive.Viewport
          data-position={position}
          className={cn(
            "p-1",
            position === "popper" &&
              "data-[position=popper]:w-full data-[position=popper]:min-w-(--radix-select-trigger-width)"
          )}
        >
          {children}
        </SelectPrimitive.Viewport>
        <SelectScrollDownButton />
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  )
}

function SelectLabel({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Label>) {
  return (
    <SelectPrimitive.Label
      data-slot="select-label"
      className={cn("px-2 py-1.5 text-sm font-semibold text-muted-foreground", className)}
      {...props}
    />
  )
}

function SelectItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        "relative flex min-h-10 w-full cursor-pointer items-center gap-2 rounded-md py-2 pr-3 pl-8 text-sm text-foreground/80 outline-none select-none transition-colors duration-150 ease-out focus:bg-white/10 focus:text-foreground data-[highlighted]:bg-white/10 data-[highlighted]:text-foreground data-[state=checked]:text-foreground data-[state=checked]:font-semibold data-disabled:pointer-events-none data-disabled:opacity-50 dark:text-white/80 dark:focus:text-white dark:data-[highlighted]:text-white dark:data-[state=checked]:text-white [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 *:[span]:last:flex *:[span]:last:items-center *:[span]:last:gap-2",
        className
      )}
      {...props}
    >
      <span className="pointer-events-none absolute left-2 flex size-4 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <IconCheck className="pointer-events-none text-primary" />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  )
}

function SelectSeparator({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Separator>) {
  return (
    <SelectPrimitive.Separator
      data-slot="select-separator"
      className={cn("pointer-events-none -mx-1 my-1 h-px bg-white/10", className)}
      {...props}
    />
  )
}

function SelectScrollUpButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollUpButton>) {
  return (
    <SelectPrimitive.ScrollUpButton
      data-slot="select-scroll-up-button"
      className={cn(
        "z-10 flex cursor-default items-center justify-center rounded-md bg-white/10 py-1 text-muted-foreground backdrop-blur-xl [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      <IconChevronUp />
    </SelectPrimitive.ScrollUpButton>
  )
}

function SelectScrollDownButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollDownButton>) {
  return (
    <SelectPrimitive.ScrollDownButton
      data-slot="select-scroll-down-button"
      className={cn(
        "z-10 flex cursor-default items-center justify-center rounded-md bg-white/10 py-1 text-muted-foreground backdrop-blur-xl [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      <IconChevronDown />
    </SelectPrimitive.ScrollDownButton>
  )
}

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
}
