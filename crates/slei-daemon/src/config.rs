use serde::Serialize;
use std::path::PathBuf;
use uuid::Uuid;

use crate::auth::AuthToken;

#[derive(Clone, Debug)]
pub struct DaemonConfig {
    pub port: u16,
    pub instance_id: Uuid,
    pub token: AuthToken,
}

#[derive(Clone, Debug, Serialize)]
pub struct RuntimeDescriptor {
    pub port: u16,
    pub instance_id: Uuid,
    pub protocol_version: &'static str,
}

#[derive(Clone, Debug)]
pub struct WorkerLaunchConfig {
    pub artifact_path: PathBuf,
}

impl WorkerLaunchConfig {
    pub fn standalone(artifact_path: PathBuf) -> Self {
        Self { artifact_path }
    }
}

impl DaemonConfig {
    pub fn for_tests(token: AuthToken) -> Self {
        Self {
            port: 0,
            instance_id: Uuid::new_v4(),
            token,
        }
    }

    pub fn runtime_descriptor(&self) -> RuntimeDescriptor {
        RuntimeDescriptor {
            port: self.port,
            instance_id: self.instance_id,
            protocol_version: slei_protocol::PROTOCOL_VERSION,
        }
    }
}
