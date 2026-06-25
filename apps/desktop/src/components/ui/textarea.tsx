"use client"

import * as React from "react"
import { motion } from "framer-motion"

import { cn } from "@/lib/utils"

type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
  glowEffect?: boolean
}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, glowEffect = false, ...props }, ref) => (
    <div className="relative w-full">
      {glowEffect ? (
        <motion.div
          className="absolute -inset-0.5 rounded-xl bg-linear-to-r from-cyan-500/30 to-blue-500/30 blur-md"
          initial={{ opacity: 0 }}
          animate={{ opacity: 0.6 }}
          transition={{ duration: 0.2 }}
        />
      ) : null}
      <textarea
        ref={ref}
        data-slot="textarea"
        className={cn(
          "relative flex min-h-16 w-full rounded-xl border border-white/20 bg-white/10 px-4 py-3 text-sm text-white backdrop-blur-xl",
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
Textarea.displayName = "Textarea"

const GlassTextarea = Textarea

export { GlassTextarea, Textarea }
