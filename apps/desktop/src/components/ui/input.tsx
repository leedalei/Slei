"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

type InputProps = React.InputHTMLAttributes<HTMLInputElement> & {
  glowEffect?: boolean
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, glowEffect = false, ...props }, ref) => (
    <div className="group relative w-full">
      {glowEffect ? (
        <div className="absolute -inset-0.5 rounded-xl bg-linear-to-r from-cyan-500/30 to-blue-500/30 opacity-0 blur-md transition-opacity group-focus-within:opacity-100" />
      ) : null}
      <input
        ref={ref}
        data-slot="input"
        className={cn(
          "peer flex h-10 w-full rounded-xl border border-white/20 bg-white/10 px-4 py-2 text-sm text-white backdrop-blur-xl",
          "placeholder:text-white/40 shadow-[0_4px_16px_rgba(0,0,0,0.2)] transition-all duration-300",
          "focus:border-white/40 focus:bg-white/15 focus:outline-none focus:ring-2 focus:ring-cyan-400/30 focus:ring-offset-0",
          "disabled:cursor-not-allowed disabled:opacity-50",
          "aria-invalid:border-red-400/50 aria-invalid:ring-red-400/30",
          className,
        )}
        {...props}
      />
    </div>
  ),
)
Input.displayName = "Input"

const GlassInput = Input

export { GlassInput, Input }
