use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum ErrorCode {
    #[serde(rename = "E201")]
    ProtocolVersionMismatch,
    #[serde(rename = "E202")]
    AuthTokenInvalid,
    #[serde(rename = "E403")]
    PermissionViolation,
    #[serde(rename = "E604")]
    TaskRootMessageDeletionBlocked,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ApiError {
    pub code: ErrorCode,
    pub key: String,
    pub request_id: Option<String>,
    pub detail: Option<String>,
}
