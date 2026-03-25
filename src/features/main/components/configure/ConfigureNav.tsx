import { useTranslation } from 'react-i18next';
import { Globe, Key, Cpu, Languages, Keyboard } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ScrollArea } from '@/shared/components/ui/scroll-area';

export type ConfigureSectionKey =
  | 'uiLanguage'
  | 'vendorApi'
  | 'model'
  | 'targetLanguage'
  | 'shortcuts';

interface SectionItem {
  key: ConfigureSectionKey;
  labelKey: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
}

const SECTIONS: SectionItem[] = [
  { key: 'vendorApi', labelKey: 'configures.vendors.label', icon: Key },
  { key: 'model', labelKey: 'main.settings.model', icon: Cpu },
  { key: 'targetLanguage', labelKey: 'main.settings.targetLanguages', icon: Languages },
  { key: 'shortcuts', labelKey: 'configures.shortcuts.label', icon: Keyboard },
  { key: 'uiLanguage', labelKey: 'configures.uiLanguage.label', icon: Globe },
];

interface ConfigureNavProps {
  activeSection: ConfigureSectionKey;
  onSectionChange: (section: ConfigureSectionKey) => void;
}

export function ConfigureNav({ activeSection, onSectionChange }: ConfigureNavProps) {
  const { t } = useTranslation();

  return (
    <div className="flex h-full flex-col bg-[var(--color-bg-sidebar)]">
      <ScrollArea className="flex-1">
        <nav className="flex flex-col gap-1 px-3 py-4">
          {SECTIONS.map((item) => {
            const Icon = item.icon;
            const isActive = activeSection === item.key;

            return (
              <button
                key={item.key}
                type="button"
                onClick={() => onSectionChange(item.key)}
                title={t(item.labelKey)}
                className={cn(
                  'relative flex min-w-0 items-center gap-3 rounded-2xl px-3 py-3 text-left text-sm transition-[background-color,color]',
                  isActive
                    ? 'bg-[rgba(217,138,108,0.08)] text-[var(--color-text-primary)] font-medium before:absolute before:left-0 before:top-3 before:bottom-3 before:w-px before:rounded-full before:bg-[rgba(217,138,108,0.8)]'
                    : 'text-[var(--color-text-secondary)] hover:bg-[rgba(0,0,0,0.035)] hover:text-[var(--color-text-primary)]'
                )}
              >
                <Icon size={15} className="shrink-0" />
                <span className="min-w-0 flex-1 truncate text-left">{t(item.labelKey)}</span>
              </button>
            );
          })}
        </nav>
      </ScrollArea>
    </div>
  );
}
