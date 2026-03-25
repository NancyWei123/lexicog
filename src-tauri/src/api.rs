use crate::{
    ai_client::ClientHub,
    config::{constant, OcrModel, TextToSpeechModel, TextToTextModel},
    db::SqliteInterface,
};
use anyhow::{anyhow, Context, Error, Result};
use tauri::AppHandle;
use tauri_plugin_store::StoreExt;
use tokio::sync::RwLock;

#[tauri::command]
pub async fn get_vendor_api(
    sqlite_interface: tauri::State<'_, SqliteInterface>,
    vendor: String,
) -> Result<Option<(String, String)>, String> {
    impl_get_vendor_api(&sqlite_interface, &vendor)
        .await
        .map_err(|e| format!("{:#}", e))
}

pub async fn impl_get_vendor_api(
    db: &SqliteInterface,
    vendor: &str,
) -> Result<Option<(String, String)>> {
    sqlx::query_as::<_, (String, String)>(
        r#"
		SELECT api_key, api_base_url
		FROM llm_vendors 
		WHERE vendor_name = ?
		"#,
    )
    .bind(vendor)
    .fetch_optional(db.pool())
    .await
    .context(format!(
        "fetch vendor API credentials from database (vendor: {})",
        vendor
    ))
}

#[tauri::command]
pub async fn set_vendor_api(
    db: tauri::State<'_, SqliteInterface>,
    client_hub_state: tauri::State<'_, RwLock<ClientHub>>,
    vendor: String,
    api_key: String,
    api_base_url: String,
) -> Result<(), String> {
    let vendor = vendor.parse::<constant::Vendor>().map_err(|e| {
        format!(
            "{:#}",
            e.context(format!(
                "set vendor API credentials: parse vendor identifier `{}`",
                vendor
            ))
        )
    })?;
    sqlx::query(
        r#"
		UPDATE llm_vendors 
		SET api_key = ?, api_base_url = ?
		WHERE vendor_name = ?
		"#,
    )
    .bind(&api_key)
    .bind(&api_base_url)
    .bind(vendor.to_string())
    .execute(db.pool())
    .await
    .map_err(|e| {
        format!(
            "{:#}",
            Error::from(e).context(format!(
                "set vendor API credentials: update database record (vendor: {})",
                vendor
            ))
        )
    })?;

    let mut client_hub_guard = client_hub_state.write().await;

    if client_hub_guard.get_ttt_client_vendor() == Some(vendor.clone()) {
        client_hub_guard
            .reload_ttt_client(&db, vendor.clone())
            .await
            .map_err(|e| {
                format!(
                    "{:#}",
                    e.context(format!(
                        "set vendor API credentials: reload text-to-text client (vendor: {})",
                        vendor
                    ))
                )
            })?;
    }

    if client_hub_guard.get_tts_client_vendor() == Some(vendor.clone()) {
        client_hub_guard
            .reload_tts_client(&db, vendor.clone())
            .await
            .map_err(|e| {
                format!(
                    "{:#}",
                    e.context(format!(
                        "set vendor API credentials: reload text-to-speech client (vendor: {})",
                        vendor
                    ))
                )
            })?;
    };

    if client_hub_guard.get_ocr_client_vendor() == Some(vendor.clone()) {
        client_hub_guard
            .reload_ocr_client(&db, vendor.clone())
            .await
            .map_err(|e| {
                format!(
                    "{:#}",
                    e.context(format!(
                        "set vendor API credentials: reload OCR client (vendor: {})",
                        vendor
                    ))
                )
            })?;
    };

    Ok(())
}

#[tauri::command]
pub async fn add_vendor_api(
    sqlite_interface: tauri::State<'_, SqliteInterface>,
    vendor: String,
    api_key: String,
    api_base_url: String,
) -> Result<(), String> {
    sqlx::query(
        r#"
		INSERT INTO llm_vendors (vendor_name, api_key, api_base_url) 
		VALUES (?, ?, ?)
		"#,
    )
    .bind(&vendor)
    .bind(&api_key)
    .bind(&api_base_url)
    .execute(sqlite_interface.pool())
    .await
    .map_err(|e| {
        format!(
            "{:#}",
            Error::from(e).context(format!(
                "add vendor API credentials: insert database record (vendor: {})",
                vendor
            ))
        )
    })?;
    Ok(())
}

#[tauri::command]
pub async fn remove_vendor(
    app: AppHandle,
    db: tauri::State<'_, SqliteInterface>,
    ttt_model_state: tauri::State<'_, RwLock<TextToTextModel>>,
    tts_model_state: tauri::State<'_, RwLock<TextToSpeechModel>>,
    ocr_model_state: tauri::State<'_, RwLock<OcrModel>>,
    client_hub_state: tauri::State<'_, RwLock<ClientHub>>,
    vendor: String,
) -> Result<(), String> {
    let vendor = vendor.parse::<constant::Vendor>().map_err(|e| {
        format!(
            "{:#}",
            e.context(format!(
                "remove vendor: parse vendor identifier `{}`",
                vendor
            ))
        )
    })?;

    sqlx::query(
        r#"
		DELETE FROM llm_vendors 
		WHERE vendor_name = ?
		"#,
    )
    .bind(vendor.to_string())
    .execute(db.pool())
    .await
    .map_err(|e| {
        format!(
            "{:#}",
            Error::from(e).context(format!(
                "remove vendor API credentials: delete database record (vendor: {})",
                vendor
            ))
        )
    })?;

    let mut client_hub_guard = client_hub_state.write().await;
    let config_store = app.store("app_config.json").map_err(|e| {
        format!(
            "{:#}",
            anyhow!("{}", e)
                .context("remove vendor: open app_config.json for model reset")
                .context(format!("remove vendor API credentials of {}", vendor))
        )
    })?;

    if client_hub_guard.get_ttt_client_vendor() == Some(vendor.clone()) {
        client_hub_guard
            .reload_ttt_client(&db, constant::Vendor::Unknown)
            .await
            .map_err(|e| {
                format!(
                    "{:#}",
                    e.context(format!(
                        "remove vendor: reload text-to-text client to Unknown (vendor: {})",
                        vendor
                    ))
                )
            })?;
        let mut ttt_model_guard = ttt_model_state.write().await;
        ttt_model_guard.id = None;
        config_store.delete("textToTextModel");
    }

    if client_hub_guard.get_tts_client_vendor() == Some(vendor.clone()) {
        client_hub_guard
            .reload_tts_client(&db, constant::Vendor::Unknown)
            .await
            .map_err(|e| {
                format!(
                    "{:#}",
                    e.context(format!(
                        "remove vendor: reload text-to-speech client to Unknown (vendor: {})",
                        vendor
                    ))
                )
            })?;
        let mut tts_model_guard = tts_model_state.write().await;
        tts_model_guard.id = None;
        config_store.delete("textToSpeechModel");
    };

    if client_hub_guard.get_ocr_client_vendor() == Some(vendor.clone()) {
        client_hub_guard
            .reload_ocr_client(&db, constant::Vendor::Unknown)
            .await
            .map_err(|e| {
                format!(
                    "{:#}",
                    e.context(format!(
                        "remove vendor: reload OCR client to Unknown (vendor: {})",
                        vendor
                    ))
                )
            })?;
        let mut ocr_model_guard = ocr_model_state.write().await;
        ocr_model_guard.id = None;
        config_store.delete("ocrModel");
    };

    Ok(())
}
