import { useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, Check } from 'lucide-react';
import { useNotification } from '@/shared/components/feedback';
import { resetTttModel, resetTtsModel, resetOcrModel } from '@/services/config';
import { readConfigFromStore } from '@/services/config';
import { getVendorApi } from '@/services/vendor';
import { LLM_MODELS } from '@/constants/llm-models';
import type { Vendor } from '@/types/config';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/shared/components/ui/skeleton';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/shared/components/ui/collapsible';

type ModelType = 'ttt' | 'tts' | 'ocr';

interface ModelSelectRowProps {
  type: ModelType;
  className?: string;
}

const CONFIG_KEYS: Record<ModelType, string> = {
  ttt: 'textToTextModel',
  tts: 'textToSpeechModel',
  ocr: 'ocrModel',
};

const RESET_FUNCTIONS: Record<ModelType, (modelId: string) => Promise<void>> = {
  ttt: resetTttModel,
  tts: resetTtsModel,
  ocr: resetOcrModel,
};

export function ModelSelectRow({ type, className }: ModelSelectRowProps) {
  const { t } = useTranslation();
  const { notify } = useNotification();

  const [selectedModel, setSelectedModel] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);
  const [isOpen, setIsOpen] = useState(false);
  const [activeVendors, setActiveVendors] = useState<Set<Vendor>>(new Set());

  // Collect unique vendors from all models
  const allVendors = useMemo(() => {
    const vendors = new Set<Vendor>();
    for (const model of Object.values(LLM_MODELS)) {
      vendors.add(model.vendor);
    }
    return vendors;
  }, []);

  // Filter models by capability AND vendor availability
  const availableModels = useMemo(() => {
    return Object.values(LLM_MODELS).filter((model) => {
      if (!activeVendors.has(model.vendor)) return false;
      switch (type) {
        case 'ttt':
          return model.supportTextToText;
        case 'tts':
          return model.supportTextToSpeech;
        case 'ocr':
          return model.supportImageToText;
        default:
          return false;
      }
    });
  }, [type, activeVendors]);

  // Load vendor availability and current selection
  useEffect(() => {
    async function loadConfig() {
      try {
        // Check which vendors have active API keys
        const vendorChecks = await Promise.all(
          Array.from(allVendors).map(async (vendor) => {
            const result = await getVendorApi(vendor);
            return { vendor, active: !!(result && result[0]) };
          })
        );
        const active = new Set<Vendor>(
          vendorChecks.filter((v) => v.active).map((v) => v.vendor)
        );
        setActiveVendors(active);

        // Load current model selection
        const value = await readConfigFromStore(CONFIG_KEYS[type]);
        if (value) {
          setSelectedModel(value);
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
  }, [type, allVendors, notify, t]);

  const handleChange = useCallback(
    async (modelId: string) => {
      const resetFn = RESET_FUNCTIONS[type];
      try {
        await resetFn(modelId);
        setSelectedModel(modelId);
        setIsOpen(false);
        notify({
          type: 'info',
          message: t('error.modelUpdated'),
        });
      } catch (error) {
        notify({
          type: 'error',
          message: t('error.failedToUpdateModel'),
          error,
        });
      }
    },
    [type, notify, t]
  );

  const getHeadline = () => {
    switch (type) {
      case 'ttt':
        return t('configures.models.textGeneration');
      case 'tts':
        return t('configures.models.textToSpeech');
      case 'ocr':
        return t('configures.models.ocr');
    }
  };

  const currentModel = LLM_MODELS[selectedModel];
  const hasActiveVendors = activeVendors.size > 0;

  // Determine trigger display text
  const triggerLabel = currentModel
    ? currentModel.displayName
    : hasActiveVendors
      ? t('common.select')
      : t('configures.models.noVendorConfigured');

  return (
    <div className={cn('py-4', className)}>
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <div className="flex items-center justify-between gap-4">
          <span className="min-w-0 flex-1 truncate whitespace-nowrap text-sm font-medium text-[var(--color-text-primary)]">
            {getHeadline()}
          </span>
          {isLoading ? (
            <Skeleton className="h-10 w-[196px]" />
          ) : (
            <CollapsibleTrigger asChild>
              <button
                type="button"
                disabled={!hasActiveVendors}
                className={cn(
                  'flex h-10 w-[196px] shrink-0 items-center justify-between gap-2 rounded-xl border border-transparent bg-[var(--color-field-bg)] px-3.5 text-sm shadow-[inset_0_0_0_1px_rgba(0,0,0,0.02)] transition-[background-color,box-shadow,color]',
                  hasActiveVendors
                    ? 'text-[var(--color-text-primary)] hover:bg-[var(--color-field-hover)] hover:shadow-[inset_0_0_0_1px_rgba(0,0,0,0.05)]'
                    : 'cursor-not-allowed text-[var(--color-text-tertiary)] opacity-60'
                )}
              >
                <span className="min-w-0 truncate">
                  {triggerLabel}
                </span>
                {hasActiveVendors && (
                  <ChevronDown className={cn('size-4 shrink-0 opacity-60 transition-transform', isOpen && 'rotate-180')} />
                )}
              </button>
            </CollapsibleTrigger>
          )}
        </div>

        {/* Model detail info in 4-row grid */}
        {currentModel && (
          <div className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs">
            <span className="text-[var(--color-text-tertiary)]">{t('configures.models.attribute.id')}</span>
            <span className="text-[var(--color-text-secondary)]">{currentModel.id}</span>
            <span className="text-[var(--color-text-tertiary)]">{t('configures.models.attribute.inputContextWindow')}</span>
            <span className="text-[var(--color-text-secondary)]">{currentModel.inputContextWindow}</span>
            <span className="text-[var(--color-text-tertiary)]">{t('configures.models.attribute.outputContextWindow')}</span>
            <span className="text-[var(--color-text-secondary)]">{currentModel.outputContextWindow}</span>
            <span className="text-[var(--color-text-tertiary)]">{t('configures.models.attribute.inputPricePer1MTokens')}</span>
            <span className="text-[var(--color-text-secondary)]">${currentModel.inputPricePer1mToken.toFixed(2)}</span>
            <span className="text-[var(--color-text-tertiary)]">{t('configures.models.attribute.outputPricePer1MTokens')}</span>
            <span className="text-[var(--color-text-secondary)]">${currentModel.outputPricePer1mToken.toFixed(2)}</span>
          </div>
        )}

        <CollapsibleContent>
          <div className="mt-3 overflow-hidden rounded-2xl bg-[var(--color-bg-surface-secondary)] shadow-[inset_0_0_0_1px_rgba(0,0,0,0.03)]">
            {availableModels.length === 0 ? (
              <div className="px-3 py-3 text-xs text-[var(--color-text-tertiary)]">
                {t('configures.models.noModelsAvailable')}
              </div>
            ) : (
              availableModels.map((model) => (
                <button
                  key={model.id}
                  type="button"
                  onClick={() => handleChange(model.id)}
                  className={cn(
                    'flex w-full items-center gap-2 px-3.5 py-2.5 text-left text-sm transition-colors',
                    selectedModel === model.id
                      ? 'bg-[rgba(217,138,108,0.08)] text-[var(--color-text-primary)]'
                      : 'text-[var(--color-text-secondary)] hover:bg-[rgba(255,255,255,0.55)]'
                  )}
                >
                  <span className="min-w-0 flex-1 truncate">{model.displayName}</span>
                  <span className="shrink-0 text-xs text-[var(--color-text-tertiary)]">{model.vendor}</span>
                  {selectedModel === model.id && (
                    <Check size={14} className="shrink-0 text-[var(--color-brand)]" />
                  )}
                </button>
              ))
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
