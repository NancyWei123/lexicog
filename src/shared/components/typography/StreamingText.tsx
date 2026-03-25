// src/components/primitives/StreamingText.tsx

import React, { useMemo, useRef, useEffect } from 'react';

interface StreamingTextProps {
  /** Complete text content */
  content: string;
  /** Whether it is streaming output */
  isStreaming?: boolean;
  /** Sliding window size (last N characters have animation) */
  animatedWindowSize?: number;
  /** Font style */
  variant?: 'body' | 'large' | 'mono';
  className?: string;
  /** Callback when streaming is complete */
  onComplete?: () => void;
}

// Split text into static and animated parts
function splitContent(content: string, windowSize: number, isStreaming: boolean) {
  if (!isStreaming || content.length <= windowSize) {
    return {
      staticPart: isStreaming ? '' : content,
      animatedPart: isStreaming ? content : '',
    };
  }

  const splitIndex = content.length - windowSize;
  return {
    staticPart: content.slice(0, splitIndex),
    animatedPart: content.slice(splitIndex),
  };
}

const variantStyles: Record<string, string> = {
  body: 'text-base text-ink-primary leading-relaxed',
  large: 'text-lg text-ink-primary leading-relaxed',
  mono: 'font-mono text-sm text-ink-primary leading-relaxed',
};

export const StreamingText: React.FC<StreamingTextProps> = ({
  content,
  isStreaming = false,
  animatedWindowSize = 20,
  variant = 'body',
  className = '',
  onComplete,
}) => {
  const prevContentRef = useRef(content);
  const completedRef = useRef(false);

  // Detect completion of streaming
  useEffect(() => {
    if (!isStreaming && prevContentRef.current !== content && !completedRef.current) {
      completedRef.current = true;
      onComplete?.();
    }
    if (isStreaming) {
      completedRef.current = false;
    }
    prevContentRef.current = content;
  }, [content, isStreaming, onComplete]);

  // Split content into static and animated parts
  const { staticPart, animatedPart } = useMemo(
    () => splitContent(content, animatedWindowSize, isStreaming),
    [content, animatedWindowSize, isStreaming]
  );

  // Create delayed spans for each character in the animated part
  const animatedCharacters = useMemo(() => {
    if (!animatedPart) return null;

    return animatedPart.split('').map((char, index) => {
      const delay = Math.min(index * 15, 150); // Maximum delay 150ms
      return (
        <span
          key={`${index}-${char}`}
          className="inline-block animate-fade-slide-up opacity-0"
          style={{
            animationDelay: `${delay}ms`,
            animationFillMode: 'forwards',
          }}
        >
          {char === ' ' ? '\u00A0' : char}
        </span>
      );
    });
  }, [animatedPart]);

  return (
    <div className={`${variantStyles[variant]} ${className}`}>
      {/* Static part - plain text node for high performance */}
      {staticPart && <span className="whitespace-pre-wrap">{staticPart}</span>}
      
      {/* Animated part - each character animates independently */}
      {animatedCharacters}

      {/* Streaming cursor */}
      {isStreaming && (
        <span className="inline-block w-0.5 h-[1.1em] ml-0.5 bg-accent animate-pulse-soft align-middle" />
      )}
    </div>
  );
};

export default StreamingText;
