use std::env::VarError;
use std::ffi::OsString;
use std::fmt;
use std::net::AddrParseError;
use std::net::SocketAddr;
use std::path::PathBuf;

use slei_daemon::app::build_router;
use slei_daemon::auth::AuthToken;
use slei_daemon::state::AppState;

const DESKTOP_TOKEN: &str = "desktop-session-token";
const DEFAULT_DAEMON_ADDR: &str = "127.0.0.1:4319";
const RUNTIME_MANAGED_RUNNER_ENV: &str = "SLEI_CLAUDE_AGENT_RUNNER";

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let addr = bind_addr_from_env()?;
    let daemon_token = daemon_token_from_env()?;
    let listener = tokio::net::TcpListener::bind(addr).await?;
    let local_addr = listener.local_addr()?;
    configure_child_cli_environment(local_addr, &daemon_token)?;
    let state = AppState::for_desktop(AuthToken::from_string(daemon_token));
    println!("slei-daemon listening on {}", local_addr);
    axum::serve(listener, build_router(state)).await?;
    Ok(())
}

fn daemon_token_from_env() -> Result<String, DaemonTokenEnvError> {
    daemon_token_from_env_result(std::env::var("SLEI_DAEMON_TOKEN"))
}

fn daemon_token_from_env_result(
    env_token: Result<String, VarError>,
) -> Result<String, DaemonTokenEnvError> {
    match env_token {
        Ok(token) if token.trim().is_empty() => Err(DaemonTokenEnvError::Empty),
        Ok(token) => Ok(token),
        Err(VarError::NotPresent) => Ok(DESKTOP_TOKEN.to_string()),
        Err(VarError::NotUnicode(_)) => Err(DaemonTokenEnvError::InvalidUnicode),
    }
}

fn bind_addr_from_env() -> Result<SocketAddr, AddrParseError> {
    bind_addr_from_env_value(std::env::var("SLEI_DAEMON_ADDR").ok().as_deref())
}

fn bind_addr_from_env_value(env_addr: Option<&str>) -> Result<SocketAddr, AddrParseError> {
    env_addr
        .unwrap_or(DEFAULT_DAEMON_ADDR)
        .parse::<SocketAddr>()
}

fn configure_child_cli_environment(
    local_addr: SocketAddr,
    daemon_token: &str,
) -> Result<(), std::env::JoinPathsError> {
    let env = child_cli_environment_values(
        local_addr,
        daemon_token,
        default_slei_cli_dir(),
        std::env::var_os("PATH"),
        std::env::var_os(RUNTIME_MANAGED_RUNNER_ENV).is_some(),
    )?;
    std::env::set_var("SLEI_DAEMON_URL", env.daemon_url);
    std::env::set_var("SLEI_DAEMON_TOKEN", env.daemon_token);
    std::env::set_var("PATH", env.path);
    Ok(())
}

struct ChildCliEnvironment {
    daemon_url: String,
    daemon_token: String,
    path: OsString,
}

fn child_cli_environment_values(
    local_addr: SocketAddr,
    daemon_token: &str,
    cli_dir: PathBuf,
    current_path: Option<OsString>,
    runtime_managed_path: bool,
) -> Result<ChildCliEnvironment, std::env::JoinPathsError> {
    Ok(ChildCliEnvironment {
        daemon_url: format!("http://{local_addr}"),
        daemon_token: daemon_token.to_string(),
        path: child_cli_path_value(cli_dir, current_path, runtime_managed_path)?,
    })
}

fn default_slei_cli_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(std::path::Path::parent)
        .map(|repo_root| repo_root.join("target/debug"))
        .unwrap_or_else(|| PathBuf::from("target/debug"))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DaemonTokenEnvError {
    InvalidUnicode,
    Empty,
}

impl fmt::Display for DaemonTokenEnvError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidUnicode => write!(formatter, "SLEI_DAEMON_TOKEN must be valid Unicode"),
            Self::Empty => write!(formatter, "SLEI_DAEMON_TOKEN must not be empty"),
        }
    }
}

impl std::error::Error for DaemonTokenEnvError {}

fn child_cli_path_value(
    path: PathBuf,
    current_path: Option<OsString>,
    runtime_managed_path: bool,
) -> Result<OsString, std::env::JoinPathsError> {
    let current = current_path.unwrap_or_default();
    let mut paths = std::env::split_paths(&current).collect::<Vec<_>>();
    if runtime_managed_path {
        return std::env::join_paths(paths);
    }
    if !paths.iter().any(|candidate| candidate == &path) {
        paths.insert(0, path);
    }
    std::env::join_paths(paths)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env::VarError;
    use std::ffi::OsString;

    #[test]
    fn daemon_token_prefers_env_token_and_falls_back_to_dev_token() {
        assert_eq!(
            daemon_token_from_env_result(Ok("packaged-session-token".to_string()))
                .expect("configured token"),
            "packaged-session-token"
        );
        assert_eq!(
            daemon_token_from_env_result(Err(VarError::NotPresent)).expect("fallback token"),
            DESKTOP_TOKEN
        );
    }

    #[test]
    fn daemon_token_rejects_invalid_or_blank_env_token() {
        assert!(daemon_token_from_env_result(Ok("".to_string())).is_err());
        assert!(daemon_token_from_env_result(Ok(" \t ".to_string())).is_err());
        assert!(
            daemon_token_from_env_result(Err(VarError::NotUnicode(OsString::from(
                "invalid-token"
            ))))
            .is_err()
        );
    }

    #[test]
    fn bind_addr_reads_env_value_and_allows_dynamic_port() {
        assert_eq!(
            bind_addr_from_env_value(Some("127.0.0.1:0")).expect("parse dynamic bind addr"),
            "127.0.0.1:0".parse::<SocketAddr>().unwrap()
        );
        assert_eq!(
            bind_addr_from_env_value(None).expect("parse default bind addr"),
            "127.0.0.1:4319".parse::<SocketAddr>().unwrap()
        );
    }

    #[test]
    fn child_cli_environment_exports_actual_local_addr_url() {
        let local_addr = "127.0.0.1:51234".parse::<SocketAddr>().unwrap();
        let env = child_cli_environment_values(
            local_addr,
            "packaged-session-token",
            PathBuf::from("/repo/target/debug"),
            None,
            false,
        )
        .expect("build child CLI environment");

        assert_eq!(env.daemon_url, "http://127.0.0.1:51234");
    }

    #[test]
    fn child_cli_environment_exports_server_auth_token() {
        let local_addr = "127.0.0.1:51235".parse::<SocketAddr>().unwrap();
        let env = child_cli_environment_values(
            local_addr,
            "packaged-session-token",
            PathBuf::from("/repo/target/debug"),
            None,
            false,
        )
        .expect("build child CLI environment");

        assert_eq!(env.daemon_token, "packaged-session-token");
    }

    #[test]
    fn server_auth_uses_configured_daemon_token() {
        let token = AuthToken::from_string(
            daemon_token_from_env_result(Ok("packaged-session-token".to_string()))
                .expect("configured token"),
        );

        assert_eq!(
            token.authorization_header(),
            "Bearer packaged-session-token"
        );
    }

    #[test]
    fn child_cli_dev_path_augmentation_prepends_repo_cli_and_preserves_entries() {
        let bundled_node = PathBuf::from("/Applications/Slei.app/Contents/Resources/node/bin");
        let bundled_native = PathBuf::from("/Applications/Slei.app/Contents/Resources/native");
        let repo_cli = PathBuf::from("/repo/target/debug");
        let inherited_path =
            std::env::join_paths([bundled_node.as_path(), bundled_native.as_path()])
                .expect("join inherited PATH");
        let env = child_cli_environment_values(
            "127.0.0.1:51236".parse::<SocketAddr>().unwrap(),
            "packaged-session-token",
            repo_cli.clone(),
            Some(inherited_path),
            false,
        )
        .expect("build child CLI environment");
        let paths = std::env::split_paths(&env.path).collect::<Vec<_>>();

        assert_eq!(paths, vec![repo_cli, bundled_node, bundled_native]);
    }

    #[test]
    fn child_cli_packaged_path_preserves_runtime_entries_ahead_of_repo_cli() {
        let bundled_node = PathBuf::from("/Applications/Slei.app/Contents/Resources/node/bin");
        let bundled_native = PathBuf::from("/Applications/Slei.app/Contents/Resources/native");
        let repo_cli = PathBuf::from("/repo/target/debug");
        let inherited_path =
            std::env::join_paths([bundled_node.as_path(), bundled_native.as_path()])
                .expect("join inherited PATH");
        let env = child_cli_environment_values(
            "127.0.0.1:51237".parse::<SocketAddr>().unwrap(),
            "packaged-session-token",
            repo_cli,
            Some(inherited_path),
            true,
        )
        .expect("build child CLI environment");
        let paths = std::env::split_paths(&env.path).collect::<Vec<_>>();

        assert_eq!(paths, vec![bundled_node, bundled_native]);
    }
}
