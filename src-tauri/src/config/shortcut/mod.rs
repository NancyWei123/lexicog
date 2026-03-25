pub mod lookup_lexical_entry;
pub mod ocr;
pub mod translate_text;

use anyhow::{anyhow, Context, Error, Result};
use global_hotkey::{hotkey::HotKey, GlobalHotKeyEvent};
use std::sync::RwLock;
use tauri::{AppHandle, Manager};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut};
use tauri_plugin_store::StoreExt;

#[tauri::command]
pub fn reset_hotkey(app: AppHandle, function: String, hotkey_str: String) -> Result<(), String> {
    match function.as_str() {
        "lookupLexicalEntry" => {
            impl_reset_hotkey::<lookup_lexical_entry::LookupLexicalEntryShortcutHandle>(
                &app,
                &hotkey_str,
            )
            .map_err(|e| {
                format!(
                    "{:#}",
                    e.context("reset hotkey for function `lookupLexicalEntry`")
                )
            })?;
            Ok(())
        }
        "translateText" => {
            impl_reset_hotkey::<translate_text::TranslateTextShortcutHandle>(&app, &hotkey_str)
                .map_err(|e| {
                    format!(
                        "{:#}",
                        e.context("reset hotkey for function `translateText`")
                    )
                })?;
            Ok(())
        }
        "ocr" => {
            impl_reset_hotkey::<ocr::OcrShortcutHandle>(&app, &hotkey_str)
                .map_err(|e| format!("{:#}", e.context("reset hotkey for function `ocr`")))?;
            Ok(())
        }
        _ => Err(format!(
            "{:#}",
            anyhow!("invalid function key for hotkey reset: {}", function).context("reset hotkey")
        )),
    }
}

fn impl_reset_hotkey<T: ShortcutHandle + 'static + Sync>(
    app: &AppHandle,
    hotkey_str: &str,
) -> Result<()> {
    let state = app
        .try_state::<RwLock<T>>()
        .ok_or(anyhow!("missing shortcut handle state"))
        .context("reset shortcut hotkey: load shortcut state")?;
    let mut guard = state
        .write()
        .map_err(|e| anyhow!("{}", e))
        .context("reset shortcut hotkey: acquire write lock")?;
    guard.set_hotkey_from_str(app, hotkey_str)
}

pub trait ShortcutHandle: Send {
    fn get_hotkey(&self) -> &HotKey;
    fn set_hotkey_from_str(&mut self, app: &AppHandle, hotkey_str: &str) -> Result<()>;
    fn callback(&self, app: &AppHandle, event: GlobalHotKeyEvent);
}

pub fn assign_new_hotkey(
    app: &AppHandle,
    source: &str,
    target: &mut HotKey,
    entry: &str,
) -> Result<()> {
    let new = string_to_tauri_hotkey(source).context("assign new global hotkey: parse input")?;
    let old = *target;
    if new == old {
        return Ok(());
    }
    app.global_shortcut()
        .register(new)
        .context("assign new global hotkey: register new shortcut")?;
    *target = new;
    if let Err(e) = app.global_shortcut().unregister(old) {
        log::error!(
            "{:#}",
            Error::from(e).context("assign new global hotkey: unregister previous shortcut")
        );
    }
    match app.store("app_config.json") {
        Ok(config_store) => {
            config_store.set(entry, source);
        }
        Err(e) => {
            log::error!(
                "{:#}",
                Error::from(e).context("assign new global hotkey: open app_config.json")
            );
        }
    }
    Ok(())
}

macro_rules! generate_key_match_arm {
	($key_code:expr, $c:expr, $($char_lit:expr => $code_variant:ident),* $(,)?) => {
		match $c {
				$(
					$char_lit => {
						if $key_code.is_some() {
						return Err(anyhow!("duplicate code key in hotkey")).context("parse hotkey string into tauri shortcut");
					}
					$key_code = Some(Code::$code_variant);
				},
			)*
			_ => {
				return Err(anyhow!("invalid code key in hotkey")).context("parse hotkey string into tauri shortcut");
			},
		}
	};
}

fn string_to_tauri_hotkey(hotkey: &str) -> Result<HotKey> {
    if hotkey.trim().is_empty() {
        return Err(anyhow!("empty hotkey string"))
            .context("parse hotkey string into tauri shortcut");
    }

    let parts: Vec<&str> = hotkey.split('+').map(|s| s.trim()).collect();

    if parts.is_empty() {
        return Err(anyhow!("invalid hotkey format"))
            .context("parse hotkey string into tauri shortcut");
    }

    let mut modifier: Modifiers = Modifiers::empty();
    let mut code_key: Option<Code> = None;

    for part in parts {
        match part.trim().to_lowercase().as_str() {
            "ctrl" | "control" => {
                modifier |= Modifiers::CONTROL;
            }
            "alt" => {
                modifier |= Modifiers::ALT;
            }
            "shift" => {
                modifier |= Modifiers::SHIFT;
            }
            "cmd" | "command" => {
                modifier |= Modifiers::SUPER;
            }
            "fn" => {
                modifier |= Modifiers::FN;
            }
            code => {
                if code.len() != 1 {
                    return Err(anyhow!("code key is not 1 byte long: {}", code))
                        .context("parse hotkey string into tauri shortcut");
                }

                let c = code
                    .chars()
                    .next()
                    .ok_or(anyhow!("invalid code key: {}", code))
                    .context("parse hotkey string into tauri shortcut")?;

                if !(c.is_ascii_alphabetic() || c.is_ascii_digit()) {
                    return Err(anyhow!("code key is not alphabetic or digit: {}", code))
                        .context("parse hotkey string into tauri shortcut");
                }

                generate_key_match_arm!(
                    code_key,
                    c,
                    'a' => KeyA,
                    'b' => KeyB,
                    'c' => KeyC,
                    'd' => KeyD,
                    'e' => KeyE,
                    'f' => KeyF,
                    'g' => KeyG,
                    'h' => KeyH,
                    'i' => KeyI,
                    'j' => KeyJ,
                    'k' => KeyK,
                    'l' => KeyL,
                    'm' => KeyM,
                    'n' => KeyN,
                    'o' => KeyO,
                    'p' => KeyP,
                    'q' => KeyQ,
                    'r' => KeyR,
                    's' => KeyS,
                    't' => KeyT,
                    'u' => KeyU,
                    'v' => KeyV,
                    'w' => KeyW,
                    'x' => KeyX,
                    'y' => KeyY,
                    'z' => KeyZ,
                    '0' => Digit0,
                    '1' => Digit1,
                    '2' => Digit2,
                    '3' => Digit3,
                    '4' => Digit4,
                    '5' => Digit5,
                    '6' => Digit6,
                    '7' => Digit7,
                    '8' => Digit8,
                    '9' => Digit9,
                );
            }
        }
    }

    if let Some(code) = code_key {
        if modifier.is_empty() {
            return Ok(Shortcut::new(None, code));
        }
        Ok(Shortcut::new(Some(modifier), code))
    } else {
        Err(anyhow!("missing code key in hotkey"))
            .context("parse hotkey string into tauri shortcut")
    }
}
