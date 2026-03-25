import { cn } from '@/lib/utils';

interface ContentHeaderProps {
  title: string;
  actions?: React.ReactNode;
  className?: string;
}

export function ContentHeader({ title, actions, className }: ContentHeaderProps) {
  return (
    <div
      data-tauri-drag-region
      className={cn(
        'flex h-11 shrink-0 items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-bg-base)] px-5',
        className,
      )}
    >
      <span className="text-sm font-medium text-[var(--color-text-primary)]">
        {title}
      </span>
      {actions && (
        <div className="flex items-center gap-1 no-drag-region" data-tauri-drag-region="false">
          {actions}
        </div>
      )}
    </div>
  );
}
