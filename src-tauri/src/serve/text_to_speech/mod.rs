use crate::{ai_client::ClientHub, config::TextToSpeechModel};
use anyhow::{anyhow, Error, Result};
use sha2::{Digest, Sha256};
use std::path::PathBuf;
use tauri::{ipc::Response, AppHandle, Manager};
use tokio::sync::RwLock;

#[tauri::command]
pub async fn serve_text_to_speech(
    app: AppHandle,
    client_hub_state: tauri::State<'_, RwLock<ClientHub>>,
    tts_model_state: tauri::State<'_, RwLock<TextToSpeechModel>>,
    persist: bool,
    text: String,
) -> Result<Response, String> {
    let normalized_text = text.trim().to_lowercase();
    let tts_model = tts_model_state.read().await.id.clone().ok_or(format!(
        "{:#}",
        anyhow!("no text-to-speech model is currently configured")
            .context("serve text-to-speech: resolve active model")
    ))?;
    let mut file_path = PathBuf::new();
    let mut tts_cache_dir = PathBuf::new();
    if persist {
        let mut hasher = Sha256::new();
        hasher.update(&normalized_text);
        let hash_hex = format!("{:x}", hasher.finalize());

        let app_data_path = app.path().app_local_data_dir().map_err(|e| {
            format!(
                "{:#}",
                Error::from(e).context("serve text-to-speech: resolve app local data directory")
            )
        })?;
        tts_cache_dir = app_data_path.join("tts_cache");
        file_path = tts_cache_dir.join(format!("{}.mp3", hash_hex));
        if file_path.exists() {
            let audio_bytes = tokio::fs::read(&file_path).await.map_err(|e| {
                format!(
                    "{:#}",
                    Error::from(e).context("serve text-to-speech: read cached audio file")
                )
            })?;

            return Ok(Response::new(audio_bytes));
        }
    }

    let audio_bytes: Vec<u8>;
    {
        let client_hub_guard = client_hub_state.read().await;
        if let Some(client) = &client_hub_guard.tts_client {
            audio_bytes = client
                .execute_text_to_speech_task(normalized_text, tts_model)
                .await
                .map_err(|e| {
                    format!(
                        "{:#}",
                        e.context("serve text-to-speech: execute vendor text-to-speech request")
                    )
                })?;
        } else {
            return Err(format!(
                "{:#}",
                anyhow!("no text-to-speech client is available in ClientHub")
                    .context("serve text-to-speech")
            ));
        }
    }

    if persist {
        if let Err(e) = tokio::fs::create_dir_all(&tts_cache_dir).await {
            log::error!(
                "{:#}",
                anyhow!("{}", e).context("serve text-to-speech: create cache directory")
            );
        } else if let Err(e) = tokio::fs::write(&file_path, &audio_bytes).await {
            log::error!(
                "{:#}",
                anyhow!("{}", e).context("serve text-to-speech: write cache audio file")
            );
        }
    }

    Ok(Response::new(audio_bytes))
}
