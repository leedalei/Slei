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

#[derive(Clone, Debug, Serialize)]
pub struct ArtifactOpenReceipt {
    pub artifact_id: String,
    pub open_token: String,
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

    pub fn request_artifact_open(
        &self,
        artifact_id: &str,
    ) -> Result<ArtifactOpenReceipt, ArtifactOpenError> {
        if !artifact_id.starts_with("artifact_")
            || artifact_id.contains('/')
            || artifact_id.starts_with("file:")
        {
            return Err(ArtifactOpenError::ArtifactIdRequired);
        }

        self.last_authorization_header
            .replace(Some(format!("Bearer {}", self.descriptor.token)));
        Ok(ArtifactOpenReceipt {
            artifact_id: artifact_id.to_string(),
            open_token: format!("open:{artifact_id}"),
        })
    }

    pub fn last_authorization_header(&self) -> Option<String> {
        self.last_authorization_header.borrow().clone()
    }
}

#[derive(Debug, thiserror::Error)]
pub enum ArtifactOpenError {
    #[error("artifact id is required")]
    ArtifactIdRequired,
}
