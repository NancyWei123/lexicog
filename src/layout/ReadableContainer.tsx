// src/layout/ReadableContainer.tsx

import { cn } from '@/lib/utils';

interface ReadableContainerProps {
  children: React.ReactNode;
  className?: string;
}

export function ReadableContainer({ children, className }: ReadableContainerProps) {
  return (
    <div className={cn('prose-output mx-auto w-full max-w-[80ch] px-5 sm:px-6', className)}>
      {children}
    </div>
  );
}
