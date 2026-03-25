// src/components/primitives/TextSkeleton.tsx

import React from 'react';
import { Skeleton } from '@/shared/components/ui/skeleton';
import { cn } from '@/lib/utils';

interface TextSkeletonProps {
  lines?: number;
  /** Width ratio of the last line (0-1) */
  lastLineWidth?: number;
  /** Line spacing */
  spacing?: 'tight' | 'normal' | 'loose';
  className?: string;
  /** Whether to show shimmer animation */
  animated?: boolean;
  ariaLabel?: string;
  srText?: string;
}

const spacingStyles: Record<string, number> = {
  tight: 0,
  normal: 8,
  loose: 12,
};

export const TextSkeleton: React.FC<TextSkeletonProps> = ({
  lines = 3,
  lastLineWidth = 0.6,
  spacing = 'normal',
  className = '',
  animated = true,
  ariaLabel,
  srText,
}) => {
  const widths = Array.from({ length: lines }).map((_, index) => {
    return index === lines - 1 ? `${Math.round(lastLineWidth * 100)}%` : '100%';
  });

  return (
    <div
      className={className}
      role="status"
      aria-label={ariaLabel}
    >
      <div>
        {widths.map((width, index) => (
          <Skeleton
            // eslint-disable-next-line react/no-array-index-key
            key={`${width}-${index}`}
            className={cn('h-4', !animated && 'animate-none')}
            style={{
              width,
              marginTop: index === 0 ? 0 : spacingStyles[spacing],
            }}
          />
        ))}
      </div>
      {srText && <span className="sr-only">{srText}</span>}
    </div>
  );
};

// single line inline skeleton
export const InlineSkeleton: React.FC<{
  width?: string;
  className?: string;
}> = ({ width = '4rem', className = '' }) => (
  <span
    className={cn('inline-block align-middle', className)}
    style={{ width }}
  >
    <Skeleton className="h-4" style={{ width, minWidth: width }} />
  </span>
);

// multi-line paragraph skeleton
export const ParagraphSkeleton: React.FC<{
  sentences?: number;
  className?: string;
}> = ({ sentences = 5, className = '' }) => (
  <div className={className}>
    {Array.from({ length: Math.ceil(sentences / 3) }).map((_, pIndex) => (
      <TextSkeleton
        key={pIndex}
        lines={Math.min(3, sentences - pIndex * 3)}
        lastLineWidth={0.7}
        spacing="loose"
      />
    ))}
  </div>
);

export default TextSkeleton;
