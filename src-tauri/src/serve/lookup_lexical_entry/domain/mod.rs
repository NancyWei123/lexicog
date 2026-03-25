mod prompt_template;
mod top50_representative_entries_data;

use crate::{
    ai_client::ClientHub,
    config::{constant::MODELS, TargetLangOfLexicalEntryLookup, TextToTextModel},
    db::SqliteInterface,
    util::datetime::utc_now_string,
};
use anyhow::{anyhow, Error};
use tauri::ipc::Channel;
use tokio::sync::RwLock;
use top50_representative_entries_data::Top50RepresentativeEntriesResponse;

#[derive(sqlx::FromRow)]
struct CachedEntries {
    model_id: String,
    list: String,
    message: String,
}

#[tauri::command]
pub async fn get_unique_disciplines_of_lexical_entries(
    db: tauri::State<'_, SqliteInterface>,
    target_lang_state: tauri::State<'_, RwLock<TargetLangOfLexicalEntryLookup>>,
    source_language: String,
) -> Result<Vec<String>, String> {
    let target_language = target_lang_state
        .read()
        .await
        .lang
        .clone()
        .unwrap_or_default();
    sqlx::query_scalar::<_, String>(
        r#"
        SELECT DISTINCT json_extract(entry.value, '$.discipline') AS discipline
        FROM lexical_entries,
             json_each(json_extract(analysis, '$.entries')) AS entry
        WHERE source_language = ?
          AND target_language = ?
          AND json_extract(entry.value, '$.discipline') IS NOT NULL
          AND json_extract(entry.value, '$.discipline') != ''
        ORDER BY discipline
        "#,
    )
    .bind(source_language)
    .bind(target_language)
    .fetch_all(db.pool())
    .await
    .map_err(|e| {
        format!(
            "{:#}",
            Error::from(e).context("get unique disciplines from lookup history")
        )
    })
}

#[tauri::command]
pub async fn serve_representative_entries_by_discipline(
    channel: Channel<Option<String>>,
    db: tauri::State<'_, SqliteInterface>,
    client_hub_state: tauri::State<'_, RwLock<ClientHub>>,
    ttt_model_state: tauri::State<'_, RwLock<TextToTextModel>>,
    source_lang: String,
    discipline: String,
    target_lang_state: tauri::State<'_, RwLock<TargetLangOfLexicalEntryLookup>>,
) -> Result<Top50RepresentativeEntriesResponse, String> {
    let model_id = ttt_model_state.read().await.id.clone().ok_or(format!(
        "{:#}",
        anyhow!("no text-to-text model is currently configured")
            .context("serve representative entries by discipline: resolve active model")
    ))?;

    let target_language = target_lang_state
        .read()
        .await
        .lang
        .clone()
        .unwrap_or_default();

    let current_capability = MODELS.get(&model_id).map(|m| m.capability).unwrap_or(0);

    let cached = sqlx::query_as::<_, CachedEntries>(
        r#"
        SELECT model_id, list, message
        FROM representative_entries
        WHERE source_language = ?1 AND discipline = ?2
        "#,
    )
    .bind(&source_lang)
    .bind(&discipline)
    .fetch_optional(db.pool())
    .await
    .map_err(|e| {
        format!(
            "{:#}",
            Error::from(e)
                .context("serve representative entries by discipline: query entries cache")
        )
    })?;

    if let Some(record) = &cached {
        let cached_capability = MODELS
            .get(&record.model_id)
            .map(|m| m.capability)
            .unwrap_or(0);

        if cached_capability >= current_capability {
            let lexical_entries: Vec<String> = serde_json::from_str(&record.list).map_err(|e| {
                format!(
                    "{:#}",
                    anyhow!("{}", e)
                        .context("serve representative entries by discipline: parse entries cache")
                )
            })?;
            let message = record.message.clone();

            let response = Top50RepresentativeEntriesResponse {
                lexical_entries,
                message,
            };
            return Ok(response);
        }
    }

    let system_prompt = prompt_template::TOP50_REPRESENTATIVE_ENTRIES_SYSTEM_PROMPT.to_string();
    let user_prompt = prompt_template::TOP50_REPRESENTATIVE_ENTRIES_USER_PROMPT_TEMPLATE
        .replace("{{DISCIPLINE}}", &discipline)
        .replace("{{SOURCE_LANGUAGE}}", &source_lang)
        .replace("{{TARGET_LANGUAGE}}", &target_language);

    let result = {
        let client_hub_guard = client_hub_state.read().await;
        if let Some(client) = &client_hub_guard.ttt_client {
            client
                .execute_streaming_text_to_text_task(
                    channel,
                    system_prompt,
                    user_prompt,
                    Some(top50_representative_entries_data::Top50RepresentativeEntriesResponse::json_schema()),
                    None,
                    model_id.clone(),
                )
                .await
                .map_err(|e| {
                    format!(
                        "{:#}",
                        e.context(
                            "serve representative entries by discipline: execute streaming text-to-text task"
                        )
                    )
                })?
        } else {
            return Err(format!(
                "{:#}",
                anyhow!("no text-to-text client is available in ClientHub")
                    .context("serve representative entries by discipline")
            ));
        }
    };

    match top50_representative_entries_data::Top50RepresentativeEntriesResponse::from_json_str(
        &result.text,
    ) {
        Ok(parsed) => {
            let serialized_vec =
                serde_json::to_string(&parsed.lexical_entries).unwrap_or(result.text);
            let now_str = utc_now_string();
            sqlx::query(
                r#"
                INSERT INTO representative_entries (model_id, discipline, source_language, list, updated_at, message)
                VALUES (?1, ?2, ?3, ?4, ?5, ?6)
                ON CONFLICT (source_language, discipline)
                DO UPDATE SET model_id = ?1, list = ?4, updated_at = ?5, message = ?6
                "#,
            )
            .bind(&model_id)
            .bind(&discipline)
            .bind(&source_lang)
            .bind(&serialized_vec)
            .bind(&now_str)
            .bind(&parsed.message)
            .execute(db.pool())
            .await
            .map_err(|e| {
                format!(
                    "{:#}",
                    Error::from(e)
                        .context("serve representative entries by discipline: upsert entries cache")
                )
            })?;
            Ok(parsed)
        }
        Err(e) => Err(format!(
            "{:#}",
            e.context("serve representative entries by discipline: parse freshly received entries")
        )),
    }
}
