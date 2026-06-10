use std::collections::HashMap;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;
use uuid::Uuid;

pub use crate::services::member_service::PermissionPreset;

#[derive(Clone, Debug)]
pub struct ChannelDraft {
    pub name: String,
    pub description: Option<String>,
    pub permission: PermissionPreset,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ChannelRecord {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub is_default: bool,
    pub permission: PermissionPreset,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub project_paths: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ChannelMemberRecord {
    pub channel_id: String,
    pub agent_id: String,
    pub joined_at: String,
    #[serde(default = "default_channel_member_readiness")]
    pub readiness: ChannelMemberReadiness,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ChannelMemberReadiness {
    Joining,
    MemorySyncing,
    Ready,
    MemoryFailed,
    Unavailable,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AddChannelMemberOutcome {
    pub member: ChannelMemberRecord,
    pub created: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceMount {
    pub path: String,
    pub label: String,
}

#[derive(Clone, Debug, Default)]
pub struct ChannelService {
    root: Arc<PathBuf>,
    inner: Arc<Mutex<ChannelState>>,
}

#[derive(Debug, Default)]
struct ChannelState {
    channels: HashMap<String, ChannelRecord>,
    channel_idempotency: HashMap<String, String>,
    members: HashMap<String, Vec<ChannelMemberRecord>>,
    workspaces: HashMap<String, Vec<WorkspaceMount>>,
    mount_idempotency: HashMap<String, (String, WorkspaceMount)>,
}

impl ChannelService {
    pub fn new(root: PathBuf) -> Self {
        let mut state = ChannelState::load(&root);
        state.ensure_default_channel();
        let service = Self {
            root: Arc::new(root),
            inner: Arc::new(Mutex::new(state)),
        };
        service.persist_snapshot();
        service
    }

    pub fn for_tests() -> Self {
        Self::new(std::env::temp_dir().join(format!("slei-channels-{}", Uuid::new_v4())))
    }

    pub async fn list_channels(&self) -> Vec<ChannelRecord> {
        let state = self.inner.lock().await;
        let mut channels = state
            .channels
            .values()
            .cloned()
            .map(|mut channel| {
                channel.project_paths = state
                    .workspaces
                    .get(&channel.id)
                    .map(|mounts| mounts.iter().map(|mount| mount.path.clone()).collect())
                    .unwrap_or_default();
                channel
            })
            .collect::<Vec<_>>();
        channels.sort_by(|left, right| {
            left.is_default
                .cmp(&right.is_default)
                .reverse()
                .then_with(|| left.name.cmp(&right.name))
        });
        channels
    }

    pub async fn create_channel(
        &self,
        draft: ChannelDraft,
        idempotency_key: &str,
    ) -> Result<ChannelRecord, ChannelError> {
        let idempotency_key = idempotency_key.trim();
        if idempotency_key.is_empty() {
            return Err(ChannelError::MissingIdempotencyKey);
        }

        let mut state = self.inner.lock().await;
        if let Some(id) = state.channel_idempotency.get(idempotency_key) {
            return state
                .channels
                .get(id)
                .cloned()
                .ok_or(ChannelError::MissingChannel);
        }

        let name = normalize_channel_name(&draft.name)?;
        if state.channels.contains_key(&name) {
            return Err(ChannelError::DuplicateChannelName);
        }

        let channel = ChannelRecord {
            id: name.clone(),
            name,
            description: draft.description,
            is_default: false,
            permission: draft.permission,
            project_paths: Vec::new(),
        };
        state
            .channel_idempotency
            .insert(idempotency_key.to_string(), channel.id.clone());
        state.channels.insert(channel.id.clone(), channel.clone());
        persist_channels(&self.root, &state.channels)?;
        Ok(channel)
    }

    pub async fn channel_for_idempotency_key(
        &self,
        idempotency_key: &str,
    ) -> Option<ChannelRecord> {
        let idempotency_key = idempotency_key.trim();
        if idempotency_key.is_empty() {
            return None;
        }
        let state = self.inner.lock().await;
        state
            .channel_idempotency
            .get(idempotency_key)
            .and_then(|id| state.channels.get(id))
            .cloned()
    }

    pub async fn ensure_default_agent_membership(
        &self,
        agent_id: &str,
    ) -> Result<ChannelMemberRecord, ChannelError> {
        self.add_agent_to_channel("all", agent_id).await
    }

    pub async fn add_agent_to_channel(
        &self,
        channel_id: &str,
        agent_id: &str,
    ) -> Result<ChannelMemberRecord, ChannelError> {
        Ok(self
            .add_agent_to_channel_with_outcome(channel_id, agent_id)
            .await?
            .member)
    }

    pub async fn add_agent_to_channel_with_outcome(
        &self,
        channel_id: &str,
        agent_id: &str,
    ) -> Result<AddChannelMemberOutcome, ChannelError> {
        let trimmed_agent_id = agent_id.trim();
        if trimmed_agent_id.is_empty() {
            return Err(ChannelError::InvalidChannel);
        }
        let mut state = self.inner.lock().await;
        state.ensure_default_channel();
        if !state.channels.contains_key(channel_id) {
            return Err(ChannelError::MissingChannel);
        }
        let members = state.members.entry(channel_id.to_string()).or_default();
        if let Some(existing) = members
            .iter()
            .find(|member| member.agent_id == trimmed_agent_id)
        {
            return Ok(AddChannelMemberOutcome {
                member: existing.clone(),
                created: false,
            });
        }
        let member = ChannelMemberRecord {
            channel_id: channel_id.to_string(),
            agent_id: trimmed_agent_id.to_string(),
            joined_at: current_timestamp(),
            readiness: ChannelMemberReadiness::Joining,
        };
        members.push(member.clone());
        persist_members(&self.root, &state.members)?;
        Ok(AddChannelMemberOutcome {
            member,
            created: true,
        })
    }

    pub async fn set_member_readiness(
        &self,
        channel_id: &str,
        agent_id: &str,
        readiness: ChannelMemberReadiness,
    ) -> Result<(), ChannelError> {
        let mut state = self.inner.lock().await;
        if !state.channels.contains_key(channel_id) {
            return Err(ChannelError::MissingChannel);
        }
        let members = state
            .members
            .get_mut(channel_id)
            .ok_or(ChannelError::MissingMember)?;
        let member = members
            .iter_mut()
            .find(|member| member.agent_id == agent_id)
            .ok_or(ChannelError::MissingMember)?;
        member.readiness = readiness;
        persist_members(&self.root, &state.members)?;
        Ok(())
    }

    pub async fn channel_members(
        &self,
        channel_id: &str,
    ) -> Result<Vec<ChannelMemberRecord>, ChannelError> {
        let state = self.inner.lock().await;
        if !state.channels.contains_key(channel_id) {
            return Err(ChannelError::MissingChannel);
        }
        Ok(state.members.get(channel_id).cloned().unwrap_or_default())
    }

    pub async fn remove_agent_from_all_channels(&self, agent_id: &str) -> Result<(), ChannelError> {
        let mut state = self.inner.lock().await;
        let mut changed = false;
        for members in state.members.values_mut() {
            let before = members.len();
            members.retain(|member| member.agent_id != agent_id);
            changed = changed || members.len() != before;
        }
        if changed {
            persist_members(&self.root, &state.members)?;
        }
        Ok(())
    }

    pub async fn remove_agent_from_channel(
        &self,
        channel_id: &str,
        agent_id: &str,
    ) -> Result<Option<ChannelMemberRecord>, ChannelError> {
        let mut state = self.inner.lock().await;
        if !state.channels.contains_key(channel_id) {
            return Err(ChannelError::MissingChannel);
        }
        let Some(members) = state.members.get_mut(channel_id) else {
            return Ok(None);
        };
        let Some(index) = members
            .iter()
            .position(|member| member.agent_id == agent_id)
        else {
            return Ok(None);
        };
        let removed = members.remove(index);
        persist_members(&self.root, &state.members)?;
        Ok(Some(removed))
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

        if !state.channels.contains_key(channel_id) {
            return Err(ChannelError::MissingChannel);
        }

        let normalized_path = normalize_workspace_path(&mount.path)?;
        if workspace_path_exists(&state.workspaces, &normalized_path) {
            return Err(ChannelError::DuplicateWorkspacePath);
        }

        let mount = WorkspaceMount {
            path: normalized_path,
            label: mount.label,
        };
        state
            .workspaces
            .entry(channel_id.to_string())
            .or_default()
            .push(mount.clone());
        state.mount_idempotency.insert(
            idempotency_key.to_string(),
            (channel_id.to_string(), mount.clone()),
        );
        persist_workspaces(&self.root, &state.workspaces)?;
        Ok(mount)
    }

    pub async fn ensure_workspace_paths_available(
        &self,
        paths: &[String],
    ) -> Result<(), ChannelError> {
        let state = self.inner.lock().await;
        let mut requested_paths = HashMap::<String, ()>::new();
        for path in paths {
            let normalized_path = normalize_workspace_path(path)?;
            if requested_paths
                .insert(normalized_path.clone(), ())
                .is_some()
            {
                return Err(ChannelError::DuplicateWorkspacePath);
            }
            if workspace_path_exists(&state.workspaces, &normalized_path) {
                return Err(ChannelError::DuplicateWorkspacePath);
            }
        }
        Ok(())
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

impl ChannelState {
    fn load(root: &PathBuf) -> Self {
        Self {
            channels: load_channels(root),
            members: load_members(root),
            workspaces: load_workspaces(root),
            ..Self::default()
        }
    }

    fn ensure_default_channel(&mut self) {
        self.channels
            .entry("all".to_string())
            .or_insert(ChannelRecord {
                id: "all".to_string(),
                name: "all".to_string(),
                description: Some("默认团队频道".to_string()),
                is_default: true,
                permission: PermissionPreset::Controlled,
                project_paths: Vec::new(),
            });
    }
}

fn normalize_channel_name(name: &str) -> Result<String, ChannelError> {
    let normalized = name
        .trim()
        .trim_start_matches('#')
        .trim()
        .to_lowercase()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join("-");
    let valid = !normalized.is_empty()
        && normalized.chars().count() <= 48
        && !normalized.contains('#')
        && !normalized.contains('/');
    if valid {
        Ok(normalized)
    } else {
        Err(ChannelError::InvalidChannel)
    }
}

pub fn normalize_workspace_path(path: &str) -> Result<String, ChannelError> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err(ChannelError::InvalidWorkspacePath);
    }

    let mut normalized = PathBuf::new();
    for component in Path::new(trimmed).components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                normalized.pop();
            }
            Component::Normal(part) => normalized.push(part),
            Component::RootDir | Component::Prefix(_) => normalized.push(component.as_os_str()),
        }
    }

    let normalized = normalized.to_string_lossy().to_string();
    if normalized.is_empty() {
        Err(ChannelError::InvalidWorkspacePath)
    } else {
        Ok(normalized)
    }
}

fn workspace_path_exists(
    workspaces: &HashMap<String, Vec<WorkspaceMount>>,
    normalized_path: &str,
) -> bool {
    workspaces.values().flatten().any(|mount| {
        normalize_workspace_path(&mount.path)
            .map(|path| path == normalized_path)
            .unwrap_or(false)
    })
}

fn load_channels(root: &PathBuf) -> HashMap<String, ChannelRecord> {
    fs::read_to_string(root.join("channels/index.json"))
        .ok()
        .and_then(|raw| serde_json::from_str::<Vec<ChannelRecord>>(&raw).ok())
        .unwrap_or_default()
        .into_iter()
        .map(|channel| (channel.id.clone(), channel))
        .collect()
}

fn load_members(root: &PathBuf) -> HashMap<String, Vec<ChannelMemberRecord>> {
    fs::read_to_string(root.join("channels/members.json"))
        .ok()
        .and_then(|raw| {
            serde_json::from_str::<HashMap<String, Vec<ChannelMemberRecord>>>(&raw).ok()
        })
        .unwrap_or_default()
}

fn load_workspaces(root: &PathBuf) -> HashMap<String, Vec<WorkspaceMount>> {
    fs::read_to_string(root.join("channels/workspaces.json"))
        .ok()
        .and_then(|raw| serde_json::from_str::<HashMap<String, Vec<WorkspaceMount>>>(&raw).ok())
        .unwrap_or_default()
}

fn persist_channels(
    root: &PathBuf,
    channels: &HashMap<String, ChannelRecord>,
) -> Result<(), ChannelError> {
    let path = root.join("channels/index.json");
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(ChannelError::Io)?;
    }
    let mut ordered = channels.values().cloned().collect::<Vec<_>>();
    ordered.sort_by(|left, right| {
        left.is_default
            .cmp(&right.is_default)
            .reverse()
            .then_with(|| left.name.cmp(&right.name))
    });
    let payload = serde_json::to_string_pretty(&ordered).map_err(ChannelError::Json)?;
    fs::write(path, payload).map_err(ChannelError::Io)
}

fn persist_members(
    root: &PathBuf,
    members: &HashMap<String, Vec<ChannelMemberRecord>>,
) -> Result<(), ChannelError> {
    let path = root.join("channels/members.json");
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(ChannelError::Io)?;
    }
    let payload = serde_json::to_string_pretty(members).map_err(ChannelError::Json)?;
    fs::write(path, payload).map_err(ChannelError::Io)
}

fn persist_workspaces(
    root: &PathBuf,
    workspaces: &HashMap<String, Vec<WorkspaceMount>>,
) -> Result<(), ChannelError> {
    let path = root.join("channels/workspaces.json");
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(ChannelError::Io)?;
    }
    let payload = serde_json::to_string_pretty(workspaces).map_err(ChannelError::Json)?;
    fs::write(path, payload).map_err(ChannelError::Io)
}

fn current_timestamp() -> String {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs().to_string())
        .unwrap_or_else(|_| "0".to_string())
}

fn default_channel_member_readiness() -> ChannelMemberReadiness {
    ChannelMemberReadiness::Joining
}

impl ChannelService {
    fn persist_snapshot(&self) {
        if let Ok(state) = self.inner.try_lock() {
            let _ = persist_channels(&self.root, &state.channels);
            let _ = persist_members(&self.root, &state.members);
            let _ = persist_workspaces(&self.root, &state.workspaces);
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum ChannelError {
    #[error("channel not found")]
    MissingChannel,
    #[error("channel member not found")]
    MissingMember,
    #[error("idempotency-key is required")]
    MissingIdempotencyKey,
    #[error("invalid channel")]
    InvalidChannel,
    #[error("invalid workspace path")]
    InvalidWorkspacePath,
    #[error("channel name already exists")]
    DuplicateChannelName,
    #[error("workspace path already mounted")]
    DuplicateWorkspacePath,
    #[error("channel io error: {0}")]
    Io(std::io::Error),
    #[error("channel json error: {0}")]
    Json(serde_json::Error),
}
