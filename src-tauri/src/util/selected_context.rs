use anyhow::{anyhow, Context, Error, Result};
use enigo::{
    Direction::{Click, Press, Release},
    Enigo, Key, Keyboard, Settings,
};
use tauri::{AppHandle, Manager};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tokio::sync::Mutex;

#[derive(Clone)]
pub struct SelectedText {
    pub text: String,
}

#[derive(Clone)]
pub struct SelectedImage {
    pub bin: Vec<u8>,
}

pub async fn get_selected_text(app: &AppHandle) -> Result<()> {
    let old_text = match app.clipboard().read_text() {
        Ok(t) => t,
        Err(e) => {
            log::error!(
                "{:#}",
                Error::from(e).context("capture selected text: read existing clipboard content")
            );
            String::new()
        }
    };

    let (tx, rx) = tokio::sync::oneshot::channel::<Result<()>>();
    app.run_on_main_thread(move || {
        let mut enigo = match Enigo::new(&Settings::default()) {
            Ok(e) => e,
            Err(e) => {
                let _ = tx.send(Err(Error::from(e)
                    .context("capture selected text: initialize Enigo on main thread")));
                return;
            }
        };

        #[cfg(target_os = "macos")]
        {
            if let Err(e) = enigo.key(Key::Meta, Press) {
                let _ = tx.send(Err(
                    Error::from(e).context("capture selected text: press Meta key on macOS")
                ));
                return;
            }
            if let Err(e) = enigo.key(Key::Unicode('c'), Click) {
                let _ = tx.send(Err(
                    Error::from(e).context("capture selected text: send `Cmd+C` on macOS")
                ));
                return;
            }
            if let Err(e) = enigo.key(Key::Meta, Release) {
                let _ = tx.send(Err(
                    Error::from(e).context("capture selected text: release Meta key on macOS")
                ));
                return;
            }
        }

        #[cfg(not(target_os = "macos"))]
        {
            if let Err(e) = enigo.key(Key::Control, Press) {
                let _ = tx.send(Err(
                    Error::from(e).context("capture selected text: press Control key")
                ));
                return;
            }
            if let Err(e) = enigo.key(Key::Unicode('c'), Click) {
                let _ = tx.send(Err(
                    Error::from(e).context("capture selected text: send `Ctrl+C`")
                ));
                return;
            }
            if let Err(e) = enigo.key(Key::Control, Release) {
                let _ = tx.send(Err(
                    Error::from(e).context("capture selected text: release Control key")
                ));
                return;
            }
        }

        let _ = tx.send(Ok(()));
    })
    .context("capture selected text: run keyboard copy sequence on main thread")?;

    let _ = rx.await?;
    tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;

    let result = app.clipboard().read_text();
    if let Err(e) = app.clipboard().write_text(old_text) {
        log::error!(
            "{:#}",
            Error::from(e).context("capture selected text: restore previous clipboard content")
        );
    }
    let selected_text = result.context("capture selected text: read copied text from clipboard")?;

    let state = app
        .try_state::<Mutex<SelectedText>>()
        .ok_or(anyhow!("missing tauri state: SelectedText"))
        .context("capture selected text: access selected text state")?;
    let mut guard = state.lock().await;
    guard.text = selected_text.trim().to_string();

    Ok(())
}
