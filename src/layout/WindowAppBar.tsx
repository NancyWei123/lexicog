// src/layout/WindowAppBar.tsx

import React from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/shared/components/ui/button';

interface WindowAppBarProps {
  title: React.ReactNode;
  onHide?: () => void;
  leading?: React.ReactNode;
  hideAriaLabel?: string;
  actions?: React.ReactNode;
  className?: string;
}

export function WindowAppBar({
  title,
  onHide,
  leading,
  hideAriaLabel,
  actions,
  className,
}: WindowAppBarProps) {
  return (
    <div
      data-tauri-drag-region
      className={cn(
        'drag-region flex items-center gap-2',
        'h-11 px-2.5 shrink-0',
        'bg-[var(--color-bg-surface-secondary)] text-[var(--color-text-primary)] border-b border-[rgba(0,0,0,0.03)]',
        'rounded-t-[28px]',
        className,
      )}
    >
      <div className="ml-1 flex items-center no-drag-region" data-tauri-drag-region="false">
        {leading ?? (
          <Button
            onClick={() => onHide?.()}
            disabled={!onHide}
            aria-label={hideAriaLabel}
            variant="ghost"
            size="icon"
            className="text-[var(--color-text-secondary)]"
          >
            <X size={16} />
          </Button>
        )}
      </div>

      <div data-tauri-drag-region className="min-w-0 flex-1 px-2">
        <span data-tauri-drag-region className="block truncate text-sm font-medium leading-6 text-[var(--color-text-primary)]">
          {title}
        </span>
      </div>

      <div className="mr-1 flex items-center gap-1 no-drag-region" data-tauri-drag-region="false">
        {actions}
      </div>
    </div>
  );
}
