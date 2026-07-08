use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};
use uuid::Uuid;

#[test]
fn daemon_binary_serves_health_on_configured_addr() {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind ephemeral port");
    let addr = listener.local_addr().expect("read local addr");
    drop(listener);
    let data_root = std::env::temp_dir().join(format!("slei-daemon-binary-{}", Uuid::new_v4()));
    std::fs::create_dir_all(&data_root).expect("create isolated daemon data root");

    let mut child = Command::new(env!("CARGO_BIN_EXE_slei-daemon"))
        .env("SLEI_DAEMON_ADDR", addr.to_string())
        .env("SLEI_DATA_ROOT", &data_root)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("spawn slei-daemon");

    let deadline = Instant::now() + Duration::from_secs(5);
    let mut response = String::new();
    while Instant::now() < deadline {
        if let Ok(mut stream) = TcpStream::connect(addr) {
            stream
                .write_all(b"GET /health HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n")
                .expect("write health request");
            stream
                .read_to_string(&mut response)
                .expect("read health response");
            break;
        }
        if let Some(status) = child.try_wait().expect("check daemon status") {
            panic!("slei-daemon exited before serving health: {status}");
        }
        thread::sleep(Duration::from_millis(50));
    }

    let _ = child.kill();
    let _ = child.wait();

    assert!(response.starts_with("HTTP/1.1 200"), "{response}");
    assert!(response.contains("\"status\":\"ok\""), "{response}");
}

#[test]
fn daemon_binary_reports_dynamic_stdout_addr_and_uses_custom_token_auth() {
    let data_root =
        std::env::temp_dir().join(format!("slei-daemon-binary-dynamic-{}", Uuid::new_v4()));
    std::fs::create_dir_all(&data_root).expect("create isolated daemon data root");

    let mut child = Command::new(env!("CARGO_BIN_EXE_slei-daemon"))
        .env("SLEI_DAEMON_ADDR", "127.0.0.1:0")
        .env("SLEI_DAEMON_TOKEN", "packaged-smoke-token")
        .env("SLEI_DATA_ROOT", &data_root)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("spawn slei-daemon");

    let stdout = child.stdout.take().expect("daemon stdout");
    let (line_tx, line_rx) = mpsc::channel();
    thread::spawn(move || {
        let mut line = String::new();
        let _ = BufReader::new(stdout).read_line(&mut line);
        let _ = line_tx.send(line);
    });

    let line = line_rx
        .recv_timeout(Duration::from_secs(5))
        .expect("daemon stdout readiness line");
    let addr = line
        .trim()
        .strip_prefix("slei-daemon listening on ")
        .expect("readiness prefix")
        .parse()
        .expect("parse dynamic readiness addr");

    let authorized = http_get(addr, "/v1/nodes", Some("packaged-smoke-token"));
    let fallback = http_get(addr, "/v1/nodes", Some("desktop-session-token"));

    let _ = child.kill();
    let _ = child.wait();

    assert!(authorized.starts_with("HTTP/1.1 200"), "{authorized}");
    assert!(authorized.contains("\"nodes\""), "{authorized}");
    assert!(fallback.starts_with("HTTP/1.1 401"), "{fallback}");
}

fn http_get(addr: std::net::SocketAddr, path: &str, token: Option<&str>) -> String {
    let mut stream = TcpStream::connect(addr).expect("connect daemon");
    let authorization = token
        .map(|token| format!("Authorization: Bearer {token}\r\n"))
        .unwrap_or_default();
    let request = format!(
        "GET {path} HTTP/1.1\r\nHost: 127.0.0.1\r\n{authorization}Connection: close\r\n\r\n"
    );
    stream
        .write_all(request.as_bytes())
        .expect("write daemon request");
    let mut response = String::new();
    stream
        .read_to_string(&mut response)
        .expect("read daemon response");
    response
}
