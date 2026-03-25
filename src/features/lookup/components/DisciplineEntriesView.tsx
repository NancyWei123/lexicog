import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Channel } from '@tauri-apps/api/core';
import { ArrowLeft, Star } from 'lucide-react';
import { VKGDT_DISCIPLINE_NAME_I18N } from '@/constants/vkgdt-discipline-name';
import type { VKGDTDisciplineCode } from '@/types/discipline';
import type { TargetLanguageCode } from '@/constants/languages';
import {
  getLookupHistory,
  serveRepresentativeEntriesByDiscipline,
} from '@/services/serve';
import { Button } from '@/shared/components/ui/button';
import { Skeleton } from '@/shared/components/ui/skeleton';
import { ScrollArea } from '@/shared/components/ui/scroll-area';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/components/ui/tooltip';
import type { OnNotify } from '@/types/notification';

interface DisplayEntry {
  lemma: string;
  cached: boolean;
  representative: boolean;
}

interface DisciplineEntriesViewProps {
  disciplineCode: string;
  sourceLang: string;
  targetLanguage: string;
  onBack?: () => void;
  onEntryClick: (entry: string) => void;
  onNotify: OnNotify;
}

export function DisciplineEntriesView({
  disciplineCode,
  sourceLang,
  targetLanguage,
  onBack,
  onEntryClick,
  onNotify,
}: DisciplineEntriesViewProps) {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<DisplayEntry[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const disciplineName =
    VKGDT_DISCIPLINE_NAME_I18N[disciplineCode as VKGDTDisciplineCode]?.[
      targetLanguage as TargetLanguageCode
    ] ?? disciplineCode;

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);

    const channel = new Channel<string | null>();
    channel.onmessage = () => {};
    const representativePromise = serveRepresentativeEntriesByDiscipline(
      channel,
      sourceLang,
      disciplineCode,
    );

    Promise.all([
      representativePromise,
      getLookupHistory('%', sourceLang, disciplineCode),
    ])
      .then(([representativeResponse, cachedEntries]) => {
        if (cancelled) return;
        const repLemmas = representativeResponse.lexicalEntries;
        const repSet = new Set(repLemmas);
        const seen = new Set<string>();
        const merged: DisplayEntry[] = [];

        for (const [name] of cachedEntries) {
          seen.add(name);
          merged.push({
            lemma: name,
            cached: true,
            representative: repSet.has(name),
          });
        }

        for (const lemma of repLemmas) {
          if (!seen.has(lemma)) {
            merged.push({ lemma, cached: false, representative: true });
          }
        }

        merged.sort((a, b) => a.lemma.localeCompare(b.lemma));
        setEntries(merged);
        setIsLoading(false);
      })
      .catch((error) => {
        if (!cancelled) {
          setIsLoading(false);
          onNotify({ type: 'error', message: t('error.genericMessage'), error });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [disciplineCode, sourceLang, onNotify, t]);

  const handleEntryClick = useCallback(
    (entry: string) => {
      onEntryClick(entry);
    },
    [onEntryClick],
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-[var(--color-border)] px-3 py-2">
        {onBack && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={onBack}
                aria-label={t('lookup.goBack')}
                className="text-[var(--color-text-secondary)]"
              >
                <ArrowLeft size={16} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('lookup.goBack')}</TooltipContent>
          </Tooltip>
        )}
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-medium text-[var(--color-text-primary)]">
            {disciplineName}
          </h3>
        </div>
        {entries && !isLoading && (
          <span className="shrink-0 text-xs text-[var(--color-text-tertiary)]">
            {entries.length}
          </span>
        )}
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="flex-1 space-y-2 p-3">
          {Array.from({ length: 20 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      ) : entries && entries.length > 0 ? (
        <ScrollArea className="flex-1 overflow-hidden">
          <div className="divide-y divide-[var(--color-border)]">
            {entries.map(({ lemma, cached, representative }) => (
              <button
                key={lemma}
                type="button"
                className={`flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-[var(--color-bg-surface-secondary)] ${
                  !cached ? 'opacity-40' : ''
                }`}
                onClick={() => handleEntryClick(lemma)}
              >
                {representative ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Star
                        size={10}
                        className="shrink-0 fill-[var(--color-brand)] text-[var(--color-brand)]"
                      />
                    </TooltipTrigger>
                    <TooltipContent side="right">{t('lookup.representativeEntry')}</TooltipContent>
                  </Tooltip>
                ) : (
                  <span className="inline-block w-[10px] shrink-0" />
                )}
                <span className="min-w-0 flex-1 truncate text-sm text-[var(--color-text-primary)]">
                  {lemma}
                </span>
              </button>
            ))}
          </div>
        </ScrollArea>
      ) : (
        <div className="flex flex-1 items-center justify-center p-6">
          <p className="text-sm text-[var(--color-text-secondary)]">
            {t('lookup.noDisciplineEntries')}
          </p>
        </div>
      )}
    </div>
  );
}
