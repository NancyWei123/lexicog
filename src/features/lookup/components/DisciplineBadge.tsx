import { VKGDT_DISCIPLINE_NAME_I18N } from '@/constants/vkgdt-discipline-name';
import type { VKGDTDisciplineCode } from '@/types/discipline';
import type { TargetLanguageCode } from '@/constants/languages';
import { Badge } from '@/shared/components/ui/badge';

interface DisciplineBadgeProps {
  disciplineCode: string;
  targetLanguage: string;
}

export function DisciplineBadge({
  disciplineCode,
  targetLanguage,
}: DisciplineBadgeProps) {
  const disciplineName =
    VKGDT_DISCIPLINE_NAME_I18N[disciplineCode as VKGDTDisciplineCode]?.[
      targetLanguage as TargetLanguageCode
    ] ?? disciplineCode;

  if (!disciplineCode) return null;

  return (
    <Badge
      className="whitespace-nowrap rounded-md border-[var(--color-brand)] bg-[var(--color-brand-bg)] text-[10px] font-medium text-[var(--color-brand)]"
    >
      {disciplineName}
    </Badge>
  );
}
