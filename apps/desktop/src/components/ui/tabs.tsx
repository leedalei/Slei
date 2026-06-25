"use client"

import * as React from "react"
import * as TabsPrimitive from "@radix-ui/react-tabs"

import { cn } from "@/lib/utils"

const Tabs = TabsPrimitive.Root

const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List> & {
    variant?: "line" | "soft"
  }
>(({ className, variant = "soft", ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    data-slot="tabs-list"
    data-variant={variant}
    className={cn(
      "relative inline-flex h-12 items-center justify-center gap-1 rounded-xl border border-white/20 bg-white/10 p-1 backdrop-blur-xl",
      "shadow-[0_4px_16px_rgba(0,0,0,0.2)]",
      "before:pointer-events-none before:absolute before:-inset-1 before:-z-10 before:rounded-2xl before:bg-linear-to-r before:from-cyan-500/20 before:via-blue-500/20 before:to-purple-500/20 before:blur-lg",
      className,
    )}
    {...props}
  />
))
TabsList.displayName = TabsPrimitive.List.displayName

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    data-slot="tabs-trigger"
    className={cn(
      "relative inline-flex items-center justify-center whitespace-nowrap rounded-lg px-4 py-2 text-sm font-medium text-white/60",
      "transition-colors duration-200 hover:bg-white/5 hover:text-white/80",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent",
      "disabled:pointer-events-none disabled:opacity-50",
      "data-[state=active]:bg-white/20 data-[state=active]:text-white",
      "data-[state=active]:shadow-[0_2px_8px_rgba(0,0,0,0.2)]",
      "data-[state=active]:before:absolute data-[state=active]:before:inset-0 data-[state=active]:before:rounded-lg",
      "data-[state=active]:before:bg-gradient-to-b data-[state=active]:before:from-white/20 data-[state=active]:before:to-transparent data-[state=active]:before:pointer-events-none",
      className,
    )}
    {...props}
  />
))
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    data-slot="tabs-content"
    className={cn("mt-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50", className)}
    {...props}
  >
    {children}
  </TabsPrimitive.Content>
))
TabsContent.displayName = TabsPrimitive.Content.displayName

const GlassTabs = Tabs
const GlassTabsList = TabsList
const GlassTabsTrigger = TabsTrigger
const GlassTabsContent = TabsContent

export { GlassTabs, GlassTabsContent, GlassTabsList, GlassTabsTrigger, Tabs, TabsContent, TabsList, TabsTrigger }
