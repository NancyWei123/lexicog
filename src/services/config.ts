import { invoke } from '@tauri-apps/api/core';
import { HotkeyFunction } from '../types/config';

export async function readConfigFromStore(entry: string): Promise<string | null> {
  return invoke<string | null>('read_config_from_store', { entry });
}

export async function resetHotkey(
  functionName: HotkeyFunction,
  hotkeyStr: string
): Promise<void> {
  return invoke('reset_hotkey', { function: functionName, hotkeyStr });
}

export async function resetTttModel(modelId: string): Promise<void> {
  return invoke('reset_ttt_model', { modelId });
}

export async function resetTtsModel(modelId: string): Promise<void> {
  return invoke('reset_tts_model', { modelId });
}

export async function resetOcrModel(modelId: string): Promise<void> {
  return invoke('reset_ocr_model', { modelId });
}

export async function resetTargetLangOfLexicalEntryLookup(
  lang: string
): Promise<void> {
  return invoke('reset_target_lang_of_lexical_entry_lookup', { lang });
}

export async function resetTargetLangOfTranslation(lang: string): Promise<void> {
  return invoke('reset_target_lang_of_translation', { lang });
}
