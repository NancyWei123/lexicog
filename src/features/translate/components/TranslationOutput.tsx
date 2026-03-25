import { useTranslation } from 'react-i18next';
import { StreamingText } from '@/shared/components/typography/StreamingText';
import { ReadableContainer } from '@/layout/ReadableContainer';
import { cn } from '@/lib/utils';
import {
  Card,
  CardContent,
} from '@/shared/components/ui/card';
import { Skeleton } from '@/shared/components/ui/skeleton';
import { Badge } from '@/shared/components/ui/badge';
import { Separator } from '@/shared/components/ui/separator';
import type { TextAnalysisReport, ErrorDetail } from '@/types/text-analysis';

interface TranslationOutputProps {
  content: string;
  report: TextAnalysisReport | null;
  isStreaming: boolean;
  className?: string;
}

type ErrorCategory = {
  key: string;
  i18nKey: string;
  items: ErrorDetail[];
  colorClass: string;
};

function ErrorSection({ category }: { category: ErrorCategory }) {
  const { t } = useTranslation();

  if (category.items.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-medium text-[var(--color-text-primary)]">
          {t(category.i18nKey)}
        </h3>
        <Badge variant="outline" className={cn('text-[11px] leading-4 px-1.5 py-0', category.colorClass)}>
          {category.items.length}
        </Badge>
      </div>
      <div className="space-y-2">
        {category.items.map((item, index) => (
          <div
            key={`${category.key}-${index}`}
            className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg-base)] p-3 space-y-1.5"
          >
            <div className="flex items-start gap-2">
              <span className="shrink-0 mt-0.5 text-xs font-medium text-[var(--color-text-secondary)] bg-[var(--color-bg-surface-tertiary)] rounded px-1.5 py-0.5">
                {t('analysis.original')}
              </span>
              <span className="text-sm text-[var(--color-text-primary)] select-text line-through decoration-[var(--color-error)]/40">
                {item.originalText}
              </span>
            </div>
            <div className="flex items-start gap-2">
              <span className="shrink-0 mt-0.5 text-xs font-medium text-[var(--color-text-secondary)] bg-[var(--color-bg-surface-tertiary)] rounded px-1.5 py-0.5">
                {t('analysis.correction')}
              </span>
              <span className="text-sm text-[var(--color-brand)] select-text font-medium">
                {item.suggestedCorrection}
              </span>
            </div>
            <p className="text-xs text-[var(--color-text-secondary)] leading-relaxed pl-0.5 select-text">
              {item.explanation}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

export function TranslationOutput({
  content,
  report,
  isStreaming,
  className,
}: TranslationOutputProps) {
  const { t } = useTranslation();

  if (!content && isStreaming) {
    return (
      <ReadableContainer className={cn('py-4', className)}>
        <Card className="border-[var(--color-border)] bg-[var(--color-bg-container)]">
          <CardContent className="space-y-2.5 p-5">
            {Array.from({ length: 16 }).map((_, index) => (
              <Skeleton
                // eslint-disable-next-line react/no-array-index-key
                key={index}
                className={cn('h-4', index === 15 ? 'w-2/3' : 'w-full')}
              />
            ))}
          </CardContent>
        </Card>
      </ReadableContainer>
    );
  }

  if (!content) {
    return null;
  }

  const categories: ErrorCategory[] = report
    ? [
        {
          key: 'orthographic',
          i18nKey: 'analysis.categories.orthographic',
          items: report.orthographicErrors ?? [],
          colorClass: 'border-red-300 text-red-600',
        },
        {
          key: 'lexical',
          i18nKey: 'analysis.categories.lexical',
          items: report.lexicalErrors ?? [],
          colorClass: 'border-orange-300 text-orange-600',
        },
        {
          key: 'grammatical',
          i18nKey: 'analysis.categories.grammatical',
          items: report.grammaticalErrors ?? [],
          colorClass: 'border-amber-300 text-amber-600',
        },
        {
          key: 'semantic',
          i18nKey: 'analysis.categories.semantic',
          items: report.semanticErrors ?? [],
          colorClass: 'border-blue-300 text-blue-600',
        },
        {
          key: 'pragmatic',
          i18nKey: 'analysis.categories.pragmatic',
          items: report.pragmaticErrors ?? [],
          colorClass: 'border-purple-300 text-purple-600',
        },
      ]
    : [];

  const totalErrors = categories.reduce((sum, cat) => sum + cat.items.length, 0);
  const nonEmptyCategories = categories.filter((cat) => cat.items.length > 0);

  return (
    <ReadableContainer className={cn('py-4', className)}>
      <div className="space-y-3">
        {/* Translation card */}
        <Card className="border-[var(--color-border)] bg-[var(--color-bg-container)]">
          <CardContent className="p-5">
            <StreamingText
              content={content}
              isStreaming={isStreaming}
              variant="large"
              className="select-text whitespace-pre-wrap text-[16px] leading-[1.65]"
            />
          </CardContent>
        </Card>

        {/* Text analysis report — corrected text + errors */}
        {report && totalErrors > 0 && (
          <>
            {/* Corrected text section */}
            <Card className="border-[var(--color-border)] bg-[var(--color-bg-container)]">
              <CardContent className="p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-medium text-[var(--color-text-primary)]">
                    {t('analysis.correctedText')}
                  </h3>
                  <Badge variant="outline" className="text-[11px] leading-4 px-1.5 py-0">
                    {t('analysis.errorCount', { count: totalErrors })}
                  </Badge>
                </div>
                <p className="text-base leading-[1.65] text-[var(--color-text-primary)] select-text whitespace-pre-wrap">
                  {report.correctedText}
                </p>
              </CardContent>
            </Card>

            {/* Error details */}
            {nonEmptyCategories.length > 0 && (
              <Card className="border-[var(--color-border)] bg-[var(--color-bg-container)]">
                <CardContent className="p-4 space-y-3">
                  {nonEmptyCategories.map((category, index) => (
                    <div key={category.key}>
                      {index > 0 && <Separator className="mb-3" />}
                      <ErrorSection category={category} />
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>
    </ReadableContainer>
  );
}
