use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Top50RepresentativeEntriesResponse {
    #[serde(default)]
    pub lexical_entries: Vec<String>,
    pub message: String,
}

impl Top50RepresentativeEntriesResponse {
    pub fn from_json_str(s: &str) -> Result<Self> {
        let response: Top50RepresentativeEntriesResponse =
            serde_json::from_str(s).map_err(|e| {
                anyhow!("{}", e).context("parse top-50 representative entries response")
            })?;
        Ok(response)
    }

    pub fn json_schema() -> Value {
        json!({
            "$schema": "http://json-schema.org/draft-07/schema#",
            "type": "object",
            "additionalProperties": false,
            "required": ["lexicalEntries", "message"],
            "properties": {
                "lexicalEntries": {
                    "type": "array",
                    "description": "Exactly 50 representative lemmas ordered from most to least representative",
                    "minItems": 50,
                    "maxItems": 50,
                    "items": {
                        "type": "string",
                        "minLength": 1,
                        "maxLength": 80
                    }
                },
                "message": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 200,
                    "description": "Briefly encourage the person to learn these representative lemmas, especially in terms of how they build the basic cognition of the given discipline"
                }
            }
        })
    }
}
