/**
 * Lexical Entry
 * Corresponding to the data structure returned by the Rust backend
 */

export interface LexicalEntryResponse {
  normalizedFormat: string;
  sourceLanguage: string;
  targetLanguage: string;
  lemma: string;
  phoneticIpa: string;
  phoneticRomanization: string;
  entries: FlatEntry[];
}

export interface FlatEntry {
  pos: string;
  formsList: string[];
  definitionNumber: string;
  definitionTranslation: string;
  definitionSource: string;
  examples: Example[];
  synonyms: string[];
  discipline?: string;
  primaryCode?: string;
}

export interface Example {
  source: string;
  translation: string;
}

export const parseLexicalEntryResponse = (json: string): LexicalEntryResponse | null => {
  try {
    return JSON.parse(json) as LexicalEntryResponse;
  } catch {
    return null;
  }
};

export function getFlatEntryDiscipline(entry: FlatEntry): string {
  return entry.discipline ?? entry.primaryCode ?? '';
}
