use crate::adapters::claude_worker::ClaudeWorkerAdapter;
use crate::adapters::worker_rpc::WorkerTransport;
use crate::auth::AuthToken;
use crate::services::agent_dm_service::{AgentDmRunStore, AgentDmService};
use crate::services::card_service::CardService;
use crate::services::channel_service::ChannelService;
use crate::services::conversation_service::ConversationService;
use crate::services::event_service::EventService;
use crate::services::member_service::MemberService;
use crate::services::node_service::NodeService;
use crate::services::orchestration_store::OrchestrationStore;
use crate::services::settings_service::SettingsService;
use crate::services::task_service::TaskService;
use crate::services::workspace_service::WorkspaceService;
use serde_json::Value;
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
    task_service: TaskService,
    orchestration_store: OrchestrationStore,
    worker_transport: WorkerTransport,
    agent_dm_runs: AgentDmRunStore,
}

impl AppState {
    pub fn for_tests(auth_token: AuthToken) -> Self {
        Self::for_tests_with_agent_root(auth_token, default_data_root())
    }

    pub fn for_tests_with_agent_root(auth_token: AuthToken, agent_data_root: PathBuf) -> Self {
        let orchestration_store = orchestration_store_blocking(agent_data_root.clone());
        Self::for_tests_with_agent_root_and_store(auth_token, agent_data_root, orchestration_store)
    }

    pub async fn for_tests_with_agent_root_async(
        auth_token: AuthToken,
        agent_data_root: PathBuf,
    ) -> Self {
        let orchestration_store = OrchestrationStore::for_data_root(agent_data_root.clone()).await;
        Self::for_tests_with_agent_root_and_store(auth_token, agent_data_root, orchestration_store)
    }

    fn for_tests_with_agent_root_and_store(
        auth_token: AuthToken,
        agent_data_root: PathBuf,
        orchestration_store: OrchestrationStore,
    ) -> Self {
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
            task_service: TaskService::for_tests(),
            orchestration_store,
            worker_transport: WorkerTransport::fake(),
            agent_dm_runs: AgentDmRunStore::default(),
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

    pub fn tasks(&self) -> &TaskService {
        &self.task_service
    }

    pub fn orchestration(&self) -> &OrchestrationStore {
        &self.orchestration_store
    }

    pub fn agent_dm(&self) -> AgentDmService {
        AgentDmService::new(
            self.conversation_service.clone(),
            self.card_service.clone(),
            self.member_service.clone(),
            ClaudeWorkerAdapter::new(self.worker_transport.clone()),
            self.agent_dm_runs.clone(),
        )
    }

    pub fn worker_commands(&self) -> Vec<Value> {
        self.worker_transport.commands()
    }

    pub async fn handle_worker_event(
        &self,
        event: Value,
    ) -> Result<(), crate::services::agent_dm_service::AgentDmError> {
        self.agent_dm().handle_worker_event(event).await
    }
}

fn default_data_root() -> PathBuf {
    std::env::var("SLEI_DATA_ROOT")
        .map(PathBuf::from)
        .or_else(|_| std::env::var("HOME").map(|home| PathBuf::from(home).join(".slei")))
        .unwrap_or_else(|_| PathBuf::from(".slei"))
}

fn orchestration_store_blocking(data_root: PathBuf) -> OrchestrationStore {
    std::thread::spawn(move || {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("create orchestration test runtime");
        runtime.block_on(OrchestrationStore::for_data_root(data_root))
    })
    .join()
    .expect("initialize orchestration store")
}
