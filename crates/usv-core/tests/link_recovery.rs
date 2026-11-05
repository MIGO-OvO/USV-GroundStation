use mavlink::MavHeader;
use std::{
    net::UdpSocket,
    thread,
    time::{Duration, Instant},
};
use usv_core::{
    station::{Intent, Station},
    transport::ConnectionConfig,
    wire::{self, WireMessage, commands, standard::*},
};

#[test]
fn only_operator_reread_requests_link_recovery_and_survives_read_throttling() {
    let directory = tempfile::tempdir().unwrap();
    let station = Station::start(directory.path()).unwrap();
    let peer = UdpSocket::bind("127.0.0.1:0").unwrap();
    peer.set_nonblocking(true).unwrap();
    let reservation = UdpSocket::bind("127.0.0.1:0").unwrap();
    let address = reservation.local_addr().unwrap();
    drop(reservation);
    station
        .dispatch(Intent::Connect {
            config: ConnectionConfig::Udp {
                bind: address.to_string(),
                peer: Some(peer.local_addr().unwrap().to_string()),
            },
            target_system: Some(1),
        })
        .unwrap();
    let heartbeat = wire::encode(
        MavHeader {
            system_id: 1,
            component_id: 1,
            sequence: 1,
        },
        &MavMessage::HEARTBEAT(HEARTBEAT_DATA {
            mavtype: MavType::MAV_TYPE_SURFACE_BOAT,
            autopilot: MavAutopilot::MAV_AUTOPILOT_ARDUPILOTMEGA,
            mavlink_version: 3,
            ..Default::default()
        })
        .into(),
    )
    .unwrap();
    let started = Instant::now();
    let mut buffer = [0; 8192];
    let mut flags = Vec::new();
    let mut received_at = Vec::new();
    while flags.len() < 3 && started.elapsed() < Duration::from_secs(7) {
        peer.send_to(&heartbeat, address).unwrap();
        while let Ok((n, _)) = peer.recv_from(&mut buffer) {
            for (_, message) in wire::Decoder::default().push(&buffer[..n]) {
                if let WireMessage::Command(commands::MavMessage::COMMAND_LONG(c)) = message {
                    assert!(
                        !(31010..=31019).contains(&c.command),
                        "recovery replayed a physical action"
                    );
                    if c.command == 512 && c.param1 == 251.0 {
                        assert_eq!(c.param7, 0.0);
                        flags.push(c.param5);
                        received_at.push(started.elapsed());
                        if flags.len() == 1 {
                            // A recent periodic query must not eat the button intent.
                            station.dispatch(Intent::RefreshPayload).unwrap();
                        }
                    }
                }
            }
        }
        thread::sleep(Duration::from_millis(20));
    }
    station.dispatch(Intent::Disconnect).unwrap();
    assert_eq!(flags, [0.0, 1.0, 0.0]);
    assert!(
        received_at
            .windows(2)
            .all(|pair| pair[1] - pair[0] >= Duration::from_millis(1800))
    );
    assert!(station.snapshot().unwrap().requests.is_empty());
}
