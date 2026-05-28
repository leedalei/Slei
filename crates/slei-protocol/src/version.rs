use serde::{Deserialize, Serialize};

pub const PROTOCOL_VERSION: &str = "v1";

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProtocolHandshake {
    pub version: String,
}
