use super::*;
use std::{
    collections::VecDeque,
    sync::{Arc, Mutex},
};

const CRC: u32 = 0xdcc8cca5;
const BOARD: BoardInfo = BoardInfo {
    board_id: 56,
    board_revision: 0,
    bootloader_revision: 5,
    flash_size: 128,
};

fn package(board_id: u32) -> serde_json::Value {
    let mut zlib = flate2::write::ZlibEncoder::new(Vec::new(), flate2::Compression::default());
    zlib.write_all(&(0..69).collect::<Vec<u8>>()).unwrap();
    serde_json::json!({
        "magic": "APJFWv1",
        "board_id": board_id,
        "image_size": 69,
        "image": STANDARD.encode(zlib.finish().unwrap()),
        "extf_image_size": 0,
    })
}

#[test]
fn validates_board_and_container_limits_before_use() {
    let mut image = package(56);
    assert_eq!(
        Image::parse(image.to_string().as_bytes(), BOARD)
            .unwrap()
            .0
            .len(),
        72
    );
    image["magic"] = "PX4FWv1".into();
    assert!(Image::parse(image.to_string().as_bytes(), BOARD).is_ok());
    for (key, value) in [
        ("board_id", 140.into()),
        ("board_revision", 1.into()),
        ("image_size", 24.into()),
        ("image_size", usize::MAX.into()),
        ("extf_image_size", 1.into()),
        ("image", "broken".into()),
        ("magic", "invalid".into()),
    ] {
        let mut invalid = image.clone();
        invalid[key] = value;
        assert!(
            Image::parse(invalid.to_string().as_bytes(), BOARD).is_err(),
            "{key}"
        );
    }
    let old = BoardInfo {
        board_id: 9,
        bootloader_revision: 4,
        flash_size: 2_000_000,
        ..BOARD
    };
    let large = BoardInfo {
        bootloader_revision: 5,
        ..old
    };
    assert_eq!(old.image_limit(), FMUV2_FLASH_LIMIT);
    assert!(!old.accepts(255));
    assert!(large.accepts(255));
}

struct TestPort {
    written: Arc<Mutex<Vec<u8>>>,
    bytes: VecDeque<u8>,
    programmed: Vec<u8>,
    read_offset: usize,
    protocol: u8,
    crc: u32,
    fail: Option<u8>,
}

impl Write for TestPort {
    fn write(&mut self, frame: &[u8]) -> std::io::Result<usize> {
        let command = frame[0];
        self.written.lock().unwrap().push(command);
        assert_eq!(frame.last(), Some(&EOC));
        assert!(self.bytes.is_empty());
        if self.fail == Some(command) {
            self.bytes.extend([0x12, 0x11]);
            return Ok(frame.len());
        }
        match command {
            0x21 | 0x23 | 0x24 => assert_eq!(frame.len(), 2),
            0x22 => {
                assert_eq!(frame.len(), 3);
                let val = match frame[1] {
                    1 => u32::from(self.protocol),
                    2 => 56,
                    3 => 0,
                    4 => 128,
                    _ => panic!("unexpected device info query"),
                };
                self.bytes.extend(val.to_le_bytes());
            }
            0x27 => {
                let data = &frame[2..frame.len() - 1];
                assert_eq!(usize::from(frame[1]), data.len());
                assert!(data.len() <= 64 && data.len().is_multiple_of(4));
                self.programmed.extend(data);
            }
            0x28 => {
                let end = self.read_offset + usize::from(frame[1]);
                self.bytes.extend(&self.programmed[self.read_offset..end]);
                self.read_offset = end;
            }
            0x29 => self.bytes.extend(self.crc.to_le_bytes()),
            0x30 => {
                let expected = (0..69).chain([0xff, 0xff, 0xff]).collect::<Vec<u8>>();
                assert_eq!(self.programmed, expected);
            }
            _ => panic!("unexpected command {command:02x}"),
        }
        self.bytes.extend([0x12, 0x10]);
        Ok(frame.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

impl Read for TestPort {
    fn read(&mut self, dest: &mut [u8]) -> std::io::Result<usize> {
        let count = dest.len().min(self.bytes.len()).min(2);
        for slot in &mut dest[..count] {
            *slot = self.bytes.pop_front().unwrap();
        }
        Ok(count)
    }
}

impl BootPort for TestPort {
    fn timeout(&mut self, _: Duration) -> Result<()> {
        Ok(())
    }
}

fn run(protocol: u8, image_id: u32, crc: u32, fail: Option<u8>) -> (Result<()>, Vec<u8>) {
    let written = Arc::new(Mutex::new(Vec::new()));
    let port = TestPort {
        written: written.clone(),
        bytes: VecDeque::new(),
        programmed: Vec::new(),
        read_offset: 0,
        protocol,
        crc,
        fail,
    };
    let board = Bootloader::new(Box::new(port)).unwrap();
    let result = board.flash(package(image_id).to_string().as_bytes(), |_| {});
    let frames = written.lock().unwrap().clone();
    (result, frames)
}

#[test]
fn programs_word_aligned_blocks_and_verifies_before_boot() {
    let (result, commands) = run(5, 56, CRC, None);
    result.unwrap();
    assert_eq!(&commands[10..], &[0x23, 0x27, 0x27, 0x29, 0x30]);

    let (result, commands) = run(2, 56, CRC, None);
    result.unwrap();
    assert_eq!(&commands[10..], &[0x23, 0x27, 0x27, 0x24, 0x28, 0x28, 0x30]);
}

#[test]
fn rejects_wrong_board_and_stops_on_write_crc_or_boot_failure() {
    let (result, commands) = run(5, 140, CRC, None);
    assert!(result.unwrap_err().contains("板卡编号"));
    assert!(!commands.contains(&0x23));

    let (result, commands) = run(5, 56, CRC, Some(0x27));
    assert!(result.unwrap_err().contains("写入失败"));
    assert_eq!(&commands[10..], &[0x23, 0x27]);

    let (result, commands) = run(5, 56, 0, None);
    assert!(result.unwrap_err().contains("CRC 不一致"));
    assert!(!commands.contains(&0x30));

    let (result, _) = run(5, 56, CRC, Some(0x30));
    assert!(result.unwrap_err().contains("重启命令未完成"));
}
