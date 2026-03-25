import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex min-h-8 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-medium transition-[background-color,border-color,color,box-shadow] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]/30 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4",
  {
    variants: {
      variant: {
        default:
          "bg-[var(--color-brand)] text-white shadow-[0_6px_16px_rgba(201,100,66,0.18)] hover:bg-[var(--color-brand-hover)] hover:shadow-[0_10px_22px_rgba(201,100,66,0.2)]",
        destructive:
          "bg-[var(--color-error)] text-white hover:bg-[color-mix(in_srgb,var(--color-error)_88%,black)]",
        outline:
          "border border-[rgba(0,0,0,0.05)] bg-[var(--color-bg-container)] text-[var(--color-text-primary)] shadow-[0_1px_0_rgba(255,255,255,0.7)] hover:bg-[var(--color-bg-surface-secondary)]",
        secondary:
          "bg-[rgba(0,0,0,0.035)] text-[var(--color-text-primary)] hover:bg-[rgba(0,0,0,0.055)]",
        ghost:
          "text-[var(--color-text-secondary)] hover:bg-[rgba(0,0,0,0.035)] hover:text-[var(--color-text-primary)]",
        link: "text-[var(--color-brand)] underline-offset-4 hover:text-[var(--color-brand-hover)] hover:underline",
      },
      size: {
        default: "h-9 px-3",
        sm: "h-8 rounded-md px-2.5 text-xs",
        lg: "h-10 rounded-md px-4",
        icon: "h-8 w-8",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot : "button";

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
