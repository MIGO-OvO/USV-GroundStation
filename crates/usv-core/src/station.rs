use crate::{
    Result,
    diagnostics::{Diagnostic, Journal, unix_ms},
    identity::IdentityStore,
    mission::{MissionDraft, MissionManager, MissionSnapshot},
    payload::{self, PayloadEvent, Reassembler, RequestRecord, RequestState},
    ros_radio,
    telemetry::Telemetry,
    transport::{ConnectionConfig, SavedConnection, Transport},
    wire::{self, WireMessage, standard::*},
};
use mavlink::{MavHeader, Message};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::{
    collections::VecDeque,
    path::Path,
    sync::{Arc, RwLock, mpsc},
    time::{Duration, Instant},
};

pub const SENDER: (u8, u8) = (254, 190);

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Intent {
    Connect {
        config: ConnectionConfig,
        target_system: Option<u8>,
    },
    Disconnect,
    RefreshPayload,
    Payload {
        command: u16,
        #[serde(default)]
        param1: f32,
        #[serde(default)]
        param2: f32,
        confirmed: bool,
    },
    Arm {
        armed: bool,
        confirmed: bool,
    },
    Mode {
        mode: u32,
        confirmed: bool,
    },
    EmergencyStop {
        confirmed: bool,
    },
    VerifyStop {
        onsite_confirmed: bool,
    },
    UploadMission {
        draft: MissionDraft,
        confirmed: bool,
    },
    DownloadMission,
    StopMission {
        confirmed: bool,
    },
}
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SafetyState {
    pub emergency_latched: bool,
    pub outputs_unknown: bool,
    pub propulsion_confirmed: bool,
    pub payload_confirmed: bool,
    pub stop_request: Option<String>,
    pub issued_ms: Option<u64>,
    pub clock_id: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Action {
    pub command: u16,
    pub label: String,
    pub allowed: bool,
    pub reason: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NavigationActions {
    pub arm: bool,
    pub disarm: bool,
    pub hold: bool,
    pub auto: bool,
    pub guided: bool,
    pub rtl: bool,
    pub mission_start: bool,
    pub upload: bool,
    pub verify_stop: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FlightRequest {
    pub id: String,
    pub command: u16,
    pub name: String,
    pub state: String,
    pub created_ms: u64,
    pub sent_ms: Option<u64>,
    pub ack_result: Option<u8>,
    pub desired_field: Option<String>,
    pub desired_value: Option<f64>,
    pub baseline_seq: u64,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Snapshot {
    pub now_ms: u64,
    pub unix_ms: u64,
    pub clock_id: String,
    pub link: String,
    pub connection: Option<ConnectionConfig>,
    pub saved_connection: Option<SavedConnection>,
    pub connection_error: Option<String>,
    pub error: Option<String>,
    pub identity_error: Option<String>,
    pub log_error: Option<String>,
    pub telemetry: Telemetry,
    pub payload_online: bool,
    pub requests: Vec<RequestRecord>,
    pub flight_requests: Vec<FlightRequest>,
    pub safety: SafetyState,
    pub actions: Vec<Action>,
    pub navigation: NavigationActions,
    pub mission: MissionSnapshot,
    pub diagnostics: Vec<Diagnostic>,
    pub rejected_frames: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum Tag {
    RosRadio,
    Payload(String),
    Flight(String),
    Mission,
    Heartbeat,
    PayloadRead,
    Setup(u32),
}
struct Packet {
    message: WireMessage,
    bytes: Vec<u8>,
    offset: usize,
    tag: Tag,
    queued: u64,
}

/// The worker owns this object and every socket. Tests drive the same engine
/// with a deterministic clock and byte transport fixtures.
pub struct Engine {
    ros_radio: ros_radio::Client,
    pub telemetry: Telemetry,
    pub records: Vec<RequestRecord>,
    pub safety: SafetyState,
    pub mission: MissionManager,
    pub flight: Vec<FlightRequest>,
    pub clock_id: String,
    store: Option<IdentityStore>,
    identity_error: Option<String>,
    journal: Journal,
    config: Option<ConnectionConfig>,
    saved_connection: Option<SavedConnection>,
    connection_error: Option<String>,
    requested_system: Option<u8>,
    transport: Option<Transport>,
    decoder: wire::Decoder,
    assembler: Reassembler,
    queue: VecDeque<Packet>,
    sequence: u8,
    last_heartbeat: u64,
    reconnect_at: u64,
    was_connected: bool,
    was_payload_online: bool,
    error: Option<String>,
    full_stop_basis: Option<(String, u64)>,
    streams_requested: bool,
    last_payload_read: Option<u64>,
    payload_link_recovery_requested: bool,
    payload_read_cursor: usize,
}
impl Engine {
    pub fn new(directory: &Path) -> Self {
        let clock_id = uuid::Uuid::new_v4().to_string();
        let opened = IdentityStore::open(&directory.join("identity.sqlite"));
        let (store, mut identity_error) = match opened {
            Ok(s) => (Some(s), None),
            Err(e) => (None, Some(e)),
        };
        let mut records = vec![];
        let mut safety = SafetyState::default();
        let mut saved_connection = None;
        let mut connection_error = None;
        if let Some(s) = &store {
            match s.load() {
                Ok(v) => records = v,
                Err(e) => identity_error = Some(e),
            }
            match s.meta("safety") {
                Ok(v) => safety = v,
                Err(e) => identity_error = Some(e),
            }
            match s.meta::<Option<SavedConnection>>("connection") {
                Ok(Some(profile)) => match profile.validate() {
                    Ok(()) => saved_connection = Some(profile),
                    Err(e) => connection_error = Some(format!("已保存的连接配置无效：{e}")),
                },
                Ok(None) => {}
                Err(e) => connection_error = Some(format!("读取连接配置失败：{e}")),
            }
        }
        for r in &mut records {
            r.retry_allowed = false;
            if !r.retired && payload::task_command(r.command) {
                r.state = RequestState::Unknown;
                r.end_status_seq = None;
                r.observed_running = false;
                safety.outputs_unknown = true;
            }
            if !r.retired && !payload::task_command(r.command) && !r.receipt {
                r.state = RequestState::Unknown;
            }
        }
        let generation = records.iter().map(|r| r.generation).max().unwrap_or(0) + 1;
        if safety.emergency_latched {
            safety.propulsion_confirmed = false;
            safety.payload_confirmed = false;
            safety.issued_ms = None;
            safety.stop_request = None;
        }
        let mut engine = Self {
            ros_radio: ros_radio::Client::default(),
            telemetry: Telemetry {
                generation,
                ..Default::default()
            },
            records,
            safety,
            mission: MissionManager::default(),
            flight: vec![],
            clock_id,
            store,
            identity_error,
            journal: Journal::open(&directory.join("logs")),
            config: saved_connection.as_ref().map(|p| p.config.clone()),
            requested_system: saved_connection.as_ref().and_then(|p| p.target_system),
            saved_connection,
            connection_error,
            transport: None,
            decoder: wire::Decoder::default(),
            assembler: Reassembler::default(),
            queue: VecDeque::new(),
            sequence: 0,
            last_heartbeat: 0,
            reconnect_at: 0,
            was_connected: false,
            was_payload_online: false,
            error: None,
            full_stop_basis: None,
            streams_requested: false,
            last_payload_read: None,
            payload_link_recovery_requested: false,
            payload_read_cursor: 0,
        };
        if let Some(store) = &engine.store {
            match store.meta::<bool>("ros_radio_inflight") {
                Ok(true) => {
                    engine.safety.outputs_unknown = true;
                }
                Ok(_) => {}
                Err(e) => engine.identity_error = Some(e),
            }
        }
        if engine.config.is_some() {
            engine.log(0, "connection_restored", "local", None, None, None,
                json!({"connection":engine.saved_connection,"recovery":"observe_only_no_start_replay"}));
        }
        engine
    }
    #[expect(
        clippy::too_many_arguments,
        reason = "One boundary logger records fixed MAVLink identity fields"
    )]
    fn log(
        &mut self,
        now: u64,
        kind: &str,
        direction: &str,
        header: Option<MavHeader>,
        message: Option<&WireMessage>,
        request: Option<&RequestRecord>,
        mut detail: serde_json::Value,
    ) {
        if matches!(message, Some(WireMessage::Standard(MavMessage::V2_EXTENSION(data))) if data.message_type == ros_radio::MESSAGE_TYPE)
        {
            detail = json!({"name":"V2_EXTENSION","ros_radio":"content_redacted"});
        }
        self.journal.append(Diagnostic {
            index: 0,
            unix_ms: unix_ms(),
            mono_ms: now,
            clock_id: self.clock_id.clone(),
            kind: kind.into(),
            direction: direction.into(),
            system: header.and_then(|h| u8::try_from(h.system_id).ok()),
            component: header.map(|h| h.component_id),
            message_id: message.map(Message::message_id),
            mav_sequence: header.map(|h| h.sequence),
            command: request.map(|r| r.command),
            request: request.map(|r| r.request),
            session: request.map(|r| r.session),
            detail,
        });
    }
    fn persist(&mut self) {
        if let Some(store) = &self.store {
            let result = store.save_state(&self.records, &self.safety);
            if let Err(e) = result {
                self.identity_error = Some(e);
            }
        }
    }
    fn request_ros_radio(
        &mut self,
        request: ros_radio::Request,
        confirmed: bool,
        reply: mpsc::Sender<Result<serde_json::Value>>,
        now: u64,
    ) {
        let result = (|| {
            request.validate()?;
            if !self.telemetry.connected(now) {
                return Err("请先连接数传并等待飞控心跳".into());
            }
            if request.physical() {
                if !confirmed {
                    return Err("请确认设备操作".into());
                }
                if self.safety.emergency_latched
                    || self.safety.outputs_unknown
                    || self.identity_error.is_some()
                {
                    return Err("停止保护尚未解除，暂不能操作设备".into());
                }
                self.store
                    .as_ref()
                    .ok_or("身份存储不可用")?
                    .set_meta("ros_radio_inflight", &true)?;
            }
            if request.stop() {
                if let Some(store) = &self.store
                    && let Err(error) = store.set_meta("ros_radio_inflight", &true)
                {
                    self.identity_error = Some(error);
                }
                self.queue
                    .retain(|p| p.offset > 0 || p.tag != Tag::RosRadio);
            }
            self.ros_radio.submit(request, reply.clone(), now)
        })();
        if let Err(error) = result {
            let _ = reply.send(Err(error));
            self.persist();
            if let Some(store) = &self.store
                && let Err(e) =
                    store.set_meta("ros_radio_inflight", &self.ros_radio.outputs_pending())
            {
                self.identity_error = Some(e);
            }
        }
        self.finish_ros_radio(now);
    }
    fn finish_ros_radio(&mut self, now: u64) {
        let completed = std::mem::take(&mut self.ros_radio.completed);
        if completed.is_empty() {
            return;
        }
        self.queue
            .retain(|p| p.offset > 0 || p.tag != Tag::RosRadio);
        for result in completed {
            if result.outputs && result.uncertain {
                self.safety.outputs_unknown = true;
            }
            self.log(
                now,
                "ros_radio_result",
                "local",
                None,
                None,
                None,
                json!({"path":result.path,"uncertain":result.uncertain}),
            );
        }
        self.persist();
        if let Some(store) = &self.store
            && let Err(e) = store.set_meta("ros_radio_inflight", &self.ros_radio.outputs_pending())
        {
            self.identity_error = Some(e);
        }
    }
    pub fn payload_gate(&self, c: u16, now: u64) -> Result<()> {
        if !(31010..=31019).contains(&c) {
            return Err("载荷命令不在 31010 至 31019 范围".into());
        }
        if !self.telemetry.connected(now) {
            return Err("等待飞控心跳".into());
        }
        if self
            .records
            .iter()
            .any(|r| !r.receipt && !r.retired && r.command == c && r.state != RequestState::Unknown)
        {
            return Err("该命令正在等待回执".into());
        }
        if payload::safety_command(c) {
            return Ok(());
        }
        if self.identity_error.is_some() {
            return Err("请求身份存储不可用，请检查应用数据目录".into());
        }
        if !self.telemetry.payload_online(now) || self.telemetry.get("USV_PROTO", now) != Some(1.0)
        {
            return Err("等待载荷心跳及 USV_PROTO=1".into());
        }
        if self.safety.emergency_latched || self.safety.outputs_unknown {
            return Err("先确认停止并同步设备状态".into());
        }
        if self.records.iter().any(|r| {
            payload::safety_command(r.command) && !r.receipt && r.state != RequestState::Unknown
        }) {
            return Err("停止命令尚未确认".into());
        }
        if payload::task_command(c)
            && self
                .records
                .iter()
                .any(|r| !r.retired && payload::task_command(r.command))
        {
            return Err("已有载荷任务，先停止或等待任务结束".into());
        }
        if matches!(c, 31010 | 31015) {
            if self.telemetry.get("USV_VLD", now) != Some(1.0)
                || self.telemetry.get("USV_BSET", now) != Some(1.0)
                || self.telemetry.get("USV_VOLT", now).is_none()
            {
                return Err("需要新鲜的有效分光帧与基线".into());
            }
            if !self
                .telemetry
                .get("USV_STAT", now)
                .is_some_and(|s| [0.0, 9.0, 12.0].contains(&s))
            {
                return Err("等待载荷回到可采样状态".into());
            }
        }
        if c == 31014
            && ["PUMP_X", "PUMP_Y", "PUMP_Z", "PUMP_A"]
                .iter()
                .any(|f| self.telemetry.get(f, now).is_none_or(|v| v < 0.0))
        {
            return Err("等待四轴已校准角度反馈".into());
        }
        if c == 31012
            && self
                .telemetry
                .get("USV_STAT", now)
                .is_none_or(|s| ![1.0, 2.0].contains(&s))
        {
            return Err("当前没有可暂停的采样".into());
        }
        if c == 31013 && self.telemetry.get("USV_STAT", now) != Some(11.0) {
            return Err("当前采样未暂停".into());
        }
        if c == 31017
            && (self.telemetry.get("USV_VLD", now) != Some(1.0)
                || self.telemetry.get("USV_VOLT", now).is_none())
        {
            return Err("等待有效分光帧".into());
        }
        Ok(())
    }
    fn nav_gate(&self, mode: Option<u32>, armed: bool, now: u64) -> Result<()> {
        if !self.telemetry.connected(now) {
            return Err("等待飞控心跳".into());
        }
        if !armed || mode == Some(4) {
            return Ok(());
        }
        if self.safety.emergency_latched
            || self.safety.outputs_unknown
            || self.identity_error.is_some()
        {
            return Err("先确认停止并恢复控制状态".into());
        }
        if mode.is_none() && self.telemetry.get("armed", now) != Some(0.0) {
            return Err("等待新鲜的推进上锁状态".into());
        }
        if matches!(mode, Some(10 | 11 | 15))
            && (self.telemetry.get("gps_fix", now).is_none_or(|v| v < 3.0)
                || self.telemetry.get("latitude", now).is_none()
                || self.telemetry.get("longitude", now).is_none())
        {
            return Err("等待新鲜 GPS 定位及位置".into());
        }
        Ok(())
    }
    fn enqueue(&mut self, message: WireMessage, tag: Tag, now: u64, priority: bool) -> Result<()> {
        if self.queue.iter().any(|p| p.tag == tag) {
            return Ok(());
        }
        if self.queue.len() >= 128 {
            return Err("发送队列已满".into());
        }
        let header = MavHeader {
            system_id: SENDER.0 as u32,
            component_id: SENDER.1,
            sequence: self.sequence,
        };
        self.sequence = self.sequence.wrapping_add(1);
        let bytes = wire::encode(header, &message)?;
        let packet = Packet {
            message,
            bytes,
            offset: 0,
            tag,
            queued: now,
        };
        if priority {
            // Preempt only before a complete MAVLink frame. A partial TCP frame
            // must finish or the connection must be retired.
            let at = usize::from(self.queue.front().is_some_and(|p| p.offset > 0));
            self.queue.insert(at, packet);
        } else {
            self.queue.push_back(packet);
        }
        Ok(())
    }
    fn request_payload_state(&mut self, now: u64) -> Result<()> {
        if !self.telemetry.connected(now) {
            return Err("等待飞控心跳后重读载荷状态".into());
        }
        if self
            .last_payload_read
            .is_some_and(|at| now.saturating_sub(at) < 2000)
        {
            return Ok(());
        }
        let system = self.telemetry.system_id.ok_or("飞控未识别")?;
        // A missing result must not monopolise recovery for every older request.
        let index = (0..self.records.len())
            .map(|offset| (self.payload_read_cursor + offset) % self.records.len())
            .find(|&index| {
                let r = &self.records[index];
                !r.retired && r.state == RequestState::Unknown
            })
            .or_else(|| self.records.iter().rposition(|r| !r.retired));
        let unresolved = index.map(|index| &self.records[index]);
        let (session, request, command) =
            unresolved.map_or((0, 0, 0), |r| (r.session, r.request, r.command));
        let request_id = unresolved.map(|r| r.id.clone());
        let missing_fields = ["USV_STAT", "USV_PROTO", "USV_ADS"]
            .into_iter()
            .filter(|name| self.telemetry.get(name, now).is_none())
            .collect::<Vec<_>>();
        // A component broadcast can still reach ROS when the FCU/router has
        // lost its component-191 route. This fallback is for read-only 512.
        let target_component = if self.last_payload_read.is_some() && !missing_fields.is_empty() {
            0
        } else {
            191
        };
        self.enqueue(
            wire::command_long(
                system,
                target_component,
                512,
                [
                    251.0,
                    session as f32,
                    request as f32,
                    command as f32,
                    if self.payload_link_recovery_requested {
                        1.0
                    } else {
                        0.0
                    },
                    0.0,
                    0.0,
                ],
                0,
            ),
            Tag::PayloadRead,
            now,
            false,
        )?;
        self.last_payload_read = Some(now);
        self.payload_read_cursor = index.map_or(0, |index| index + 1);
        self.log(
            now,
            "payload_state_read",
            "local",
            None,
            None,
            None,
            json!({"target":[system,target_component],"message_id":251,
                "recover_request_id":request_id,"missing_fields":missing_fields,
                "link_recovery_requested":self.payload_link_recovery_requested}),
        );
        self.payload_link_recovery_requested = false;
        Ok(())
    }
    fn create_payload(&mut self, command: u16, params: [f32; 2], now: u64) -> Result<String> {
        self.payload_gate(command, now)?;
        if params.iter().any(|v| !v.is_finite()) {
            return Err("命令参数必须是有限数值".into());
        }
        let identity = match self
            .store
            .as_mut()
            .map(IdentityStore::next_request)
            .transpose()
        {
            Ok(Some(v)) => v,
            Ok(None) | Err(_) if payload::safety_command(command) => (0, 0),
            Ok(None) => return Err("身份存储不可用".into()),
            Err(e) => return Err(e),
        };
        let mut r = RequestRecord::new(
            self.telemetry.system_id.ok_or("飞控未识别")?,
            SENDER,
            identity,
            command,
            params,
            now,
            unix_ms(),
            self.telemetry.generation,
            &self.clock_id,
        );
        if payload::safety_command(command) {
            r.stop_targets = self
                .records
                .iter()
                .filter(|old| {
                    !old.retired
                        && payload::task_command(old.command)
                        && (command == 31011 || command == 31016 && old.command == 31015)
                })
                .map(|old| old.id.clone())
                .collect();
            for old in self
                .records
                .iter_mut()
                .filter(|old| r.stop_targets.contains(&old.id))
            {
                old.retry_allowed = false;
            }
        }
        if let Some(store) = &self.store
            && let Err(e) = store.save(&r)
        {
            if !payload::safety_command(command) {
                return Err(e);
            }
            self.identity_error = Some(e);
        }
        let id = r.id.clone();
        let message = r.message();
        self.log(
            now,
            "request_created",
            "local",
            None,
            Some(&message),
            Some(&r),
            json!({"params":params,"stop_targets":r.stop_targets}),
        );
        self.records.push(r);
        if command == 31011 && self.safety.emergency_latched {
            self.safety.stop_request = Some(id.clone());
        }
        if let Err(e) = self.enqueue(
            message,
            Tag::Payload(id.clone()),
            now,
            payload::safety_command(command),
        ) {
            if let Some(r) = self.records.last_mut() {
                r.retired = true;
                r.state = RequestState::Failed;
                r.stage(now, &self.clock_id, "send_failed", &e);
            }
            return Err(e);
        }
        self.persist();
        Ok(id)
    }
    fn create_flight(
        &mut self,
        command: u16,
        params: [f32; 7],
        name: &str,
        desired: Option<(&str, f64)>,
        now: u64,
        priority: bool,
    ) -> Result<String> {
        if !priority
            && self
                .flight
                .iter()
                .any(|r| r.state == "sent" || r.state == "created")
        {
            return Err("飞控命令仍在等待状态确认".into());
        }
        let id = uuid::Uuid::new_v4().to_string();
        let r = FlightRequest {
            id: id.clone(),
            command,
            name: name.into(),
            state: "created".into(),
            created_ms: now,
            sent_ms: None,
            ack_result: None,
            desired_field: desired.map(|p| p.0.into()),
            desired_value: desired.map(|p| p.1),
            baseline_seq: desired.map_or(0, |p| self.telemetry.seq(p.0)),
        };
        self.enqueue(
            wire::command_long(
                self.telemetry.system_id.ok_or("未识别飞控")?,
                1,
                command,
                params,
                0,
            ),
            Tag::Flight(id.clone()),
            now,
            priority,
        )?;
        self.flight.push(r);
        if self.flight.len() > 64 {
            self.flight.remove(0);
        }
        Ok(id)
    }
    pub fn intent(&mut self, intent: Intent, now: u64) -> Result<serde_json::Value> {
        if matches!(
            &intent,
            Intent::EmergencyStop { confirmed: true }
                | Intent::Payload {
                    command: 31011 | 31016 | 31019,
                    ..
                }
        ) {
            self.ros_radio.cancel("已由停止操作取消");
            self.finish_ros_radio(now);
        }
        self.log(
            now,
            "ui_intent",
            "local",
            None,
            None,
            None,
            serde_json::to_value(&intent).map_err(|e| e.to_string())?,
        );
        match intent {
            Intent::Connect {
                config,
                target_system,
            } => {
                let profile = SavedConnection {
                    config: config.clone(),
                    target_system,
                };
                profile.validate()?;
                let saved = self
                    .store
                    .as_ref()
                    .ok_or_else(|| "连接配置存储不可用".to_string())
                    .and_then(|store| store.set_meta("connection", &profile));
                self.connection_error = saved.err().map(|e| format!("保存连接配置失败：{e}"));
                if self.connection_error.is_none() {
                    self.saved_connection = Some(profile);
                }
                if self.config.is_some() {
                    self.lose_link(now, "操作员切换连接");
                }
                self.telemetry = Telemetry {
                    generation: self.telemetry.generation + 1,
                    ..Default::default()
                };
                self.config = Some(config);
                self.requested_system = target_system;
                self.reconnect_at = now;
                self.error = None;
                Ok(json!({"connecting":true}))
            }
            Intent::Disconnect => {
                self.lose_link(now, "操作员断开连接");
                self.config = None;
                Ok(json!({"disconnected":true}))
            }
            Intent::RefreshPayload => {
                if !self.telemetry.connected(now) {
                    return Err("等待飞控心跳后重读载荷状态".into());
                }
                self.payload_link_recovery_requested = true;
                self.request_payload_state(now)?;
                Ok(json!({"reading":true}))
            }
            Intent::Payload {
                command,
                param1,
                param2,
                confirmed,
            } => {
                if !confirmed {
                    return Err("操作员尚未确认载荷操作".into());
                }
                self.create_payload(command, [param1, param2], now)
                    .map(|id| json!({"request_id":id}))
            }
            Intent::Arm { armed, confirmed } => {
                if !confirmed {
                    return Err("操作员尚未确认解锁/上锁".into());
                }
                self.nav_gate(None, armed, now)?;
                self.create_flight(
                    400,
                    [if armed { 1.0 } else { 0.0 }, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
                    if armed { "解锁" } else { "上锁" },
                    Some(("armed", if armed { 1.0 } else { 0.0 })),
                    now,
                    !armed,
                )
                .map(|id| json!({"request_id":id}))
            }
            Intent::Mode { mode, confirmed } => {
                if !confirmed {
                    return Err("操作员尚未确认模式切换".into());
                }
                if ![0, 4, 5, 10, 11, 12, 15].contains(&mode) {
                    return Err("此 ArduRover 模式未开放".into());
                }
                self.nav_gate(Some(mode), true, now)?;
                if self.mission.busy() && mode == 10 {
                    return Err("任务传输尚未完成".into());
                }
                self.create_flight(
                    176,
                    [1.0, mode as f32, 0.0, 0.0, 0.0, 0.0, 0.0],
                    crate::telemetry::mode_name(mode),
                    Some(("mode", mode as f64)),
                    now,
                    mode == 4,
                )
                .map(|id| json!({"request_id":id}))
            }
            Intent::EmergencyStop { confirmed } => {
                if !confirmed {
                    return Err("操作员尚未确认急停".into());
                }
                self.nav_gate(None, false, now)?;
                self.safety = SafetyState {
                    emergency_latched: true,
                    outputs_unknown: true,
                    issued_ms: Some(now),
                    clock_id: self.clock_id.clone(),
                    ..Default::default()
                };
                self.persist();
                self.queue
                    .retain(|p| p.offset > 0 || matches!(p.tag, Tag::Heartbeat));
                for r in &mut self.records {
                    r.retry_allowed = false;
                }
                for r in &mut self.flight {
                    if r.state == "sent" || r.state == "created" {
                        r.state = "unknown".into();
                    }
                }
                let propulsion = self.create_flight(
                    400,
                    [0.0, 21196.0, 0.0, 0.0, 0.0, 0.0, 0.0],
                    "推进急停",
                    Some(("armed", 0.0)),
                    now,
                    true,
                );
                let payload = self.create_payload(31011, [0.0, 0.0], now);
                if let Ok(id) = &payload {
                    self.safety.stop_request = Some(id.clone());
                }
                self.persist();
                Ok(json!({"propulsion":propulsion,"payload":payload}))
            }
            Intent::VerifyStop { onsite_confirmed } => {
                if !onsite_confirmed || !self.can_verify_stop(now) {
                    return Err("需推进已上锁、全输出停止回执、后续静止遥测及现场确认".into());
                }
                self.safety.emergency_latched = false;
                self.safety.outputs_unknown = false;
                self.persist();
                Ok(json!({"released":true}))
            }
            Intent::UploadMission { draft, confirmed } => {
                if !confirmed {
                    return Err("操作员尚未确认替换飞控任务".into());
                }
                self.nav_gate(None, true, now)?;
                if self.telemetry.get("armed", now) != Some(0.0)
                    || self.telemetry.get("mode", now) == Some(10.0)
                {
                    return Err("先上锁并退出 AUTO，再上传任务".into());
                }
                let messages = self.mission.start_upload(
                    draft,
                    (self.telemetry.system_id.ok_or("未识别飞控")?, 1),
                    SENDER,
                    now,
                )?;
                for m in messages {
                    self.enqueue(m, Tag::Mission, now, false)?;
                }
                Ok(json!({"uploading":true}))
            }
            Intent::DownloadMission => {
                self.nav_gate(None, false, now)?;
                let messages = self.mission.start_download(
                    (self.telemetry.system_id.ok_or("未识别飞控")?, 1),
                    SENDER,
                    now,
                )?;
                for m in messages {
                    self.enqueue(m, Tag::Mission, now, false)?;
                }
                Ok(json!({"downloading":true}))
            }
            Intent::StopMission { confirmed } => {
                if !confirmed {
                    return Err("操作员尚未确认停止任务".into());
                }
                self.nav_gate(Some(4), false, now)?;
                self.mission.abort("操作员停止任务传输");
                self.queue.retain(|p| p.offset > 0 || p.tag != Tag::Mission);
                let navigation = self.create_flight(
                    176,
                    [1.0, 4.0, 0.0, 0.0, 0.0, 0.0, 0.0],
                    "停止任务航行",
                    Some(("mode", 4.0)),
                    now,
                    true,
                );
                let payload = self.create_payload(31011, [0.0, 0.0], now);
                Ok(json!({"navigation":navigation,"payload":payload}))
            }
        }
    }
    fn can_verify_stop(&self, now: u64) -> bool {
        self.telemetry.connected(now)
            && self.telemetry.payload_online(now)
            && self.telemetry.get("armed", now) == Some(0.0)
            && self.safety.propulsion_confirmed
            && self.safety.payload_confirmed
            && !self.safety.outputs_unknown
            && self
                .telemetry
                .get("USV_STAT", now)
                .is_some_and(|s| [0.0, 3.0, 9.0, 12.0, 13.0].contains(&s))
    }
    pub fn ingest(&mut self, header: MavHeader, message: WireMessage, now: u64) {
        self.log(
            now,
            "mavlink",
            "rx",
            Some(header),
            Some(&message),
            None,
            json!({"name":message.message_name(),"decoded":format!("{message:?}")}),
        );
        let _ = self
            .telemetry
            .ingest(header, &message, now, self.requested_system);
        if self.telemetry.system_id.map(u32::from) != Some(header.system_id) {
            return;
        }
        if let WireMessage::Standard(MavMessage::V2_EXTENSION(data)) = &message
            && header.component_id == 191
            && data.message_type == ros_radio::MESSAGE_TYPE
            && data.target_system == SENDER.0
            && data.target_component == SENDER.1
        {
            self.ros_radio.ingest(&data.payload, now);
            self.finish_ros_radio(now);
        }
        if !self.streams_requested && self.telemetry.connected(now) {
            self.streams_requested = true;
            for (id, interval) in [
                (1, 1000000.0),
                (24, 500000.0),
                (30, 200000.0),
                (33, 200000.0),
                (42, 1000000.0),
                (74, 500000.0),
            ] {
                let _ = self.enqueue(
                    wire::command_long(
                        header.system_id as u8,
                        1,
                        511,
                        [id as f32, interval, 0.0, 0.0, 0.0, 0.0, 0.0],
                        0,
                    ),
                    Tag::Setup(id),
                    now,
                    false,
                );
            }
        }
        if let WireMessage::Standard(MavMessage::STATUSTEXT(s)) = &message
            && header.component_id == 191
        {
            let result = self.assembler.push(
                header.system_id as u8,
                header.component_id,
                s.id,
                s.chunk_seq,
                &s.text[..],
                now,
            );
            self.log(
                now,
                "statustext_fragment",
                "rx",
                Some(header),
                Some(&message),
                None,
                json!({"id":s.id,"chunk":s.chunk_seq}),
            );
            match result {
                Ok(Some(text)) if text.starts_with("USVE1:") => match PayloadEvent::parse(&text) {
                    Ok(event) => {
                        let cmd = event.command;
                        let accepted = event.phase == "request" && event.outcome == "accepted";
                        let result = payload::apply_event(
                            &mut self.records,
                            event.clone(),
                            header.system_id as u8,
                            self.telemetry.seq("USV_STAT"),
                            now,
                            &self.clock_id,
                        );
                        if let Ok(id) = &result {
                            if accepted {
                                self.apply_stop(id, cmd, now);
                                if !payload::task_command(cmd)
                                    && let Some(r) = self.records.iter_mut().find(|r| r.id == *id)
                                {
                                    r.retired = true;
                                }
                            }
                            self.log(
                                now,
                                "usve1",
                                "rx",
                                Some(header),
                                None,
                                None,
                                json!({"request_id":id,"event":event}),
                            );
                            self.persist();
                        } else {
                            self.log(
                                now,
                                "usve1_ignored",
                                "rx",
                                Some(header),
                                None,
                                None,
                                json!({"error":result.err(),"event":event}),
                            );
                        }
                    }
                    Err(e) => self.log(
                        now,
                        "usve1_invalid",
                        "rx",
                        Some(header),
                        None,
                        None,
                        json!({"error":e,"text":text}),
                    ),
                },
                Ok(Some(text)) => self.log(
                    now,
                    "statustext",
                    "rx",
                    Some(header),
                    None,
                    None,
                    json!({"text":text}),
                ),
                Err(e) => self.log(
                    now,
                    "fragment_rejected",
                    "rx",
                    Some(header),
                    None,
                    None,
                    json!({"error":e}),
                ),
                _ => {}
            }
        }
        if let WireMessage::Command(wire::commands::MavMessage::COMMAND_ACK(ack)) = &message
            && (ack.target_system == SENDER.0 || ack.target_system == 0)
            && (ack.target_component == SENDER.1 || ack.target_component == 0)
        {
            if header.component_id == 191 && (31010..=31019).contains(&ack.command) {
                let candidates: Vec<_> = self
                    .records
                    .iter()
                    .filter(|r| {
                        r.target_system == header.system_id as u8 && r.command == ack.command
                    })
                    .map(|r| r.id.clone())
                    .collect();
                self.log(now,"ack_unattributed","rx",Some(header),Some(&message),None,json!({"command":ack.command,"result":ack.result,"candidate_requests":candidates,"association":"command_only"}));
                // Only an identity-less compatibility STOP may use the
                // unique in-flight ACK. Correlated requests never do.
                let legacy: Vec<_> = self
                    .records
                    .iter()
                    .enumerate()
                    .filter(|(_, r)| {
                        r.command == ack.command && r.session == 0 && !r.receipt && !r.retired
                    })
                    .map(|(i, _)| i)
                    .collect();
                if legacy.len() == 1 && payload::safety_command(ack.command) && ack.result != 5 {
                    let r = &mut self.records[legacy[0]];
                    r.receipt = true;
                    r.state = if ack.result == 0 {
                        RequestState::Succeeded
                    } else {
                        RequestState::Failed
                    };
                    r.stage(
                        now,
                        &self.clock_id,
                        "legacy_ack",
                        "无关联 STOP 的唯一在途标准 ACK",
                    );
                    let id = r.id.clone();
                    if ack.result == 0 {
                        self.apply_stop(&id, ack.command, now);
                    }
                    self.persist();
                }
            } else if header.component_id == 1 {
                for r in self
                    .flight
                    .iter_mut()
                    .filter(|r| r.command == ack.command && r.state == "sent")
                {
                    r.ack_result = Some(ack.result);
                }
            }
        }
        if header.component_id == 1 {
            match self.mission.on_message(&message, now) {
                Ok(messages) => {
                    for m in messages {
                        if let Err(e) = self.enqueue(m, Tag::Mission, now, false) {
                            self.mission.abort(&e);
                        }
                    }
                }
                Err(e) => self.mission.abort(&e),
            }
        }
        self.sync(now);
    }
    fn apply_stop(&mut self, id: &str, command: u16, now: u64) {
        if !payload::safety_command(command) {
            return;
        }
        let Some(stop) = self.records.iter().find(|r| r.id == id) else {
            return;
        };
        if stop.retired || stop.generation != self.telemetry.generation {
            return;
        }
        let targets = stop.stop_targets.clone();
        let sequence = self.telemetry.seq("USV_STAT");
        if command != 31019 {
            for r in self
                .records
                .iter_mut()
                .filter(|r| targets.contains(&r.id) && !r.retired)
            {
                r.end_status_seq = Some(sequence);
                r.cleanup_failed = false;
                r.retry_allowed = false;
                r.stage(
                    now,
                    &self.clock_id,
                    "stop_confirmed",
                    &format!("命令 {command} 已确认，等待新静止状态"),
                );
            }
        }
        if command == 31011 {
            self.full_stop_basis = Some((id.into(), sequence));
            if self.safety.emergency_latched && self.safety.stop_request.as_deref() == Some(id) {
                self.safety.payload_confirmed = true;
            }
        }
    }
    fn sync(&mut self, now: u64) {
        let before = self.records.iter().filter(|r| r.retired).count();
        payload::sync_tasks(&mut self.records, &self.telemetry, now, &self.clock_id);
        if let Some((_, seq)) = &self.full_stop_basis
            && self.telemetry.seq("USV_STAT") > *seq
            && self
                .telemetry
                .get("USV_STAT", now)
                .is_some_and(|s| [0.0, 3.0, 9.0, 12.0, 13.0].contains(&s))
        {
            self.safety.outputs_unknown = false;
            self.full_stop_basis = None;
            self.persist();
        }
        for r in &mut self.flight {
            if (r.state == "sent" || r.state == "unknown")
                && r.sent_ms.is_some()
                && r.desired_field.as_ref().is_some_and(|field| {
                    self.telemetry.seq(field) > r.baseline_seq
                        && self.telemetry.get(field, now) == r.desired_value
                })
            {
                r.state = "confirmed".into();
                if r.name == "推进急停"
                    && self.safety.clock_id == self.clock_id
                    && self.safety.issued_ms.is_some_and(|at| r.created_ms >= at)
                {
                    self.safety.propulsion_confirmed = true;
                }
            }
        }
        if self.records.iter().filter(|r| r.retired).count() != before {
            if !self.safety.emergency_latched
                && !self
                    .records
                    .iter()
                    .any(|r| !r.retired && payload::task_command(r.command))
            {
                self.safety.outputs_unknown = false;
            }
            self.persist();
        }
    }
    pub fn lose_link(&mut self, now: u64, reason: &str) {
        self.ros_radio.disconnected();
        self.finish_ros_radio(now);
        self.transport = None;
        self.queue.clear();
        self.decoder.clear();
        self.assembler.clear();
        self.full_stop_basis = None;
        self.streams_requested = false;
        self.last_payload_read = None;
        self.payload_link_recovery_requested = false;
        self.payload_read_cursor = 0;
        for r in self.records.iter_mut().filter(|r| !r.retired) {
            r.retry_allowed = false;
            if payload::task_command(r.command) || !r.receipt {
                r.state = RequestState::Unknown;
                r.observed_running = false;
                r.end_status_seq = None;
                r.stage(now, &self.clock_id, "link_lost", reason);
            }
            if payload::task_command(r.command) {
                self.safety.outputs_unknown = true;
            }
        }
        for r in self
            .flight
            .iter_mut()
            .filter(|r| r.state == "sent" || r.state == "created")
        {
            r.state = "unknown".into();
            r.desired_field = None;
        }
        if self.safety.emergency_latched {
            self.safety.propulsion_confirmed = false;
            self.safety.payload_confirmed = false;
            self.safety.stop_request = None;
        }
        self.telemetry.reset_link();
        self.mission.abort("连接中断，任务传输未验证");
        self.error = Some(reason.into());
        self.reconnect_at = now + 2000;
        self.was_connected = false;
        self.was_payload_online = false;
        self.log(
            now,
            "link_lost",
            "local",
            None,
            None,
            None,
            json!({"reason":reason,"recovery":"observe_only_no_start_replay"}),
        );
        self.persist();
    }
    pub fn tick(&mut self, now: u64) {
        if self.was_connected && !self.telemetry.connected(now) {
            self.lose_link(now, "飞控心跳超时");
        }
        if self.telemetry.connected(now)
            && !self.queue.iter().any(|p| p.tag == Tag::RosRadio)
            && let Some((frame, priority)) = self.ros_radio.next(now)
            && let Some(target) = self.telemetry.system_id
            && let Ok(message) = frame.message(target)
        {
            let _ = self.enqueue(message, Tag::RosRadio, now, priority);
        }
        self.finish_ros_radio(now);
        let payload_online = self.telemetry.payload_online(now);
        if self.was_payload_online != payload_online && self.telemetry.connected(now) {
            self.log(
                now,
                if payload_online { "payload_link_restored" } else { "payload_link_lost" },
                "local", None, None, None,
                json!({"heartbeat_ms": self.telemetry.payload_heartbeat_ms,
                    "telemetry_ms": self.telemetry.payload_telemetry_ms,
                    "reason": if payload_online { "fresh_payload_evidence" } else { "no_payload_heartbeat_or_telemetry_for_5s" }}),
            );
        }
        if self.was_payload_online && !payload_online && self.telemetry.connected(now) {
            for r in self
                .records
                .iter_mut()
                .filter(|r| !r.retired && payload::task_command(r.command))
            {
                r.state = RequestState::Unknown;
                r.retry_allowed = false;
                self.safety.outputs_unknown = true;
                r.stage(
                    now,
                    &self.clock_id,
                    "payload_offline",
                    "载荷心跳与遥测均超时，保留请求身份",
                );
            }
            self.queue
                .retain(|p| p.offset > 0 || !matches!(p.tag, Tag::Payload(_)));
            self.persist();
        }
        self.was_connected = self.telemetry.connected(now);
        self.was_payload_online = payload_online;
        if self.telemetry.connected(now)
            && (self.payload_link_recovery_requested
                || !payload_online
                || ["USV_STAT", "USV_PROTO", "USV_ADS"]
                    .iter()
                    .any(|name| self.telemetry.get(name, now).is_none())
                || self
                    .records
                    .iter()
                    .any(|r| !r.retired && r.state == RequestState::Unknown))
        {
            let _ = self.request_payload_state(now);
        }
        for r in self
            .records
            .iter_mut()
            .filter(|r| !r.receipt && !r.retired && r.state != RequestState::Unknown)
        {
            if now.saturating_sub(r.created_ms) >= payload::timeout_ms(r.command) {
                r.state = RequestState::Unknown;
                r.retry_allowed = false;
                r.stage(
                    now,
                    &self.clock_id,
                    "timeout",
                    "未收到关联回执，设备执行情况待同步",
                );
                if payload::task_command(r.command) {
                    self.safety.outputs_unknown = true;
                }
            }
        }
        let retries: Vec<_> = self
            .records
            .iter()
            .filter(|r| {
                r.needs_retry(now, self.telemetry.generation) && self.telemetry.connected(now)
            })
            .map(|r| {
                (
                    r.id.clone(),
                    r.message(),
                    payload::safety_command(r.command),
                )
            })
            .collect();
        for (id, message, priority) in retries {
            let _ = self.enqueue(message, Tag::Payload(id), now, priority);
        }
        for r in self
            .flight
            .iter_mut()
            .filter(|r| r.state == "sent" || r.state == "created")
        {
            if now.saturating_sub(r.created_ms) > 5000 {
                r.state = "unknown".into();
            }
        }
        for message in self.mission.tick(now) {
            let _ = self.enqueue(message, Tag::Mission, now, false);
        }
        self.queue.retain(|p| {
            p.offset > 0
                || match &p.tag {
                    Tag::Payload(id) => {
                        self.records.iter().find(|r| r.id == *id).is_some_and(|r| {
                            !r.receipt
                                && !r.retired
                                && r.state != RequestState::Unknown
                                && r.retry_allowed
                        })
                    }
                    Tag::Flight(id) => self
                        .flight
                        .iter()
                        .find(|r| r.id == *id)
                        .is_some_and(|r| r.state != "unknown"),
                    _ => true,
                }
        });
        self.sync(now);
    }
    fn network(&mut self, now: u64) {
        if self.transport.is_none() && self.config.is_some() && now >= self.reconnect_at {
            let attempt = Instant::now();
            match Transport::open(self.config.as_ref().expect("configured")) {
                Ok(t) => {
                    self.transport = Some(t);
                    self.error = None;
                    self.log(
                        now,
                        "transport_open",
                        "local",
                        None,
                        None,
                        None,
                        json!({"config":self.config}),
                    );
                }
                Err(e) => {
                    self.error = Some(e);
                    self.reconnect_at = now + attempt.elapsed().as_millis() as u64 + 2000;
                }
            }
        }
        let mut buffer = [0u8; 16384];
        for _ in 0..64 {
            let Some(t) = self.transport.as_mut() else {
                break;
            };
            let datagram = t.datagram();
            match t.read(&mut buffer) {
                Ok((n, from)) => {
                    let old_rejected = self.decoder.rejected;
                    let messages = self.decoder.push(&buffer[..n]);
                    if datagram {
                        self.decoder.clear();
                    }
                    if self.decoder.rejected > old_rejected {
                        self.log(
                            now,
                            "frame_rejected",
                            "rx",
                            None,
                            None,
                            None,
                            json!({"total":self.decoder.rejected}),
                        );
                    }
                    for (h, m) in messages {
                        self.ingest(h, m, now);
                        if let Some(from) = from
                            && self.telemetry.system_id.map(u32::from) == Some(h.system_id)
                            && h.component_id == 1
                            && self.telemetry.connected(now)
                            && let Some(t) = self.transport.as_mut()
                        {
                            t.set_discovered_peer(from);
                        }
                    }
                }
                Err(e)
                    if matches!(
                        e.kind(),
                        std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                    ) =>
                {
                    break;
                }
                Err(e) => {
                    self.lose_link(now, &format!("传输读取失败: {e}"));
                    break;
                }
            }
        }
        if self.transport.is_some() && now.saturating_sub(self.last_heartbeat) >= 1000 {
            self.last_heartbeat = now;
            let m = MavMessage::HEARTBEAT(HEARTBEAT_DATA {
                mavtype: MavType::MAV_TYPE_GCS,
                autopilot: MavAutopilot::MAV_AUTOPILOT_INVALID,
                mavlink_version: 3,
                system_status: MavState::MAV_STATE_ACTIVE,
                ..Default::default()
            })
            .into();
            let _ = self.enqueue(m, Tag::Heartbeat, now, false);
        }
        for _ in 0..32 {
            let Some(t) = self.transport.as_mut() else {
                break;
            };
            let Some(p) = self.queue.front_mut() else {
                break;
            };
            if now.saturating_sub(p.queued) > 1000 && p.offset > 0 {
                self.lose_link(now, "部分 MAVLink 帧发送超时，退役传输会话");
                break;
            }
            match t.write(&p.bytes[p.offset..]) {
                Ok(0) => {
                    self.lose_link(now, "传输写入返回零");
                    break;
                }
                Ok(n) => {
                    if t.datagram() && n != p.bytes.len() {
                        self.lose_link(now, "UDP 短写");
                        break;
                    }
                    p.offset += n;
                    if p.offset == p.bytes.len() {
                        let packet = self.queue.pop_front().expect("front packet");
                        self.sent(packet, now);
                    } else {
                        break;
                    }
                }
                Err(e)
                    if matches!(
                        e.kind(),
                        std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                    ) =>
                {
                    if now.saturating_sub(p.queued) > 1000 {
                        self.log(
                            now,
                            "send_deferred",
                            "tx",
                            None,
                            None,
                            None,
                            json!({"offset":0}),
                        );
                    }
                    break;
                }
                Err(e)
                    if e.kind() == std::io::ErrorKind::NotConnected && p.tag == Tag::Heartbeat =>
                {
                    self.queue.pop_front();
                    break;
                }
                Err(e) => {
                    self.lose_link(now, &format!("传输写入失败: {e}"));
                    break;
                }
            }
        }
    }
    fn sent(&mut self, p: Packet, now: u64) {
        match &p.tag {
            Tag::Payload(id) => {
                if let Some(r) = self.records.iter_mut().find(|r| r.id == *id) {
                    r.sent(now, &self.clock_id);
                }
                self.persist();
            }
            Tag::Flight(id) => {
                if let Some(r) = self.flight.iter_mut().find(|r| r.id == *id) {
                    r.sent_ms = Some(now);
                    r.state = "sent".into();
                    r.baseline_seq = r
                        .desired_field
                        .as_ref()
                        .map_or(0, |f| self.telemetry.seq(f));
                }
            }
            _ => {}
        }
        let rec = match &p.tag {
            Tag::Payload(id) => self.records.iter().find(|r| r.id == *id).cloned(),
            _ => None,
        };
        let header = MavHeader {
            system_id: SENDER.0 as u32,
            component_id: SENDER.1,
            sequence: p.bytes[4],
        };
        self.log(now,"mavlink","tx",Some(header),Some(&p.message),rec.as_ref(),json!({"name":p.message.message_name(),"hex":p.bytes.iter().map(|b|format!("{b:02x}")).collect::<String>(),"decoded":format!("{:?}",p.message)}));
    }
    pub fn snapshot(&self, now: u64) -> Snapshot {
        let connected = self.telemetry.connected(now);
        let unlocked = !self.safety.emergency_latched
            && !self.safety.outputs_unknown
            && self.identity_error.is_none();
        let gps = self.telemetry.get("gps_fix", now).is_some_and(|v| v >= 3.0)
            && self.telemetry.get("latitude", now).is_some()
            && self.telemetry.get("longitude", now).is_some();
        let actions = (31010..=31019)
            .map(|command| {
                let result = self.payload_gate(command, now);
                Action {
                    command,
                    label: payload::command_name(command).into(),
                    allowed: result.is_ok(),
                    reason: result.err().unwrap_or_default(),
                }
            })
            .collect();
        Snapshot {
            now_ms: now,
            unix_ms: unix_ms(),
            clock_id: self.clock_id.clone(),
            link: if connected {
                "connected"
            } else if self.config.is_some() {
                "connecting"
            } else {
                "disconnected"
            }
            .into(),
            connection: self.config.clone(),
            saved_connection: self.saved_connection.clone(),
            connection_error: self.connection_error.clone(),
            error: self.error.clone(),
            identity_error: self.identity_error.clone(),
            log_error: self.journal.error.clone(),
            telemetry: self.telemetry.clone(),
            payload_online: self.telemetry.payload_online(now),
            requests: self
                .records
                .iter()
                .enumerate()
                .filter(|(i, r)| *i + 100 >= self.records.len() || !r.retired)
                .map(|(_, r)| r.clone())
                .collect(),
            flight_requests: self.flight.clone(),
            safety: self.safety.clone(),
            actions,
            navigation: NavigationActions {
                arm: connected && unlocked && self.telemetry.get("armed", now) == Some(0.0),
                disarm: connected,
                hold: connected,
                auto: connected && unlocked && gps && !self.mission.busy(),
                guided: connected && unlocked && gps,
                rtl: connected && unlocked && gps,
                mission_start: connected
                    && unlocked
                    && gps
                    && self.mission.snapshot.verified
                    && self.telemetry.get("armed", now) == Some(1.0),
                upload: connected
                    && unlocked
                    && self.telemetry.get("armed", now) == Some(0.0)
                    && !self.mission.busy(),
                verify_stop: self.can_verify_stop(now),
            },
            mission: self.mission.snapshot.clone(),
            diagnostics: self
                .journal
                .records
                .iter()
                .rev()
                .take(160)
                .cloned()
                .collect(),
            rejected_frames: self.decoder.rejected,
        }
    }
}

enum Operation {
    RosRadio(
        ros_radio::Request,
        bool,
        mpsc::Sender<Result<serde_json::Value>>,
    ),
    Intent(Intent, mpsc::Sender<Result<serde_json::Value>>),
    Export(Option<serde_json::Value>, mpsc::Sender<Result<Vec<u8>>>),
}
#[derive(Clone)]
pub struct Station {
    sender: mpsc::Sender<Operation>,
    snapshot: Arc<RwLock<Snapshot>>,
}
impl Station {
    pub fn start(directory: &Path) -> Result<Self> {
        std::fs::create_dir_all(directory).map_err(|e| e.to_string())?;
        let mut engine = Engine::new(directory);
        let snapshot = Arc::new(RwLock::new(engine.snapshot(0)));
        let shared = snapshot.clone();
        let (sender, receiver) = mpsc::channel();
        std::thread::Builder::new()
            .name("usv-control".into())
            .spawn(move || {
                let started = Instant::now();
                let mut published = 0;
                loop {
                    let now = started.elapsed().as_millis() as u64;
                    for _ in 0..16 {
                        match receiver.try_recv() {
                            Ok(Operation::RosRadio(request, confirmed, reply)) => {
                                engine.request_ros_radio(request, confirmed, reply, now);
                            }
                            Ok(Operation::Intent(intent, reply)) => {
                                let result = engine.intent(intent, now);
                                if let Err(e) = &result {
                                    engine.log(
                                        now,
                                        "intent_rejected",
                                        "local",
                                        None,
                                        None,
                                        None,
                                        json!({"error":e}),
                                    );
                                }
                                let _ = reply.send(result);
                            }
                            Ok(Operation::Export(ros, reply)) => {
                                let s = engine.snapshot(now);
                                let _ = reply.send(engine.journal.export(&s, ros.as_ref()));
                            }
                            Err(mpsc::TryRecvError::Empty) => break,
                            Err(mpsc::TryRecvError::Disconnected) => {
                                engine.persist();
                                return;
                            }
                        }
                    }
                    engine.network(now);
                    engine.tick(now);
                    if now.saturating_sub(published) >= 100 {
                        if let Ok(mut s) = shared.write() {
                            *s = engine.snapshot(now);
                        }
                        published = now;
                    }
                    std::thread::sleep(Duration::from_millis(10));
                }
            })
            .map_err(|e| e.to_string())?;
        Ok(Self { sender, snapshot })
    }
    pub fn snapshot(&self) -> Result<Snapshot> {
        self.snapshot
            .read()
            .map(|s| s.clone())
            .map_err(|e| e.to_string())
    }
    pub fn dispatch(&self, intent: Intent) -> Result<serde_json::Value> {
        let (tx, rx) = mpsc::channel();
        self.sender
            .send(Operation::Intent(intent, tx))
            .map_err(|e| e.to_string())?;
        rx.recv_timeout(Duration::from_secs(5))
            .map_err(|e| e.to_string())?
    }
    pub fn ros_control(
        &self,
        request: ros_radio::Request,
        confirmed: bool,
    ) -> Result<serde_json::Value> {
        let (tx, rx) = mpsc::channel();
        self.sender
            .send(Operation::RosRadio(request, confirmed, tx))
            .map_err(|e| e.to_string())?;
        rx.recv_timeout(Duration::from_millis(ros_radio::TIMEOUT_MS + 5000))
            .map_err(|e| e.to_string())?
    }
    pub fn export(&self, ros: Option<serde_json::Value>) -> Result<Vec<u8>> {
        let (tx, rx) = mpsc::channel();
        self.sender
            .send(Operation::Export(ros, tx))
            .map_err(|e| e.to_string())?;
        rx.recv_timeout(Duration::from_secs(10))
            .map_err(|e| e.to_string())?
    }
}
