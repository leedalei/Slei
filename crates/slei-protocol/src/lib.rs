//! Versioned daemon protocol types for Slei clients.

pub mod dto;
pub mod error;
pub mod event;
pub mod version;

pub use error::{ApiError, ErrorCode};
pub use event::EventEnvelope;
pub use version::{ProtocolHandshake, PROTOCOL_VERSION};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn protocol_types_round_trip_through_json() {
        let error = ApiError {
            code: ErrorCode::PermissionViolation,
            key: "error.permission_violation".to_string(),
            request_id: Some("req-1".to_string()),
            detail: None,
        };
        let json = serde_json::to_string(&error).expect("api error serializes");
        let decoded: ApiError = serde_json::from_str(&json).expect("api error deserializes");
        assert_eq!(decoded, error);

        let event = EventEnvelope {
            sequence: 42,
            event_type: "approval.created".to_string(),
            entity_id: "approval-1".to_string(),
            payload: serde_json::json!({ "status": "pending" }),
        };
        let json = serde_json::to_string(&event).expect("event serializes");
        let decoded: EventEnvelope = serde_json::from_str(&json).expect("event deserializes");
        assert_eq!(decoded, event);

        let handshake = ProtocolHandshake {
            version: PROTOCOL_VERSION.to_string(),
        };
        assert_eq!(handshake.version, "v1");
    }
}
