use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

#[test]
fn daemon_binary_serves_health_on_configured_addr() {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind ephemeral port");
    let addr = listener.local_addr().expect("read local addr");
    drop(listener);

    let mut child = Command::new(env!("CARGO_BIN_EXE_slei-daemon"))
        .env("SLEI_DAEMON_ADDR", addr.to_string())
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
