mod prompt_template;
mod session_data;
mod sm2;

use crate::{
    ai_client::ClientHub,
    config::{TargetLangOfLexicalEntryLookup, TextToTextModel},
    db::SqliteInterface,
    util::{
        datetime::{format_utc_timestamp, parse_stored_utc_timestamp},
        window::PendingCancelSignals,
    },
};
use anyhow::{anyhow, Context, Error, Result};
use chrono::{Duration, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use strsim::levenshtein;
use tauri::{ipc::Channel, AppHandle, Emitter};
use tokio::sync::{Mutex, RwLock};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewProgress {
    pub pending_for_new_sessions: bool,
    pub sessions: Vec<session_data::Session>,
    pub review_date: String,
    pub cursor: Option<CursorOfBlank>,
    pub remaining_entries: HashMap<String, i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CursorOfBlank {
    pub session_index: usize,
    pub message_index: usize,
    pub part_index: usize,
}

impl ReviewProgress {
    pub fn new() -> Result<Self> {
        let now = Utc::now();
        let yesterday =
            now - Duration::try_days(1).ok_or(anyhow!("failed to create duration of 1 day"))?;

        Ok(Self {
            pending_for_new_sessions: true,
            sessions: Vec::new(),
            review_date: format_utc_timestamp(yesterday),
            cursor: None,
            remaining_entries: HashMap::new(),
        })
    }
}

#[tauri::command]
pub async fn serve_session(
    app: AppHandle,
    db: tauri::State<'_, SqliteInterface>,
    client_hub_state: tauri::State<'_, RwLock<ClientHub>>,
    source_language: String,
    review_progresses: tauri::State<'_, Mutex<HashMap<String, ReviewProgress>>>,
    target_lang: tauri::State<'_, RwLock<TargetLangOfLexicalEntryLookup>>,
    ttt_model_state: tauri::State<'_, RwLock<TextToTextModel>>,
    channel: Channel<Option<String>>,
    pending_cancel_signals_state: tauri::State<'_, Mutex<PendingCancelSignals>>,
) -> Result<Option<(session_data::Session, usize, usize)>, String> {
    impl_serve_session(
        app,
        db,
        client_hub_state,
        source_language,
        review_progresses,
        target_lang,
        ttt_model_state,
        channel,
        pending_cancel_signals_state,
    )
    .await
    .map_err(|e| format!("{:#}", e.context("serve review session")))
}

pub async fn impl_serve_session(
    app: AppHandle,
    db: tauri::State<'_, SqliteInterface>,
    client_hub_state: tauri::State<'_, RwLock<ClientHub>>,
    source_language: String,
    review_progresses: tauri::State<'_, Mutex<HashMap<String, ReviewProgress>>>,
    target_lang: tauri::State<'_, RwLock<TargetLangOfLexicalEntryLookup>>,
    ttt_model_state: tauri::State<'_, RwLock<TextToTextModel>>,
    channel: Channel<Option<String>>,
    pending_cancel_signals_state: tauri::State<'_, Mutex<PendingCancelSignals>>,
) -> Result<Option<(session_data::Session, usize, usize)>> {
    let mut guard = review_progresses.lock().await;
    let progress = guard
        .entry(source_language.to_string())
        .or_insert(ReviewProgress::new()?);
    let parsed_date = parse_stored_utc_timestamp(&progress.review_date)
        .map_err(|e| anyhow!("{:#}", e).context("failed to parse date of review progress"))?;
    let target_language = target_lang.read().await.lang.clone().ok_or_else(|| {
        anyhow!("target language for lexical entry lookup is not configured")
            .context("serve review session")
    })?;
    let model_id = ttt_model_state.read().await.id.clone().ok_or(
        anyhow!("no text-to-text model is currently configured").context("serve review session"),
    )?;

    let now_utc = Utc::now();

    if parsed_date.date_naive() != now_utc.date_naive() {
        let entries = fetch_due_review_entries(&db, &source_language, &target_language).await?;

        progress.pending_for_new_sessions = true;
        progress.review_date = format_utc_timestamp(now_utc);
        progress.sessions.clear();
        progress.cursor = None;
        progress.remaining_entries.clear();
        for (entry, id) in entries {
            progress.remaining_entries.insert(entry, id);
        }
    }

    if progress.remaining_entries.is_empty() {
        let entries = fetch_due_review_entries(&db, &source_language, &target_language).await?;
        if !entries.is_empty() {
            for (entry, id) in entries {
                progress.remaining_entries.insert(entry, id);
            }
            progress.pending_for_new_sessions = true;
        } else {
            return Ok(None);
        }
    }

    if progress.pending_for_new_sessions {
        let system_prompt = prompt_template::REVIEW_SESSION_SYSTEM_PROMPT.to_string();
        let user_prompt = prompt_template::REVIEW_SESSION_USER_PROMPT_TEMPLATE.replace(
            "{{LEXICAL ENTRIES}}",
            &progress
                .remaining_entries
                .keys()
                .take(16)
                .cloned()
                .collect::<Vec<_>>()
                .join(", "),
        );

        let task_id = Uuid::new_v4().to_string();
        let cancel_token = CancellationToken::new();
        {
            let mut pending_cancel_signals_guard = pending_cancel_signals_state.lock().await;
            pending_cancel_signals_guard.insert(task_id.clone(), cancel_token.clone());
        }
        app.emit("review-task-started", task_id.clone())
            .map_err(|e| {
                Error::from(e).context("serve review session: emit review-task-started event")
            })?;

        let result = tokio::select! {
            _ = cancel_token.cancelled() => {
                return Err(anyhow!("review session generation cancelled by user").context("serve review session"));
            }

            res = async move {
                let client_hub_guard = client_hub_state.read().await;
                if let Some(client) = &client_hub_guard.ttt_client {
                    let schema = session_data::ReviewSessions::json_schema();
                    let result = client
                        .execute_streaming_text_to_text_task(
                            channel,
                            system_prompt,
                            user_prompt,
                            Some(schema),
                            None,
                            model_id
                        )
                        .await
                        .context("serve review session: execute streaming text-to-text task")?;
                    Ok(result)
                } else {
                    Err(anyhow!("no text-to-text client is available in ClientHub")
                        .context("serve review session"))
                }
            } => res
        };

        {
            let mut pending_cancel_signals_guard = pending_cancel_signals_state.lock().await;
            pending_cancel_signals_guard.remove(&task_id);
        }

        let response = result?;

        let parse_result = session_data::ReviewSessions::from_json_str(&response.text)
            .map_err(|e| e.context("serve review session: parse structured session payload"))?;
        let session_index = progress.sessions.len();

        'outer: for (message_index, message) in parse_result.sessions[0].messages.iter().enumerate()
        {
            for (part_index, part) in message.content_parts.iter().enumerate() {
                if let session_data::ContentPart::Blank { .. } = part {
                    progress.cursor = Some(CursorOfBlank {
                        session_index,
                        message_index,
                        part_index,
                    });
                    progress.sessions.extend(parse_result.sessions);
                    progress.pending_for_new_sessions = false;
                    break 'outer;
                }
            }
        }
    }

    if let Some(cursor) = progress.cursor.clone() {
        let current_session = progress
            .sessions
            .get(cursor.session_index)
            .ok_or_else(|| anyhow!("no session available"))
            .context("serve review session: resolve current session by cursor")?;

        Ok(Some((
            current_session.clone(),
            cursor.message_index,
            cursor.part_index,
        )))
    } else {
        Err(anyhow!("review progress cursor is missing").context("serve review session"))
    }
}

#[tauri::command]
pub async fn update_review_state(
    db: tauri::State<'_, SqliteInterface>,
    review_progresses: tauri::State<'_, Mutex<HashMap<String, ReviewProgress>>>,
    source_language: String,
    user_input: String,
    time_taken_ms: Option<u64>,
) -> Result<(), String> {
    impl_update_review_state(
        &db,
        &review_progresses,
        &source_language,
        user_input,
        time_taken_ms,
    )
    .await
    .map_err(|e| format!("{:#}", e))
}

async fn impl_update_review_state(
    db: &SqliteInterface,
    review_progresses: &Mutex<HashMap<String, ReviewProgress>>,
    source_language: &str,
    user_input: String,
    time_taken_ms: Option<u64>,
) -> anyhow::Result<()> {
    let now = Utc::now();
    let now_str = format_utc_timestamp(now);

    let mut guard = review_progresses.lock().await;
    let progress = guard
        .get_mut(source_language)
        .ok_or_else(|| {
            anyhow!(
                "no review progress found for source language {}",
                source_language
            )
        })
        .context("update review state: load review progress from in-memory state")?;

    let cursor = progress
        .cursor
        .clone()
        .ok_or_else(|| anyhow!("review progress cursor is missing"))
        .context("update review state: resolve current blank cursor")?;

    if let Some(session_data::ContentPart::Blank {
        target_entry,
        perfect_match,
    }) = progress
        .sessions
        .get(cursor.session_index)
        .and_then(|session| session.messages.get(cursor.message_index))
        .and_then(|message| message.content_parts.get(cursor.part_index))
    {
        let entry_id = progress
            .remaining_entries
            .get(target_entry)
            .ok_or_else(|| anyhow!("entry id not found for entry {}", target_entry))
            .context("update review state: resolve lexical entry id for target entry")?;

        let (rep, ef, interval) = sqlx::query_as::<_, (i32, f64, i32)>(
            "SELECT repetition_count, easiness_factor, interval_days
            FROM lexical_entries WHERE id = ?",
        )
        .bind(entry_id)
        .fetch_one(db.pool())
        .await
        .context("fetch current SM-2 state")
        .context("update review state")?;

        let quality_score =
            calculate_review_quality(&user_input, perfect_match, time_taken_ms) as i32;

        let sm2 = sm2::calculate_sm2(rep, ef, interval, quality_score);

        sqlx::query(
            "UPDATE lexical_entries SET
                repetition_count = ?,
                easiness_factor = ?,
                interval_days = ?,
                next_review_at = ?,
                last_reviewed_at = ?,
                updated_at = ?
            WHERE normalized_format = ?",
        )
        .bind(sm2.repetition_count)
        .bind(sm2.easiness_factor)
        .bind(sm2.interval_days)
        .bind(&sm2.next_review_at)
        .bind(&now_str)
        .bind(&now_str)
        .bind(target_entry)
        .execute(db.pool())
        .await
        .context("update review state: persist updated SM-2 values")?;

        progress.remaining_entries.remove(target_entry);

        let new_cursor = next_blank_cursor(&progress.sessions, &cursor);
        let need_persist_session = if new_cursor.is_none() {
            progress.pending_for_new_sessions = !progress.remaining_entries.is_empty();
            true
        } else {
            cursor.session_index < new_cursor.clone().unwrap().session_index
        };
        progress.cursor = new_cursor;

        if need_persist_session {
            persist_review_session(
                db,
                &progress.review_date,
                &progress.sessions[cursor.session_index],
            )
            .await
            .context("update review state: persist completed review session")?
        }
        return Ok(());
    }

    Err(anyhow!("blank content is missing required fields").context("update review state"))
}

pub fn next_blank_cursor(
    sessions: &[session_data::Session],
    cur: &CursorOfBlank,
) -> Option<CursorOfBlank> {
    for (s_i, session) in sessions.iter().enumerate().skip(cur.session_index) {
        let m_start = if s_i == cur.session_index {
            cur.message_index
        } else {
            0
        };

        for (m_i, msg) in session.messages.iter().enumerate().skip(m_start) {
            let p_start = if s_i == cur.session_index && m_i == cur.message_index {
                cur.part_index.saturating_add(1)
            } else {
                0
            };

            for (p_i, part) in msg.content_parts.iter().enumerate().skip(p_start) {
                if matches!(part, session_data::ContentPart::Blank { .. }) {
                    return Some(CursorOfBlank {
                        session_index: s_i,
                        message_index: m_i,
                        part_index: p_i,
                    });
                }
            }
        }
    }

    None
}

async fn persist_review_session(
    db: &SqliteInterface,
    review_date: &str,
    session: &session_data::Session,
) -> Result<()> {
    sqlx::query(
        r#"
        INSERT INTO sessions(review_time, session)
        VALUES (?, ?)
        "#,
    )
    .bind(review_date)
    .bind(serde_json::to_string(session).context("serialize session data")?)
    .execute(db.pool())
    .await
    .context("persist review session: insert session row into database")?;
    Ok(())
}

async fn fetch_due_review_entries(
    db: &SqliteInterface,
    source_language: &str,
    target_language: &str,
) -> Result<Vec<(String, i64)>> {
    sqlx::query_as::<_, (String, i64)>(
        r#"
        SELECT normalized_format, id
        FROM lexical_entries
        WHERE is_marked = 1
            AND (next_review_at IS NULL OR datetime(next_review_at) <= datetime('now'))
            AND source_language = ?
            AND target_language = ?
        "#,
    )
    .bind(source_language)
    .bind(target_language)
    .fetch_all(db.pool())
    .await
    .map_err(|e| {
        Error::from(e).context("serve review session: fetch due lexical entries from database")
    })
}

/// Score a recall attempt on the SM-2 0-5 scale.
///
/// Only an exact normalized match counts as successful recall (`>= 3`), with
/// faster exact matches receiving higher scores.
pub fn calculate_review_quality(
    user_input: &str,
    perfect_match: &str,
    time_taken_ms: Option<u64>,
) -> u8 {
    let input = normalize_review_text(user_input);

    if input.is_empty() {
        return 0;
    }

    let perfect = normalize_review_text(perfect_match);

    if input == perfect {
        return match time_taken_ms.unwrap_or(0) {
            0..=10_000 => 5,
            10_001..=25_000 => 4,
            _ => 3,
        };
    }

    let perfect_len = perfect.chars().count();
    let input_len = input.chars().count();
    let threshold = adaptive_edit_distance_threshold(perfect_len);
    let dist = levenshtein(&input, &perfect);
    let max_len = perfect_len.max(input_len).max(1) as f64;
    let relative_distance = dist as f64 / max_len;

    if threshold > 0 && dist <= threshold && relative_distance <= 0.20 {
        return 2;
    }

    if threshold > 0 && dist <= threshold.saturating_mul(2) && relative_distance <= 0.34 {
        return 2;
    }

    1
}

fn normalize_review_text(text: &str) -> String {
    let canonical_punctuation = text
        .chars()
        .map(|ch| match ch {
            '\'' | '’' | '‘' | '＇' => '\'',
            '-' | '‐' | '‑' | '‒' | '–' | '—' | '－' => '-',
            _ => ch,
        })
        .collect::<String>();

    canonical_punctuation
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

fn adaptive_edit_distance_threshold(char_count: usize) -> usize {
    match char_count {
        0..=3 => 0,
        4..=8 => 1,
        _ => 2,
    }
}

#[tauri::command]
pub async fn get_review_history(
    db: tauri::State<'_, SqliteInterface>,
    limit: i64,
    offset: i64,
) -> Result<Vec<(session_data::Session, String)>, String> {
    let records = sqlx::query_as::<_, (String, String)>(
        r#"
        SELECT review_time, session
        FROM sessions
        ORDER BY id DESC
        LIMIT ? OFFSET ?
        "#,
    )
    .bind(limit)
    .bind(offset)
    .fetch_all(db.pool())
    .await
    .map_err(|e| {
        format!(
            "{:#}",
            Error::from(e).context("get review history: query sessions table")
        )
    })?;

    let mut results = Vec::<(session_data::Session, String)>::new();
    for (review_time, session_json) in records {
        let session =
            serde_json::from_str::<session_data::Session>(&session_json).map_err(|e| {
                format!(
                    "{:#}",
                    Error::from(e)
                        .context("deserialize session JSON from sessions table row")
                        .context("get review history")
                )
            })?;
        results.push((session, review_time));
    }

    Ok(results)
}

#[tauri::command]
pub async fn remove_review_session(
    db: tauri::State<'_, SqliteInterface>,
    review_time: String,
) -> Result<(), String> {
    let review_time = parse_stored_utc_timestamp(review_time.trim())
        .map(format_utc_timestamp)
        .map_err(|e| {
            format!(
                "{:#}",
                anyhow!("{:#}", e)
                    .context("parse `review_time` as canonical UTC timestamp")
                    .context("remove review session")
            )
        })?;

    sqlx::query(
        r#"
        DELETE FROM sessions
        WHERE review_time = ?
        "#,
    )
    .bind(review_time)
    .execute(db.pool())
    .await
    .map_err(|e| {
        format!(
            "{:#}",
            Error::from(e).context("remove review session: delete row from sessions table")
        )
    })?;

    Ok(())
}
