use std::{
    env, fs,
    io::{Read, Write},
    net::{TcpStream, ToSocketAddrs},
    path::{Path, PathBuf},
    process::Command,
    sync::Mutex,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};

#[derive(Clone, Debug)]
pub struct RuntimeDescriptor {
    pub endpoint: String,
    pub event_socket: String,
    pub token: String,
    pub daemon_version: String,
    pub protocol_version: String,
}

#[derive(Debug)]
pub struct DaemonBroker {
    descriptor: RuntimeDescriptor,
    last_authorization_header: Mutex<Option<String>>,
    local_node_name: Mutex<String>,
    agents: Mutex<Vec<DesktopAgentView>>,
    channels: Mutex<Vec<ChannelView>>,
    channel_members: Mutex<Vec<ChannelMemberView>>,
    cards: Mutex<Vec<InteractiveCardView>>,
    conversations: Mutex<Vec<ConversationView>>,
    conversation_messages: Mutex<Vec<ConversationMessageView>>,
    preferences: Mutex<UserPreferencesView>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SanitizedDaemonStatus {
    pub connected: bool,
    pub daemon_version: String,
    pub protocol_version: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct EventReconnectReceipt {
    pub after: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactOpenReceipt {
    pub artifact_id: String,
    pub open_token: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeReadinessView {
    pub kind: String,
    pub readiness: String,
    pub version: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceMetaView {
    pub platform: String,
    #[serde(alias = "os_version")]
    pub os_version: String,
    pub arch: String,
    pub hostname: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopNodeView {
    pub id: String,
    pub name: String,
    pub status: String,
    #[serde(alias = "daemon_version")]
    pub daemon_version: String,
    pub device: DeviceMetaView,
    pub runtimes: Vec<RuntimeReadinessView>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeListReceipt {
    pub nodes: Vec<DesktopNodeView>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeRenameReceipt {
    pub node: DesktopNodeView,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationPreferencesView {
    pub mentions: bool,
    pub human_replies: bool,
    pub approvals: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UserPreferencesView {
    pub locale: String,
    pub time_zone: String,
    pub appearance: AppearancePreferencesView,
    pub notifications: NotificationPreferencesView,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppearancePreferencesView {
    pub theme: String,
    pub font_size: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreferencesReceipt {
    pub preferences: UserPreferencesView,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreferencesUpdateRequest {
    pub locale: Option<String>,
    pub time_zone: Option<String>,
    pub appearance: Option<AppearancePreferencesView>,
    pub notifications: Option<NotificationPreferencesView>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopAgentView {
    pub id: String,
    pub name: String,
    pub handle: String,
    pub agent_kind: Option<String>,
    pub system_owned: Option<bool>,
    pub runtime_kind: String,
    pub model: String,
    pub node_id: String,
    pub description: String,
    pub workspace_path: String,
    pub memory_path: String,
    pub docs_path: String,
    pub avatar_seed: String,
    pub runtime_thread: Option<RuntimeThreadView>,
    pub skills: Option<Vec<SkillView>>,
    pub channel_ids: Option<Vec<String>>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeThreadView {
    pub runtime_kind: String,
    pub status: String,
    pub created_at: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillView {
    pub id: String,
    pub name: String,
    pub trigger: String,
    pub path: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentListReceipt {
    pub agents: Vec<DesktopAgentView>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentReceipt {
    pub agent: DesktopAgentView,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillListReceipt {
    pub skills: Vec<SkillView>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentPathOpenReceipt {
    pub agent_id: String,
    pub target: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCreateRequest {
    pub name: String,
    pub handle: String,
    #[serde(alias = "runtimeKind")]
    pub runtime_kind: String,
    pub model: String,
    #[serde(alias = "nodeId")]
    pub node_id: String,
    pub description: String,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentUpdateRequest {
    pub name: Option<String>,
    pub description: Option<String>,
    #[serde(alias = "runtimeKind")]
    pub runtime_kind: Option<String>,
    pub model: Option<String>,
    #[serde(alias = "nodeId")]
    pub node_id: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationView {
    pub id: String,
    pub kind: String,
    pub agent_id: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationMessageView {
    pub id: String,
    pub conversation_id: String,
    pub author_id: String,
    pub body: String,
    pub cards: Option<Vec<InteractiveCardView>>,
    pub created_at: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelView {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub is_default: Option<bool>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelMemberView {
    pub channel_id: String,
    pub agent_id: String,
    pub joined_at: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelListReceipt {
    pub channels: Vec<ChannelView>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelReceipt {
    pub channel: ChannelView,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelCreateRequest {
    pub name: String,
    pub description: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelMemberListReceipt {
    pub members: Vec<ChannelMemberView>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InteractiveCardView {
    pub id: String,
    pub kind: String,
    pub state: String,
    pub title: String,
    pub summary: String,
    pub draft: serde_json::Value,
    pub action_label: String,
    pub done_label: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InteractiveCardReceipt {
    pub card: InteractiveCardView,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GuideBootstrapReceipt {
    pub status: String,
    pub agent: Option<DesktopAgentView>,
    pub conversation: Option<ConversationView>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationListReceipt {
    pub conversations: Vec<ConversationView>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationReceipt {
    pub conversation: ConversationView,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationMessageListReceipt {
    pub messages: Vec<ConversationMessageView>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationMessageReceipt {
    pub message: ConversationMessageView,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationMessageRequest {
    pub author_id: String,
    pub body: String,
}

impl DaemonBroker {
    pub fn default_local() -> Self {
        Self::for_tests(RuntimeDescriptor {
            endpoint: "http://127.0.0.1:4319".to_string(),
            event_socket: "ws://127.0.0.1:4319/v1/events/ws".to_string(),
            token: "desktop-session-token".to_string(),
            daemon_version: "0.1.0".to_string(),
            protocol_version: "v1".to_string(),
        })
    }

    pub fn for_tests(descriptor: RuntimeDescriptor) -> Self {
        Self {
            descriptor,
            last_authorization_header: Mutex::new(None),
            local_node_name: Mutex::new("本机设备".to_string()),
            agents: Mutex::new(Vec::new()),
            channels: Mutex::new(vec![ChannelView {
                id: "all".to_string(),
                name: "all".to_string(),
                description: Some("默认团队频道".to_string()),
                is_default: Some(true),
            }]),
            channel_members: Mutex::new(Vec::new()),
            cards: Mutex::new(Vec::new()),
            conversations: Mutex::new(load_local_conversations()),
            conversation_messages: Mutex::new(load_all_local_conversation_messages()),
            preferences: Mutex::new(load_local_preferences()),
        }
    }

    pub fn status(&self) -> SanitizedDaemonStatus {
        SanitizedDaemonStatus {
            connected: true,
            daemon_version: self.descriptor.daemon_version.clone(),
            protocol_version: self.descriptor.protocol_version.clone(),
        }
    }

    pub fn reconnect_events(&self, after: u64) -> EventReconnectReceipt {
        let _socket = &self.descriptor.event_socket;
        self.last_authorization_header
            .lock()
            .expect("authorization mutex poisoned")
            .replace(format!("Bearer {}", self.descriptor.token));
        EventReconnectReceipt { after }
    }

    pub fn request_artifact_open(
        &self,
        artifact_id: &str,
    ) -> Result<ArtifactOpenReceipt, ArtifactOpenError> {
        if !artifact_id.starts_with("artifact_")
            || artifact_id.contains('/')
            || artifact_id.starts_with("file:")
        {
            return Err(ArtifactOpenError::ArtifactIdRequired);
        }

        self.last_authorization_header
            .lock()
            .expect("authorization mutex poisoned")
            .replace(format!("Bearer {}", self.descriptor.token));
        Ok(ArtifactOpenReceipt {
            artifact_id: artifact_id.to_string(),
            open_token: format!("open:{artifact_id}"),
        })
    }

    pub fn list_nodes(&self) -> NodeListReceipt {
        self.fetch_nodes_from_daemon()
            .unwrap_or_else(|| NodeListReceipt {
                nodes: vec![self.local_node()],
            })
    }

    pub fn refresh_runtime_status(&self) -> NodeListReceipt {
        self.list_nodes()
    }

    pub fn list_preferences(&self) -> PreferencesReceipt {
        if let Some(receipt) = self.fetch_preferences_from_daemon() {
            self.replace_local_preferences(receipt.preferences.clone());
            return receipt;
        }

        PreferencesReceipt {
            preferences: self
                .preferences
                .lock()
                .expect("preferences mutex poisoned")
                .clone(),
        }
    }

    pub fn update_preferences(
        &self,
        request: PreferencesUpdateRequest,
    ) -> Result<PreferencesReceipt, PreferencesError> {
        if let Some(receipt) = self.update_preferences_in_daemon(&request) {
            self.replace_local_preferences(receipt.preferences.clone());
            persist_local_preferences(&receipt.preferences)?;
            return Ok(receipt);
        }

        let mut preferences = self.preferences.lock().expect("preferences mutex poisoned");
        if let Some(locale) = request.locale {
            if !matches!(locale.as_str(), "zh-CN" | "en-US") {
                return Err(PreferencesError::InvalidLocale);
            }
            preferences.locale = locale;
        }
        if let Some(time_zone) = request.time_zone {
            if time_zone.trim().is_empty() || time_zone.chars().count() > 64 {
                return Err(PreferencesError::InvalidTimeZone);
            }
            preferences.time_zone = time_zone.trim().to_string();
        }
        if let Some(appearance) = request.appearance {
            if !matches!(
                appearance.theme.as_str(),
                "system" | "light" | "dark" | "highContrast"
            ) || !matches!(appearance.font_size.as_str(), "sm" | "md" | "lg")
            {
                return Err(PreferencesError::InvalidAppearance);
            }
            preferences.appearance = appearance;
        }
        if let Some(notifications) = request.notifications {
            preferences.notifications = notifications;
        }
        persist_local_preferences(&preferences)?;
        Ok(PreferencesReceipt {
            preferences: preferences.clone(),
        })
    }

    pub fn rename_local_node(&self, name: &str) -> Result<NodeRenameReceipt, NodeNameError> {
        let trimmed = name.trim();
        if trimmed.is_empty() {
            return Err(NodeNameError::NameRequired);
        }
        if trimmed.chars().count() > 64 {
            return Err(NodeNameError::NameTooLong);
        }

        if let Some(receipt) = self.rename_local_node_in_daemon(trimmed) {
            *self
                .local_node_name
                .lock()
                .expect("node name mutex poisoned") = receipt.node.name.clone();
            return Ok(receipt);
        }

        *self
            .local_node_name
            .lock()
            .expect("node name mutex poisoned") = trimmed.to_string();

        Ok(NodeRenameReceipt {
            node: self.local_node(),
        })
    }

    pub fn bootstrap_guide_agent(&self) -> GuideBootstrapReceipt {
        if let Some(receipt) = self.bootstrap_guide_agent_in_daemon() {
            if let Some(agent) = receipt.agent.clone() {
                self.upsert_local_agent(agent);
            }
            if let Some(conversation) = receipt.conversation.clone() {
                let _ = self.upsert_local_conversation(conversation);
            }
            return receipt;
        }

        let has_ready_runtime = self
            .list_nodes()
            .nodes
            .iter()
            .any(|node| node.runtimes.iter().any(|runtime| runtime.kind == "ClaudeCode" && runtime.readiness == "ready"));
        if !has_ready_runtime {
            return GuideBootstrapReceipt {
                status: "runtimeUnavailable".to_string(),
                agent: None,
                conversation: None,
            };
        }
        if let Some(existing) = self
            .agents
            .lock()
            .expect("agents mutex poisoned")
            .iter()
            .find(|agent| agent.id == "agent_guide_local_node" || agent.handle == "@leelei")
            .cloned()
        {
            let conversation = self
                .create_dm_conversation(&existing.id)
                .ok()
                .map(|receipt| receipt.conversation);
            return GuideBootstrapReceipt {
                status: "alreadyExists".to_string(),
                agent: Some(existing),
                conversation,
            };
        }
        let now = monotonic_id();
        let workspace_path = default_agent_workspace("agent_guide_local_node");
        let agent = DesktopAgentView {
            id: "agent_guide_local_node".to_string(),
            name: "Leelei".to_string(),
            handle: "@leelei".to_string(),
            agent_kind: Some("guide".to_string()),
            system_owned: Some(true),
            runtime_kind: "ClaudeCode".to_string(),
            model: "Sonnet".to_string(),
            node_id: "local-node".to_string(),
            description: "回答关于 Slei App 如何使用的问题，用于帮助和引导用户建立自己的团队。".to_string(),
            workspace_path: workspace_path.clone(),
            memory_path: format!("{workspace_path}/MEMORY.md"),
            docs_path: format!("{workspace_path}/docs"),
            avatar_seed: "leelei".to_string(),
            runtime_thread: Some(RuntimeThreadView {
                runtime_kind: "ClaudeCode".to_string(),
                status: "ready".to_string(),
                created_at: now.clone(),
            }),
            skills: None,
            channel_ids: Some(vec!["all".to_string()]),
            created_at: now.clone(),
            updated_at: now.clone(),
        };
        let _ = create_local_agent_workspace(&agent);
        self.upsert_local_agent(agent.clone());
        self.ensure_channel_membership("all", &agent.id);
        let conversation = self
            .create_dm_conversation(&agent.id)
            .ok()
            .map(|receipt| receipt.conversation);
        GuideBootstrapReceipt {
            status: "created".to_string(),
            agent: Some(agent),
            conversation,
        }
    }

    pub fn list_channels(&self) -> ChannelListReceipt {
        self.fetch_channels_from_daemon().unwrap_or_else(|| ChannelListReceipt {
            channels: self.channels.lock().expect("channels mutex poisoned").clone(),
        })
    }

    pub fn create_channel(&self, request: ChannelCreateRequest) -> Result<ChannelReceipt, ChannelError> {
        if let Some(receipt) = self.create_channel_in_daemon(&request) {
            self.upsert_local_channel(receipt.channel.clone());
            return Ok(receipt);
        }
        let name = normalize_channel_name(&request.name)?;
        let channel = ChannelView {
            id: name.clone(),
            name,
            description: request.description,
            is_default: Some(false),
        };
        self.upsert_local_channel(channel.clone());
        Ok(ChannelReceipt { channel })
    }

    pub fn list_channel_members(&self, channel_id: &str) -> ChannelMemberListReceipt {
        self.fetch_channel_members_from_daemon(channel_id).unwrap_or_else(|| ChannelMemberListReceipt {
            members: self
                .channel_members
                .lock()
                .expect("channel members mutex poisoned")
                .iter()
                .filter(|member| member.channel_id == channel_id)
                .cloned()
                .collect(),
        })
    }

    pub fn complete_interactive_card(&self, card_id: &str) -> Result<InteractiveCardReceipt, CardError> {
        if let Some(receipt) = self.complete_interactive_card_in_daemon(card_id) {
            self.upsert_local_card(receipt.card.clone());
            return Ok(receipt);
        }
        let mut cards = self.cards.lock().expect("cards mutex poisoned");
        let card = cards
            .iter_mut()
            .find(|card| card.id == card_id)
            .ok_or(CardError::CardNotFound)?;
        card.state = "done".to_string();
        Ok(InteractiveCardReceipt { card: card.clone() })
    }

    pub fn list_agents(&self) -> AgentListReceipt {
        if let Some(receipt) = self.fetch_agents_from_daemon() {
            for agent in &receipt.agents {
                self.upsert_local_agent(agent.clone());
            }
            receipt
        } else {
            AgentListReceipt {
                agents: self.agents.lock().expect("agents mutex poisoned").clone(),
            }
        }
    }

    pub fn create_agent(&self, request: AgentCreateRequest) -> Result<AgentReceipt, AgentError> {
        validate_agent_create(&request)?;

        if let Some(receipt) = self.create_agent_in_daemon(&request) {
            self.upsert_local_agent(receipt.agent.clone());
            return Ok(receipt);
        }

        let handle = normalize_handle(&request.handle)?;
        let mut agents = self.agents.lock().expect("agents mutex poisoned");
        if agents
            .iter()
            .any(|agent| agent.handle.eq_ignore_ascii_case(&handle))
        {
            return Err(AgentError::DuplicateHandle);
        }

        let id = format!("agent_{}", monotonic_id());
        let workspace_path = default_agent_workspace(&id);
        let now = monotonic_id();
        let agent = DesktopAgentView {
            id: id.clone(),
            name: request.name.trim().to_string(),
            handle,
            agent_kind: Some("agent".to_string()),
            system_owned: Some(false),
            runtime_kind: request.runtime_kind.trim().to_string(),
            model: request.model.trim().to_string(),
            node_id: request.node_id.trim().to_string(),
            description: request.description.trim().to_string(),
            workspace_path: workspace_path.clone(),
            memory_path: format!("{workspace_path}/MEMORY.md"),
            docs_path: format!("{workspace_path}/docs"),
            avatar_seed: id,
            runtime_thread: Some(RuntimeThreadView {
                runtime_kind: request.runtime_kind.trim().to_string(),
                status: "ready".to_string(),
                created_at: now.clone(),
            }),
            skills: None,
            channel_ids: Some(vec!["all".to_string()]),
            created_at: now.clone(),
            updated_at: now,
        };
        create_local_agent_workspace(&agent)?;
        agents.push(agent.clone());
        drop(agents);
        self.ensure_channel_membership("all", &agent.id);
        Ok(AgentReceipt { agent })
    }

    pub fn update_agent(
        &self,
        agent_id: &str,
        request: AgentUpdateRequest,
    ) -> Result<AgentReceipt, AgentError> {
        if let Some(receipt) = self.update_agent_in_daemon(agent_id, &request) {
            self.upsert_local_agent(receipt.agent.clone());
            return Ok(receipt);
        }

        let mut agents = self.agents.lock().expect("agents mutex poisoned");
        let agent = agents
            .iter_mut()
            .find(|agent| agent.id == agent_id)
            .ok_or(AgentError::AgentNotFound)?;
        if let Some(name) = request.name {
            if name.trim().is_empty() {
                return Err(AgentError::InvalidAgent);
            }
            agent.name = name.trim().to_string();
        }
        if let Some(description) = request.description {
            agent.description = description.trim().to_string();
        }
        if let Some(runtime_kind) = request.runtime_kind {
            agent.runtime_kind = runtime_kind.trim().to_string();
        }
        if let Some(model) = request.model {
            agent.model = model.trim().to_string();
        }
        if let Some(node_id) = request.node_id {
            agent.node_id = node_id.trim().to_string();
        }
        agent.updated_at = monotonic_id();
        Ok(AgentReceipt {
            agent: agent.clone(),
        })
    }

    pub fn remember_agent_fact(
        &self,
        agent_id: &str,
        fact: &str,
    ) -> Result<AgentReceipt, AgentError> {
        if fact.trim().is_empty() {
            return Err(AgentError::InvalidMemory);
        }
        if let Some(receipt) = self.remember_agent_fact_in_daemon(agent_id, fact) {
            self.upsert_local_agent(receipt.agent.clone());
            return Ok(receipt);
        }

        let agent = self
            .agents
            .lock()
            .expect("agents mutex poisoned")
            .iter()
            .find(|agent| agent.id == agent_id)
            .cloned()
            .ok_or(AgentError::AgentNotFound)?;
        append_local_agent_memory(&agent, fact)?;
        Ok(AgentReceipt { agent })
    }

    pub fn list_agent_skills(&self, agent_id: &str) -> Result<SkillListReceipt, AgentError> {
        if let Some(receipt) = self.fetch_agent_skills_from_daemon(agent_id) {
            return Ok(receipt);
        }

        let agent = self
            .agents
            .lock()
            .expect("agents mutex poisoned")
            .iter()
            .find(|agent| agent.id == agent_id)
            .cloned()
            .ok_or(AgentError::AgentNotFound)?;

        if let Some(skills) = agent.skills.clone() {
            return Ok(SkillListReceipt { skills });
        }

        Ok(SkillListReceipt {
            skills: read_local_agent_skills(&agent)?,
        })
    }

    pub fn open_agent_path(
        &self,
        agent_id: &str,
        target: &str,
    ) -> Result<AgentPathOpenReceipt, AgentPathError> {
        let agent = self
            .agents
            .lock()
            .expect("agents mutex poisoned")
            .iter()
            .find(|agent| agent.id == agent_id)
            .cloned()
            .ok_or(AgentPathError::AgentNotFound)?;
        let target_path = match target {
            "workspace" => &agent.workspace_path,
            "memory" => &agent.memory_path,
            "docs" => &agent.docs_path,
            _ => return Err(AgentPathError::InvalidTarget),
        };
        let workspace = canonicalize_agent_path(&agent.workspace_path)?;
        let path = canonicalize_agent_path(target_path)?;
        if !path.starts_with(&workspace) {
            return Err(AgentPathError::WorkspaceBoundary);
        }
        open_system_path(&path)?;
        Ok(AgentPathOpenReceipt {
            agent_id: agent.id,
            target: target.to_string(),
        })
    }

    pub fn list_conversations(&self) -> ConversationListReceipt {
        self.fetch_conversations_from_daemon()
            .unwrap_or_else(|| ConversationListReceipt {
                conversations: self
                    .conversations
                    .lock()
                    .expect("conversations mutex poisoned")
                    .clone(),
            })
    }

    pub fn create_dm_conversation(
        &self,
        agent_id: &str,
    ) -> Result<ConversationReceipt, ConversationError> {
        let agent_id = agent_id.trim();
        if agent_id.is_empty() {
            return Err(ConversationError::InvalidConversation);
        }
        if !self
            .list_agents()
            .agents
            .iter()
            .any(|agent| agent.id == agent_id)
        {
            return Err(ConversationError::AgentNotFound);
        }

        if let Some(receipt) = self.create_dm_conversation_in_daemon(agent_id) {
            self.upsert_local_conversation(receipt.conversation.clone())?;
            return Ok(receipt);
        }

        let mut conversations = self
            .conversations
            .lock()
            .expect("conversations mutex poisoned");
        if let Some(existing) = conversations
            .iter()
            .find(|conversation| conversation.kind == "dm" && conversation.agent_id == agent_id)
            .cloned()
        {
            return Ok(ConversationReceipt {
                conversation: existing,
            });
        }

        let now = monotonic_id();
        let conversation = ConversationView {
            id: format!("dm:{agent_id}"),
            kind: "dm".to_string(),
            agent_id: agent_id.to_string(),
            created_at: now.clone(),
            updated_at: now,
        };
        conversations.push(conversation.clone());
        persist_local_conversations(&conversations)?;
        Ok(ConversationReceipt { conversation })
    }

    pub fn list_conversation_messages(
        &self,
        conversation_id: &str,
    ) -> ConversationMessageListReceipt {
        if let Some(receipt) = self.list_conversation_messages_from_daemon(conversation_id) {
            return receipt;
        }

        ConversationMessageListReceipt {
            messages: self
                .conversation_messages
                .lock()
                .expect("conversation messages mutex poisoned")
                .iter()
                .filter(|message| message.conversation_id == conversation_id)
                .cloned()
                .collect(),
        }
    }

    pub fn send_conversation_message(
        &self,
        conversation_id: &str,
        request: ConversationMessageRequest,
    ) -> Result<ConversationMessageReceipt, ConversationError> {
        let body = request.body.trim();
        if body.is_empty() || request.author_id.trim().is_empty() {
            return Err(ConversationError::InvalidMessage);
        }

        if let Some(receipt) = self.send_conversation_message_to_daemon(conversation_id, &request) {
            self.upsert_local_conversation_message(receipt.message.clone())?;
            return Ok(receipt);
        }

        let mut conversations = self
            .conversations
            .lock()
            .expect("conversations mutex poisoned");
        let conversation = conversations
            .iter_mut()
            .find(|conversation| conversation.id == conversation_id)
            .ok_or(ConversationError::ConversationNotFound)?;
        let now = monotonic_id();
        let message = ConversationMessageView {
            id: format!("msg_{now}"),
            conversation_id: conversation_id.to_string(),
            author_id: request.author_id.trim().to_string(),
            body: body.to_string(),
            cards: None,
            created_at: now,
        };
        conversation.updated_at = message.created_at.clone();
        persist_local_conversations(&conversations)?;
        drop(conversations);

        let mut messages = self
            .conversation_messages
            .lock()
            .expect("conversation messages mutex poisoned");
        let mut message = message;
        if conversation_id == "dm:agent_guide_local_node" && request.author_id.starts_with("human:") {
            if let Some(card) = local_guide_card_from_text(&message.body) {
                self.upsert_local_card(card.clone());
                message.cards = Some(vec![card]);
            }
        }
        messages.push(message.clone());
        persist_local_conversation_messages(conversation_id, &messages)?;
        Ok(ConversationMessageReceipt { message })
    }

    pub fn last_authorization_header(&self) -> Option<String> {
        self.last_authorization_header
            .lock()
            .expect("authorization mutex poisoned")
            .clone()
    }

    fn local_node(&self) -> DesktopNodeView {
        DesktopNodeView {
            id: "local-node".to_string(),
            name: self
                .local_node_name
                .lock()
                .expect("node name mutex poisoned")
                .clone(),
            status: "connected".to_string(),
            daemon_version: self.descriptor.daemon_version.clone(),
            device: detect_device_meta(),
            runtimes: vec![detect_claude_runtime()],
        }
    }

    fn fetch_nodes_from_daemon(&self) -> Option<NodeListReceipt> {
        let response = self.send_daemon_request("GET", "/v1/nodes", None)?;
        serde_json::from_str::<NodeListReceipt>(&response).ok()
    }

    fn rename_local_node_in_daemon(&self, name: &str) -> Option<NodeRenameReceipt> {
        let payload = serde_json::json!({ "name": name }).to_string();
        let response =
            self.send_daemon_request("PATCH", "/v1/nodes/local-node/name", Some(&payload))?;
        serde_json::from_str::<NodeRenameReceipt>(&response).ok()
    }

    fn fetch_preferences_from_daemon(&self) -> Option<PreferencesReceipt> {
        let response = self.send_daemon_request("GET", "/v1/settings/preferences", None)?;
        serde_json::from_str::<PreferencesReceipt>(&response).ok()
    }

    fn bootstrap_guide_agent_in_daemon(&self) -> Option<GuideBootstrapReceipt> {
        let response = self.send_daemon_request("POST", "/v1/agents/guide/bootstrap", Some("{}"))?;
        serde_json::from_str::<GuideBootstrapReceipt>(&response).ok()
    }

    fn fetch_channels_from_daemon(&self) -> Option<ChannelListReceipt> {
        let response = self.send_daemon_request("GET", "/v1/channels", None)?;
        serde_json::from_str::<ChannelListReceipt>(&response).ok()
    }

    fn create_channel_in_daemon(&self, request: &ChannelCreateRequest) -> Option<ChannelReceipt> {
        let payload = serde_json::to_string(request).ok()?;
        let response = self.send_daemon_request("POST", "/v1/channels", Some(&payload))?;
        serde_json::from_str::<ChannelReceipt>(&response).ok()
    }

    fn fetch_channel_members_from_daemon(&self, channel_id: &str) -> Option<ChannelMemberListReceipt> {
        let response = self.send_daemon_request("GET", &format!("/v1/channels/{channel_id}/members"), None)?;
        serde_json::from_str::<ChannelMemberListReceipt>(&response).ok()
    }

    fn complete_interactive_card_in_daemon(&self, card_id: &str) -> Option<InteractiveCardReceipt> {
        let response = self.send_daemon_request("POST", &format!("/v1/interactive-cards/{card_id}/complete"), Some("{}"))?;
        serde_json::from_str::<InteractiveCardReceipt>(&response).ok()
    }

    fn update_preferences_in_daemon(
        &self,
        request: &PreferencesUpdateRequest,
    ) -> Option<PreferencesReceipt> {
        let payload = serde_json::to_string(request).ok()?;
        let response =
            self.send_daemon_request("PATCH", "/v1/settings/preferences", Some(&payload))?;
        serde_json::from_str::<PreferencesReceipt>(&response).ok()
    }

    fn fetch_agents_from_daemon(&self) -> Option<AgentListReceipt> {
        let response = self.send_daemon_request("GET", "/v1/agents", None)?;
        serde_json::from_str::<AgentListReceipt>(&response).ok()
    }

    fn fetch_agent_skills_from_daemon(&self, agent_id: &str) -> Option<SkillListReceipt> {
        let response =
            self.send_daemon_request("GET", &format!("/v1/agents/{agent_id}/skills"), None)?;
        serde_json::from_str::<SkillListReceipt>(&response).ok()
    }

    fn create_agent_in_daemon(&self, request: &AgentCreateRequest) -> Option<AgentReceipt> {
        let payload = serde_json::to_string(request).ok()?;
        let response = self.send_daemon_request("POST", "/v1/agents", Some(&payload))?;
        serde_json::from_str::<AgentReceipt>(&response).ok()
    }

    fn update_agent_in_daemon(
        &self,
        agent_id: &str,
        request: &AgentUpdateRequest,
    ) -> Option<AgentReceipt> {
        let payload = serde_json::to_string(request).ok()?;
        let response =
            self.send_daemon_request("PATCH", &format!("/v1/agents/{agent_id}"), Some(&payload))?;
        serde_json::from_str::<AgentReceipt>(&response).ok()
    }

    fn remember_agent_fact_in_daemon(&self, agent_id: &str, fact: &str) -> Option<AgentReceipt> {
        let payload = serde_json::json!({ "fact": fact }).to_string();
        let response = self.send_daemon_request(
            "POST",
            &format!("/v1/agents/{agent_id}/memory/remember"),
            Some(&payload),
        )?;
        serde_json::from_str::<AgentReceipt>(&response).ok()
    }

    fn fetch_conversations_from_daemon(&self) -> Option<ConversationListReceipt> {
        let response = self.send_daemon_request("GET", "/v1/conversations", None)?;
        serde_json::from_str::<ConversationListReceipt>(&response).ok()
    }

    fn create_dm_conversation_in_daemon(&self, agent_id: &str) -> Option<ConversationReceipt> {
        let payload = serde_json::json!({ "agentId": agent_id }).to_string();
        let response = self.send_daemon_request("POST", "/v1/conversations/dm", Some(&payload))?;
        serde_json::from_str::<ConversationReceipt>(&response).ok()
    }

    fn list_conversation_messages_from_daemon(
        &self,
        conversation_id: &str,
    ) -> Option<ConversationMessageListReceipt> {
        let response = self.send_daemon_request(
            "GET",
            &format!("/v1/conversations/{conversation_id}/messages"),
            None,
        )?;
        serde_json::from_str::<ConversationMessageListReceipt>(&response).ok()
    }

    fn send_conversation_message_to_daemon(
        &self,
        conversation_id: &str,
        request: &ConversationMessageRequest,
    ) -> Option<ConversationMessageReceipt> {
        let payload = serde_json::to_string(request).ok()?;
        let response = self.send_daemon_request(
            "POST",
            &format!("/v1/conversations/{conversation_id}/messages"),
            Some(&payload),
        )?;
        serde_json::from_str::<ConversationMessageReceipt>(&response).ok()
    }

    fn upsert_local_agent(&self, agent: DesktopAgentView) {
        let mut agents = self.agents.lock().expect("agents mutex poisoned");
        match agents.iter_mut().find(|candidate| candidate.id == agent.id) {
            Some(existing) => *existing = agent,
            None => agents.push(agent),
        }
    }

    fn upsert_local_channel(&self, channel: ChannelView) {
        let mut channels = self.channels.lock().expect("channels mutex poisoned");
        match channels.iter_mut().find(|candidate| candidate.id == channel.id) {
            Some(existing) => *existing = channel,
            None => channels.push(channel),
        }
    }

    fn upsert_local_card(&self, card: InteractiveCardView) {
        let mut cards = self.cards.lock().expect("cards mutex poisoned");
        match cards.iter_mut().find(|candidate| candidate.id == card.id) {
            Some(existing) => *existing = card,
            None => cards.push(card),
        }
    }

    fn ensure_channel_membership(&self, channel_id: &str, agent_id: &str) {
        let mut members = self
            .channel_members
            .lock()
            .expect("channel members mutex poisoned");
        if members
            .iter()
            .any(|member| member.channel_id == channel_id && member.agent_id == agent_id)
        {
            return;
        }
        members.push(ChannelMemberView {
            channel_id: channel_id.to_string(),
            agent_id: agent_id.to_string(),
            joined_at: monotonic_id(),
        });
    }

    fn upsert_local_conversation(
        &self,
        conversation: ConversationView,
    ) -> Result<(), ConversationError> {
        let mut conversations = self
            .conversations
            .lock()
            .expect("conversations mutex poisoned");
        match conversations
            .iter_mut()
            .find(|candidate| candidate.id == conversation.id)
        {
            Some(existing) => *existing = conversation,
            None => conversations.push(conversation),
        }
        persist_local_conversations(&conversations)
    }

    fn upsert_local_conversation_message(
        &self,
        message: ConversationMessageView,
    ) -> Result<(), ConversationError> {
        let conversation_id = message.conversation_id.clone();
        let mut messages = self
            .conversation_messages
            .lock()
            .expect("conversation messages mutex poisoned");
        match messages
            .iter_mut()
            .find(|candidate| candidate.id == message.id)
        {
            Some(existing) => *existing = message,
            None => messages.push(message),
        }
        persist_local_conversation_messages(&conversation_id, &messages)
    }

    fn replace_local_preferences(&self, preferences: UserPreferencesView) {
        *self.preferences.lock().expect("preferences mutex poisoned") = preferences;
    }

    fn send_daemon_request(&self, method: &str, path: &str, body: Option<&str>) -> Option<String> {
        self.last_authorization_header
            .lock()
            .expect("authorization mutex poisoned")
            .replace(format!("Bearer {}", self.descriptor.token));

        let (host_header, socket_addr) = parse_http_endpoint(&self.descriptor.endpoint)?;
        let socket_addr = socket_addr.to_socket_addrs().ok()?.next()?;
        let mut stream =
            TcpStream::connect_timeout(&socket_addr, Duration::from_millis(80)).ok()?;
        stream
            .set_read_timeout(Some(Duration::from_millis(160)))
            .ok()?;
        stream
            .set_write_timeout(Some(Duration::from_millis(80)))
            .ok()?;

        let body = body.unwrap_or("");
        let content_headers = if body.is_empty() {
            String::new()
        } else {
            format!(
                "Content-Type: application/json\r\nContent-Length: {}\r\n",
                body.as_bytes().len()
            )
        };
        let request = format!(
            "{method} {path} HTTP/1.1\r\nHost: {host_header}\r\nAuthorization: Bearer {}\r\n{content_headers}Connection: close\r\n\r\n{body}",
            self.descriptor.token
        );
        stream.write_all(request.as_bytes()).ok()?;

        let mut response = String::new();
        stream.read_to_string(&mut response).ok()?;
        if !response.starts_with("HTTP/1.1 200")
            && !response.starts_with("HTTP/1.0 200")
            && !response.starts_with("HTTP/1.1 201")
            && !response.starts_with("HTTP/1.0 201")
            && !response.starts_with("HTTP/1.1 202")
            && !response.starts_with("HTTP/1.0 202")
        {
            return None;
        }

        response.split("\r\n\r\n").nth(1).map(str::to_string)
    }
}

fn validate_agent_create(request: &AgentCreateRequest) -> Result<(), AgentError> {
    if request.name.trim().is_empty()
        || request.runtime_kind.trim().is_empty()
        || request.node_id.trim().is_empty()
    {
        return Err(AgentError::InvalidAgent);
    }
    normalize_handle(&request.handle)?;
    Ok(())
}

fn normalize_handle(handle: &str) -> Result<String, AgentError> {
    let trimmed = handle.trim().trim_start_matches('@').to_lowercase();
    let valid = !trimmed.is_empty()
        && trimmed.len() <= 32
        && trimmed.chars().all(|character| {
            character.is_ascii_lowercase() || character.is_ascii_digit() || character == '-'
        });
    if valid {
        Ok(format!("@{trimmed}"))
    } else {
        Err(AgentError::InvalidHandle)
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

fn default_agent_workspace(id: &str) -> String {
    format!("{}/agents/{id}", local_data_root())
}

fn local_data_root() -> String {
    let root = env::var("SLEI_DATA_ROOT")
        .or_else(|_| env::var("HOME").map(|home| format!("{home}/.slei")))
        .unwrap_or_else(|_| ".slei".to_string());
    root
}

fn create_local_agent_workspace(agent: &DesktopAgentView) -> Result<(), AgentError> {
    fs::create_dir_all(&agent.docs_path).map_err(AgentError::Io)?;
    fs::write(&agent.memory_path, initial_memory(agent)).map_err(AgentError::Io)?;
    let skills_path = format!("{}/skills", agent.workspace_path);
    fs::create_dir_all(&skills_path).map_err(AgentError::Io)?;
    let skills = default_skill_records(agent);
    for skill in &skills {
        let body = if skill.id == "guide-create" {
            "Trigger when the user asks to create an agent, member, channel, or conversation space.\n".to_string()
        } else {
            default_memory_skill(agent)
        };
        fs::write(&skill.path, body).map_err(AgentError::Io)?;
    }
    let payload = serde_json::to_string_pretty(&skills).map_err(AgentError::Json)?;
    fs::write(format!("{skills_path}/index.json"), payload).map_err(AgentError::Io)?;
    Ok(())
}

fn read_local_agent_skills(agent: &DesktopAgentView) -> Result<Vec<SkillView>, AgentError> {
    let skills_index = format!("{}/skills/index.json", agent.workspace_path);
    match fs::read_to_string(&skills_index) {
        Ok(raw) => serde_json::from_str::<Vec<SkillView>>(&raw).map_err(AgentError::Json),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(default_skill_records(agent)),
        Err(error) => Err(AgentError::Io(error)),
    }
}

fn default_skill_records(agent: &DesktopAgentView) -> Vec<SkillView> {
    let mut skills = vec![SkillView {
        id: "memory".to_string(),
        name: "记忆".to_string(),
        trigger: format!("提及 {} 并使用 remember、learn 或 记住", agent.handle),
        path: format!("{}/skills/memory.skill.md", agent.workspace_path),
    }];
    if agent.agent_kind.as_deref() == Some("guide") {
        skills.insert(
            0,
            SkillView {
                id: "guide-create".to_string(),
                name: "引导创建".to_string(),
                trigger: "识别创建智能体、成员、频道的请求".to_string(),
                path: format!("{}/skills/guide-create.skill.md", agent.workspace_path),
            },
        );
    }
    skills
}

fn canonicalize_agent_path(path: &str) -> Result<PathBuf, AgentPathError> {
    Path::new(path).canonicalize().map_err(AgentPathError::Io)
}

fn open_system_path(path: &Path) -> Result<(), AgentPathError> {
    if env::var("SLEI_DISABLE_SYSTEM_OPEN").as_deref() == Ok("1") {
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    let mut command = {
        let mut command = Command::new("open");
        command.arg(path);
        command
    };

    #[cfg(target_os = "windows")]
    let mut command = {
        let mut command = Command::new("explorer");
        command.arg(path);
        command
    };

    #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
    let mut command = {
        let mut command = Command::new("xdg-open");
        command.arg(path);
        command
    };

    command.status().map_err(AgentPathError::Io).and_then(|status| {
        if status.success() {
            Ok(())
        } else {
            Err(AgentPathError::OpenFailed)
        }
    })
}

fn local_guide_card_from_text(text: &str) -> Option<InteractiveCardView> {
    let lower = text.to_lowercase();
    if (text.contains("创建") || lower.contains("create"))
        && (lower.contains("agent") || text.contains("成员"))
    {
        let name = regex_named_value(text).unwrap_or_else(|| if lower.contains("qa") { "Nancy".to_string() } else { "Coda".to_string() });
        return Some(InteractiveCardView {
            id: format!("card_{}", monotonic_id()),
            kind: "createAgent".to_string(),
            state: "pending".to_string(),
            title: "创建智能体草案".to_string(),
            summary: format!("{name} · ClaudeCode / Sonnet"),
            draft: serde_json::json!({
                "name": name,
                "handle": format!("@{}", name.to_lowercase()),
                "runtimeKind": "ClaudeCode",
                "model": "Sonnet",
                "nodeId": "local-node",
                "description": if lower.contains("qa") { "QA 质保员，负责审查代码质量、安全漏洞，提出改进意见。" } else { "研发团队开发工程师，负责基于任务分解进行实际编码工作。" },
            }),
            action_label: "创建".to_string(),
            done_label: "DONE".to_string(),
        });
    }
    if (text.contains("创建") || lower.contains("create"))
        && (lower.contains("channel") || text.contains("频道"))
    {
        let name = regex_named_value(text)
            .unwrap_or_else(|| "dev-team".to_string())
            .trim_start_matches('#')
            .to_string();
        return Some(InteractiveCardView {
            id: format!("card_{}", monotonic_id()),
            kind: "createChannel".to_string(),
            state: "pending".to_string(),
            title: "创建频道草案".to_string(),
            summary: format!("#{name}"),
            draft: serde_json::json!({
                "name": name,
                "description": "团队会话频道",
            }),
            action_label: "创建".to_string(),
            done_label: "DONE".to_string(),
        });
    }
    None
}

fn regex_named_value(text: &str) -> Option<String> {
    for marker in ["叫", "名为", "named", "called"] {
        if let Some((_, tail)) = text.split_once(marker) {
            let value = tail
                .split_whitespace()
                .next()
                .unwrap_or("")
                .trim_matches(|ch: char| ch == ',' || ch == '，')
                .to_string();
            if !value.is_empty() {
                return Some(value);
            }
        }
    }
    None
}

fn append_local_agent_memory(agent: &DesktopAgentView, fact: &str) -> Result<(), AgentError> {
    let mut memory = fs::read_to_string(&agent.memory_path).map_err(AgentError::Io)?;
    let line = format!("\n- {}\n", fact.trim().trim_start_matches("记住："));
    if let Some(index) = memory.find("## Active Context") {
        memory.insert_str(index, &line);
    } else {
        memory.push_str("\n## Key Knowledge\n");
        memory.push_str(&line);
    }
    fs::write(&agent.memory_path, memory).map_err(AgentError::Io)?;
    Ok(())
}

fn initial_memory(agent: &DesktopAgentView) -> String {
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
"#,
        name = agent.name,
        description = agent.description,
        handle = agent.handle
    )
}

fn default_memory_skill(agent: &DesktopAgentView) -> String {
    format!(
        "Trigger when a user mentions {} and asks this agent to remember, learn, or 记住 something.\n",
        agent.handle
    )
}

fn monotonic_id() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos().to_string())
        .unwrap_or_else(|_| "0".to_string())
}

fn parse_http_endpoint(endpoint: &str) -> Option<(String, String)> {
    let without_scheme = endpoint.strip_prefix("http://")?;
    let host_port = without_scheme.split('/').next()?.to_string();
    Some((host_port.clone(), host_port))
}

fn detect_device_meta() -> DeviceMetaView {
    DeviceMetaView {
        platform: env::consts::OS.to_string(),
        os_version: command_output("sw_vers", &["-productVersion"])
            .or_else(|| command_output("uname", &["-r"]))
            .unwrap_or_else(|| "unknown".to_string()),
        arch: env::consts::ARCH.to_string(),
        hostname: command_output("hostname", &[]).unwrap_or_else(|| "local-device".to_string()),
    }
}

fn detect_claude_runtime() -> RuntimeReadinessView {
    let version = env::var("SLEI_CLAUDE_VERSION_OVERRIDE")
        .ok()
        .or_else(|| command_output("claude", &["--version"]));

    RuntimeReadinessView {
        kind: "ClaudeCode".to_string(),
        readiness: if version.is_some() {
            "ready"
        } else {
            "unavailable"
        }
        .to_string(),
        version: version.and_then(|output| parse_claude_version(&output)),
    }
}

fn parse_claude_version(output: &str) -> Option<String> {
    output
        .split_whitespace()
        .find(|part| part.chars().any(|ch| ch.is_ascii_digit()) && part.contains('.'))
        .map(|part| {
            part.trim_matches(|ch: char| ch == ',' || ch == ';')
                .to_string()
        })
}

fn command_output(program: &str, args: &[&str]) -> Option<String> {
    let output = Command::new(program).args(args).output().ok()?;
    if !output.status.success() {
        return None;
    }

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    (!stdout.is_empty()).then_some(stdout)
}

fn load_local_conversations() -> Vec<ConversationView> {
    fs::read_to_string(format!("{}/conversations/index.json", local_data_root()))
        .ok()
        .and_then(|raw| serde_json::from_str::<Vec<ConversationView>>(&raw).ok())
        .unwrap_or_default()
}

fn persist_local_conversations(
    conversations: &[ConversationView],
) -> Result<(), ConversationError> {
    let path = format!("{}/conversations/index.json", local_data_root());
    if let Some(parent) = std::path::Path::new(&path).parent() {
        fs::create_dir_all(parent).map_err(ConversationError::Io)?;
    }
    let mut ordered = conversations.to_vec();
    ordered.sort_by(|left, right| left.created_at.cmp(&right.created_at));
    let payload = serde_json::to_string_pretty(&ordered).map_err(ConversationError::Json)?;
    fs::write(path, payload).map_err(ConversationError::Io)
}

fn load_all_local_conversation_messages() -> Vec<ConversationMessageView> {
    let root = local_data_root();
    load_local_conversations()
        .iter()
        .flat_map(|conversation| load_local_conversation_messages_at_root(&root, &conversation.id))
        .collect()
}

fn default_preferences() -> UserPreferencesView {
    UserPreferencesView {
        locale: "zh-CN".to_string(),
        time_zone: "Asia/Shanghai".to_string(),
        appearance: AppearancePreferencesView {
            theme: "system".to_string(),
            font_size: "md".to_string(),
        },
        notifications: NotificationPreferencesView {
            mentions: true,
            human_replies: true,
            approvals: true,
        },
    }
}

fn load_local_preferences() -> UserPreferencesView {
    fs::read_to_string(format!("{}/settings/preferences.json", local_data_root()))
        .ok()
        .and_then(|raw| serde_json::from_str::<UserPreferencesView>(&raw).ok())
        .filter(|preferences| matches!(preferences.locale.as_str(), "zh-CN" | "en-US"))
        .unwrap_or_else(default_preferences)
}

fn persist_local_preferences(preferences: &UserPreferencesView) -> Result<(), PreferencesError> {
    let path = format!("{}/settings/preferences.json", local_data_root());
    if let Some(parent) = std::path::Path::new(&path).parent() {
        fs::create_dir_all(parent).map_err(PreferencesError::Io)?;
    }
    let payload = serde_json::to_string_pretty(preferences).map_err(PreferencesError::Json)?;
    fs::write(path, payload).map_err(PreferencesError::Io)
}

fn load_local_conversation_messages_at_root(
    root: &str,
    conversation_id: &str,
) -> Vec<ConversationMessageView> {
    fs::read_to_string(format!(
        "{root}/conversations/messages/{}.json",
        safe_conversation_id(conversation_id)
    ))
    .ok()
    .and_then(|raw| serde_json::from_str::<Vec<ConversationMessageView>>(&raw).ok())
    .unwrap_or_default()
}

fn persist_local_conversation_messages(
    conversation_id: &str,
    messages: &[ConversationMessageView],
) -> Result<(), ConversationError> {
    let path = format!(
        "{}/conversations/messages/{}.json",
        local_data_root(),
        safe_conversation_id(conversation_id)
    );
    if let Some(parent) = std::path::Path::new(&path).parent() {
        fs::create_dir_all(parent).map_err(ConversationError::Io)?;
    }
    let conversation_messages = messages
        .iter()
        .filter(|message| message.conversation_id == conversation_id)
        .cloned()
        .collect::<Vec<_>>();
    let payload =
        serde_json::to_string_pretty(&conversation_messages).map_err(ConversationError::Json)?;
    fs::write(path, payload).map_err(ConversationError::Io)
}

fn safe_conversation_id(conversation_id: &str) -> String {
    conversation_id.replace(':', "_").replace('/', "_")
}

#[derive(Debug, thiserror::Error)]
pub enum ArtifactOpenError {
    #[error("artifact id is required")]
    ArtifactIdRequired,
}

#[derive(Debug, thiserror::Error)]
pub enum NodeNameError {
    #[error("node name is required")]
    NameRequired,
    #[error("node name must be 64 characters or fewer")]
    NameTooLong,
}

#[derive(Debug, thiserror::Error)]
pub enum PreferencesError {
    #[error("locale must be zh-CN or en-US")]
    InvalidLocale,
    #[error("time zone is invalid")]
    InvalidTimeZone,
    #[error("appearance preference is invalid")]
    InvalidAppearance,
    #[error("preferences io error: {0}")]
    Io(std::io::Error),
    #[error("preferences json error: {0}")]
    Json(serde_json::Error),
}

#[derive(Debug, thiserror::Error)]
pub enum AgentError {
    #[error("agent not found")]
    AgentNotFound,
    #[error("agent name, runtime, and node are required")]
    InvalidAgent,
    #[error("agent handle is invalid")]
    InvalidHandle,
    #[error("agent handle already exists")]
    DuplicateHandle,
    #[error("memory fact is required")]
    InvalidMemory,
    #[error("agent workspace io error: {0}")]
    Io(std::io::Error),
    #[error("agent workspace json error: {0}")]
    Json(serde_json::Error),
}

#[derive(Debug, thiserror::Error)]
pub enum AgentPathError {
    #[error("agent not found")]
    AgentNotFound,
    #[error("agent path target is invalid")]
    InvalidTarget,
    #[error("agent path is outside workspace")]
    WorkspaceBoundary,
    #[error("system open failed")]
    OpenFailed,
    #[error("agent path io error: {0}")]
    Io(std::io::Error),
}

#[derive(Debug, thiserror::Error)]
pub enum ChannelError {
    #[error("invalid channel")]
    InvalidChannel,
}

#[derive(Debug, thiserror::Error)]
pub enum CardError {
    #[error("card not found")]
    CardNotFound,
}

#[derive(Debug, thiserror::Error)]
pub enum ConversationError {
    #[error("agent not found")]
    AgentNotFound,
    #[error("conversation not found")]
    ConversationNotFound,
    #[error("invalid conversation")]
    InvalidConversation,
    #[error("invalid message")]
    InvalidMessage,
    #[error("conversation io error: {0}")]
    Io(std::io::Error),
    #[error("conversation json error: {0}")]
    Json(serde_json::Error),
}
