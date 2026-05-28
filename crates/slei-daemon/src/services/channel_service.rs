use std::collections::HashMap;
use std::sync::Arc;

use tokio::sync::Mutex;
use uuid::Uuid;

pub use crate::services::member_service::PermissionPreset;

#[derive(Clone, Debug)]
pub struct ChannelDraft {
    pub name: String,
    pub description: Option<String>,
    pub permission: PermissionPreset,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ChannelRecord {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub permission: PermissionPreset,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct WorkspaceMount {
    pub path: String,
    pub label: String,
}

#[derive(Clone, Debug, Default)]
pub struct ChannelService {
    inner: Arc<Mutex<ChannelState>>,
}

#[derive(Debug, Default)]
struct ChannelState {
    channels: HashMap<String, ChannelRecord>,
    channel_idempotency: HashMap<String, String>,
    workspaces: HashMap<String, Vec<WorkspaceMount>>,
    mount_idempotency: HashMap<String, (String, WorkspaceMount)>,
}

impl ChannelService {
    pub fn for_tests() -> Self {
        Self::default()
    }

    pub async fn create_channel(
        &self,
        draft: ChannelDraft,
        idempotency_key: &str,
    ) -> Result<ChannelRecord, ChannelError> {
        let mut state = self.inner.lock().await;
        if let Some(id) = state.channel_idempotency.get(idempotency_key) {
            return state
                .channels
                .get(id)
                .cloned()
                .ok_or(ChannelError::MissingChannel);
        }

        let channel = ChannelRecord {
            id: format!("channel_{}", Uuid::new_v4().simple()),
            name: draft.name,
            description: draft.description,
            permission: draft.permission,
        };
        state
            .channel_idempotency
            .insert(idempotency_key.to_string(), channel.id.clone());
        state.channels.insert(channel.id.clone(), channel.clone());
        Ok(channel)
    }

    pub async fn mount_workspace(
        &self,
        channel_id: &str,
        mount: WorkspaceMount,
        idempotency_key: &str,
    ) -> Result<WorkspaceMount, ChannelError> {
        let mut state = self.inner.lock().await;
        if let Some((existing_channel_id, existing_mount)) =
            state.mount_idempotency.get(idempotency_key)
        {
            if existing_channel_id == channel_id {
                return Ok(existing_mount.clone());
            }
        }

        state
            .workspaces
            .entry(channel_id.to_string())
            .or_default()
            .push(mount.clone());
        state.mount_idempotency.insert(
            idempotency_key.to_string(),
            (channel_id.to_string(), mount.clone()),
        );
        Ok(mount)
    }

    pub async fn workspaces(&self, channel_id: &str) -> Result<Vec<WorkspaceMount>, ChannelError> {
        Ok(self
            .inner
            .lock()
            .await
            .workspaces
            .get(channel_id)
            .cloned()
            .unwrap_or_default())
    }
}

#[derive(Debug, thiserror::Error)]
pub enum ChannelError {
    #[error("channel not found")]
    MissingChannel,
}
