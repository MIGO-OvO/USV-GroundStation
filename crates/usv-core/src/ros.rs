use crate::Result;
use reqwest::blocking::Client;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::io::Read;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Download {
    pub name: String,
    pub content_type: String,
    pub bytes: Vec<u8>,
}

/// All HTTP data crosses this Rust boundary. Control commands use the MAVLink
/// actor; the web bridge exposes read-only diagnostics/data plus config/maps.
pub struct RosClient {
    client: Client,
    base: reqwest::Url,
}
impl RosClient {
    pub fn new(base: &str) -> Result<Self> {
        let mut url = reqwest::Url::parse(base).map_err(|e| e.to_string())?;
        if !["http", "https"].contains(&url.scheme())
            || url.host_str().is_none()
            || !url.username().is_empty()
            || url.password().is_some()
        {
            return Err("ROS 地址应为不含凭证的 HTTP/HTTPS 地址".into());
        }
        url.set_path("/");
        url.set_query(None);
        url.set_fragment(None);
        let client = Client::builder()
            .timeout(std::time::Duration::from_secs(20))
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|e| e.to_string())?;
        Ok(Self { client, base: url })
    }
    fn url(&self, path: &str) -> Result<reqwest::Url> {
        if !path.starts_with("/api/")
            || path.contains("..")
            || path.contains('%')
            || path.contains('\\')
            || path.contains('#')
            || path.contains("://")
        {
            return Err("ROS API 路径无效".into());
        }
        self.base.join(path).map_err(|e| e.to_string())
    }
    pub fn get(&self, path: &str) -> Result<Value> {
        let bare = path.split('?').next().unwrap_or(path);
        if ![
            "/api/config",
            "/api/calibration/offsets",
            "/api/manual/status",
            "/api/map/config",
            "/api/map/cache/stats",
            "/api/map/offline-mode",
            "/api/data/missions",
            "/api/data/voltage",
            "/api/data/voltage-series",
        ]
        .contains(&bare)
            && !bare.starts_with("/api/diagnostics/")
            && !bare.starts_with("/api/data/mission/")
        {
            return Err("该读取接口未开放".into());
        }
        let response = self
            .client
            .get(self.url(path)?)
            .send()
            .map_err(|e| e.to_string())?
            .error_for_status()
            .map_err(|e| e.to_string())?;
        let mut body = vec![];
        response
            .take(16 * 1024 * 1024 + 1)
            .read_to_end(&mut body)
            .map_err(|e| e.to_string())?;
        if body.len() > 16 * 1024 * 1024 {
            return Err("ROS JSON 超过 16 MiB，请使用下载".into());
        }
        let value: Value = serde_json::from_slice(&body).map_err(|e| e.to_string())?;
        if value.get("success") == Some(&Value::Bool(false)) {
            return Err(value
                .get("message")
                .or_else(|| value.get("error"))
                .and_then(Value::as_str)
                .unwrap_or("ROS 请求失败")
                .into());
        }
        Ok(value)
    }
    pub fn post(&self, path: &str, body: &Value) -> Result<Value> {
        if ![
            "/api/config",
            "/api/calibration/offsets",
            "/api/map/offline-mode",
            "/api/map/cache/prewarm",
            "/api/map/cache/prewarm/stop",
            "/api/mission/plan/validate",
        ]
        .contains(&path)
        {
            return Err("该写入接口未开放".into());
        }
        let value: Value = self
            .client
            .post(self.url(path)?)
            .json(body)
            .send()
            .map_err(|e| e.to_string())?
            .error_for_status()
            .map_err(|e| e.to_string())?
            .json()
            .map_err(|e| e.to_string())?;
        if value.get("success") == Some(&Value::Bool(false)) {
            return Err(value
                .get("message")
                .and_then(Value::as_str)
                .unwrap_or("ROS 配置失败")
                .into());
        }
        Ok(value)
    }
    pub fn download(&self, path: &str) -> Result<Download> {
        if !path.starts_with("/api/data/mission/")
            || !["/archive", "/csv", "/raw.csv", "/geojson"]
                .iter()
                .any(|s| path.ends_with(s))
        {
            return Err("下载路径无效".into());
        }
        let response = self
            .client
            .get(self.url(path)?)
            .send()
            .map_err(|e| e.to_string())?
            .error_for_status()
            .map_err(|e| e.to_string())?;
        let content_type = response
            .headers()
            .get("content-type")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("application/octet-stream")
            .to_string();
        let mut bytes = Vec::new();
        std::io::Read::take(response, 256 * 1024 * 1024 + 1)
            .read_to_end(&mut bytes)
            .map_err(|e| e.to_string())?;
        if bytes.len() > 256 * 1024 * 1024 {
            return Err("下载超过 256 MiB".into());
        }
        let suffix = if path.ends_with("archive") {
            "zip"
        } else if path.ends_with("geojson") {
            "geojson"
        } else {
            "csv"
        };
        Ok(Download {
            name: format!("usv-data-{}.{}", crate::diagnostics::unix_ms(), suffix),
            content_type,
            bytes,
        })
    }
}
