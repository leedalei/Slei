use std::collections::HashMap;
use std::fs;
use std::hash::{DefaultHasher, Hash, Hasher};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use uuid::Uuid;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ArtifactInput {
    pub channel_id: String,
    pub task_id: String,
    pub run_id: String,
    pub path: PathBuf,
    pub display_name: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ArtifactRecord {
    pub id: String,
    pub channel_id: String,
    pub task_id: String,
    pub run_id: String,
    pub display_name: String,
    pub content_hash: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ArtifactOpenToken {
    pub artifact_id: String,
    pub token: String,
}

#[derive(Clone, Debug)]
struct StoredArtifact {
    record: ArtifactRecord,
    path: PathBuf,
}

#[derive(Clone, Debug)]
pub struct ArtifactService {
    workspace_root: PathBuf,
    inner: Arc<Mutex<HashMap<String, StoredArtifact>>>,
}

impl ArtifactService {
    pub fn for_tests(workspace_root: PathBuf) -> Self {
        Self {
            workspace_root,
            inner: Arc::default(),
        }
    }

    pub async fn register(&self, input: ArtifactInput) -> Result<ArtifactRecord, ArtifactError> {
        let workspace_root = canonicalize(&self.workspace_root)?;
        let path = canonicalize(&input.path)?;
        if !path.starts_with(&workspace_root) {
            return Err(ArtifactError::OutsideWorkspace);
        }

        let content_hash = content_hash(&path)?;
        let record = ArtifactRecord {
            id: format!("artifact_{}", Uuid::new_v4().simple()),
            channel_id: input.channel_id,
            task_id: input.task_id,
            run_id: input.run_id,
            display_name: input.display_name,
            content_hash,
        };
        self.inner.lock().expect("artifact state lock").insert(
            record.id.clone(),
            StoredArtifact {
                record: record.clone(),
                path,
            },
        );
        Ok(record)
    }

    pub async fn list_for_task(&self, task_id: &str) -> Vec<ArtifactRecord> {
        let mut artifacts = self
            .inner
            .lock()
            .expect("artifact state lock")
            .values()
            .filter(|artifact| artifact.record.task_id == task_id)
            .map(|artifact| artifact.record.clone())
            .collect::<Vec<_>>();
        artifacts.sort_by(|left, right| {
            left.display_name
                .cmp(&right.display_name)
                .then(left.id.cmp(&right.id))
        });
        artifacts
    }

    pub async fn open_token(&self, artifact_id: &str) -> Result<ArtifactOpenToken, ArtifactError> {
        if artifact_id.contains('/') || artifact_id.starts_with("file:") {
            return Err(ArtifactError::ArtifactNotFound);
        }

        let stored = self
            .inner
            .lock()
            .expect("artifact state lock")
            .get(artifact_id)
            .cloned()
            .ok_or(ArtifactError::ArtifactNotFound)?;
        let current_hash = content_hash(&stored.path)?;
        if current_hash != stored.record.content_hash {
            return Err(ArtifactError::HashMismatch);
        }

        Ok(ArtifactOpenToken {
            artifact_id: stored.record.id,
            token: format!("open_{}", Uuid::new_v4().simple()),
        })
    }
}

fn canonicalize(path: &Path) -> Result<PathBuf, ArtifactError> {
    path.canonicalize().map_err(ArtifactError::Io)
}

fn content_hash(path: &Path) -> Result<String, ArtifactError> {
    let bytes = fs::read(path).map_err(ArtifactError::Io)?;
    let mut hasher = DefaultHasher::new();
    bytes.hash(&mut hasher);
    Ok(format!("hash_{:016x}", hasher.finish()))
}

#[derive(Debug, thiserror::Error)]
pub enum ArtifactError {
    #[error("artifact not found")]
    ArtifactNotFound,
    #[error("artifact outside workspace")]
    OutsideWorkspace,
    #[error("artifact hash mismatch")]
    HashMismatch,
    #[error("artifact io error: {0}")]
    Io(std::io::Error),
}
