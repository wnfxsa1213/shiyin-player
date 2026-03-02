use tauri::AppHandle;
use tauri_plugin_store::StoreExt;
use rustplayer_core::MusicSourceId;

const STORE_PATH: &str = "credentials.json";

/// Helper function to generate cookie storage key for a given music source
fn cookie_key(source: MusicSourceId) -> String {
    format!("cookie_{}", source.storage_key())
}

/// Helper function to generate refresh info storage key for a given music source
fn refresh_key(source: MusicSourceId) -> String {
    format!("refresh_{}", source.storage_key())
}

pub fn save_cookie(app: &AppHandle, source: MusicSourceId, cookie: &str) -> Result<(), String> {
    let store = app.store(STORE_PATH).map_err(|e| e.to_string())?;
    let key = cookie_key(source);
    store.set(key, serde_json::json!(cookie));
    store.save().map_err(|e| e.to_string())?;
    Ok(())
}

pub fn load_cookie(app: &AppHandle, source: MusicSourceId) -> Result<Option<String>, String> {
    let store = app.store(STORE_PATH).map_err(|e| e.to_string())?;
    let key = cookie_key(source);
    match store.get(key) {
        Some(val) => Ok(val.as_str().map(|s| s.to_string())),
        None => Ok(None),
    }
}

pub fn delete_cookie(app: &AppHandle, source: MusicSourceId) -> Result<(), String> {
    let store = app.store(STORE_PATH).map_err(|e| e.to_string())?;
    let key = cookie_key(source);
    store.delete(&key);
    // Also delete refresh info
    let rkey = refresh_key(source);
    store.delete(&rkey);
    store.save().map_err(|e| e.to_string())?;
    Ok(())
}

/// Save refresh info (refresh_key + refresh_token) for credential refresh.
pub fn save_refresh_info(
    app: &AppHandle,
    source: MusicSourceId,
    refresh_key_val: &str,
    refresh_token_val: &str,
) -> Result<(), String> {
    let store = app.store(STORE_PATH).map_err(|e| e.to_string())?;
    let key = refresh_key(source);
    store.set(key, serde_json::json!({
        "refresh_key": refresh_key_val,
        "refresh_token": refresh_token_val,
    }));
    store.save().map_err(|e| e.to_string())?;
    Ok(())
}

/// Load refresh info for credential refresh.
pub fn load_refresh_info(
    app: &AppHandle,
    source: MusicSourceId,
) -> Result<Option<(String, String)>, String> {
    let store = app.store(STORE_PATH).map_err(|e| e.to_string())?;
    let key = refresh_key(source);
    match store.get(key) {
        Some(val) => {
            let rk = val.get("refresh_key").and_then(|v| v.as_str());
            let rt = val.get("refresh_token").and_then(|v| v.as_str());
            match (rk, rt) {
                (Some(k), Some(t)) if !k.is_empty() && !t.is_empty() => {
                    Ok(Some((k.to_string(), t.to_string())))
                }
                _ => Ok(None),
            }
        }
        None => Ok(None),
    }
}
