use std::cell::RefCell;

use serde::Serialize;

#[derive(Clone, Debug)]
pub struct RuntimeDescriptor {
    pub endpoint: String,
    pub event_socket: String,
    pub token: String,
    pub daemon_version: String,
    pub protocol_version: String,
}

#[derive(Debug)]
pub struct DaemonBroker {
    descriptor: RuntimeDescriptor,
    last_authorization_header: RefCell<Option<String>>,
}

#[derive(Clone, Debug, Serialize)]
pub struct SanitizedDaemonStatus {
    pub connected: bool,
    pub daemon_version: String,
    pub protocol_version: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct EventReconnectReceipt {
    pub after: u64,
}

impl DaemonBroker {
    pub fn for_tests(descriptor: RuntimeDescriptor) -> Self {
        Self {
            descriptor,
            last_authorization_header: RefCell::new(None),
        }
    }

    pub fn status(&self) -> SanitizedDaemonStatus {
        SanitizedDaemonStatus {
            connected: true,
            daemon_version: self.descriptor.daemon_version.clone(),
            protocol_version: self.descriptor.protocol_version.clone(),
        }
    }

    pub fn reconnect_events(&self, after: u64) -> EventReconnectReceipt {
        let _socket = &self.descriptor.event_socket;
        self.last_authorization_header
            .replace(Some(format!("Bearer {}", self.descriptor.token)));
        EventReconnectReceipt { after }
    }

    pub fn last_authorization_header(&self) -> Option<String> {
        self.last_authorization_header.borrow().clone()
    }
}
