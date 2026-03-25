import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Eye, EyeOff, ChevronDown } from 'lucide-react';
import { useNotification } from '@/shared/components/feedback';
import {
  addVendorApi,
  getVendorApi,
  removeVendor,
  setVendorApi,
} from '@/services/vendor';
import type { Vendor } from '@/types/config';
import { cn } from '@/lib/utils';
import { Button } from '@/shared/components/ui/button';
import { Input } from '@/shared/components/ui/input';
import { Skeleton } from '@/shared/components/ui/skeleton';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/shared/components/ui/collapsible';

interface VendorConfigRowProps {
  vendor: Vendor;
  defaultBaseUrl?: string;
}

export function VendorConfigRow({
  vendor,
  defaultBaseUrl = '',
}: VendorConfigRowProps) {
  const { t } = useTranslation();
  const { notify } = useNotification();

  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState(defaultBaseUrl);
  const [showApiKey, setShowApiKey] = useState(false);
  const [apiKeyError, setApiKeyError] = useState(false);
  const savingRef = useRef(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const [hasKey, setHasKey] = useState(false);
  const [showBaseUrl, setShowBaseUrl] = useState(false);

  useEffect(() => {
    async function loadConfig() {
      try {
        const result = await getVendorApi(vendor);
        if (result) {
          setApiKey(result[0]);
          setBaseUrl(result[1] || defaultBaseUrl);
          setHasKey(!!result[0]);
        } else {
          setApiKey('');
          setBaseUrl(defaultBaseUrl);
          setHasKey(false);
        }
      } catch (error) {
        notify({
          type: 'error',
          message: t('error.genericMessage'),
          error,
        });
      } finally {
        setIsLoaded(true);
      }
    }
    loadConfig();
  }, [vendor, defaultBaseUrl, notify, t]);

  const handleSave = useCallback(async () => {
    const trimmedApiKey = apiKey.trim();
    const trimmedBaseUrl = baseUrl.trim() || defaultBaseUrl;

    if (savingRef.current) return;
    setApiKeyError(false);
    savingRef.current = true;
    try {
      if (hasKey && !trimmedApiKey) {
        // Clear: vendor existed but user emptied the key → remove
        await removeVendor(vendor);
        setHasKey(false);
        setApiKey('');
        setBaseUrl(defaultBaseUrl);
        notify({
          type: 'info',
          message: t('main.notifications.vendorRemoved', { vendor }),
        });
      } else if (hasKey && trimmedApiKey) {
        // Update: vendor exists and key is non-empty → set
        await setVendorApi(vendor, trimmedApiKey, trimmedBaseUrl);
        notify({
          type: 'info',
          message: t('main.notifications.vendorSaved', { vendor }),
        });
      } else if (!hasKey && trimmedApiKey) {
        // Add: vendor doesn't exist yet → add
        await addVendorApi(vendor, trimmedApiKey, trimmedBaseUrl);
        setHasKey(true);
        notify({
          type: 'info',
          message: t('main.notifications.vendorSaved', { vendor }),
        });
      }
    } catch (error) {
      notify({
        type: 'error',
        message: t('main.notifications.vendorSaveFailed', { vendor }),
        error,
      });
    } finally {
      savingRef.current = false;
    }
  }, [vendor, apiKey, baseUrl, defaultBaseUrl, hasKey, notify, t]);

  if (!isLoaded) {
    return (
      <div className="space-y-4 py-5">
        <div className="flex items-center gap-3">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-10 flex-1" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 py-5">
      <div className="flex items-center gap-2">
        <span
          className={cn(
            'h-2 w-2 shrink-0 rounded-full',
            hasKey ? 'bg-[var(--color-success)]' : 'bg-[var(--color-text-tertiary)]'
          )}
        />
        <span className="text-sm font-medium text-[var(--color-text-primary)]">{vendor}</span>
      </div>

      {/* API Key row */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Input
            id={`${vendor}-api-key`}
            type={showApiKey ? 'text' : 'password'}
            value={apiKey}
            onChange={(event) => {
              setApiKey(event.target.value);
              setApiKeyError(false);
            }}
            onBlur={handleSave}
            aria-invalid={apiKeyError}
            className={cn(
              'h-10 pr-10',
              apiKeyError && 'shadow-[inset_0_0_0_1px_rgba(214,64,69,0.3),0_0_0_4px_rgba(214,64,69,0.08)]'
            )}
            placeholder={t('configures.vendors.authentication.apiKey')}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="absolute right-1 top-1 h-8 w-8 rounded-full text-[var(--color-text-tertiary)]"
            aria-label={showApiKey ? t('common.hidePassword') : t('common.showPassword')}
            onClick={() => setShowApiKey((v) => !v)}
          >
            {showApiKey ? <EyeOff size={14} /> : <Eye size={14} />}
          </Button>
        </div>
      </div>

      {apiKeyError && (
        <p className="text-xs text-[var(--color-error)]">{t('error.genericMessage')}</p>
      )}

      {/* Base URL (expandable) */}
      <Collapsible open={showBaseUrl} onOpenChange={setShowBaseUrl}>
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex items-center gap-1 text-xs text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)] transition-colors"
          >
            <ChevronDown className={cn('size-3 transition-transform', showBaseUrl && 'rotate-180')} />
            {t('configures.vendors.authentication.apiBaseURL')}
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-2">
          <Input
            id={`${vendor}-base-url`}
            type="url"
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
            onBlur={handleSave}
            placeholder={defaultBaseUrl}
            className="h-10"
          />
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
