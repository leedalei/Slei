use std::net::SocketAddr;

use slei_daemon::app::build_router;
use slei_daemon::auth::AuthToken;
use slei_daemon::state::AppState;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let addr = std::env::var("SLEI_DAEMON_ADDR")
        .unwrap_or_else(|_| "127.0.0.1:4319".to_string())
        .parse::<SocketAddr>()?;
    let state = AppState::for_desktop(AuthToken::from_static("desktop-session-token"));
    let listener = tokio::net::TcpListener::bind(addr).await?;
    eprintln!("slei-daemon listening on {}", listener.local_addr()?);
    axum::serve(listener, build_router(state)).await?;
    Ok(())
}
