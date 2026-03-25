import * as React from "react";

import { cn } from "@/lib/utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "flex h-10 w-full min-w-0 rounded-xl border border-transparent bg-[var(--color-field-bg)] px-3.5 py-2.5 text-sm text-[var(--color-text-primary)] shadow-[inset_0_0_0_1px_rgba(0,0,0,0.02)] transition-[background-color,box-shadow,color] outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-[var(--color-text-tertiary)] hover:bg-[var(--color-field-hover)] hover:shadow-[inset_0_0_0_1px_rgba(0,0,0,0.05)] disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 focus-visible:bg-[var(--color-bg-container)] focus-visible:shadow-[inset_0_0_0_1px_rgba(217,138,108,0.24),0_0_0_4px_var(--color-focus-ring)]",
        className
      )}
      {...props}
    />
  );
}

export { Input };
