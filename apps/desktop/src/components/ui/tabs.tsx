import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Tabs as TabsPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function assignRef<T>(ref: React.Ref<T> | undefined, value: T) {
  if (typeof ref === "function") {
    ref(value)
    return
  }

  if (ref && "current" in ref) {
    ref.current = value
  }
}

function Tabs({
  className,
  orientation = "horizontal",
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      data-orientation={orientation}
      className={cn(
        "group/tabs flex gap-2 data-[orientation=horizontal]:flex-col",
        className
      )}
      {...props}
    />
  )
}

const tabsListVariants = cva(
  "group/tabs-list relative inline-flex w-fit items-center justify-center rounded-xl border border-white/20 bg-white/10 text-muted-foreground shadow-[var(--tabs-glass-shadow)] backdrop-blur-xl group-data-[orientation=vertical]/tabs:h-fit group-data-[orientation=vertical]/tabs:flex-col",
  {
    variants: {
      variant: {
        default: "gap-1 p-1 group-data-[orientation=horizontal]/tabs:h-10",
        line: "gap-4 p-0 group-data-[orientation=horizontal]/tabs:h-8",
        soft: "gap-1 p-1 group-data-[orientation=horizontal]/tabs:h-9",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function TabsList({
  className,
  ref,
  variant = "default",
  ...props
}: React.ComponentPropsWithRef<typeof TabsPrimitive.List> &
  VariantProps<typeof tabsListVariants>) {
  return (
    <div className="relative inline-flex w-fit">
      <span
        aria-hidden="true"
        className="t-tabs-glow pointer-events-none absolute -inset-1 rounded-2xl bg-linear-to-r from-cyan-500/20 via-blue-500/20 to-purple-500/20 opacity-60 blur-lg"
        data-slei-glass-tabs-glow
      />
      <TabsPrimitive.List
        ref={(node) => assignRef(ref, node)}
        data-slot="tabs-list"
        data-slei-glass-tabs-list
        data-variant={variant}
        className={cn(tabsListVariants({ variant }), "t-tabs", className)}
        {...props}
      />
    </div>
  )
}

function TabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        "t-tab relative inline-flex h-[calc(100%-1px)] flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-transparent px-3 py-2 text-sm font-medium text-white/60 transition-colors duration-200 group-data-[orientation=vertical]/tabs:w-full group-data-[orientation=vertical]/tabs:justify-start focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-white/50 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 has-data-[icon=inline-end]:pr-1 has-data-[icon=inline-start]:pl-1 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        "hover:bg-white/5 hover:text-white/80",
        "data-[state=active]:bg-white/20 data-[state=active]:text-white data-[state=active]:shadow-[0_2px_8px_rgba(0,0,0,0.2)]",
        "data-[state=active]:before:absolute data-[state=active]:before:inset-0 data-[state=active]:before:rounded-lg data-[state=active]:before:bg-gradient-to-b data-[state=active]:before:from-white/20 data-[state=active]:before:to-transparent data-[state=active]:before:pointer-events-none",
        className
      )}
      {...props}
    />
  )
}

function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn(
        "mt-4 flex-1 text-sm outline-none data-[state=active]:animate-in data-[state=active]:fade-in data-[state=active]:slide-in-from-bottom-1 data-[state=inactive]:animate-out data-[state=inactive]:fade-out focus-visible:ring-2 focus-visible:ring-white/50",
        className
      )}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants }
