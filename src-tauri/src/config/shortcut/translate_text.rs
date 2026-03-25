use super::ShortcutHandle;
use crate::{
    config::impl_read_config_from_store,
    util::selected_context::get_selected_text,
    util::window::{show_popup_window, PopupWindowType},
};
use anyhow::{anyhow, Context, Error, Result};
use global_hotkey::{hotkey::HotKey, GlobalHotKeyEvent, HotKeyState};
use std::sync::RwLock;
use tauri::{AppHandle, Manager};
use tauri_plugin_global_shortcut::GlobalShortcutExt;
use tauri_plugin_global_shortcut::ShortcutState;
use tokio::time::{timeout, Duration};

pub struct TranslateTextShortcutHandle {
    hotkey: HotKey,
}

impl TranslateTextShortcutHandle {
    pub fn new(app: &AppHandle) -> Result<Self> {
        let hotkey_str = impl_read_config_from_store(app, "translateTextShortcut").map_or_else(
            |err| {
                log::error!("{:#}", err);
                "ctrl+shift+t".to_string()
            },
            |opt| opt.unwrap_or("ctrl+shift+t".to_string()),
        );
        let hotkey = super::string_to_tauri_hotkey(hotkey_str.as_str())
            .context("initialize translate-text shortcut handle: parse configured hotkey")?;
        app.global_shortcut()
            .register(hotkey)
            .context("initialize translate-text shortcut handle: register global hotkey")?;
        Ok(Self { hotkey })
    }
}

impl super::ShortcutHandle for TranslateTextShortcutHandle {
    fn get_hotkey(&self) -> &HotKey {
        &self.hotkey
    }

    fn set_hotkey_from_str(&mut self, app: &AppHandle, hotkey_str: &str) -> Result<()> {
        super::assign_new_hotkey(app, hotkey_str, &mut self.hotkey, "translateTextShortcut")
            .context("update translate-text shortcut hotkey")
    }

    fn callback(&self, app: &AppHandle, event: GlobalHotKeyEvent) {
        if event.state() != ShortcutState::Released {
            return;
        }

        let app_clone = app.clone();

        tauri::async_runtime::spawn(async move {
            if let Err(e) = timeout(Duration::from_millis(200), get_selected_text(&app_clone)).await
            {
                log::error!(
                    "{:#}",
                    Error::from(e)
                        .context("capture selected text before triggering translation popup")
                );
                return;
            }

            if let Err(e) = show_popup_window(
                &app_clone,
                PopupWindowType::TranslateText,
                480.0,
                360.0,
                None,
            ) {
                log::error!(
                    "{:#}",
                    e.context("show translation popup window after shortcut trigger")
                );
            }
        });
    }
}

#[tauri::command]
pub fn mimic_trigger_translate_text(app: AppHandle) -> Result<(), String> {
    let state = app
        .try_state::<RwLock<TranslateTextShortcutHandle>>()
        .ok_or(format!(
            "{:#}",
            anyhow!("missing shortcut handle state: TranslateTextShortcutHandle")
                .context("mimic trigger translate text")
        ))?;
    let guard = state.read().map_err(|e| {
        format!(
            "{:#}",
            anyhow!("{}", e).context("acquire read lock for TranslateTextShortcutHandle")
        )
    })?;
    guard.callback(
        &app,
        GlobalHotKeyEvent {
            id: 0,
            state: HotKeyState::Released,
        },
    );
    Ok(())
}
