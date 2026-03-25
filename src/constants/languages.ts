// src/constants/languages.ts

export const TARGET_LANGUAGE_CODES = [
  'zh-CN',
  'en',
  'jp',
  'es',
  'fr',
  'de',
  'it',
  'ru',
  'pt',
  'ko',
  'vi',
  'th',
  'el',
] as const;

export type TargetLanguageCode = (typeof TARGET_LANGUAGE_CODES)[number];

