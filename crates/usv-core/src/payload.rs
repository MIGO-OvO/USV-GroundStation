use crate::{
    Result,
    identity::MAX_ID,
    telemetry::Telemetry,
    wire::{self, WireMessage},
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

pub fn safety_command(c: u16) -> bool {
    matches!(c, 31011 | 31016 | 31019)
}
pub fn task_command(c: u16) -> bool {
    matches!(c, 31010 | 31014 | 31015)
}
pub fn timeout_ms(c: u16) -> u64 {
    if c == 31018 {
        40000
    } else if safety_command(c) {
        15000
    } else {
        5000
    }
}
pub fn command_name(c: u16) -> &'static str {
    match c {
        31010 => "点采样",
        31011 => "停止采样及输出",
        31012 => "暂停采样",
        31013 => "恢复采样",
        31014 => "归零校准",
        31015 => "启动走航",
        31016 => "停止走航",
        31017 => "设置基线",
        31018 => "启动分光",
        31019 => "停止分光",
        _ => "未知命令",
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RequestState {
    Created,
    Sent,
    Accepted,
    Executing,
    Succeeded,
    Failed,
    Cancelled,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Stage {
    pub at_ms: u64,
    pub clock_id: String,
    pub name: String,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RequestRecord {
    pub id: String,
    pub target_system: u8,
    pub sender_system: u8,
    pub sender_component: u8,
    pub session: u32,
    pub request: u32,
    pub command: u16,
    pub params: [f32; 2],
    pub created_unix_ms: u64,
    pub clock_id: String,
    pub created_ms: u64,
    pub last_send_ms: Option<u64>,
    pub attempts: u8,
    pub retry_allowed: bool,
    pub generation: u64,
    pub state: RequestState,
    pub receipt: bool,
    pub seq: u32,
    pub retired: bool,
    pub observed_running: bool,
    pub end_status_seq: Option<u64>,
    pub stop_targets: Vec<String>,
    pub cleanup_failed: bool,
    pub event: Option<PayloadEvent>,
    pub timeline: Vec<Stage>,
}
impl RequestRecord {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        target: u8,
        sender: (u8, u8),
        identity: (u32, u32),
        command: u16,
        params: [f32; 2],
        now: u64,
        unix: u64,
        generation: u64,
        clock: &str,
    ) -> Self {
        let mut r = Self {
            id: uuid::Uuid::new_v4().to_string(),
            target_system: target,
            sender_system: sender.0,
            sender_component: sender.1,
            session: identity.0,
            request: identity.1,
            command,
            params,
            created_unix_ms: unix,
            clock_id: clock.into(),
            created_ms: now,
            last_send_ms: None,
            attempts: 0,
            retry_allowed: true,
            generation,
            state: RequestState::Created,
            receipt: false,
            seq: 0,
            retired: false,
            observed_running: false,
            end_status_seq: None,
            stop_targets: vec![],
            cleanup_failed: false,
            event: None,
            timeline: vec![],
        };
        r.stage(now, clock, "created", "UI 意图已在 Rust 创建请求");
        r
    }
    pub fn stage(&mut self, now: u64, clock: &str, name: &str, detail: &str) {
        self.timeline.push(Stage {
            at_ms: now,
            clock_id: clock.into(),
            name: name.into(),
            detail: detail.into(),
        });
        if self.timeline.len() > 256 {
            self.timeline.remove(1);
        }
    }
    pub fn message(&self) -> WireMessage {
        wire::command_long(
            self.target_system,
            191,
            self.command,
            [
                self.params[0],
                self.params[1],
                self.request as f32,
                self.session as f32,
                0.0,
                0.0,
                0.0,
            ],
            self.attempts,
        )
    }
    pub fn sent(&mut self, now: u64, clock: &str) {
        self.attempts += 1;
        self.last_send_ms = Some(now);
        if self.state == RequestState::Created {
            self.state = RequestState::Sent;
        }
        self.stage(
            now,
            clock,
            "sent",
            &format!("MAVLink 完整帧写入传输，发送次数 {}", self.attempts),
        );
    }
    pub fn needs_retry(&self, now: u64, generation: u64) -> bool {
        self.retry_allowed
            && !self.retired
            && !self.receipt
            && self.state != RequestState::Unknown
            && self.generation == generation
            && self.attempts < 3
            && self
                .last_send_ms
                .is_some_and(|at| now.saturating_sub(at) >= 1000)
            && now.saturating_sub(self.created_ms) < timeout_ms(self.command)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PayloadEvent {
    pub v: u8,
    pub session: u32,
    pub request: u32,
    pub seq: u32,
    pub command: u16,
    pub sender_system: u8,
    pub sender_component: u8,
    pub tcp_session: u32,
    pub phase: String,
    pub outcome: String,
    pub reason: String,
    pub attempt_id: String,
    pub preflight_phase: String,
    #[serde(default)]
    pub cleanup_failed: bool,
    #[serde(flatten)]
    pub details: serde_json::Map<String, serde_json::Value>,
}
impl PayloadEvent {
    pub fn parse(text: &str) -> Result<Self> {
        if text.len() > 750 {
            return Err("USVE1 超长".into());
        }
        let body = text.strip_prefix("USVE1:").ok_or("缺少 USVE1 前缀")?;
        let e: Self = serde_json::from_str(body).map_err(|e| format!("USVE1 JSON: {e}"))?;
        if e.v != 1
            || [e.session, e.request, e.seq, e.tcp_session]
                .iter()
                .any(|id| !(1..=MAX_ID).contains(id))
            || !(31010..=31019).contains(&e.command)
            || e.sender_system == 0
        {
            return Err("USVE1 身份无效".into());
        }
        if [
            &e.phase,
            &e.outcome,
            &e.reason,
            &e.attempt_id,
            &e.preflight_phase,
        ]
        .iter()
        .any(|s| s.len() > 80)
            || !["request", "progress", "terminal"].contains(&e.phase.as_str())
            || ![
                "",
                "accepted",
                "rejected",
                "unknown",
                "succeeded",
                "failed",
                "cancelled",
                "skipped",
            ]
            .contains(&e.outcome.as_str())
            || (!e.attempt_id.is_empty() && uuid::Uuid::parse_str(&e.attempt_id).is_err())
            || (e.phase == "terminal"
                && (e.attempt_id.is_empty()
                    || !["succeeded", "failed", "cancelled", "skipped"]
                        .contains(&e.outcome.as_str())))
        {
            return Err("USVE1 阶段、结果或 attempt 无效".into());
        }
        Ok(e)
    }
}

#[derive(Default)]
pub struct Reassembler {
    partials: HashMap<(u8, u8, u16), Partial>,
}
struct Partial {
    next: u8,
    start: u64,
    bytes: Vec<u8>,
}
impl Reassembler {
    pub fn clear(&mut self) {
        self.partials.clear();
    }
    pub fn push(
        &mut self,
        system: u8,
        component: u8,
        id: u16,
        seq: u8,
        text: &[u8],
        now: u64,
    ) -> Result<Option<String>> {
        self.partials
            .retain(|_, p| now.saturating_sub(p.start) <= 1000);
        let end = text.iter().position(|b| *b == 0);
        let part = &text[..end.unwrap_or(text.len())];
        if id == 0 {
            if seq != 0 {
                return Err("未分片文本的序号不为零".into());
            }
            return String::from_utf8(part.to_vec())
                .map(Some)
                .map_err(|e| e.to_string());
        }
        let key = (system, component, id);
        if seq == 0 {
            if self.partials.len() >= 64 && !self.partials.contains_key(&key) {
                return Err("STATUSTEXT 组装容量已满".into());
            }
            self.partials.insert(
                key,
                Partial {
                    next: 0,
                    start: now,
                    bytes: vec![],
                },
            );
        }
        let p = self
            .partials
            .get_mut(&key)
            .ok_or("STATUSTEXT 缺少首片或已过期")?;
        if seq != p.next || p.bytes.len() + part.len() > 750 {
            self.partials.remove(&key);
            return Err("STATUSTEXT 乱序、缺片或超长".into());
        }
        p.bytes.extend_from_slice(part);
        p.next += 1;
        if end.is_some() {
            let p = self.partials.remove(&key).expect("existing fragment");
            return String::from_utf8(p.bytes)
                .map(Some)
                .map_err(|e| e.to_string());
        }
        Ok(None)
    }
}

/// Request records remain available after timeout and retirement. A standard ACK
/// is deliberately absent from this transition function: it has no request ID.
pub fn apply_event(
    records: &mut [RequestRecord],
    event: PayloadEvent,
    target: u8,
    status_seq: u64,
    now: u64,
    clock: &str,
) -> Result<String> {
    let r = records
        .iter_mut()
        .find(|r| {
            r.target_system == target
                && r.sender_system == event.sender_system
                && r.sender_component == event.sender_component
                && r.session == event.session
                && r.request == event.request
                && r.command == event.command
        })
        .ok_or("USVE1 不属于已知请求")?;
    if event.seq <= r.seq {
        return Err("USVE1 序号重复或倒退".into());
    }
    let next_survey = r.command == 31015
        && r.event.as_ref().is_some_and(|e| {
            e.phase == "terminal" && e.outcome == "succeeded" && e.attempt_id != event.attempt_id
        })
        && !event.attempt_id.is_empty()
        && matches!(event.phase.as_str(), "progress" | "terminal");
    if r.retired || (r.event.as_ref().is_some_and(|e| e.phase == "terminal") && !next_survey) {
        r.stage(
            now,
            clock,
            "late_history",
            &format!("{} / {} / {}", event.phase, event.outcome, event.reason),
        );
        return Ok(r.id.clone());
    }
    r.seq = event.seq;
    r.cleanup_failed = event.cleanup_failed;
    r.stage(
        now,
        clock,
        &event.phase,
        &format!(
            "{} {} {}",
            event.outcome, event.reason, event.preflight_phase
        ),
    );
    if event.phase == "request" && event.outcome == "accepted" {
        r.receipt = true;
        r.state = if task_command(r.command) {
            RequestState::Accepted
        } else {
            RequestState::Succeeded
        };
    } else if event.phase == "request"
        && matches!(
            event.outcome.as_str(),
            "rejected" | "failed" | "cancelled" | "unknown"
        )
    {
        r.receipt = true;
        r.state = if event.outcome == "unknown" {
            RequestState::Unknown
        } else if event.outcome == "cancelled" {
            RequestState::Cancelled
        } else {
            RequestState::Failed
        };
        // An explicit admission rejection owns no physical work. An executor or
        // transport failure may have happened after hardware execution began.
        if event.outcome == "rejected" && !r.cleanup_failed {
            r.retired = true;
        } else if task_command(r.command) {
            r.end_status_seq = Some(status_seq);
        }
    } else if event.phase == "progress" {
        if !safety_command(r.command) {
            r.receipt = true;
            r.state = RequestState::Executing;
        }
    } else if event.phase == "terminal" {
        r.receipt = true;
        r.state = match event.outcome.as_str() {
            "succeeded" | "skipped" => RequestState::Succeeded,
            "cancelled" => RequestState::Cancelled,
            _ => RequestState::Failed,
        };
        if !(r.command == 31015 && event.outcome == "succeeded") {
            r.end_status_seq = Some(status_seq);
        }
    }
    r.event = Some(event);
    Ok(r.id.clone())
}

pub fn sync_tasks(records: &mut [RequestRecord], t: &Telemetry, now: u64, clock: &str) {
    let Some(status) = t.get("USV_STAT", now) else {
        return;
    };
    let seq = t.seq("USV_STAT");
    for r in records
        .iter_mut()
        .filter(|r| !r.retired && task_command(r.command) && Some(r.target_system) == t.system_id)
    {
        let running = match r.command {
            31014 => status == 4.0,
            31015 => [1.0, 2.0, 8.0, 11.0, 14.0].contains(&status),
            _ => [1.0, 2.0, 8.0, 11.0].contains(&status),
        };
        if running && r.attempts > 0 {
            r.observed_running = true;
        }
        if [0.0, 9.0, 12.0, 13.0].contains(&status)
            && !r.cleanup_failed
            && (r.end_status_seq.is_some_and(|basis| seq > basis) || r.observed_running)
        {
            r.retired = true;
            r.stage(now, clock, "synchronised", "已在结束依据后收到新静止状态");
        }
    }
}
