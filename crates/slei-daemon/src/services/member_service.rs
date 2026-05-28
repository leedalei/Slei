use std::collections::HashMap;
use std::sync::Arc;

use tokio::sync::Mutex;
use uuid::Uuid;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
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
}

#[derive(Debug, Default)]
struct MemberState {
    agents: HashMap<String, AgentRecord>,
    agent_idempotency: HashMap<String, String>,
    channel_members: HashMap<(String, String), ChannelMemberRecord>,
    assignment_idempotency: HashMap<String, (String, String)>,
    primary_agents: HashMap<String, String>,
}

impl MemberService {
    pub fn for_tests() -> Self {
        Self::default()
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
}
