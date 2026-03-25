import { useTranslation } from 'react-i18next';
import { useUILanguageStore, type SupportedLanguage } from '@/stores/ui-language';
import type { ConfigureSectionKey } from './ConfigureNav';
import { VendorConfigRow } from './VendorConfigRow';
import { ModelSelectRow } from '../ModelSelectRow';
import { LanguageSettingsRow } from '../LanguageSettingsRow';
import { HotkeyConfigRow } from '../HotkeyConfigRow';
import { DEFAULT_BASE_URLS } from '@/constants/default-base-url';
import { ScrollArea } from '@/shared/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/components/ui/select';
import { Separator } from '@/shared/components/ui/separator';

interface ConfigureContentProps {
  activeSection: ConfigureSectionKey;
}

export function ConfigureContent({ activeSection }: ConfigureContentProps) {
  return (
    <ScrollArea className="h-full">
      <div className="p-6">
        {activeSection === 'vendorApi' && <VendorApiSection />}
        {activeSection === 'model' && <ModelSection />}
        {activeSection === 'targetLanguage' && <TargetLanguageSection />}
        {activeSection === 'shortcuts' && <ShortcutsSection />}
        {activeSection === 'uiLanguage' && <UILanguageSection />}
      </div>
    </ScrollArea>
  );
}

function VendorApiSection() {
  const { t } = useTranslation();

  return (
    <div className="space-y-4">
      <h3 className="font-editorial text-xl font-semibold text-[var(--color-text-primary)]">
        {t('configures.vendors.label')}
      </h3>
      <div className="divide-y divide-[rgba(0,0,0,0.04)]">
        <VendorConfigRow vendor="OpenAI" defaultBaseUrl={DEFAULT_BASE_URLS.OpenAI} />
        <VendorConfigRow vendor="Anthropic" defaultBaseUrl={DEFAULT_BASE_URLS.Anthropic} />
        <VendorConfigRow vendor="GoogleGemini" defaultBaseUrl={DEFAULT_BASE_URLS.GoogleGemini} />
      </div>
    </div>
  );
}

function ModelSection() {
  const { t } = useTranslation();

  return (
    <div className="space-y-4">
      <h3 className="font-editorial text-xl font-semibold text-[var(--color-text-primary)]">
        {t('main.settings.model')}
      </h3>

      <div className="divide-y divide-[rgba(0,0,0,0.04)]">
        <ModelSelectRow type="ttt" className="py-4" />
        <ModelSelectRow type="tts" className="py-4" />
        <ModelSelectRow type="ocr" className="py-4" />
      </div>
    </div>
  );
}

function TargetLanguageSection() {
  const { t } = useTranslation();

  return (
    <div className="space-y-4">
      <h3 className="font-editorial text-xl font-semibold text-[var(--color-text-primary)]">
        {t('main.settings.targetLanguages')}
      </h3>

      <div className="divide-y divide-[rgba(0,0,0,0.04)]">
        <LanguageSettingsRow type="lookup" className="py-4" />
        <Separator className="hidden" />
        <LanguageSettingsRow type="translation" className="py-4" />
      </div>
    </div>
  );
}

function ShortcutsSection() {
  const { t } = useTranslation();

  return (
    <div className="space-y-4">
      <h3 className="font-editorial text-xl font-semibold text-[var(--color-text-primary)]">
        {t('configures.shortcuts.label')}
      </h3>

      <div className="divide-y divide-[rgba(0,0,0,0.04)]">
        <HotkeyConfigRow functionName="lookupLexicalEntry" className="py-4" />
        <HotkeyConfigRow functionName="translateText" className="py-4" />
        <HotkeyConfigRow functionName="ocr" className="py-4" />
      </div>
    </div>
  );
}

function UILanguageSection() {
  const { t, i18n } = useTranslation();
  const { language, setLanguage } = useUILanguageStore();

  const handleChange = (value: string) => {
    const lang = value as SupportedLanguage;
    setLanguage(lang);
    i18n.changeLanguage(lang);
  };

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h3 className="font-editorial text-xl font-semibold text-[var(--color-text-primary)]">
          {t('configures.uiLanguage.label')}
        </h3>
      </div>

      <div className="max-w-xs">
        <Select value={language || i18n.language} onValueChange={handleChange}>
          <SelectTrigger className="h-10">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="en">{t('configures.uiLanguage.options.en')}</SelectItem>
            <SelectItem value="zh-CN">{t('configures.uiLanguage.options.zh-CN')}</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
