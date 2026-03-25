mod prompt_template;
mod translation_data;

use crate::{
    ai_client::ClientHub,
    config::{TargetLangOfLexicalEntryLookup, TargetLangOfTranslation, TextToTextModel},
    util::{
        selected_context::SelectedText,
        window::{PendingCancelSignals, PendingInputs},
    },
};
use anyhow::{anyhow, Error, Result};
use tauri::{ipc::Channel, AppHandle, Emitter};
use tokio::{
    sync::{oneshot, Mutex, RwLock},
    time::{self, Duration},
};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

#[tauri::command]
pub async fn serve_text_translation(
    app: AppHandle,
    channel: Channel<Option<String>>,
    client_hub_state: tauri::State<'_, RwLock<ClientHub>>,
    target_lang_of_translation_state: tauri::State<'_, RwLock<TargetLangOfTranslation>>,
    target_lang_of_lookup_state: tauri::State<'_, RwLock<TargetLangOfLexicalEntryLookup>>,
    selected_text_state: tauri::State<'_, Mutex<SelectedText>>,
    pending_inputs_state: tauri::State<'_, Mutex<PendingInputs>>,
    pending_cancel_signals_state: tauri::State<'_, Mutex<PendingCancelSignals>>,
    ttt_model_state: tauri::State<'_, RwLock<TextToTextModel>>,
    text: Option<String>,
) -> Result<String, String> {
    let input_text: String;
    {
        let mut selected_text_guard = selected_text_state.lock().await;
        input_text = match text {
            Some(t) => t,
            None => selected_text_guard.text.clone(),
        };
        selected_text_guard.text.clear();
    }

    if input_text.is_empty() {
        let _ = channel.send(None);
        return Ok(input_text);
    }

    let model_id = ttt_model_state.read().await.id.clone().ok_or(format!(
        "{:#}",
        anyhow!("no text-to-text model is currently configured")
            .context("serve text translation: resolve active model")
    ))?;

    let target_language_of_translation = match target_lang_of_translation_state
        .read()
        .await
        .lang
        .clone()
    {
        Some(lang) => lang,
        None => {
            let (tx, rx) = oneshot::channel::<String>();
            let request_id = Uuid::new_v4().to_string();
            {
                let mut pending_inputs_guard = pending_inputs_state.lock().await;
                pending_inputs_guard.insert(request_id.clone(), tx);
            }
            app.emit("request-target-language-of-translation", request_id.clone())
                .map_err(|e| {
                    format!(
                        "{:#}",
                        Error::from(e).context(
                            "serve text translation: emit target-language request event to frontend"
                        )
                    )
                })?;
            match time::timeout(Duration::from_secs(30), rx).await {
                Ok(Ok(lang)) => lang,
                Ok(Err(e)) => {
                    return Err(format!(
                        "{:#}",
                        Error::from(e).context(
                            "serve text translation: receive target language from pending input channel"
                        )
                    ))
                }
                Err(_) => {
                    {
                        let mut pending_inputs_guard = pending_inputs_state.lock().await;
                        pending_inputs_guard.remove(&request_id);
                    }
                    return Err(format!(
                        "{:#}",
                        anyhow!("timed out waiting for target language selection (30 seconds)")
                            .context("serve text translation: await target language")
                    ))
                }
            }
        }
    };
    let target_language_of_lookup = target_lang_of_lookup_state
        .read()
        .await
        .lang
        .clone()
        .unwrap_or_default();

    let explanation_language = if target_language_of_lookup.trim().is_empty() {
        "the same language as the source text".to_string()
    } else {
        target_language_of_lookup.clone()
    };

    let system_prompt = prompt_template::TEXT_TRANSLATION_SYSTEM_PROMPT
        .replace(
            "{{TARGET_LANGUAGE_OF_TRANSLATION}}",
            &target_language_of_translation,
        )
        .replace("{{TARGET_LANGUAGE_OF_LOOKUP}}", &target_language_of_lookup)
        .replace("{{EXPLANATION_LANGUAGE}}", &explanation_language);
    let user_prompt = prompt_template::TEXT_TRANSLATION_USER_PROMPT_TEMPLATE
        .replace(
            "{{TARGET_LANGUAGE_OF_TRANSLATION}}",
            &target_language_of_translation,
        )
        .replace("{{TARGET_LANGUAGE_OF_LOOKUP}}", &target_language_of_lookup)
        .replace("{{INPUT_TEXT}}", &input_text);

    let task_id = Uuid::new_v4().to_string();
    let cancel_token = CancellationToken::new();
    {
        let mut pending_cancel_signals_guard = pending_cancel_signals_state.lock().await;
        pending_cancel_signals_guard.insert(task_id.clone(), cancel_token.clone());
    }
    app.emit(
        "translation-task-started",
        (task_id.clone(), input_text.clone()),
    )
    .map_err(|e| {
        format!(
            "{:#}",
            Error::from(e).context("serve text translation: emit translation-task-started event")
        )
    })?;

    let result = tokio::select! {
        _ = cancel_token.cancelled() => {
            return Err(format!("{:#}", anyhow!("text translation generation cancelled by user").context("serve text translation")));
        }
        res = async move {
            let client_hub_guard = client_hub_state.read().await;
            if let Some(client) = &client_hub_guard.ttt_client {
                let response = client.execute_streaming_text_to_text_task(
                    channel,
                    system_prompt,
                    user_prompt,
                    Some(translation_data::TranslationResponse::json_schema()),
                    None,
                    model_id,
                ).await.map_err(|e|  {
                    format!(
                        "{:#}",
                        e.context("serve text translation: run streaming text-to-text task")
                    )
                })?;

                let _ = translation_data::TranslationResponse::from_json_str(&response.text)
                    .map_err(|e| {
                        format!(
                            "{:#}",
                            e.context("serve text translation: parse structured translation response")
                        )
                    })?;

                Ok(())
            } else {
                Err(format!(
                    "{:#}",
                    anyhow!("no text-to-text client is available in ClientHub")
                        .context("serve text translation")
                ))
            }
        } => res
    };

    let mut pending_cancel_signals_guard = pending_cancel_signals_state.lock().await;
    pending_cancel_signals_guard.remove(&task_id);

    result?;
    Ok(input_text)
}
