use anyhow::{anyhow, Context, Error, Result};
use enigo::{Enigo, Mouse, Settings};
use std::collections::HashMap;
use std::sync::mpsc;
use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Size};
use tokio::sync::{oneshot, Mutex};
use tokio_util::sync::CancellationToken;

#[cfg(not(target_os = "macos"))]
use tauri::{WebviewUrl, WebviewWindowBuilder};

#[cfg(target_os = "macos")]
use tauri::WebviewUrl;

#[cfg(target_os = "macos")]
use tauri_nspanel::{
    tauri_panel, CollectionBehavior, ManagerExt, PanelBuilder, PanelLevel, StyleMask,
    WebviewWindowExt,
};

#[cfg(target_os = "macos")]
tauri_panel! {
    panel!(LexicogPanel {
        config: {
            can_become_key_window: true,
            can_become_main_window: false,
            is_floating_panel: true,
        }
    })
}

pub type PendingInputs = HashMap<String, oneshot::Sender<String>>;
pub type PendingCancelSignals = HashMap<String, CancellationToken>;

#[tauri::command]
pub async fn deliver_single_message_from_window_to_backend(
    pending_inputs_state: tauri::State<'_, Mutex<PendingInputs>>,
    request_id: String,
    input: String,
) -> Result<(), String> {
    {
        let mut guard = pending_inputs_state.lock().await;
        let sender = guard.remove(&request_id).ok_or_else(|| {
            format!(
                "{:#}",
                anyhow!(
                    "no pending input request found for request_id `{}`",
                    request_id
                )
                .context("deliver single message from window to backend")
            )
        })?;
        sender.send(input).map_err(|e| {
            format!(
                "{:#}",
                anyhow!(e).context(
                    "deliver single message from window to backend: oneshot sender closed"
                )
            )
        })?;
    }
    Ok(())
}

#[tauri::command]
pub async fn deliver_cancel_signal_from_window_to_backend(
    pending_cancel_signals_state: tauri::State<'_, Mutex<PendingCancelSignals>>,
    task_id: String,
) -> Result<(), String> {
    {
        let mut guard = pending_cancel_signals_state.lock().await;
        let sender = guard.remove(&task_id).ok_or_else(|| {
            format!(
                "{:#}",
                anyhow!("no pending cancel token found for task_id `{}`", task_id)
                    .context("deliver cancel signal from window to backend")
            )
        })?;
        sender.cancel();
    }
    Ok(())
}

#[tauri::command]
pub fn hide_window(app: AppHandle, label: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let (tx, rx) = mpsc::channel::<Result<()>>();
        let app_clone = app.clone();
        app.run_on_main_thread(move || {
            let window = match app_clone.get_webview_window(&label) {
                Some(window) => window,
                None => {
                    let _ = tx.send(Err(
                        anyhow!("window `{}` not found", label).context("hide window on macOS")
                    ));
                    return;
                }
            };
            if let Err(e) = window.hide() {
                let _ = tx.send(Err(Error::from(e).context("hide window on macOS")));
                return;
            };
            let _ = tx.send(Ok(()));
        })
        .context("hide window on macOS: dispatch to main thread")
        .map_err(|e| format!("{:#}", e))?;
        rx.recv()
            .context("hide window on macOS: wait for main-thread completion")
            .map_err(|e| format!("{:#}", e))?
            .map_err(|e| format!("{:#}", e))?
    }
    #[cfg(not(target_os = "macos"))]
    {
        let window = app
            .get_webview_window(&label)
            .ok_or_else(|| anyhow!("window `{}` not found", label).context("hide window"))
            .map_err(|e| format!("{:#}", e))?;
        window
            .hide()
            .map_err(|e| format!("{:#}", Error::from(e).context("hide window")))?;
    }
    Ok(())
}

#[derive(Clone, Copy)]
pub enum PopupWindowType {
    LookUpLexicalEntry,
    TranslateText,
    OCR,
}

impl PopupWindowType {
    pub fn label(&self) -> &'static str {
        match self {
            PopupWindowType::LookUpLexicalEntry => "lookup",
            PopupWindowType::TranslateText => "translate",
            PopupWindowType::OCR => "ocr",
        }
    }

    pub fn title(&self) -> &'static str {
        match self {
            PopupWindowType::LookUpLexicalEntry => "Lookup",
            PopupWindowType::TranslateText => "Translate",
            PopupWindowType::OCR => "OCR",
        }
    }

    pub fn decorations(&self) -> bool {
        match self {
            PopupWindowType::LookUpLexicalEntry => false,
            PopupWindowType::TranslateText => false,
            PopupWindowType::OCR => false,
        }
    }

    pub fn always_on_top(&self) -> bool {
        match self {
            PopupWindowType::LookUpLexicalEntry => true,
            PopupWindowType::TranslateText => true,
            PopupWindowType::OCR => true,
        }
    }

    pub fn skip_taskbar(&self) -> bool {
        true
    }

    pub fn event_name(&self) -> &'static str {
        match self {
            PopupWindowType::LookUpLexicalEntry => "lookup-wake",
            PopupWindowType::TranslateText => "translation-wake",
            PopupWindowType::OCR => "ocr-wake",
        }
    }

    pub fn route(&self) -> &'static str {
        match self {
            PopupWindowType::LookUpLexicalEntry => "/lookup",
            PopupWindowType::TranslateText => "/translate",
            PopupWindowType::OCR => "/ocr",
        }
    }

    pub fn movable_by_window_background(&self) -> bool {
        match self {
            PopupWindowType::LookUpLexicalEntry => true,
            PopupWindowType::TranslateText => true,
            PopupWindowType::OCR => false,
        }
    }
}

/// Reuse an existing popup window or create a new one.
///
/// On macOS this uses an `NSPanel` so the popup can appear over fullscreen apps.
pub fn show_popup_window(
    app: &AppHandle,
    window_type: PopupWindowType,
    window_width_logical: f64,
    window_height_logical: f64,
    content: Option<String>,
) -> Result<()> {
    let logical_position =
        calculate_window_position_logical(app, (window_width_logical, window_height_logical))
            .context("show popup window: calculate logical position")?;

    #[cfg(target_os = "macos")]
    {
        show_popup_panel(
            app,
            window_type,
            logical_position,
            window_width_logical,
            window_height_logical,
            content,
        )
        .context("show popup window: macOS panel flow")?;
    }

    #[cfg(not(target_os = "macos"))]
    {
        let window = if let Some(existing) = app.get_webview_window(window_type.label()) {
            existing
                .set_position(logical_position)
                .context("show popup window: update existing window position")?;
            existing
                .set_size(tauri::LogicalSize::new(
                    window_width_logical,
                    window_height_logical,
                ))
                .context("show popup window: update existing window size")?;
            existing
        } else {
            create_popup_window(
                app,
                window_type,
                logical_position,
                window_width_logical,
                window_height_logical,
            )
            .context("show popup window: create new popup webview window")?
        };

        window
            .emit(window_type.event_name(), content.unwrap_or_default())
            .context("show popup window: emit wake event to frontend")?;

        window
            .show()
            .context("show popup window: display popup webview window")?;
    }

    Ok(())
}

#[cfg(target_os = "macos")]
fn show_popup_panel(
    app: &AppHandle,
    window_type: PopupWindowType,
    logical_position: LogicalPosition<f64>,
    window_width_logical: f64,
    window_height_logical: f64,
    content: Option<String>,
) -> Result<()> {
    let app_clone = app.clone();
    let (tx, rx) = mpsc::channel::<Result<()>>();
    app.run_on_main_thread(move || {
        let panel = match app_clone.get_webview_window(window_type.label()) {
            Some(window) => match window.to_panel::<LexicogPanel>() {
                Ok(panel) => panel,
                Err(e) => {
                    let _ = tx.send(Err(Error::from(e)
                        .context("show popup panel on macOS: convert window to panel")));
                    return;
                }
            },
            None => {
                app_clone
                    .get_webview_panel(window_type.label())
                    .ok()
                    .and_then(|panel| panel.to_window())
                    .map(|window| window.close());

                let panel =
                    match PanelBuilder::<_, LexicogPanel>::new(&app_clone, window_type.label())
                        .url(WebviewUrl::App(window_type.route().into()))
                        .title(window_type.title())
                        // Avoid activating the app while the temporary window is created.
                        .no_activate(true)
                        .level(PanelLevel::Floating)
                        .corner_radius(28.0)
                        .size(Size::Logical(LogicalSize::new(
                            window_width_logical,
                            window_height_logical,
                        )))
                        .transparent(true)
                        .build()
                    {
                        Ok(panel) => panel,
                        Err(e) => {
                            let _ = tx.send(Err(Error::from(e)
                                .context("create popup panel")
                                .context("show popup panel on macOS")));
                            return;
                        }
                    };

                if let Some(window) = panel.to_window() {
                    if let Err(e) = window.set_position(logical_position) {
                        let _ = tx.send(Err(Error::from(e)
                            .context("set panel position")
                            .context("show popup panel on macOS")));
                    }
                } else {
                    let _ = tx.send(Err(anyhow!("failed to get normal window from panel")
                        .context("set panel position")
                        .context("show popup panel on macOS")));
                    return;
                };

                panel.set_movable_by_window_background(window_type.movable_by_window_background());
                panel.set_style_mask(StyleMask::empty().nonactivating_panel().into());

                panel.set_collection_behavior(
                    CollectionBehavior::new()
                        .full_screen_auxiliary()
                        .can_join_all_spaces()
                        .stationary()
                        .into(),
                );
                panel
            }
        };

        if let Err(e) = app_clone.emit(window_type.event_name(), content.unwrap_or_default()) {
            let _ = tx.send(Err(Error::from(e)
                .context("emit event")
                .context("show popup panel on macOS")));
            return;
        }
        panel.show();

        let _ = tx.send(Ok(()));
    })
    .context("show popup panel on macOS: dispatch to main thread")?;
    rx.recv()
        .context("show popup panel on macOS: wait for main-thread completion")??;
    Ok(())
}

/// Create a popup window on non-macOS platforms.
#[cfg(not(target_os = "macos"))]
fn create_popup_window(
    app: &AppHandle,
    window_type: PopupWindowType,
    position: LogicalPosition<f64>,
    window_width_logical: f64,
    window_height_logical: f64,
) -> Result<tauri::WebviewWindow> {
    let window = WebviewWindowBuilder::new(
        app,
        window_type.label(),
        WebviewUrl::App(window_type.route().into()),
    )
    .title(window_type.title())
    .inner_size(window_width_logical, window_height_logical)
    .position(position.x, position.y)
    .decorations(window_type.decorations())
    .skip_taskbar(window_type.skip_taskbar())
    .always_on_top(window_type.always_on_top())
    .transparent(true)
    .build()
    .context("create popup window: build tauri webview window")?;

    Ok(window)
}

/// Calculate a popup position near the mouse in logical coordinates.
fn calculate_window_position_logical(
    app: &AppHandle,
    window_size_logical: (f64, f64),
) -> Result<LogicalPosition<f64>> {
    // Enigo reports physical screen coordinates.
    let (tx, rx) = mpsc::channel::<Option<(i32, i32)>>();
    app.run_on_main_thread(move || {
        let result = Enigo::new(&Settings::default())
            .ok()
            .and_then(|enigo| enigo.location().ok());
        let _ = tx.send(result);
    })
    .context("calculate popup window position: query mouse location on main thread")?;

    let (mouse_x_phys, mouse_y_phys) = match rx.recv().ok().flatten() {
        Some((x, y)) => (x as f64, y as f64),
        None => get_primary_monitor_center(app)
            .context("calculate popup window position: fallback to primary monitor center")?,
    };

    let monitor = find_monitor_at_point(app, mouse_x_phys, mouse_y_phys)
        .context("calculate popup window position: locate monitor under mouse")?;

    let scale = monitor.scale_factor(); // physical_px = logical * scale

    let mouse_x = mouse_x_phys / scale;
    let mouse_y = mouse_y_phys / scale;

    let screen_pos = monitor.position();
    let screen_size = monitor.size();

    let screen_x = screen_pos.x as f64 / scale;
    let screen_y = screen_pos.y as f64 / scale;
    let screen_width = screen_size.width as f64 / scale;
    let screen_height = screen_size.height as f64 / scale;

    let (win_width, win_height) = window_size_logical;

    const MARGIN: f64 = 10.0;

    let screen_left = screen_x + MARGIN;
    let screen_top = screen_y + MARGIN;
    let screen_right = screen_x + screen_width - MARGIN;
    let screen_bottom = screen_y + screen_height - MARGIN;

    let screen_center_x = (screen_left + screen_right) / 2.0;
    let screen_center_y = (screen_top + screen_bottom) / 2.0;

    let fits_anywhere =
        win_width <= (screen_right - screen_left) && win_height <= (screen_bottom - screen_top);

    if !fits_anywhere {
        let center_x = screen_x + (screen_width - win_width) / 2.0;
        let center_y = screen_y + (screen_height - win_height) / 2.0;
        return Ok(LogicalPosition::new(center_x, center_y));
    }

    // Try placing each corner of the popup at the cursor position.
    let candidates = [
        (mouse_x, mouse_y),                          // top-left at mouse
        (mouse_x - win_width, mouse_y),              // top-right at mouse
        (mouse_x, mouse_y - win_height),             // bottom-left at mouse
        (mouse_x - win_width, mouse_y - win_height), // bottom-right at mouse
    ];

    let mut best: Option<(f64, f64, f64)> = None; // (x, y, dist2_to_screen_center)

    for (x, y) in candidates {
        let left = x;
        let top = y;
        let right = x + win_width;
        let bottom = y + win_height;

        let fits = left >= screen_left
            && top >= screen_top
            && right <= screen_right
            && bottom <= screen_bottom;

        if !fits {
            continue;
        }

        let win_center_x = x + win_width / 2.0;
        let win_center_y = y + win_height / 2.0;
        let dx = win_center_x - screen_center_x;
        let dy = win_center_y - screen_center_y;
        let dist2 = dx * dx + dy * dy;

        match best {
            None => best = Some((x, y, dist2)),
            Some((_, _, best_dist2)) if dist2 < best_dist2 => best = Some((x, y, dist2)),
            Some(_) => {}
        }
    }

    if let Some((x, y, _)) = best {
        return Ok(LogicalPosition::new(x, y));
    }

    let center_x = screen_x + (screen_width - win_width) / 2.0;
    let center_y = screen_y + (screen_height - win_height) / 2.0;
    Ok(LogicalPosition::new(center_x, center_y))
}

/// Get the primary monitor center if mouse position lookup fails.
fn get_primary_monitor_center(app: &AppHandle) -> Result<(f64, f64)> {
    let primary = app
        .primary_monitor()?
        .ok_or_else(|| anyhow!("no primary monitor"))?;

    let pos = primary.position();
    let size = primary.size();

    Ok((
        pos.x as f64 + size.width as f64 / 2.0,
        pos.y as f64 + size.height as f64 / 2.0,
    ))
}

/// Find the monitor containing the given point.
fn find_monitor_at_point(app: &AppHandle, x: f64, y: f64) -> Result<tauri::Monitor> {
    let monitors = app
        .available_monitors()
        .context("find monitor at point: list available monitors")?;

    for monitor in monitors {
        let pos = monitor.position();
        let size = monitor.size();

        let monitor_left = pos.x as f64;
        let monitor_top = pos.y as f64;
        let monitor_right = monitor_left + size.width as f64;
        let monitor_bottom = monitor_top + size.height as f64;

        if x >= monitor_left && x < monitor_right && y >= monitor_top && y < monitor_bottom {
            return Ok(monitor);
        }
    }

    // Fall back to the primary monitor if no containing monitor is found.
    app.primary_monitor()?
        .ok_or_else(|| anyhow!("no monitor found at point ({}, {})", x, y))
}
