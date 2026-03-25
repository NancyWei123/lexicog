import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { LanguageSelect } from '@/shared/components/form';
import { useNotification } from '@/shared/components/feedback';
import {
  resetTargetLangOfLexicalEntryLookup,
  resetTargetLangOfTranslation,
  readConfigFromStore,
} from '@/services/config';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/shared/components/ui/skeleton';

type LanguageSettingType = 'lookup' | 'translation';

interface LanguageSettingsRowProps {
  type: LanguageSettingType;
  className?: string;
}

const CONFIG_KEYS: Record<LanguageSettingType, string> = {
  lookup: 'targetLangOfLexicalEntryLookup',
  translation: 'targetLangOfTranslation',
};

const RESET_FUNCTIONS: Record<LanguageSettingType, (lang: string) => Promise<void>> = {
  lookup: resetTargetLangOfLexicalEntryLookup,
  translation: resetTargetLangOfTranslation,
};

export function LanguageSettingsRow({ type, className }: LanguageSettingsRowProps) {
  const { t } = useTranslation();
  const { notify } = useNotification();

  const [selectedLang, setSelectedLang] = useState<string>('en');
  const [isLoading, setIsLoading] = useState(true);

  // Load current selection
  useEffect(() => {
    async function loadConfig() {
      try {
        const value = await readConfigFromStore(CONFIG_KEYS[type]);
        if (value) {
          setSelectedLang(value);
        }
      } catch (error) {
        notify({
          type: 'error',
          message: t('error.genericMessage'),
          error,
        });
      } finally {
        setIsLoading(false);
      }
    }
    loadConfig();
  }, [type, notify, t]);

  const handleChange = useCallback(
    async (lang: string) => {
      const resetFn = RESET_FUNCTIONS[type];
      try {
        await resetFn(lang);
        setSelectedLang(lang);
      } catch (error) {
        notify({
          type: 'error',
          message: t('error.failedToUpdateLanguage'),
          error,
        });
      }
    },
    [type, notify, t]
  );

  const getHeadline = () => {
    switch (type) {
      case 'lookup':
        return t('configures.targetLanguage.lookup');
      case 'translation':
        return t('configures.targetLanguage.translation');
    }
  };

  return (
    <div className={cn('flex items-center justify-between gap-4 py-4', className)}>
      <span className="min-w-0 flex-1 truncate whitespace-nowrap text-sm font-medium text-[var(--color-text-primary)]">
        {getHeadline()}
      </span>
      {isLoading ? (
        <Skeleton className="h-10 w-[196px]" />
      ) : (
        <LanguageSelect
          value={selectedLang}
          onValueChange={handleChange}
          className="h-10 w-[196px] shrink-0"
        />
      )}
    </div>
  );
}
