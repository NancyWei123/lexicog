pub mod domain;
mod entry_data;
mod prompt_template;

use crate::{
    ai_client::ClientHub,
    config::{TargetLangOfLexicalEntryLookup, TextToTextModel},
    db::SqliteInterface,
    util::{datetime::utc_now_string, selected_context::SelectedText},
};
use anyhow::{anyhow, Error, Result};
use tauri::ipc::Channel;
use tokio::sync::{Mutex, RwLock};

#[tauri::command]
pub async fn lookup_lexical_entry(
    channel: Channel<Option<String>>,
    client_hub_state: tauri::State<'_, RwLock<ClientHub>>,
    db: tauri::State<'_, SqliteInterface>,
    target_lang_state: tauri::State<'_, RwLock<TargetLangOfLexicalEntryLookup>>,
    selected_text_state: tauri::State<'_, Mutex<SelectedText>>,
    ttt_model_state: tauri::State<'_, RwLock<TextToTextModel>>,
    refresh: bool,
    lexical_entry: Option<String>,
) -> Result<bool, String> {
    let normalized_format: String;
    {
        let mut selected_text_guard = selected_text_state.lock().await;
        normalized_format = match lexical_entry {
            Some(le) => le.trim().to_lowercase(),
            None => selected_text_guard.text.trim().to_lowercase(),
        };
        selected_text_guard.text.clear();
    }

    if normalized_format.is_empty() {
        let _ = channel.send(None);
        return Err(format!(
            "{:#}",
            anyhow!("lookup input is empty after normalization").context("lookup lexical entry")
        ));
    }

    let target_language = target_lang_state
        .read()
        .await
        .lang
        .clone()
        .unwrap_or_default();
    let model_id = ttt_model_state.read().await.id.clone().ok_or(format!(
        "{:#}",
        anyhow!("no text-to-text model is currently configured")
            .context("lookup lexical entry: resolve active model")
    ))?;

    let mut is_marked = false;

    if let Ok(Some(result)) = sqlx::query_as::<_, (String, i64)>(
        r#"
		SELECT analysis, is_marked
		FROM lexical_entries
		WHERE normalized_format = ? AND target_language = ?
		"#,
    )
    .bind(&normalized_format)
    .bind(&target_language)
    .fetch_optional(db.pool())
    .await
    {
        is_marked = result.1 != 0;
        if !refresh {
            channel.send(Some(result.0)).map_err(|e| {
                format!(
                    "{:#}",
                    Error::from(e)
                        .context("lookup lexical entry: send cached lexical analysis to frontend")
                )
            })?;
            channel.send(None).map_err(|e| {
                format!(
                    "{:#}",
                    Error::from(e).context(
                        "lookup lexical entry: send completion signal for cached response"
                    )
                )
            })?;
            return Ok(is_marked);
        }
    };

    let system_prompt = prompt_template::LOOKUP_LEXICAL_ENTRY_SYSTEM_PROMPT.to_string();
    let user_prompt = prompt_template::LOOKUP_LEXICAL_ENTRY_USER_PROMPT_TEMPLATE
        .replace("{{INPUT_TEXT}}", &normalized_format)
        .replace("{{TARGET_LANGUAGE}}", &target_language);

    let analysis: String;
    {
        let client_hub_guard = client_hub_state.read().await;
        if let Some(client) = &client_hub_guard.ttt_client {
            let result = client
                .execute_streaming_text_to_text_task(
                    channel,
                    system_prompt,
                    user_prompt,
                    Some(entry_data::LexicalEntryResponse::json_schema()),
                    None,
                    model_id,
                )
                .await
                .map_err(|e| {
                    format!(
                        "{:#}",
                        e.context("lookup lexical entry: execute streaming text-to-text task")
                    )
                })?;
            analysis = result.text;
        } else {
            return Err(format!(
                "{:#}",
                anyhow!("no text-to-text client is available in ClientHub")
                    .context("lookup lexical entry")
            ));
        }
    }

    if analysis.is_empty() {
        return Err(format!(
            "{:#}",
            anyhow!("LLM returned an empty lexical-entry response").context("lookup lexical entry")
        ));
    }

    let parse_result = entry_data::LexicalEntryResponse::from_json_str(&analysis).map_err(|e| {
        format!(
            "{:#}",
            e.context("lookup lexical entry: parse lexical-entry JSON payload")
        )
    })?;

    let now_str = utc_now_string();

    if let Err(e) = sqlx::query(
        r#"
		INSERT INTO lexical_entries(
            normalized_format,
            source_language,
            target_language,
            analysis,
            created_at,
            updated_at
        )
		VALUES (?, ?, ?, ?, ?, ?)
		ON CONFLICT(normalized_format, target_language)
        DO UPDATE SET
            analysis = excluded.analysis,
            source_language = excluded.source_language,
            updated_at = excluded.updated_at
		"#,
    )
    .bind(&parse_result.normalized_format)
    .bind(&parse_result.source_language)
    .bind(&target_language)
    .bind(analysis)
    .bind(&now_str)
    .bind(&now_str)
    .execute(db.pool())
    .await
    {
        log::error!(
            "{:#}",
            anyhow!("{}", e).context("lookup lexical entry: persist lexical entry in database")
        );
    };

    Ok(is_marked)
}

#[tauri::command]
pub async fn mark_lexical_entry(
    db: tauri::State<'_, SqliteInterface>,
    target_lang_state: tauri::State<'_, RwLock<TargetLangOfLexicalEntryLookup>>,
    lexical_entry: String,
) -> Result<(), String> {
    let target_language = target_lang_state
        .read()
        .await
        .lang
        .clone()
        .unwrap_or_default();
    let normalized_format = lexical_entry.trim().to_lowercase();
    let now_str = utc_now_string();
    sqlx::query(
        r#"
		UPDATE lexical_entries
		SET is_marked = 1 - is_marked,
			marked_at = CASE WHEN is_marked = 0 THEN ?1 ELSE NULL END,
			next_review_at = CASE WHEN is_marked = 0 THEN ?1 ELSE next_review_at END,
            updated_at = ?1
		WHERE normalized_format = ?2 AND target_language = ?3
		"#,
    )
    .bind(&now_str)
    .bind(normalized_format)
    .bind(target_language)
    .execute(db.pool())
    .await
    .map_err(|e| {
        format!(
            "{:#}",
            Error::from(e).context("mark lexical entry: toggle mark state in database")
        )
    })?;

    Ok(())
}

#[tauri::command]
pub async fn remove_lexical_entry(
    db: tauri::State<'_, SqliteInterface>,
    target_lang_state: tauri::State<'_, RwLock<TargetLangOfLexicalEntryLookup>>,
    lexical_entry: String,
) -> Result<(), String> {
    let target_language = target_lang_state
        .read()
        .await
        .lang
        .clone()
        .unwrap_or_default();
    let normalized_format = lexical_entry.trim().to_lowercase();
    sqlx::query(
        r#"
		DELETE FROM lexical_entries
		WHERE normalized_format = ? AND target_language = ?
		"#,
    )
    .bind(normalized_format)
    .bind(target_language)
    .execute(db.pool())
    .await
    .map_err(|e| {
        format!(
            "{:#}",
            Error::from(e).context("remove lexical entry: delete record from database")
        )
    })?;

    Ok(())
}

#[tauri::command]
pub async fn get_lookup_history(
    db: tauri::State<'_, SqliteInterface>,
    prefix: String,
    target_lang_state: tauri::State<'_, RwLock<TargetLangOfLexicalEntryLookup>>,
    source_lang: Option<String>,
    domain: Option<String>,
    lemma: Option<String>,
) -> Result<Vec<(String, i64)>, String> {
    let discipline_like = domain.as_ref().map(|d| format!("%\"discipline\":\"{}%", d));
    let legacy_primary_code_like = domain
        .as_ref()
        .map(|d| format!("%\"primaryCode\":\"{}%", d));
    let lemma_like = lemma.map(|d| format!("%\"lemma\":\"{}%", d));
    let records = sqlx::query_as::<_, (String, i64)>(
        r#"
        SELECT normalized_format, MAX(is_marked) AS is_marked
        FROM lexical_entries
        WHERE normalized_format LIKE ?1
        AND (?2 IS NULL OR target_language = ?2)
        AND (?3 IS NULL OR source_language = ?3)
        AND (?4 IS NULL OR analysis LIKE ?4 OR analysis LIKE ?5)
        AND (?6 IS NULL OR analysis LIKE ?6)
        GROUP BY normalized_format
        ORDER BY MAX(datetime(marked_at)) DESC, MAX(datetime(created_at)) DESC
        "#,
    )
    .bind(&prefix)
    .bind(target_lang_state.read().await.lang.clone())
    .bind(&source_lang)
    .bind(&discipline_like)
    .bind(&legacy_primary_code_like)
    .bind(&lemma_like)
    .fetch_all(db.pool())
    .await
    .map_err(|e| {
        format!(
            "{:#}",
            Error::from(e).context("get lookup history: query lexical entries from database")
        )
    })?;

    Ok(records)
}

#[tauri::command]
pub async fn get_unique_source_languages_of_lexical_entries(
    db: tauri::State<'_, SqliteInterface>,
) -> Result<Vec<String>, String> {
    sqlx::query_scalar::<_, String>(
        r#"
		SELECT DISTINCT source_language
		FROM lexical_entries
		"#,
    )
    .fetch_all(db.pool())
    .await
    .map_err(|e| {
        format!(
            "{:#}",
            Error::from(e).context("get unique source languages of lexical entries")
        )
    })
}
