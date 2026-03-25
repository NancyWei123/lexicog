import { useMemo, type UIEventHandler } from 'react';
import { cn } from '@/lib/utils';

interface BouncingChipsProps {
  entries: string[];
  baseColor: string;
  onChipClick: (entry: string) => void;
  onScroll?: UIEventHandler<HTMLDivElement>;
  className?: string;
}

type ChipSize = 'sm' | 'md' | 'lg' | 'xl';

function hashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function getChipSize(entry: string, index: number): ChipSize {
  const h = hashCode(entry);
  const roll = (h + index * 7) % 9;

  if (roll === 0) return 'xl';
  if (roll <= 2) return 'lg';
  if (roll <= 5) return 'md';
  return 'sm';
}

export function BouncingChips({
  entries,
  baseColor,
  onChipClick,
  onScroll,
  className,
}: BouncingChipsProps) {
  const chips = useMemo(() => {
    const tonePool = [
      'var(--color-text-primary)',
      `color-mix(in srgb, ${baseColor} 78%, black)`,
      `color-mix(in srgb, ${baseColor} 62%, black)`,
      `color-mix(in srgb, ${baseColor} 46%, black)`,
    ];

    return entries.map((entry, index) => {
      const size = getChipSize(entry, index);
      const color = tonePool[Math.floor(Math.random() * tonePool.length)];

      return { entry, size, color };
    });
  }, [entries, baseColor]);

  return (
    <div
      className={cn('relative h-full w-full overflow-auto', className)}
      onScroll={onScroll}
    >
      <div className="flex flex-wrap content-start items-end gap-x-4 gap-y-3 p-6">
        {chips.map(({ entry, size, color }) => (
          <div key={entry} className="inline-flex">
            <button
              type="button"
              onClick={() => onChipClick(entry)}
              style={{ color }}
              className={cn(
                'inline-flex items-center whitespace-nowrap leading-none transition-[color,transform] duration-200',
                'select-none rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]/30 focus-visible:ring-offset-2',
                'hover:-translate-y-0.5 hover:text-[var(--color-brand)]',
                size === 'xl' && 'font-editorial text-[2rem] font-semibold tracking-[-0.02em]',
                size === 'lg' && 'font-editorial text-[1.55rem] font-semibold tracking-[-0.015em]',
                size === 'md' && 'text-[1.15rem] font-medium',
                size === 'sm' && 'text-[0.98rem] font-medium',
              )}
            >
              {entry}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
