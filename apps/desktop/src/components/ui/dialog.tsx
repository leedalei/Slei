"use client"

import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

const Dialog = DialogPrimitive.Root
const DialogTrigger = DialogPrimitive.Trigger
const DialogPortal = DialogPrimitive.Portal
const DialogClose = DialogPrimitive.Close

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    data-slot="dialog-overlay"
    className={cn(
      "fixed inset-0 z-50 bg-black/60 backdrop-blur-sm",
      "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className,
    )}
    {...props}
  />
))
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
    closeLabel?: string
    showCloseButton?: boolean
  }
>(({ className, children, closeLabel = "Close", showCloseButton = true, ...props }, ref) => {
  const content = (
    <DialogPrimitive.Content
      ref={ref}
      data-slot="dialog-content"
      className={cn(
        "t-modal fixed left-1/2 top-1/2 z-50 grid w-full max-w-sm -translate-x-1/2 -translate-y-1/2 gap-4 rounded-2xl border border-white/25 bg-white/30 p-6 text-popover-foreground backdrop-blur-2xl supports-[backdrop-filter]:bg-white/35 [.light_&]:bg-white/70 supports-[backdrop-filter]:[.light_&]:bg-white/80",
        "shadow-[0_4px_4px_rgba(0,0,0,0.14)] outline-none",
        "before:pointer-events-none before:absolute before:inset-0 before:rounded-2xl before:bg-gradient-to-b before:from-white/45 before:to-transparent",
        className,
      )}
      {...props}
    >
      <div className="relative z-10 contents">{children}</div>
      {showCloseButton ? (
        <DialogPrimitive.Close asChild>
          <Button className="absolute right-4 top-4 z-20 size-8 [&_svg]:size-3.5" size="icon" type="button" variant="ghost">
            <X className="h-4 w-4" />
            <span className="sr-only">{closeLabel}</span>
          </Button>
        </DialogPrimitive.Close>
      ) : null}
    </DialogPrimitive.Content>
  )

  if (typeof document === "undefined") {
    return (
      <>
        <DialogOverlay />
        {content}
      </>
    )
  }

  return (
    <DialogPortal>
      <DialogOverlay />
      {content}
    </DialogPortal>
  )
})
DialogContent.displayName = DialogPrimitive.Content.displayName

function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div data-slot="dialog-header" className={cn("relative z-10 flex flex-col gap-2", className)} {...props} />
}

function DialogFooter({
  className,
  closeLabel = "Close",
  showCloseButton = false,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  closeLabel?: string
  showCloseButton?: boolean
}) {
  return (
    <div data-slot="dialog-footer" className={cn("relative z-10 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)} {...props}>
      {children}
      {showCloseButton ? (
        <DialogPrimitive.Close asChild>
          <Button variant="outline">{closeLabel}</Button>
        </DialogPrimitive.Close>
      ) : null}
    </div>
  )
}

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title ref={ref} data-slot="dialog-title" className={cn("relative z-10 text-lg font-semibold text-popover-foreground", className)} {...props} />
))
DialogTitle.displayName = DialogPrimitive.Title.displayName

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description ref={ref} data-slot="dialog-description" className={cn("relative z-10 text-sm text-muted-foreground", className)} {...props} />
))
DialogDescription.displayName = DialogPrimitive.Description.displayName

const GlassDialog = Dialog
const GlassDialogTrigger = DialogTrigger
const GlassDialogPortal = DialogPortal
const GlassDialogClose = DialogClose
const GlassDialogOverlay = DialogOverlay
const GlassDialogContent = DialogContent
const GlassDialogHeader = DialogHeader
const GlassDialogFooter = DialogFooter
const GlassDialogTitle = DialogTitle
const GlassDialogDescription = DialogDescription

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
  GlassDialog,
  GlassDialogClose,
  GlassDialogContent,
  GlassDialogDescription,
  GlassDialogFooter,
  GlassDialogHeader,
  GlassDialogOverlay,
  GlassDialogPortal,
  GlassDialogTitle,
  GlassDialogTrigger,
}
