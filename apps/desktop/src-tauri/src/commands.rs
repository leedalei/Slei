use crate::daemon_broker::{
    ArtifactOpenError, ArtifactOpenReceipt, DaemonBroker, EventReconnectReceipt,
    SanitizedDaemonStatus,
};

pub fn daemon_status(broker: &DaemonBroker) -> SanitizedDaemonStatus {
    broker.status()
}

pub fn reconnect_events(broker: &DaemonBroker, after: u64) -> EventReconnectReceipt {
    broker.reconnect_events(after)
}

pub fn request_artifact_open(
    broker: &DaemonBroker,
    artifact_id: &str,
) -> Result<ArtifactOpenReceipt, ArtifactOpenError> {
    broker.request_artifact_open(artifact_id)
}
