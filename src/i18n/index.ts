import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import en from './en.json';
import zhCN from './zh-CN.json';
import { getPersistedLanguage, useUILanguageStore, type SupportedLanguage } from '../stores/ui-language';

export const SUPPORTED_LANGUAGES: readonly SupportedLanguage[] = ['en', 'zh-CN'] as const;
export const FALLBACK_LANGUAGE: SupportedLanguage = 'en';

const resources = {
  en: { translation: en },
  'zh-CN': { translation: zhCN },
} as const;

const detectBrowserLanguage = (): SupportedLanguage => {
  const browserLang = navigator.language || navigator.languages?.[0];

  if (!browserLang) {
    return FALLBACK_LANGUAGE;
  }

  if (isSupportedLanguage(browserLang)) {
    return browserLang;
  }

  const langPrefix = browserLang.split('-')[0].toLowerCase();

  if (langPrefix === 'zh') {
    return 'zh-CN';
  }

  if (langPrefix === 'en') {
    return 'en';
  }

  return FALLBACK_LANGUAGE;
};

const isSupportedLanguage = (lang: string): lang is SupportedLanguage => {
  return SUPPORTED_LANGUAGES.includes(lang as SupportedLanguage);
};

const resolveInitialLanguage = (): SupportedLanguage => {
  const persisted = getPersistedLanguage();
  if (persisted) {
    return persisted;
  }

  const detected = detectBrowserLanguage();

  setTimeout(() => {
    const { language, setLanguage } = useUILanguageStore.getState();
    if (!language) {
      setLanguage(detected);
    }
  }, 0);

  return detected;
};

i18n.use(initReactI18next).init({
  resources,
  lng: resolveInitialLanguage(),
  fallbackLng: FALLBACK_LANGUAGE,
  supportedLngs: SUPPORTED_LANGUAGES as unknown as string[],

  interpolation: {
    escapeValue: false,
  },

  react: {
    useSuspense: false,
  },
});

export default i18n;

export const changeLanguage = async (lang: SupportedLanguage): Promise<void> => {
  await i18n.changeLanguage(lang);
  useUILanguageStore.getState().setLanguage(lang);
};

export const getCurrentLanguage = (): SupportedLanguage => {
  return (i18n.language as SupportedLanguage) || FALLBACK_LANGUAGE;
};

export type { SupportedLanguage };
