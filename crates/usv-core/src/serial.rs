use crate::Result;
use regex::Regex;
use serde::{Deserialize, Serialize};
use serialport::SerialPortType;
use std::{collections::HashMap, sync::LazyLock};
use windows::{
    Win32::{
        Devices::{DeviceAndDriverInstallation::*, Properties::*},
        Foundation::{DEVPROPKEY, ERROR_NO_MORE_ITEMS},
        System::Registry::{KEY_QUERY_VALUE, RRF_RT_REG_SZ, RegCloseKey, RegGetValueW},
    },
    core::{PCWSTR, w},
};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DeviceKind {
    #[serde(alias = "Pixhawk")]
    FlightController,
    #[serde(alias = "SiK Radio")]
    TelemetryRadio,
    #[serde(alias = "RTK GPS")]
    RtkGps,
    #[serde(alias = "OpenPilot")]
    OpenPilot,
    UsbSerial,
    Bluetooth,
    Other,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
pub struct UsbDevice {
    pub vid: u16,
    pub pid: u16,
    pub serial_number: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
pub struct SerialDevice {
    pub port: String,
    pub kind: DeviceKind,
    pub label: String,
    pub description: Option<String>,
    pub instance_id: Option<String>,
    pub usb: Option<UsbDevice>,
    pub bootloader_hint: bool,
}

impl SerialDevice {
    pub(crate) fn can_flash(&self) -> bool {
        self.kind == DeviceKind::FlightController && self.usb.is_some()
    }

    pub(crate) fn same_endpoint(&self, other: &Self) -> bool {
        self.port == other.port && self.instance_id == other.instance_id && self.usb == other.usb
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct BoardEntry {
    #[serde(rename = "vendorID")]
    vendor: u16,
    #[serde(rename = "productID")]
    product: u16,
    board_class: DeviceKind,
    name: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct BoardFallback {
    reg_exp: String,
    board_class: DeviceKind,
    #[serde(default)]
    android_only: bool,
}

struct BoardCatalog {
    boards: Vec<BoardEntry>,
    description: Vec<(Regex, DeviceKind)>,
    manufacturer: Vec<(Regex, DeviceKind)>,
}

static CATALOG: LazyLock<BoardCatalog> = LazyLock::new(|| {
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Data {
        board_info: Vec<BoardEntry>,
        board_description_fallback: Vec<BoardFallback>,
        board_manufacturer_fallback: Vec<BoardFallback>,
    }
    fn compile(entries: Vec<BoardFallback>) -> Vec<(Regex, DeviceKind)> {
        entries
            .into_iter()
            .filter(|entry| !entry.android_only)
            .map(|entry| {
                let pattern = regex::RegexBuilder::new(&entry.reg_exp)
                    .case_insensitive(true)
                    .build()
                    .expect("valid USB board pattern");
                (pattern, entry.board_class)
            })
            .collect()
    }
    // QGroundControl v5.1.5 USBBoardInfo, Apache-2.0. See THIRD_PARTY_NOTICES.md.
    let data: Data =
        serde_json::from_str(include_str!("usb-board-info.json")).expect("valid USB board catalog");
    BoardCatalog {
        boards: data.board_info,
        description: compile(data.board_description_fallback),
        manufacturer: compile(data.board_manufacturer_fallback),
    }
});

fn identify(vid: u16, pid: u16, pnp: &PnpPort) -> (DeviceKind, String) {
    if (vid, pid) == (0x3162, 0x0053) {
        return (DeviceKind::FlightController, "Holybro Pixhawk 6C".into());
    }
    let entry = CATALOG
        .boards
        .iter()
        .find(|entry| entry.vendor == vid && (entry.product == pid || entry.product == 0));
    let fallback = [
        (pnp.description.as_deref(), &CATALOG.description),
        (pnp.manufacturer.as_deref(), &CATALOG.manufacturer),
    ];
    let kind = entry
        .map(|entry| entry.board_class)
        .or_else(|| {
            fallback.into_iter().find_map(|(text, patterns)| {
                let text = text?;
                patterns
                    .iter()
                    .find(|(re, _)| re.is_match(text))
                    .map(|(_, kind)| *kind)
            })
        })
        .unwrap_or(DeviceKind::UsbSerial);
    let name = pnp
        .description
        .clone()
        .or_else(|| entry.map(|entry| entry.name.clone()))
        .or_else(|| pnp.friendly.clone())
        .unwrap_or_else(|| "USB 串口设备".into());
    (kind, name)
}

/// Enumerate present ports and their PnP metadata without opening a COM handle.
pub fn available() -> Result<Vec<SerialDevice>> {
    let pnp = pnp_ports()?;
    let mut devices: Vec<_> = serialport::available_ports()
        .map_err(|e| e.to_string())?
        .into_iter()
        .map(|port| {
            let info = pnp.get(&port.port_name).cloned().unwrap_or_default();
            let (kind, label, usb) = match port.port_type {
                SerialPortType::UsbPort(usb) => {
                    let (kind, label) = identify(usb.vid, usb.pid, &info);
                    (
                        kind,
                        label,
                        Some(UsbDevice {
                            vid: usb.vid,
                            pid: usb.pid,
                            serial_number: info.serial_number,
                        }),
                    )
                }
                SerialPortType::BluetoothPort => (DeviceKind::Bluetooth, "蓝牙串口".into(), None),
                _ => (
                    DeviceKind::Other,
                    info.friendly.unwrap_or_else(|| "串口设备".into()),
                    None,
                ),
            };
            let bootloader_hint = kind == DeviceKind::FlightController
                && info.description.as_deref().is_some_and(bootloader_name);
            SerialDevice {
                port: port.port_name,
                kind,
                label,
                usb,
                instance_id: info.instance_id,
                description: info.description,
                bootloader_hint,
            }
        })
        .collect();
    devices.sort_by_key(|device| {
        device
            .port
            .strip_prefix("COM")
            .and_then(|name| name.parse::<u32>().ok())
    });
    Ok(devices)
}

fn bootloader_name(name: &str) -> bool {
    let name = name.to_ascii_lowercase();
    name.contains("bootloader")
        || name
            .split(|c: char| !c.is_ascii_alphanumeric())
            .any(|word| word == "bl")
}

#[derive(Clone, Default)]
struct PnpPort {
    description: Option<String>,
    friendly: Option<String>,
    manufacturer: Option<String>,
    instance_id: Option<String>,
    serial_number: Option<String>,
}

struct DeviceList(HDEVINFO);
impl Drop for DeviceList {
    fn drop(&mut self) {
        // The set is live until this owner is dropped.
        let _ = unsafe { SetupDiDestroyDeviceInfoList(self.0) };
    }
}

fn pnp_ports() -> Result<HashMap<String, PnpPort>> {
    // SetupAPI returns metadata for present devices, including occupied ports.
    let devices = DeviceList(
        unsafe {
            SetupDiGetClassDevsW(
                Some(&GUID_DEVCLASS_PORTS),
                PCWSTR::null(),
                None,
                DIGCF_PRESENT,
            )
        }
        .map_err(|e| e.to_string())?,
    );
    let mut result = HashMap::new();
    for index in 0.. {
        let mut device = SP_DEVINFO_DATA {
            cbSize: size_of::<SP_DEVINFO_DATA>() as u32,
            ..Default::default()
        };
        // All pointers refer to initialized buffers or values for the duration of the calls.
        unsafe {
            if let Err(error) = SetupDiEnumDeviceInfo(devices.0, index, &mut device) {
                if error.code() == ERROR_NO_MORE_ITEMS.to_hresult() {
                    break;
                }
                return Err(error.to_string());
            }
            let Ok(key) = SetupDiOpenDevRegKey(
                devices.0,
                &device,
                DICS_FLAG_GLOBAL.0,
                0,
                DIREG_DEV,
                KEY_QUERY_VALUE.0,
            ) else {
                continue;
            };
            let mut buffer = [0u16; 32];
            let mut len = size_of_val(&buffer) as u32;
            let name = RegGetValueW(
                key,
                PCWSTR::null(),
                w!("PortName"),
                RRF_RT_REG_SZ,
                None,
                Some(buffer.as_mut_ptr().cast()),
                Some(&mut len),
            );
            let _ = RegCloseKey(key);
            if name.is_err() {
                continue;
            }
            let Some(port) = utf16(&buffer) else {
                continue;
            };
            let mut value = [0u16; 512];
            let instance_id =
                SetupDiGetDeviceInstanceIdW(devices.0, &device, Some(&mut value), None)
                    .ok()
                    .and_then(|()| utf16(&value));
            let serial_number = instance_id.as_deref().and_then(usb_serial).or_else(|| {
                let mut parent = 0;
                if CM_Get_Parent(&mut parent, device.DevInst, 0) == CR_SUCCESS
                    && CM_Get_Device_IDW(parent, &mut value, 0) == CR_SUCCESS
                {
                    return utf16(&value).as_deref().and_then(usb_serial);
                }
                None
            });
            let property = |key: &DEVPROPKEY| {
                let mut data = [0u8; 1024];
                let mut kind = DEVPROPTYPE::default();
                let mut size = 0;
                SetupDiGetDevicePropertyW(
                    devices.0,
                    &device,
                    key,
                    &mut kind,
                    Some(&mut data),
                    Some(&mut size),
                    0,
                )
                .ok()?;
                if kind != DEVPROP_TYPE_STRING {
                    return None;
                }
                let words: Vec<_> = data[..size as usize]
                    .as_chunks::<2>()
                    .0
                    .iter()
                    .map(|bytes| u16::from_le_bytes(*bytes))
                    .collect();
                utf16(&words)
            };
            let friendly = property(&DEVPKEY_Device_FriendlyName)
                .or_else(|| property(&DEVPKEY_Device_DeviceDesc))
                .map(|name| name.trim_end_matches(&format!(" ({port})")).to_owned());
            result.insert(
                port,
                PnpPort {
                    description: property(&DEVPKEY_Device_BusReportedDeviceDesc),
                    manufacturer: property(&DEVPKEY_Device_Manufacturer),
                    friendly,
                    instance_id,
                    serial_number,
                },
            );
        }
    }
    Ok(result)
}

fn utf16(words: &[u16]) -> Option<String> {
    let len = words
        .iter()
        .position(|word| *word == 0)
        .unwrap_or(words.len());
    (len > 0).then(|| String::from_utf16_lossy(&words[..len]))
}

fn usb_serial(instance_id: &str) -> Option<String> {
    let (device, serial) = instance_id.rsplit_once('\\')?;
    (device.starts_with("USB\\VID_") && !serial.is_empty() && !serial.contains('&'))
        .then(|| serial.to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_catalog_ids_and_windows_usb_strings() {
        let unknown = PnpPort::default();
        assert_eq!(identify(0x3162, 0x0053, &unknown).1, "Holybro Pixhawk 6C");
        assert_eq!(
            identify(0x3185, 0x0038, &unknown).0,
            DeviceKind::FlightController
        );
        assert_eq!(
            identify(0x2dae, 0x1016, &unknown).0,
            DeviceKind::FlightController
        );
        assert_eq!(identify(0x1546, 0x01a9, &unknown).0, DeviceKind::RtkGps);
        assert_eq!(
            identify(0x0403, 0x6015, &unknown).0,
            DeviceKind::TelemetryRadio
        );
        assert_eq!(identify(0x0955, 0x7020, &unknown).0, DeviceKind::UsbSerial);
        let fallback = PnpPort {
            description: Some("PX4 FMU v6X.x".into()),
            ..Default::default()
        };
        assert_eq!(
            identify(0x1111, 1, &fallback).0,
            DeviceKind::FlightController
        );
        assert!(bootloader_name("Pixhawk6C-Secure-BL-v10"));
        assert!(!bootloader_name("CubeBlue"));
        assert_eq!(
            usb_serial(r"USB\VID_3162&PID_0053\AB0123").as_deref(),
            Some("AB0123")
        );
        assert_eq!(
            usb_serial(r"USB\VID_3162&PID_0053&MI_02\8&7869140&0&0002"),
            None
        );
    }
}
