import { cn } from '@/lib/utils';

interface LinearProgressProps {
  /** Whether the progress is indeterminate (animated) */
  indeterminate?: boolean;
  /** Progress value (0-100) for determinate mode */
  value?: number;
  className?: string;
}

export function LinearProgress({
  indeterminate = true,
  value = 0,
  className,
}: LinearProgressProps) {
  const safeValue = Math.max(0, Math.min(100, value));
  const width = `${safeValue}%`;

  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={indeterminate ? undefined : safeValue}
      aria-busy={indeterminate}
      className={cn(
        'relative h-0.5 w-full overflow-hidden bg-[var(--color-bg-surface-tertiary)]',
        className
      )}
    >
      {indeterminate ? (
        <div className="h-full w-1/2 origin-left bg-[var(--color-brand)] animate-linear-progress motion-reduce:animate-none" />
      ) : (
        <div
          className="h-full bg-[var(--color-brand)] transition-[width] duration-300 ease-out"
          style={{ width }}
        />
      )}
    </div>
  );
}
