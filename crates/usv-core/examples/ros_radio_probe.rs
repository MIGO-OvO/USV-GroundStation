//! Run only against tools/verify-ros-radio.py's simulated loopback vessel.
use serde_json::{Value, json};
use std::{
    path::PathBuf,
    thread,
    time::{Duration, Instant},
};
use usv_core::{
    ros_radio::Request,
    station::{Intent, Station},
    transport::ConnectionConfig,
};
fn main() {
    let port: u16 = std::env::args()
        .nth(1)
        .expect("loopback port")
        .parse()
        .unwrap();
    let directory = PathBuf::from(std::env::args().nth(2).expect("temporary state directory"));
    let station = Station::start(&directory).unwrap();
    station
        .dispatch(Intent::Connect {
            config: ConnectionConfig::Tcp {
                host: "127.0.0.1".into(),
                port,
            },
            target_system: Some(1),
        })
        .unwrap();
    let until = Instant::now() + Duration::from_secs(5);
    while station.snapshot().unwrap().link != "connected" {
        assert!(Instant::now() < until);
        thread::sleep(Duration::from_millis(20));
    }
    let rpc = |method: &str, path: &str, body: Value| {
        station
            .ros_control(
                Request {
                    method: method.into(),
                    path: path.into(),
                    body,
                    authorization: String::new(),
                },
                true,
            )
            .unwrap()
    };
    let config = rpc("GET", "/api/config", json!({}));
    assert!(config.is_object());
    rpc(
        "POST",
        "/api/config",
        json!({"pump_settings":{"pid_precision":0.2}}),
    );
    assert_eq!(
        rpc("GET", "/api/config", json!({}))["pump_settings"]["pid_precision"],
        0.2
    );
    let sampling = json!({
        "loop_count": 3,
        "steps": [
            {"name":"取样","interval":1000,"X":{"enable":"E","direction":"F","speed":"5","angle":"90"}},
            {"name":"等待","interval":500,"X":{"enable":"D"}},
        ],
    });
    let write = Request {
        method: "POST".into(),
        path: "/api/config".into(),
        body: json!({"sampling_sequence":sampling}),
        authorization: String::new(),
    };
    assert!(
        station
            .ros_control_for_system(write.clone(), false, Some(2))
            .unwrap_err()
            .contains("飞控已切换")
    );
    station
        .ros_control_for_system(write, false, Some(1))
        .unwrap();
    let readback = rpc("GET", "/api/config", json!({}));
    assert_eq!(readback["sampling_sequence"], sampling);
    assert_eq!(readback["waypoint_sampling"], config["waypoint_sampling"]);
    rpc(
        "POST",
        "/api/pid/config",
        json!({"Kp":0.25,"Ki":0.01,"Kd":0.03,"output_min":1,"output_max":8}),
    );
    assert_eq!(rpc("GET", "/api/pid/config", json!({}))["data"]["Kp"], 0.25);
    rpc(
        "POST",
        "/api/calibration/offsets",
        json!({"offsets":{"X":1,"Y":2,"Z":3,"A":4}}),
    );
    assert_eq!(
        rpc("GET", "/api/calibration/offsets", json!({}))["data"]["X"],
        1.0
    );
    rpc("POST", "/api/calibration/zero", json!({"axis":"X"}));
    rpc("POST", "/api/calibration/reset", json!({"axis":"X"}));
    rpc("POST", "/api/calibration/start", json!({"motors":"XYZA"}));
    rpc(
        "POST",
        "/api/preset/auto/五圈",
        json!({"steps":[],"loop_count":5}),
    );
    assert_eq!(
        rpc("GET", "/api/preset/auto/五圈", json!({}))["data"]["loop_count"],
        5
    );
    assert!(
        rpc("GET", "/api/presets/auto", json!({}))["data"]
            .as_array()
            .unwrap()
            .contains(&json!("五圈"))
    );
    rpc("DELETE", "/api/preset/auto/五圈", json!({}));
    rpc(
        "POST",
        "/api/waypoint-sampling",
        json!({"1":{"loop_count":5}}),
    );
    rpc("GET", "/api/waypoint-sampling", json!({}));
    rpc("POST", "/api/waypoint-sampling/2", json!({"loop_count":3}));
    rpc("GET", "/api/waypoint-sampling/2", json!({}));
    rpc("DELETE", "/api/waypoint-sampling/2", json!({}));
    for path in ["link", "system", "events", "history"] {
        rpc("GET", &format!("/api/diagnostics/{path}"), json!({}));
    }
    rpc("POST", "/api/manual/mode", json!({"enabled":true}));
    rpc("GET", "/api/manual/status", json!({}));
    rpc(
        "POST",
        "/api/manual/pump-step",
        json!({"axis":"X","direction":"F","speed_rpm":10,"angle_deg":1800,"continuous":false}),
    );
    rpc("POST", "/api/manual/stop-all", json!({}));
    rpc("POST", "/api/manual/mode", json!({"enabled":false}));
    rpc("POST", "/api/injection-pump/status", json!({}));
    rpc("POST", "/api/injection-pump/set", json!({"speed":20}));
    rpc("POST", "/api/injection-pump/on", json!({"speed":20}));
    rpc("POST", "/api/injection-pump/off", json!({}));
    let hardware = rpc("GET", "/api/hardware/config", json!({}))["data"].clone();
    rpc("POST", "/api/hardware/config", hardware.clone());
    rpc("POST", "/api/hardware/apply", hardware);
    rpc("GET", "/api/hardware/serial-ports", json!({}));
    assert!(!station.snapshot().unwrap().safety.outputs_unknown);
    println!(
        "ROS radio probe passed: scoped configuration/control/diagnostics, Unicode presets, actual MAVLink 2 TCP framing"
    );
}
