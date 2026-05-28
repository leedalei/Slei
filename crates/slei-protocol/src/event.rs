use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct EventEnvelope {
    pub sequence: u64,
    pub event_type: String,
    pub entity_id: String,
    pub payload: serde_json::Value,
}
