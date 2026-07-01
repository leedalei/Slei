"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
  glowEffect?: boolean
  glowOnFocus?: boolean
}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, glowEffect, glowOnFocus, ...props }, ref) => {
    const shouldGlow = glowOnFocus ?? glowEffect ?? false

    return (
      <div className="group relative w-full overflow-visible">
        {shouldGlow ? (
          <div
            aria-hidden="true"
            className="absolute -inset-0.5 overflow-visible rounded-xl bg-linear-to-r from-transparent via-transparent to-transparent blur-md transition-all duration-300 group-focus-within:from-[var(--input-focus-glow-from)] group-focus-within:via-[var(--input-focus-glow-via)] group-focus-within:to-[var(--input-focus-glow-to)]"
          />
        ) : null}
        <textarea
          ref={ref}
          data-slot="textarea"
          className={cn(
            "relative flex min-h-16 w-full resize-none rounded-xl border border-white/20 bg-white/10 px-4 py-3 text-sm text-foreground backdrop-blur-xl",
            "placeholder:text-muted-foreground/70 shadow-[0_2px_4px_rgba(0,0,0,0.10)] transition-all duration-300",
            "focus:border-white/40 focus:bg-white/15 focus:outline-none",
            "disabled:cursor-not-allowed disabled:opacity-50",
            "aria-invalid:border-red-400/50",
            className,
          )}
          {...props}
        />
      </div>
    )
  },
)
Textarea.displayName = "Textarea"

const GlassTextarea = Textarea

export { GlassTextarea, Textarea }
