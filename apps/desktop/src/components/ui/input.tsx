"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

type InputProps = React.InputHTMLAttributes<HTMLInputElement> & {
  glowEffect?: boolean
  glowOnFocus?: boolean
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, glowEffect, glowOnFocus, ...props }, ref) => {
    const shouldGlow = glowOnFocus ?? glowEffect ?? true

    return (
      <div className="group relative w-full">
        {shouldGlow ? (
          <div
            aria-hidden="true"
            className="absolute -inset-0.5 rounded-xl bg-linear-to-r from-cyan-500/0 via-blue-500/0 to-purple-500/0 opacity-0 blur-md transition-all duration-300 group-focus-within:from-cyan-500/30 group-focus-within:via-blue-500/30 group-focus-within:to-purple-500/30 group-focus-within:opacity-70"
          />
        ) : null}
        <input
          ref={ref}
          data-slot="input"
          className={cn(
            "relative flex h-10 w-full rounded-xl border border-white/20 bg-white/10 px-4 py-2 text-sm text-foreground backdrop-blur-xl",
            "placeholder:text-muted-foreground/70 shadow-[0_4px_16px_rgba(0,0,0,0.2)] transition-all duration-300",
            "focus:border-white/40 focus:bg-white/15 focus:outline-none",
            "disabled:cursor-not-allowed disabled:opacity-50",
            "file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground",
            "aria-invalid:border-red-400/50 aria-invalid:ring-2 aria-invalid:ring-red-400/30",
            className,
          )}
          {...props}
        />
      </div>
    )
  },
)
Input.displayName = "Input"

const GlassInput = Input

export { GlassInput, Input }
