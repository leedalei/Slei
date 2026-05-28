use thiserror::Error;

#[derive(Debug, Error)]
pub enum DaemonError {
    #[error("unauthorized")]
    Unauthorized,
}
