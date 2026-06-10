use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use slei_default_agent_assets::{
    initial_memory as shared_initial_memory, standard_skill_assets, AgentTemplateInput,
};
use tokio::sync::Mutex;
use uuid::Uuid;

pub const GLOBAL_COORDINATOR_AGENT_ID: &str = "agent_global_coordinator";

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub enum PermissionPreset {
    ReadOnly,
    Edit,
    Controlled,
}

#[derive(Clone, Debug)]
pub struct AgentDraft {
    pub display_name: String,
    pub runtime_kind: String,
    pub model: String,
    pub permission: PermissionPreset,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AgentRecord {
    pub id: String,
    pub display_name: String,
    pub runtime_kind: String,
    pub model: String,
    pub permission: PermissionPreset,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductAgentDraft {
    pub name: String,
    pub handle: String,
    pub runtime_kind: String,
    pub model: String,
    pub node_id: String,
    pub description: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductAgentUpdate {
    pub name: Option<String>,
    pub description: Option<String>,
    pub runtime_kind: Option<String>,
    pub model: Option<String>,
    pub node_id: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProductAgentRecord {
    pub id: String,
    pub name: String,
    pub handle: String,
    #[serde(default = "default_agent_kind")]
    pub agent_kind: String,
    #[serde(default)]
    pub system_owned: bool,
    pub runtime_kind: String,
    pub model: String,
    pub node_id: String,
    pub description: String,
    pub workspace_path: String,
    pub memory_path: String,
    pub docs_path: String,
    pub avatar_seed: String,
    #[serde(default)]
    pub runtime_thread: RuntimeThreadRecord,
    #[serde(default)]
    pub channel_ids: Vec<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeThreadRecord {
    pub runtime_kind: String,
    pub status: String,
    pub created_at: String,
}

impl Default for RuntimeThreadRecord {
    fn default() -> Self {
        Self {
            runtime_kind: "ClaudeCode".to_string(),
            status: "pending".to_string(),
            created_at: "0".to_string(),
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SkillRecord {
    pub id: String,
    pub name: String,
    pub trigger: String,
    pub path: String,
}

#[derive(Clone, Debug)]
pub struct ChannelMemberDraft {
    pub agent_id: String,
    pub permission_override: Option<PermissionPreset>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ChannelMemberRecord {
    pub channel_id: String,
    pub agent_id: String,
    pub runtime_kind: String,
    pub effective_permission: PermissionPreset,
}

#[derive(Clone, Debug, Default)]
pub struct MemberService {
    inner: Arc<Mutex<MemberState>>,
    agent_data_root: Arc<PathBuf>,
}

#[derive(Debug, Default)]
struct MemberState {
    agents: HashMap<String, AgentRecord>,
    agent_idempotency: HashMap<String, String>,
    channel_members: HashMap<(String, String), ChannelMemberRecord>,
    assignment_idempotency: HashMap<String, (String, String)>,
    primary_agents: HashMap<String, String>,
    product_agents: HashMap<String, ProductAgentRecord>,
    product_agent_handles: HashMap<String, String>,
    product_agent_idempotency: HashMap<String, String>,
}

impl MemberService {
    pub fn new(agent_data_root: PathBuf) -> Self {
        let state = MemberState::with_product_agents(load_product_agents(&agent_data_root));
        Self {
            inner: Arc::new(Mutex::new(state)),
            agent_data_root: Arc::new(agent_data_root),
        }
    }

    pub fn for_tests() -> Self {
        Self::new(std::env::temp_dir().join(format!("slei-agents-{}", Uuid::new_v4())))
    }

    pub fn for_tests_with_data_root(data_root: PathBuf) -> Self {
        Self::new(data_root)
    }

    pub async fn create_agent(
        &self,
        draft: AgentDraft,
        idempotency_key: &str,
    ) -> Result<AgentRecord, MemberError> {
        let mut state = self.inner.lock().await;
        if let Some(id) = state.agent_idempotency.get(idempotency_key) {
            return state
                .agents
                .get(id)
                .cloned()
                .ok_or(MemberError::AgentNotFound);
        }

        let agent = AgentRecord {
            id: format!("agent_{}", Uuid::new_v4().simple()),
            display_name: draft.display_name,
            runtime_kind: draft.runtime_kind,
            model: draft.model,
            permission: draft.permission,
        };
        state
            .agent_idempotency
            .insert(idempotency_key.to_string(), agent.id.clone());
        state.agents.insert(agent.id.clone(), agent.clone());
        Ok(agent)
    }

    pub async fn clear_for_development_reset(&self) {
        *self.inner.lock().await = MemberState::default();
    }

    pub async fn assign_agent(
        &self,
        channel_id: &str,
        draft: ChannelMemberDraft,
        idempotency_key: &str,
    ) -> Result<ChannelMemberRecord, MemberError> {
        let mut state = self.inner.lock().await;
        if let Some((existing_channel_id, existing_agent_id)) =
            state.assignment_idempotency.get(idempotency_key)
        {
            return state
                .channel_members
                .get(&(existing_channel_id.clone(), existing_agent_id.clone()))
                .cloned()
                .ok_or(MemberError::AgentNotFound);
        }

        let agent = state
            .agents
            .get(&draft.agent_id)
            .ok_or(MemberError::AgentNotFound)?
            .clone();
        let effective_permission = narrow_permission(agent.permission, draft.permission_override);
        let record = ChannelMemberRecord {
            channel_id: channel_id.to_string(),
            agent_id: agent.id,
            runtime_kind: agent.runtime_kind,
            effective_permission,
        };
        state.assignment_idempotency.insert(
            idempotency_key.to_string(),
            (channel_id.to_string(), record.agent_id.clone()),
        );
        state.channel_members.insert(
            (channel_id.to_string(), record.agent_id.clone()),
            record.clone(),
        );
        Ok(record)
    }

    pub async fn set_primary_agent(
        &self,
        channel_id: &str,
        agent_id: &str,
    ) -> Result<(), MemberError> {
        self.inner
            .lock()
            .await
            .primary_agents
            .insert(channel_id.to_string(), agent_id.to_string());
        Ok(())
    }

    pub async fn primary_agent(&self, channel_id: &str) -> Result<String, MemberError> {
        self.inner
            .lock()
            .await
            .primary_agents
            .get(channel_id)
            .cloned()
            .ok_or(MemberError::AgentNotFound)
    }

    pub async fn list_product_agents(&self) -> Vec<ProductAgentRecord> {
        let mut agents = self
            .inner
            .lock()
            .await
            .product_agents
            .values()
            .cloned()
            .collect::<Vec<_>>();
        agents.sort_by(|left, right| left.created_at.cmp(&right.created_at));
        agents
    }

    pub async fn get_product_agent(
        &self,
        agent_id: &str,
    ) -> Result<ProductAgentRecord, MemberError> {
        self.inner
            .lock()
            .await
            .product_agents
            .get(agent_id)
            .cloned()
            .ok_or(MemberError::AgentNotFound)
    }

    pub async fn create_product_agent(
        &self,
        draft: ProductAgentDraft,
        idempotency_key: &str,
    ) -> Result<ProductAgentRecord, MemberError> {
        if idempotency_key.trim().is_empty() {
            return Err(MemberError::MissingIdempotencyKey);
        }

        let normalized_handle = normalize_handle(&draft.handle)?;
        if draft.name.trim().is_empty()
            || draft.runtime_kind.trim().is_empty()
            || draft.node_id.trim().is_empty()
        {
            return Err(MemberError::InvalidAgent);
        }

        {
            let state = self.inner.lock().await;
            if let Some(id) = state.product_agent_idempotency.get(idempotency_key) {
                return state
                    .product_agents
                    .get(id)
                    .cloned()
                    .ok_or(MemberError::AgentNotFound);
            }
            if state.product_agent_handles.contains_key(&normalized_handle) {
                return Err(MemberError::DuplicateHandle);
            }
        }

        let id = format!("agent_{}", Uuid::new_v4().simple());
        self.create_product_agent_record(draft, id, "agent", false, idempotency_key)
            .await
    }

    pub async fn create_guide_agent(
        &self,
        node_id: &str,
        idempotency_key: &str,
    ) -> Result<(ProductAgentRecord, bool), MemberError> {
        let existing_guide = {
            let state = self.inner.lock().await;
            state
                .product_agents
                .values()
                .find(|agent| agent.id == "agent_guide_local_node" && agent.agent_kind == "guide")
                .cloned()
        };
        if let Some(agent) = existing_guide {
            return self
                .normalize_existing_guide_agent(agent)
                .await
                .map(|agent| (agent, false));
        }
        {
            let state = self.inner.lock().await;
            if state.product_agent_handles.contains_key("@yeal") {
                return Err(MemberError::DuplicateHandle);
            }
        }

        let draft = ProductAgentDraft {
            name: "Yeal".to_string(),
            handle: "@yeal".to_string(),
            runtime_kind: "ClaudeCode".to_string(),
            model: "Sonnet".to_string(),
            node_id: node_id.to_string(),
            description: "回答关于 Slei App 如何使用的问题，用于帮助和引导用户建立自己的团队。"
                .to_string(),
        };
        let agent = self
            .create_product_agent_record(
                draft,
                "agent_guide_local_node".to_string(),
                "guide",
                true,
                idempotency_key,
            )
            .await?;
        Ok((agent, true))
    }

    pub async fn ensure_global_coordinator_agent(
        &self,
        node_id: &str,
    ) -> Result<ProductAgentRecord, MemberError> {
        if node_id.trim().is_empty() {
            return Err(MemberError::InvalidAgent);
        }

        let existing_agent = {
            self.inner
                .lock()
                .await
                .product_agents
                .get(GLOBAL_COORDINATOR_AGENT_ID)
                .cloned()
        };
        if let Some(agent) = existing_agent {
            return self.normalize_existing_global_coordinator(agent).await;
        }

        let draft = ProductAgentDraft {
            name: "Global Coordinator".to_string(),
            handle: "@global-coordinator".to_string(),
            runtime_kind: "ClaudeCode".to_string(),
            model: "Sonnet".to_string(),
            node_id: node_id.trim().to_string(),
            description: global_coordinator_description(),
        };

        self.create_product_agent_record_with_channels(
            draft,
            GLOBAL_COORDINATOR_AGENT_ID.to_string(),
            "coordinator",
            true,
            "coordinator:global",
            Vec::new(),
        )
        .await
    }

    pub async fn ensure_channel_coordinator_agent(
        &self,
        channel_id: &str,
        channel_name: &str,
        node_id: &str,
    ) -> Result<ProductAgentRecord, MemberError> {
        let trimmed_channel_id = channel_id.trim();
        if trimmed_channel_id.is_empty() || node_id.trim().is_empty() {
            return Err(MemberError::InvalidAgent);
        }

        let id = coordinator_agent_id(trimmed_channel_id);
        let existing_agent = { self.inner.lock().await.product_agents.get(&id).cloned() };
        if let Some(agent) = existing_agent {
            return self
                .normalize_existing_channel_coordinator(agent, channel_name)
                .await;
        }

        let display_channel = channel_name.trim().trim_start_matches('#');
        let draft = ProductAgentDraft {
            name: format!("#{display_channel} Coordinator"),
            handle: coordinator_handle(trimmed_channel_id),
            runtime_kind: "ClaudeCode".to_string(),
            model: "Sonnet".to_string(),
            node_id: node_id.trim().to_string(),
            description: channel_coordinator_description(&format!("#{display_channel}")),
        };

        self.create_product_agent_record_with_channels(
            draft,
            id,
            "coordinator",
            true,
            &format!("coordinator:{trimmed_channel_id}"),
            vec![trimmed_channel_id.to_string()],
        )
        .await
    }

    async fn normalize_existing_channel_coordinator(
        &self,
        mut agent: ProductAgentRecord,
        channel_name: &str,
    ) -> Result<ProductAgentRecord, MemberError> {
        let display_channel = channel_name.trim().trim_start_matches('#');
        let description = channel_coordinator_description(&format!("#{display_channel}"));
        if agent.description == description {
            return Ok(agent);
        }

        agent.description = description;
        agent.updated_at = current_timestamp();
        fs::write(&agent.memory_path, initial_memory(&agent)).map_err(MemberError::Io)?;
        let mut state = self.inner.lock().await;
        state.product_agents.insert(agent.id.clone(), agent.clone());
        persist_product_agents(&self.agent_data_root, &state.product_agents)?;
        Ok(agent)
    }

    async fn normalize_existing_global_coordinator(
        &self,
        mut agent: ProductAgentRecord,
    ) -> Result<ProductAgentRecord, MemberError> {
        let description = global_coordinator_description();
        if agent.name == "Global Coordinator"
            && agent.handle == "@global-coordinator"
            && agent.description == description
            && agent.agent_kind == "coordinator"
            && agent.system_owned
            && agent.channel_ids.is_empty()
        {
            return Ok(agent);
        }

        let previous_handle = agent.handle.to_lowercase();
        agent.name = "Global Coordinator".to_string();
        agent.handle = "@global-coordinator".to_string();
        agent.agent_kind = "coordinator".to_string();
        agent.system_owned = true;
        agent.description = description;
        agent.channel_ids.clear();
        agent.updated_at = current_timestamp();
        fs::write(&agent.memory_path, initial_memory(&agent)).map_err(MemberError::Io)?;
        let mut state = self.inner.lock().await;
        if let Some(owner) = state.product_agent_handles.get("@global-coordinator") {
            if owner != &agent.id {
                return Err(MemberError::DuplicateHandle);
            }
        }
        state.product_agent_handles.remove(&previous_handle);
        state
            .product_agent_handles
            .insert(agent.handle.to_lowercase(), agent.id.clone());
        state.product_agents.insert(agent.id.clone(), agent.clone());
        persist_product_agents(&self.agent_data_root, &state.product_agents)?;
        Ok(agent)
    }

    pub async fn is_coordinator_agent(&self, agent_id: &str) -> bool {
        self.inner
            .lock()
            .await
            .product_agents
            .get(agent_id)
            .is_some_and(|agent| agent.agent_kind == "coordinator")
    }

    async fn normalize_existing_guide_agent(
        &self,
        mut agent: ProductAgentRecord,
    ) -> Result<ProductAgentRecord, MemberError> {
        if agent.name == "Yeal" && agent.handle == "@yeal" && agent.avatar_seed == "yeal" {
            write_default_skills(&agent)?;
            sanitize_legacy_guide_memory(&agent)?;
            return Ok(agent);
        }

        let previous_handle = agent.handle.to_lowercase();
        agent.name = "Yeal".to_string();
        agent.handle = "@yeal".to_string();
        agent.avatar_seed = "yeal".to_string();
        agent.updated_at = current_timestamp();
        write_default_skills(&agent)?;
        sanitize_legacy_guide_memory(&agent)?;

        let mut state = self.inner.lock().await;
        if let Some(owner) = state.product_agent_handles.get("@yeal") {
            if owner != &agent.id {
                return Err(MemberError::DuplicateHandle);
            }
        }
        state.product_agent_handles.remove(&previous_handle);
        state
            .product_agent_handles
            .insert(agent.handle.to_lowercase(), agent.id.clone());
        state.product_agents.insert(agent.id.clone(), agent.clone());
        persist_product_agents(&self.agent_data_root, &state.product_agents)?;
        Ok(agent)
    }

    async fn create_product_agent_record(
        &self,
        draft: ProductAgentDraft,
        id: String,
        agent_kind: &str,
        system_owned: bool,
        idempotency_key: &str,
    ) -> Result<ProductAgentRecord, MemberError> {
        self.create_product_agent_record_with_channels(
            draft,
            id,
            agent_kind,
            system_owned,
            idempotency_key,
            vec!["all".to_string()],
        )
        .await
    }

    async fn create_product_agent_record_with_channels(
        &self,
        draft: ProductAgentDraft,
        id: String,
        agent_kind: &str,
        system_owned: bool,
        idempotency_key: &str,
        channel_ids: Vec<String>,
    ) -> Result<ProductAgentRecord, MemberError> {
        let normalized_handle = normalize_handle(&draft.handle)?;
        let workspace_path = self.agent_data_root.join("agents").join(&id);
        let docs_path = workspace_path.join("docs");
        let memory_path = workspace_path.join("MEMORY.md");
        fs::create_dir_all(&docs_path).map_err(MemberError::Io)?;

        let now = current_timestamp();
        let record = ProductAgentRecord {
            id: id.clone(),
            name: draft.name.trim().to_string(),
            handle: normalized_handle,
            agent_kind: agent_kind.to_string(),
            system_owned,
            runtime_kind: draft.runtime_kind.trim().to_string(),
            model: draft.model.trim().to_string(),
            node_id: draft.node_id.trim().to_string(),
            description: draft.description.trim().to_string(),
            workspace_path: workspace_path.to_string_lossy().to_string(),
            memory_path: memory_path.to_string_lossy().to_string(),
            docs_path: docs_path.to_string_lossy().to_string(),
            avatar_seed: if agent_kind == "guide" {
                "yeal".to_string()
            } else {
                id.clone()
            },
            runtime_thread: RuntimeThreadRecord {
                runtime_kind: draft.runtime_kind.trim().to_string(),
                status: "ready".to_string(),
                created_at: now.clone(),
            },
            channel_ids,
            created_at: now.clone(),
            updated_at: now,
        };

        fs::write(&memory_path, initial_memory(&record)).map_err(MemberError::Io)?;
        write_default_skills(&record)?;

        let mut state = self.inner.lock().await;
        state
            .product_agent_idempotency
            .insert(idempotency_key.to_string(), record.id.clone());
        state
            .product_agent_handles
            .insert(record.handle.to_lowercase(), record.id.clone());
        state
            .product_agents
            .insert(record.id.clone(), record.clone());
        persist_product_agents(&self.agent_data_root, &state.product_agents)?;

        Ok(record)
    }

    pub async fn update_product_agent(
        &self,
        agent_id: &str,
        update: ProductAgentUpdate,
    ) -> Result<ProductAgentRecord, MemberError> {
        let mut state = self.inner.lock().await;
        let agent = state
            .product_agents
            .get_mut(agent_id)
            .ok_or(MemberError::AgentNotFound)?;

        if let Some(name) = update.name {
            if name.trim().is_empty() {
                return Err(MemberError::InvalidAgent);
            }
            agent.name = name.trim().to_string();
        }
        if let Some(description) = update.description {
            agent.description = description.trim().to_string();
        }
        if let Some(runtime_kind) = update.runtime_kind {
            if runtime_kind.trim().is_empty() {
                return Err(MemberError::InvalidAgent);
            }
            let runtime_kind = runtime_kind.trim().to_string();
            agent.runtime_kind = runtime_kind.clone();
            agent.runtime_thread.runtime_kind = runtime_kind;
        }
        if let Some(model) = update.model {
            agent.model = model.trim().to_string();
        }
        if let Some(node_id) = update.node_id {
            if node_id.trim().is_empty() {
                return Err(MemberError::InvalidAgent);
            }
            agent.node_id = node_id.trim().to_string();
        }
        agent.updated_at = current_timestamp();
        let record = agent.clone();
        persist_product_agents(&self.agent_data_root, &state.product_agents)?;
        Ok(record)
    }

    pub async fn delete_product_agent(
        &self,
        agent_id: &str,
    ) -> Result<ProductAgentRecord, MemberError> {
        let record = {
            let mut state = self.inner.lock().await;
            let record = state
                .product_agents
                .get(agent_id)
                .cloned()
                .ok_or(MemberError::AgentNotFound)?;
            if record.system_owned {
                return Err(MemberError::SystemAgentImmutable);
            }
            state.product_agents.remove(agent_id);
            state
                .product_agent_handles
                .remove(&record.handle.to_lowercase());
            state
                .product_agent_idempotency
                .retain(|_, existing_id| existing_id != agent_id);
            persist_product_agents(&self.agent_data_root, &state.product_agents)?;
            record
        };

        let workspace_path = PathBuf::from(&record.workspace_path);
        let expected_root = self.agent_data_root.join("agents");
        if !workspace_path.starts_with(&expected_root) {
            return Err(MemberError::WorkspaceBoundary);
        }
        match fs::remove_dir_all(&workspace_path) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(MemberError::Io(error)),
        }
        Ok(record)
    }

    pub async fn remember_agent_fact(
        &self,
        agent_id: &str,
        fact: &str,
    ) -> Result<ProductAgentRecord, MemberError> {
        let trimmed = fact.trim();
        if trimmed.is_empty() {
            return Err(MemberError::InvalidMemory);
        }
        let record = self
            .inner
            .lock()
            .await
            .product_agents
            .get(agent_id)
            .cloned()
            .ok_or(MemberError::AgentNotFound)?;

        let workspace_path = PathBuf::from(&record.workspace_path);
        let memory_path = PathBuf::from(&record.memory_path);
        if !memory_path.starts_with(&workspace_path) {
            return Err(MemberError::WorkspaceBoundary);
        }

        let fact = trimmed.trim_start_matches("记住：").trim();
        let mut memory = fs::read_to_string(&memory_path).map_err(MemberError::Io)?;
        if is_active_context_fact(fact) {
            replace_active_context(&mut memory, fact);
        } else {
            append_key_knowledge(&mut memory, fact);
        }
        fs::write(&memory_path, memory).map_err(MemberError::Io)?;
        Ok(record)
    }

    pub async fn list_agent_skills(&self, agent_id: &str) -> Result<Vec<SkillRecord>, MemberError> {
        let record = self
            .inner
            .lock()
            .await
            .product_agents
            .get(agent_id)
            .cloned()
            .ok_or(MemberError::AgentNotFound)?;
        read_standard_skills(&record).or_else(|error| {
            if matches!(error, MemberError::Io(ref io_error) if io_error.kind() == std::io::ErrorKind::NotFound) {
                let legacy = read_legacy_skill_index(&record)?;
                write_default_skills(&record)?;
                read_standard_skills(&record).or(Ok(legacy))
            } else {
                Err(error)
            }
        })
    }
}

impl MemberState {
    fn with_product_agents(agents: Vec<ProductAgentRecord>) -> Self {
        let mut state = Self::default();
        for agent in agents {
            state
                .product_agent_handles
                .insert(agent.handle.to_lowercase(), agent.id.clone());
            state.product_agents.insert(agent.id.clone(), agent);
        }
        state
    }
}

fn load_product_agents(root: &PathBuf) -> Vec<ProductAgentRecord> {
    let path = root.join("agents/index.json");
    let agents = fs::read_to_string(path)
        .ok()
        .and_then(|raw| serde_json::from_str::<Vec<ProductAgentRecord>>(&raw).ok())
        .unwrap_or_default();
    for agent in &agents {
        let _ = write_default_skills(agent);
    }
    agents
}

fn persist_product_agents(
    root: &PathBuf,
    agents: &HashMap<String, ProductAgentRecord>,
) -> Result<(), MemberError> {
    let path = root.join("agents/index.json");
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(MemberError::Io)?;
    }
    let mut ordered = agents.values().cloned().collect::<Vec<_>>();
    ordered.sort_by(|left, right| left.created_at.cmp(&right.created_at));
    let payload = serde_json::to_string_pretty(&ordered).map_err(MemberError::Json)?;
    fs::write(path, payload).map_err(MemberError::Io)
}

fn normalize_handle(handle: &str) -> Result<String, MemberError> {
    let trimmed = handle.trim().trim_start_matches('@').to_lowercase();
    let valid = !trimmed.is_empty()
        && trimmed.len() <= 32
        && trimmed.chars().all(|character| {
            character.is_ascii_lowercase() || character.is_ascii_digit() || character == '-'
        });
    if valid {
        Ok(format!("@{trimmed}"))
    } else {
        Err(MemberError::InvalidHandle)
    }
}

fn coordinator_agent_id(channel_id: &str) -> String {
    format!("agent_coordinator_{}", channel_id.trim().to_lowercase())
}

pub fn is_internal_coordinator_id(agent_id: &str) -> bool {
    agent_id == GLOBAL_COORDINATOR_AGENT_ID || agent_id.starts_with("agent_coordinator_")
}

fn coordinator_handle(channel_id: &str) -> String {
    let normalized = channel_id.trim().to_lowercase();
    let handle = format!("{normalized}-coordinator");
    if handle.len() <= 32 {
        return format!("@{handle}");
    }
    let suffix = normalized.chars().take(25).collect::<String>();
    format!("@coord-{suffix}")
}

fn current_timestamp() -> String {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs().to_string())
        .unwrap_or_else(|_| "0".to_string())
}

fn default_agent_kind() -> String {
    "agent".to_string()
}

fn agent_template_input(agent: &ProductAgentRecord) -> AgentTemplateInput<'_> {
    AgentTemplateInput {
        name: &agent.name,
        handle: &agent.handle,
        description: &agent.description,
        agent_kind: Some(&agent.agent_kind),
        channel_ids: agent.channel_ids.iter().map(String::as_str).collect(),
    }
}

fn initial_memory(agent: &ProductAgentRecord) -> String {
    shared_initial_memory(&agent_template_input(agent))
}

pub(crate) fn channel_coordinator_description(channel_name: &str) -> String {
    format!(
        "内置频道协调员，负责分析用户在 {channel_name} 的意图并路由 Agent，自己不回复用户问题；可路由给单个或多个 Agent；用户明确 @ 某个 Agent、@all 或 @everyone 时直接转发。"
    )
}

fn global_coordinator_description() -> String {
    "内置全局频道协调员，负责根据当前频道成员和上下文分析用户意图并路由 Agent，自己不回复用户问题。"
        .to_string()
}

fn sanitize_legacy_guide_memory(agent: &ProductAgentRecord) -> Result<(), MemberError> {
    if agent.agent_kind != "guide" {
        return Ok(());
    }
    let memory = match fs::read_to_string(&agent.memory_path) {
        Ok(memory) => memory,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(MemberError::Io(error)),
    };
    let cleaned = remove_legacy_guide_memory_lines(&memory);
    if cleaned != memory {
        fs::write(&agent.memory_path, cleaned).map_err(MemberError::Io)?;
    }
    Ok(())
}

fn remove_legacy_guide_memory_lines(memory: &str) -> String {
    let mut cleaned = memory
        .lines()
        .filter(|line| !is_legacy_guide_memory_line(line))
        .collect::<Vec<_>>()
        .join("\n");
    if memory.ends_with('\n') {
        cleaned.push('\n');
    }
    cleaned
}

fn is_legacy_guide_memory_line(line: &str) -> bool {
    line.contains("@Alice")
        || line.contains("@Nancy")
        || line.contains("@Cindy")
        || line.contains("Alice + Coda + Nancy")
        || line.contains("团队协作流程：用户/Alice")
}

fn is_active_context_fact(fact: &str) -> bool {
    let normalized = fact.to_lowercase();
    fact.contains("当前")
        || fact.contains("正在")
        || fact.contains("下次继续")
        || normalized.contains("blocked")
        || normalized.contains("next")
        || normalized.contains("resume")
}

fn append_key_knowledge(memory: &mut String, fact: &str) {
    let line = format!("\n- {}\n", fact.trim());
    if let Some(index) = memory.find("## Active Context") {
        memory.insert_str(index, &line);
    } else {
        if !memory.ends_with('\n') {
            memory.push('\n');
        }
        memory.push_str("\n## Key Knowledge\n");
        memory.push_str(&line);
    }
}

fn replace_active_context(memory: &mut String, fact: &str) {
    let active_heading = "## Active Context";
    let replacement = format!("{active_heading}\n- State: {}\n", fact.trim());
    if let Some(start) = memory.find(active_heading) {
        let after_heading = start + active_heading.len();
        let rest = &memory[after_heading..];
        let end = rest
            .find("\n## ")
            .map(|relative| after_heading + relative)
            .unwrap_or(memory.len());
        memory.replace_range(start..end, &replacement.trim_end_matches('\n'));
        if !memory.ends_with('\n') {
            memory.push('\n');
        }
    } else {
        if !memory.ends_with('\n') {
            memory.push('\n');
        }
        memory.push('\n');
        memory.push_str(&replacement);
    }
}

fn write_default_skills(agent: &ProductAgentRecord) -> Result<(), MemberError> {
    let skills = default_skill_assets(agent);
    for skill in &skills {
        if let Some(parent) = Path::new(&skill.path).parent() {
            fs::create_dir_all(parent).map_err(MemberError::Io)?;
        }
        fs::write(&skill.path, &skill.body).map_err(MemberError::Io)?;
    }
    cleanup_legacy_default_skills(agent)
}

fn read_standard_skills(agent: &ProductAgentRecord) -> Result<Vec<SkillRecord>, MemberError> {
    let skills_root = standard_skills_root(agent);
    let mut skills = Vec::new();
    for entry in fs::read_dir(&skills_root).map_err(MemberError::Io)? {
        let entry = entry.map_err(MemberError::Io)?;
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let skill_path = path.join("SKILL.md");
        if !skill_path.is_file() {
            continue;
        }
        let raw = fs::read_to_string(&skill_path).map_err(MemberError::Io)?;
        let (name, description) = parse_skill_frontmatter(&raw).unwrap_or_else(|| {
            let id = path
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string();
            (id, String::new())
        });
        let id = path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string();
        skills.push(SkillRecord {
            id,
            name,
            trigger: description,
            path: skill_path.to_string_lossy().to_string(),
        });
    }
    if skills.is_empty() {
        return Err(MemberError::Io(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "no standard skills found",
        )));
    }
    skills.sort_by(|left, right| left.id.cmp(&right.id));
    Ok(skills)
}

fn read_legacy_skill_index(agent: &ProductAgentRecord) -> Result<Vec<SkillRecord>, MemberError> {
    let skills_path = PathBuf::from(&agent.workspace_path).join("skills/index.json");
    fs::read_to_string(skills_path)
        .map_err(MemberError::Io)
        .and_then(|raw| serde_json::from_str::<Vec<SkillRecord>>(&raw).map_err(MemberError::Json))
}

struct DefaultSkillFile {
    path: String,
    body: String,
}

fn default_skill_assets(agent: &ProductAgentRecord) -> Vec<DefaultSkillFile> {
    standard_skill_assets(&agent_template_input(agent))
        .into_iter()
        .map(|skill| DefaultSkillFile {
            path: standard_skill_path(agent, skill.id)
                .to_string_lossy()
                .to_string(),
            body: skill.body,
        })
        .collect()
}

fn standard_skills_root(agent: &ProductAgentRecord) -> PathBuf {
    PathBuf::from(&agent.workspace_path).join(".claude/skills")
}

fn standard_skill_path(agent: &ProductAgentRecord, id: &str) -> PathBuf {
    standard_skills_root(agent).join(id).join("SKILL.md")
}

fn parse_skill_frontmatter(raw: &str) -> Option<(String, String)> {
    let mut lines = raw.lines();
    if lines.next()? != "---" {
        return None;
    }
    let mut name = None;
    let mut description = None;
    for line in lines {
        if line == "---" {
            break;
        }
        if let Some(value) = line.strip_prefix("name:") {
            name = Some(value.trim().trim_matches('"').to_string());
        }
        if let Some(value) = line.strip_prefix("description:") {
            description = Some(value.trim().trim_matches('"').to_string());
        }
    }
    Some((name?, description?))
}

fn cleanup_legacy_default_skills(agent: &ProductAgentRecord) -> Result<(), MemberError> {
    let workspace_root = PathBuf::from(&agent.workspace_path);
    for file_name in ["memory.skill.md", "guide-create.skill.md"] {
        let path = workspace_root.join(file_name);
        match fs::remove_file(path) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(MemberError::Io(error)),
        }
    }

    let legacy_root = PathBuf::from(&agent.workspace_path).join("skills");
    for file_name in ["index.json", "memory.skill.md", "guide-create.skill.md"] {
        let path = legacy_root.join(file_name);
        match fs::remove_file(path) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(MemberError::Io(error)),
        }
    }
    match fs::remove_dir(&legacy_root) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) if error.kind() == std::io::ErrorKind::DirectoryNotEmpty => {}
        Err(error) => return Err(MemberError::Io(error)),
    }
    Ok(())
}

fn narrow_permission(
    base: PermissionPreset,
    override_permission: Option<PermissionPreset>,
) -> PermissionPreset {
    match (rank(base), override_permission.map(rank)) {
        (base_rank, Some(override_rank)) if override_rank < base_rank => from_rank(override_rank),
        (base_rank, _) => from_rank(base_rank),
    }
}

fn rank(permission: PermissionPreset) -> u8 {
    match permission {
        PermissionPreset::ReadOnly => 0,
        PermissionPreset::Edit => 1,
        PermissionPreset::Controlled => 2,
    }
}

fn from_rank(rank: u8) -> PermissionPreset {
    match rank {
        0 => PermissionPreset::ReadOnly,
        1 => PermissionPreset::Edit,
        _ => PermissionPreset::Controlled,
    }
}

#[derive(Debug, thiserror::Error)]
pub enum MemberError {
    #[error("agent not found")]
    AgentNotFound,
    #[error("missing idempotency key")]
    MissingIdempotencyKey,
    #[error("duplicate handle")]
    DuplicateHandle,
    #[error("invalid handle")]
    InvalidHandle,
    #[error("invalid agent")]
    InvalidAgent,
    #[error("invalid memory")]
    InvalidMemory,
    #[error("agent memory path is outside workspace")]
    WorkspaceBoundary,
    #[error("system agents cannot be deleted")]
    SystemAgentImmutable,
    #[error("agent workspace io error: {0}")]
    Io(std::io::Error),
    #[error("agent workspace json error: {0}")]
    Json(serde_json::Error),
}
