"use client"

import * as React from "react"
import * as TabsPrimitive from "@radix-ui/react-tabs"

import { cn } from "@/lib/utils"

const Tabs = TabsPrimitive.Root

function setForwardedRef<T>(ref: React.ForwardedRef<T>, value: T) {
  if (typeof ref === "function") {
    ref(value)
  } else if (ref) {
    ref.current = value
  }
}

const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List> & {
    variant?: "line" | "soft"
  }
>(({ className, children, variant = "soft", ...props }, ref) => {
  const listRef = React.useRef<React.ElementRef<typeof TabsPrimitive.List> | null>(null)
  const pillRef = React.useRef<HTMLSpanElement | null>(null)

  const setListRef = React.useCallback(
    (node: React.ElementRef<typeof TabsPrimitive.List> | null) => {
      listRef.current = node
      setForwardedRef(ref, node)
    },
    [ref],
  )

  const moveToActiveTab = React.useCallback((animate: boolean) => {
    const list = listRef.current
    const pill = pillRef.current
    if (!list || !pill) return

    const tabs = Array.from(list.querySelectorAll<HTMLElement>('[data-slot="tabs-trigger"]'))
    const activeTab = tabs.find((tab) => tab.getAttribute("aria-selected") === "true" || tab.getAttribute("data-state") === "active") ?? tabs[0]
    if (!activeTab) return

    if (!animate) {
      const previousTransition = pill.style.transition
      pill.style.transition = "none"
      pill.style.transform = `translateX(${activeTab.offsetLeft}px)`
      pill.style.width = `${activeTab.offsetWidth}px`
      void pill.offsetWidth
      pill.style.transition = previousTransition
      return
    }

    pill.style.transform = `translateX(${activeTab.offsetLeft}px)`
    pill.style.width = `${activeTab.offsetWidth}px`
  }, [])

  React.useLayoutEffect(() => {
    const list = listRef.current
    if (!list) return

    const view = list.ownerDocument.defaultView ?? window
    const frame = view.requestAnimationFrame(() => moveToActiveTab(false))
    const observer = new view.MutationObserver(() => moveToActiveTab(true))
    observer.observe(list, {
      attributeFilter: ["aria-selected", "data-state"],
      attributes: true,
      subtree: true,
    })

    const handleResize = () => moveToActiveTab(false)
    view.addEventListener("resize", handleResize)

    return () => {
      view.cancelAnimationFrame(frame)
      observer.disconnect()
      view.removeEventListener("resize", handleResize)
    }
  }, [moveToActiveTab])

  return (
    <TabsPrimitive.List
      ref={setListRef}
      data-slot="tabs-list"
      data-variant={variant}
      className={cn(
        "t-tabs relative inline-flex h-8 items-center justify-center gap-0.5 rounded-lg border border-[var(--tabs-control-border)] bg-[var(--tabs-control-bg)] p-0.5",
        className,
      )}
      {...props}
    >
      <span ref={pillRef} aria-hidden="true" className="t-tabs-pill" data-slot="tabs-pill" />
      {children}
    </TabsPrimitive.List>
  )
})
TabsList.displayName = TabsPrimitive.List.displayName

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    data-slot="tabs-trigger"
    className={cn(
      "t-tab relative inline-flex h-7 items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-3 py-0 text-[12.5px] font-medium text-muted-foreground",
      "transition-colors duration-200 hover:text-foreground",
      "focus-visible:outline-none",
      "disabled:pointer-events-none disabled:opacity-50",
      "data-[state=active]:text-foreground",
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
    className={cn("mt-4 focus-visible:outline-none", className)}
    {...props}
  >
    {children}
  </TabsPrimitive.Content>
))
TabsContent.displayName = TabsPrimitive.Content.displayName

export { Tabs, TabsContent, TabsList, TabsTrigger }
