use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LexicalEntryResponse {
    pub normalized_format: String,
    pub source_language: String,
    pub target_language: String,
    pub lemma: String,
    pub phonetic_ipa: String,
    pub phonetic_romanization: String,
    pub entries: Vec<FlatEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FlatEntry {
    pub pos: String,
    pub forms_list: Vec<String>,
    pub definition_number: String,
    pub definition_translation: String,
    pub definition_source: String,
    pub examples: Vec<Example>,
    pub synonyms: Vec<String>,
    pub discipline: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Example {
    pub source: String,
    pub translation: String,
}

impl LexicalEntryResponse {
    pub fn from_json_str(s: &str) -> Result<Self> {
        let response: LexicalEntryResponse = serde_json::from_str(s)
            .map_err(|e| anyhow!("{}", e).context("parse lexical entry response"))?;
        Ok(response)
    }

    pub fn json_schema() -> Value {
        let example_schema = json!({
            "type": "object",
            "additionalProperties": false,
            "required": ["source", "translation"],
            "properties": {
                "source": {
                    "type": "string",
                    "description": "Example sentence in source language"
                },
                "translation": {
                    "type": "string",
                    "description": "Translation in target language; empty string if target equals source"
                }
            }
        });

        let entry_schema = json!({
            "type": "object",
            "additionalProperties": false,
            "required": [
                "pos", "formsList", "definitionNumber",
                "definitionTranslation", "definitionSource",
                "examples", "synonyms", "discipline"
            ],
            "properties": {
                "pos": {
                    "type": "string",
                    "description": "Part of speech label in the TARGET language; formsList must only contain forms compatible with this part of speech"
                },
                "formsList": {
                    "type": "array",
                    "description": "POS-consistent inflected forms for this sense only. Include forms that match this entry's part of speech (e.g., noun -> singular/plural/case forms; verb -> conjugations/participles). Never mix cross-POS forms (e.g., noun entries must not include verb forms such as past tense/progressive). Return [] when not applicable or uncertain.",
                    "items": {
                        "type": "string",
                        "minLength": 1
                    }
                },
                "definitionNumber": {
                    "type": "string",
                    "description": "Sense number as a string (e.g. \"1\", \"2\")"
                },
                "definitionTranslation": {
                    "type": "string",
                    "description": "Equivalent word or expression in target language"
                },
                "definitionSource": {
                    "type": "string",
                    "description": "Comprehensive definition in the source language"
                },
                "examples": {
                    "type": "array",
                    "description": "EXACTLY 2 examples per definition",
                    "minItems": 2,
                    "maxItems": 2,
                    "items": example_schema
                },
                "synonyms": {
                    "type": "array",
                    "description": "Synonyms in SOURCE language only; NEVER in target language. Return empty array if unavailable or uncertain.",
                    "items": { "type": "string" }
                },
                "discipline": {
                    "type": "string",
                    "description": "Exactly ONE VKGDT discipline code for this sense (required). Format: DOMAIN.SUB (e.g. 'ET.CS', 'FG.GEN'). DOMAIN ∈ {HA,SS,NS,ET,ML,BM,FG}. Pick the single most representative discipline; never combine multiple codes."
                }
            }
        });

        json!({
            "$schema": "http://json-schema.org/draft-07/schema#",
            "type": "object",
            "additionalProperties": false,
            "required": [
                "normalizedFormat", "sourceLanguage", "targetLanguage",
                "lemma", "phoneticIpa", "phoneticRomanization", "entries"
            ],
            "properties": {
                "normalizedFormat": {
                    "type": "string",
                    "description": "EXACTLY the same input text as provided by the user"
                },
                "sourceLanguage": {
                    "type": "string",
                    "description": "Language code of the input text (e.g. en, zh-CN, jp, es, fr, de, it, ru, pt, ko, vi, th, el)"
                },
                "targetLanguage": {
                    "type": "string",
                    "description": "Language code for definitions and translations. Must be exactly the value provided in TARGET_LANGUAGE from the user prompt. Supported codes: zh-CN, en, jp, es, fr, de, it, ru, pt, ko, vi, th, el."
                },
                "lemma": {
                    "type": "string",
                    "description": "Normalized/lemmatized form of the entry"
                },
                "phoneticIpa": {
                    "type": "string",
                    "description": "IPA transcription of the input text; ONLY for Latin-script input, empty string for non-Latin scripts"
                },
                "phoneticRomanization": {
                    "type": "string",
                    "description": "Romanization of the input text; ONLY for non-Latin-script input (e.g. Pinyin, Romaji), empty string for Latin scripts"
                },
                "entries": {
                    "type": "array",
                    "description": "Flat list of definitions; each entry carries its own part-of-speech, morphological forms, and VKGDT domain codes",
                    "items": entry_schema
                }
            }
        })
    }
}
