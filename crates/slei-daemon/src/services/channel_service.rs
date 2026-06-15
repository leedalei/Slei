use std::collections::HashMap;
use std::path::{Component, Path, PathBuf};
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use serde_json::json;
use slei_storage::db::SleiDb;
use slei_storage::repositories::{
    ChannelMemberRow, ChannelRow, ChannelSessionRow, Repositories, WorkspaceMountRow,
};
use tokio::sync::Mutex;
use uuid::Uuid;

use crate::services::idempotency::namespaced_key;

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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub active_session_id: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub project_paths: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ChannelSessionRecord {
    pub id: String,
    pub channel_id: String,
    pub title: String,
    pub status: String,
    pub created_at: String,
    pub updated_at: String,
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

#[derive(Clone, Debug)]
pub struct ChannelService {
    repos: Repositories,
    idempotency: Arc<Mutex<ChannelIdempotencyState>>,
}

#[derive(Debug, Default)]
struct ChannelIdempotencyState {
    channel_idempotency: HashMap<String, String>,
    mount_idempotency: HashMap<String, (String, WorkspaceMount)>,
}

impl ChannelService {
    pub fn new(repos: Repositories) -> Self {
        Self {
            repos,
            idempotency: Arc::new(Mutex::new(ChannelIdempotencyState::default())),
        }
    }

    pub fn for_tests() -> Self {
        Self::new(repositories_blocking(
            std::env::temp_dir().join(format!("slei-channels-{}", Uuid::new_v4())),
        ))
    }

    pub async fn list_channels(&self) -> Vec<ChannelRecord> {
        self.ensure_default_channel()
            .await
            .expect("ensure default channel");
        let mut records = Vec::new();
        for mut channel in self.repos.channels().await.expect("load channels") {
            let session = self
                .ensure_active_session(&channel.id)
                .await
                .expect("ensure channel session");
            channel.active_session_id = Some(session.id);
            let mut record = channel_row_to_record(channel);
            record.project_paths = self
                .repos
                .channel_workspace_mounts(&record.id)
                .await
                .expect("load channel workspace mounts")
                .into_iter()
                .map(|mount| mount.path)
                .collect();
            records.push(record);
        }
        sort_channels(&mut records);
        records
    }

    pub async fn clear_for_development_reset(&self) {
        *self.idempotency.lock().await = ChannelIdempotencyState::default();
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
        let durable_key = namespaced_key("channel:create", idempotency_key)
            .ok_or(ChannelError::MissingIdempotencyKey)?;

        self.ensure_default_channel().await?;
        if let Some(payload) = self
            .repos
            .idempotent_response(&durable_key)
            .await
            .map_err(channel_storage_error)?
        {
            let id = idempotent_channel_id(&payload);
            self.idempotency
                .lock()
                .await
                .channel_idempotency
                .insert(durable_key.clone(), id.clone());
            return self
                .channel_by_id(&id)
                .await?
                .ok_or(ChannelError::MissingChannel);
        }
        let mut idempotency = self.idempotency.lock().await;
        if let Some(id) = idempotency.channel_idempotency.get(&durable_key).cloned() {
            return self
                .channel_by_id(&id)
                .await?
                .ok_or(ChannelError::MissingChannel);
        }

        let name = normalize_channel_name(&draft.name)?;
        if self.channel_by_id(&name).await?.is_some()
            || self
                .repos
                .channels()
                .await
                .map_err(channel_storage_error)?
                .iter()
                .any(|channel| channel.name == name)
        {
            return Err(ChannelError::DuplicateChannelName);
        }

        self.repos
            .upsert_channel_idempotent(
                &name,
                &name,
                draft.description.as_deref(),
                false,
                permission_to_storage(draft.permission),
                &durable_key,
                &json!({ "channelId": name }).to_string(),
            )
            .await
            .map_err(map_channel_insert_error)?;
        self.ensure_active_session(&name).await?;
        idempotency
            .channel_idempotency
            .insert(durable_key, name.clone());

        self.channel_by_id(&name)
            .await?
            .ok_or(ChannelError::MissingChannel)
    }

    pub async fn channel_for_idempotency_key(
        &self,
        idempotency_key: &str,
    ) -> Option<ChannelRecord> {
        let idempotency_key = idempotency_key.trim();
        if idempotency_key.is_empty() {
            return None;
        }
        let durable_key = namespaced_key("channel:create", idempotency_key)?;
        if let Ok(Some(payload)) = self.repos.idempotent_response(&durable_key).await {
            return self
                .channel_by_id(&idempotent_channel_id(&payload))
                .await
                .ok()
                .flatten();
        }
        let id = self
            .idempotency
            .lock()
            .await
            .channel_idempotency
            .get(&durable_key)
            .cloned()?;
        self.channel_by_id(&id).await.ok().flatten()
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
        self.ensure_default_channel().await?;
        if self.channel_by_id(channel_id).await?.is_none() {
            return Err(ChannelError::MissingChannel);
        }
        self.ensure_agent_placeholder(trimmed_agent_id).await?;
        let created = self
            .repos
            .insert_channel_member_if_absent(
                channel_id,
                trimmed_agent_id,
                readiness_to_storage(&ChannelMemberReadiness::Joining),
            )
            .await
            .map_err(channel_storage_error)?;
        let member = self
            .repos
            .channel_members(channel_id)
            .await
            .map_err(channel_storage_error)?
            .into_iter()
            .find(|member| member.agent_id == trimmed_agent_id)
            .map(member_row_to_record)
            .ok_or(ChannelError::MissingMember)?;
        Ok(AddChannelMemberOutcome { member, created })
    }

    pub async fn set_member_readiness(
        &self,
        channel_id: &str,
        agent_id: &str,
        readiness: ChannelMemberReadiness,
    ) -> Result<(), ChannelError> {
        if self.channel_by_id(channel_id).await?.is_none() {
            return Err(ChannelError::MissingChannel);
        }
        if !self
            .repos
            .channel_members(channel_id)
            .await
            .map_err(channel_storage_error)?
            .iter()
            .any(|member| member.agent_id == agent_id)
        {
            return Err(ChannelError::MissingMember);
        }
        self.repos
            .update_channel_member_readiness(channel_id, agent_id, readiness_to_storage(&readiness))
            .await
            .map_err(channel_storage_error)?;
        Ok(())
    }

    pub async fn channel_members(
        &self,
        channel_id: &str,
    ) -> Result<Vec<ChannelMemberRecord>, ChannelError> {
        if self.channel_by_id(channel_id).await?.is_none() {
            return Err(ChannelError::MissingChannel);
        }
        Ok(self
            .repos
            .channel_members(channel_id)
            .await
            .map_err(channel_storage_error)?
            .into_iter()
            .map(member_row_to_record)
            .collect())
    }

    pub async fn remove_agent_from_all_channels(&self, agent_id: &str) -> Result<(), ChannelError> {
        self.repos
            .remove_agent_from_channel_memberships(agent_id)
            .await
            .map_err(channel_storage_error)?;
        Ok(())
    }

    pub async fn remove_agent_from_channel(
        &self,
        channel_id: &str,
        agent_id: &str,
    ) -> Result<Option<ChannelMemberRecord>, ChannelError> {
        if self.channel_by_id(channel_id).await?.is_none() {
            return Err(ChannelError::MissingChannel);
        }
        Ok(self
            .repos
            .remove_channel_member(channel_id, agent_id)
            .await
            .map_err(channel_storage_error)?
            .map(member_row_to_record))
    }

    pub async fn mount_workspace(
        &self,
        channel_id: &str,
        mount: WorkspaceMount,
        idempotency_key: &str,
    ) -> Result<WorkspaceMount, ChannelError> {
        let idempotency_key = idempotency_key.trim();
        if idempotency_key.is_empty() {
            return Err(ChannelError::MissingIdempotencyKey);
        }
        let durable_key = namespaced_key("channel:mount_workspace", idempotency_key)
            .ok_or(ChannelError::MissingIdempotencyKey)?;
        if let Some(payload) = self
            .repos
            .idempotent_response(&durable_key)
            .await
            .map_err(channel_storage_error)?
        {
            let (existing_channel_id, existing_mount) = idempotent_mount(&payload)?;
            if existing_channel_id == channel_id {
                self.idempotency.lock().await.mount_idempotency.insert(
                    durable_key.clone(),
                    (existing_channel_id, existing_mount.clone()),
                );
                return Ok(existing_mount);
            }
            return Err(ChannelError::IdempotencyConflict);
        }
        let mut idempotency = self.idempotency.lock().await;
        if let Some((existing_channel_id, existing_mount)) =
            idempotency.mount_idempotency.get(&durable_key)
        {
            if existing_channel_id == channel_id {
                return Ok(existing_mount.clone());
            }
            return Err(ChannelError::IdempotencyConflict);
        }

        if self.channel_by_id(channel_id).await?.is_none() {
            return Err(ChannelError::MissingChannel);
        }

        let normalized_path = normalize_workspace_path(&mount.path)?;
        if self.workspace_path_exists(&normalized_path).await? {
            return Err(ChannelError::DuplicateWorkspacePath);
        }

        let mount = WorkspaceMount {
            path: normalized_path,
            label: mount.label,
        };
        self.repos
            .upsert_channel_workspace_mount_idempotent(
                channel_id,
                &mount.path,
                &mount.label,
                &durable_key,
                &json!({
                    "channelId": channel_id,
                    "path": &mount.path,
                    "label": &mount.label,
                })
                .to_string(),
            )
            .await
            .map_err(map_workspace_insert_error)?;
        idempotency
            .mount_idempotency
            .insert(durable_key, (channel_id.to_string(), mount.clone()));
        Ok(mount)
    }

    pub async fn ensure_workspace_paths_available(
        &self,
        paths: &[String],
    ) -> Result<(), ChannelError> {
        let mut requested_paths = HashMap::<String, ()>::new();
        for path in paths {
            let normalized_path = normalize_workspace_path(path)?;
            if requested_paths
                .insert(normalized_path.clone(), ())
                .is_some()
            {
                return Err(ChannelError::DuplicateWorkspacePath);
            }
            if self.workspace_path_exists(&normalized_path).await? {
                return Err(ChannelError::DuplicateWorkspacePath);
            }
        }
        Ok(())
    }

    pub async fn workspaces(&self, channel_id: &str) -> Result<Vec<WorkspaceMount>, ChannelError> {
        Ok(self
            .repos
            .channel_workspace_mounts(channel_id)
            .await
            .map_err(channel_storage_error)?
            .into_iter()
            .map(workspace_row_to_record)
            .collect())
    }

    pub async fn list_sessions(
        &self,
        channel_id: &str,
    ) -> Result<Vec<ChannelSessionRecord>, ChannelError> {
        if !self.channel_exists(channel_id).await? {
            return Err(ChannelError::MissingChannel);
        }
        self.ensure_active_session(channel_id).await?;
        Ok(self
            .repos
            .channel_sessions(channel_id)
            .await
            .map_err(channel_storage_error)?
            .into_iter()
            .map(channel_session_row_to_record)
            .collect())
    }

    pub async fn create_session(
        &self,
        channel_id: &str,
    ) -> Result<ChannelSessionRecord, ChannelError> {
        if !self.channel_exists(channel_id).await? {
            return Err(ChannelError::MissingChannel);
        }
        let now = current_timestamp();
        let session = ChannelSessionRecord {
            id: format!("session:channel:{channel_id}:{}", Uuid::new_v4().simple()),
            channel_id: channel_id.to_string(),
            title: "新会话".to_string(),
            status: "ready".to_string(),
            created_at: now.clone(),
            updated_at: now,
        };
        self.repos
            .upsert_channel_session(channel_session_record_to_row(&session))
            .await
            .map_err(channel_storage_error)?;
        self.repos
            .update_channel_active_session(channel_id, &session.id)
            .await
            .map_err(channel_storage_error)?;
        Ok(session)
    }

    pub async fn activate_session(
        &self,
        channel_id: &str,
        session_id: &str,
    ) -> Result<ChannelSessionRecord, ChannelError> {
        if !self.channel_exists(channel_id).await? {
            return Err(ChannelError::MissingChannel);
        }
        let session = self
            .repos
            .channel_session(channel_id, session_id)
            .await
            .map_err(channel_storage_error)?
            .map(channel_session_row_to_record)
            .ok_or(ChannelError::MissingChannel)?;
        self.repos
            .update_channel_active_session(channel_id, &session.id)
            .await
            .map_err(channel_storage_error)?;
        Ok(session)
    }

    pub async fn active_session(
        &self,
        channel_id: &str,
    ) -> Result<ChannelSessionRecord, ChannelError> {
        if !self.channel_exists(channel_id).await? {
            return Err(ChannelError::MissingChannel);
        }
        self.ensure_active_session(channel_id).await
    }

    async fn ensure_default_channel(&self) -> Result<(), ChannelError> {
        self.repos
            .upsert_channel(
                "all",
                "all",
                Some("默认团队频道"),
                true,
                permission_to_storage(PermissionPreset::Controlled),
            )
            .await
            .map_err(channel_storage_error)?;
        self.ensure_active_session("all").await?;
        Ok(())
    }

    async fn channel_by_id(&self, channel_id: &str) -> Result<Option<ChannelRecord>, ChannelError> {
        let channels = self.repos.channels().await.map_err(channel_storage_error)?;
        let Some(mut channel) = channels
            .into_iter()
            .find(|channel| channel.id == channel_id)
        else {
            return Ok(None);
        };
        let session = self.ensure_active_session(&channel.id).await?;
        channel.active_session_id = Some(session.id);
        let mut record = channel_row_to_record(channel);
        record.project_paths = self
            .repos
            .channel_workspace_mounts(&record.id)
            .await
            .map_err(channel_storage_error)?
            .into_iter()
            .map(|mount| mount.path)
            .collect();
        Ok(Some(record))
    }

    async fn ensure_active_session(
        &self,
        channel_id: &str,
    ) -> Result<ChannelSessionRecord, ChannelError> {
        let channels = self.repos.channels().await.map_err(channel_storage_error)?;
        let channel = channels
            .into_iter()
            .find(|channel| channel.id == channel_id)
            .ok_or(ChannelError::MissingChannel)?;
        if let Some(active_session_id) = channel
            .active_session_id
            .as_deref()
            .filter(|id| !id.trim().is_empty())
        {
            if let Some(session) = self
                .repos
                .channel_session(channel_id, active_session_id)
                .await
                .map_err(channel_storage_error)?
            {
                return Ok(channel_session_row_to_record(session));
            }
        }

        let now = current_timestamp();
        let session = ChannelSessionRecord {
            id: default_channel_session_id(channel_id),
            channel_id: channel_id.to_string(),
            title: "新会话".to_string(),
            status: "ready".to_string(),
            created_at: now.clone(),
            updated_at: now,
        };
        self.repos
            .upsert_channel_session(channel_session_record_to_row(&session))
            .await
            .map_err(channel_storage_error)?;
        self.repos
            .update_channel_active_session(channel_id, &session.id)
            .await
            .map_err(channel_storage_error)?;
        Ok(session)
    }

    async fn channel_exists(&self, channel_id: &str) -> Result<bool, ChannelError> {
        Ok(self
            .repos
            .channels()
            .await
            .map_err(channel_storage_error)?
            .into_iter()
            .any(|channel| channel.id == channel_id))
    }

    async fn workspace_path_exists(&self, normalized_path: &str) -> Result<bool, ChannelError> {
        for channel in self.repos.channels().await.map_err(channel_storage_error)? {
            if self
                .repos
                .channel_workspace_mounts(&channel.id)
                .await
                .map_err(channel_storage_error)?
                .iter()
                .any(|mount| {
                    normalize_workspace_path(&mount.path)
                        .map(|path| path == normalized_path)
                        .unwrap_or(false)
                })
            {
                return Ok(true);
            }
        }
        Ok(false)
    }

    async fn ensure_agent_placeholder(&self, agent_id: &str) -> Result<(), ChannelError> {
        if self
            .repos
            .agents()
            .await
            .map_err(channel_storage_error)?
            .iter()
            .any(|agent| agent.id == agent_id)
        {
            return Ok(());
        }
        self.repos
            .upsert_agent(
                agent_id,
                agent_id,
                &format!("@{agent_id}"),
                "agent",
                false,
                "unknown",
                "unknown",
                "local",
                "",
                agent_id,
            )
            .await
            .map_err(channel_storage_error)?;
        Ok(())
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

fn sort_channels(channels: &mut [ChannelRecord]) {
    channels.sort_by(|left, right| {
        left.is_default
            .cmp(&right.is_default)
            .reverse()
            .then_with(|| left.name.cmp(&right.name))
    });
}

fn channel_row_to_record(row: ChannelRow) -> ChannelRecord {
    ChannelRecord {
        id: row.id,
        name: row.name,
        description: row.description,
        is_default: row.is_default,
        permission: permission_from_storage(&row.permission),
        active_session_id: row.active_session_id,
        project_paths: Vec::new(),
    }
}

fn channel_session_row_to_record(row: ChannelSessionRow) -> ChannelSessionRecord {
    ChannelSessionRecord {
        id: row.id,
        channel_id: row.channel_id,
        title: row.title,
        status: row.status,
        created_at: row.created_at,
        updated_at: row.updated_at,
    }
}

fn channel_session_record_to_row(record: &ChannelSessionRecord) -> ChannelSessionRow {
    ChannelSessionRow {
        id: record.id.clone(),
        channel_id: record.channel_id.clone(),
        title: record.title.clone(),
        status: record.status.clone(),
        created_at: record.created_at.clone(),
        updated_at: record.updated_at.clone(),
    }
}

fn default_channel_session_id(channel_id: &str) -> String {
    format!("session:channel:{channel_id}:default")
}

fn current_timestamp() -> String {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs().to_string())
        .unwrap_or_else(|_| "0".to_string())
}

fn member_row_to_record(row: ChannelMemberRow) -> ChannelMemberRecord {
    ChannelMemberRecord {
        channel_id: row.channel_id,
        agent_id: row.agent_id,
        joined_at: row.joined_at,
        readiness: readiness_from_storage(&row.readiness),
    }
}

fn workspace_row_to_record(row: WorkspaceMountRow) -> WorkspaceMount {
    WorkspaceMount {
        path: row.path,
        label: row.label,
    }
}

fn permission_to_storage(permission: PermissionPreset) -> &'static str {
    match permission {
        PermissionPreset::ReadOnly => "ReadOnly",
        PermissionPreset::Edit => "Edit",
        PermissionPreset::Controlled => "Controlled",
    }
}

fn permission_from_storage(permission: &str) -> PermissionPreset {
    match permission {
        "ReadOnly" | "read_only" => PermissionPreset::ReadOnly,
        "Edit" | "edit" => PermissionPreset::Edit,
        _ => PermissionPreset::Controlled,
    }
}

fn readiness_to_storage(readiness: &ChannelMemberReadiness) -> &'static str {
    match readiness {
        ChannelMemberReadiness::Joining => "joining",
        ChannelMemberReadiness::MemorySyncing => "memory_syncing",
        ChannelMemberReadiness::Ready => "ready",
        ChannelMemberReadiness::MemoryFailed => "memory_failed",
        ChannelMemberReadiness::Unavailable => "unavailable",
    }
}

fn readiness_from_storage(readiness: &str) -> ChannelMemberReadiness {
    match readiness {
        "memory_syncing" => ChannelMemberReadiness::MemorySyncing,
        "ready" => ChannelMemberReadiness::Ready,
        "memory_failed" => ChannelMemberReadiness::MemoryFailed,
        "unavailable" => ChannelMemberReadiness::Unavailable,
        _ => ChannelMemberReadiness::Joining,
    }
}

fn default_channel_member_readiness() -> ChannelMemberReadiness {
    ChannelMemberReadiness::Joining
}

fn map_channel_insert_error(error: sqlx::Error) -> ChannelError {
    if error.to_string().contains("UNIQUE") {
        ChannelError::DuplicateChannelName
    } else {
        channel_storage_error(error)
    }
}

fn map_workspace_insert_error(error: sqlx::Error) -> ChannelError {
    if error.to_string().contains("UNIQUE") {
        ChannelError::DuplicateWorkspacePath
    } else {
        channel_storage_error(error)
    }
}

fn channel_storage_error(error: sqlx::Error) -> ChannelError {
    ChannelError::Io(std::io::Error::new(
        std::io::ErrorKind::Other,
        error.to_string(),
    ))
}

fn idempotent_channel_id(payload: &str) -> String {
    serde_json::from_str::<serde_json::Value>(payload)
        .ok()
        .and_then(|value| {
            value
                .get("channelId")
                .and_then(|id| id.as_str())
                .map(ToString::to_string)
                .or_else(|| {
                    value
                        .get("channel_id")
                        .and_then(|id| id.as_str())
                        .map(ToString::to_string)
                })
        })
        .unwrap_or_else(|| payload.to_string())
}

fn idempotent_mount(payload: &str) -> Result<(String, WorkspaceMount), ChannelError> {
    let value = serde_json::from_str::<serde_json::Value>(payload).map_err(|error| {
        ChannelError::Io(std::io::Error::new(
            std::io::ErrorKind::Other,
            error.to_string(),
        ))
    })?;
    let channel_id = value
        .get("channelId")
        .and_then(|id| id.as_str())
        .ok_or(ChannelError::InvalidChannel)?
        .to_string();
    let path = value
        .get("path")
        .and_then(|path| path.as_str())
        .ok_or(ChannelError::InvalidWorkspacePath)?
        .to_string();
    let label = value
        .get("label")
        .and_then(|label| label.as_str())
        .ok_or(ChannelError::InvalidWorkspacePath)?
        .to_string();
    Ok((channel_id, WorkspaceMount { path, label }))
}

fn repositories_blocking(data_root: PathBuf) -> Repositories {
    std::thread::spawn(move || {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("create channel repository runtime");
        runtime.block_on(async move {
            std::fs::create_dir_all(&data_root).expect("create channel data root");
            let database_url = format!("sqlite://{}", data_root.join("slei.sqlite").display());
            let db = SleiDb::connect(&database_url)
                .await
                .expect("connect channel db");
            db.migrate().await.expect("migrate channel db");
            Repositories::new(db.pool().clone())
        })
    })
    .join()
    .expect("initialize channel repositories")
}

#[derive(Debug, thiserror::Error)]
pub enum ChannelError {
    #[error("channel not found")]
    MissingChannel,
    #[error("channel member not found")]
    MissingMember,
    #[error("idempotency-key is required")]
    MissingIdempotencyKey,
    #[error("idempotency-key was already used for another channel")]
    IdempotencyConflict,
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
}
