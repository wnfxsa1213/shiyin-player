use super::{run_with_trace, IpcError};
use crate::scene_assets::{SceneAssets, MAX_IMPORT_BYTES};
use rustplayer_core::SceneAsset;
use std::sync::Arc;
use tauri::{
    ipc::{InvokeBody, Request},
    State,
};

#[tauri::command]
pub async fn import_scene_background(
    request: Request<'_>,
    assets: State<'_, Arc<SceneAssets>>,
) -> Result<SceneAsset, IpcError> {
    let trace_id = request
        .headers()
        .get("x-trace-id")
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned);
    let name = request
        .headers()
        .get("x-file-name")
        .and_then(|value| value.to_str().ok())
        .map(|value| {
            percent_encoding::percent_decode_str(value)
                .decode_utf8_lossy()
                .into_owned()
        })
        .unwrap_or_else(|| "背景图片".into());
    run_with_trace("import_scene_background", trace_id, async {
        let bytes = match request.body() {
            InvokeBody::Raw(bytes) if bytes.len() <= MAX_IMPORT_BYTES => bytes.clone(),
            _ => return Err(IpcError::InvalidInput("请选择 20 MB 以内的图片".into())),
        };
        let assets = assets.inner().clone();
        tauri::async_runtime::spawn_blocking(move || assets.import(&bytes, &name))
            .await
            .map_err(|error| IpcError::Internal(error.to_string()))?
    })
    .await
}

#[tauri::command]
pub async fn list_scene_backgrounds(
    trace_id: Option<String>,
    assets: State<'_, Arc<SceneAssets>>,
) -> Result<Vec<SceneAsset>, IpcError> {
    run_with_trace("list_scene_backgrounds", trace_id, async {
        let assets = assets.inner().clone();
        tauri::async_runtime::spawn_blocking(move || assets.list())
            .await
            .map_err(|error| IpcError::Internal(error.to_string()))?
    })
    .await
}

#[tauri::command]
pub async fn delete_scene_background(
    asset_id: String,
    trace_id: Option<String>,
    assets: State<'_, Arc<SceneAssets>>,
) -> Result<(), IpcError> {
    run_with_trace("delete_scene_background", trace_id, async {
        let assets = assets.inner().clone();
        tauri::async_runtime::spawn_blocking(move || assets.delete(&asset_id))
            .await
            .map_err(|error| IpcError::Internal(error.to_string()))?
    })
    .await
}
