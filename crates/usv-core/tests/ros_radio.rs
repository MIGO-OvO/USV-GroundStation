use serde_json::{Value, json};
use std::sync::mpsc;
use usv_core::ros_radio::*;

fn request(path: &str, body: Value) -> Request {
    Request {
        method: "POST".into(),
        path: path.into(),
        body,
        authorization: String::new(),
    }
}

#[test]
fn recording_names_use_the_existing_metadata_channel() {
    for path in ["/api/recording/name", "/api/recording/mission"] {
        let operation = request(path, json!({"name":"环湖任务"}));
        assert!(operation.validate().is_ok());
        assert!(!operation.physical());
    }
}
fn ready(client: &mut Client, now: u64) {
    let (hello, _) = client.next(now).unwrap();
    assert_eq!(hello.kind, HELLO);
    client.ingest(
        &Frame {
            kind: READY,
            session: client.session,
            boot: 55,
            request: 0,
            index: 0,
            count: 0,
            data: vec![],
        }
        .encode()
        .unwrap(),
        now + 1,
    );
}
fn reply(
    client: &mut Client,
    sent: &Frame,
    kind: u8,
    index: u16,
    count: u16,
    data: Vec<u8>,
    now: u64,
) {
    client.ingest(
        &Frame {
            kind,
            session: client.session,
            boot: 55,
            request: sent.request,
            index,
            count,
            data,
        }
        .encode()
        .unwrap(),
        now,
    );
}

#[test]
fn loss_retries_same_identity_and_only_fetches_results_after_admission() {
    let mut client = Client::default();
    let (tx, rx) = mpsc::channel();
    client
        .submit(
            request(
                "/api/manual/pump-step",
                json!({"axis":"X","angle_deg":1800}),
            ),
            tx,
            0,
        )
        .unwrap();
    ready(&mut client, 0);
    let (first, _) = client.next(200).unwrap();
    let (retry, _) = client.next(1000).unwrap();
    assert_eq!(first, retry);
    reply(&mut client, &first, ACK, 0, 0, vec![], 1001);
    let (fetch, _) = client.next(1200).unwrap();
    assert_eq!(fetch.kind, FETCH);
    let (retry, _) = client.next(2000).unwrap();
    assert_eq!(retry, fetch);
    let data = compress(&json!({"status":200,"body":{"success":true}})).unwrap();
    reply(&mut client, &fetch, RESPONSE, 0, 1, data, 2001);
    assert_eq!(rx.recv().unwrap().unwrap()["success"], true);
    assert!(!client.completed[0].uncertain);
    assert!(client.next(3000).is_none());
}
#[test]
fn disconnect_reboot_or_timeout_never_replays_a_physical_request() {
    for failure in ["disconnect", "reboot", "timeout"] {
        let mut client = Client::default();
        let (tx, rx) = mpsc::channel();
        client
            .submit(
                request("/api/injection-pump/on", json!({"speed":20})),
                tx,
                0,
            )
            .unwrap();
        ready(&mut client, 0);
        let (sent, _) = client.next(200).unwrap();
        match failure {
            "disconnect" => client.disconnected(),
            "reboot" => client.ingest(
                &Frame {
                    boot: 66,
                    kind: ERROR,
                    ..sent
                }
                .encode()
                .unwrap(),
                201,
            ),
            _ => {
                client.next(TIMEOUT_MS + 1);
            }
        }
        assert!(rx.recv().unwrap().is_err());
        assert!(client.completed[0].uncertain);
        assert!(client.next(200000).is_none());
    }
}
#[test]
fn stop_preempts_reads_and_partial_moves_and_stays_available() {
    let mut client = Client::default();
    let (tx, rx) = mpsc::channel();
    client
        .submit(request("/api/manual/pump-step", json!({"axis":"X"})), tx, 0)
        .unwrap();
    ready(&mut client, 0);
    client.next(200);
    let (tx, _) = mpsc::channel();
    assert!(
        client
            .submit(
                request("/api/injection-pump/on", json!({"speed":20})),
                tx,
                201
            )
            .is_err()
    );
    let (tx, _) = mpsc::channel();
    client
        .submit(request("/api/manual/stop-all", json!({})), tx, 201)
        .unwrap();
    assert!(rx.recv().unwrap().is_err());
    let (frame, priority) = client.next(201).unwrap();
    assert!(priority);
    assert!(frame.request > 1);
}
#[test]
fn selected_api_scope_codec_and_wrong_sender_session_boundaries() {
    for path in [
        "/api/data/missions",
        "/api/map/live",
        "/api/motor/command",
        "/api/diagnostics/export",
        "/api/pid/test",
    ] {
        assert!(!allowed("POST", path));
    }
    assert!(allowed("POST", "/api/preset/auto/五圈"));
    assert!(!allowed("POST", "/api/preset/auto/../oops"));
    for path in [
        "/api/config",
        "/api/pid/config",
        "/api/calibration/offsets",
        "/api/waypoint-sampling",
        "/api/hardware/config",
    ] {
        assert!(allowed("GET", path));
        assert!(allowed("POST", path));
    }
    let f = Frame {
        kind: REQUEST,
        session: 1,
        boot: 2,
        request: 3,
        index: 0,
        count: 1,
        data: vec![1, 0, 2],
    };
    let mut bytes = f.encode().unwrap();
    bytes.resize(249, 0);
    assert_eq!(Frame::decode(&bytes).unwrap(), f);
    assert_eq!(
        decompress(&compress(&json!({"name":"五圈"})).unwrap()).unwrap()["name"],
        "五圈"
    );
    let mut invalid = compress(&json!({})).unwrap();
    invalid.push(1);
    assert!(decompress(&invalid).is_err());
    let mut truncated = compress(&json!({})).unwrap();
    truncated.truncate(truncated.len() - 4);
    assert!(decompress(&truncated).is_err());
}

#[test]
fn interrupted_physical_rpc_survives_restart_and_credentials_are_not_logged() {
    use usv_core::{
        identity::IdentityStore,
        station::Engine,
        wire::{WireMessage, standard::*},
    };
    let directory = tempfile::tempdir().unwrap();
    let store = IdentityStore::open(&directory.path().join("identity.sqlite")).unwrap();
    store.set_meta("ros_radio_inflight", &true).unwrap();
    drop(store);
    let mut engine = Engine::new(directory.path());
    assert!(engine.snapshot(0).safety.outputs_unknown);
    let mut payload = [0; 249];
    let credential = b"Bearer fixture-only-token";
    payload[..credential.len()].copy_from_slice(credential);
    engine.ingest(
        mavlink::MavHeader {
            system_id: 1,
            component_id: 191,
            sequence: 1,
        },
        WireMessage::Standard(MavMessage::V2_EXTENSION(V2_EXTENSION_DATA {
            message_type: MESSAGE_TYPE,
            target_system: 254,
            target_component: 190,
            target_network: 0,
            payload,
        })),
        100,
    );
    let diagnostics = serde_json::to_string(&engine.snapshot(100).diagnostics).unwrap();
    assert!(diagnostics.contains("content_redacted"));
    assert!(!diagnostics.contains("fixture-only-token"));
    assert!(!diagnostics.contains("66697874757265"));
}

#[test]
fn failed_stop_retains_unknown_outputs_and_pending_stop_blocks_new_motion() {
    let mut client = Client::default();
    let (tx, rx) = mpsc::channel();
    client
        .submit(request("/api/manual/stop-all", json!({})), tx, 0)
        .unwrap();
    assert!(client.outputs_pending());
    let (tx, _) = mpsc::channel();
    assert!(
        client
            .submit(
                request("/api/injection-pump/on", json!({"speed":20})),
                tx,
                0
            )
            .is_err()
    );
    ready(&mut client, 0);
    let (sent, _) = client.next(50).unwrap();
    reply(&mut client, &sent, ACK, 0, 0, vec![], 51);
    let (fetch, _) = client.next(100).unwrap();
    reply(
        &mut client,
        &fetch,
        RESPONSE,
        0,
        1,
        compress(&json!({"status":200,"body":{"success":false,"message":"stop not confirmed"}}))
            .unwrap(),
        101,
    );
    assert!(rx.recv().unwrap().is_err());
    assert!(client.completed[0].outputs && client.completed[0].uncertain);
}
