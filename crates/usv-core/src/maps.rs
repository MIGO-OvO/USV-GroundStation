use crate::Result;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    fs,
    io::Read,
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    time::{Duration, Instant},
};

const REFRESH_MS: u64 = 24 * 60 * 60 * 1000;
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalPosition {
    pub latitude: f64,
    pub longitude: f64,
    pub accuracy_m: f64,
    pub received_unix_ms: u64,
}
#[derive(Default, Serialize, Deserialize)]
struct TileMetadata {
    checked_ms: u64,
    etag: Option<String>,
    modified: Option<String>,
}
#[derive(Clone)]
pub struct MapCache {
    root: PathBuf,
    client: reqwest::blocking::Client,
    refreshing: Arc<Mutex<HashSet<PathBuf>>>,
    prefetching: Arc<AtomicBool>,
    offline: Arc<AtomicBool>,
}
impl MapCache {
    pub fn new(root: &Path) -> Result<Self> {
        fs::create_dir_all(root).map_err(|e| e.to_string())?;
        let client = reqwest::blocking::Client::builder()
            .connect_timeout(Duration::from_secs(5))
            .timeout(Duration::from_secs(12))
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|e| e.to_string())?;
        Ok(Self {
            root: root.into(),
            client,
            refreshing: Arc::default(),
            prefetching: Arc::default(),
            offline: Arc::default(),
        })
    }
    pub fn set_offline(&self, offline: bool) {
        self.offline.store(offline, Ordering::Release);
    }
    /// QGC's Google provider uses the public vt XYZ endpoint with unpinned
    /// layer names. Keep that wire behaviour, without copying its GPL code.
    pub fn google_url(style: &str, z: u8, x: u32, y: u32) -> Result<reqwest::Url> {
        let layer = match style {
            "gsatellite" => "s",
            "gstreet" => "m",
            "ghybrid" => "y",
            "gterrain" => "p",
            _ => return Err("Google 地图样式无效".into()),
        };
        if z > 20 || x >= 1u32 << z || y >= 1u32 << z {
            return Err("Google 瓦片坐标无效".into());
        }
        reqwest::Url::parse(&format!(
            "https://mt{}.google.com/vt?lyrs={layer}&hl=zh-CN&x={x}&y={y}&z={z}&scale=1",
            (x + 2 * y) % 4,
        ))
        .map_err(|e| e.to_string())
    }
    pub fn google_tile(
        &self,
        style: &str,
        z: u8,
        x: u32,
        y: u32,
        offline: bool,
    ) -> Result<Vec<u8>> {
        let url = Self::google_url(style, z, x, y)?;
        let path = self
            .root
            .join("google")
            .join(style)
            .join(z.to_string())
            .join(x.to_string())
            .join(format!("{y}.tile"));
        self.cached_google(url, path, offline)
    }
    fn cached_google(&self, url: reqwest::Url, path: PathBuf, offline: bool) -> Result<Vec<u8>> {
        let offline = offline || self.offline.load(Ordering::Acquire);
        let cached = fs::read(&path).ok().filter(|b| image(b));
        if let Some(bytes) = cached {
            let meta: TileMetadata = fs::read(path.with_extension("json"))
                .ok()
                .and_then(|b| serde_json::from_slice(&b).ok())
                .unwrap_or_default();
            if !offline
                && crate::diagnostics::unix_ms().saturating_sub(meta.checked_ms) >= REFRESH_MS
                && self
                    .refreshing
                    .lock()
                    .map_err(|e| e.to_string())?
                    .insert(path.clone())
            {
                let cache = self.clone();
                std::thread::spawn(move || {
                    let _ = cache.fetch_google(&url, &path, &meta);
                    if let Ok(mut active) = cache.refreshing.lock() {
                        active.remove(&path);
                    }
                });
            }
            return Ok(bytes);
        }
        if offline {
            return Err("该区域尚无本机离线瓦片".into());
        }
        self.fetch_google(&url, &path, &TileMetadata::default())
    }
    fn fetch_google(
        &self,
        url: &reqwest::Url,
        path: &Path,
        previous: &TileMetadata,
    ) -> Result<Vec<u8>> {
        if self.offline.load(Ordering::Acquire) {
            return Err("地图处于离线模式".into());
        }
        let mut request = self
            .client
            .get(url.clone())
            .header("User-Agent", "USV-GroundStation/0.1")
            .header("Referer", "https://www.google.com/maps/");
        if let Some(etag) = &previous.etag {
            request = request.header("If-None-Match", etag);
        }
        if let Some(modified) = &previous.modified {
            request = request.header("If-Modified-Since", modified);
        }
        let response = request
            .send()
            .map_err(|e| format!("Google 瓦片请求失败: {e:?}"))?
            .error_for_status()
            .map_err(|e| e.to_string())?;
        let not_modified = response.status() == reqwest::StatusCode::NOT_MODIFIED;
        let meta = TileMetadata {
            checked_ms: crate::diagnostics::unix_ms(),
            etag: response
                .headers()
                .get("etag")
                .and_then(|h| h.to_str().ok())
                .map(str::to_owned)
                .or_else(|| not_modified.then(|| previous.etag.clone()).flatten()),
            modified: response
                .headers()
                .get("last-modified")
                .and_then(|h| h.to_str().ok())
                .map(str::to_owned)
                .or_else(|| not_modified.then(|| previous.modified.clone()).flatten()),
        };
        let bytes = if not_modified {
            fs::read(path).map_err(|e| e.to_string())?
        } else {
            let mut bytes = vec![];
            response
                .take(4 * 1024 * 1024 + 1)
                .read_to_end(&mut bytes)
                .map_err(|e| e.to_string())?;
            if !image(&bytes) {
                return Err("Google 未返回有效 PNG/JPEG 瓦片".into());
            }
            atomic_write(path, &bytes)?;
            bytes
        };
        atomic_write(
            &path.with_extension("json"),
            &serde_json::to_vec(&meta).map_err(|e| e.to_string())?,
        )?;
        Ok(bytes)
    }
    pub fn local_position(&self, offline: bool) -> Result<LocalPosition> {
        let path = self.root.join("local-position.json");
        let cached: Option<LocalPosition> = fs::read(&path)
            .ok()
            .and_then(|b| serde_json::from_slice(&b).ok());
        if let Some(p) = &cached
            && (offline
                || crate::diagnostics::unix_ms().saturating_sub(p.received_unix_ms)
                    < 15 * 60 * 1000)
        {
            return Ok(p.clone());
        }
        if offline {
            return cached.ok_or_else(|| "尚无本机定位记录，可拖动地图查看已缓存区域".into());
        }
        match windows_position() {
            Ok(p) => {
                atomic_write(&path, &serde_json::to_vec(&p).map_err(|e| e.to_string())?)?;
                Ok(p)
            }
            Err(e) => cached.ok_or(e),
        }
    }
    /// A small neighbourhood at common zoom levels, bounded to 30 seconds.
    /// Runs on a map worker; never on the MAVLink control thread.
    pub fn prefetch(&self, style: &str, lat: f64, lon: f64) -> Result<usize> {
        tile_coordinates(lat, lon, 0)?;
        Self::google_url(style, 0, 0, 0)?;
        if self.prefetching.swap(true, Ordering::AcqRel) {
            return Ok(0);
        }
        let started = Instant::now();
        let mut count = 0;
        'levels: for z in [12, 14, 16, 18, 10, 8] {
            let (x, y) = tile_coordinates(lat, lon, z)?;
            for dy in -1..=1 {
                for dx in -1..=1 {
                    if self.offline.load(Ordering::Acquire)
                        || started.elapsed() > Duration::from_secs(30)
                    {
                        break 'levels;
                    }
                    let n = 1i64 << z;
                    let tx = (i64::from(x) + dx).rem_euclid(n) as u32;
                    let ty = i64::from(y) + dy;
                    if (0..n).contains(&ty)
                        && self.google_tile(style, z, tx, ty as u32, false).is_ok()
                    {
                        count += 1;
                    }
                }
            }
        }
        self.prefetching.store(false, Ordering::Release);
        Ok(count)
    }
    fn tile_path(
        &self,
        base: &str,
        style: &str,
        z: u8,
        x: u32,
        y: u32,
    ) -> Result<(reqwest::Url, PathBuf)> {
        let url = reqwest::Url::parse(base).map_err(|e| e.to_string())?;
        if !["http", "https"].contains(&url.scheme())
            || url.host_str().is_none()
            || !url.username().is_empty()
            || url.password().is_some()
        {
            return Err("地图服务地址无效".into());
        }
        if style.is_empty()
            || style.len() > 30
            || !style
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'_')
            || z > 22
            || x >= 1u32 << z
            || y >= 1u32 << z
        {
            return Err("地图瓦片坐标或样式无效".into());
        }
        let origin = url.origin().ascii_serialization();
        let hash = format!("{:x}", Sha256::digest(origin.as_bytes()));
        let tile = url
            .join(&format!("/api/map/tile/{style}/{z}/{x}/{y}.png?v=3"))
            .map_err(|e| e.to_string())?;
        Ok((
            tile,
            self.root
                .join(hash)
                .join(style)
                .join(z.to_string())
                .join(x.to_string())
                .join(format!("{y}.png")),
        ))
    }
    pub fn tile(
        &self,
        base: &str,
        style: &str,
        z: u8,
        x: u32,
        y: u32,
        offline: bool,
    ) -> Result<Vec<u8>> {
        let (url, path) = self.tile_path(base, style, z, x, y)?;
        if path.exists() {
            return fs::read(path).map_err(|e| e.to_string());
        }
        if offline || self.offline.load(Ordering::Acquire) {
            return Err("该区域尚无本机离线瓦片".into());
        }
        let response = self
            .client
            .get(url)
            .send()
            .map_err(|e| e.to_string())?
            .error_for_status()
            .map_err(|e| e.to_string())?;
        let mut bytes = vec![];
        response
            .take(4 * 1024 * 1024 + 1)
            .read_to_end(&mut bytes)
            .map_err(|e| e.to_string())?;
        if bytes.len() > 4 * 1024 * 1024 || !bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
            return Err("地图服务未返回有效 PNG 瓦片".into());
        }
        let parent = path.parent().ok_or("瓦片目录无效")?;
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        let temp = parent.join(format!("{}.tmp", uuid::Uuid::new_v4()));
        fs::write(&temp, &bytes).map_err(|e| e.to_string())?;
        if let Err(e) = fs::rename(&temp, &path) {
            let _ = fs::remove_file(&temp);
            if !path.exists() {
                return Err(e.to_string());
            }
        }
        Ok(bytes)
    }
    pub fn stats(&self) -> Result<serde_json::Value> {
        fn walk(p: &Path, count: &mut u64, size: &mut u64) -> Result<()> {
            for entry in fs::read_dir(p).map_err(|e| e.to_string())? {
                let entry = entry.map_err(|e| e.to_string())?;
                let kind = entry.file_type().map_err(|e| e.to_string())?;
                if kind.is_dir() {
                    walk(&entry.path(), count, size)?;
                } else if kind.is_file()
                    && entry
                        .path()
                        .extension()
                        .is_some_and(|s| s == "png" || s == "tile")
                {
                    *count += 1;
                    *size += entry.metadata().map_err(|e| e.to_string())?.len();
                }
            }
            Ok(())
        }
        let (mut count, mut size) = (0, 0);
        walk(&self.root, &mut count, &mut size)?;
        Ok(serde_json::json!({"tiles":count,"bytes":size}))
    }
}

fn image(bytes: &[u8]) -> bool {
    bytes.len() <= 4 * 1024 * 1024
        && (bytes.starts_with(b"\x89PNG\r\n\x1a\n") || bytes.starts_with(b"\xff\xd8\xff"))
}
fn atomic_write(path: &Path, bytes: &[u8]) -> Result<()> {
    let parent = path.parent().ok_or("缓存目录无效")?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let tmp = parent.join(format!("{}.tmp", uuid::Uuid::new_v4()));
    fs::write(&tmp, bytes).map_err(|e| e.to_string())?;
    fs::rename(&tmp, path).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        e.to_string()
    })
}
pub fn tile_coordinates(lat: f64, lon: f64, z: u8) -> Result<(u32, u32)> {
    if !lat.is_finite()
        || !lon.is_finite()
        || !(-90.0..=90.0).contains(&lat)
        || !(-180.0..=180.0).contains(&lon)
        || z > 20
    {
        return Err("本机定位坐标无效".into());
    }
    let n = (1u32 << z) as f64;
    let lat = lat.clamp(-85.05112878, 85.05112878).to_radians();
    let x = ((lon + 180.0) / 360.0 * n).floor().clamp(0.0, n - 1.0) as u32;
    let y = ((1.0 - lat.tan().asinh() / std::f64::consts::PI) * 0.5 * n)
        .floor()
        .clamp(0.0, n - 1.0) as u32;
    Ok((x, y))
}
#[cfg(windows)]
fn windows_position() -> Result<LocalPosition> {
    use windows::{
        Devices::Geolocation::Geolocator,
        Foundation::TimeSpan,
        Win32::System::WinRT::{RO_INIT_MULTITHREADED, RoInitialize, RoUninitialize},
    };
    // Tauri invokes this on a blocking worker, which owns this WinRT apartment.
    unsafe { RoInitialize(RO_INIT_MULTITHREADED) }.map_err(|e| e.to_string())?;
    let result = (|| -> windows::core::Result<LocalPosition> {
        let locator = Geolocator::new()?;
        let position = locator
            .GetGeopositionAsyncWithAgeAndTimeout(
                TimeSpan {
                    Duration: 60 * 10_000_000,
                },
                TimeSpan {
                    Duration: 6 * 10_000_000,
                },
            )?
            .join()?;
        let coordinate = position.Coordinate()?;
        let point = coordinate.Point()?.Position()?;
        Ok(LocalPosition {
            latitude: point.Latitude,
            longitude: point.Longitude,
            accuracy_m: coordinate.Accuracy()?,
            received_unix_ms: crate::diagnostics::unix_ms(),
        })
    })();
    unsafe { RoUninitialize() };
    result.map_err(|e| {
        format!(
            "无法获取本机位置（{}），请在 Windows 设置中启用定位；也可拖动地图自动缓存",
            e.code()
        )
    })
}
#[cfg(not(windows))]
fn windows_position() -> Result<LocalPosition> {
    Err("当前平台不支持 Windows 本机定位".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{io::Write, net::TcpListener, sync::mpsc};

    fn server(
        status: &str,
        body: &[u8],
    ) -> (
        reqwest::Url,
        mpsc::Sender<()>,
        std::thread::JoinHandle<String>,
    ) {
        let socket = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = reqwest::Url::parse(&format!(
            "http://{}/vt?lyrs=s&x=1&y=1&z=2",
            socket.local_addr().unwrap()
        ))
        .unwrap();
        let status = status.to_owned();
        let body = body.to_vec();
        let (tx, rx) = mpsc::channel();
        let h = std::thread::spawn(move || {
            let (mut stream, _) = socket.accept().unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(3)))
                .unwrap();
            let mut buffer = [0; 8192];
            let n = stream.read(&mut buffer).unwrap();
            rx.recv_timeout(Duration::from_secs(3)).unwrap();
            write!(stream, "HTTP/1.1 {status}\r\nETag: test-version\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len()).unwrap();
            stream.write_all(&body).unwrap();
            String::from_utf8_lossy(&buffer[..n]).to_lowercase()
        });
        (url, tx, h)
    }
    fn finish_refresh(cache: &MapCache) {
        let at = Instant::now();
        while !cache.refreshing.lock().unwrap().is_empty() {
            assert!(at.elapsed() < Duration::from_secs(3));
            std::thread::sleep(Duration::from_millis(5));
        }
    }
    #[test]
    fn google_urls_use_current_layers_https_and_valid_xyz() {
        for (style, layer) in [
            ("gsatellite", "s"),
            ("gstreet", "m"),
            ("ghybrid", "y"),
            ("gterrain", "p"),
        ] {
            let u = MapCache::google_url(style, 16, 100, 200).unwrap();
            assert_eq!(u.scheme(), "https");
            assert_eq!(u.path(), "/vt");
            assert_eq!(u.query_pairs().find(|(k, _)| k == "lyrs").unwrap().1, layer);
        }
        assert!(MapCache::google_url("../invalid", 1, 0, 0).is_err());
        assert!(MapCache::google_url("gsatellite", 21, 0, 0).is_err());
        assert!(MapCache::google_url("gsatellite", 2, 4, 0).is_err());
        assert_eq!(tile_coordinates(0.0, 0.0, 2).unwrap(), (2, 2));
        assert_eq!(tile_coordinates(90.0, 180.0, 2).unwrap(), (3, 0));
        assert!(tile_coordinates(f64::NAN, 0.0, 12).is_err());
    }
    #[test]
    fn google_jpeg_download_survives_offline_restart_and_html_is_not_cached() {
        let d = tempfile::tempdir().unwrap();
        let cache = MapCache::new(d.path()).unwrap();
        let p = d.path().join("1.tile");
        let jpg = b"\xff\xd8\xfffixture";
        let (url, ready, h) = server("200 OK", jpg);
        ready.send(()).unwrap();
        assert_eq!(
            cache.cached_google(url.clone(), p.clone(), false).unwrap(),
            jpg
        );
        h.join().unwrap();
        let restarted = MapCache::new(d.path()).unwrap();
        assert_eq!(
            restarted
                .cached_google(url.clone(), p.clone(), true)
                .unwrap(),
            jpg
        );
        assert!(
            restarted
                .cached_google(url, d.path().join("missing.tile"), true)
                .is_err()
        );
        assert_eq!(restarted.stats().unwrap()["tiles"], 1);
        let (url, ready, h) = server("200 OK", b"<html>error</html>");
        ready.send(()).unwrap();
        let bad = d.path().join("bad.tile");
        assert!(cache.cached_google(url, bad.clone(), false).is_err());
        h.join().unwrap();
        assert!(!bad.exists());
        cache.set_offline(true);
        assert!(cache.google_tile("gsatellite", 12, 10, 10, false).is_err());
        assert_eq!(cache.prefetch("gsatellite", 31.2, 121.5).unwrap(), 0);
    }
    #[test]
    fn local_position_offline_uses_only_persisted_coordinates() {
        let d = tempfile::tempdir().unwrap();
        let cache = MapCache::new(d.path()).unwrap();
        assert!(cache.local_position(true).is_err());
        let p = LocalPosition {
            latitude: 31.2,
            longitude: 121.5,
            accuracy_m: 30.0,
            received_unix_ms: 1234,
        };
        atomic_write(
            &d.path().join("local-position.json"),
            &serde_json::to_vec(&p).unwrap(),
        )
        .unwrap();
        let restored = cache.local_position(true).unwrap();
        assert_eq!((restored.latitude, restored.longitude), (31.2, 121.5));
        assert_eq!(restored.received_unix_ms, 1234);
    }
    #[test]
    fn stale_tiles_return_immediately_refresh_once_and_preserve_cache_on_failure() {
        for status in ["200 OK", "304 Not Modified", "503 Unavailable"] {
            let d = tempfile::tempdir().unwrap();
            let cache = MapCache::new(d.path()).unwrap();
            let path = d.path().join("1.tile");
            let old = b"\x89PNG\r\n\x1a\nold";
            let new = b"\xff\xd8\xffnew";
            fs::write(&path, old).unwrap();
            fs::write(
                path.with_extension("json"),
                br#"{"checked_ms":0,"etag":"old","modified":null}"#,
            )
            .unwrap();
            let (url, release, h) = server(status, if status == "200 OK" { new } else { b"" });
            // Server cannot reply yet: both calls must serve stale bytes now.
            assert_eq!(
                cache
                    .cached_google(url.clone(), path.clone(), false)
                    .unwrap(),
                old
            );
            assert_eq!(
                cache
                    .cached_google(url.clone(), path.clone(), false)
                    .unwrap(),
                old
            );
            assert_eq!(cache.refreshing.lock().unwrap().len(), 1);
            release.send(()).unwrap();
            let request = h.join().unwrap();
            assert!(request.contains("if-none-match: old"));
            finish_refresh(&cache);
            let expected: &[u8] = if status == "200 OK" { new } else { old };
            assert_eq!(
                cache.cached_google(url, path.clone(), true).unwrap(),
                expected
            );
            let meta: TileMetadata =
                serde_json::from_slice(&fs::read(path.with_extension("json")).unwrap()).unwrap();
            assert_eq!(meta.checked_ms > 0, status != "503 Unavailable");
        }
    }
}
