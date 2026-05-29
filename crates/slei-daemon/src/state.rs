use crate::auth::AuthToken;
use crate::services::card_service::CardService;
use crate::services::channel_service::ChannelService;
use crate::services::conversation_service::ConversationService;
use crate::services::event_service::EventService;
use crate::services::member_service::MemberService;
use crate::services::node_service::NodeService;
use crate::services::settings_service::SettingsService;
use crate::services::workspace_service::WorkspaceService;
use std::path::PathBuf;

#[derive(Clone, Debug)]
pub struct AppState {
    pub auth_token: AuthToken,
    pub daemon_version: &'static str,
    pub protocol_version: &'static str,
    node_service: NodeService,
    member_service: MemberService,
    channel_service: ChannelService,
    card_service: CardService,
    conversation_service: ConversationService,
    workspace_service: WorkspaceService,
    event_service: EventService,
    settings_service: SettingsService,
}

impl AppState {
    pub fn for_tests(auth_token: AuthToken) -> Self {
        Self::for_tests_with_agent_root(auth_token, default_data_root())
    }

    pub fn for_tests_with_agent_root(auth_token: AuthToken, agent_data_root: PathBuf) -> Self {
        let event_service = EventService::new();
        let data_root = agent_data_root.clone();
        Self {
            auth_token,
            daemon_version: env!("CARGO_PKG_VERSION"),
            protocol_version: slei_protocol::PROTOCOL_VERSION,
            node_service: NodeService::for_tests(),
            member_service: MemberService::for_tests_with_data_root(agent_data_root),
            channel_service: ChannelService::new(data_root.clone()),
            card_service: CardService::new(data_root.clone()),
            conversation_service: ConversationService::new(data_root),
            workspace_service: WorkspaceService::new(event_service.clone()),
            event_service,
            settings_service: SettingsService::for_tests(),
        }
    }

    pub fn nodes(&self) -> &NodeService {
        &self.node_service
    }

    pub fn members(&self) -> &MemberService {
        &self.member_service
    }

    pub fn channels(&self) -> &ChannelService {
        &self.channel_service
    }

    pub fn cards(&self) -> &CardService {
        &self.card_service
    }

    pub fn conversations(&self) -> &ConversationService {
        &self.conversation_service
    }

    pub fn workspaces(&self) -> &WorkspaceService {
        &self.workspace_service
    }

    pub fn events(&self) -> &EventService {
        &self.event_service
    }

    pub fn settings(&self) -> &SettingsService {
        &self.settings_service
    }
}

fn default_data_root() -> PathBuf {
    std::env::var("SLEI_DATA_ROOT")
        .map(PathBuf::from)
        .or_else(|_| std::env::var("HOME").map(|home| PathBuf::from(home).join(".slei")))
        .unwrap_or_else(|_| PathBuf::from(".slei"))
}
