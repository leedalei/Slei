pub mod commands;
pub mod daemon_broker;

#[cfg(test)]
mod tests {
    use super::commands::{daemon_status, reconnect_events, request_artifact_open};
    use super::daemon_broker::{DaemonBroker, RuntimeDescriptor};

    #[test]
    fn broker_sanitizes_status_for_webview() {
        let broker = DaemonBroker::for_tests(RuntimeDescriptor {
            endpoint: "http://127.0.0.1:4319".to_string(),
            event_socket: "ws://127.0.0.1:4319/v1/events/ws".to_string(),
            token: "secret-token".to_string(),
            daemon_version: "0.1.0".to_string(),
            protocol_version: "v1".to_string(),
        });

        let status = daemon_status(&broker);
        let serialized = serde_json::to_string(&status).unwrap();

        assert!(status.connected);
        assert!(!serialized.contains("secret-token"));
        assert!(!serialized.contains("127.0.0.1"));
        assert!(!serialized.contains("ws://"));
    }

    #[test]
    fn broker_reconnect_uses_token_internally_and_returns_only_sequence() {
        let broker = DaemonBroker::for_tests(RuntimeDescriptor {
            endpoint: "http://127.0.0.1:4319".to_string(),
            event_socket: "ws://127.0.0.1:4319/v1/events/ws".to_string(),
            token: "secret-token".to_string(),
            daemon_version: "0.1.0".to_string(),
            protocol_version: "v1".to_string(),
        });

        let receipt = reconnect_events(&broker, 42);
        let serialized = serde_json::to_string(&receipt).unwrap();

        assert_eq!(receipt.after, 42);
        assert_eq!(
            broker.last_authorization_header().as_deref(),
            Some("Bearer secret-token")
        );
        assert!(!serialized.contains("secret-token"));
        assert!(!serialized.contains("ws://"));
    }

    #[test]
    fn artifact_open_accepts_daemon_ids_only_and_hides_paths() {
        let broker = DaemonBroker::for_tests(RuntimeDescriptor {
            endpoint: "http://127.0.0.1:4319".to_string(),
            event_socket: "ws://127.0.0.1:4319/v1/events/ws".to_string(),
            token: "secret-token".to_string(),
            daemon_version: "0.1.0".to_string(),
            protocol_version: "v1".to_string(),
        });

        let receipt = request_artifact_open(&broker, "artifact_123").unwrap();
        let serialized = serde_json::to_string(&receipt).unwrap();

        assert_eq!(receipt.artifact_id, "artifact_123");
        assert_eq!(
            broker.last_authorization_header().as_deref(),
            Some("Bearer secret-token")
        );
        assert!(!serialized.contains("/Users/"));
        assert!(!serialized.contains("secret-token"));
        assert!(request_artifact_open(&broker, "/Users/lei/secret.md").is_err());
        assert!(request_artifact_open(&broker, "file:///etc/passwd").is_err());
    }
}
