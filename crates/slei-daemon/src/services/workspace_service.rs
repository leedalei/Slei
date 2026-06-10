use std::collections::HashMap;
use std::fmt;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde::Serialize;
use serde_json::json;
use tokio::sync::Mutex;
use uuid::Uuid;

use crate::services::event_service::EventService;

#[derive(Clone, Debug, Serialize)]
pub struct WorkspaceRecord {
    pub id: String,
    pub path: String,
    pub display_name: Option<String>,
}

#[derive(Clone, Debug)]
pub struct WorkspaceRegistration {
    pub workspace: WorkspaceRecord,
    pub created: bool,
}

#[derive(Clone, Debug)]
pub struct WorkspaceService {
    inner: Arc<Mutex<WorkspaceStore>>,
    events: EventService,
}

#[derive(Debug, Default)]
struct WorkspaceStore {
    workspaces: HashMap<String, WorkspaceRecord>,
    idempotency: HashMap<String, String>,
}

#[derive(Debug, PartialEq, Eq)]
pub enum WorkspaceError {
    MissingIdempotencyKey,
    PathUnavailable(PathBuf),
    WorkspaceNotFound(String),
    OutsideWorkspace { root: PathBuf, path: PathBuf },
}

impl WorkspaceService {
    pub fn new(events: EventService) -> Self {
        Self {
            inner: Arc::new(Mutex::new(WorkspaceStore::default())),
            events,
        }
    }

    pub fn for_tests() -> Self {
        Self::new(EventService::new())
    }

    pub async fn clear_for_development_reset(&self) {
        *self.inner.lock().await = WorkspaceStore::default();
    }

    pub async fn register_workspace(
        &self,
        path: &str,
        display_name: Option<String>,
        idempotency_key: &str,
    ) -> Result<WorkspaceRegistration, WorkspaceError> {
        if idempotency_key.trim().is_empty() {
            return Err(WorkspaceError::MissingIdempotencyKey);
        }

        let existing_id = {
            let store = self.inner.lock().await;
            store.idempotency.get(idempotency_key).cloned()
        };

        if let Some(existing_id) = existing_id {
            let store = self.inner.lock().await;
            let workspace = store
                .workspaces
                .get(&existing_id)
                .expect("idempotency index points to workspace")
                .clone();
            return Ok(WorkspaceRegistration {
                workspace,
                created: false,
            });
        }

        let canonical_path = std::fs::canonicalize(path)
            .map_err(|_| WorkspaceError::PathUnavailable(path.into()))?;
        let workspace = WorkspaceRecord {
            id: format!("ws_{}", Uuid::new_v4().simple()),
            path: canonical_path.to_string_lossy().to_string(),
            display_name,
        };

        {
            let mut store = self.inner.lock().await;
            store
                .idempotency
                .insert(idempotency_key.to_string(), workspace.id.clone());
            store
                .workspaces
                .insert(workspace.id.clone(), workspace.clone());
        }

        self.events
            .append(
                "workspace.created",
                json!({
                    "workspace_id": workspace.id,
                    "path": workspace.path,
                }),
            )
            .await;

        Ok(WorkspaceRegistration {
            workspace,
            created: true,
        })
    }

    pub async fn list_workspaces(&self) -> Vec<WorkspaceRecord> {
        self.inner
            .lock()
            .await
            .workspaces
            .values()
            .cloned()
            .collect()
    }

    pub async fn validate_mount_path(
        &self,
        workspace_id: &str,
        path: impl AsRef<Path>,
    ) -> Result<PathBuf, WorkspaceError> {
        let workspace = {
            let store = self.inner.lock().await;
            store
                .workspaces
                .get(workspace_id)
                .cloned()
                .ok_or_else(|| WorkspaceError::WorkspaceNotFound(workspace_id.to_string()))?
        };
        let root = PathBuf::from(&workspace.path);
        let canonical_path = std::fs::canonicalize(path.as_ref())
            .map_err(|_| WorkspaceError::PathUnavailable(path.as_ref().into()))?;

        if !canonical_path.starts_with(&root) {
            return Err(WorkspaceError::OutsideWorkspace {
                root,
                path: canonical_path,
            });
        }

        Ok(canonical_path)
    }
}

impl fmt::Display for WorkspaceError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            WorkspaceError::MissingIdempotencyKey => write!(f, "missing idempotency key"),
            WorkspaceError::PathUnavailable(path) => {
                write!(f, "workspace path unavailable: {}", path.display())
            }
            WorkspaceError::WorkspaceNotFound(id) => write!(f, "workspace not found: {id}"),
            WorkspaceError::OutsideWorkspace { root, path } => write!(
                f,
                "path is outside workspace: {} is not under {}",
                path.display(),
                root.display()
            ),
        }
    }
}

impl std::error::Error for WorkspaceError {}
