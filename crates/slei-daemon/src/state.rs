use crate::auth::AuthToken;

#[derive(Clone, Debug)]
pub struct AppState {
    pub auth_token: AuthToken,
    pub daemon_version: &'static str,
    pub protocol_version: &'static str,
}

impl AppState {
    pub fn for_tests(auth_token: AuthToken) -> Self {
        Self {
            auth_token,
            daemon_version: env!("CARGO_PKG_VERSION"),
            protocol_version: slei_protocol::PROTOCOL_VERSION,
        }
    }
}
