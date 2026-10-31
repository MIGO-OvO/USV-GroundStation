use crate::Result;
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
};

pub struct MapCache {
    root: PathBuf,
    client: reqwest::blocking::Client,
}
impl MapCache {
    pub fn new(root: &Path) -> Result<Self> {
        fs::create_dir_all(root).map_err(|e| e.to_string())?;
        let client = reqwest::blocking::Client::builder()
            .connect_timeout(std::time::Duration::from_secs(2))
            .timeout(std::time::Duration::from_secs(6))
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|e| e.to_string())?;
        Ok(Self {
            root: root.into(),
            client,
        })
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
        if offline {
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
                } else if kind.is_file() && entry.path().extension().is_some_and(|s| s == "png") {
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
