import { useCallback } from 'react';
import { toast } from 'sonner';
import { error as logError } from '@tauri-apps/plugin-log';
import type { OnNotify } from '@/types/notification';

function extractErrorDetails(error: unknown): string {
  if (!error) return '';
  if (typeof error === 'string') return error;
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'object' && error !== null && 'message' in error) {
    return String((error as { message: unknown }).message);
  }
  try {
    return JSON.stringify(error, null, 2);
  } catch {
    return String(error);
  }
}

export function useNotification(): { notify: OnNotify } {
  const notify = useCallback<OnNotify>((payload) => {
    const { type, message, error } = payload;
    const details = extractErrorDetails(error);

    if (type === 'error') {
      const logLine = details ? `[UI Error] ${message}: ${details}` : `[UI Error] ${message}`;
      logError(logLine).catch(console.error);
    }

    switch (type) {
      case 'error':
        toast.error(message, {
          description: details || undefined,
          duration: details ? 15000 : 6000,
        });
        break;
      case 'warning':
        toast.warning(message);
        break;
      case 'info':
        toast.info(message);
        break;
      default:
        toast.success(message);
    }
  }, []);

  return { notify };
}
