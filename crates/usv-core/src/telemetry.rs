use crate::wire::{WireMessage, standard::*};
use mavlink::MavHeader;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

pub const PAYLOAD_FIELDS: [&str; 26] = [
    "USV_VOLT",
    "USV_ABS",
    "PUMP_X",
    "PUMP_Y",
    "PUMP_Z",
    "PUMP_A",
    "USV_STAT",
    "USV_PKT",
    "USV_STEP",
    "USV_STOT",
    "USV_LOOP",
    "USV_LTOT",
    "USV_SCNT",
    "USV_PERR",
    "USV_PMOD",
    "USV_BSET",
    "USV_REF",
    "USV_BASE",
    "USV_VLD",
    "USV_JTMP",
    "USV_ETMP",
    "USV_JCPU",
    "USV_JMEM",
    "USV_EHEAP",
    "USV_ADS",
    "USV_PROTO",
];
pub const FIELD_TTL_MS: u64 = 3000;
pub const HEARTBEAT_TTL_MS: u64 = 5000;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Field {
    pub value: f64,
    pub received_ms: u64,
    pub sequence: u64,
    pub source_component: u8,
}
impl Field {
    pub fn fresh(&self, now: u64) -> bool {
        now.saturating_sub(self.received_ms) <= FIELD_TTL_MS
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Telemetry {
    pub system_id: Option<u8>,
    pub component_id: Option<u8>,
    pub heartbeat_ms: Option<u64>,
    pub payload_heartbeat_ms: Option<u64>,
    pub payload_telemetry_ms: Option<u64>,
    pub fields: BTreeMap<String, Field>,
    pub track: Vec<[f64; 2]>,
    pub generation: u64,
    pub seen_packets: u64,
}
impl Telemetry {
    pub fn connected(&self, now: u64) -> bool {
        self.heartbeat_ms
            .is_some_and(|at| now.saturating_sub(at) <= HEARTBEAT_TTL_MS)
    }
    pub fn payload_online(&self, now: u64) -> bool {
        self.connected(now)
            && self
                .payload_heartbeat_ms
                .into_iter()
                .chain(self.payload_telemetry_ms)
                .max()
                .is_some_and(|at| now.saturating_sub(at) <= HEARTBEAT_TTL_MS)
    }
    pub fn get(&self, name: &str, now: u64) -> Option<f64> {
        self.fields
            .get(name)
            .filter(|f| f.fresh(now))
            .map(|f| f.value)
    }
    pub fn seq(&self, name: &str) -> u64 {
        self.fields.get(name).map_or(0, |f| f.sequence)
    }
    pub fn put(&mut self, name: &str, value: f64, now: u64, component: u8) {
        if !value.is_finite() {
            return;
        }
        let sequence = self.seq(name) + 1;
        self.fields.insert(
            name.into(),
            Field {
                value,
                received_ms: now,
                sequence,
                source_component: component,
            },
        );
    }
    pub fn reset_link(&mut self) {
        self.heartbeat_ms = None;
        self.payload_heartbeat_ms = None;
        self.payload_telemetry_ms = None;
        self.fields.clear();
        self.generation += 1;
    }
    /// A target is selected only by an ArduPilot Rover/boat autopilot heartbeat.
    /// A companion heartbeat can never become the flight controller.
    pub fn ingest(
        &mut self,
        h: MavHeader,
        m: &WireMessage,
        now: u64,
        requested: Option<u8>,
    ) -> bool {
        let Ok(system) = u8::try_from(h.system_id) else {
            return false;
        };
        let WireMessage::Standard(m) = m else {
            return false;
        };
        if let MavMessage::HEARTBEAT(b) = m
            && h.component_id == 1
            && h.system_id > 0
            && b.autopilot == MavAutopilot::MAV_AUTOPILOT_ARDUPILOTMEGA
            && matches!(
                b.mavtype,
                MavType::MAV_TYPE_SURFACE_BOAT | MavType::MAV_TYPE_GROUND_ROVER
            )
            && requested.is_none_or(|id| id == system)
            && self.system_id.is_none_or(|id| id == system)
        {
            self.system_id = Some(system);
            self.component_id = Some(h.component_id);
            self.heartbeat_ms = Some(now);
            self.put(
                "armed",
                if b.base_mode
                    .contains(MavModeFlag::MAV_MODE_FLAG_SAFETY_ARMED)
                {
                    1.0
                } else {
                    0.0
                },
                now,
                h.component_id,
            );
            self.put("mode", b.custom_mode as f64, now, h.component_id);
            self.put(
                "system_status",
                b.system_status as u8 as f64,
                now,
                h.component_id,
            );
        }
        if self.system_id != Some(system) {
            return false;
        }
        if h.component_id == 191 && matches!(m, MavMessage::HEARTBEAT(_)) {
            self.payload_heartbeat_ms = Some(now);
        }
        if let MavMessage::NAMED_VALUE_FLOAT(b) = m {
            if h.component_id != 191 && Some(h.component_id) != self.component_id {
                return false;
            }
            let Ok(name) = b.name.to_str() else {
                return false;
            };
            if PAYLOAD_FIELDS.contains(&name) && b.value.is_finite() {
                self.put(name, b.value as f64, now, h.component_id);
                self.payload_telemetry_ms = Some(now);
            }
            return true;
        }
        if Some(h.component_id) != self.component_id {
            return h.component_id == 191;
        }
        self.seen_packets += 1;
        match m {
            MavMessage::GPS_RAW_INT(b) => {
                self.put("gps_fix", b.fix_type as u8 as f64, now, h.component_id);
                if b.satellites_visible != 255 {
                    self.put(
                        "satellites",
                        b.satellites_visible as f64,
                        now,
                        h.component_id,
                    );
                }
                if b.eph != u16::MAX {
                    self.put("hdop", b.eph as f64 / 100.0, now, h.component_id);
                }
            }
            MavMessage::GLOBAL_POSITION_INT(b) => {
                let lat = b.lat as f64 / 1e7;
                let lon = b.lon as f64 / 1e7;
                if (-90.0..=90.0).contains(&lat) && (-180.0..=180.0).contains(&lon) {
                    self.put("latitude", lat, now, h.component_id);
                    self.put("longitude", lon, now, h.component_id);
                    if self.get("gps_fix", now).is_some_and(|v| v >= 3.0) {
                        let pos = [lon, lat];
                        if self.track.last() != Some(&pos) {
                            self.track.push(pos);
                            if self.track.len() > 10000 {
                                self.track.drain(..1000);
                            }
                        }
                    }
                }
                self.put(
                    "speed",
                    ((b.vx as f64).hypot(b.vy as f64)) / 100.0,
                    now,
                    h.component_id,
                );
                self.put(
                    "altitude",
                    b.relative_alt as f64 / 1000.0,
                    now,
                    h.component_id,
                );
                if b.hdg != u16::MAX {
                    self.put("heading", b.hdg as f64 / 100.0, now, h.component_id);
                }
            }
            MavMessage::ATTITUDE(b) => {
                self.put("roll", (b.roll as f64).to_degrees(), now, h.component_id);
                self.put("pitch", (b.pitch as f64).to_degrees(), now, h.component_id);
                self.put(
                    "yaw",
                    (b.yaw as f64).to_degrees().rem_euclid(360.0),
                    now,
                    h.component_id,
                );
            }
            MavMessage::SYS_STATUS(b) => {
                if b.voltage_battery != u16::MAX {
                    self.put(
                        "battery_voltage",
                        b.voltage_battery as f64 / 1000.0,
                        now,
                        h.component_id,
                    );
                }
                if b.battery_remaining >= 0 {
                    self.put(
                        "battery_percent",
                        b.battery_remaining as f64,
                        now,
                        h.component_id,
                    );
                }
                if b.current_battery != -1 {
                    self.put(
                        "battery_current",
                        b.current_battery as f64 / 100.0,
                        now,
                        h.component_id,
                    );
                }
            }
            MavMessage::VFR_HUD(b) => {
                self.put("speed", b.groundspeed as f64, now, h.component_id);
                self.put("heading", b.heading as f64, now, h.component_id);
            }
            MavMessage::MISSION_CURRENT(b) => {
                self.put("mission_current", b.seq as f64, now, h.component_id);
            }
            MavMessage::MISSION_ITEM_REACHED(b) => {
                self.put("mission_reached", b.seq as f64, now, h.component_id);
            }
            _ => {}
        }
        true
    }
}

pub fn mode_name(mode: u32) -> &'static str {
    match mode {
        0 => "MANUAL",
        1 => "ACRO",
        3 => "STEERING",
        4 => "HOLD",
        5 => "LOITER",
        6 => "FOLLOW",
        7 => "SIMPLE",
        10 => "AUTO",
        11 => "RTL",
        12 => "SMART_RTL",
        15 => "GUIDED",
        16 => "INITIALISING",
        _ => "UNKNOWN",
    }
}
