use crate::daemon_broker::{DaemonBroker, EventReconnectReceipt, SanitizedDaemonStatus};

pub fn daemon_status(broker: &DaemonBroker) -> SanitizedDaemonStatus {
    broker.status()
}

pub fn reconnect_events(broker: &DaemonBroker, after: u64) -> EventReconnectReceipt {
    broker.reconnect_events(after)
}
