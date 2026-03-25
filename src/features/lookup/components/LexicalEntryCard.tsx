import { useEffect, useLayoutEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Channel } from '@tauri-apps/api/core';
import { emit } from '@tauri-apps/api/event';
import { Bookmark, BookmarkCheck, Copy, Check, RotateCcw, Volume2, Loader2, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { markLexicalEntry, serveTextToSpeech, mimicTriggerLookupLexicalEntry, removeLexicalEntry } from '@/services/serve';
import { replaceClipboard } from '@/services/util';
import { setSharedSelectedText } from '@/stores/selection';
import {
  parseLexicalEntryResponse,
  type LexicalEntryResponse,
  type FlatEntry,
} from '@/types/lexical-entry';
import { tryParseJsonWithRepair } from '@/lib/repair-json';
import type { OnNotify } from '@/types/notification';
import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';
import { Card, CardContent } from '@/shared/components/ui/card';
import { Skeleton } from '@/shared/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/components/ui/tooltip';

interface PosGroup {
  pos: string;
  formsList: string[];
  entries: FlatEntry[];
}

function groupEntriesByPos(entries: FlatEntry[]): PosGroup[] {
  const groups: PosGroup[] = [];
  const posMap = new Map<string, PosGroup>();
  for (const entry of entries) {
    const pos = entry.pos ?? '';
    let group = posMap.get(pos);
    if (!group) {
      group = {
        pos,
        formsList: entry.formsList ?? [],
        entries: [],
      };
      posMap.set(pos, group);
      groups.push(group);
    }
    group.entries.push(entry);
  }
  return groups;
}

interface LexicalEntryCardProps {
  channel?: Channel<string | null>;
  cachedEntry?: LexicalEntryResponse;
  actionsVisible?: boolean;
  loadFailed?: boolean;
  initialMarked: boolean;
  onMarkChange: (marked: boolean) => void;
  onNotify: OnNotify;
  onRefresh?: () => void;
  onRemove?: () => void;
  onEntryLoaded?: (entry: LexicalEntryResponse) => void;
  lexicalEntry?: string;
  onDelete?: () => void;
  className?: string;
}

export function LexicalEntryCard({
  channel,
  cachedEntry,
  actionsVisible = true,
  loadFailed = false,
  initialMarked,
  onMarkChange,
  onNotify,
  onRefresh,
  onRemove,
  onEntryLoaded,
  lexicalEntry,
  onDelete,
  className,
}: LexicalEntryCardProps) {
  const { t } = useTranslation();
  const [entry, setEntry] = useState<LexicalEntryResponse | null>(cachedEntry ?? null);
  const [isMarked, setIsMarked] = useState(initialMarked);
  const [isStreaming, setIsStreaming] = useState(!cachedEntry);
  const [copied, setCopied] = useState(false);
  const [isTtsLoading, setIsTtsLoading] = useState(false);

  useEffect(() => {
    setIsMarked(initialMarked);
  }, [initialMarked]);

  const onEntryLoadedRef = useRef(onEntryLoaded);
  onEntryLoadedRef.current = onEntryLoaded;
  const onNotifyRef = useRef(onNotify);
  onNotifyRef.current = onNotify;
  const onRemoveRef = useRef(onRemove);
  onRemoveRef.current = onRemove;
  const tRef = useRef(t);
  tRef.current = t;
  const invalidCleanupTriggeredRef = useRef(false);

  const triggerInvalidEntryCleanup = useCallback(() => {
    const remove = onRemoveRef.current;
    if (!remove || invalidCleanupTriggeredRef.current) return;
    invalidCleanupTriggeredRef.current = true;
    void remove();
  }, []);

  useEffect(() => {
    invalidCleanupTriggeredRef.current = false;
  }, [channel, cachedEntry, lexicalEntry]);

  // Register the stream handler during commit so fast cached responses are not missed.
  useLayoutEffect(() => {
    if (!channel) return;

    let jsonBuffer = '';
    setIsStreaming(true);
    setEntry(null);

    const handleMessage = (message: string | null) => {
      if (message === null) {
        setIsStreaming(false);
        const parsed = parseLexicalEntryResponse(jsonBuffer);
        if (parsed) {
          setEntry(parsed);
          onEntryLoadedRef.current?.(parsed);
        } else if (jsonBuffer.trim()) {
          onNotifyRef.current({
            type: 'error',
            message: tRef.current('error.failedToParseResponse'),
          });
          triggerInvalidEntryCleanup();
        }
      } else {
        jsonBuffer += message;
        const parsed = tryParseJsonWithRepair<LexicalEntryResponse>(jsonBuffer);
        if (parsed && Array.isArray(parsed.entries)) {
          setEntry(parsed);
        }
      }
    };

    channel.onmessage = handleMessage;

    return () => {
      channel.onmessage = () => {};
    };
  }, [channel, triggerInvalidEntryCleanup]);

  const posGroups = useMemo(
    () => (entry ? groupEntriesByPos(entry.entries) : []),
    [entry],
  );

  useEffect(() => {
    if (!entry || isStreaming || posGroups.length > 0) return;
    triggerInvalidEntryCleanup();
  }, [entry, isStreaming, posGroups.length, triggerInvalidEntryCleanup]);

  const handleMark = useCallback(async () => {
    if (!entry) return;
    const key = lexicalEntry ?? entry.normalizedFormat;
    if (!key) return;
    try {
      await markLexicalEntry(key);
      const newMarked = !isMarked;
      setIsMarked(newMarked);
      onMarkChange(newMarked);
      await emit('lexical-entry-history-changed');
    } catch (error) {
      onNotify({
        type: 'error',
        message: t('error.genericMessage'),
        error,
      });
    }
  }, [entry, lexicalEntry, isMarked, onMarkChange, onNotify, t]);

  const handlePlayAudio = useCallback(async () => {
    if (!entry?.normalizedFormat || isTtsLoading) return;
    setIsTtsLoading(true);
    try {
      const audioData = await serveTextToSpeech(entry.normalizedFormat, true);
      const audioContext = new AudioContext();
      const arrayBuffer = new Uint8Array(audioData).slice().buffer;
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
      const source = audioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(audioContext.destination);
      source.onended = () => audioContext.close();
      source.start();
    } catch (error) {
      onNotify({
        type: 'error',
        message: t('error.genericMessage'),
        error,
      });
    } finally {
      setIsTtsLoading(false);
    }
  }, [entry, isTtsLoading, onNotify, t]);

  const handleCopy = useCallback(async () => {
    if (!entry) return;
    try {
      const lines: string[] = [];
      lines.push(`# ${entry.normalizedFormat}`);
      const phonetic = entry.phoneticIpa
        ? `/${entry.phoneticIpa}/`
        : entry.phoneticRomanization || '';
      if (phonetic) lines.push(phonetic);

      for (const group of posGroups) {
        lines.push('');
        let posHeader = `## ${group.pos}`;
        if (group.formsList.length > 0) {
          posHeader += ` (${group.formsList.join(', ')})`;
        }
        lines.push(posHeader);

        group.entries.forEach((e, idx) => {
          lines.push('');
          if (e.definitionSource) lines.push(`${idx + 1}. ${e.definitionSource}`);
          if (e.definitionTranslation) lines.push(`   ${e.definitionTranslation}`);

          if (e.examples.length > 0) {
            for (const ex of e.examples) {
              lines.push(`   - "${ex.source}"`);
              if (ex.translation) lines.push(`     "${ex.translation}"`);
            }
          }
          if (e.synonyms.length > 0) {
            lines.push(`   Synonyms: ${e.synonyms.join(', ')}`);
          }
        });
      }

      await replaceClipboard(lines.join('\n'));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      onNotify({
        type: 'error',
        message: t('error.genericMessage'),
        error,
      });
    }
  }, [entry, posGroups, onNotify, t]);

  const handleDelete = useCallback(async () => {
    const key = lexicalEntry ?? entry?.normalizedFormat;
    if (!key) return;
    try {
      await removeLexicalEntry(key);
      await emit('lexical-entry-history-changed');
      onDelete?.();
    } catch (error) {
      onNotify({
        type: 'error',
        message: t('error.genericMessage'),
        error,
      });
    }
  }, [entry, lexicalEntry, onDelete, onNotify, t]);

  const canPlayAudio = Boolean(entry?.normalizedFormat) && !isTtsLoading;
  const canCopy = Boolean(entry);
  const canMark = Boolean(entry && (lexicalEntry ?? entry.normalizedFormat));
  const canDelete = Boolean(onDelete && (lexicalEntry ?? entry?.normalizedFormat));

  const renderFunctionButtonsBar = () => {
    if (!actionsVisible) return null;

    return (
      <div className="flex shrink-0 items-center gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={t('common.playAudio')}
              onClick={handlePlayAudio}
              disabled={!canPlayAudio}
            >
              {isTtsLoading ? <Loader2 size={16} className="animate-spin" /> : <Volume2 size={16} />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t('common.playAudio')}</TooltipContent>
        </Tooltip>
        {onRefresh && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={t('lexicalEntry.refresh')}
                onClick={onRefresh}
              >
                <RotateCcw size={16} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('lexicalEntry.refresh')}</TooltipContent>
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
              disabled={!canCopy}
            >
              {copied ? <Check size={16} /> : <Copy size={16} />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t('common.copyToClipboard')}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={isMarked ? t('lexicalEntry.unmark') : t('lexicalEntry.mark')}
              onClick={handleMark}
              disabled={!canMark}
            >
              {isMarked ? <BookmarkCheck size={16} color="var(--color-brand)" /> : <Bookmark size={16} />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{isMarked ? t('lexicalEntry.unmark') : t('lexicalEntry.mark')}</TooltipContent>
        </Tooltip>
        {onDelete && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={t('common.delete')}
                onClick={handleDelete}
                disabled={!canDelete}
              >
                <Trash2 size={16} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('common.delete')}</TooltipContent>
          </Tooltip>
        )}
      </div>
    );
  };

  if (isStreaming && !entry) {
    return (
      <div className={cn('px-3 py-2.5', className)}>
        {actionsVisible && (
          <div className="mb-2 flex justify-end">{renderFunctionButtonsBar()}</div>
        )}
        <Card className="border-[var(--color-border)] bg-[var(--color-bg-container)]">
          <CardContent className="space-y-2.5 p-4">
            {Array.from({ length: 16 }).map((_, index) => (
              <Skeleton
                // eslint-disable-next-line react/no-array-index-key
                key={index}
                className={cn('h-4', index === 15 ? 'w-2/3' : 'w-full')}
              />
            ))}
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!entry) {
    if (!actionsVisible) return null;

    return (
      <div className={cn('p-6', className)}>
        <div className="mb-2 flex justify-end">{renderFunctionButtonsBar()}</div>
        <p className="text-center text-sm text-[var(--color-text-secondary)]">
          {loadFailed ? t('error.lookupFailed') : t('error.failedToParseResponse')}
        </p>
      </div>
    );
  }

  // Treat definition-less payloads as invalid instead of rendering a blank card.
  if (posGroups.length === 0 && !isStreaming) {
    return (
      <div className={cn('p-6', className)}>
        {actionsVisible && (
          <div className="mb-2 flex justify-end">{renderFunctionButtonsBar()}</div>
        )}
        <p className="text-center text-sm text-[var(--color-text-secondary)]">
          {t('error.failedToParseResponse')}
        </p>
      </div>
    );
  }

  const phonetic = entry.phoneticIpa
    ? `/${entry.phoneticIpa}/`
    : entry.phoneticRomanization || '';

  return (
    <div className={cn('space-y-3', className)}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="break-words text-lg font-semibold tracking-tight text-[var(--color-text-primary)]">
            {entry.normalizedFormat || lexicalEntry}
          </h3>
          {phonetic && (
            <span className="mt-0.5 block text-xs text-[var(--color-text-secondary)]">
              {phonetic}
            </span>
          )}
        </div>
        {renderFunctionButtonsBar()}
      </div>

      <div className="space-y-3">
        {posGroups.map((group) => (
          <PosGroupSection
            key={group.pos}
            group={group}
          />
        ))}
      </div>
    </div>
  );
}

function PosGroupSection({
  group,
}: {
  group: PosGroup;
}) {
  return (
    <Card className="border-[var(--color-border)] bg-[var(--color-bg-container)]">
      <CardContent className="space-y-2.5 p-3">
        <div className="flex items-center gap-2">
          <Badge className="whitespace-nowrap rounded-md border-[var(--color-brand)] bg-[var(--color-brand-bg)] text-xs font-semibold uppercase tracking-wide text-[var(--color-brand)]">
            {group.pos}
          </Badge>
          {group.formsList.length > 0 && (
            <span className="text-xs text-[var(--color-text-secondary)]">({group.formsList.join(', ')})</span>
          )}
        </div>

        <div className="space-y-3">
          {group.entries.map((entry, entryIdx) => (
            <DefinitionEntry
              key={entryIdx}
              entry={entry}
              index={entryIdx + 1}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function DefinitionEntry({
  entry,
  index,
}: {
  entry: FlatEntry;
  index: number;
}) {
  const { t } = useTranslation();

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <span className="shrink-0 text-sm text-[var(--color-text-secondary)]">{index}.</span>
        <div className="min-w-0 flex-1">
          {entry.definitionSource && (
            <span className="block text-sm text-[var(--color-text-primary)]">
              {entry.definitionSource}
            </span>
          )}
          {entry.definitionTranslation && (
            <span className="mt-0.5 block text-sm text-[var(--color-text-secondary)]">
              {entry.definitionTranslation}
            </span>
          )}
        </div>
      </div>

      {(entry.examples ?? []).filter((ex) => ex.source).length > 0 && (
        <div className="ml-5 space-y-1.5">
          {(entry.examples ?? []).map((example, exIdx) =>
            example.source ? (
              <div key={exIdx} className="text-sm italic text-[var(--color-text-secondary)]">
                <span className="block">&ldquo;{example.source}&rdquo;</span>
                {example.translation && (
                  <span className="block text-xs">&ldquo;{example.translation}&rdquo;</span>
                )}
              </div>
            ) : null,
          )}
        </div>
      )}

      {(entry.synonyms ?? []).length > 0 && (
        <div className="ml-5 flex flex-wrap items-center gap-1">
          <span className="text-xs text-[var(--color-text-secondary)]">
            {t('lexicalEntry.partOfSpeech.entries.synonyms')}:
          </span>
          {entry.synonyms.map((synonym, sIdx) => (
            <button
              key={sIdx}
              type="button"
              onClick={() => {
                setSharedSelectedText(synonym);
                mimicTriggerLookupLexicalEntry();
              }}
              className="rounded-md border border-[var(--color-brand)] bg-[var(--color-brand-bg)] px-1.5 py-0.5 text-xs font-medium text-[var(--color-brand)] transition-colors hover:bg-[var(--color-brand)] hover:text-white"
            >
              {synonym}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
