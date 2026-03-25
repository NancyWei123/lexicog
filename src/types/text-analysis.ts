// src/types/text-analysis.ts

export interface ErrorDetail {
  originalText: string;
  explanation: string;
  suggestedCorrection: string;
}

export interface TextAnalysisReport {
  orthographicErrors: ErrorDetail[];
  lexicalErrors: ErrorDetail[];
  grammaticalErrors: ErrorDetail[];
  semanticErrors: ErrorDetail[];
  pragmaticErrors: ErrorDetail[];
  correctedText: string;
}
