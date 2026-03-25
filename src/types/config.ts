// src/types/config.ts
export type Vendor = 'OpenAI' | 'Anthropic' | 'GoogleGemini' 

export interface ModelAttributes {
  id: string;
  displayName: string;
  vendor: Vendor;
  inputContextWindow: string;
  outputContextWindow: string;
  supportTextToText: boolean;
  supportImageToText: boolean;
  supportTextToSpeech: boolean;
  inputPricePer1mToken: number;
  outputPricePer1mToken: number;
}

export type HotkeyFunction = "lookupLexicalEntry" | "translateText" | "ocr";


