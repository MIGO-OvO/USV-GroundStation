pub mod diagnostics;
#[cfg(any(windows, test))]
pub mod firmware;
pub mod identity;
pub mod maps;
pub mod mission;
pub mod payload;
pub mod ros;
pub mod ros_radio;
#[cfg(windows)]
pub mod serial;
pub mod station;
pub mod telemetry;
pub mod transport;
pub mod wire;
pub use mavlink_core::utils;

pub type Result<T> = std::result::Result<T, String>;
