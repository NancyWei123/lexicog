import { useState, useEffect, useCallback, useMemo, useRef, type UIEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Channel } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { Search, BookmarkCheck, ArrowLeft, X } from 'lucide-react';
import { LinearProgress, useNotification } from '@/shared/components/feedback';
import {
  getLookupHistory,
  getUniqueDisciplinesOfLexicalEntries,
  getUniqueSourceLanguagesOfLexicalEntries,
  serveRepresentativeEntriesByDiscipline,
  mimicTriggerLookupLexicalEntry,
} from '@/services/serve';
import { setSharedSelectedText } from '@/stores/selection';
import { cn } from '@/lib/utils';
import { readConfigFromStore } from '@/services/config';
import { VKGDT_DISCIPLINE_NAME_I18N } from '@/constants/vkgdt-discipline-name';
import type { VKGDTDisciplineCode } from '@/types/discipline';
import type { RepresentativeEntriesResponse } from '@/types/representative-entries';
import type { TargetLanguageCode } from '@/constants/languages';
import { Input } from '@/shared/components/ui/input';
import { Button } from '@/shared/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select';
import { ScrollArea } from '@/shared/components/ui/scroll-area';
import { Skeleton } from '@/shared/components/ui/skeleton';
import {
  DisciplineDonutChart,
  getDisciplineColor,
  type DisciplineArcData,
} from './DisciplineDonutChart';
import { BouncingChips } from './BouncingChips';

interface HistoryBrowserProps {
  className?: string;
}

type HistoryRow = [string, number];

interface DisciplineCount {
  code: VKGDTDisciplineCode;
  count: number;
}

interface ChipsViewState {
  disciplineCode: VKGDTDisciplineCode;
  entries: string[];
  message: string;
  color: string;
}

const DISCIPLINE_CODES = (Object.keys(
  VKGDT_DISCIPLINE_NAME_I18N,
) as VKGDTDisciplineCode[]).filter((code) => code !== 'FG.GEN');
const DISCIPLINE_CODE_SET = new Set<VKGDTDisciplineCode>(DISCIPLINE_CODES);
const DISCIPLINE_OVERVIEW_CONCURRENCY = 6;

function toPrefixLike(prefix: string): string {
  const trimmed = prefix.trim();
  return trimmed ? `${trimmed}%` : '%';
}

function sanitizeHistoryRows(rows: HistoryRow[]): HistoryRow[] {
  return rows.filter(([entry]) => entry !== '');
}

function isKnownDisciplineCode(code: string): code is VKGDTDisciplineCode {
  return DISCIPLINE_CODE_SET.has(code as VKGDTDisciplineCode);
}

function getDisciplineName(
  code: VKGDTDisciplineCode,
  targetLang: TargetLanguageCode,
): string {
  return VKGDT_DISCIPLINE_NAME_I18N[code]?.[targetLang] ?? code;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  async function runWorker() {
    while (cursor < items.length) {
      const currentIndex = cursor;
      cursor += 1;
      results[currentIndex] = await worker(items[currentIndex], currentIndex);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => runWorker()),
  );

  return results;
}

export function HistoryBrowser({ className }: HistoryBrowserProps) {
  const { t } = useTranslation();
  const { notify } = useNotification();

  const [searchPrefix, setSearchPrefix] = useState('');
  const [debouncedSearchPrefix, setDebouncedSearchPrefix] = useState('');
  const [selectedLang, setSelectedLang] = useState('');
  const [languages, setLanguages] = useState<string[]>([]);
  const [overviewEntries, setOverviewEntries] = useState<HistoryRow[]>([]);
  const [entries, setEntries] = useState<HistoryRow[]>([]);
  const [isOverviewLoading, setIsOverviewLoading] = useState(true);
  const [isFilteredEntriesLoading, setIsFilteredEntriesLoading] = useState(false);
  const [disciplineCounts, setDisciplineCounts] = useState<DisciplineCount[]>([]);
  const [isChartLoading, setIsChartLoading] = useState(true);
  const [targetLang, setTargetLang] = useState<TargetLanguageCode>('en');
  const [chipsView, setChipsView] = useState<ChipsViewState | null>(null);
  const [representativeHeaderCollapseProgress, setRepresentativeHeaderCollapseProgress] =
    useState(0);
  const [representativeLoadingCode, setRepresentativeLoadingCode] =
    useState<VKGDTDisciplineCode | null>(null);
  const [activeDiscipline, setActiveDiscipline] = useState<
    VKGDTDisciplineCode | ''
  >('');

  const representativeRequestRef = useRef(0);
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    let isActive = true;
    let cleanup: (() => void) | undefined;

    void listen('lexical-entry-history-changed', () => {
      if (!isActive) return;
      setRefreshToken((prev) => prev + 1);
    }).then((unlisten) => {
      if (!isActive) {
        unlisten();
        return;
      }

      cleanup = unlisten;
    });

    return () => {
      isActive = false;
      cleanup?.();
    };
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearchPrefix(searchPrefix);
    }, 300);

    return () => {
      window.clearTimeout(timer);
    };
  }, [searchPrefix]);

  useEffect(() => {
    let cancelled = false;

    void getUniqueSourceLanguagesOfLexicalEntries()
      .then((langs) => {
        if (cancelled) return;
        setLanguages(langs.filter((lang) => lang !== ''));
      })
      .catch((error) => {
        if (cancelled) return;
        notify({ type: 'error', message: t('error.genericMessage'), error });
      });

    return () => {
      cancelled = true;
    };
  }, [notify, t]);

  useEffect(() => {
    let cancelled = false;

    void readConfigFromStore('targetLangOfLexicalEntryLookup').then((lang) => {
      if (cancelled || !lang) return;
      setTargetLang(lang as TargetLanguageCode);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadOverview = async () => {
      setIsOverviewLoading(true);

      try {
        const results = await getLookupHistory(
          toPrefixLike(debouncedSearchPrefix),
          selectedLang || undefined,
        );

        if (cancelled) return;
        setOverviewEntries(sanitizeHistoryRows(results));
      } catch (error) {
        if (cancelled) return;
        notify({
          type: 'error',
          message: t('main.notifications.loadHistoryFailed', {
            error: String(error),
          }),
          error,
        });
      } finally {
        if (!cancelled) {
          setIsOverviewLoading(false);
        }
      }
    };

    void loadOverview();

    return () => {
      cancelled = true;
    };
  }, [debouncedSearchPrefix, selectedLang, refreshToken, notify, t]);

  useEffect(() => {
    if (activeDiscipline) return;
    setEntries(overviewEntries);
    setIsFilteredEntriesLoading(false);
  }, [activeDiscipline, overviewEntries]);

  useEffect(() => {
    if (!activeDiscipline) return;

    let cancelled = false;

    const loadFilteredEntries = async () => {
      setIsFilteredEntriesLoading(true);

      try {
        const filtered = await getLookupHistory(
          toPrefixLike(debouncedSearchPrefix),
          selectedLang || undefined,
          activeDiscipline,
        );

        if (cancelled) return;
        setEntries(sanitizeHistoryRows(filtered));
      } catch (error) {
        if (cancelled) return;
        notify({
          type: 'error',
          message: t('main.notifications.loadHistoryFailed', {
            error: String(error),
          }),
          error,
        });
      } finally {
        if (!cancelled) {
          setIsFilteredEntriesLoading(false);
        }
      }
    };

    void loadFilteredEntries();

    return () => {
      cancelled = true;
    };
  }, [activeDiscipline, debouncedSearchPrefix, selectedLang, refreshToken, notify, t]);

  useEffect(() => {
    let cancelled = false;

    const loadDisciplineCounts = async () => {
      if (overviewEntries.length === 0) {
        setDisciplineCounts([]);
        setIsChartLoading(false);
        return;
      }

      const sourceLanguages = selectedLang
        ? [selectedLang]
        : languages.filter((language) => language !== '');
      if (sourceLanguages.length === 0) {
        setDisciplineCounts([]);
        setIsChartLoading(false);
        return;
      }

      setIsChartLoading(true);

      try {
        const disciplineGroups = await Promise.all(
          sourceLanguages.map((sourceLanguage) =>
            getUniqueDisciplinesOfLexicalEntries(sourceLanguage),
          ),
        );

        if (cancelled) return;

        const disciplineCodes = Array.from(
          new Set(
            disciplineGroups
              .flat()
              .map((code) => code.trim())
              .filter(isKnownDisciplineCode),
          ),
        );

        const counts = new Map<VKGDTDisciplineCode, number>();
        const disciplineCounts = await mapWithConcurrency(
          disciplineCodes,
          DISCIPLINE_OVERVIEW_CONCURRENCY,
          async (disciplineCode) => {
            const rows = await getLookupHistory(
              toPrefixLike(debouncedSearchPrefix),
              selectedLang || undefined,
              disciplineCode,
            );

            return {
              code: disciplineCode,
              count: sanitizeHistoryRows(rows).length,
            };
          },
        );

        if (cancelled) return;

        for (const { code, count } of disciplineCounts) {
          counts.set(code, count);
        }

        setDisciplineCounts(
          DISCIPLINE_CODES.map((code) => ({
            code,
            count: counts.get(code) ?? 0,
          })).filter((item) => item.count > 0),
        );
      } catch (error) {
        if (cancelled) return;
        notify({
          type: 'error',
          message: t('main.notifications.loadDisciplineOverviewFailed'),
          error,
        });
      } finally {
        if (!cancelled) {
          setIsChartLoading(false);
        }
      }
    };

    void loadDisciplineCounts();

    return () => {
      cancelled = true;
    };
  }, [overviewEntries, debouncedSearchPrefix, selectedLang, languages, notify, t]);

  useEffect(() => {
    representativeRequestRef.current += 1;
    setRepresentativeLoadingCode(null);
    setChipsView(null);
    setRepresentativeHeaderCollapseProgress(0);
  }, [searchPrefix, selectedLang]);

  useEffect(() => {
    setRepresentativeHeaderCollapseProgress(0);
  }, [chipsView?.disciplineCode, chipsView?.message]);

  const openLookupEntry = useCallback(
    async (entry: string) => {
      setSharedSelectedText(entry);

      try {
        await mimicTriggerLookupLexicalEntry();
      } catch (error) {
        notify({ type: 'error', message: t('error.genericMessage'), error });
      }
    },
    [notify, t],
  );

  const handleArcClick = useCallback(
    (disciplineCode: string) => {
      if (!isKnownDisciplineCode(disciplineCode)) return;

      const requestId = representativeRequestRef.current + 1;
      representativeRequestRef.current = requestId;

      setActiveDiscipline(disciplineCode);
      setRepresentativeLoadingCode(disciplineCode);
      setChipsView(null);

      const sourceLanguage = selectedLang || languages[0] || '';
      if (!sourceLanguage) {
        setRepresentativeLoadingCode(null);
        return;
      }

      const channel = new Channel<string | null>();
      channel.onmessage = () => {};

      void serveRepresentativeEntriesByDiscipline(
        channel,
        sourceLanguage,
        disciplineCode,
      )
        .then((response: RepresentativeEntriesResponse) => {
          if (representativeRequestRef.current !== requestId) return;

          setChipsView({
            disciplineCode,
            entries: response.lexicalEntries,
            message: response.message,
            color: getDisciplineColor(disciplineCode),
          });
        })
        .catch((error) => {
          if (representativeRequestRef.current !== requestId) return;
          notify({ type: 'error', message: t('error.genericMessage'), error });
        })
        .finally(() => {
          if (representativeRequestRef.current !== requestId) return;
          setRepresentativeLoadingCode(null);
        });
    },
    [languages, notify, selectedLang, t],
  );

  const handleBackToChart = useCallback(() => {
    representativeRequestRef.current += 1;
    setRepresentativeLoadingCode(null);
    setChipsView(null);
    setRepresentativeHeaderCollapseProgress(0);
    setActiveDiscipline('');
  }, []);

  const handleClearDiscipline = useCallback(() => {
    representativeRequestRef.current += 1;
    setRepresentativeLoadingCode(null);
    setChipsView(null);
    setRepresentativeHeaderCollapseProgress(0);
    setActiveDiscipline('');
  }, []);

  const handleRepresentativeEntriesScroll = useCallback(
    (event: UIEvent<HTMLDivElement>) => {
      const nextProgress = Math.min(event.currentTarget.scrollTop / 88, 1);
      setRepresentativeHeaderCollapseProgress((previous) =>
        Math.abs(previous - nextProgress) < 0.02 ? previous : nextProgress,
      );
    },
    [],
  );

  const chartData = useMemo<DisciplineArcData[]>(
    () =>
      disciplineCounts.map(({ code, count }) => ({
        code,
        name: getDisciplineName(code, targetLang),
        count,
      })),
    [disciplineCounts, targetLang],
  );

  const isEntriesLoading = activeDiscipline
    ? isFilteredEntriesLoading
    : isOverviewLoading;

  const totalFlatEntries = useMemo(
    () => disciplineCounts.reduce((sum, item) => sum + item.count, 0),
    [disciplineCounts],
  );

  const activeDisciplineName = activeDiscipline
    ? getDisciplineName(activeDiscipline, targetLang)
    : '';

  const representativeDisciplineCode =
    chipsView?.disciplineCode ?? representativeLoadingCode;
  const representativeDisciplineName = representativeDisciplineCode
    ? getDisciplineName(representativeDisciplineCode, targetLang)
    : '';
  const representativeHeaderOpacity = 1 - representativeHeaderCollapseProgress;
  const representativeHeaderHeight = Math.max(
    0,
    28 - representativeHeaderCollapseProgress * 28,
  );
  const representativeHeaderOffset = representativeHeaderCollapseProgress * 10;

  return (
    <div className={cn('flex h-full min-w-0 gap-3', className)}>
      <div className="w-52 shrink-0 overflow-hidden rounded-[24px] bg-[var(--color-bg-sidebar)] shadow-[var(--color-panel-shadow)]">
        <div className="flex h-full min-h-0 flex-col">
          <div className="shrink-0 space-y-3 p-3 shadow-[inset_0_-1px_0_rgba(0,0,0,0.04)]">
            <div className="relative">
              <Search
                size={14}
                className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)]"
              />
              <Input
                type="text"
                value={searchPrefix}
                onChange={(event) => setSearchPrefix(event.target.value)}
                placeholder={t('browsingHistory.searchPlaceholder')}
                className="h-10 pl-9"
              />
            </div>
            <Select
              value={selectedLang || '__all__'}
              onValueChange={(value) =>
                setSelectedLang(value === '__all__' ? '' : value)
              }
            >
              <SelectTrigger className="h-10">
                <SelectValue placeholder={t('main.history.allLanguages')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">
                  {t('main.history.allLanguages')}
                </SelectItem>
                {languages.map((lang) => (
                  <SelectItem key={lang} value={lang}>
                    {lang}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {activeDiscipline && (
              <div className="flex items-center gap-2 rounded-2xl bg-[rgba(255,255,255,0.62)] px-3 py-2 shadow-[inset_0_0_0_1px_rgba(0,0,0,0.04)]">
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] uppercase tracking-[0.14em] text-[var(--color-text-tertiary)]">
                    {t('main.history.filteredDiscipline')}
                  </p>
                  <p className="truncate text-xs text-[var(--color-text-primary)]">
                    {activeDisciplineName}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={handleClearDiscipline}
                  aria-label={t('main.history.clearDiscipline')}
                  className="h-8 w-8 shrink-0 rounded-full"
                >
                  <X size={14} />
                </Button>
              </div>
            )}
          </div>

          <div className="min-h-0 flex-1">
            <ScrollArea
              className="h-full [&_[data-radix-scroll-area-viewport]>div]:!block [&_[data-radix-scroll-area-viewport]>div]:!w-full"
              type="hover"
            >
              {isEntriesLoading ? (
                <div className="space-y-1 p-2">
                  {Array.from({ length: 20 }).map((_, index) => (
                    <Skeleton key={index} className="h-8 w-full rounded-md" />
                  ))}
                </div>
              ) : entries.length === 0 ? (
                <div className="p-6 text-center text-sm text-[var(--color-text-secondary)]">
                  {t('main.history.noEntriesFound')}
                </div>
              ) : (
                <div className="box-border flex min-w-0 w-full max-w-full flex-col gap-0.5 px-2.5 py-2">
                  {entries.map(([entry, markState]) => (
                    <div
                      key={entry}
                      className="relative w-full min-w-0 max-w-full overflow-hidden"
                    >
                      <button
                        type="button"
                        onClick={() => {
                          void openLookupEntry(entry);
                        }}
                        className={cn(
                          'grid w-full min-w-0 max-w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-2 overflow-hidden rounded-2xl px-3 py-2.5 text-left text-sm transition-colors',
                          'text-[var(--color-text-primary)] hover:bg-[rgba(0,0,0,0.03)]',
                        )}
                      >
                        <span className="block min-w-0 w-full overflow-hidden text-ellipsis whitespace-nowrap">
                          {entry}
                        </span>
                        {markState > 0 && (
                          <BookmarkCheck
                            size={14}
                            className="shrink-0 text-[var(--color-brand)]"
                          />
                        )}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </div>
        </div>
      </div>

      <div className="min-w-0 flex-1 overflow-hidden rounded-[28px] bg-[var(--color-bg-container)] shadow-[var(--color-panel-shadow)]">
        {chipsView ? (
          <div className="flex h-full flex-col">
            <div className="flex items-start gap-2 px-4 py-3 shadow-[inset_0_-1px_0_rgba(0,0,0,0.04)]">
              <Button
                variant="ghost"
                size="icon"
                onClick={handleBackToChart}
                aria-label={t('main.history.backToChart')}
                className="mt-0.5 rounded-full text-[var(--color-text-secondary)]"
              >
                <ArrowLeft size={16} />
              </Button>
              <div className="min-w-0 flex-1">
                <p className="text-[10px] uppercase tracking-[0.14em] text-[var(--color-text-tertiary)]">
                  {getDisciplineName(chipsView.disciplineCode, targetLang)}
                </p>
                <div
                  className="overflow-hidden transition-[max-height,opacity,transform,margin] duration-300 ease-out motion-reduce:transition-none"
                  style={{
                    marginTop: `${(1 - representativeHeaderCollapseProgress) * 0.25}rem`,
                    maxHeight: `${representativeHeaderHeight}rem`,
                    opacity: representativeHeaderOpacity,
                    transform: `translateY(${-representativeHeaderOffset}px)`,
                  }}
                >
                  <h3 className="font-editorial text-xl font-medium leading-6 text-[var(--color-text-primary)]">
                    {chipsView.message ||
                      getDisciplineName(chipsView.disciplineCode, targetLang)}
                  </h3>
                </div>
              </div>
              <span className="shrink-0 pt-0.5 text-xs text-[var(--color-text-tertiary)]">
                {chipsView.entries.length}
              </span>
            </div>
            <div className="flex-1 overflow-hidden">
              {chipsView.entries.length > 0 ? (
                <BouncingChips
                  entries={chipsView.entries}
                  baseColor={chipsView.color}
                  onScroll={handleRepresentativeEntriesScroll}
                  onChipClick={(entry) => {
                    void openLookupEntry(entry);
                  }}
                />
              ) : (
                <div className="flex h-full items-center justify-center p-6">
                  <p className="text-sm text-[var(--color-text-tertiary)]">
                    {t('lookup.noDisciplineEntries')}
                  </p>
                </div>
              )}
            </div>
          </div>
        ) : isChartLoading ? (
          <div className="flex h-full items-center justify-center">
            <div className="space-y-3 text-center">
              <Skeleton className="mx-auto h-48 w-48 rounded-full" />
              <p className="text-sm text-[var(--color-text-tertiary)]">
                {t('common.loadingContent')}
              </p>
            </div>
          </div>
        ) : chartData.length > 0 ? (
          <div className="relative flex h-full flex-col items-center justify-center p-6">
            {representativeLoadingCode && (
              <div className="absolute inset-x-0 top-0 z-10">
                <LinearProgress />
              </div>
            )}
            <div
              className={cn(
                'flex h-full w-full flex-col items-center justify-center transition-opacity duration-200',
                representativeLoadingCode && 'opacity-70',
              )}
            >
              <DisciplineDonutChart
                data={chartData}
                onArcClick={handleArcClick}
                idleLabel={t('main.history.flatEntries')}
                idleValue={totalFlatEntries.toLocaleString()}
                disabled={Boolean(representativeLoadingCode)}
                className="h-full max-h-[460px] w-full max-w-[460px]"
              />
              <p className="mt-3 text-xs text-[var(--color-text-tertiary)]">
                {representativeLoadingCode
                  ? t('main.history.loadingRepresentatives', {
                      discipline: representativeDisciplineName,
                    })
                  : t('main.history.clickToExplore')}
              </p>
            </div>
          </div>
        ) : (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-[var(--color-text-tertiary)]">
              {t('main.history.noEntriesFound')}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
