import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/shared/components/ui/collapsible';
import { Button } from '@/shared/components/ui/button';
import { Textarea } from '@/shared/components/ui/textarea';

interface CollapsibleInputPanelProps {
  inputText: string;
  onInputChange: (text: string) => void;
  disabled?: boolean;
  className?: string;
}

export function CollapsibleInputPanel({
  inputText,
  onInputChange,
  disabled = false,
  className,
}: CollapsibleInputPanelProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  // Truncate for preview
  const previewText = inputText.length > 50
    ? inputText.slice(0, 50) + '...'
    : inputText;

  return (
    <div className={cn('border-b border-[var(--color-border)] bg-[var(--color-bg-surface-secondary)]', className)}>
      <Collapsible open={!disabled && open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            disabled={disabled}
            className="h-auto w-full justify-between rounded-none px-4 py-2 text-left text-xs text-[var(--color-text-secondary)]"
          >
            <span className="truncate">{previewText || t('translateText.sourceTextPlaceholder')}</span>
            <ChevronDown className={cn('size-4 transition-transform', open && 'rotate-180')} />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="px-4 pb-3">
          <Textarea
            value={inputText}
            onChange={(e) => onInputChange(e.target.value)}
            placeholder={t('translateText.sourceTextPlaceholder')}
            className="min-h-[120px] resize-y text-sm leading-relaxed bg-[var(--color-bg-base)] border-[var(--color-border)]"
          />
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
