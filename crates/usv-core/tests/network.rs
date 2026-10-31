//! Real loopback sockets, with an explicitly simulated peer. No vessel address.
use mavlink::MavHeader;
use std::{
    collections::HashSet,
    io::{Read, Write},
    net::{TcpListener, TcpStream, UdpSocket},
    thread,
    time::{Duration, Instant},
};
use usv_core::{
    station::{Intent, Snapshot, Station},
    transport::ConnectionConfig,
    wire::{self, WireMessage, commands, standard::*},
};

fn frame(component: u8, m: WireMessage) -> Vec<u8> {
    wire::encode(
        MavHeader {
            system_id: 1,
            component_id: component,
            sequence: 17,
        },
        &m,
    )
    .unwrap()
}
fn heartbeat(component: u8) -> Vec<u8> {
    frame(
        component,
        MavMessage::HEARTBEAT(HEARTBEAT_DATA {
            mavtype: if component == 1 {
                MavType::MAV_TYPE_SURFACE_BOAT
            } else {
                MavType::MAV_TYPE_ONBOARD_CONTROLLER
            },
            autopilot: if component == 1 {
                MavAutopilot::MAV_AUTOPILOT_ARDUPILOTMEGA
            } else {
                MavAutopilot::MAV_AUTOPILOT_INVALID
            },
            mavlink_version: 3,
            ..Default::default()
        })
        .into(),
    )
}
fn event(
    r: &usv_core::payload::RequestRecord,
    phase: &str,
    outcome: &str,
    seq: u32,
) -> Vec<Vec<u8>> {
    let value = serde_json::json!({"v":1,"session":r.session,"request":r.request,"seq":seq,"command":r.command,"sender_system":254,"sender_component":190,"tcp_session":1,"phase":phase,"outcome":outcome,"reason":"loopback","attempt_id":"12345678123456781234567812345678","preflight_phase":"","cleanup_failed":false});
    let mut text = format!("USVE1:{value}").into_bytes();
    text.push(0);
    text.chunks(50)
        .enumerate()
        .map(|(n, part)| {
            let mut b = [0; 50];
            b[..part.len()].copy_from_slice(part);
            frame(
                191,
                MavMessage::STATUSTEXT(STATUSTEXT_DATA {
                    text: b.into(),
                    id: seq as u16,
                    chunk_seq: n as u8,
                    ..Default::default()
                })
                .into(),
            )
        })
        .collect()
}
fn wait(s: &Station, predicate: impl Fn(&Snapshot) -> bool) -> Snapshot {
    let at = Instant::now();
    loop {
        let snap = s.snapshot().unwrap();
        if predicate(&snap) {
            return snap;
        }
        assert!(
            at.elapsed() < Duration::from_secs(4),
            "snapshot: {}",
            serde_json::to_string(&snap).unwrap()
        );
        thread::sleep(Duration::from_millis(20));
    }
}

#[test]
fn udp_retries_keep_identity_peer_deduplicates_and_ack_is_not_execution() {
    let d = tempfile::tempdir().unwrap();
    let station = Station::start(d.path()).unwrap();
    let peer = UdpSocket::bind("127.0.0.1:0").unwrap();
    peer.set_nonblocking(true).unwrap();
    let reserve = UdpSocket::bind("127.0.0.1:0").unwrap();
    let address = reserve.local_addr().unwrap();
    drop(reserve);
    station
        .dispatch(Intent::Connect {
            config: ConnectionConfig::Udp {
                bind: address.to_string(),
                peer: Some(peer.local_addr().unwrap().to_string()),
            },
            target_system: Some(1),
        })
        .unwrap();
    let pump = |duration: Duration, requests: &mut Vec<commands::COMMAND_LONG_DATA>| {
        let until = Instant::now() + duration;
        let mut buffer = [0; 4096];
        while Instant::now() < until {
            for c in [1, 191] {
                peer.send_to(&heartbeat(c), address).unwrap();
            }
            for (name, value) in [
                ("USV_PROTO", 1.0),
                ("USV_STAT", 0.0),
                ("USV_VLD", 1.0),
                ("USV_BSET", 1.0),
                ("USV_VOLT", 1.2),
            ] {
                peer.send_to(
                    &frame(
                        191,
                        MavMessage::NAMED_VALUE_FLOAT(NAMED_VALUE_FLOAT_DATA {
                            name: name.into(),
                            value,
                            ..Default::default()
                        })
                        .into(),
                    ),
                    address,
                )
                .unwrap();
            }
            while let Ok((n, _)) = peer.recv_from(&mut buffer) {
                for (_, m) in wire::Decoder::default().push(&buffer[..n]) {
                    if let WireMessage::Command(commands::MavMessage::COMMAND_LONG(c)) = m
                        && c.command == 31010
                    {
                        requests.push(c);
                    }
                }
            }
            thread::sleep(Duration::from_millis(30));
        }
    };
    let mut requests = vec![];
    pump(Duration::from_millis(250), &mut requests);
    assert!(station.snapshot().unwrap().payload_online);
    station
        .dispatch(Intent::Payload {
            command: 31010,
            param1: 0.0,
            param2: 0.0,
            confirmed: true,
        })
        .unwrap();
    pump(Duration::from_millis(2400), &mut requests);
    assert_eq!(requests.len(), 3);
    let identities: HashSet<_> = requests
        .iter()
        .map(|c| (c.param3 as u32, c.param4 as u32))
        .collect();
    assert_eq!(identities.len(), 1, "peer executes one identity");
    for c in &requests {
        assert_eq!((c.param1, c.param2), (0.0, 0.0));
    }
    peer.send_to(
        &frame(
            191,
            commands::MavMessage::COMMAND_ACK(commands::COMMAND_ACK_DATA {
                command: 31010,
                result: 0,
                target_system: 254,
                target_component: 190,
                ..Default::default()
            })
            .into(),
        ),
        address,
    )
    .unwrap();
    pump(Duration::from_millis(150), &mut requests);
    let snap = station.snapshot().unwrap();
    let r = snap.requests.last().unwrap();
    assert!(!r.receipt);
    for b in event(r, "request", "accepted", 1) {
        peer.send_to(&b, address).unwrap();
    }
    pump(Duration::from_millis(150), &mut requests);
    assert_eq!(
        station.snapshot().unwrap().requests.last().unwrap().state,
        usv_core::payload::RequestState::Accepted
    );
    for b in event(r, "terminal", "succeeded", 2) {
        peer.send_to(&b, address).unwrap();
    }
    pump(Duration::from_millis(200), &mut requests);
    let snap = station.snapshot().unwrap();
    assert_eq!(
        snap.requests.last().unwrap().state,
        usv_core::payload::RequestState::Succeeded
    );
    assert!(snap.requests.last().unwrap().retired);
}

#[test]
fn tcp_half_frame_reconnect_and_app_restart_never_replay_start() {
    let d = tempfile::tempdir().unwrap();
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    listener.set_nonblocking(true).unwrap();
    let station = Station::start(d.path()).unwrap();
    station
        .dispatch(Intent::Connect {
            config: ConnectionConfig::Tcp {
                host: "127.0.0.1".into(),
                port: listener.local_addr().unwrap().port(),
            },
            target_system: Some(1),
        })
        .unwrap();
    let accept = || {
        let at = Instant::now();
        loop {
            if let Ok((s, _)) = listener.accept() {
                s.set_nonblocking(true).unwrap();
                return s;
            }
            assert!(at.elapsed() < Duration::from_secs(5));
            thread::sleep(Duration::from_millis(20));
        }
    };
    let mut socket = accept();
    let hb = heartbeat(1);
    socket.write_all(&hb[..5]).unwrap();
    thread::sleep(Duration::from_millis(150));
    assert_ne!(station.snapshot().unwrap().link, "connected");
    socket.write_all(&hb[5..]).unwrap();
    socket.write_all(&heartbeat(191)).unwrap();
    socket
        .write_all(&frame(
            191,
            MavMessage::NAMED_VALUE_FLOAT(NAMED_VALUE_FLOAT_DATA {
                name: "USV_PROTO".into(),
                value: 1.0,
                ..Default::default()
            })
            .into(),
        ))
        .unwrap();
    wait(&station, |s| {
        s.payload_online && s.telemetry.fields.contains_key("USV_PROTO")
    });
    station
        .dispatch(Intent::Payload {
            command: 31018,
            param1: 0.0,
            param2: 0.0,
            confirmed: true,
        })
        .unwrap();
    wait(&station, |s| {
        s.requests.last().is_some_and(|r| r.attempts == 1)
    });
    drop(socket);
    wait(&station, |s| {
        s.requests.last().is_some_and(|r| !r.retry_allowed)
    });
    let mut socket = accept();
    socket.write_all(&heartbeat(1)).unwrap();
    socket.write_all(&heartbeat(191)).unwrap();
    fn read_commands(socket: &mut TcpStream) -> Vec<u16> {
        let until = Instant::now() + Duration::from_millis(1200);
        let mut buf = [0; 8192];
        let mut decoder = wire::Decoder::default();
        let mut ids = vec![];
        while Instant::now() < until {
            if let Ok(n) = socket.read(&mut buf) {
                for (_, m) in decoder.push(&buf[..n]) {
                    if let WireMessage::Command(commands::MavMessage::COMMAND_LONG(c)) = m {
                        ids.push(c.command);
                    }
                }
            }
            thread::sleep(Duration::from_millis(10));
        }
        ids
    }
    assert!(!read_commands(&mut socket).contains(&31018));
    station.dispatch(Intent::Disconnect).unwrap();
    drop(station);
    thread::sleep(Duration::from_millis(100));
    let restarted = Station::start(d.path()).unwrap();
    let snap = restarted.snapshot().unwrap();
    assert_eq!(snap.requests.last().unwrap().attempts, 1);
    assert!(!snap.requests.last().unwrap().retry_allowed);
    assert_eq!(snap.link, "disconnected");
}
