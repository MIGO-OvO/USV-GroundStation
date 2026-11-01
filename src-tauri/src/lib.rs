use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicU64, Ordering},
    },
};
use tauri::{Manager, State, ipc::Channel};
use usv_core::{
    maps::{LocalPosition, MapCache},
    ros::RosClient,
    station::{Intent, Snapshot, Station},
};

struct AppState {
    station: Station,
    maps: Arc<MapCache>,
    exports: PathBuf,
    subscribers: Arc<Mutex<HashMap<u64, Arc<AtomicBool>>>>,
    next_subscription: AtomicU64,
}

#[cfg(target_os = "android")]
struct NativeExport(tauri::plugin::PluginHandle<tauri::Wry>);

async fn finish_export(_app: tauri::AppHandle, path: String) -> Result<String, String> {
    #[cfg(target_os = "android")]
    {
        let response: serde_json::Value = _app
            .state::<NativeExport>()
            .0
            .run_mobile_plugin_async("save", serde_json::json!({ "path": path }))
            .await
            .map_err(|e| e.to_string())?;
        return response
            .get("uri")
            .and_then(|v| v.as_str())
            .map(String::from)
            .ok_or_else(|| "系统未返回保存位置".into());
    }
    #[cfg(not(target_os = "android"))]
    Ok(path)
}

#[tauri::command]
fn station_snapshot(state: State<'_, AppState>) -> Result<Snapshot, String> {
    state.station.snapshot()
}

#[tauri::command]
async fn station_intent(
    state: State<'_, AppState>,
    intent: Intent,
) -> Result<serde_json::Value, String> {
    let station = state.station.clone();
    tauri::async_runtime::spawn_blocking(move || station.dispatch(intent))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
fn station_subscribe(
    state: State<'_, AppState>,
    channel: Channel<Snapshot>,
) -> Result<u64, String> {
    let id = state.next_subscription.fetch_add(1, Ordering::Relaxed);
    let active = Arc::new(AtomicBool::new(true));
    state
        .subscribers
        .lock()
        .map_err(|e| e.to_string())?
        .insert(id, active.clone());
    let station = state.station.clone();
    let subscribers = state.subscribers.clone();
    tauri::async_runtime::spawn(async move {
        while active.load(Ordering::Relaxed) {
            if let Ok(snapshot) = station.snapshot() {
                if channel.send(snapshot).is_err() {
                    break;
                }
            }
            tokio::time::sleep(std::time::Duration::from_millis(200)).await;
        }
        if let Ok(mut subscriptions) = subscribers.lock() {
            subscriptions.remove(&id);
        }
    });
    Ok(id)
}

#[tauri::command]
fn station_unsubscribe(state: State<'_, AppState>, id: u64) -> Result<(), String> {
    if let Some(active) = state
        .subscribers
        .lock()
        .map_err(|e| e.to_string())?
        .remove(&id)
    {
        active.store(false, Ordering::Relaxed);
    }
    Ok(())
}

#[tauri::command]
async fn ros_get(base_url: String, path: String) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || RosClient::new(&base_url)?.get(&path))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn ros_post(
    base_url: String,
    path: String,
    body: serde_json::Value,
) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || RosClient::new(&base_url)?.post(&path, &body))
        .await
        .map_err(|e| e.to_string())?
}
fn save_file(directory: PathBuf, name: String, bytes: &[u8]) -> Result<String, String> {
    if name.len() > 100
        || name.contains(['\\', '/', ':'])
        || name.contains("..")
        || !name
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'-' || b == b'_')
    {
        return Err("导出文件名无效".into());
    }
    std::fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
    let mut path = directory.join(&name);
    for suffix in 0..1000 {
        use std::io::Write;
        match std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
        {
            Ok(mut file) => {
                file.write_all(bytes).map_err(|e| e.to_string())?;
                return Ok(path.to_string_lossy().to_string());
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                path = directory.join(format!("{suffix}-{name}"))
            }
            Err(e) => return Err(e.to_string()),
        }
    }
    Err("导出文件名冲突过多".into())
}
#[tauri::command]
async fn ros_download(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    base_url: String,
    path: String,
) -> Result<String, String> {
    let exports = state.exports.clone();
    let path = tauri::async_runtime::spawn_blocking(move || {
        let file = RosClient::new(&base_url)?.download(&path)?;
        save_file(exports, file.name, &file.bytes)
    })
    .await
    .map_err(|e| e.to_string())??;
    finish_export(app, path).await
}
#[tauri::command]
async fn export_diagnostics(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    base_url: Option<String>,
) -> Result<String, String> {
    let station = state.station.clone();
    let exports = state.exports.clone();
    let path = tauri::async_runtime::spawn_blocking(move || {
        let ros = base_url.map(|base| {
            match RosClient::new(&base).and_then(|r| r.get("/api/diagnostics/export")) {
                Ok(v) => v,
                Err(e) => serde_json::json!({"unavailable":e}),
            }
        });
        let bytes = station.export(ros)?;
        save_file(
            exports,
            format!("usv-diagnostics-{}.zip", usv_core::diagnostics::unix_ms()),
            &bytes,
        )
    })
    .await
    .map_err(|e| e.to_string())??;
    finish_export(app, path).await
}
#[tauri::command]
async fn save_text(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    name: String,
    text: String,
) -> Result<String, String> {
    let exports = state.exports.clone();
    let path =
        tauri::async_runtime::spawn_blocking(move || save_file(exports, name, text.as_bytes()))
            .await
            .map_err(|e| e.to_string())??;
    finish_export(app, path).await
}
#[tauri::command]
async fn map_tile(
    state: State<'_, AppState>,
    base_url: String,
    source: String,
    style: String,
    z: u8,
    x: u32,
    y: u32,
    offline: bool,
) -> Result<Vec<u8>, String> {
    let cache = state.maps.clone();
    tauri::async_runtime::spawn_blocking(move || match source.as_str() {
        "google" => cache.google_tile(&style, z, x, y, offline),
        "ros" => cache.tile(&base_url, &style, z, x, y, offline),
        _ => Err("地图来源无效".into()),
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn map_location(state: State<'_, AppState>, offline: bool) -> Result<LocalPosition, String> {
    let cache = state.maps.clone();
    cache.set_offline(offline);
    tauri::async_runtime::spawn_blocking(move || cache.local_position(offline))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
fn map_set_offline(state: State<'_, AppState>, offline: bool) {
    state.maps.set_offline(offline);
}
#[tauri::command]
async fn map_prefetch(
    state: State<'_, AppState>,
    style: String,
    latitude: f64,
    longitude: f64,
) -> Result<usize, String> {
    let cache = state.maps.clone();
    tauri::async_runtime::spawn_blocking(move || cache.prefetch(&style, latitude, longitude))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn map_stats(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let cache = state.maps.clone();
    tauri::async_runtime::spawn_blocking(move || cache.stats())
        .await
        .map_err(|e| e.to_string())?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    #[cfg(target_os = "android")]
    let builder = builder.plugin(
        tauri::plugin::Builder::<tauri::Wry>::new("file-export")
            .setup(|app, api| {
                app.manage(NativeExport(api.register_android_plugin(
                    "com.migo.usvgroundstation",
                    "ExportPlugin",
                )?));
                Ok(())
            })
            .build(),
    );
    builder
        .setup(|app| {
            let data = std::env::var_os("USV_GROUNDSTATION_DATA_DIR")
                .map(PathBuf::from)
                .unwrap_or(app.path().app_data_dir()?);
            let station = Station::start(&data).map_err(std::io::Error::other)?;
            let maps = MapCache::new(&data.join("map-cache")).map_err(std::io::Error::other)?;
            #[cfg(target_os = "android")]
            let exports = app.path().app_cache_dir()?.join("exports");
            #[cfg(not(target_os = "android"))]
            let exports = app
                .path()
                .download_dir()
                .unwrap_or_else(|_| data.join("exports"))
                .join("USV-GroundStation");
            app.manage(AppState {
                station,
                maps: Arc::new(maps),
                exports,
                subscribers: Arc::new(Mutex::new(HashMap::new())),
                next_subscription: AtomicU64::new(1),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            station_snapshot,
            station_intent,
            station_subscribe,
            station_unsubscribe,
            ros_get,
            ros_post,
            ros_download,
            export_diagnostics,
            save_text,
            map_tile,
            map_location,
            map_set_offline,
            map_prefetch,
            map_stats
        ])
        .run(tauri::generate_context!())
        .expect("运行 USV GroundStation");
}
