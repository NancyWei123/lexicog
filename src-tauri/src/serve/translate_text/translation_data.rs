use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ErrorDetail {
    pub original_text: String,
    pub explanation: String,
    pub suggested_correction: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextAnalysisReport {
    /// Spelling, punctuation, and capitalization issues.
    pub orthographic_errors: Vec<ErrorDetail>,

    /// Word choice and collocation issues.
    pub lexical_errors: Vec<ErrorDetail>,

    /// Grammar and syntax issues.
    pub grammatical_errors: Vec<ErrorDetail>,

    /// Meaning and logic issues.
    pub semantic_errors: Vec<ErrorDetail>,

    /// Register, tone, and style issues.
    pub pragmatic_errors: Vec<ErrorDetail>,

    /// Fully corrected source text.
    pub corrected_text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslationResponse {
    pub translation: String,
    pub text_analysis_report: TextAnalysisReport,
}

impl TranslationResponse {
    pub fn from_json_str(s: &str) -> Result<Self> {
        let response = serde_json::from_str::<TranslationResponse>(s)
            .map_err(|e| anyhow!("{}", e).context("parse translation response"))?;

        if response.translation.trim().is_empty() {
            return Err(anyhow!("translation is empty").context("parse translation response"));
        }

        Ok(response)
    }

    pub fn json_schema() -> Value {
        json!({
            "$schema": "http://json-schema.org/draft-07/schema#",
            "type": "object",
            "additionalProperties": false,
            "required": ["translation", "textAnalysisReport"],
            "properties": {
                "translation": {
                    "type": "string",
                    "description": "Final translation of the source text into the requested translation language. Preserve the original line breaks and structure. If the source is already in that language, return the source text unchanged."
                },
                "textAnalysisReport": Self::text_analysis_report_schema()
            }
        })
    }

    fn text_analysis_report_schema() -> Value {
        json!({
            "type": "object",
            "description": "Analysis of the source text for errors. MUST have all error arrays empty and correctedText equal to the source text when the source language is the same as the configured lookup target language.",
            "additionalProperties": false,
            "required": [
                "orthographicErrors",
                "lexicalErrors",
                "grammaticalErrors",
                "semanticErrors",
                "pragmaticErrors",
                "correctedText"
            ],
            "properties": {
                "orthographicErrors": Self::error_list_schema(
                    "Orthographic & typographical errors: spelling, punctuation, capitalization."
                ),
                "lexicalErrors": Self::error_list_schema(
                    "Lexical & collocation errors: wrong word choice, collocation issues, word-class misuse."
                ),
                "grammaticalErrors": Self::error_list_schema(
                    "Grammatical & syntactic errors: tense/voice, agreement, missing or redundant constituents, word order."
                ),
                "semanticErrors": Self::error_list_schema(
                    "Semantic & logical errors: contradictions, unclear reference, faulty discourse logic."
                ),
                "pragmaticErrors": Self::error_list_schema(
                    "Pragmatic & stylistic errors: register mismatch, tone inappropriateness, style inconsistency."
                ),
                "correctedText": {
                    "type": "string",
                    "description": "Fully corrected and natural final text after resolving all detected issues. Must be in the same language as the source text. If no correction is needed, must equal the original source text exactly."
                }
            }
        })
    }

    fn error_list_schema(description: &str) -> Value {
        json!({
            "type": "array",
            "description": description,
            "items": Self::error_detail_schema()
        })
    }

    fn error_detail_schema() -> Value {
        json!({
            "type": "object",
            "additionalProperties": false,
            "required": ["originalText", "explanation", "suggestedCorrection"],
            "properties": {
                "originalText": {
                    "type": "string",
                    "description": "The exact problematic span copied from the source text."
                },
                "explanation": {
                    "type": "string",
                    "description": "Short rationale that explains why this span is problematic."
                },
                "suggestedCorrection": {
                    "type": "string",
                    "description": "A corrected replacement for the problematic span."
                }
            }
        })
    }
}
