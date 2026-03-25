import { cn } from "@/lib/utils";

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn(
        "animate-pulse rounded-md bg-[color-mix(in_srgb,var(--color-bg-surface-secondary)_88%,white)]",
        className
      )}
      {...props}
    />
  );
}

export { Skeleton };
