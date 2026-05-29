use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;
use uuid::Uuid;

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
            return Ok((agent, false));
        }
        {
            let state = self.inner.lock().await;
            if state.product_agent_handles.contains_key("@leelei") {
                return Err(MemberError::DuplicateHandle);
            }
        }

        let draft = ProductAgentDraft {
            name: "Leelei".to_string(),
            handle: "@leelei".to_string(),
            runtime_kind: "ClaudeCode".to_string(),
            model: "Sonnet".to_string(),
            node_id: node_id.to_string(),
            description: "回答关于 Slei App 如何使用的问题，用于帮助和引导用户建立自己的团队。".to_string(),
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

    async fn create_product_agent_record(
        &self,
        draft: ProductAgentDraft,
        id: String,
        agent_kind: &str,
        system_owned: bool,
        idempotency_key: &str,
    ) -> Result<ProductAgentRecord, MemberError> {
        let normalized_handle = normalize_handle(&draft.handle)?;
        let workspace_path = self.agent_data_root.join("agents").join(&id);
        let docs_path = workspace_path.join("docs");
        let memory_path = workspace_path.join("MEMORY.md");
        let skills_path = workspace_path.join("skills");
        fs::create_dir_all(&docs_path).map_err(MemberError::Io)?;
        fs::create_dir_all(&skills_path).map_err(MemberError::Io)?;

        let now = current_timestamp();
        let record = ProductAgentRecord {
            id,
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
            avatar_seed: if system_owned { "leelei".to_string() } else { Uuid::new_v4().simple().to_string() },
            runtime_thread: RuntimeThreadRecord {
                runtime_kind: draft.runtime_kind.trim().to_string(),
                status: "ready".to_string(),
                created_at: now.clone(),
            },
            channel_ids: vec!["all".to_string()],
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
            agent.runtime_kind = runtime_kind.trim().to_string();
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

        let line = format!("\n- {}\n", trimmed.trim_start_matches("记住："));
        let mut memory = fs::read_to_string(&memory_path).map_err(MemberError::Io)?;
        if let Some(index) = memory.find("## Active Context") {
            memory.insert_str(index, &line);
        } else {
            memory.push_str("\n## Key Knowledge\n");
            memory.push_str(&line);
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
        let skills_path = PathBuf::from(&record.workspace_path).join("skills/index.json");
        fs::read_to_string(skills_path)
            .map_err(MemberError::Io)
            .and_then(|raw| serde_json::from_str::<Vec<SkillRecord>>(&raw).map_err(MemberError::Json))
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
    fs::read_to_string(path)
        .ok()
        .and_then(|raw| serde_json::from_str::<Vec<ProductAgentRecord>>(&raw).ok())
        .unwrap_or_default()
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

fn current_timestamp() -> String {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs().to_string())
        .unwrap_or_else(|_| "0".to_string())
}

fn default_agent_kind() -> String {
    "agent".to_string()
}

fn initial_memory(agent: &ProductAgentRecord) -> String {
    format!(
        r#"# {name}

## Role
{description}

## Team
@lei-lee — 人类用户，项目发起人
@Alice — 研发团队架构师，负责头脑风暴、技术方案、验收标准、架构设计，不参与实际编码
{handle} — 我自己，{name}
@Nancy — QA 质保员，审查代码质量、安全漏洞，提出改进意见
@Cindy — Onboarding 助手

## Key Knowledge
团队协作流程：用户/Alice 发起需求 → Alice 设计技术方案 → Coda 实现编码 → Nancy QA 审查 → 迭代
主频道：#all（目前唯一频道）
优先通过 slock 消息进行任务协作

## Active Context
首次启动，等待任务分配
用户刚搭建完研发团队（Alice + Coda + Nancy）
"#,
        name = agent.name,
        description = agent.description,
        handle = agent.handle
    )
}

fn default_memory_skill(agent: &ProductAgentRecord) -> String {
    format!(
        r#"# Memory Skill for {name}

Trigger this skill when a user mentions {handle} and asks the agent to remember, learn, or 记住 something.

When triggered, append the requested fact to MEMORY.md under Key Knowledge or Active Context.
"#,
        name = agent.name,
        handle = agent.handle
    )
}

fn guide_create_skill() -> String {
    "Trigger when the user asks Leelei to create an agent, member, channel, or 频道. Return a fixed interactive card draft instead of free-form prose.\n".to_string()
}

fn write_default_skills(agent: &ProductAgentRecord) -> Result<(), MemberError> {
    let skills_path = PathBuf::from(&agent.workspace_path).join("skills");
    fs::create_dir_all(&skills_path).map_err(MemberError::Io)?;
    let mut skills = vec![SkillRecord {
        id: "memory".to_string(),
        name: "记忆".to_string(),
        trigger: format!("提及 {} 并使用 remember、learn 或 记住", agent.handle),
        path: format!("{}/skills/memory.skill.md", agent.workspace_path),
    }];
    fs::write(skills_path.join("memory.skill.md"), default_memory_skill(agent))
        .map_err(MemberError::Io)?;
    if agent.agent_kind == "guide" {
        skills.insert(0, SkillRecord {
            id: "guide-create".to_string(),
            name: "引导创建".to_string(),
            trigger: "识别创建智能体、成员、频道的请求".to_string(),
            path: format!("{}/skills/guide-create.skill.md", agent.workspace_path),
        });
        fs::write(skills_path.join("guide-create.skill.md"), guide_create_skill())
            .map_err(MemberError::Io)?;
    }
    let payload = serde_json::to_string_pretty(&skills).map_err(MemberError::Json)?;
    fs::write(skills_path.join("index.json"), payload).map_err(MemberError::Io)
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
    #[error("agent workspace io error: {0}")]
    Io(std::io::Error),
    #[error("agent workspace json error: {0}")]
    Json(serde_json::Error),
}
