import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { listen } from '@tauri-apps/api/event';
import { Channel } from '@tauri-apps/api/core';
import { CircleStop, Copy, Check } from 'lucide-react';
import { WindowScaffold } from '@/layout/WindowScaffold';
import { WindowAppBar } from '@/layout/WindowAppBar';
import { LinearProgress, useNotification } from '@/shared/components/feedback';
import { getSharedSelectedText, useWindowSelectionTracker } from '@/stores/selection';
import { Button } from '@/shared/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/components/ui/tooltip';
import {
  TranslationOutput,
  LanguageRequestOverlay,
  CollapsibleInputPanel,
} from '../components';
import { LanguageSelect } from '@/shared/components/form/LanguageSelect';
import { serveTextTranslation } from '@/services/serve';
import { readConfigFromStore, resetTargetLangOfTranslation } from '@/services/config';
import {
  hideWindow,
  deliverCancelSignalFromWindowToBackend,
  deliverSingleMessageFromWindowToBackend,
  replaceClipboard,
} from '@/services/util';
import { tryParseJsonWithRepair } from '@/lib/repair-json';
import {
  parseTranslationResponse,
  sanitizeTranslationResponse,
  type TranslationResponse,
} from '@/types/translation';
import type { TextAnalysisReport } from '@/types/text-analysis';

export default function TranslatePage() {
  const { t } = useTranslation();
  const { notify } = useNotification();
  useWindowSelectionTracker();
  const [taskId, setTaskId] = useState<string | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [sourceText, setSourceText] = useState('');
  const [content, setContent] = useState('');
  const [report, setReport] = useState<TextAnalysisReport | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [copied, setCopied] = useState(false);
  const [targetLang, setTargetLang] = useState('');
  const initialTargetLangRef = useRef<string | null>(null);
  const cancelledRef = useRef(false);
  const isTranslationInProgressRef = useRef(false);

  const revertTargetLang = useCallback(async () => {
    if (initialTargetLangRef.current && targetLang !== initialTargetLangRef.current) {
      try {
        await resetTargetLangOfTranslation(initialTargetLangRef.current);
      } catch {}
    }
  }, [targetLang]);

  const handleHide = useCallback(async () => {
    try {
      await revertTargetLang();
      await hideWindow('translate');
    } catch (error) {
      notify({
        type: 'error',
        message: t('error.hideWindowFailed'),
        error,
      });
    }
  }, [revertTargetLang, notify, t]);

  const handleStop = useCallback(async () => {
    cancelledRef.current = true;
    if (taskId) {
      try {
        await deliverCancelSignalFromWindowToBackend(taskId);
        setIsStreaming(false);
      } catch (error) {
        notify({
          type: 'error',
          message: t('error.genericMessage'),
          error,
        });
      }
    }
  }, [taskId, notify, t]);

  const handleCopy = useCallback(async () => {
    if (!content) return;
    try {
      await replaceClipboard(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      notify({
        type: 'error',
        message: t('error.genericMessage'),
        error,
      });
    }
  }, [content, notify, t]);

  const startTranslation = useCallback(
    async (text?: string) => {
      if (isTranslationInProgressRef.current) return;
      isTranslationInProgressRef.current = true;

      const newChannel = new Channel<string | null>();
      cancelledRef.current = false;

      setContent('');
      setReport(null);
      setIsStreaming(true);

      let buffer = '';
      newChannel.onmessage = (msg) => {
        if (cancelledRef.current) return;

        if (msg === null) {
          setIsStreaming(false);
          if (!buffer.trim()) return;

          const parsed = parseTranslationResponse(buffer);
          if (parsed) {
            setContent(parsed.translation);
            setReport(parsed.textAnalysisReport);
            return;
          }

          notify({
            type: 'error',
            message: t('error.failedToParseResponse'),
          });
        } else {
          buffer += msg;
          const parsed = tryParseJsonWithRepair<TranslationResponse>(buffer);
          if (parsed && typeof parsed.translation === 'string') {
            const sanitized = sanitizeTranslationResponse(parsed);
            setContent(sanitized.translation);
            setReport(sanitized.textAnalysisReport);
          }
        }
      };

      try {
        const returnedSourceText = await serveTextTranslation(newChannel, text);
        if (returnedSourceText) {
          setSourceText(returnedSourceText);
        }
      } catch (error) {
        notify({
          type: 'error',
          message: t('error.translationFailed'),
          error,
        });
        setIsStreaming(false);
      } finally {
        isTranslationInProgressRef.current = false;
      }
    },
    [notify, t]
  );

  const handleConfirmTranslate = useCallback(async () => {
    if (!sourceText.trim()) return;
    await startTranslation(sourceText);
  }, [sourceText, startTranslation]);

  const handleTargetLangChange = useCallback(
    async (lang: string) => {
      setTargetLang(lang);
      try {
        await resetTargetLangOfTranslation(lang);
      } catch (error) {
        notify({
          type: 'error',
          message: t('error.failedToUpdateLanguage'),
          error,
        });
      }
    },
    [notify, t]
  );

  const handleLanguageSelect = useCallback(
    async (reqId: string, languageCode: string) => {
      try {
        await deliverSingleMessageFromWindowToBackend(reqId, languageCode);
        setRequestId(null);
      } catch (error) {
        notify({
          type: 'error',
          message: t('error.failedToSetLanguage'),
          error,
        });
      }
    },
    [notify, t]
  );

  const startTranslationRef = useRef(startTranslation);
  startTranslationRef.current = startTranslation;

  useEffect(() => {
    const unlisteners: Promise<() => void>[] = [];

    const doTranslate = () => {
      const selectedText = getSharedSelectedText();
      if (selectedText) {
        setSourceText(selectedText);
        startTranslationRef.current(selectedText);
      } else {
        startTranslationRef.current();
      }
    };

    // Run once on mount to cover first-open wake races.
    doTranslate();

    unlisteners.push(
      listen('translation-wake', () => {
        doTranslate();
      })
    );

    unlisteners.push(
      listen<[string, string]>('translation-task-started', (event) => {
        setTaskId(event.payload[0]);
      })
    );

    unlisteners.push(
      listen<string>('request-target-language-of-translation', (event) => {
        setRequestId(event.payload);
      })
    );

    return () => {
      unlisteners.forEach((unlisten) => unlisten.then((fn) => fn()));
    };
  }, []);

  const revertTargetLangRef = useRef(revertTargetLang);
  revertTargetLangRef.current = revertTargetLang;

  useEffect(() => {
    const handleFocus = async () => {
      try {
        const stored = await readConfigFromStore('targetLangOfTranslation');
        initialTargetLangRef.current = stored;
        if (stored) {
          setTargetLang(stored);
        }
      } catch {}
    };

    const handleBlur = () => {
      revertTargetLangRef.current();
    };

    window.addEventListener('focus', handleFocus);
    window.addEventListener('blur', handleBlur);

    handleFocus();

    return () => {
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('blur', handleBlur);
    };
  }, []);

  return (
    <WindowScaffold variant="popup">
      <WindowAppBar
        title={t('translate.title')}
        onHide={handleHide}
        hideAriaLabel={t('common.hide')}
        actions={
          <>
            {isStreaming && taskId && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label={t('common.stop')}
                    onClick={handleStop}
                    className="flex size-8 items-center justify-center rounded-xl bg-[var(--color-bg-surface-tertiary)] text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-border)]"
                  >
                    <CircleStop size={18} />
                  </button>
                </TooltipTrigger>
                <TooltipContent>{t('common.stop')}</TooltipContent>
              </Tooltip>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={t('common.copyToClipboard')}
                  onClick={handleCopy}
                  disabled={!content}
                >
                  {copied ? <Check size={16} /> : <Copy size={16} />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('common.copyToClipboard')}</TooltipContent>
            </Tooltip>
          </>
        }
      />

      {isStreaming && <LinearProgress indeterminate className="shrink-0" />}

      {requestId && (
        <LanguageRequestOverlay
          requestId={requestId}
          onSelect={handleLanguageSelect}
        />
      )}

      <CollapsibleInputPanel
        inputText={sourceText}
        onInputChange={setSourceText}
        disabled={isStreaming}
      />

      <div className="flex items-center gap-2 border-b border-(--color-border) bg-(--color-bg-surface-secondary) px-4 py-2">
        <LanguageSelect
          value={targetLang}
          onValueChange={handleTargetLangChange}
          placeholder={t('translateText.selectTargetLanguage')}
          className="h-8 flex-1"
          popoverContentClassName="max-h-[min(20rem,var(--radix-popover-content-available-height))]"
          listClassName="max-h-[min(18rem,var(--radix-popover-content-available-height))]"
          popoverContentProps={{
            side: 'top',
            align: 'start',
            collisionPadding: 12,
          }}
        />
        <Button
          type="button"
          size="sm"
          onClick={handleConfirmTranslate}
          disabled={!sourceText.trim() || isStreaming}
        >
          {t('translateText.translate')}
        </Button>
      </div>

      <div className="flex-1 relative overflow-auto bg-[var(--color-bg-base)]">
        <TranslationOutput
          content={content}
          report={report}
          isStreaming={isStreaming}
        />
      </div>
    </WindowScaffold>
  );
}
