"use client"

import * as React from "react"
import * as AvatarPrimitive from "@radix-ui/react-avatar"

import { cn } from "@/lib/utils"

type AvatarProps = React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Root> & {
  glowEffect?: boolean
}

const Avatar = React.forwardRef<React.ElementRef<typeof AvatarPrimitive.Root>, AvatarProps>(
  ({ className, glowEffect = true, ...props }, ref) => (
    <div className="relative inline-flex">
      {glowEffect ? (
        <div className="absolute -inset-1 rounded-full bg-linear-to-r from-cyan-500/40 via-blue-500/40 to-purple-500/40 opacity-70 blur-md" />
      ) : null}
      <AvatarPrimitive.Root
        ref={ref}
        data-slot="avatar"
        className={cn(
          "relative flex h-10 w-10 shrink-0 overflow-hidden rounded-full border-2 border-white/30",
          "shadow-[0_4px_16px_rgba(0,0,0,0.2)]",
          className,
        )}
        {...props}
      />
    </div>
  ),
)
Avatar.displayName = AvatarPrimitive.Root.displayName

const AvatarImage = React.forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Image>,
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Image>
>(({ className, ...props }, ref) => (
  <AvatarPrimitive.Image
    ref={ref}
    data-slot="avatar-image"
    className={cn("aspect-square h-full w-full object-cover", className)}
    {...props}
  />
))
AvatarImage.displayName = AvatarPrimitive.Image.displayName

const AvatarFallback = React.forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Fallback>,
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Fallback>
>(({ className, ...props }, ref) => (
  <AvatarPrimitive.Fallback
    ref={ref}
    data-slot="avatar-fallback"
    className={cn(
      "flex h-full w-full items-center justify-center rounded-full bg-white/10 text-sm font-medium text-white/80 backdrop-blur-xl",
      className,
    )}
    {...props}
  />
))
AvatarFallback.displayName = AvatarPrimitive.Fallback.displayName

function AvatarBadge({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="avatar-badge"
      className={cn(
        "absolute bottom-0 right-0 z-10 inline-flex h-3 w-3 items-center justify-center rounded-full border border-white/30 bg-cyan-400 text-white ring-2 ring-black/20",
        className,
      )}
      {...props}
    />
  )
}

function AvatarGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div data-slot="avatar-group" className={cn("flex -space-x-2 *:data-[slot=avatar]:ring-2 *:data-[slot=avatar]:ring-black/20", className)} {...props} />
  )
}

function AvatarGroupCount({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="avatar-group-count"
      className={cn("relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/20 bg-white/10 text-sm text-white/70 backdrop-blur-xl", className)}
      {...props}
    />
  )
}

const GlassAvatar = Avatar
const GlassAvatarImage = AvatarImage
const GlassAvatarFallback = AvatarFallback

export {
  Avatar,
  AvatarBadge,
  AvatarFallback,
  AvatarGroup,
  AvatarGroupCount,
  AvatarImage,
  GlassAvatar,
  GlassAvatarFallback,
  GlassAvatarImage,
}
