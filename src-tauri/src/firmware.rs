use super::AppState;
use serde::{Deserialize, Serialize};
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicBool, Ordering},
};
use tauri::{State, async_runtime::spawn_blocking, ipc::Channel};
use usv_core::{
    Result,
    firmware::{self, BoardInfo, Bootloader, FlashPhase, Progress, rover},
    serial::{self, SerialDevice},
};

#[derive(Clone, Default)]
pub struct Maintenance(Arc<Mutex<Session>>);

#[derive(Default)]
struct Session {
    id: u64,
    phase: Phase,
}

#[derive(Default)]
enum Phase {
    #[default]
    Idle,
    Probing(Arc<AtomicBool>),
    Ready(Box<Prepared>),
    Flashing,
}

struct Prepared {
    bootloader: Bootloader,
    device: SerialDevice,
    releases: Vec<rover::Release>,
    _lease: Arc<()>,
}

impl Maintenance {
    fn lock(&self) -> Result<std::sync::MutexGuard<'_, Session>> {
        self.0.lock().map_err(|e| e.to_string())
    }

    pub fn flashing(&self) -> bool {
        self.lock()
            .is_ok_and(|session| matches!(session.phase, Phase::Flashing))
    }

    pub fn cancel(&self) -> Result<()> {
        let mut session = self.lock()?;
        match &session.phase {
            Phase::Probing(cancelled) => cancelled.store(true, Ordering::Relaxed),
            Phase::Flashing => return Err("刷写进行中，请保持 USB 连接".into()),
            _ => session.phase = Phase::Idle,
        }
        Ok(())
    }
}

#[derive(Serialize)]
pub struct Target {
    session: u64,
    device: SerialDevice,
    board: BoardInfo,
}

#[tauri::command]
pub async fn serial_ports() -> Result<Vec<SerialDevice>> {
    spawn_blocking(serial::available)
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn firmware_probe(
    app: State<'_, AppState>,
    maintenance: State<'_, Maintenance>,
    target: Option<SerialDevice>,
) -> Result<Target> {
    let cancelled = Arc::new(AtomicBool::new(false));
    {
        let mut session = maintenance.lock()?;
        if matches!(session.phase, Phase::Probing(_) | Phase::Flashing) {
            return Err("已有固件刷写操作".into());
        }
        session.id += 1;
        session.phase = Phase::Probing(cancelled.clone());
    }
    let station = app.station.clone();
    let cancel_probe = cancelled.clone();
    let result = spawn_blocking(move || {
        let lease = station.reserve_firmware()?;
        let (device, bootloader) = firmware::discover(target.as_ref(), &cancel_probe)?;
        Ok(Prepared {
            device,
            bootloader,
            releases: Vec::new(),
            _lease: lease,
        })
    })
    .await
    .map_err(|e| e.to_string())
    .and_then(|result| result);
    let mut session = maintenance.lock()?;
    session.phase = Phase::Idle;
    if cancelled.load(Ordering::Relaxed) {
        return Err("已取消识别".into());
    }
    let prepared = result?;
    let target = Target {
        session: session.id,
        device: prepared.device.clone(),
        board: prepared.bootloader.info,
    };
    session.phase = Phase::Ready(Box::new(prepared));
    Ok(target)
}

#[tauri::command]
pub fn firmware_cancel(maintenance: State<'_, Maintenance>) -> Result<()> {
    maintenance.cancel()
}

#[tauri::command]
pub async fn firmware_rover_releases(
    maintenance: State<'_, Maintenance>,
    id: u64,
) -> Result<Vec<rover::Release>> {
    let (board, device) = {
        let session = maintenance.lock()?;
        match &session.phase {
            Phase::Ready(target) if session.id == id => {
                (target.bootloader.info, target.device.clone())
            }
            _ => return Err("请重新识别飞控".into()),
        }
    };
    let releases = spawn_blocking(move || rover::releases(board, &device))
        .await
        .map_err(|e| e.to_string())??;
    let mut session = maintenance.lock()?;
    if session.id == id
        && let Phase::Ready(target) = &mut session.phase
    {
        target.releases = releases.clone();
        return Ok(releases);
    }
    Err("请重新识别飞控".into())
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Source {
    Rover { url: String },
    Local { text: String },
}

#[tauri::command]
pub async fn firmware_flash(
    maintenance: State<'_, Maintenance>,
    id: u64,
    source: Source,
    confirmed: bool,
    progress: Channel<Progress>,
) -> Result<()> {
    if !confirmed {
        return Err("请确认飞控已上锁，推进电源已断开".into());
    }
    let prepared = {
        let mut session = maintenance.lock()?;
        let Phase::Ready(target) = &session.phase else {
            return Err("请重新识别飞控".into());
        };
        if session.id != id {
            return Err("请重新识别飞控".into());
        }
        if let Source::Rover { url } = &source
            && !target.releases.iter().any(|release| release.url == *url)
        {
            return Err("请在当前板卡的官方固件列表中选择版本".into());
        }
        let Phase::Ready(prepared) = std::mem::replace(&mut session.phase, Phase::Flashing) else {
            unreachable!();
        };
        prepared
    };
    let result = spawn_blocking(move || {
        let report = |state| {
            let _ = progress.send(state);
        };
        let bytes = match source {
            Source::Local { text } => text.into_bytes(),
            Source::Rover { url } => {
                report(Progress::phase(FlashPhase::Downloading));
                rover::download(&url)?
            }
        };
        let Prepared {
            bootloader, _lease, ..
        } = *prepared;
        bootloader.flash(&bytes, report)
    })
    .await
    .map_err(|e| e.to_string())
    .and_then(|result| result);
    maintenance.lock()?.phase = Phase::Idle;
    result
}
