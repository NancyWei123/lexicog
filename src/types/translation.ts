import type { TextAnalysisReport } from './text-analysis';

export interface TranslationResponse {
  translation: string;
  textAnalysisReport: TextAnalysisReport;
}

export function sanitizeTranslationResponse(
  response: Partial<TranslationResponse> | null | undefined
): TranslationResponse {
  const report = response?.textAnalysisReport;

  return {
    translation:
      typeof response?.translation === 'string' ? response.translation : '',
    textAnalysisReport: {
      orthographicErrors: Array.isArray(report?.orthographicErrors) ? report.orthographicErrors : [],
      lexicalErrors: Array.isArray(report?.lexicalErrors) ? report.lexicalErrors : [],
      grammaticalErrors: Array.isArray(report?.grammaticalErrors) ? report.grammaticalErrors : [],
      semanticErrors: Array.isArray(report?.semanticErrors) ? report.semanticErrors : [],
      pragmaticErrors: Array.isArray(report?.pragmaticErrors) ? report.pragmaticErrors : [],
      correctedText: typeof report?.correctedText === 'string' ? report.correctedText : '',
    },
  };
}

export function parseTranslationResponse(json: string): TranslationResponse | null {
  try {
    return sanitizeTranslationResponse(JSON.parse(json) as TranslationResponse);
  } catch {
    return null;
  }
}
