use std::net::SocketAddr;
use std::path::PathBuf;

use slei_daemon::app::build_router;
use slei_daemon::auth::AuthToken;
use slei_daemon::state::AppState;

const DESKTOP_TOKEN: &str = "desktop-session-token";

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let addr = std::env::var("SLEI_DAEMON_ADDR")
        .unwrap_or_else(|_| "127.0.0.1:4319".to_string())
        .parse::<SocketAddr>()?;
    let listener = tokio::net::TcpListener::bind(addr).await?;
    let local_addr = listener.local_addr()?;
    configure_child_cli_environment(local_addr);
    let state = AppState::for_desktop(AuthToken::from_static(DESKTOP_TOKEN));
    eprintln!("slei-daemon listening on {}", local_addr);
    axum::serve(listener, build_router(state)).await?;
    Ok(())
}

fn configure_child_cli_environment(local_addr: SocketAddr) {
    std::env::set_var("SLEI_DAEMON_URL", format!("http://{local_addr}"));
    std::env::set_var("SLEI_DAEMON_TOKEN", DESKTOP_TOKEN);
    prepend_path(default_slei_cli_dir());
}

fn default_slei_cli_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(std::path::Path::parent)
        .map(|repo_root| repo_root.join("target/debug"))
        .unwrap_or_else(|| PathBuf::from("target/debug"))
}

fn prepend_path(path: PathBuf) {
    let current = std::env::var_os("PATH").unwrap_or_default();
    let mut paths = std::env::split_paths(&current).collect::<Vec<_>>();
    if !paths.iter().any(|candidate| candidate == &path) {
        paths.insert(0, path);
    }
    if let Ok(joined) = std::env::join_paths(paths) {
        std::env::set_var("PATH", joined);
    }
}
