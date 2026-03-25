import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { Message } from '@/types/review';
import { cn } from '@/lib/utils';
import { Input } from '@/shared/components/ui/input';

interface MessageBubbleProps {
  message: Message;
  alignment: 'left' | 'right';
  blankValues: Record<number, string>;
  blankValidation: Record<number, boolean | null>;
  blankPerfectMatches: Record<number, string>;
  blankStartIndex: number;
  onBlankChange: (index: number, value: string) => void;
  onBlankSubmit: (index: number) => void;
  isBlankDisabled?: (index: number) => boolean;
  animate?: boolean;
  onTypingProgress?: () => void;
  onTypingComplete?: () => void;
  className?: string;
}

export function MessageBubble({
  message,
  alignment,
  blankValues,
  blankValidation,
  blankPerfectMatches,
  blankStartIndex,
  onBlankChange,
  onBlankSubmit,
  isBlankDisabled,
  animate = false,
  onTypingProgress,
  onTypingComplete,
  className,
}: MessageBubbleProps) {
  const { t } = useTranslation();

  const totalTextChars = message.contentParts.reduce(
    (sum, part) => sum + (part.type === 'text' ? part.value.length : 0),
    0,
  );

  const [typedChars, setTypedChars] = useState(animate ? 0 : totalTextChars);
  const typingDoneRef = useRef(false);

  useEffect(() => {
    if (animate) {
      setTypedChars(0);
      typingDoneRef.current = false;
    } else {
      setTypedChars(totalTextChars);
    }
  }, [animate, totalTextChars]);

  useEffect(() => {
    if (!animate) return;
    if (typedChars >= totalTextChars) {
      if (!typingDoneRef.current) {
        typingDoneRef.current = true;
        onTypingComplete?.();
      }
      return;
    }
    const timer = setTimeout(() => {
      setTypedChars((prev) => Math.min(prev + 1, totalTextChars));
    }, 18);
    return () => clearTimeout(timer);
  }, [animate, typedChars, totalTextChars, onTypingComplete]);

  useEffect(() => {
    if (!animate || typedChars <= 0 || typedChars >= totalTextChars) return;
    onTypingProgress?.();
  }, [animate, typedChars, totalTextChars, onTypingProgress]);

  let charsLeft = typedChars;
  let blankIdx = blankStartIndex;
  const elements: React.ReactNode[] = [];

  for (let i = 0; i < message.contentParts.length; i++) {
    const part = message.contentParts[i];
    if (part.type === 'text') {
      const visible = Math.min(part.value.length, charsLeft);
      charsLeft -= visible;
      if (visible > 0) {
        elements.push(<span key={i}>{part.value.slice(0, visible)}</span>);
      }
      if (visible < part.value.length) break;
    } else if (part.type === 'blank') {
      const currentIndex = blankIdx;
      blankIdx++;
      const value = blankValues[currentIndex] ?? '';
      const validation = blankValidation[currentIndex];
      const perfectMatch = blankPerfectMatches[currentIndex] ?? '';
      const disabled = isBlankDisabled?.(currentIndex) ?? false;
      elements.push(
        <BlankInput
          key={i}
          value={value}
          validation={validation}
          perfectMatch={perfectMatch}
          disabled={disabled}
          onChange={(val) => onBlankChange(currentIndex, val)}
          onSubmit={() => onBlankSubmit(currentIndex)}
          placeholder={t('common.blankPlaceholder')}
        />,
      );
    }
  }

  const isRight = alignment === 'right';
  const avatar = message.role.trim().slice(0, 1).toUpperCase() || '?';

  return (
    <div
      className={cn(
        'flex items-start gap-3',
        isRight ? 'justify-end pl-10' : 'justify-start pr-10',
        className,
      )}
    >
      {!isRight && (
        <div className="mt-1 flex size-8 shrink-0 items-center justify-center rounded-full bg-[rgba(0,0,0,0.035)] text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--color-text-secondary)]">
          {avatar}
        </div>
      )}

      <div
        className="max-w-[min(82%,46rem)] text-left"
      >
        <span
          className={cn(
            'mb-2 block text-[11px] font-medium uppercase tracking-[0.16em]',
            isRight
              ? 'mr-1 text-right text-[var(--color-brand)]'
              : 'ml-1 text-[var(--color-text-secondary)]',
          )}
        >
          {message.role}
        </span>

        <div
          className={cn(
            'rounded-[24px] px-4 py-3 text-sm leading-8 text-[var(--color-text-primary)]',
            isRight
              ? 'bg-[rgba(217,138,108,0.05)]'
              : 'bg-[rgba(0,0,0,0.035)]',
          )}
        >
          {elements}
          {animate && typedChars < totalTextChars && (
            <span className="ml-0.5 inline-block h-4 w-0.5 animate-pulse align-text-bottom bg-[var(--color-text-tertiary)]" />
          )}
        </div>
      </div>

      {isRight && (
        <div className="mt-1 flex size-8 shrink-0 items-center justify-center rounded-full bg-[rgba(217,138,108,0.08)] text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--color-brand)]">
          {avatar}
        </div>
      )}
    </div>
  );
}

interface BlankInputProps {
  value: string;
  validation: boolean | null;
  perfectMatch: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  onSubmit: () => void;
  placeholder?: string;
}

function BlankInput({
  value,
  validation,
  perfectMatch,
  disabled = false,
  onChange,
  onSubmit,
  placeholder,
}: BlankInputProps) {
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        onSubmit();
      }
    },
    [onSubmit],
  );

  return (
    <span className="inline-flex items-center gap-1 mx-1">
      {validation === true ? (
        <span className="inline-flex items-center gap-0.5 border-b border-[rgba(82,183,136,0.45)] bg-[rgba(82,183,136,0.06)] px-1 py-0.5 text-sm font-medium text-[var(--color-text-primary)]">
          {value}
        </span>
      ) : (
        <>
          <Input
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            disabled={disabled || validation === false}
            className={cn(
              'inline-block h-8 w-28 rounded-none border-0 border-b border-[rgba(0,0,0,0.12)] bg-transparent px-0 py-0 text-sm shadow-none hover:bg-transparent hover:shadow-none focus-visible:bg-transparent focus-visible:shadow-[inset_0_-1px_0_0_rgba(217,138,108,0.65)]',
              validation === false &&
                'border-b-[var(--color-error)] text-[var(--color-error)] focus-visible:shadow-[inset_0_-1px_0_0_rgba(214,64,69,0.5)]',
            )}
          />
          {validation === false && perfectMatch && (
            <span className="text-xs text-[var(--color-error)]">
              {perfectMatch}
            </span>
          )}
        </>
      )}
    </span>
  );
}
