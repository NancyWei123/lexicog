// src/stores/ui-language.ts

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type SupportedLanguage = 'en' | 'zh-CN';

interface UILanguageState {
  language: SupportedLanguage | null;
  setLanguage: (lang: SupportedLanguage) => void;
}

const STORAGE_KEY = 'ui-language-storage';

export const useUILanguageStore = create<UILanguageState>()(
  persist(
    (set) => ({
      language: null,
      setLanguage: (lang) => set({ language: lang }),
    }),
    {
      name: STORAGE_KEY,
    }
  )
);

/**
 * Read persisted language synchronously
 * Used during i18n initialization (zustand may not be hydrated yet)
 */
export const getPersistedLanguage = (): SupportedLanguage | null => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return null;

    const parsed = JSON.parse(stored);
    const language = parsed?.state?.language;

    if (language === 'en' || language === 'zh-CN') {
      return language;
    }

    return null;
  } catch {
    return null;
  }
};
