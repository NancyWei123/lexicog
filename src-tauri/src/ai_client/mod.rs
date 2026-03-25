pub mod anthropic;
pub mod byteplus;
pub mod googlegemini;
pub mod openai;

use crate::{
    config::{
        constant::{self, Vendor},
        impl_read_config_from_store,
    },
    db::SqliteInterface,
};
use anyhow::{anyhow, Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::future::Future;
use std::pin::Pin;
use tauri::{ipc::Channel, AppHandle, Manager};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCall {
    pub call_id: String,
    pub name: String,
    pub arguments: Value,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct TextToTextResult {
    pub text: String,
    pub tool_calls: Vec<ToolCall>,
}

pub trait TextToTextClient: Send + Sync {
    fn execute_streaming_text_to_text_task(
        &self,
        channel: Channel<Option<String>>,
        system_prompt: String,
        user_prompt: String,
        output_structure: Option<Value>,
        tools: Option<Vec<Value>>,
        model_id: String,
    ) -> Pin<Box<dyn Future<Output = Result<TextToTextResult>> + Send + '_>>;

    fn get_vendor(&self) -> Vendor;
}

pub trait TextToSpeechClient: Send + Sync {
    fn execute_text_to_speech_task(
        &self,
        prompt: String,
        model_id: String,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<u8>>> + Send + '_>>;

    fn get_vendor(&self) -> Vendor;
}

pub trait OCRClient: Send + Sync {
    fn execute_ocr_task(
        &self,
        channel: Channel<Option<String>>,
        prompt: String,
        image: String,
        model_id: String,
    ) -> Pin<Box<dyn Future<Output = Result<String>> + Send + '_>>;

    fn get_vendor(&self) -> Vendor;
}

pub struct ClientHub {
    pub ttt_client: Option<Box<dyn TextToTextClient>>,
    pub tts_client: Option<Box<dyn TextToSpeechClient>>,
    pub ocr_client: Option<Box<dyn OCRClient>>,
}

impl ClientHub {
    pub async fn new(app: &AppHandle) -> Result<Self> {
        let ttt_client = match get_default_ttt_client(app).await {
            Ok(client) => client,
            Err(e) => {
                log::error!(
                    "{:#}",
                    e.context("initialize client hub: load default text-to-text client")
                );
                None
            }
        };

        let tts_client = match get_default_tts_client(app).await {
            Ok(client) => client,
            Err(e) => {
                log::error!(
                    "{:#}",
                    e.context("initialize client hub: load default text-to-speech client")
                );
                None
            }
        };

        let ocr_client = match get_default_ocr_client(app).await {
            Ok(client) => client,
            Err(e) => {
                log::error!(
                    "{:#}",
                    e.context("initialize client hub: load default OCR client")
                );
                None
            }
        };

        Ok(Self {
            ttt_client,
            tts_client,
            ocr_client,
        })
    }

    pub async fn reload_ttt_client(&mut self, db: &SqliteInterface, vendor: Vendor) -> Result<()> {
        match vendor {
            Vendor::Anthropic => {
                let anthropic_client = anthropic::AnthropicClient::new(db)
                    .await
                    .context("reload text-to-text client for vendor Anthropic")?;
                self.ttt_client = Some(Box::new(anthropic_client));
            }
            Vendor::BytePlus => {
                let byteplus_client = byteplus::BytePlusClient::new(db)
                    .await
                    .context("reload text-to-text client for vendor BytePlus")?;
                self.ttt_client = Some(Box::new(byteplus_client));
            }
            Vendor::GoogleGemini => {
                let googlegemini_client = googlegemini::GoogleGeminiClient::new(db)
                    .await
                    .context("reload text-to-text client for vendor GoogleGemini")?;
                self.ttt_client = Some(Box::new(googlegemini_client));
            }
            Vendor::OpenAI => {
                let openai_client = openai::OpenAIClient::new(db)
                    .await
                    .context("reload text-to-text client for vendor OpenAI")?;
                self.ttt_client = Some(Box::new(openai_client));
            }
            _ => {
                self.ttt_client = None;
            }
        }
        Ok(())
    }

    pub async fn reload_tts_client(&mut self, db: &SqliteInterface, vendor: Vendor) -> Result<()> {
        match vendor {
            Vendor::GoogleGemini => {
                let googlegemini_client = googlegemini::GoogleGeminiClient::new(db)
                    .await
                    .context("reload text-to-speech client for vendor GoogleGemini")?;
                self.tts_client = Some(Box::new(googlegemini_client));
            }
            Vendor::OpenAI => {
                let openai_client = openai::OpenAIClient::new(db)
                    .await
                    .context("reload text-to-speech client for vendor OpenAI")?;
                self.tts_client = Some(Box::new(openai_client));
            }
            _ => {
                self.tts_client = None;
            }
        }
        Ok(())
    }

    pub async fn reload_ocr_client(&mut self, db: &SqliteInterface, vendor: Vendor) -> Result<()> {
        match vendor {
            Vendor::Anthropic => {
                let anthropic_client = anthropic::AnthropicClient::new(db)
                    .await
                    .context("reload OCR client for vendor Anthropic")?;
                self.ocr_client = Some(Box::new(anthropic_client));
            }
            Vendor::GoogleGemini => {
                let googlegemini_client = googlegemini::GoogleGeminiClient::new(db)
                    .await
                    .context("reload OCR client for vendor GoogleGemini")?;
                self.ocr_client = Some(Box::new(googlegemini_client));
            }
            Vendor::OpenAI => {
                let openai_client = openai::OpenAIClient::new(db)
                    .await
                    .context("reload OCR client for vendor OpenAI")?;
                self.ocr_client = Some(Box::new(openai_client));
            }
            _ => {
                self.ocr_client = None;
            }
        }
        Ok(())
    }

    pub fn get_ttt_client_vendor(&self) -> Option<Vendor> {
        self.ttt_client.as_ref().map(|client| client.get_vendor())
    }

    pub fn get_tts_client_vendor(&self) -> Option<Vendor> {
        self.tts_client.as_ref().map(|client| client.get_vendor())
    }

    pub fn get_ocr_client_vendor(&self) -> Option<Vendor> {
        self.ocr_client.as_ref().map(|client| client.get_vendor())
    }
}

async fn get_default_ttt_client(app: &AppHandle) -> Result<Option<Box<dyn TextToTextClient>>> {
    let db = app
        .try_state::<SqliteInterface>()
        .ok_or(anyhow!("missing tauri state: SqliteInterface"))
        .context("load default text-to-text client")?;
    match impl_read_config_from_store(app, "textToTextModel") {
        Ok(Some(model_id)) => {
            match constant::MODELS
                .get(&model_id)
                .map(|attr| attr.vendor.clone())
                .unwrap_or(Vendor::Unknown)
            {
                Vendor::Anthropic => {
                    let anthropic_client = anthropic::AnthropicClient::new(&db)
                        .await
                        .context("load default text-to-text client for vendor Anthropic")?;
                    Ok(Some(Box::new(anthropic_client)))
                }
                Vendor::BytePlus => {
                    let byteplus_client = byteplus::BytePlusClient::new(&db)
                        .await
                        .context("load default text-to-text client for vendor BytePlus")?;
                    Ok(Some(Box::new(byteplus_client)))
                }
                Vendor::GoogleGemini => {
                    let googlegemini_client = googlegemini::GoogleGeminiClient::new(&db)
                        .await
                        .context("load default text-to-text client for vendor GoogleGemini")?;
                    Ok(Some(Box::new(googlegemini_client)))
                }
                Vendor::OpenAI => {
                    let openai_client = openai::OpenAIClient::new(&db)
                        .await
                        .context("load default text-to-text client for vendor OpenAI")?;
                    Ok(Some(Box::new(openai_client)))
                }
                _ => Err(anyhow!(
                    "configured text-to-text model `{}` maps to unsupported vendor",
                    model_id
                ))
                .context("load default text-to-text client"),
            }
        }
        Err(e) => {
            Err(e).context("load default text-to-text client: read `textToTextModel` from config")
        }
        _ => Ok(None),
    }
}

async fn get_default_tts_client(app: &AppHandle) -> Result<Option<Box<dyn TextToSpeechClient>>> {
    let db = app
        .try_state::<SqliteInterface>()
        .ok_or(anyhow!("missing tauri state: SqliteInterface"))
        .context("load default text-to-speech client")?;
    match impl_read_config_from_store(app, "textToSpeechModel") {
        Ok(Some(model_id)) => {
            match constant::MODELS
                .get(&model_id)
                .map(|attr| attr.vendor.clone())
                .unwrap_or(Vendor::Unknown)
            {
                Vendor::GoogleGemini => {
                    let googlegemini_client = googlegemini::GoogleGeminiClient::new(&db)
                        .await
                        .context("load default text-to-speech client for vendor GoogleGemini")?;
                    Ok(Some(Box::new(googlegemini_client)))
                }
                Vendor::OpenAI => {
                    let openai_client = openai::OpenAIClient::new(&db)
                        .await
                        .context("load default text-to-speech client for vendor OpenAI")?;
                    Ok(Some(Box::new(openai_client)))
                }
                _ => Err(anyhow!(
                    "configured text-to-speech model `{}` maps to unsupported vendor",
                    model_id
                ))
                .context("load default text-to-speech client"),
            }
        }
        Err(e) => Err(e)
            .context("load default text-to-speech client: read `textToSpeechModel` from config"),
        _ => Ok(None),
    }
}

async fn get_default_ocr_client(app: &AppHandle) -> Result<Option<Box<dyn OCRClient>>> {
    let db = app
        .try_state::<SqliteInterface>()
        .ok_or(anyhow!("missing tauri state: SqliteInterface"))
        .context("load default OCR client")?;
    match impl_read_config_from_store(app, "ocrModel") {
        Ok(Some(model_id)) => {
            match constant::MODELS
                .get(&model_id)
                .map(|attr| attr.vendor.clone())
                .unwrap_or(Vendor::Unknown)
            {
                Vendor::Anthropic => {
                    let anthropic_client = anthropic::AnthropicClient::new(&db)
                        .await
                        .context("load default OCR client for vendor Anthropic")?;
                    Ok(Some(Box::new(anthropic_client)))
                }
                Vendor::GoogleGemini => {
                    let googlegemini_client = googlegemini::GoogleGeminiClient::new(&db)
                        .await
                        .context("load default OCR client for vendor GoogleGemini")?;
                    Ok(Some(Box::new(googlegemini_client)))
                }
                Vendor::OpenAI => {
                    let openai_client = openai::OpenAIClient::new(&db)
                        .await
                        .context("load default OCR client for vendor OpenAI")?;
                    Ok(Some(Box::new(openai_client)))
                }
                _ => Err(anyhow!(
                    "configured OCR model `{}` maps to unsupported vendor",
                    model_id
                ))
                .context("load default OCR client"),
            }
        }
        Err(e) => Err(e).context("load default OCR client: read `ocrModel` from config"),
        _ => Ok(None),
    }
}
