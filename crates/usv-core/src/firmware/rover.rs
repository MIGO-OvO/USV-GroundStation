use super::{BoardInfo, MAX_PACKAGE_BYTES};
use crate::{Result, serial::SerialDevice};
use flate2::read::GzDecoder;
use reqwest::{blocking::Client, redirect::Policy};
use serde::{Deserialize, Serialize};
use std::{
    io::{BufReader, Read},
    time::Duration,
};

const MANIFEST: &str = "https://firmware.ardupilot.org/manifest.json.gz";
const STABLE: &str = "https://firmware.ardupilot.org/Rover/stable/";

#[derive(Clone, Deserialize, Serialize)]
pub struct Release {
    pub platform: String,
    #[serde(rename(deserialize = "mav-firmware-version-str"))]
    pub version: String,
    pub url: String,
}

#[derive(Deserialize)]
struct Entry {
    #[serde(flatten)]
    release: Release,
    #[serde(rename = "mav-type")]
    vehicle: String,
    #[serde(rename = "mav-firmware-version-type")]
    channel: String,
    format: String,
    board_id: Option<u32>,
    image_size: Option<usize>,
    #[serde(default, rename = "USBID")]
    usb_ids: Vec<String>,
    #[serde(default)]
    bootloader_str: Vec<String>,
}

#[derive(Deserialize)]
struct Manifest {
    firmware: Vec<Entry>,
}

pub fn releases(board: BoardInfo, device: &SerialDevice) -> Result<Vec<Release>> {
    let response = get(MANIFEST)?;
    // The official catalog includes historical builds for all vehicle types.
    let decompressed = BufReader::new(GzDecoder::new(response).take(256 * 1024 * 1024));
    let manifest: Manifest = serde_json::from_reader(decompressed)
        .map_err(|e| format!("无法读取 ArduPilot 固件目录：{e}"))?;
    Ok(choose(manifest, board, device))
}

fn choose(manifest: Manifest, board: BoardInfo, device: &SerialDevice) -> Vec<Release> {
    let usb_id = device
        .usb
        .as_ref()
        .map(|usb| format!("0x{:04x}/0x{:04x}", usb.vid, usb.pid));
    let mut choices: Vec<_> = manifest
        .firmware
        .into_iter()
        .filter(|entry| {
            entry.vehicle == "GROUND_ROVER"
                && entry.channel == "OFFICIAL"
                && entry.format == "apj"
                && entry.board_id.is_some_and(|id| board.accepts(id))
                && entry
                    .image_size
                    .is_none_or(|size| size <= board.image_limit())
                && stable_url(&entry.release.url)
        })
        .collect();
    let usb_match = |entry: &Entry| {
        usb_id
            .as_ref()
            .is_some_and(|id| entry.usb_ids.iter().any(|usb| usb.eq_ignore_ascii_case(id)))
    };
    if choices.iter().any(usb_match) {
        choices.retain(usb_match);
    }
    choices.sort_by_key(|entry| {
        let named = device.description.as_ref().is_some_and(|description| {
            entry
                .bootloader_str
                .iter()
                .any(|name| name.eq_ignore_ascii_case(description))
        });
        (!named, entry.release.platform.clone())
    });
    choices.into_iter().map(|entry| entry.release).collect()
}

fn stable_url(url: &str) -> bool {
    url.strip_prefix(STABLE)
        .and_then(|suffix| suffix.strip_suffix("/ardurover.apj"))
        .is_some_and(|platform| {
            !platform.is_empty()
                && platform
                    .bytes()
                    .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, b'-' | b'_' | b'+'))
        })
}

pub fn download(url: &str) -> Result<Vec<u8>> {
    if !stable_url(url) {
        return Err("固件地址不在 ArduPilot Rover 稳定版目录中".into());
    }
    read_limit(get(url)?, MAX_PACKAGE_BYTES)
}

fn get(url: &str) -> Result<reqwest::blocking::Response> {
    Client::builder()
        .timeout(Duration::from_secs(30))
        .connect_timeout(Duration::from_secs(8))
        .redirect(Policy::none())
        .build()
        .and_then(|client| client.get(url).send())
        .and_then(|response| response.error_for_status())
        .map_err(|e| format!("ArduPilot 固件服务请求失败：{e}"))
}

fn read_limit(reader: impl Read, limit: usize) -> Result<Vec<u8>> {
    let mut bytes = Vec::new();
    reader
        .take(limit as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| format!("读取 ArduPilot 固件服务响应失败：{e}"))?;
    if bytes.len() > limit {
        return Err("ArduPilot 固件服务响应过大".into());
    }
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::serial::{DeviceKind, UsbDevice};

    fn row(platform: &str, board_id: u32, usb_id: &str, channel: &str, size: usize) -> Entry {
        Entry {
            release: Release {
                platform: platform.into(),
                version: "V4.7.3".into(),
                url: format!("{STABLE}{platform}/ardurover.apj"),
            },
            vehicle: "GROUND_ROVER".into(),
            channel: channel.into(),
            format: "apj".into(),
            board_id: Some(board_id),
            image_size: Some(size),
            usb_ids: vec![usb_id.into()],
            bootloader_str: vec![format!("{platform}-BL")],
        }
    }

    #[test]
    fn catalog_keeps_stable_matching_board_and_usb_variants() {
        let board = BoardInfo {
            board_id: 9,
            board_revision: 0,
            bootloader_revision: 5,
            flash_size: 2_000_000,
        };
        let device = SerialDevice {
            port: "COM5".into(),
            kind: DeviceKind::FlightController,
            label: "CubeBlack".into(),
            description: Some("CubeBlack-BL".into()),
            instance_id: None,
            usb: Some(UsbDevice {
                vid: 0x2dae,
                pid: 0x1011,
                serial_number: None,
            }),
            bootloader_hint: true,
        };
        let entries = vec![
            row("CubeBlack", 9, "0x2DAE/0x1011", "OFFICIAL", 1_400_000),
            row(
                "CubeBlack-bdshot",
                9,
                "0x2dae/0x1011",
                "OFFICIAL",
                1_400_000,
            ),
            row("CubePurple", 9, "0x2dae/0x1015", "OFFICIAL", 1_400_000),
            row("CubeOrange", 140, "0x2dae/0x1011", "OFFICIAL", 1_400_000),
            row("CubeBlack-beta", 9, "0x2dae/0x1011", "BETA", 1_400_000),
            row(
                "CubeBlack-oversize",
                9,
                "0x2dae/0x1011",
                "OFFICIAL",
                2_400_000,
            ),
        ];
        let selected = choose(Manifest { firmware: entries }, board, &device);
        let platforms: Vec<_> = selected
            .iter()
            .map(|release| release.platform.as_str())
            .collect();
        assert_eq!(platforms, ["CubeBlack", "CubeBlack-bdshot"]);
        assert!(!stable_url(
            "https://firmware.ardupilot.org.evil.invalid/Rover/stable/CubeBlack/ardurover.apj"
        ));
        assert!(!stable_url(&format!(
            "{STABLE}../beta/CubeBlack/ardurover.apj"
        )));
    }

    #[test]
    #[ignore = "requires access to firmware.ardupilot.org"]
    fn official_pixhawk6c_catalog_and_image() {
        let board = BoardInfo {
            board_id: 56,
            board_revision: 0,
            bootloader_revision: 5,
            flash_size: 1_966_080,
        };
        let device = SerialDevice {
            port: "COM5".into(),
            kind: DeviceKind::FlightController,
            label: "Pixhawk 6C".into(),
            description: Some("Pixhawk6C-BL".into()),
            instance_id: None,
            usb: Some(UsbDevice {
                vid: 0x3162,
                pid: 0x0053,
                serial_number: None,
            }),
            bootloader_hint: true,
        };
        let choices = releases(board, &device).unwrap();
        let choice = choices
            .iter()
            .find(|release| release.platform == "Pixhawk6C")
            .unwrap();
        let bytes = download(&choice.url).unwrap();
        assert!(super::super::Image::parse(&bytes, board).is_ok());
        println!(
            "{} {} · {} bytes",
            choice.platform,
            choice.version,
            bytes.len()
        );
    }
}
