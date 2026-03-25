use anyhow::{anyhow, Context, Error, Result};
use enigo::{Enigo, Mouse, Settings};
use std::io::Cursor;
use xcap::{image, Monitor};

use global_hotkey::{hotkey::HotKey, GlobalHotKeyEvent};
use std::sync::mpsc;
use tauri::{AppHandle, Manager};
use tauri_plugin_global_shortcut::GlobalShortcutExt;
use tauri_plugin_global_shortcut::ShortcutState;
use tokio::sync::Mutex;

use crate::{
    config::impl_read_config_from_store,
    util::selected_context::SelectedImage,
    util::window::{show_popup_window, PopupWindowType},
};

pub struct OcrShortcutHandle {
    hotkey: HotKey,
}

impl OcrShortcutHandle {
    pub fn new(app: &AppHandle) -> anyhow::Result<Self> {
        let hotkey_str = impl_read_config_from_store(app, "ocrShortcut").map_or_else(
            |err| {
                log::error!("{:#}", err);
                "ctrl+shift+o".to_string()
            },
            |opt| opt.unwrap_or("ctrl+shift+o".to_string()),
        );
        let hotkey = super::string_to_tauri_hotkey(hotkey_str.as_str())
            .context("initialize OCR shortcut handle: parse configured hotkey")?;
        app.global_shortcut()
            .register(hotkey)
            .context("initialize OCR shortcut handle: register global hotkey")?;
        Ok(Self { hotkey })
    }
}

impl super::ShortcutHandle for OcrShortcutHandle {
    fn get_hotkey(&self) -> &HotKey {
        &self.hotkey
    }

    fn set_hotkey_from_str(&mut self, app: &AppHandle, hotkey_str: &str) -> anyhow::Result<()> {
        super::assign_new_hotkey(app, hotkey_str, &mut self.hotkey, "ocrShortcut")
            .context("update OCR shortcut hotkey")
    }

    fn callback(&self, app: &AppHandle, event: GlobalHotKeyEvent) {
        if event.state() != ShortcutState::Released {
            return;
        }

        let app_clone = app.clone();

        tauri::async_runtime::spawn(async move {
            let (tx, rx) = mpsc::channel::<Result<(Vec<u8>, f64, f64)>>();
            if let Err(e) = app_clone.run_on_main_thread(move || {
                let result = capture_monitor_with_mouse_and_get_dimensions();
                if let Err(e) = tx.send(result) {
                    log::error!(
                        "{:#}",
                        Error::from(e)
                            .context("dispatch captured screenshot data from main thread")
                            .context("handle OCR shortcut callback")
                    );
                }
            }) {
                log::error!(
                    "{:#}",
                    Error::from(e)
                        .context("run OCR capture on main thread")
                        .context("handle OCR shortcut callback")
                );
            }

            let (screenshot_bin, monitor_width_logical, monitor_height_logical) = match rx
                .recv()
                .map_err(Error::from)
            {
                Ok(res) => match res {
                    Ok(val) => val,
                    Err(e) => {
                        log::error!("{:#}", e.context("capture monitor image for OCR shortcut"));
                        return;
                    }
                },
                Err(e) => {
                    log::error!(
                        "{:#}",
                        e.context("receive OCR capture result from main thread")
                    );
                    return;
                }
            };

            let state = match app_clone
                .try_state::<Mutex<SelectedImage>>()
                .ok_or(anyhow!("missing tauri state: SelectedImage"))
            {
                Ok(state) => state,
                Err(e) => {
                    log::error!(
                        "{:#}",
                        e.context("store captured screenshot for OCR popup initialization")
                    );
                    return;
                }
            };
            let mut guard = state.lock().await;
            guard.bin = screenshot_bin.clone();

            if let Err(e) = show_popup_window(
                &app_clone,
                PopupWindowType::OCR,
                monitor_width_logical * 0.5,
                monitor_height_logical * 0.5,
                None,
            ) {
                log::error!("{:#}", e.context("show OCR popup window after capture"));
            }
        });
    }
}

fn capture_monitor_with_mouse_and_get_dimensions() -> Result<(Vec<u8>, f64, f64)> {
    let enigo = Enigo::new(&Settings::default())?;
    let (mouse_x, mouse_y) = enigo.location()?;

    let monitors = Monitor::all()?;

    let target_monitor = monitors
        .into_iter()
        .find(|monitor| {
            let mx: i32 = match monitor.x() {
                Ok(val) => val,
                Err(_) => return false,
            };

            let my: i32 = match monitor.y() {
                Ok(val) => val,
                Err(_) => return false,
            };

            let mw: i32 = match monitor.width() {
                Ok(val) => val as i32,
                Err(_) => return false,
            };

            let mh: i32 = match monitor.height() {
                Ok(val) => val as i32,
                Err(_) => return false,
            };
            mouse_x >= mx && mouse_x < mx + mw && mouse_y >= my && mouse_y < my + mh
        })
        .or_else(|| {
            Monitor::all()
                .ok()?
                .into_iter()
                .find(|m| m.is_primary().unwrap_or(false))
        })
        .or_else(|| Monitor::all().ok()?.into_iter().next())
        .ok_or_else(|| {
            anyhow!("failed to find a monitor for current mouse position")
                .context("capture monitor image for OCR shortcut")
        })?;

    let scale = target_monitor
        .scale_factor()
        .context("read monitor scale factor for OCR capture")? as f64;

    let screenshot = target_monitor
        .capture_image()
        .context("capture monitor image for OCR shortcut")?;

    let monitor_width_logical = screenshot.width() as f64 / scale;
    let monitor_height_logical = screenshot.height() as f64 / scale;

    let mut buffer = Cursor::new(Vec::new());
    screenshot
        .write_to(&mut buffer, image::ImageFormat::Png)
        .context("encode captured monitor image as PNG for OCR shortcut")?;

    Ok((
        buffer.into_inner(),
        monitor_width_logical,
        monitor_height_logical,
    ))
}
