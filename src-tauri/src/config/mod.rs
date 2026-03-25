pub mod constant;
pub mod shortcut;

use crate::{ai_client::ClientHub, api::impl_get_vendor_api, db::SqliteInterface};
use anyhow::{anyhow, Context, Result};
use tauri::AppHandle;
use tauri_plugin_store::StoreExt;
use tokio::sync::RwLock;

pub struct TextToTextModel {
    pub id: Option<String>,
}

pub struct TextToSpeechModel {
    pub id: Option<String>,
}

pub struct OcrModel {
    pub id: Option<String>,
}

pub struct TargetLangOfLexicalEntryLookup {
    pub lang: Option<String>,
}

pub struct TargetLangOfTranslation {
    pub lang: Option<String>,
}

#[tauri::command]
pub async fn reset_ttt_model(
    app: AppHandle,
    db: tauri::State<'_, SqliteInterface>,
    ttt_model_state: tauri::State<'_, RwLock<TextToTextModel>>,
    client_hub_state: tauri::State<'_, RwLock<ClientHub>>,
    model_id: String,
) -> Result<(), String> {
    let attr = constant::MODELS.get(&model_id).ok_or(format!(
        "{:#}",
        anyhow!("invalid text-to-text model id: {}", model_id).context("reset text-to-text model")
    ))?;
    if !attr.support_text_to_text {
        return Err(format!(
            "{:#}",
            anyhow!("model {} does not support text-to-text tasks", model_id)
                .context("reset text-to-text model")
        ));
    }

    match impl_get_vendor_api(&db, attr.vendor.to_string().as_str()).await {
        Ok(Some(_)) => {}
        Ok(None) => {
            return Err(format!(
                "{:#}",
                anyhow!("no API credentials configured for vendor {}", attr.vendor)
                    .context("reset text-to-text model")
            ));
        }
        Err(e) => {
            return Err(format!(
                "{:#}",
                e.context("reset text-to-text model: verify vendor credentials")
            ));
        }
    }

    {
        let mut ttt_model_guard = ttt_model_state.write().await;
        ttt_model_guard.id = Some(model_id.clone());
    }

    {
        let mut client_hub_guard = client_hub_state.write().await;
        if client_hub_guard.get_ttt_client_vendor() != Some(attr.vendor.clone()) {
            client_hub_guard
                .reload_ttt_client(&db, attr.vendor.clone())
                .await
                .map_err(|e| {
                    format!(
                        "{:#}",
                        e.context("reset text-to-text model: reload client for selected vendor")
                    )
                })?;
        }
    }

    let config_store = app.store("app_config.json").map_err(|e| {
        format!(
            "{:#}",
            anyhow!("{}", e).context("reset text-to-text model: open app_config.json")
        )
    })?;
    config_store.set("textToTextModel", model_id);

    Ok(())
}

#[tauri::command]
pub async fn reset_tts_model(
    app: AppHandle,
    db: tauri::State<'_, SqliteInterface>,
    tts_model_state: tauri::State<'_, RwLock<TextToSpeechModel>>,
    client_hub_state: tauri::State<'_, RwLock<ClientHub>>,
    model_id: String,
) -> Result<(), String> {
    let attr = constant::MODELS.get(&model_id).ok_or(format!(
        "{:#}",
        anyhow!("invalid text-to-speech model id: {}", model_id)
            .context("reset text-to-speech model")
    ))?;
    if !attr.support_text_to_speech {
        return Err(format!(
            "{:#}",
            anyhow!("model {} does not support text-to-speech tasks", model_id)
                .context("reset text-to-speech model")
        ));
    }

    match impl_get_vendor_api(&db, attr.vendor.to_string().as_str()).await {
        Ok(Some(_)) => {}
        Ok(None) => {
            return Err(format!(
                "{:#}",
                anyhow!("no API credentials configured for vendor {}", attr.vendor)
                    .context("reset text-to-speech model")
            ));
        }
        Err(e) => {
            return Err(format!(
                "{:#}",
                e.context("reset text-to-speech model: verify vendor credentials")
            ));
        }
    }

    {
        let mut tts_model_guard = tts_model_state.write().await;
        tts_model_guard.id = Some(model_id.clone());
    }

    {
        let mut client_hub_guard = client_hub_state.write().await;
        if client_hub_guard.get_tts_client_vendor() != Some(attr.vendor.clone()) {
            client_hub_guard
                .reload_tts_client(&db, attr.vendor.clone())
                .await
                .map_err(|e| {
                    format!(
                        "{:#}",
                        e.context("reset text-to-speech model: reload client for selected vendor")
                    )
                })?;
        }
    }

    let config_store = app.store("app_config.json").map_err(|e| {
        format!(
            "{:#}",
            anyhow!("{}", e).context("reset text-to-speech model: open app_config.json")
        )
    })?;
    config_store.set("textToSpeechModel", model_id);

    Ok(())
}

#[tauri::command]
pub async fn reset_ocr_model(
    app: AppHandle,
    db: tauri::State<'_, SqliteInterface>,
    ocr_model_state: tauri::State<'_, RwLock<OcrModel>>,
    client_hub_state: tauri::State<'_, RwLock<ClientHub>>,
    model_id: String,
) -> Result<(), String> {
    let attr = constant::MODELS.get(&model_id).ok_or(format!(
        "{:#}",
        anyhow!("invalid OCR model id: {}", model_id).context("reset OCR model")
    ))?;
    if !attr.support_image_to_text {
        return Err(format!(
            "{:#}",
            anyhow!(
                "model {} does not support image-to-text (OCR) tasks",
                model_id
            )
            .context("reset OCR model")
        ));
    }
    match impl_get_vendor_api(&db, attr.vendor.to_string().as_str()).await {
        Ok(Some(_)) => {}
        Ok(None) => {
            return Err(format!(
                "{:#}",
                anyhow!("no API credentials configured for vendor {}", attr.vendor)
                    .context("reset OCR model")
            ));
        }
        Err(e) => {
            return Err(format!(
                "{:#}",
                e.context("reset OCR model: verify vendor credentials")
            ));
        }
    }

    {
        let mut ocr_model_guard = ocr_model_state.write().await;
        ocr_model_guard.id = Some(model_id.clone());
    }

    {
        let mut client_hub_guard = client_hub_state.write().await;
        if client_hub_guard.get_ocr_client_vendor() != Some(attr.vendor.clone()) {
            client_hub_guard
                .reload_ocr_client(&db, attr.vendor.clone())
                .await
                .map_err(|e| {
                    format!(
                        "{:#}",
                        e.context("reset OCR model: reload client for selected vendor")
                    )
                })?;
        }
    }

    let config_store = app.store("app_config.json").map_err(|e| {
        format!(
            "{:#}",
            anyhow!("{}", e).context("reset OCR model: open app_config.json")
        )
    })?;
    config_store.set("ocrModel", model_id);

    Ok(())
}

#[tauri::command]
pub async fn reset_target_lang_of_lexical_entry_lookup(
    app: AppHandle,
    target_lang_state: tauri::State<'_, RwLock<TargetLangOfLexicalEntryLookup>>,
    lang: String,
) -> Result<(), String> {
    {
        let mut guard = target_lang_state.write().await;
        guard.lang = Some(lang.clone());
    }

    let config_store = app.store("app_config.json").map_err(|e| {
        format!(
            "{:#}",
            anyhow!("{}", e)
                .context("reset target language of lexical-entry lookup: open app_config.json")
        )
    })?;
    config_store.set("targetLangOfLexicalEntryLookup", lang);

    Ok(())
}

#[tauri::command]
pub async fn reset_target_lang_of_translation(
    app: AppHandle,
    target_lang_state: tauri::State<'_, RwLock<TargetLangOfTranslation>>,
    lang: String,
) -> Result<(), String> {
    {
        let mut guard = target_lang_state.write().await;
        guard.lang = Some(lang.clone());
    }

    let config_store = app.store("app_config.json").map_err(|e| {
        format!(
            "{:#}",
            anyhow!("{}", e).context("reset target language of translation: open app_config.json")
        )
    })?;
    config_store.set("targetLangOfTranslation", lang);

    Ok(())
}

#[tauri::command]
pub fn read_config_from_store(app: AppHandle, entry: String) -> Result<Option<String>, String> {
    impl_read_config_from_store(&app, &entry).map_err(|e| format!("{:#}", e))
}

pub fn impl_read_config_from_store(app: &AppHandle, entry: &str) -> Result<Option<String>> {
    match app.store("app_config.json") {
        Ok(config_store) => {
            if let Some(json_obj) = config_store.get(entry) {
                Ok(Some(
                    json_obj
                        .as_str()
                        .ok_or(anyhow!(
                            "the value of storage entry {} is not Value::String",
                            entry
                        ))
                        .context("read config from store: convert JSON value to string")?
                        .to_string(),
                ))
            } else {
                Ok(None)
            }
        }
        Err(e) => Err(anyhow!("{}", e)).context("read config from store: open app_config.json"),
    }
}
