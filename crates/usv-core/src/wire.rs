use mavlink::{MavlinkVersion, Message, error::ParserError};
pub use mavlink::dialects::ardupilotmega as standard;

#[allow(clippy::all, unused_parens, unreachable_patterns, unexpected_cfgs)]
mod generated { include!(concat!(env!("OUT_DIR"), "/mod.rs")); }
pub use generated::usv as commands;

/// Only the three command messages need open numeric command IDs. All framing,
/// CRC validation and other ArduPilot message layouts use rust-mavlink.
#[derive(Debug, Clone, PartialEq)]
pub enum WireMessage {
    Standard(standard::MavMessage),
    Command(commands::MavMessage),
}

impl From<standard::MavMessage> for WireMessage {
    fn from(m: standard::MavMessage) -> Self { Self::Standard(m) }
}
impl From<commands::MavMessage> for WireMessage {
    fn from(m: commands::MavMessage) -> Self { Self::Command(m) }
}

macro_rules! delegate {
    ($self:ident, $method:ident $(,$arg:ident)*) => {
        match $self { Self::Standard(m) => m.$method($($arg),*), Self::Command(m) => m.$method($($arg),*) }
    };
}

impl Message for WireMessage {
    fn message_id(&self) -> u32 { delegate!(self, message_id) }
    fn message_name(&self) -> &'static str { delegate!(self, message_name) }
    fn target_system_id(&self) -> Option<u8> { delegate!(self, target_system_id) }
    fn target_component_id(&self) -> Option<u8> { delegate!(self, target_component_id) }
    fn target_system_id_mut(&mut self) -> Option<&mut u8> { delegate!(self, target_system_id_mut) }
    fn target_component_id_mut(&mut self) -> Option<&mut u8> { delegate!(self, target_component_id_mut) }
    fn ser(&self, v: MavlinkVersion, bytes: &mut [u8]) -> usize { delegate!(self, ser, v, bytes) }
    fn parse(v: MavlinkVersion, id: u32, bytes: &[u8]) -> std::result::Result<Self, ParserError> {
        if matches!(id, 75..=77) { commands::MavMessage::parse(v,id,bytes).map(Self::Command) }
        else { standard::MavMessage::parse(v,id,bytes).map(Self::Standard) }
    }
    fn message_id_from_name(name: &str) -> Option<u32> {
        commands::MavMessage::message_id_from_name(name).or_else(|| standard::MavMessage::message_id_from_name(name))
    }
    fn default_message_from_id(id: u32) -> Option<Self> {
        if matches!(id,75..=77) { commands::MavMessage::default_message_from_id(id).map(Self::Command) }
        else { standard::MavMessage::default_message_from_id(id).map(Self::Standard) }
    }
    fn extra_crc(id: u32) -> u8 {
        if matches!(id,75..=77) { commands::MavMessage::extra_crc(id) } else { standard::MavMessage::extra_crc(id) }
    }
}

pub fn command_long(target: u8, component: u8, command: u16, params: [f32;7], confirmation: u8) -> WireMessage {
    commands::MavMessage::COMMAND_LONG(commands::COMMAND_LONG_DATA {
        target_system: target, target_component: component, command, confirmation,
        param1:params[0],param2:params[1],param3:params[2],param4:params[3],
        param5:params[4],param6:params[5],param7:params[6],
    }).into()
}

pub fn encode(header: mavlink::MavHeader, message: &WireMessage) -> crate::Result<Vec<u8>> {
    let mut bytes = Vec::with_capacity(280);
    mavlink::write_v2_msg(&mut bytes, header, message).map_err(|e| e.to_string())?;
    Ok(bytes)
}

/// A bounded stream buffer retains partial TCP frames across reads. The MAVLink
/// library verifies each candidate; corrupt candidates resynchronise by one byte.
#[derive(Default)]
pub struct Decoder { bytes: Vec<u8>, pub rejected: u64 }
impl Decoder {
    pub fn push(&mut self, bytes: &[u8]) -> Vec<(mavlink::MavHeader, WireMessage)> {
        self.bytes.extend_from_slice(bytes);
        if self.bytes.len() > 65536 { self.bytes.clear(); self.rejected += 1; return vec![]; }
        let mut messages = vec![];
        loop {
            let Some(start) = self.bytes.iter().position(|b| *b == 0xfd || *b == 0xfe) else { self.bytes.clear(); break; };
            self.bytes.drain(..start);
            if self.bytes.len() < 3 { break; }
            let v2 = self.bytes[0] == 0xfd;
            let signed = v2 && self.bytes[2] & 1 != 0;
            let len = self.bytes[1] as usize + if v2 {12} else {8} + if signed {13} else {0};
            if self.bytes.len() < len { break; }
            // Signed links require authentication configuration, which this
            // release does not expose. Never silently accept unverified signing.
            if signed { self.bytes.drain(..len); self.rejected += 1; continue; }
            let frame = &self.bytes[..len];
            let mut reader = mavlink::MavlinkReader::new(frame);
            let parsed = reader.read_message::<WireMessage>(if v2 {MavlinkVersion::V2}else{MavlinkVersion::V1});
            match parsed {
                Ok(m) => { messages.push(m); self.bytes.drain(..len); }
                Err(_) => { self.rejected += 1; self.bytes.remove(0); }
            }
        }
        messages
    }
    pub fn clear(&mut self) { self.bytes.clear(); }
}
