use std::{
    io::{Read, Write},
    net::TcpListener,
    thread,
};
use usv_core::{maps::MapCache, ros::RosClient};

// A single-request HTTP fixture on loopback, with ROS's documented envelope.
fn server(
    status: &str,
    content_type: &str,
    bytes: Vec<u8>,
    expected: &str,
) -> (String, thread::JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let (status, content_type, expected) = (
        status.to_owned(),
        content_type.to_owned(),
        expected.to_owned(),
    );
    let handle = thread::spawn(move || {
        let (mut s, _) = listener.accept().unwrap();
        s.set_read_timeout(Some(std::time::Duration::from_secs(3)))
            .unwrap();
        let mut b = [0; 8192];
        let n = s.read(&mut b).unwrap();
        let request = String::from_utf8_lossy(&b[..n]);
        assert!(request.starts_with(&expected), "{request}");
        write!(s,"HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",bytes.len()).unwrap();
        s.write_all(&bytes).unwrap();
    });
    (base, handle)
}
#[test]
fn data_center_reads_qgc_origin_records_with_ros_envelope() {
    let body=br#"{"success":true,"data":[{"id":"m1","name":"QGC sampling","summary":{"sample_count":1}}]}"#;
    let (base, h) = server(
        "200 OK",
        "application/json",
        body.to_vec(),
        "GET /api/data/missions ",
    );
    let value = RosClient::new(&base)
        .unwrap()
        .get("/api/data/missions")
        .unwrap();
    assert_eq!(value["data"][0]["id"], "m1");
    h.join().unwrap();
}
#[test]
fn raw_csv_and_archive_download_preserve_bytes() {
    for (suffix, mime, body) in [
        (
            "raw.csv",
            "text/csv",
            b"sample_id,source,voltage\r\ns1,qgc,1.234\r\n".to_vec(),
        ),
        ("archive", "application/zip", {
            let mut zip = zip::ZipWriter::new(std::io::Cursor::new(vec![]));
            zip.start_file("sample.json", zip::write::SimpleFileOptions::default())
                .unwrap();
            zip.write_all(br#"{"sample_id":"s1","source":"qgc"}"#)
                .unwrap();
            zip.finish().unwrap().into_inner()
        }),
    ] {
        let expected = format!("GET /api/data/mission/m1/{suffix} ");
        let (base, h) = server("200 OK", mime, body.clone(), &expected);
        let file = RosClient::new(&base)
            .unwrap()
            .download(&format!("/api/data/mission/m1/{suffix}"))
            .unwrap();
        assert_eq!(file.bytes, body);
        assert_eq!(file.content_type, mime);
        h.join().unwrap();
    }
}
#[test]
fn ros_errors_are_reported_without_success_fallback() {
    let (base, h) = server(
        "200 OK",
        "application/json",
        br#"{"success":false,"error":"archive unavailable"}"#.to_vec(),
        "GET /api/data/missions ",
    );
    assert_eq!(
        RosClient::new(&base)
            .unwrap()
            .get("/api/data/missions")
            .unwrap_err(),
        "archive unavailable"
    );
    h.join().unwrap();
}

#[test]
fn download_uses_utf8_server_filename_and_rejects_unsafe_paths() {
    for (header, expected) in [
        (
            "attachment; filename=sample.csv; filename*=UTF-8''%E6%B9%96%E5%BF%83-20261116_123456_123456.csv",
            Some("湖心-20261116_123456_123456.csv"),
        ),
        (
            "attachment; filename=lake-2-20261116_123456_123456.csv",
            Some("lake-2-20261116_123456_123456.csv"),
        ),
        ("attachment; filename*=UTF-8''..%2Foutside.csv", None),
        ("attachment; filename*=UTF-8''C%3A%5Coutside.csv", None),
        ("attachment; filename*=UTF-8''bad%00.csv", None),
        ("attachment; filename=NUL.csv", None),
    ] {
        let content_type = format!("text/csv\r\nContent-Disposition: {header}");
        let (base, handle) = server(
            "200 OK",
            &content_type,
            b"voltage\r\n1.2\r\n".to_vec(),
            "GET /api/data/mission/m1/raw.csv ",
        );
        let result = RosClient::new(&base)
            .unwrap()
            .download("/api/data/mission/m1/raw.csv");
        if let Some(name) = expected {
            assert_eq!(result.unwrap().name, name);
        } else {
            assert!(result.is_err());
        }
        handle.join().unwrap();
    }
}
#[test]
fn physical_web_commands_and_cross_origin_paths_are_not_exposed() {
    let ros = RosClient::new("http://127.0.0.1:9").unwrap();
    for path in [
        "/api/manual/pump-step",
        "/api/sampling/start",
        "/api/data/../mission/x",
        "https://example.invalid/api/data/missions",
    ] {
        assert!(ros.post(path, &serde_json::json!({})).is_err());
    }
    for base in ["file:///tmp/ros", "http://user:password@localhost"] {
        assert!(RosClient::new(base).is_err());
    }
}
#[test]
fn online_tile_is_cached_and_available_with_server_offline() {
    let png = b"\x89PNG\r\n\x1a\nfixture".to_vec();
    let (base, h) = server(
        "200 OK",
        "image/png",
        png.clone(),
        "GET /api/map/tile/gsatellite/2/1/1.png?v=3 ",
    );
    let d = tempfile::tempdir().unwrap();
    let cache = MapCache::new(d.path()).unwrap();
    assert_eq!(
        cache.tile(&base, "gsatellite", 2, 1, 1, false).unwrap(),
        png
    );
    h.join().unwrap();
    assert_eq!(cache.tile(&base, "gsatellite", 2, 1, 1, true).unwrap(), png);
    assert!(cache.tile(&base, "gsatellite", 2, 1, 2, true).is_err());
    assert_eq!(cache.stats().unwrap()["tiles"], 1);
    assert!(cache.tile(&base, "../invalid", 2, 1, 1, true).is_err());
    assert!(cache.tile(&base, "gsatellite", 2, 4, 0, true).is_err());
}
#[test]
fn diagnostic_zip_preserves_clock_domains_and_jsonl() {
    let d = tempfile::tempdir().unwrap();
    let station = usv_core::station::Station::start(d.path()).unwrap();
    station
        .dispatch(usv_core::station::Intent::Disconnect)
        .unwrap();
    let bytes = station
        .export(Some(serde_json::json!({"jetson_clock":"different"})))
        .unwrap();
    let mut zip = zip::ZipArchive::new(std::io::Cursor::new(bytes)).unwrap();
    let mut clock = String::new();
    zip.by_name("clocks.txt")
        .unwrap()
        .read_to_string(&mut clock)
        .unwrap();
    assert!(clock.contains("clock_id"));
    let mut logs = String::new();
    zip.by_name("communication.jsonl")
        .unwrap()
        .read_to_string(&mut logs)
        .unwrap();
    for line in logs.lines() {
        let v: serde_json::Value = serde_json::from_str(line).unwrap();
        assert!(v["clock_id"].is_string());
        assert!(v["mono_ms"].is_number());
    }
    assert!(zip.by_name("jetson-report.json").is_ok());
}
