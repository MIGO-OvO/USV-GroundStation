use crate::Result;
use base64::{Engine as _, engine::general_purpose::STANDARD};
use flate2::read::ZlibDecoder;
use serde::{Deserialize, Serialize};
use std::{
    io::{Read, Write},
    time::Duration,
};

#[cfg(windows)]
pub mod rover;

const MAX_FLASH_BYTES: usize = 16 * 1024 * 1024;
pub const MAX_PACKAGE_BYTES: usize = 24 * 1024 * 1024;
const FMUV2_FLASH_LIMIT: usize = 1_032_192;
const EOC: u8 = 0x20;
const SYNC_OK: [u8; 2] = [0x12, 0x10];
const PROGRAM_BLOCK: usize = 64;
const VERIFY_BLOCK: usize = 40;
const RESPONSE_TIMEOUT: Duration = Duration::from_secs(2);

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub struct BoardInfo {
    pub board_id: u32,
    pub board_revision: u32,
    pub bootloader_revision: u32,
    pub flash_size: usize,
}

impl BoardInfo {
    fn accepts(&self, firmware_id: u32) -> bool {
        self.board_id == firmware_id
            || (self.board_id == 255 && firmware_id == 9)
            || (self.board_id == 9
                && firmware_id == 255
                && self.bootloader_revision >= 5
                && self.flash_size > FMUV2_FLASH_LIMIT)
    }

    fn image_limit(&self) -> usize {
        if self.board_id == 9 && self.bootloader_revision < 5 {
            return self.flash_size.min(FMUV2_FLASH_LIMIT);
        }
        self.flash_size
    }
}

#[derive(Deserialize)]
enum ImageMagic {
    APJFWv1,
    PX4FWv1,
}

#[derive(Deserialize)]
struct Package {
    #[serde(rename = "magic")]
    _magic: ImageMagic,
    board_id: u32,
    #[serde(default)]
    board_revision: u32,
    image_size: usize,
    image: String,
    #[serde(default)]
    extf_image_size: usize,
}

pub struct Image(Vec<u8>);

impl Image {
    // Validate the declared board and bounded, word-aligned image before erasing.
    pub fn parse(bytes: &[u8], board: BoardInfo) -> Result<Self> {
        if bytes.len() > MAX_PACKAGE_BYTES {
            return Err("固件文件过大".into());
        }
        let firmware: Package =
            serde_json::from_slice(bytes).map_err(|e| format!("无法读取 APJ 或 PX4 固件：{e}"))?;
        if firmware.extf_image_size != 0 {
            return Err("此固件需要刷写外部 Flash".into());
        }
        if !board.accepts(firmware.board_id) {
            return Err(format!(
                "固件板卡编号为 {}，当前飞控为 {}",
                firmware.board_id, board.board_id
            ));
        }
        if firmware.board_revision != 0 && firmware.board_revision != board.board_revision {
            return Err(format!(
                "固件要求板卡修订版 {}，当前飞控为 {}",
                firmware.board_revision, board.board_revision
            ));
        }
        if !(8..=board.image_limit()).contains(&firmware.image_size) {
            return Err(format!(
                "固件大小超出飞控可写范围（{} 字节）",
                board.image_limit()
            ));
        }
        let compressed = STANDARD
            .decode(firmware.image)
            .map_err(|e| format!("固件编码无效：{e}"))?;
        let mut image = Vec::with_capacity(firmware.image_size);
        ZlibDecoder::new(compressed.as_slice())
            .take(firmware.image_size as u64 + 1)
            .read_to_end(&mut image)
            .map_err(|e| format!("固件解压失败：{e}"))?;
        if image.len() != firmware.image_size {
            return Err("固件实际大小与文件声明不符".into());
        }
        image.resize(image.len().next_multiple_of(4), 0xff);
        Ok(Self(image))
    }
}

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum FlashPhase {
    Downloading,
    Checking,
    Erasing,
    Writing,
    Verifying,
    Rebooting,
}

#[derive(Clone, Copy, Serialize)]
pub struct Progress {
    pub phase: FlashPhase,
    pub percent: Option<u8>,
}

impl Progress {
    pub fn phase(phase: FlashPhase) -> Self {
        Self {
            phase,
            percent: None,
        }
    }
}

trait BootPort: Read + Write + Send {
    fn timeout(&mut self, duration: Duration) -> Result<()>;
}

#[cfg(windows)]
impl BootPort for Box<dyn serialport::SerialPort> {
    fn timeout(&mut self, duration: Duration) -> Result<()> {
        self.set_timeout(duration).map_err(|e| e.to_string())
    }
}

pub struct Bootloader {
    port: Box<dyn BootPort>,
    pub info: BoardInfo,
}

impl Bootloader {
    fn identify(port: &mut dyn BootPort) -> Result<BoardInfo> {
        exchange::<0>(port, &[0x21, EOC]).map_err(|e| format!("引导程序同步失败：{e}"))?;
        port.timeout(RESPONSE_TIMEOUT)?;
        let mut get = |index| exchange::<4>(port, &[0x22, index, EOC]).map(u32::from_le_bytes);
        let bootloader_revision = get(1)?;
        if !(2..=5).contains(&bootloader_revision) {
            return Err(format!("不支持的引导程序协议版本 {bootloader_revision}"));
        }
        let board_id = get(2)?;
        let board_revision = get(3)?;
        let flash_size = get(4)? as usize;
        if board_id == 0
            || !(8..=MAX_FLASH_BYTES).contains(&flash_size)
            || !flash_size.is_multiple_of(4)
        {
            return Err("引导程序返回的板卡编号或 Flash 容量无效".into());
        }
        Ok(BoardInfo {
            board_id,
            board_revision,
            bootloader_revision,
            flash_size,
        })
    }

    fn new(mut port: Box<dyn BootPort>) -> Result<Self> {
        let info = Self::identify(&mut *port)?;
        Ok(Self { port, info })
    }

    pub fn flash(mut self, bytes: &[u8], mut progress: impl FnMut(Progress)) -> Result<()> {
        progress(Progress::phase(FlashPhase::Checking));
        let Image(image) = Image::parse(bytes, self.info)?;
        let port = &mut *self.port;
        if Self::identify(port)? != self.info {
            return Err("板卡信息已变化，请重新识别飞控".into());
        }
        let crc =
            (self.info.bootloader_revision >= 3).then(|| flash_crc(&image, self.info.flash_size));

        progress(Progress::phase(FlashPhase::Erasing));
        port.timeout(Duration::from_secs(
            20 + 4 * (self.info.flash_size / 1_000_000) as u64,
        ))?;
        exchange::<0>(port, &[0x23, EOC]).map_err(|e| format!("擦除失败：{e}"))?;
        port.timeout(RESPONSE_TIMEOUT)?;

        let mut last_percent = 0;
        progress(Progress {
            phase: FlashPhase::Writing,
            percent: Some(0),
        });
        let mut frame = [0u8; PROGRAM_BLOCK + 3];
        frame[0] = 0x27;
        let mut written = 0;
        for block in image.chunks(PROGRAM_BLOCK) {
            frame[1] = block.len() as u8;
            frame[2..2 + block.len()].copy_from_slice(block);
            frame[2 + block.len()] = EOC;
            exchange::<0>(port, &frame[..3 + block.len()])
                .map_err(|e| format!("写入失败（偏移 0x{written:X}）：{e}"))?;
            written += block.len();
            let percent = (written * 100 / image.len()) as u8;
            if percent != last_percent {
                progress(Progress {
                    phase: FlashPhase::Writing,
                    percent: Some(percent),
                });
                last_percent = percent;
            }
        }
        progress(Progress::phase(FlashPhase::Verifying));
        if let Some(expected) = crc {
            port.timeout(Duration::from_secs(5))?;
            let actual = u32::from_le_bytes(
                exchange::<4>(port, &[0x29, EOC])
                    .map_err(|e| format!("读取 Flash CRC 失败：{e}"))?,
            );
            if actual != expected {
                return Err(format!(
                    "Flash CRC 不一致（飞控 {actual:08X}，固件 {expected:08X}）"
                ));
            }
        } else {
            exchange::<0>(port, &[0x24, EOC]).map_err(|e| format!("进入回读校验失败：{e}"))?;
            for (index, block) in image.chunks(VERIFY_BLOCK).enumerate() {
                port.write_all(&[0x28, block.len() as u8, EOC])
                    .map_err(|e| format!("回读校验失败：{e}"))?;
                let mut actual = [0; VERIFY_BLOCK];
                port.read_exact(&mut actual[..block.len()])
                    .map_err(|e| format!("回读校验失败：{e}"))?;
                status(port)?;
                if actual[..block.len()] != *block {
                    return Err(format!(
                        "回读数据不一致（偏移 0x{:X}）",
                        index * VERIFY_BLOCK
                    ));
                }
            }
        }
        progress(Progress::phase(FlashPhase::Rebooting));
        port.timeout(RESPONSE_TIMEOUT)?;
        let reboot = if self.info.bootloader_revision >= 3 {
            exchange::<0>(port, &[0x30, EOC]).map(|_| ())
        } else {
            port.write_all(&[0x30, EOC]).map_err(|e| e.to_string())
        };
        reboot.map_err(|e| format!("固件已通过校验，重启命令未完成：{e}"))
    }
}

fn status(port: &mut dyn BootPort) -> Result<()> {
    let mut reply = [0; 2];
    port.read_exact(&mut reply).map_err(|e| e.to_string())?;
    if reply != SYNC_OK {
        return Err(format!("引导程序返回 {reply:02X?}"));
    }
    Ok(())
}

fn exchange<const N: usize>(port: &mut dyn BootPort, frame: &[u8]) -> Result<[u8; N]> {
    port.write_all(frame).map_err(|e| e.to_string())?;
    let mut data = [0; N];
    port.read_exact(&mut data).map_err(|e| e.to_string())?;
    status(port)?;
    Ok(data)
}

fn flash_crc(image: &[u8], flash_size: usize) -> u32 {
    // PX4 bootloader CRC uses the reflected IEEE polynomial with no initial or final XOR.
    let mut crc = crc32fast::Hasher::new_with_initial(u32::MAX);
    crc.update(image);
    for _ in 0..(flash_size - image.len()) / 4096 {
        crc.update(&[0xff; 4096]);
    }
    crc.update(&[0xff; 4096][..(flash_size - image.len()) % 4096]);
    !crc.finalize()
}

#[cfg(windows)]
pub use discovery::discover;

#[cfg(windows)]
mod discovery {
    use super::*;
    use crate::serial::{SerialDevice, available};
    use std::{
        sync::atomic::{AtomicBool, Ordering},
        thread::sleep,
        time::Instant,
    };

    fn candidate<'a>(
        initial: &[SerialDevice],
        selected: Option<&SerialDevice>,
        current: &'a [SerialDevice],
    ) -> Result<Option<&'a SerialDevice>> {
        if let Some(target) = selected
            && let Some(port) = current
                .iter()
                .find(|p| p.same_endpoint(target) && p.can_flash())
        {
            return Ok(Some(port));
        }
        let mut arrivals = current.iter().filter(|port| {
            if !port.can_flash() || initial.iter().any(|before| before.same_endpoint(port)) {
                return false;
            }
            let actual = port.usb.as_ref().expect("USB flight controller");
            let Some(expected) = selected.and_then(|port| port.usb.as_ref()) else {
                return true;
            };
            match (&expected.serial_number, &actual.serial_number) {
                (Some(expected), Some(actual)) => expected == actual,
                _ => expected.vid == actual.vid,
            }
        });
        let first = arrivals.next();
        if arrivals.next().is_some() {
            return Err("检测到多个新飞控，请选择串口后重新识别".into());
        }
        Ok(first)
    }

    pub fn discover(
        selected: Option<&SerialDevice>,
        cancelled: &AtomicBool,
    ) -> Result<(SerialDevice, Bootloader)> {
        let initial = available()?;
        if let Some(target) = selected
            && !initial
                .iter()
                .any(|port| port.same_endpoint(target) && port.can_flash())
        {
            return Err("所选飞控已不在串口列表中，请重新选择".into());
        }
        let deadline = Instant::now() + Duration::from_secs(20);
        let mut last_error = None;
        let mut current = initial.clone();
        while Instant::now() < deadline && !cancelled.load(Ordering::Relaxed) {
            if let Some(port) = candidate(&initial, selected, &current)? {
                let result = serialport::new(&port.port, 115200)
                    .timeout(Duration::from_millis(250))
                    .open()
                    .map_err(|e| format!("无法打开 {}：{e}", port.port))
                    .and_then(|serial| {
                        serial
                            .clear(serialport::ClearBuffer::Input)
                            .map_err(|e| e.to_string())?;
                        Bootloader::new(Box::new(serial))
                    });
                match result {
                    Ok(bootloader) => return Ok((port.clone(), bootloader)),
                    Err(error) => last_error = Some(error),
                }
            }
            sleep(Duration::from_millis(150));
            current = available()?;
        }
        if cancelled.load(Ordering::Relaxed) {
            return Err("已取消识别".into());
        }
        let detail = last_error
            .map(|error| format!("（{error}）"))
            .unwrap_or_default();
        Err(format!(
            "未连接引导程序{detail}。请断开其他供电，再重新插入飞控 USB。"
        ))
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        use crate::serial::{DeviceKind, UsbDevice};

        fn usb(port: &str, vid: u16, pid: u16, serial_number: &str) -> SerialDevice {
            SerialDevice {
                port: port.into(),
                kind: DeviceKind::FlightController,
                label: "Pixhawk".into(),
                description: None,
                instance_id: None,
                usb: Some(UsbDevice {
                    vid,
                    pid,
                    serial_number: Some(serial_number.into()),
                }),
                bootloader_hint: false,
            }
        }

        #[test]
        fn follows_reenumerated_usb_serial_and_rejects_another_flight_controller() {
            let normal = usb("COM5", 0x3162, 0x53, "selected");
            let other = usb("COM6", 0x3162, 0x53, "other");
            let initial = [normal.clone(), other.clone()];
            let boot = usb("COM9", 0x3185, 0x38, "selected");
            let wrong = usb("COM5", 0x3162, 0x53, "wrong");
            let current = [other, wrong, boot.clone()];
            assert_eq!(
                candidate(&initial, Some(&normal), &current).unwrap(),
                Some(&boot)
            );
            assert_eq!(
                candidate(&initial, Some(&normal), &current[..2]).unwrap(),
                None
            );
            assert!(candidate(&initial, None, &current).is_err());
        }
    }
}

#[cfg(test)]
mod tests;
