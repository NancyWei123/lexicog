import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LanguageSelect } from '@/shared/components/form/LanguageSelect';
import { cn } from '@/lib/utils';
import { Button } from '@/shared/components/ui/button';
import { Card, CardContent } from '@/shared/components/ui/card';

interface LanguageRequestOverlayProps {
  requestId: string;
  onSelect: (requestId: string, languageCode: string) => void;
  className?: string;
}

export function LanguageRequestOverlay({
  requestId,
  onSelect,
  className,
}: LanguageRequestOverlayProps) {
  const { t } = useTranslation();
  const [selectedLanguage, setSelectedLanguage] = useState<string>('');

  const handleConfirm = () => {
    if (selectedLanguage) {
      onSelect(requestId, selectedLanguage);
    }
  };

  return (
    <div
      className={cn(
        'absolute inset-0 z-10 flex items-center justify-center',
        'bg-[rgba(250,249,247,0.86)] backdrop-blur-sm',
        className
      )}
    >
      <Card className="mx-4 w-full max-w-sm border-[var(--color-border)]">
        <CardContent className="space-y-4 p-5">
          <p className="text-sm font-medium text-[var(--color-text-primary)]">
            {t('translateText.selectTargetLanguage')}
          </p>
          <LanguageSelect
            value={selectedLanguage}
            onValueChange={setSelectedLanguage}
            className="w-full"
          />

          <div className="flex justify-end">
            <Button
              type="button"
              onClick={handleConfirm}
              disabled={!selectedLanguage}
            >
              {t('ocr.confirm')}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
