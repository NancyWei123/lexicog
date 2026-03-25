import { useState, useEffect, useCallback, useRef } from 'react';
import { flushSync } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { listen, emit } from '@tauri-apps/api/event';
import { Channel } from '@tauri-apps/api/core';
import { Search, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { WindowScaffold } from '@/layout/WindowScaffold';
import { WindowAppBar } from '@/layout/WindowAppBar';
import { LinearProgress, useNotification } from '@/shared/components/feedback';
import {
  getSharedSelectedText,
  useWindowSelectionTracker,
} from '@/stores/selection';
import { LexicalEntryCard } from '../components/LexicalEntryCard';

import { lookupLexicalEntry } from '@/services/serve';
import { hideWindow } from '@/services/util';
import type { LexicalEntryResponse } from '@/types/lexical-entry';
import { Button } from '@/shared/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/components/ui/tooltip';

interface LookupHistoryItem {
  entry: LexicalEntryResponse;
  isMarked: boolean;
}

export default function LookupPage() {
  const { t } = useTranslation();
  const { notify } = useNotification();
  useWindowSelectionTracker();
  const [channel, setChannel] = useState<Channel<string | null> | null>(null);
  const [isMarked, setIsMarked] = useState(false);
  const [hasContent, setHasContent] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isLookupSettled, setIsLookupSettled] = useState(false);
  const [didLookupFail, setDidLookupFail] = useState(false);
  const [historyStack, setHistoryStack] = useState<LookupHistoryItem[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const isNavigatingRef = useRef(false);
  const isLookupInProgressRef = useRef(false);

  const canGoBack = historyIndex > 0;
  const canGoForward = historyIndex < historyStack.length - 1;

  const cachedEntry =
    isNavigatingRef.current && historyIndex >= 0 && historyIndex < historyStack.length
      ? historyStack[historyIndex].entry
      : undefined;

  const handleHide = useCallback(async () => {
    try {
      await hideWindow('lookup');
    } catch (error) {
      notify({
        type: 'error',
        message: t('error.hideWindowFailed'),
        error,
      });
    }
  }, [notify, t]);

  const startLookup = useCallback(
    async (lexicalEntry?: string, refresh = false) => {
      if (isLookupInProgressRef.current && !refresh) return;
      isLookupInProgressRef.current = true;
      isNavigatingRef.current = false;
      const newChannel = new Channel<string | null>();

      // Mount the stream consumer before the backend can emit.
      flushSync(() => {
        setChannel(newChannel);
        setHasContent(true);
        setIsStreaming(true);
        setIsLookupSettled(false);
        setDidLookupFail(false);
      });

      try {
        const marked = await lookupLexicalEntry(newChannel, refresh, lexicalEntry);
        setIsMarked(marked);
        setDidLookupFail(false);
        await emit('lexical-entry-history-changed');
      } catch (error) {
        setDidLookupFail(true);
        notify({
          type: 'error',
          message: t('error.lookupFailed'),
          error,
        });
      } finally {
        setIsStreaming(false);
        setIsLookupSettled(true);
        isLookupInProgressRef.current = false;
      }
    },
    [notify, t]
  );

  const handleRefresh = useCallback(() => {
    startLookup(undefined, true);
  }, [startLookup]);

  const historyIndexRef = useRef(historyIndex);
  historyIndexRef.current = historyIndex;
  const isMarkedRef = useRef(isMarked);
  isMarkedRef.current = isMarked;

  const handleEntryLoaded = useCallback(
    (entry: LexicalEntryResponse) => {
      if (isNavigatingRef.current) {
        isNavigatingRef.current = false;
        return;
      }
      setHistoryStack((prev) => [...prev.slice(0, historyIndexRef.current + 1), { entry, isMarked: isMarkedRef.current }]);
      setHistoryIndex((prev) => prev + 1);
    },
    []
  );

  const handleGoBack = useCallback(() => {
    if (!canGoBack) return;
    const newIndex = historyIndex - 1;
    isNavigatingRef.current = true;
    setHistoryIndex(newIndex);
    setIsMarked(historyStack[newIndex].isMarked);
    setChannel(null);
    setIsStreaming(false);
    setDidLookupFail(false);
    setIsLookupSettled(true);
  }, [canGoBack, historyIndex, historyStack]);

  const handleGoForward = useCallback(() => {
    if (!canGoForward) return;
    const newIndex = historyIndex + 1;
    isNavigatingRef.current = true;
    setHistoryIndex(newIndex);
    setIsMarked(historyStack[newIndex].isMarked);
    setChannel(null);
    setIsStreaming(false);
    setDidLookupFail(false);
    setIsLookupSettled(true);
  }, [canGoForward, historyIndex, historyStack]);

  useEffect(() => {
    const doLookup = () => {
      const lexicalEntry = getSharedSelectedText();
      if (lexicalEntry) {
        void startLookup(lexicalEntry);
        return;
      }

      void startLookup();
    };

    // Run once on mount to cover first-open wake races.
    doLookup();

    const unlisten = listen('lookup-wake', () => {
      doLookup();
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [startLookup]);

  const handleMarkChange = useCallback((marked: boolean) => {
    setIsMarked(marked);
  }, []);

  const handleDelete = useCallback(() => {
    setHistoryStack((prev) => {
      const next = [...prev];
      if (historyIndex >= 0 && historyIndex < next.length) {
        next.splice(historyIndex, 1);
      }
      return next;
    });
    if (historyStack.length <= 1) {
      setChannel(null);
      setHasContent(false);
      setHistoryIndex(-1);
      setIsLookupSettled(false);
      setDidLookupFail(false);
    } else if (historyIndex > 0) {
      const newIndex = historyIndex - 1;
      isNavigatingRef.current = true;
      setHistoryIndex(newIndex);
      setIsMarked(historyStack[newIndex].isMarked);
      setChannel(null);
      setIsLookupSettled(true);
      setDidLookupFail(false);
    } else {
      isNavigatingRef.current = true;
      setHistoryIndex(0);
      setIsMarked(historyStack[1]?.isMarked ?? false);
      setChannel(null);
      setIsLookupSettled(true);
      setDidLookupFail(false);
    }
  }, [historyIndex, historyStack]);

  return (
    <WindowScaffold variant="popup">
      <WindowAppBar
        title={t('lookup.title')}
        leading={
          <div className="flex items-center gap-0.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleGoBack}
                  disabled={!canGoBack}
                  aria-label={t('lookup.goBack')}
                  className="text-[var(--color-text-secondary)]"
                >
                  <ChevronLeft size={16} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('lookup.goBack')}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleGoForward}
                  disabled={!canGoForward}
                  aria-label={t('lookup.goForward')}
                  className="text-[var(--color-text-secondary)]"
                >
                  <ChevronRight size={16} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('lookup.goForward')}</TooltipContent>
            </Tooltip>
            <Button
              onClick={handleHide}
              aria-label={t('common.hide')}
              variant="ghost"
              size="icon"
              className="text-[var(--color-text-secondary)]"
            >
              <X size={16} />
            </Button>
          </div>
        }
      />

      {isStreaming && <LinearProgress indeterminate className="shrink-0" />}

      {hasContent && (cachedEntry || channel) ? (
        <div className="flex-1 overflow-auto bg-[var(--color-bg-base)]">
          {cachedEntry ? (
            <LexicalEntryCard
              key={`cached-${historyIndex}`}
              cachedEntry={cachedEntry}
              actionsVisible
              initialMarked={isMarked}
              onMarkChange={handleMarkChange}
              onNotify={notify}
              onRefresh={handleRefresh}
              onDelete={handleDelete}
              className="px-4 py-3"
            />
          ) : channel ? (
            <LexicalEntryCard
              key={`stream-${channel}`}
              channel={channel}
              actionsVisible={isLookupSettled}
              loadFailed={didLookupFail}
              initialMarked={isMarked}
              onMarkChange={handleMarkChange}
              onNotify={notify}
              onRefresh={handleRefresh}
              onEntryLoaded={handleEntryLoaded}
              onDelete={handleDelete}
              className="px-4 py-3"
            />
          ) : null}
        </div>
      ) : (
        <IdleState />
      )}
    </WindowScaffold>
  );
}

function IdleState() {
  const { t } = useTranslation();

  return (
    <div className="flex-1 flex items-center justify-center px-6 pb-6 bg-[var(--color-bg-base)]">
      <div className="flex max-w-sm flex-col items-center gap-2 text-center">
        <span className="rounded-full bg-[var(--color-bg-surface-secondary)] p-3">
          <Search size={24} className="text-[var(--color-text-tertiary)]" />
        </span>
        <p className="text-sm text-[var(--color-text-primary)]">{t('lexicalEntry.idle.title')}</p>
        <p className="text-xs text-[var(--color-text-secondary)]">{t('lexicalEntry.idle.description')}</p>
      </div>
    </div>
  );
}
