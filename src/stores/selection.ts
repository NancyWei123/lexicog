import { useEffect, useRef } from 'react';

const SHARED_SELECTED_TEXT_KEY = 'lexicog:selected-text';
const APP_FOCUS_TOKEN_KEY = 'lexicog:focused-window-token';

function normalizeSelection(text: string | null | undefined): string {
  return text?.trim() || '';
}

function safeRead(key: string): string {
  try {
    return localStorage.getItem(key) || '';
  } catch {
    return '';
  }
}

function safeWrite(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Ignore write failures in constrained webview environments.
  }
}

function safeRemove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // Ignore remove failures in constrained webview environments.
  }
}

export function getSharedSelectedText(): string {
  return normalizeSelection(safeRead(SHARED_SELECTED_TEXT_KEY));
}

export function setSharedSelectedText(text: string): void {
  const normalized = normalizeSelection(text);
  if (!normalized) return;
  safeWrite(SHARED_SELECTED_TEXT_KEY, normalized);
}

export function clearSharedSelectedText(): void {
  safeRemove(SHARED_SELECTED_TEXT_KEY);
}

function markCurrentWindowFocused(windowToken: string): void {
  safeWrite(APP_FOCUS_TOKEN_KEY, `${windowToken}:${Date.now()}`);
}

function getFocusedWindowToken(): string {
  return safeRead(APP_FOCUS_TOKEN_KEY);
}

export function useWindowSelectionTracker(): void {
  const blurTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    const windowToken = `${window.location.pathname}-${Math.random().toString(16).slice(2)}`;

    const syncSelection = () => {
      const selected = normalizeSelection(window.getSelection()?.toString());
      if (selected) {
        setSharedSelectedText(selected);
      }
    };

    const clearPendingBlurTimer = () => {
      if (blurTimeoutRef.current !== null) {
        window.clearTimeout(blurTimeoutRef.current);
        blurTimeoutRef.current = null;
      }
    };

    const handleFocus = () => {
      clearPendingBlurTimer();
      markCurrentWindowFocused(windowToken);
    };

    const handleBlur = () => {
      clearPendingBlurTimer();
      const focusTokenWhenBlurred = getFocusedWindowToken();
      blurTimeoutRef.current = window.setTimeout(() => {
        const latestFocusToken = getFocusedWindowToken();
        const switchedToAnotherAppWindow = latestFocusToken !== focusTokenWhenBlurred;

        // Only clear when app focus does not move to another app window,
        // i.e. likely clicked outside the app.
        if (!switchedToAnotherAppWindow) {
          clearSharedSelectedText();
        }
        blurTimeoutRef.current = null;
      }, 150);
    };

    document.addEventListener('selectionchange', syncSelection);
    document.addEventListener('mouseup', syncSelection);
    document.addEventListener('keyup', syncSelection);
    window.addEventListener('focus', handleFocus);
    window.addEventListener('blur', handleBlur);

    if (document.hasFocus()) {
      handleFocus();
    }

    return () => {
      clearPendingBlurTimer();
      document.removeEventListener('selectionchange', syncSelection);
      document.removeEventListener('mouseup', syncSelection);
      document.removeEventListener('keyup', syncSelection);
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('blur', handleBlur);
    };
  }, []);
}
