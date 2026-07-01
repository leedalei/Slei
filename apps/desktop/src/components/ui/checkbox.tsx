import * as React from "react"
import * as CheckboxPrimitive from "@radix-ui/react-checkbox"
import { Check } from "lucide-react"

import { cn } from "@/lib/utils"

function Checkbox({
  className,
  ...props
}: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "peer relative flex size-5 shrink-0 items-center justify-center rounded-[4px] border border-white/20 bg-white/10 text-foreground backdrop-blur-xl shadow-[0_2px_4px_rgba(0,0,0,0.16)]",
        "transition-all duration-300 outline-none hover:border-white/40 hover:bg-white/15 group-has-disabled/field:opacity-50 after:absolute after:-inset-x-3 after:-inset-y-2",
        "focus-visible:border-white/40",
        "disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive",
        "data-[state=checked]:border-cyan-400/40 data-[state=checked]:bg-linear-to-r data-[state=checked]:from-cyan-500/60 data-[state=checked]:to-blue-500/60 data-[state=checked]:text-primary-foreground data-[state=checked]:shadow-[0_0_4px_rgba(6,182,212,0.12)]",
        className
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="grid place-content-center text-current transition-none [&>svg]:size-4"
      >
        <Check />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }
