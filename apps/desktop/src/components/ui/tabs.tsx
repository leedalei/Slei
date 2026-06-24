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
  "group/tabs-list inline-flex w-fit items-center justify-center rounded-lg text-muted-foreground group-data-[orientation=vertical]/tabs:h-fit group-data-[orientation=vertical]/tabs:flex-col data-[variant=line]:rounded-none",
  {
    variants: {
      variant: {
        default: "bg-muted p-[3px] group-data-[orientation=horizontal]/tabs:h-8",
        line: "gap-4 bg-transparent p-0 group-data-[orientation=horizontal]/tabs:h-8",
        soft: "bg-muted/70 p-1 slei-inset-small group-data-[orientation=horizontal]/tabs:h-9",
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
  const listRef = React.useRef<HTMLDivElement | null>(null)
  const isSliding = variant === "soft"

  React.useEffect(() => {
    if (!isSliding) return

    const list = listRef.current
    if (!list) return

    const pill = list.querySelector<HTMLElement>("[data-slei-tabs-pill]")
    const tabs = Array.from(list.querySelectorAll<HTMLElement>("[role='tab']"))
    if (!pill || tabs.length === 0) return
    const currentList = list
    const currentPill = pill

    function active() {
      return tabs.find((tab) => tab.getAttribute("aria-selected") === "true") ?? tabs[0]
    }

    function moveTo(tab: HTMLElement, animate: boolean) {
      const duration = getComputedStyle(currentList).getPropertyValue("--tabs-dur").trim()
      if (!animate) {
        const prev = currentPill.style.transition
        currentPill.style.transition = "none"
        currentPill.style.transform = `translateX(${tab.offsetLeft}px)`
        currentPill.style.width = `${tab.offsetWidth}px`
        void currentPill.offsetWidth
        currentPill.style.transition = prev
        return
      }

      currentPill.style.transitionDuration = duration || ""
      currentPill.style.transform = `translateX(${tab.offsetLeft}px)`
      currentPill.style.width = `${tab.offsetWidth}px`
    }

    const syncWithoutAnimation = () => moveTo(active(), false)
    const syncWithAnimation = () => moveTo(active(), true)
    const frame = requestAnimationFrame(() => moveTo(active(), false))
    const observer = new MutationObserver(syncWithAnimation)

    observer.observe(list, {
      attributeFilter: ["aria-selected", "data-state"],
      attributes: true,
      subtree: true,
    })
    window.addEventListener("resize", syncWithoutAnimation)

    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      window.removeEventListener("resize", syncWithoutAnimation)
    }
  }, [isSliding])

  return (
    <TabsPrimitive.List
      ref={(node) => {
        listRef.current = node
        assignRef(ref, node)
      }}
      data-slot="tabs-list"
      data-variant={variant}
      className={cn(tabsListVariants({ variant }), isSliding && "t-tabs", className)}
      {...props}
    >
      {isSliding ? <span aria-hidden="true" className="t-tabs-pill" data-slei-tabs-pill /> : null}
      {props.children}
    </TabsPrimitive.List>
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
        "t-tab relative inline-flex h-[calc(100%-1px)] flex-1 items-center justify-center gap-1.5 rounded-md border border-transparent px-1.5 py-0.5 text-sm font-medium whitespace-nowrap text-foreground/60 transition-all group-data-[orientation=vertical]/tabs:w-full group-data-[orientation=vertical]/tabs:justify-start hover:text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 has-data-[icon=inline-end]:pr-1 has-data-[icon=inline-start]:pl-1 dark:text-muted-foreground dark:hover:text-foreground group-data-[variant=default]/tabs-list:data-active:slei-raised-small group-data-[variant=line]/tabs-list:data-active:shadow-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        "group-data-[variant=line]/tabs-list:bg-transparent group-data-[variant=line]/tabs-list:py-0 group-data-[variant=line]/tabs-list:data-active:bg-transparent group-data-[variant=line]/tabs-list:data-active:font-bold group-data-[variant=line]/tabs-list:data-active:text-primary dark:group-data-[variant=line]/tabs-list:data-active:border-transparent dark:group-data-[variant=line]/tabs-list:data-active:bg-transparent",
        "group-data-[variant=soft]/tabs-list:z-10 group-data-[variant=soft]/tabs-list:data-active:bg-transparent group-data-[variant=soft]/tabs-list:data-active:text-card-foreground dark:group-data-[variant=soft]/tabs-list:data-active:text-card-foreground",
        "data-active:bg-background data-active:text-foreground dark:data-active:border-input dark:data-active:text-foreground",
        "after:absolute after:bg-primary after:opacity-0 after:transition-opacity group-data-[orientation=horizontal]/tabs:after:inset-x-0 group-data-[orientation=horizontal]/tabs:after:bottom-[-8px] group-data-[orientation=horizontal]/tabs:after:h-[3px] group-data-[orientation=vertical]/tabs:after:inset-y-0 group-data-[orientation=vertical]/tabs:after:-right-1 group-data-[orientation=vertical]/tabs:after:w-[3px] group-data-[variant=line]/tabs-list:data-active:after:opacity-100",
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
      className={cn("flex-1 text-sm outline-none", className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants }
