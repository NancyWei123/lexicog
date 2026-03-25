use anyhow::{anyhow, Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewSessions {
    pub sessions: Vec<Session>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub topic: String,
    pub context_intro: String,
    pub messages: Vec<Message>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Message {
    pub role: String,
    pub content_parts: Vec<ContentPart>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ContentPart {
    Text {
        value: String,
    },
    Blank {
        #[serde(rename = "targetEntry")]
        target_entry: String,
        #[serde(rename = "perfectMatch")]
        perfect_match: String,
    },
}

const REVIEW_TEXT_PART_VALUE_DESCRIPTION: &str =
    "For type=text, natural dialogue text that provides enough semantic and grammatical context for nearby blanks. For type=blank, use empty string.";
const REVIEW_BLANK_TARGET_ENTRY_DESCRIPTION: &str =
    "For type=blank, copy one original lexical entry from the input list verbatim in its citation form. Do not inflect, rewrite, paraphrase, or switch part of speech. For type=text, use empty string.";
const REVIEW_BLANK_PERFECT_MATCH_DESCRIPTION: &str =
    "For type=blank, the exact surface form the learner must type for this sentence. Prefer a natural inflection of targetEntry that highlights morphology such as tense, aspect, mood, number, person, case, gender, degree, or politeness whenever the language and entry allow it. Use targetEntry unchanged only when no meaningful inflection is natural. Never use derivational or cross-part-of-speech variants. For type=text, use empty string.";

impl ReviewSessions {
    pub fn from_json_str(json: &str) -> Result<Self> {
        let review_sessions = serde_json::from_str::<ReviewSessions>(json)
            .context("deserialize review sessions payload")?;
        validate_review_sessions(review_sessions)
    }

    pub fn json_schema() -> Value {
        json!({
            "type": "object",
            "additionalProperties": false,
            "required": ["sessions"],
            "properties": {
                "sessions": {
                    "type": "array",
                    "minItems": 1,
                    "items": Self::session_schema()
                }
            }
        })
    }

    fn session_schema() -> Value {
        json!({
            "type": "object",
            "additionalProperties": false,
            "required": ["topic", "contextIntro", "messages"],
            "properties": {
                "topic": { "type": "string" },
                "contextIntro": { "type": "string" },
                "messages": {
                    "type": "array",
                    "minItems": 1,
                    "items": Self::message_schema()
                }
            }
        })
    }

    fn message_schema() -> Value {
        json!({
            "type": "object",
            "additionalProperties": false,
            "required": ["role", "contentParts"],
            "properties": {
                "role": { "type": "string" },
                "contentParts": {
                    "type": "array",
                    "minItems": 1,
                    "items": Self::content_part_schema()
                }
            }
        })
    }

    fn content_part_schema() -> Value {
        json!({
            "type": "object",
            "additionalProperties": false,
            "required": ["type", "value", "targetEntry", "perfectMatch"],
            "properties": {
                "type": { "type": "string", "enum": ["text", "blank"] },
                "value": {
                    "type": "string",
                    "description": REVIEW_TEXT_PART_VALUE_DESCRIPTION
                },
                "targetEntry": {
                    "type": "string",
                    "description": REVIEW_BLANK_TARGET_ENTRY_DESCRIPTION
                },
                "perfectMatch": {
                    "type": "string",
                    "description": REVIEW_BLANK_PERFECT_MATCH_DESCRIPTION
                }
            }
        })
    }
}

fn validate_review_sessions(mut review_sessions: ReviewSessions) -> Result<ReviewSessions> {
    if review_sessions.sessions.is_empty() {
        return Err(anyhow!("model returned an empty sessions list"));
    }

    for session in &mut review_sessions.sessions {
        if session.messages.is_empty() {
            return Err(anyhow!("session is missing messages"));
        }

        for message in &mut session.messages {
            if message.role.trim().is_empty() {
                return Err(anyhow!("message role is empty"));
            }
            if message.content_parts.is_empty() {
                return Err(anyhow!("message is missing content parts"));
            }

            for part in &mut message.content_parts {
                match part {
                    ContentPart::Text { value } => {
                        if value.trim().is_empty() {
                            return Err(anyhow!("text content part missing value"));
                        }
                    }
                    ContentPart::Blank {
                        target_entry,
                        perfect_match,
                    } => {
                        let normalized_target_entry = target_entry.trim().to_string();
                        if normalized_target_entry.is_empty() {
                            return Err(anyhow!("blank content part missing targetEntry"));
                        }
                        *target_entry = normalized_target_entry;

                        let normalized_perfect_match = perfect_match.trim().to_string();
                        if normalized_perfect_match.is_empty() {
                            return Err(anyhow!(
                                "blank content part for '{}' missing perfectMatch",
                                target_entry
                            ));
                        }
                        *perfect_match = normalized_perfect_match;
                    }
                }
            }
        }
    }

    Ok(review_sessions)
}
