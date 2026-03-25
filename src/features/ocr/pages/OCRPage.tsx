import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { listen } from '@tauri-apps/api/event';
import { Channel } from '@tauri-apps/api/core';
import { X, Languages, CircleStop } from 'lucide-react';
import { WindowScaffold } from '@/layout/WindowScaffold';
import { WindowAppBar } from '@/layout/WindowAppBar';
import { LinearProgress, useNotification } from '@/shared/components/feedback';
import { Skeleton } from '@/shared/components/ui/skeleton';
import { CropOverlay } from '../components';
import { serveOcr, fetchSelectedImage, mimicTriggerTranslateText } from '@/services/serve';
import { hideWindow, deliverCancelSignalFromWindowToBackend } from '@/services/util';
import { setSharedSelectedText, useWindowSelectionTracker } from '@/stores/selection';
import { Button } from '@/shared/components/ui/button';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/shared/components/ui/tooltip';

type Phase = 'idle' | 'crop' | 'processing' | 'done';

export default function OCRPage() {
  const { t } = useTranslation();
  const { notify } = useNotification();
  useWindowSelectionTracker();
  const [phase, setPhase] = useState<Phase>('idle');
  const [screenshotBase64, setScreenshotBase64] = useState<string>('');
  const [ocrText, setOcrText] = useState<string>('');
  const [taskId, setTaskId] = useState<string | null>(null);
  const ocrResultRef = useRef<string>('');
  const cancelledRef = useRef(false);
  const isOcrWakeInProgressRef = useRef(false);

  const handleHide = useCallback(async () => {
    try {
      await hideWindow('ocr');
      setPhase('idle');
      setScreenshotBase64('');
      setOcrText('');
      ocrResultRef.current = '';
    } catch (error) {
      notify({
        type: 'error',
        message: t('error.hideWindowFailed'),
        error,
      });
    }
  }, [notify, t]);

  const handleTranslate = useCallback(async () => {
    try {
      if (ocrResultRef.current.trim()) {
        setSharedSelectedText(ocrResultRef.current);
      }
      await mimicTriggerTranslateText();
    } catch (error) {
      notify({
        type: 'error',
        message: t('error.translateFailed'),
        error,
      });
    }
  }, [notify, t]);

  const handleStop = useCallback(async () => {
    cancelledRef.current = true;
    if (taskId) {
      try {
        await deliverCancelSignalFromWindowToBackend(taskId);
        setPhase('done');
      } catch (error) {
        notify({
          type: 'error',
          message: t('error.genericMessage'),
          error,
        });
      }
    }
  }, [taskId, notify, t]);

  const handleCropConfirm = useCallback(
    async (x: number, y: number, width: number, height: number) => {
      setPhase('processing');
      setOcrText('');
      ocrResultRef.current = '';
      cancelledRef.current = false;

      const channel = new Channel<string | null>();
      channel.onmessage = (msg) => {
        if (cancelledRef.current || msg === null) return;
        ocrResultRef.current += msg;
        setOcrText(ocrResultRef.current);
      };

      try {
        await serveOcr(channel, ['zh', 'en', 'ja'], x, y, width, height);
        setPhase('done');
      } catch (error) {
        notify({
          type: 'error',
          message: t('error.ocrFailed'),
          error,
        });
        setPhase('crop');
      }
    },
    [notify, t]
  );

  const handleCropCancel = useCallback(() => {
    setPhase('idle');
    setScreenshotBase64('');
    handleHide();
  }, [handleHide]);

  const handleRecropFromResult = useCallback(() => {
    setPhase('crop');
    setOcrText('');
    ocrResultRef.current = '';
  }, []);

  const doOcrWake = useCallback(async () => {
    if (isOcrWakeInProgressRef.current) return;
    isOcrWakeInProgressRef.current = true;
    try {
      const base64 = await fetchSelectedImage();
      if (base64) {
        setScreenshotBase64(base64);
        setPhase('crop');
      }
    } catch (error) {
      notify({
        type: 'error',
        message: t('error.ocrFailed'),
        error,
      });
    } finally {
      isOcrWakeInProgressRef.current = false;
    }
  }, [notify, t]);

  const doOcrWakeRef = useRef(doOcrWake);
  doOcrWakeRef.current = doOcrWake;

  useEffect(() => {
    const unlisteners: Promise<() => void>[] = [];

    // Run once on mount to cover first-open wake races.
    doOcrWakeRef.current();

    unlisteners.push(
      listen('ocr-wake', () => {
        doOcrWakeRef.current();
      })
    );

    unlisteners.push(
      listen<string>('ocr-task-started', (event) => {
        setTaskId(event.payload);
      })
    );

    return () => {
      unlisteners.forEach((unlisten) => unlisten.then((fn) => fn()));
    };
  }, []);

  if (phase === 'crop' && screenshotBase64) {
    return (
      <div className="fixed inset-0 bg-black">
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50">
          <div className="flex items-center gap-2 px-3 py-1.5 bg-[rgba(250,249,247,0.92)] backdrop-blur-sm rounded-full border border-[var(--color-border)]">
            <Button
              type="button"
              onClick={handleCropCancel}
              variant="ghost"
              size="icon"
              aria-label={t('ocr.exit')}
            >
              <X size={16} />
            </Button>
            <span className="px-1 text-sm text-[var(--color-text-primary)]">{t('ocr.exit')}</span>
          </div>
        </div>

        <CropOverlay
          screenshotBase64={screenshotBase64}
          onConfirm={handleCropConfirm}
          onCancel={handleCropCancel}
        />
      </div>
    );
  }

  if (phase === 'processing' || phase === 'done') {
    return (
      <WindowScaffold variant="popup">
        <WindowAppBar
          title={t('ocr.title')}
          onHide={handleHide}
          hideAriaLabel={t('common.hide')}
          actions={
            <>
              {phase === 'processing' && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={handleStop}
                      aria-label={t('common.stop')}
                      className="flex size-8 items-center justify-center rounded-xl bg-[var(--color-bg-surface-tertiary)] text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-border)]"
                    >
                      <CircleStop size={18} />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>{t('common.stop')}</TooltipContent>
                </Tooltip>
              )}
              {phase === 'done' && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={handleTranslate}
                      aria-label={t('ocr.translate')}
                    >
                      <Languages size={16} />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{t('ocr.translate')}</TooltipContent>
                </Tooltip>
              )}
            </>
          }
        />
        {phase === 'processing' && <LinearProgress indeterminate className="shrink-0" />}

        {screenshotBase64 && (
          <button
            type="button"
            onClick={handleRecropFromResult}
            className="shrink-0 w-full cursor-pointer border-b border-[var(--color-border)] bg-[var(--color-bg-surface-secondary)] hover:bg-[var(--color-bg-surface-tertiary)] transition-colors"
            style={{ height: '20vh' }}
            title={t('ocr.recropFromResult')}
          >
            <div className="relative h-full w-full overflow-hidden flex items-center justify-center">
              <img
                src={`data:image/png;base64,${screenshotBase64}`}
                alt="Cropped area"
                className="h-full w-auto object-contain"
                draggable={false}
              />
              <div className="absolute inset-0 bg-black/10" />
            </div>
          </button>
        )}

        <div className="flex-1 overflow-y-auto p-4">
          {ocrText ? (
            <p className="text-base leading-[1.7] select-text whitespace-pre-wrap">{ocrText}</p>
          ) : (
            <div className="space-y-3">
              {Array.from({ length: 16 }).map((_, index) => (
                <Skeleton
                  key={index}
                  className={`h-4 ${index === 15 ? 'w-2/3' : 'w-full'}`}
                />
              ))}
            </div>
          )}
        </div>
      </WindowScaffold>
    );
  }

  return (
    <WindowScaffold variant="popup">
      <WindowAppBar
        title={t('ocr.title')}
        onHide={handleHide}
        hideAriaLabel={t('common.hide')}
      />
      <div className="flex-1 flex items-center justify-center">
        <span className="text-sm text-[var(--color-text-secondary)]">{t('ocr.waitingForScreenshot')}</span>
      </div>
    </WindowScaffold>
  );
}
