//! Addressed, stop-and-wait ROS control RPC. Downloads and maps stay on HTTP.
use crate::{
    Result,
    wire::{WireMessage, standard::*},
};
use flate2::{Compression, Decompress, FlushDecompress, Status, write::ZlibEncoder};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{collections::VecDeque, io::Write, sync::mpsc};

pub const MESSAGE_TYPE: u16 = 31020;
pub const HEADER: usize = 31;
pub const CHUNK: usize = 249 - HEADER;
pub const MAX_JSON: usize = 131072;
pub const MAX_WIRE: usize = 65536;
pub const TIMEOUT_MS: u64 = 120000;
pub const HELLO: u8 = 0;
pub const READY: u8 = 1;
pub const REQUEST: u8 = 2;
pub const ACK: u8 = 3;
pub const FETCH: u8 = 4;
pub const RESPONSE: u8 = 5;
pub const WAIT: u8 = 6;
pub const ERROR: u8 = 7;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Request {
    pub method: String,
    pub path: String,
    #[serde(default)]
    pub body: Value,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub authorization: String,
}
impl Request {
    pub fn validate(&self) -> Result<()> {
        if !allowed(&self.method, &self.path) {
            return Err("该接口未开放数传控制访问".into());
        }
        if self.method != "GET" && !self.body.is_object() {
            return Err("请求体应为 JSON 对象".into());
        }
        if self.authorization.len() > 512 || self.authorization.contains(['\r', '\n']) {
            return Err("控制凭证无效".into());
        }
        Ok(())
    }
    pub fn stop(&self) -> bool {
        self.method == "POST"
            && matches!(
                self.path.as_str(),
                "/api/manual/stop-all" | "/api/injection-pump/off"
            )
    }
    pub fn physical(&self) -> bool {
        self.method == "POST"
            && (matches!(
                self.path.as_str(),
                "/api/manual/pump-step"
                    | "/api/pid/test"
                    | "/api/calibration/start"
                    | "/api/injection-pump/on"
                    | "/api/injection-pump/set"
                    | "/api/hardware/apply"
                    | "/api/hardware/test-pump-port"
            ) || self.path == "/api/manual/mode"
                && self.body.get("enabled") == Some(&Value::Bool(true)))
    }
}
pub fn allowed(method: &str, path: &str) -> bool {
    let fixed = match method {
        "GET" => matches!(
            path,
            "/api/config"
                | "/api/pid/config"
                | "/api/calibration/offsets"
                | "/api/presets/auto"
                | "/api/waypoint-sampling"
                | "/api/manual/status"
                | "/api/hardware/config"
                | "/api/hardware/serial-ports"
                | "/api/diagnostics/link"
                | "/api/diagnostics/system"
                | "/api/diagnostics/events"
                | "/api/diagnostics/history"
        ),
        "POST" => matches!(
            path,
            "/api/config"
                | "/api/pid/config"
                | "/api/calibration/offsets"
                | "/api/calibration/zero"
                | "/api/calibration/reset"
                | "/api/calibration/start"
                | "/api/waypoint-sampling"
                | "/api/waypoint-sampling/sync"
                | "/api/manual/mode"
                | "/api/manual/pump-step"
                | "/api/manual/stop-all"
                | "/api/injection-pump/status"
                | "/api/injection-pump/on"
                | "/api/injection-pump/off"
                | "/api/injection-pump/set"
                | "/api/hardware/config"
                | "/api/hardware/test-pump-port"
                | "/api/hardware/apply"
                | "/api/diagnostics/link/reconnect"
        ),
        _ => false,
    };
    fixed
        || matches!(method, "GET" | "POST" | "DELETE")
            && (path.strip_prefix("/api/preset/auto/").is_some_and(|s| {
                !s.is_empty()
                    && s.chars().count() <= 64
                    && s.chars()
                        .all(|c| c.is_alphanumeric() || c == '_' || c == '-')
            }) || path
                .strip_prefix("/api/waypoint-sampling/")
                .is_some_and(|s| {
                    !s.is_empty() && s.len() <= 5 && s.bytes().all(|c| c.is_ascii_digit())
                }))
}

#[derive(Debug, Clone, PartialEq)]
pub struct Frame {
    pub kind: u8,
    pub session: u64,
    pub boot: u64,
    pub request: u32,
    pub index: u16,
    pub count: u16,
    pub data: Vec<u8>,
}
impl Frame {
    pub fn encode(&self) -> Result<Vec<u8>> {
        if self.data.len() > CHUNK {
            return Err("数传分片过大".into());
        }
        let mut out = b"USR1".to_vec();
        out.push(self.kind);
        out.extend(self.session.to_le_bytes());
        out.extend(self.boot.to_le_bytes());
        out.extend(self.request.to_le_bytes());
        out.extend(self.index.to_le_bytes());
        out.extend(self.count.to_le_bytes());
        out.extend((self.data.len() as u16).to_le_bytes());
        out.extend(&self.data);
        Ok(out)
    }
    pub fn decode(bytes: &[u8]) -> Result<Self> {
        if bytes.len() < HEADER || &bytes[..4] != b"USR1" || bytes[4] > ERROR {
            return Err("数传帧头无效".into());
        }
        let size = u16::from_le_bytes([bytes[29], bytes[30]]) as usize;
        if size > CHUNK || bytes.len() < HEADER + size {
            return Err("数传帧长度无效".into());
        }
        Ok(Self {
            kind: bytes[4],
            session: u64::from_le_bytes(bytes[5..13].try_into().unwrap()),
            boot: u64::from_le_bytes(bytes[13..21].try_into().unwrap()),
            request: u32::from_le_bytes(bytes[21..25].try_into().unwrap()),
            index: u16::from_le_bytes([bytes[25], bytes[26]]),
            count: u16::from_le_bytes([bytes[27], bytes[28]]),
            data: bytes[HEADER..HEADER + size].to_vec(),
        })
    }
    pub fn message(&self, target: u8) -> Result<WireMessage> {
        let bytes = self.encode()?;
        let mut payload = [0; 249];
        payload[..bytes.len()].copy_from_slice(&bytes);
        Ok(MavMessage::V2_EXTENSION(V2_EXTENSION_DATA {
            target_network: 0,
            target_system: target,
            target_component: 191,
            message_type: MESSAGE_TYPE,
            payload,
        })
        .into())
    }
}
pub fn compress(value: &Value) -> Result<Vec<u8>> {
    let bytes = serde_json::to_vec(value).map_err(|e| e.to_string())?;
    if bytes.len() > MAX_JSON {
        return Err("请求超过 128 KiB，请使用 HTTP".into());
    }
    let mut out = ZlibEncoder::new(Vec::new(), Compression::default());
    out.write_all(&bytes).map_err(|e| e.to_string())?;
    let bytes = out.finish().map_err(|e| e.to_string())?;
    if bytes.len() > MAX_WIRE {
        return Err("压缩请求超过 64 KiB，请使用 HTTP".into());
    }
    Ok(bytes)
}
pub fn decompress(bytes: &[u8]) -> Result<Value> {
    let mut decoder = Decompress::new(true);
    let mut out = Vec::with_capacity(MAX_JSON + 1);
    let status = decoder
        .decompress_vec(bytes, &mut out, FlushDecompress::Finish)
        .map_err(|e| e.to_string())?;
    if status != Status::StreamEnd
        || out.len() > MAX_JSON
        || decoder.total_in() as usize != bytes.len()
    {
        return Err("数传响应长度无效".into());
    }
    serde_json::from_slice(&out).map_err(|e| e.to_string())
}
struct Job {
    id: u32,
    request: Request,
    chunks: Vec<Vec<u8>>,
    reply: mpsc::Sender<Result<Value>>,
    started: u64,
    upload: usize,
    download: Vec<Vec<u8>>,
    count: Option<u16>,
    last_tx: Option<u64>,
    attempts: u8,
    sent: bool,
}
pub struct Completion {
    pub outputs: bool,
    pub uncertain: bool,
    pub path: String,
}
pub struct Client {
    pub session: u64,
    boot: Option<u64>,
    next_id: u32,
    jobs: VecDeque<Job>,
    pub completed: Vec<Completion>,
    next_frame_at: u64,
}
impl Default for Client {
    fn default() -> Self {
        Self {
            session: uuid::Uuid::new_v4().as_u128() as u64 | 1,
            boot: None,
            next_id: 0,
            jobs: VecDeque::new(),
            completed: vec![],
            next_frame_at: 0,
        }
    }
}
impl Client {
    pub fn submit(
        &mut self,
        request: Request,
        reply: mpsc::Sender<Result<Value>>,
        now: u64,
    ) -> Result<()> {
        request.validate()?;
        if request.physical() && self.outputs_pending() {
            return Err("已有设备操作等待结果，请先等待或停止".into());
        }
        let bytes = compress(&serde_json::to_value(&request).map_err(|e| e.to_string())?)?;
        if request.stop() {
            self.cancel("已由停止操作取消");
            self.next_frame_at = now;
        }
        if self.jobs.len() >= 8 {
            return Err("数传请求队列已满，请等待当前请求完成".into());
        }
        self.next_id = self
            .next_id
            .checked_add(1)
            .ok_or("数传会话编号已用尽，请重启地面站")?;
        self.jobs.push_back(Job {
            id: self.next_id,
            request,
            chunks: bytes.chunks(CHUNK).map(|s| s.to_vec()).collect(),
            reply,
            started: now,
            upload: 0,
            download: vec![],
            count: None,
            last_tx: None,
            attempts: 0,
            sent: false,
        });
        Ok(())
    }
    fn finish(&mut self, result: Result<Value>, uncertain: bool) {
        if let Some(job) = self.jobs.pop_front() {
            self.completed.push(Completion {
                outputs: job.request.physical() || job.request.stop(),
                uncertain: (uncertain || job.request.stop() && result.is_err()) && job.sent,
                path: job.request.path,
            });
            let _ = job.reply.send(result);
        }
    }
    pub fn cancel(&mut self, reason: &str) {
        while !self.jobs.is_empty() {
            self.finish(Err(format!("{reason}；未重发操作，请同步设备状态")), true);
        }
    }
    pub fn disconnected(&mut self) {
        self.cancel("通信中断，执行结果未知");
        self.boot = None;
    }
    pub fn outputs_pending(&self) -> bool {
        self.jobs
            .iter()
            .any(|j| j.request.physical() || j.request.stop())
    }
    pub fn next(&mut self, now: u64) -> Option<(Frame, bool)> {
        if now < self.next_frame_at {
            return None;
        }
        let job = self.jobs.front_mut()?;
        if now.saturating_sub(job.started) > TIMEOUT_MS || job.attempts >= 6 {
            self.finish(
                Err("数传请求超时，结果未知；请读取状态，勿重复运动操作".into()),
                true,
            );
            self.boot = None;
            return None;
        }
        if job.last_tx.is_some_and(|t| now.saturating_sub(t) < 800) {
            return None;
        }
        let mut frame = Frame {
            kind: HELLO,
            session: self.session,
            boot: self.boot.unwrap_or(0),
            request: 0,
            index: 0,
            count: 0,
            data: vec![],
        };
        if self.boot.is_some() {
            frame.request = job.id;
            if job.upload < job.chunks.len() {
                frame.kind = REQUEST;
                frame.index = job.upload as u16;
                frame.count = job.chunks.len() as u16;
                frame.data = job.chunks[job.upload].clone();
                job.sent = true;
            } else {
                frame.kind = FETCH;
                frame.index = job.download.len() as u16;
            }
        }
        job.last_tx = Some(now);
        job.attempts += 1;
        self.next_frame_at = now + if job.request.stop() { 50 } else { 200 };
        Some((frame, job.request.stop()))
    }
    pub fn ingest(&mut self, bytes: &[u8], now: u64) {
        let Ok(frame) = Frame::decode(bytes) else {
            return;
        };
        if frame.session != self.session || self.jobs.is_empty() {
            return;
        }
        if frame.kind == READY && frame.request == 0 && self.boot.is_none() && frame.boot != 0 {
            self.boot = Some(frame.boot);
            if let Some(job) = self.jobs.front_mut() {
                job.attempts = 0;
                job.last_tx = None;
            }
            return;
        }
        let job = self.jobs.front_mut().unwrap();
        if frame.request != job.id {
            return;
        }
        if frame.boot != self.boot.unwrap_or(0) || frame.kind == ERROR {
            self.finish(
                Err("Jetson 数传会话变化或请求已失效，执行结果未知；请重新读取状态".into()),
                true,
            );
            self.boot = None;
            return;
        }
        match frame.kind {
            ACK if job.upload < job.chunks.len() && frame.index as usize == job.upload => {
                job.upload += 1;
                job.attempts = 0;
                job.last_tx = None;
            }
            WAIT if job.upload == job.chunks.len() => {
                job.attempts = 0;
                job.last_tx = Some(now);
            }
            RESPONSE
                if job.upload == job.chunks.len() && frame.index as usize == job.download.len() =>
            {
                if frame.count == 0
                    || frame.count as usize > MAX_WIRE.div_ceil(CHUNK)
                    || job.count.is_some_and(|n| n != frame.count)
                    || frame.index >= frame.count
                {
                    return;
                }
                job.count = Some(frame.count);
                job.download.push(frame.data);
                job.attempts = 0;
                job.last_tx = None;
                if job.download.len() == frame.count as usize {
                    let parsed = decompress(&job.download.concat());
                    let mut uncertain = true;
                    let result = parsed.and_then(|v| {
                        let status = v
                            .get("status")
                            .and_then(Value::as_u64)
                            .ok_or("数传响应缺少状态码")?;
                        let body = v.get("body").cloned().ok_or("数传响应缺少内容")?;
                        uncertain = status >= 500;
                        if !(200..300).contains(&status)
                            || body.get("success") == Some(&Value::Bool(false))
                        {
                            return Err(body
                                .get("message")
                                .and_then(Value::as_str)
                                .unwrap_or("ROS 请求失败")
                                .to_string());
                        }
                        Ok(body)
                    });
                    self.finish(result, uncertain);
                }
            }
            _ => {}
        }
    }
}
