import { invoke } from "@tauri-apps/api/core";
import { Channel } from "@tauri-apps/api/core";
import type { Session } from "../types/review";
import {
  parseRepresentativeEntriesResponse,
  type RepresentativeEntriesResponse,
} from "../types/representative-entries";

export async function serveTextToSpeech(
  text: string,
  persist: boolean = false,
): Promise<Uint8Array> {
  return invoke<Uint8Array>("serve_text_to_speech", { text, persist });
}

export async function lookupLexicalEntry(
  channel: Channel<string | null>,
  refresh: boolean = false,
  lexicalEntry?: string,
): Promise<boolean> {
  return invoke<boolean>("lookup_lexical_entry", {
    channel,
    refresh,
    lexicalEntry: lexicalEntry ?? null,
  });
}

export async function getLookupHistory(
  prefix: string,
  sourceLang?: string,
  discipline?: string,
): Promise<[string, number][]> {
  return invoke<[string, number][]>("get_lookup_history", {
    prefix,
    sourceLang: sourceLang ?? null,
    domain: discipline ?? null,
  });
}

export async function markLexicalEntry(lexicalEntry: string): Promise<void> {
  return invoke("mark_lexical_entry", { lexicalEntry });
}

export async function removeLexicalEntry(lexicalEntry: string): Promise<void> {
  return invoke("remove_lexical_entry", { lexicalEntry });
}

export async function serveRepresentativeEntriesByDiscipline(
  channel: Channel<string | null>,
  sourceLang: string,
  discipline: string,
): Promise<RepresentativeEntriesResponse> {
  const response = await invoke<unknown>(
    "serve_representative_entries_by_discipline",
    {
      channel,
      sourceLang,
      discipline,
    },
  );

  return parseRepresentativeEntriesResponse(response);
}

export async function getUniqueSourceLanguagesOfLexicalEntries(): Promise<string[]> {
  return invoke<string[]>("get_unique_source_languages_of_lexical_entries");
}

export async function getUniqueDisciplinesOfLexicalEntries(
  sourceLanguage: string,
): Promise<string[]> {
  return invoke<string[]>("get_unique_disciplines_of_lexical_entries", {
    sourceLanguage,
  });
}

export async function serveTextTranslation(
  channel: Channel<string | null>,
  text?: string,
): Promise<string> {
  return invoke("serve_text_translation", {
    channel,
    text: text ?? null,
  });
}

export async function mimicTriggerTranslateText(): Promise<void> {
  return invoke("mimic_trigger_translate_text", {});
}

export async function mimicTriggerLookupLexicalEntry(): Promise<void> {
  return invoke("mimic_trigger_lookup_lexical_entry", {});
}

export async function serveOcr(
  channel: Channel<string | null>,
  languages: string[],
  offsetX: number,
  offsetY: number,
  width: number,
  height: number,
): Promise<void> {
  return invoke("serve_ocr", {
    channel,
    languages,
    offsetX,
    offsetY,
    width,
    height,
  });
}

export async function fetchSelectedImage(): Promise<string> {
  return invoke("fetch_selected_image", {});
}

export async function serveSession(
  channel: Channel<string | null>,
  sourceLanguage: string,
): Promise<[Session, number, number] | null> {
  return invoke("serve_session", {
    sourceLanguage,
    channel,
  });
}

export async function updateReviewState(
  sourceLanguage: string,
  userInput: string,
  timeTakenMs?: number,
): Promise<void> {
  return invoke("update_review_state", {
    sourceLanguage,
    userInput,
    timeTakenMs: timeTakenMs ?? null,
  });
}

export async function getReviewHistory(
  limit: number,
  offset: number,
): Promise<[Session, string][]> {
  return invoke("get_review_history", { limit, offset });
}

export async function removeReviewSession(reviewTime: string): Promise<void> {
  return invoke("remove_review_session", { reviewTime });
}
