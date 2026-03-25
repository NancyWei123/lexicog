import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Eye, EyeOff } from 'lucide-react';
import { useNotification } from '@/shared/components/feedback';
import { addVendorApi, getVendorApi, setVendorApi } from '@/services/vendor';
import type { Vendor } from '@/types/config';
import { Button } from '@/shared/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card';
import { Input } from '@/shared/components/ui/input';
import { Label } from '@/shared/components/ui/label';
import { Skeleton } from '@/shared/components/ui/skeleton';

interface VendorConfigCardProps {
  vendor: Vendor;
  defaultBaseUrl?: string;
  className?: string;
}

export function VendorConfigCard({
  vendor,
  defaultBaseUrl = '',
  className,
}: VendorConfigCardProps) {
  const { t } = useTranslation();
  const { notify } = useNotification();

  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState(defaultBaseUrl);
  const [showApiKey, setShowApiKey] = useState(false);
  const [apiKeyError, setApiKeyError] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);

  // Load existing config
  useEffect(() => {
    async function loadConfig() {
      try {
        const result = await getVendorApi(vendor);
        if (result) {
          setApiKey(result[0]);
          setBaseUrl(result[1] || defaultBaseUrl);
        } else {
          setApiKey('');
          setBaseUrl(defaultBaseUrl);
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

    if (!trimmedApiKey) {
      setApiKeyError(true);
      return;
    }

    setApiKeyError(false);
    setIsSaving(true);
    try {
      // Use setVendorApi if already exists, otherwise addVendorApi
      await setVendorApi(vendor, trimmedApiKey, trimmedBaseUrl);
      notify({
        type: 'info',
        message: t('main.notifications.vendorSaved', { vendor }),
      });
    } catch (error) {
      notify({
        type: 'error',
        message: t('main.notifications.vendorSaveFailed', { vendor }),
        error,
      });
      // If setVendorApi fails, try addVendorApi
      try {
        await addVendorApi(vendor, trimmedApiKey, trimmedBaseUrl);
        notify({
          type: 'info',
          message: t('main.notifications.vendorSaved', { vendor }),
        });
      } catch (nestedError) {
        notify({
          type: 'error',
          message: t('main.notifications.vendorSaveFailed', { vendor }),
          error: nestedError,
        });
      }
    } finally {
      setIsSaving(false);
    }
  }, [vendor, apiKey, baseUrl, defaultBaseUrl, notify, t]);

  if (!isLoaded) {
    return (
      <Card className={className}>
        <CardContent className="space-y-3 p-5">
          <Skeleton className="h-5 w-1/2" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={className}>
      <CardHeader className="pb-3">
        <CardTitle>{vendor}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 pt-0">
        <div className="space-y-2">
          <Label htmlFor={`${vendor}-api-key`}>
            {t('configures.vendors.authentication.apiKey')}
          </Label>
          <div className="flex items-center gap-2">
            <Input
              id={`${vendor}-api-key`}
              type={showApiKey ? 'text' : 'password'}
              value={apiKey}
              onChange={(event) => {
                setApiKey(event.target.value);
                setApiKeyError(false);
              }}
              aria-invalid={apiKeyError}
              className={apiKeyError ? 'border-[var(--color-error)] focus-visible:ring-[var(--color-error)]/25' : undefined}
              placeholder={t('configures.vendors.authentication.apiKey')}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={showApiKey ? t('common.hidePassword') : t('common.showPassword')}
              onClick={() => setShowApiKey((value) => !value)}
            >
              {showApiKey ? <EyeOff size={16} /> : <Eye size={16} />}
            </Button>
          </div>
          {apiKeyError && (
            <p className="text-xs text-[var(--color-error)]">{t('error.genericMessage')}</p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor={`${vendor}-base-url`}>
            {t('configures.vendors.authentication.apiBaseURL')}
          </Label>
          <Input
            id={`${vendor}-base-url`}
            type="url"
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
            placeholder={t('configures.vendors.authentication.apiBaseURL')}
          />
        </div>

        <Button
          type="button"
          onClick={handleSave}
          disabled={isSaving || !apiKey.trim()}
          className="w-full"
        >
          {isSaving ? t('common.saving') : t('common.save')}
        </Button>
      </CardContent>
    </Card>
  );
}
