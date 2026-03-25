import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Play, History, Trash2, CircleStop, ChevronDown } from 'lucide-react';
import { Channel } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { LinearProgress, useNotification } from '@/shared/components/feedback';
import { MessageBubble } from './MessageBubble';
import {
  serveSession,
  updateReviewState,
  getReviewHistory,
  getUniqueSourceLanguagesOfLexicalEntries,
  removeReviewSession,
  lookupLexicalEntry,
} from '@/services/serve';
import { deliverCancelSignalFromWindowToBackend } from '@/services/util';
import type { Session } from '@/types/review';
import { parseLexicalEntryResponse } from '@/types/lexical-entry';
import { cn } from '@/lib/utils';
import { Button } from '@/shared/components/ui/button';
import { ScrollArea } from '@/shared/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/components/ui/select';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/components/ui/tooltip';

interface ReviewSessionProps {
  className?: string;
}

interface ReviewCursor {
  messageIndex: number;
  partIndex: number;
}

function isBlankBeforeCursor(
  messageIndex: number,
  partIndex: number,
  cursor: ReviewCursor,
): boolean {
  if (messageIndex < cursor.messageIndex) return true;
  if (messageIndex > cursor.messageIndex) return false;
  return partIndex < cursor.partIndex;
}

export function ReviewSession({ className }: ReviewSessionProps) {
  const { t } = useTranslation();
  const { notify } = useNotification();

  const [languages, setLanguages] = useState<string[]>([]);
  const [selectedLang, setSelectedLang] = useState<string>('');
  const [sessionLanguage, setSessionLanguage] = useState('');
  const [session, setSession] = useState<Session | null>(null);
  const [cursor, setCursor] = useState<ReviewCursor | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isSubmittingBlank, setIsSubmittingBlank] = useState(false);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [history, setHistory] = useState<[Session, string][]>([]);
  const [selectedHistoryIdx, setSelectedHistoryIdx] = useState<number | null>(null);
  const [blankValues, setBlankValues] = useState<Record<number, string>>({});
  const [blankValidation, setBlankValidation] = useState<Record<number, boolean | null>>({});
  const [animationPhase, setAnimationPhase] = useState<'idle' | 'title' | 'desc' | 'messages'>('idle');
  const [visibleMsgCount, setVisibleMsgCount] = useState(0);
  const [currentMsgTypingDone, setCurrentMsgTypingDone] = useState(false);
  const [entryLemmas, setEntryLemmas] = useState<Record<string, string>>({});
  const [lemmaListOpen, setLemmaListOpen] = useState(false);

  const scrollEndRef = useRef<HTMLDivElement>(null);
  const scrollFrameRef = useRef<number | null>(null);
  const pendingScrollBehaviorRef = useRef<ScrollBehavior>('auto');
  const animationTriggeredRef = useRef(false);
  const cancelledRef = useRef(false);

  const scheduleScrollToEnd = useCallback(
    (behavior: ScrollBehavior = 'auto') => {
      if (selectedHistoryIdx !== null) return;

      if (
        behavior === 'smooth' ||
        scrollFrameRef.current === null
      ) {
        pendingScrollBehaviorRef.current = behavior;
      }

      if (scrollFrameRef.current !== null) return;

      scrollFrameRef.current = window.requestAnimationFrame(() => {
        scrollFrameRef.current = null;
        const nextBehavior = pendingScrollBehaviorRef.current;
        pendingScrollBehaviorRef.current = 'auto';
        scrollEndRef.current?.scrollIntoView({ behavior: nextBehavior });
      });
    },
    [selectedHistoryIdx],
  );

  useEffect(() => {
    return () => {
      if (scrollFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollFrameRef.current);
      }
    };
  }, []);

  useEffect(() => {
    async function loadLanguages() {
      try {
        const rawLangs = await getUniqueSourceLanguagesOfLexicalEntries();
        const langs = rawLangs.filter((l) => l !== '');
        setLanguages(langs);
        setSelectedLang((prev) => (prev || langs[0] || ''));
      } catch (error) {
        notify({
          type: 'error',
          message: t('error.genericMessage'),
          error,
        });
      }
    }
    loadLanguages();
  }, [notify, t]);

  const loadHistory = useCallback(async () => {
    try {
      const results = await getReviewHistory(20, 0);
      setHistory(results);
    } catch (error) {
      notify({
        type: 'error',
        message: t('main.notifications.loadHistoryFailed', { error: String(error) }),
        error,
      });
    }
  }, [notify, t]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const displaySession = selectedHistoryIdx !== null
    ? history[selectedHistoryIdx]?.[0] ?? null
    : session;
  const isHistoryView = selectedHistoryIdx !== null;

  const speakers = useMemo(() => {
    if (!displaySession?.messages) return [];
    const seen = new Set<string>();
    const result: string[] = [];
    for (const msg of displaySession.messages) {
      if (!seen.has(msg.role)) {
        seen.add(msg.role);
        result.push(msg.role);
      }
    }
    return result;
  }, [displaySession]);

  const getAlignment = useCallback(
    (role: string): 'left' | 'right' => {
      return role === speakers[0] ? 'left' : 'right';
    },
    [speakers],
  );

  const {
    messageBlankInfo,
    blankPerfectMatches,
    blankLocations,
    blankLocationToIndex,
    totalBlanks,
  } = useMemo(() => {
    if (!displaySession?.messages) {
      return {
        messageBlankInfo: [],
        blankPerfectMatches: {} as Record<number, string>,
        blankLocations: [] as ReviewCursor[],
        blankLocationToIndex: {} as Record<string, number>,
        totalBlanks: 0,
      };
    }

    let blankIdx = 0;
    const perfectMatches: Record<number, string> = {};
    const locations: ReviewCursor[] = [];
    const locationToIndex: Record<string, number> = {};

    const info = displaySession.messages.map((msg, messageIndex) => {
      const startIndex = blankIdx;
      const indices: number[] = [];
      msg.contentParts.forEach((part, partIndex) => {
        if (part.type === 'blank') {
          perfectMatches[blankIdx] = part.perfectMatch;
          indices.push(blankIdx);
          locations.push({ messageIndex, partIndex });
          locationToIndex[`${messageIndex}:${partIndex}`] = blankIdx;
          blankIdx++;
        }
      });
      return { startIndex, indices };
    });

    return {
      messageBlankInfo: info,
      blankPerfectMatches: perfectMatches,
      blankLocations: locations,
      blankLocationToIndex: locationToIndex,
      totalBlanks: blankIdx,
    };
  }, [displaySession]);

  const activeBlankIndex = useMemo(() => {
    if (isHistoryView || !cursor) return null;
    const key = `${cursor.messageIndex}:${cursor.partIndex}`;
    return blankLocationToIndex[key] ?? null;
  }, [isHistoryView, cursor, blankLocationToIndex]);

  const sessionTargetEntries = useMemo(() => {
    if (!displaySession?.messages) return [];
    const entries = new Set<string>();
    for (const msg of displaySession.messages) {
      for (const part of msg.contentParts) {
        if (part.type === 'blank') {
          entries.add(part.targetEntry);
        }
      }
    }
    return Array.from(entries);
  }, [displaySession]);

  useEffect(() => {
    if (isHistoryView || sessionTargetEntries.length === 0) {
      setEntryLemmas({});
      return;
    }

    let cancelled = false;

    async function fetchLemmas() {
      const lemmas: Record<string, string> = {};
      for (const entry of sessionTargetEntries) {
        if (cancelled) break;
        try {
          let jsonBuffer = '';
          const channel = new Channel<string | null>();
          channel.onmessage = (msg) => {
            if (msg !== null) {
              jsonBuffer += msg;
            }
          };
          await lookupLexicalEntry(channel, false, entry);
          const parsed = parseLexicalEntryResponse(jsonBuffer);
          if (parsed?.lemma) {
            lemmas[entry] = parsed.lemma;
          }
        } catch {}
      }
      if (!cancelled) {
        setEntryLemmas(lemmas);
      }
    }

    fetchLemmas();
    return () => { cancelled = true; };
  }, [isHistoryView, sessionTargetEntries]);

  const startSession = useCallback(async () => {
    if (!selectedLang) return;
    const sourceLanguage = selectedLang;

    setIsLoading(true);
    setIsStreaming(true);
    setSessionLanguage('');
    setSession(null);
    setCursor(null);
    setSelectedHistoryIdx(null);
    setBlankValues({});
    setBlankValidation({});
    setAnimationPhase('idle');
    setVisibleMsgCount(0);
    setCurrentMsgTypingDone(false);
    setEntryLemmas({});
    setLemmaListOpen(false);
    animationTriggeredRef.current = false;
    cancelledRef.current = false;

    const newChannel = new Channel<string | null>();
    newChannel.onmessage = (msg) => {
      if (cancelledRef.current) return;

      if (msg === null) {
        setIsStreaming(false);
      }
    };

    try {
      const result = await serveSession(newChannel, sourceLanguage);
      if (cancelledRef.current) return;
      if (!result) {
        notify({
          type: 'info',
          message: t('main.review.allDone'),
        });
        return;
      }
      {
        const [nextSession, messageIndex, partIndex] = result;
        const nextCursor: ReviewCursor = { messageIndex, partIndex };
        const initialValues: Record<number, string> = {};
        const initialValidation: Record<number, boolean | null> = {};
        let blankIdx = 0;
        let completedBeforeCursorCount = 0;

        nextSession.messages.forEach((message, msgIdx) => {
          message.contentParts.forEach((part, contentPartIdx) => {
            if (part.type !== 'blank') return;
            if (isBlankBeforeCursor(msgIdx, contentPartIdx, nextCursor)) {
              initialValues[blankIdx] = part.perfectMatch;
              initialValidation[blankIdx] = true;
              completedBeforeCursorCount++;
            }
            blankIdx++;
          });
        });

        setSession(nextSession);
        setSessionLanguage(sourceLanguage);
        setCursor(nextCursor);
        setBlankValues(initialValues);
        setBlankValidation(initialValidation);

        if (completedBeforeCursorCount > 0) {
          animationTriggeredRef.current = true;
          setAnimationPhase('messages');
          setVisibleMsgCount(Math.max(1, messageIndex + 1));
          setCurrentMsgTypingDone(true);
        }
      }
    } catch (error) {
      notify({
        type: 'error',
        message: t('main.notifications.startSessionFailed', { error: String(error) }),
        error,
      });
    } finally {
      setIsLoading(false);
      setIsStreaming(false);
    }
  }, [selectedLang, notify, t]);

  useEffect(() => {
    if (
      session &&
      !isLoading &&
      !isHistoryView &&
      !animationTriggeredRef.current
    ) {
      animationTriggeredRef.current = true;

      const titleTimer = window.setTimeout(() => setAnimationPhase('title'), 100);
      const descTimer = window.setTimeout(() => setAnimationPhase('desc'), 600);
      const msgTimer = window.setTimeout(() => {
        setAnimationPhase('messages');
        setVisibleMsgCount(1);
        setCurrentMsgTypingDone(false);
      }, 1100);

      return () => {
        window.clearTimeout(titleTimer);
        window.clearTimeout(descTimer);
        window.clearTimeout(msgTimer);
      };
    }
  }, [session, isLoading, isHistoryView]);

  useEffect(() => {
    if (animationPhase !== 'messages' || !displaySession || isHistoryView) return;
    if (!currentMsgTypingDone) return;

    const currentIdx = visibleMsgCount - 1;
    if (currentIdx < 0 || currentIdx >= displaySession.messages.length) return;

    const info = messageBlankInfo[currentIdx];
    if (!info) return;

    const allBlanksComplete =
      info.indices.length === 0 ||
      info.indices.every((i) => blankValidation[i] !== null && blankValidation[i] !== undefined);

    if (allBlanksComplete && visibleMsgCount < displaySession.messages.length) {
      const timer = setTimeout(() => {
        setVisibleMsgCount((prev) => prev + 1);
        setCurrentMsgTypingDone(false);
      }, 600);
      return () => clearTimeout(timer);
    }
  }, [animationPhase, currentMsgTypingDone, visibleMsgCount, displaySession, isHistoryView, messageBlankInfo, blankValidation]);

  useEffect(() => {
    if (!session || isHistoryView) return;
    if (totalBlanks === 0) {
      if (!isStreaming) loadHistory();
      return;
    }
    const allDone = Array.from({ length: totalBlanks }, (_, i) => i)
      .every((i) => blankValidation[i] !== null && blankValidation[i] !== undefined);
    if (allDone) {
      loadHistory();
    }
  }, [session, isHistoryView, isStreaming, totalBlanks, blankValidation, loadHistory]);

  useEffect(() => {
    const unlisten = listen<string>('review-task-started', (event) => {
      setTaskId(event.payload);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  const handleStop = useCallback(async () => {
    cancelledRef.current = true;
    if (taskId) {
      try {
        await deliverCancelSignalFromWindowToBackend(taskId);
        setIsStreaming(false);
        setIsLoading(false);
      } catch (error) {
        notify({
          type: 'error',
          message: t('error.genericMessage'),
          error,
        });
      }
    }
  }, [taskId, notify, t]);

  useEffect(() => {
    if (visibleMsgCount === 0) return;
    scheduleScrollToEnd('smooth');
  }, [visibleMsgCount, scheduleScrollToEnd]);

  const handleBlankChange = useCallback((index: number, value: string) => {
    if (isHistoryView || activeBlankIndex === null || index !== activeBlankIndex) return;
    setBlankValues((prev) => ({ ...prev, [index]: value }));
    setBlankValidation((prev) => ({ ...prev, [index]: null }));
  }, [isHistoryView, activeBlankIndex]);

  const isBlankDisabled = useCallback(
    (index: number) => {
      if (isHistoryView || isSubmittingBlank) return true;
      if (activeBlankIndex === null) return true;
      if (blankValidation[index] !== null && blankValidation[index] !== undefined) return true;
      return index !== activeBlankIndex;
    },
    [isHistoryView, isSubmittingBlank, activeBlankIndex, blankValidation],
  );

  const handleBlankSubmit = useCallback(
    async (index: number) => {
      if (isHistoryView || activeBlankIndex === null) return;
      if (index !== activeBlankIndex || isSubmittingBlank) return;

      const value = (blankValues[index] ?? '').trim();
      if (!value) return;

      const perfectMatch = blankPerfectMatches[index] ?? '';
      const isCorrect = perfectMatch.toLowerCase() === value.toLowerCase();
      const sourceLanguage = sessionLanguage || selectedLang;
      if (!sourceLanguage) return;

      setIsSubmittingBlank(true);
      try {
        await updateReviewState(sourceLanguage, value);
        setBlankValues((prev) => ({ ...prev, [index]: value }));
        setBlankValidation((prev) => ({ ...prev, [index]: isCorrect }));

        const nextLocation = blankLocations[index + 1];
        if (nextLocation) {
          setCursor(nextLocation);
        } else {
          setCursor(null);
          if (displaySession) {
            setVisibleMsgCount(displaySession.messages.length);
            setCurrentMsgTypingDone(true);
          }
          await loadHistory();
          setSession(null);
          setSelectedHistoryIdx(0);
        }
      } catch (error) {
        notify({
          type: 'error',
          message: t('main.notifications.validateFailed'),
          error,
        });
      } finally {
        setIsSubmittingBlank(false);
      }
    },
    [
      isHistoryView,
      activeBlankIndex,
      isSubmittingBlank,
      blankValues,
      blankPerfectMatches,
      selectedLang,
      sessionLanguage,
      blankLocations,
      displaySession,
      loadHistory,
      notify,
      t,
    ],
  );

  const handleDeleteSession = useCallback(
    async (reviewTime: string) => {
      try {
        await removeReviewSession(reviewTime);
        setSelectedHistoryIdx(null);
        await loadHistory();
      } catch (error) {
        notify({
          type: 'error',
          message: t('error.genericMessage'),
          error,
        });
      }
    },
    [loadHistory, notify, t],
  );

  const handleTypingComplete = useCallback(() => {
    setCurrentMsgTypingDone(true);
  }, []);

  const handleTypingProgress = useCallback(() => {
    scheduleScrollToEnd('auto');
  }, [scheduleScrollToEnd]);

  const historyBlankValues = useMemo(() => {
    if (!isHistoryView) return {};
    const values: Record<number, string> = {};
    for (const [idx, pm] of Object.entries(blankPerfectMatches)) {
      values[Number(idx)] = pm;
    }
    return values;
  }, [isHistoryView, blankPerfectMatches]);

  const historyBlankValidation = useMemo(() => {
    if (!isHistoryView) return {};
    const validation: Record<number, boolean> = {};
    for (const idx of Object.keys(blankPerfectMatches)) {
      validation[Number(idx)] = true;
    }
    return validation;
  }, [isHistoryView, blankPerfectMatches]);

  const messagesToShow = isHistoryView
    ? displaySession?.messages ?? []
    : displaySession?.messages?.slice(0, visibleMsgCount) ?? [];

  const animatingMsgIdx = !isHistoryView ? visibleMsgCount - 1 : -1;

  const lemmaList = useMemo(() => {
    if (isHistoryView) return [];
    return sessionTargetEntries
      .map((entry) => entryLemmas[entry] ?? entry)
      .filter((v, i, a) => a.indexOf(v) === i);
  }, [isHistoryView, sessionTargetEntries, entryLemmas]);

  return (
    <div className={cn('flex h-full min-w-0 gap-3', className)}>
      <div className="w-52 shrink-0 overflow-hidden rounded-[24px] bg-[var(--color-bg-sidebar)] shadow-[var(--color-panel-shadow)]">
        <div className="flex h-full min-h-0 flex-col">
          <div className="shrink-0 space-y-3 p-3 shadow-[inset_0_-1px_0_rgba(0,0,0,0.04)]">
            <Select value={selectedLang} onValueChange={setSelectedLang}>
              <SelectTrigger className="h-10">
                <SelectValue placeholder={t('main.review.selectLanguagePlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                {languages.map((lang) => (
                  <SelectItem key={lang} value={lang}>
                    {lang}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Button
              type="button"
              onClick={startSession}
              disabled={!selectedLang || isLoading || isSubmittingBlank}
              className="h-10 w-full gap-2"
            >
              <Play size={14} />
              {isLoading ? t('common.loadingContent') : t('main.review.startSession')}
            </Button>
          </div>

          {session && (
            <button
              type="button"
              onClick={() => setSelectedHistoryIdx(null)}
              className={cn(
                'relative flex items-center gap-2 px-3 py-3 text-left transition-colors shadow-[inset_0_-1px_0_rgba(0,0,0,0.04)]',
                selectedHistoryIdx === null
                  ? 'bg-[rgba(217,138,108,0.08)] before:absolute before:left-0 before:top-3 before:bottom-3 before:w-px before:rounded-full before:bg-[rgba(217,138,108,0.8)]'
                  : 'hover:bg-[rgba(0,0,0,0.03)]',
              )}
            >
              <Play size={14} className="shrink-0 text-[var(--color-brand)]" />
              <div className="min-w-0 flex-1">
                <span className="block max-w-full truncate text-sm font-medium text-[var(--color-text-primary)]">
                  {session.topic}
                </span>
              </div>
            </button>
          )}

          <div className="shrink-0 px-3 pb-2 pt-4">
            <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-[var(--color-text-tertiary)]">
              <History size={12} />
              {t('browsingHistory.label')}
            </div>
          </div>
          <div className="flex-1 overflow-y-auto overflow-x-hidden">
            <div className="flex flex-col gap-0.5 px-1.5 py-1">
              {history.length === 0 ? (
                <p className="p-3 text-center text-xs text-[var(--color-text-tertiary)]">
                  {t('main.review.emptyState')}
                </p>
              ) : (
                history.map(([histSession], idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => setSelectedHistoryIdx(idx)}
                    className={cn(
                      'relative flex min-w-0 items-center gap-2 rounded-2xl px-3 py-2.5 text-left text-sm transition-colors',
                      selectedHistoryIdx === idx
                        ? 'bg-[rgba(217,138,108,0.08)] font-medium text-[var(--color-text-primary)] before:absolute before:left-0 before:top-3 before:bottom-3 before:w-px before:rounded-full before:bg-[rgba(217,138,108,0.8)]'
                        : 'text-[var(--color-text-primary)] hover:bg-[rgba(0,0,0,0.03)]',
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate">{histSession.topic}</span>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="relative min-w-0 flex-1 overflow-hidden rounded-[28px] bg-[var(--color-bg-container)] shadow-[var(--color-panel-shadow)]">
        <div className="flex h-full flex-col">
          {isStreaming && <LinearProgress indeterminate className="shrink-0" />}
          {(isStreaming || isLoading) && taskId && (
            <div className="absolute right-3 top-3 z-10">
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label={t('common.stop')}
                    onClick={handleStop}
                    className="flex size-9 items-center justify-center rounded-full bg-[rgba(0,0,0,0.04)] text-[var(--color-text-primary)] transition-colors hover:bg-[rgba(0,0,0,0.07)]"
                  >
                    <CircleStop size={18} />
                  </button>
                </TooltipTrigger>
                <TooltipContent>{t('common.stop')}</TooltipContent>
              </Tooltip>
            </div>
          )}

          <ScrollArea className="flex-1 overflow-hidden">
            <div className="p-6">
              {!displaySession ? (
                <div className="mt-12 text-center text-sm text-[var(--color-text-tertiary)]">
                  {t('main.review.emptyState')}
                </div>
              ) : (
                <div className="mx-auto max-w-3xl">
                  <div
                    className={cn(
                      'mb-3 flex items-start justify-between gap-2 transition-all duration-500 ease-out',
                      isHistoryView || animationPhase !== 'idle'
                        ? 'opacity-100 translate-y-0'
                        : 'opacity-0 translate-y-3',
                    )}
                  >
                    <h3 className="font-editorial text-[1.9rem] font-semibold leading-tight text-[var(--color-text-primary)]">
                      {displaySession.topic}
                    </h3>
                    {isHistoryView && selectedHistoryIdx !== null && history[selectedHistoryIdx] && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-9 w-9 shrink-0 rounded-full text-[var(--color-text-tertiary)] hover:text-[var(--color-error)]"
                        onClick={() => handleDeleteSession(history[selectedHistoryIdx][1])}
                      >
                        <Trash2 size={16} />
                      </Button>
                    )}
                  </div>

                  <div
                    className={cn(
                      'mb-6 transition-all duration-500 ease-out',
                      isHistoryView || (animationPhase !== 'idle' && animationPhase !== 'title')
                        ? 'opacity-100 translate-y-0'
                        : 'opacity-0 translate-y-3',
                    )}
                  >
                    <p className="max-w-2xl text-[15px] leading-7 text-[var(--color-text-secondary)]">
                      {displaySession.contextIntro}
                    </p>
                  </div>

                  {!isHistoryView && lemmaList.length > 0 && (
                    <div
                      className={cn(
                        'mb-8 transition-all duration-500 ease-out',
                        animationPhase !== 'idle' && animationPhase !== 'title'
                          ? 'opacity-100 translate-y-0'
                          : 'opacity-0 translate-y-3',
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => setLemmaListOpen((prev) => !prev)}
                        className="inline-flex items-center gap-1 text-xs font-medium uppercase tracking-[0.16em] text-[var(--color-text-tertiary)] transition-colors hover:text-[var(--color-text-secondary)]"
                      >
                        <ChevronDown
                          size={14}
                          className={cn(
                            'transition-transform duration-200',
                            !lemmaListOpen && '-rotate-90',
                          )}
                        />
                        {t('main.review.vocabularyHint', { count: lemmaList.length })}
                      </button>
                      {lemmaListOpen && (
                        <div className="mt-4 flex flex-wrap items-end gap-x-4 gap-y-2.5">
                          {lemmaList.map((lemma, index) => (
                            <span
                              key={lemma}
                              className={cn(
                                'inline-flex items-baseline leading-none',
                                index % 5 === 0 && 'font-editorial text-[1.55rem] font-semibold text-[var(--color-text-primary)]',
                                index % 5 === 1 && 'text-[1.2rem] font-semibold text-[var(--color-text-primary)]',
                                index % 5 === 2 && 'text-base font-medium text-[var(--color-text-secondary)]',
                                index % 5 === 3 && 'font-editorial text-lg font-medium text-[var(--color-text-secondary)]',
                                index % 5 === 4 && 'text-sm font-medium text-[var(--color-text-tertiary)]',
                              )}
                            >
                              {lemma}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  <div className="space-y-6">
                  {messagesToShow.map((message, idx) => (
                    <div
                      key={idx}
                      style={{
                        animation:
                            !isHistoryView && idx === animatingMsgIdx
                              ? 'fadeSlideUp 0.3s ease-out both'
                              : undefined,
                        }}
                      >
                        <MessageBubble
                          message={message}
                          alignment={getAlignment(message.role)}
                          blankValues={isHistoryView ? historyBlankValues : blankValues}
                          blankValidation={isHistoryView ? historyBlankValidation : blankValidation}
                          blankPerfectMatches={blankPerfectMatches}
                          blankStartIndex={messageBlankInfo[idx]?.startIndex ?? 0}
                          onBlankChange={isHistoryView ? () => {} : handleBlankChange}
                          onBlankSubmit={isHistoryView ? () => {} : handleBlankSubmit}
                          isBlankDisabled={isBlankDisabled}
                          animate={!isHistoryView && idx === animatingMsgIdx}
                          onTypingProgress={handleTypingProgress}
                          onTypingComplete={handleTypingComplete}
                        />
                      </div>
                    ))}
                  </div>

                  <div ref={scrollEndRef} className="h-6" />
                </div>
              )}
            </div>
          </ScrollArea>
        </div>

      </div>
    </div>
  );
}
