use tauri::AppHandle;
use tauri_plugin_store::StoreExt;
use rustplayer_core::MusicSourceId;

const STORE_PATH: &str = "credentials.json";

/// Helper function to generate cookie storage key for a given music source
fn cookie_key(source: MusicSourceId) -> String {
    format!("cookie_{}", source.storage_key())
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
    store.delete(key);
    store.save().map_err(|e| e.to_string())?;
    Ok(())
}
