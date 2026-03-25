use anyhow::Error;
use std::collections::HashMap;
use std::fmt;
use std::str::FromStr;
use std::sync::LazyLock;

pub static MODELS: LazyLock<HashMap<String, ModelAttributes>> = LazyLock::new(|| {
    let mut map = HashMap::new();
    // --- Google Gemini Models ---

    map.insert(
        "gemini-3.1-pro-preview".to_string(),
        ModelAttributes {
            id: "gemini-3.1-pro-preview".to_string(),
            vendor: Vendor::GoogleGemini,
            support_text_to_text: true,
            support_image_to_text: true,
            support_text_to_speech: false,
            capability: 1500,
        },
    );

    map.insert(
        "gemini-3-flash-preview".to_string(),
        ModelAttributes {
            id: "gemini-3-flash-preview".to_string(),
            vendor: Vendor::GoogleGemini,
            support_text_to_text: true,
            support_image_to_text: true,
            support_text_to_speech: false,
            capability: 1473,
        },
    );

    map.insert(
        "gemini-2.5-flash-preview-tts".to_string(),
        ModelAttributes {
            id: "gemini-2.5-flash-preview-tts".to_string(),
            vendor: Vendor::GoogleGemini,
            support_text_to_text: false,
            support_image_to_text: false,
            support_text_to_speech: true,
            capability: 0,
        },
    );

    // --- OpenAI Models ---

    map.insert(
        "gpt-5.1-2025-11-13".to_string(),
        ModelAttributes {
            id: "gpt-5.1-2025-11-13".to_string(),
            vendor: Vendor::OpenAI,
            support_text_to_text: true,
            support_image_to_text: true,
            support_text_to_speech: false,
            capability: 1439,
        },
    );

    map.insert(
        "gpt-5.4-2026-03-05".to_string(),
        ModelAttributes {
            id: "gpt-5.4-2026-03-05".to_string(),
            vendor: Vendor::OpenAI,
            support_text_to_text: true,
            support_image_to_text: true,
            support_text_to_speech: false,
            capability: 1457,
        },
    );

    map.insert(
        "gpt-4o-mini-tts".to_string(),
        ModelAttributes {
            id: "gpt-4o-mini-tts".to_string(),
            vendor: Vendor::OpenAI,
            support_text_to_text: false,
            support_image_to_text: false,
            support_text_to_speech: true,
            capability: 0,
        },
    );
    // --- Anthropic Models ---
    map.insert(
        "claude-sonnet-4-6".to_string(),
        ModelAttributes {
            id: "claude-sonnet-4-6".to_string(),
            vendor: Vendor::Anthropic,
            support_text_to_text: true,
            support_image_to_text: true,
            support_text_to_speech: false,
            capability: 1457,
        },
    );

    map.insert(
        "claude-opus-4-6".to_string(),
        ModelAttributes {
            id: "claude-opus-4-6".to_string(),
            vendor: Vendor::Anthropic,
            support_text_to_text: true,
            support_image_to_text: true,
            support_text_to_speech: false,
            capability: 1504,
        },
    );

    // --- BytePlus Models ---
    map.insert(
        "deepseek-v3-2-251201".to_string(),
        ModelAttributes {
            id: "deepseek-v3-2-251201".to_string(),
            vendor: Vendor::BytePlus,
            support_text_to_text: true,
            support_image_to_text: false,
            support_text_to_speech: false,
            capability: 1421,
        },
    );

    map.insert(
        "glm-4-7-251222".to_string(),
        ModelAttributes {
            id: "glm-4-7-251222".to_string(),
            vendor: Vendor::BytePlus,
            support_text_to_text: true,
            support_image_to_text: false,
            support_text_to_speech: false,
            capability: 1441,
        },
    );

    map
});

#[derive(PartialEq, Clone, Debug)]
pub enum Vendor {
    OpenAI,
    Anthropic,
    GoogleGemini,
    BytePlus,
    Unknown,
}

impl fmt::Display for Vendor {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        let display_str = match self {
            Vendor::OpenAI => "OpenAI",
            Vendor::Anthropic => "Anthropic",
            Vendor::GoogleGemini => "GoogleGemini",
            Vendor::BytePlus => "BytePlus",
            Vendor::Unknown => "Unknown",
        };
        write!(f, "{}", display_str)
    }
}

impl FromStr for Vendor {
    type Err = Error;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.trim() {
            "OpenAI" => Ok(Vendor::OpenAI),
            "Anthropic" => Ok(Vendor::Anthropic),
            "GoogleGemini" => Ok(Vendor::GoogleGemini),
            "BytePlus" => Ok(Vendor::BytePlus),
            _ => Ok(Vendor::Unknown),
        }
    }
}

pub struct ModelAttributes {
    pub id: String,
    pub vendor: Vendor,
    pub support_text_to_text: bool,
    pub support_image_to_text: bool,
    pub support_text_to_speech: bool,
    pub capability: usize,
}
