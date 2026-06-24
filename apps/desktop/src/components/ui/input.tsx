import * as React from "react"

import { cn } from "@/lib/utils"

function Input({
  chrome = "inset",
  className,
  type,
  ...props
}: React.ComponentProps<"input"> & {
  chrome?: "inset" | "plain"
}) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-8 w-full min-w-0 rounded-lg border px-2.5 py-1 text-base transition-[background-color,border-color,box-shadow,color] outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        chrome === "inset"
          ? "border-[var(--slei-inset-border)] bg-muted/40 slei-inset-small slei-inset-focus-small focus-visible:border-ring disabled:bg-input/50 dark:bg-muted/30 dark:disabled:bg-input/80"
          : "border-transparent bg-transparent shadow-none focus-visible:border-transparent focus-visible:shadow-none disabled:bg-transparent dark:bg-transparent dark:disabled:bg-transparent",
        className
      )}
      {...props}
    />
  )
}

export { Input }
