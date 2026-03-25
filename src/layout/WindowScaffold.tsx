// src/layout/WindowScaffold.tsx

import { cn } from '@/lib/utils';

interface WindowScaffoldProps {
  variant?: 'popup' | 'main';
  children: React.ReactNode;
  className?: string;
}

export function WindowScaffold({ variant = 'popup', children, className }: WindowScaffoldProps) {
  return (
    <div
      className={cn(
        'h-screen w-screen flex flex-col',
        variant === 'popup' && [
          'bg-[var(--color-bg-base)]',
          'rounded-[28px]',
          'border border-[rgba(0,0,0,0.03)]',
          'shadow-[0_18px_40px_rgba(44,42,40,0.08)]',
          'overflow-hidden',
        ],
        variant === 'main' && 'bg-[var(--color-bg-base)]',
        className,
      )}
    >
      {children}
    </div>
  );
}
