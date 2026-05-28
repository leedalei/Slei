use std::path::PathBuf;

use serde::Deserialize;
use tokio::process::Command;

use crate::config::WorkerLaunchConfig;

#[derive(Clone, Debug)]
pub struct WorkerLauncher {
    config: WorkerLaunchConfig,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct WorkerReadiness {
    pub status: WorkerLaunchStatus,
    pub version: Option<String>,
    pub runtime: Option<String>,
    pub message: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum WorkerLaunchStatus {
    Ready,
    MissingWorker,
    SdkFailed,
    AuthMissing,
}

#[derive(Debug, Deserialize)]
struct WorkerProbeOutput {
    status: String,
    version: Option<String>,
    runtime: Option<String>,
    message: Option<String>,
}

impl WorkerLauncher {
    pub fn new(config: WorkerLaunchConfig) -> Self {
        Self { config }
    }

    pub async fn probe_with_clean_environment(
        &self,
        home: PathBuf,
        path: &str,
    ) -> Result<WorkerReadiness, WorkerLaunchError> {
        if !self.config.artifact_path.exists() {
            return Ok(WorkerReadiness {
                status: WorkerLaunchStatus::MissingWorker,
                version: None,
                runtime: None,
                message: Some("worker artifact missing".to_string()),
            });
        }

        let output = Command::new(&self.config.artifact_path)
            .arg("--slei-worker-health")
            .env_clear()
            .env("HOME", home)
            .env("PATH", path)
            .output()
            .await?;

        if !output.status.success() {
            return Ok(WorkerReadiness {
                status: WorkerLaunchStatus::SdkFailed,
                version: None,
                runtime: None,
                message: Some(String::from_utf8_lossy(&output.stderr).to_string()),
            });
        }

        let parsed: WorkerProbeOutput = serde_json::from_slice(&output.stdout)?;
        Ok(WorkerReadiness {
            status: match parsed.status.as_str() {
                "ready" => WorkerLaunchStatus::Ready,
                "auth_missing" => WorkerLaunchStatus::AuthMissing,
                "sdk_failed" => WorkerLaunchStatus::SdkFailed,
                _ => WorkerLaunchStatus::SdkFailed,
            },
            version: parsed.version,
            runtime: parsed.runtime,
            message: parsed.message,
        })
    }
}

#[derive(Debug, thiserror::Error)]
pub enum WorkerLaunchError {
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
}
