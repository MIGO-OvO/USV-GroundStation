use usv_core::{
    mission::*,
    wire::{WireMessage, standard::*},
};
fn draft() -> MissionDraft {
    MissionDraft {
        version: 1,
        waypoints: vec![
            Waypoint {
                lat: 25.314167,
                lon: 110.412778,
                altitude: 0.0,
                sample: true,
                timeout_s: 255,
            },
            Waypoint {
                lat: 25.3142,
                lon: 110.413,
                altitude: 0.0,
                sample: false,
                timeout_s: DEFAULT_SAMPLE_TIMEOUT_S,
            },
        ],
    }
}
fn request(seq: u16) -> WireMessage {
    MavMessage::MISSION_REQUEST_INT(MISSION_REQUEST_INT_DATA {
        target_system: 254,
        target_component: 190,
        seq,
        ..Default::default()
    })
    .into()
}
fn ack() -> WireMessage {
    MavMessage::MISSION_ACK(MISSION_ACK_DATA {
        target_system: 254,
        target_component: 190,
        mavtype: MavMissionResult::MAV_MISSION_ACCEPTED,
        ..Default::default()
    })
    .into()
}
fn count(n: u16) -> WireMessage {
    MavMessage::MISSION_COUNT(MISSION_COUNT_DATA {
        target_system: 254,
        target_component: 190,
        count: n,
        ..Default::default()
    })
    .into()
}
#[test]
fn sampling_item_and_home_match_ros_contract() {
    let items = draft().build().unwrap();
    assert_eq!(items.len(), 4);
    assert_eq!(items[0].command, 16);
    assert_eq!(items[2].command, 42702);
    assert_eq!(items[2].params, [1.0, 255.0, 0.0, 0.0]);
    assert_eq!(MissionDraft::from_items(&items).unwrap(), draft());
}

#[test]
fn extended_sampling_limit_roundtrips_and_is_verified() {
    let mut d = draft();
    d.waypoints[0].timeout_s = 1800;
    let items = d.build().unwrap();
    assert_eq!(items[2].params, [1.0, 255.0, 1800.0, 0.0]);
    assert_eq!(MissionDraft::from_items(&items).unwrap(), d);
    let mut returned = items[2].clone();
    returned.frame = 0;
    assert!(same_item(&items[2], &returned));
    returned.params[2] = 0.0;
    assert!(!same_item(&items[2], &returned));
}

#[test]
#[allow(deprecated)]
fn legacy_mission_request_keeps_waypoint_int_precision() {
    let mut m = MissionManager::default();
    m.start_upload(draft(), (1, 1), (254, 190), 0).unwrap();
    let request = MavMessage::MISSION_REQUEST(MISSION_REQUEST_DATA {
        seq: 1,
        target_system: 254,
        target_component: 190,
        ..Default::default()
    })
    .into();
    let replies = m.on_message(&request, 10).unwrap();
    let expected = draft().build().unwrap()[1].message(1, 1, true).unwrap();
    assert_eq!(replies, vec![expected]);
}
#[test]
fn rejects_invalid_coordinates_version_and_timeout() {
    let mut d = draft();
    d.waypoints[0].timeout_s = 0;
    assert!(d.build().is_err());
    d.waypoints[0].timeout_s = 255;
    d.waypoints[0].lat = f64::NAN;
    assert!(d.build().is_err());
    d = draft();
    d.version = 2;
    assert!(d.build().is_err());
}
#[test]
fn upload_ack_alone_is_not_success() {
    let mut m = MissionManager::default();
    m.start_upload(draft(), (1, 1), (254, 190), 0).unwrap();
    m.on_message(&ack(), 100).unwrap();
    assert_eq!(m.snapshot.state, "failed");
    assert!(!m.snapshot.verified);
}
#[test]
fn complete_upload_requires_identical_readback() {
    let mut m = MissionManager::default();
    let items = draft().build().unwrap();
    m.start_upload(draft(), (1, 1), (254, 190), 0).unwrap();
    for i in 0..items.len() {
        m.on_message(&request(i as u16), 100 + i as u64).unwrap();
    }
    m.on_message(&ack(), 200).unwrap();
    assert!(!m.snapshot.verified);
    m.on_message(&count(items.len() as u16), 300).unwrap();
    for i in &items {
        m.on_message(&i.message(254, 190, true).unwrap(), 400 + i.seq as u64)
            .unwrap();
    }
    assert_eq!(m.snapshot.state, "verified");
    assert!(m.snapshot.verified);
}
#[test]
fn readback_mismatch_fails_instead_of_silently_succeeding() {
    let mut m = MissionManager::default();
    let mut items = draft().build().unwrap();
    m.start_upload(draft(), (1, 1), (254, 190), 0).unwrap();
    for i in 0..items.len() {
        m.on_message(&request(i as u16), 100).unwrap();
    }
    m.on_message(&ack(), 200).unwrap();
    m.on_message(&count(items.len() as u16), 300).unwrap();
    items[2].params[1] = 1.0;
    for i in &items {
        m.on_message(&i.message(254, 190, true).unwrap(), 400)
            .unwrap();
    }
    assert!(!m.snapshot.verified);
    assert_eq!(m.snapshot.state, "failed");
}
#[test]
fn mission_timeout_is_bounded_and_disconnect_aborts() {
    let mut m = MissionManager::default();
    m.start_download((1, 1), (254, 190), 0).unwrap();
    for at in [1500, 3000, 4500] {
        assert_eq!(m.tick(at).len(), 1);
    }
    assert!(m.tick(6000).is_empty());
    assert_eq!(m.snapshot.state, "failed");
    m.start_download((1, 1), (254, 190), 7000).unwrap();
    m.abort("disconnect");
    assert!(!m.busy());
    assert!(!m.snapshot.verified);
}
#[test]
fn count_for_other_ground_station_is_ignored() {
    let mut m = MissionManager::default();
    m.start_download((1, 1), (254, 190), 0).unwrap();
    let foreign = MavMessage::MISSION_COUNT(MISSION_COUNT_DATA {
        target_system: 255,
        target_component: 190,
        count: 1,
        ..Default::default()
    })
    .into();
    assert!(m.on_message(&foreign, 100).unwrap().is_empty());
    assert_eq!(m.snapshot.state, "awaiting_count");
}

#[test]
fn actual_home_can_differ_while_executable_waypoints_must_match() {
    let mut m = MissionManager::default();
    let mut items = draft().build().unwrap();
    m.start_upload(draft(), (1, 1), (254, 190), 0).unwrap();
    for i in 0..items.len() {
        m.on_message(&request(i as u16), 100).unwrap();
    }
    m.on_message(&ack(), 200).unwrap();
    m.on_message(&count(items.len() as u16), 300).unwrap();
    items[0].x += 10000;
    items[0].y -= 10000;
    items[0].z = 123.0;
    for i in &items {
        m.on_message(&i.message(254, 190, true).unwrap(), 400)
            .unwrap();
    }
    assert!(m.snapshot.verified);
}
