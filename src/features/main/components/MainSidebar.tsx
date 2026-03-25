import { useTranslation } from 'react-i18next';
import { Settings, History, BookOpen, Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/components/ui/tooltip';

export type MainTabKey = 'configure' | 'lookupHistory' | 'review' | 'about';

interface NavItem {
  key: MainTabKey;
  labelKey: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
}

const NAV_ITEMS: NavItem[] = [
  { key: 'configure', labelKey: 'main.tabs.configure', icon: Settings },
  { key: 'lookupHistory', labelKey: 'main.tabs.lookupHistory', icon: History },
  { key: 'review', labelKey: 'main.tabs.review', icon: BookOpen },
  { key: 'about', labelKey: 'main.tabs.about', icon: Info },
];

interface MainSidebarProps {
  activeTab: MainTabKey;
  onTabChange: (tab: MainTabKey) => void;
  isMacOS?: boolean;
}

export function MainSidebar({ activeTab, onTabChange, isMacOS = false }: MainSidebarProps) {
  const { t } = useTranslation();

  return (
    <aside
      className="flex h-full w-[168px] shrink-0 flex-col overflow-hidden bg-[var(--color-bg-sidebar)] shadow-[inset_-1px_0_0_rgba(0,0,0,0.03)]"
    >
      <div
        data-tauri-drag-region
        className={cn(
          'drag-region shrink-0 px-4 pb-4',
          isMacOS ? 'pt-10' : 'pt-5',
        )}
      >
        <h1 className="font-editorial text-[1.6rem] font-semibold leading-none text-[var(--color-text-primary)]">
          {t('about.appName')}
        </h1>
      </div>

      <nav className="flex flex-col gap-1 px-2.5 pb-4">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.key;

          return (
            <Tooltip key={item.key} delayDuration={600}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => onTabChange(item.key)}
                  className={cn(
                    'no-drag-region relative flex min-w-0 items-center gap-2.5 rounded-2xl px-3 py-3 text-sm transition-[background-color,color,transform]',
                    isActive
                      ? 'bg-[rgba(217,138,108,0.08)] text-[var(--color-text-primary)] font-medium before:absolute before:left-0 before:top-3 before:bottom-3 before:w-px before:rounded-full before:bg-[rgba(217,138,108,0.8)]'
                      : 'text-[var(--color-text-secondary)] hover:bg-[rgba(0,0,0,0.035)] hover:text-[var(--color-text-primary)]'
                  )}
                >
                  <Icon size={16} className="shrink-0" />
                  <span className="min-w-0 flex-1 truncate text-left">{t(item.labelKey)}</span>
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" sideOffset={8}>
                {t(item.labelKey)}
              </TooltipContent>
            </Tooltip>
          );
        })}
      </nav>
    </aside>
  );
}
