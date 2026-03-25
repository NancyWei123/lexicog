import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useNotification } from '@/shared/components/feedback';
import { resetHotkey, readConfigFromStore } from '@/services/config';
import { DEFAULT_SHORTCUTS } from '@/constants/default-shortcuts';
import type { HotkeyFunction } from '@/types/config';
import { cn } from '@/lib/utils';
import { Input } from '@/shared/components/ui/input';
import { Skeleton } from '@/shared/components/ui/skeleton';

interface HotkeyConfigRowProps {
  functionName: HotkeyFunction;
  className?: string;
}

const CONFIG_KEYS: Record<HotkeyFunction, string> = {
  lookupLexicalEntry: 'lookupLexicalEntryShortcut',
  translateText: 'translateTextShortcut',
  ocr: 'ocrShortcut',
};

function normalizeHotkeyString(hotkey: string): string {
  const MODIFIER_MAP: Record<string, string> = {
    ctrl: 'Ctrl',
    control: 'Ctrl',
    alt: 'Alt',
    shift: 'Shift',
    cmd: 'Cmd',
    command: 'Cmd',
    meta: 'Cmd',
  };

  return hotkey
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const lower = part.toLowerCase();

      if (MODIFIER_MAP[lower]) {
        return MODIFIER_MAP[lower];
      }

      if (lower === 'space' || lower === 'spacebar') {
        return 'Space';
      }

      if (part.length === 1) {
        return part.toUpperCase();
      }

      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join('+');
}

function keyEventToHotkeyString(e: KeyboardEvent): string | null {
  const parts: string[] = [];

  if (e.ctrlKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  if (e.metaKey) parts.push('Cmd');

  let key = e.key;

  if (['Control', 'Alt', 'Shift', 'Meta'].includes(key)) {
    return null;
  }

  if (key === ' ') key = 'Space';
  if (key.length === 1) key = key.toUpperCase();

  if (parts.length === 0) {
    return null;
  }

  parts.push(key);
  return parts.join('+');
}

export function HotkeyConfigRow({ functionName, className }: HotkeyConfigRowProps) {
  const { t } = useTranslation();
  const { notify } = useNotification();

  const [hotkey, setHotkey] = useState<string>(
    normalizeHotkeyString(DEFAULT_SHORTCUTS[functionName])
  );
  const [pendingHotkey, setPendingHotkey] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const savedHotkeyRef = useRef<string>(
    normalizeHotkeyString(DEFAULT_SHORTCUTS[functionName])
  );

  useEffect(() => {
    async function loadConfig() {
      try {
        const value = await readConfigFromStore(CONFIG_KEYS[functionName]);
        const resolved = normalizeHotkeyString(
          value || DEFAULT_SHORTCUTS[functionName]
        );
        setHotkey(resolved);
        savedHotkeyRef.current = resolved;
      } catch (error) {
        notify({
          type: 'error',
          message: t('error.genericMessage'),
          error,
        });
      } finally {
        setIsLoading(false);
      }
    }
    loadConfig();
  }, [functionName, notify, t]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!isRecording) return;

      e.preventDefault();
      e.stopPropagation();

      const hotkeyStr = keyEventToHotkeyString(e);
      if (!hotkeyStr) return;

      setPendingHotkey(normalizeHotkeyString(hotkeyStr));
    },
    [isRecording]
  );

  useEffect(() => {
    if (isRecording) {
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }
  }, [isRecording, handleKeyDown]);

  const handleFocus = useCallback(() => {
    setIsRecording(true);
    setPendingHotkey(null);
  }, []);

  const handleBlur = useCallback(() => {
    setIsRecording(false);
    const newHotkey = pendingHotkey ? normalizeHotkeyString(pendingHotkey) : null;
    setPendingHotkey(null);

    if (!newHotkey || newHotkey === savedHotkeyRef.current) return;

    setHotkey(newHotkey);
    savedHotkeyRef.current = newHotkey;
    resetHotkey(functionName, newHotkey)
      .then(() => {
        notify({
          type: 'info',
          message: t('main.notifications.shortcutUpdated'),
        });
      })
      .catch((error) => {
        notify({
          type: 'error',
          message: t('main.notifications.shortcutUpdateFailed'),
          error,
        });
      });
  }, [pendingHotkey, functionName, notify, t]);

  const getHeadline = () => {
    switch (functionName) {
      case 'lookupLexicalEntry':
        return t('configures.shortcuts.lookup');
      case 'translateText':
        return t('configures.shortcuts.translate');
      case 'ocr':
        return t('configures.shortcuts.ocr');
    }
  };

  const displayValue = isRecording
    ? (pendingHotkey || t('configures.shortcuts.recording'))
    : hotkey;

  return (
    <div className={cn('flex items-center justify-between gap-4 py-4', className)}>
      <span className="min-w-0 flex-1 truncate whitespace-nowrap text-sm font-medium text-[var(--color-text-primary)]">
        {getHeadline()}
      </span>
      {isLoading ? (
        <Skeleton className="h-10 w-[152px]" />
      ) : (
        <Input
          type="text"
          value={displayValue}
          readOnly
          onFocus={handleFocus}
          onBlur={handleBlur}
          className={cn(
            'h-10 w-[152px] shrink-0 cursor-pointer text-center',
            isRecording &&
              'bg-[var(--color-bg-container)] shadow-[inset_0_0_0_1px_rgba(217,138,108,0.24),0_0_0_4px_var(--color-focus-ring)]'
          )}
          placeholder={t('configures.shortcuts.recording')}
        />
      )}
    </div>
  );
}
