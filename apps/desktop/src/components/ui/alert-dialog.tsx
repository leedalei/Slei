"use client"

import * as React from "react"
import * as AlertDialogPrimitive from "@radix-ui/react-alert-dialog"

import { buttonVariants, type Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

const AlertDialog = AlertDialogPrimitive.Root
const AlertDialogTrigger = AlertDialogPrimitive.Trigger
const AlertDialogPortal = AlertDialogPrimitive.Portal

const AlertDialogOverlay = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Overlay
    ref={ref}
    data-slot="alert-dialog-overlay"
    className={cn(
      "fixed inset-0 z-50 bg-black/60 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out",
      "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className,
    )}
    {...props}
  />
))
AlertDialogOverlay.displayName = AlertDialogPrimitive.Overlay.displayName

const AlertDialogContent = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Content>
>(({ className, ...props }, ref) => (
  <AlertDialogPortal>
    <AlertDialogOverlay />
    <AlertDialogPrimitive.Content
      ref={ref}
      data-slot="alert-dialog-content"
      className={cn(
        "t-modal fixed left-1/2 top-1/2 z-50 w-full max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-white/25 bg-white/30 p-6 text-popover-foreground backdrop-blur-2xl supports-[backdrop-filter]:bg-white/35 [.light_&]:bg-white/70 supports-[backdrop-filter]:[.light_&]:bg-white/80",
        "shadow-[0_8px_32px_rgba(0,0,0,0.4)] outline-none",
        "before:pointer-events-none before:absolute before:inset-0 before:rounded-2xl before:bg-gradient-to-b before:from-white/45 before:to-transparent",
        className,
      )}
      {...props}
    />
  </AlertDialogPortal>
))
AlertDialogContent.displayName = AlertDialogPrimitive.Content.displayName

function AlertDialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div data-slot="alert-dialog-header" className={cn("relative z-10 flex flex-col gap-2 text-center sm:text-left", className)} {...props} />
}

function AlertDialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div data-slot="alert-dialog-footer" className={cn("relative z-10 mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)} {...props} />
}

function AlertDialogMedia({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div data-slot="alert-dialog-media" className={cn("mb-2 inline-flex h-10 w-10 items-center justify-center rounded-lg border border-white/10 bg-white/10", className)} {...props} />
}

const AlertDialogTitle = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Title ref={ref} data-slot="alert-dialog-title" className={cn("relative z-10 text-lg font-semibold text-popover-foreground", className)} {...props} />
))
AlertDialogTitle.displayName = AlertDialogPrimitive.Title.displayName

const AlertDialogDescription = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Description ref={ref} data-slot="alert-dialog-description" className={cn("relative z-10 text-sm text-muted-foreground", className)} {...props} />
))
AlertDialogDescription.displayName = AlertDialogPrimitive.Description.displayName

type AlertDialogButtonProps<TPrimitive> = React.ComponentPropsWithoutRef<TPrimitive extends React.ElementType ? TPrimitive : never> &
  Pick<React.ComponentProps<typeof Button>, "variant" | "size">

const AlertDialogAction = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Action>,
  AlertDialogButtonProps<typeof AlertDialogPrimitive.Action>
>(({ className, variant = "primary", size, ...props }, ref) => (
  <AlertDialogPrimitive.Action ref={ref} data-slot="alert-dialog-action" className={cn(buttonVariants({ variant, size }), className)} {...props} />
))
AlertDialogAction.displayName = AlertDialogPrimitive.Action.displayName

const AlertDialogCancel = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Cancel>,
  AlertDialogButtonProps<typeof AlertDialogPrimitive.Cancel>
>(({ className, variant = "outline", size, ...props }, ref) => (
  <AlertDialogPrimitive.Cancel ref={ref} data-slot="alert-dialog-cancel" className={cn(buttonVariants({ variant, size }), className)} {...props} />
))
AlertDialogCancel.displayName = AlertDialogPrimitive.Cancel.displayName

const GlassAlertDialog = AlertDialog
const GlassAlertDialogPortal = AlertDialogPortal
const GlassAlertDialogOverlay = AlertDialogOverlay
const GlassAlertDialogTrigger = AlertDialogTrigger
const GlassAlertDialogContent = AlertDialogContent
const GlassAlertDialogHeader = AlertDialogHeader
const GlassAlertDialogFooter = AlertDialogFooter
const GlassAlertDialogTitle = AlertDialogTitle
const GlassAlertDialogDescription = AlertDialogDescription
const GlassAlertDialogAction = AlertDialogAction
const GlassAlertDialogCancel = AlertDialogCancel

export {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogOverlay,
  AlertDialogPortal,
  AlertDialogTitle,
  AlertDialogTrigger,
  GlassAlertDialog,
  GlassAlertDialogAction,
  GlassAlertDialogCancel,
  GlassAlertDialogContent,
  GlassAlertDialogDescription,
  GlassAlertDialogFooter,
  GlassAlertDialogHeader,
  GlassAlertDialogOverlay,
  GlassAlertDialogPortal,
  GlassAlertDialogTitle,
  GlassAlertDialogTrigger,
}
