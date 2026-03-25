import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, ChevronsUpDown } from 'lucide-react';
import { TARGET_LANGUAGE_CODES } from '@/constants/languages';
import { cn } from '@/lib/utils';
import { Button } from '@/shared/components/ui/button';
import { Command, CommandEmpty, CommandGroup, CommandItem, CommandList } from '@/shared/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/components/ui/popover';

interface LanguageSelectProps {
  /** Currently selected language code */
  value: string;
  /** Callback when language changes */
  onValueChange: (value: string) => void;
  /** Available language codes (defaults to TARGET_LANGUAGE_CODES) */
  languages?: readonly string[];
  /** Placeholder text */
  placeholder?: string;
  /** Whether the select is disabled */
  disabled?: boolean;
  /** Additional class names */
  className?: string;
  /** Optional popover content class names */
  popoverContentClassName?: string;
  /** Optional command list class names */
  listClassName?: string;
  /** Optional popover content overrides */
  popoverContentProps?: Omit<React.ComponentProps<typeof PopoverContent>, 'className'>;
}

export function LanguageSelect({
  value,
  onValueChange,
  languages = TARGET_LANGUAGE_CODES,
  placeholder,
  disabled = false,
  className,
  popoverContentClassName,
  listClassName,
  popoverContentProps,
}: LanguageSelectProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  const getLanguageLabel = (code: string): string => {
    const key = `configures.targetLanguage.options.${code}`;
    const label = t(key);
    if (label && label !== key) return label;
    return code;
  };

  const selectedLabel = value ? getLanguageLabel(value) : '';
  const selectPlaceholder = placeholder || t('main.review.selectLanguagePlaceholder');

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          disabled={disabled}
          className={cn('w-[180px] justify-between font-normal', className)}
        >
          <span className="truncate">
            {selectedLabel || selectPlaceholder}
          </span>
          <ChevronsUpDown className="size-4 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className={cn('w-[var(--radix-popover-trigger-width)] p-0', popoverContentClassName)}
        {...popoverContentProps}
      >
        <Command>
          <CommandList className={listClassName}>
            <CommandEmpty>{t('main.history.noEntriesFound')}</CommandEmpty>
            <CommandGroup>
              {languages.map((code) => {
                const label = getLanguageLabel(code);
                return (
                  <CommandItem
                    key={code}
                    value={`${code} ${label}`}
                    onSelect={() => {
                      onValueChange(code);
                      setOpen(false);
                    }}
                  >
                    <Check
                      className={cn(
                        'mr-2 size-4',
                        value === code ? 'opacity-100' : 'opacity-0'
                      )}
                    />
                    <span className="truncate">{label}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
