use crate::adapters::claude_worker::ClaudeWorkerAdapter;
use crate::adapters::worker_rpc::WorkerTransport;
use crate::auth::AuthToken;
use crate::services::agent_dm_service::{AgentDmRunStore, AgentDmService};
use crate::services::agent_inbox_service::AgentInboxService;
use crate::services::card_service::CardService;
use crate::services::channel_join_report_service::ChannelJoinReportService;
use crate::services::channel_orchestrator_service::ChannelOrchestratorService;
use crate::services::channel_service::ChannelService;
use crate::services::conversation_service::ConversationService;
use crate::services::coordinator_service::CoordinatorService;
use crate::services::event_service::EventService;
use crate::services::member_service::MemberService;
use crate::services::memory_event_service::MemoryEventService;
use crate::services::memory_maintainer_service::{MemoryMaintainerError, MemoryMaintainerService};
use crate::services::message_service::MessageService;
use crate::services::node_service::NodeService;
use crate::services::orchestration_store::OrchestrationStore;
use crate::services::reset_service::{ResetRuntimeState, ResetService};
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
    coordinator_service: CoordinatorService,
    agent_inbox_service: AgentInboxService,
    memory_event_service: MemoryEventService,
    memory_maintainer_service: MemoryMaintainerService,
    channel_join_report_service: ChannelJoinReportService,
    message_service: MessageService,
    channel_orchestrator_service: ChannelOrchestratorService,
    reset_service: ResetService,
    reset_runtime: ResetRuntimeState,
    worker: ClaudeWorkerAdapter,
    worker_transport: WorkerTransport,
    agent_dm_runs: AgentDmRunStore,
}

impl AppState {
    pub fn for_desktop(auth_token: AuthToken) -> Self {
        let data_root = default_data_root();
        let orchestration_store = orchestration_store_blocking(data_root.clone());
        Self::with_agent_root_and_store(
            auth_token,
            data_root.clone(),
            orchestration_store,
            MessageService::persistent(data_root),
        )
    }

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
        Self::with_agent_root_and_store(
            auth_token,
            agent_data_root,
            orchestration_store,
            MessageService::for_tests(),
        )
    }

    fn with_agent_root_and_store(
        auth_token: AuthToken,
        agent_data_root: PathBuf,
        orchestration_store: OrchestrationStore,
        message_service: MessageService,
    ) -> Self {
        let event_service = EventService::new();
        let data_root = agent_data_root.clone();
        let worker_transport = WorkerTransport::fake();
        let worker = ClaudeWorkerAdapter::new(worker_transport.clone());
        let reset_runtime = ResetRuntimeState::default();
        let agent_dm_runs = AgentDmRunStore::default();
        let node_service = NodeService::for_tests();
        let member_service = MemberService::for_tests_with_data_root(agent_data_root);
        let channel_service = ChannelService::new(data_root.clone());
        let card_service = CardService::new(data_root.clone());
        let conversation_service = ConversationService::new(data_root.clone());
        let workspace_service = WorkspaceService::new(event_service.clone());
        let settings_service = SettingsService::for_tests();
        let coordinator_service = CoordinatorService::new_with_worker_and_reset(
            orchestration_store.clone(),
            worker.clone(),
            reset_runtime.clone(),
        );
        let agent_inbox_service = AgentInboxService::new(orchestration_store.clone());
        let memory_event_service = MemoryEventService::new(orchestration_store.clone());
        let task_service = TaskService::for_tests();
        let memory_maintainer_service = MemoryMaintainerService::new(
            member_service.clone(),
            channel_service.clone(),
            memory_event_service.clone(),
        );
        let channel_join_report_service =
            ChannelJoinReportService::new(member_service.clone(), message_service.clone());
        let channel_orchestrator_service = ChannelOrchestratorService::new(
            message_service.clone(),
            channel_service.clone(),
            coordinator_service.clone(),
            task_service.clone(),
            agent_inbox_service.clone(),
            orchestration_store.clone(),
            member_service.clone(),
            reset_runtime.clone(),
        );
        let reset_service = ResetService::new(
            data_root.clone(),
            orchestration_store.clone(),
            agent_dm_runs.clone(),
            channel_orchestrator_service.clone(),
            channel_service.clone(),
            message_service.clone(),
            conversation_service.clone(),
            task_service.clone(),
            member_service.clone(),
            card_service.clone(),
            settings_service.clone(),
            workspace_service.clone(),
            event_service.clone(),
            agent_inbox_service.clone(),
            memory_event_service.clone(),
            node_service.clone(),
            worker.clone(),
            reset_runtime.clone(),
        );
        Self {
            auth_token,
            daemon_version: env!("CARGO_PKG_VERSION"),
            protocol_version: slei_protocol::PROTOCOL_VERSION,
            node_service,
            member_service,
            channel_service,
            card_service,
            conversation_service,
            workspace_service,
            event_service,
            settings_service,
            task_service,
            orchestration_store,
            coordinator_service,
            agent_inbox_service,
            memory_event_service,
            memory_maintainer_service,
            channel_join_report_service,
            message_service,
            channel_orchestrator_service,
            reset_service,
            reset_runtime,
            worker,
            worker_transport,
            agent_dm_runs,
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

    pub fn coordinator(&self) -> &CoordinatorService {
        &self.coordinator_service
    }

    pub fn agent_inbox(&self) -> &AgentInboxService {
        &self.agent_inbox_service
    }

    pub fn memory_events(&self) -> &MemoryEventService {
        &self.memory_event_service
    }

    pub fn memory_maintainer(&self) -> &MemoryMaintainerService {
        &self.memory_maintainer_service
    }

    pub fn channel_join_reports(&self) -> &ChannelJoinReportService {
        &self.channel_join_report_service
    }

    pub fn messages(&self) -> &MessageService {
        &self.message_service
    }

    pub fn channel_orchestrator(&self) -> &ChannelOrchestratorService {
        &self.channel_orchestrator_service
    }

    pub fn reset(&self) -> &ResetService {
        &self.reset_service
    }

    pub async fn channel_messages_for_tests(
        &self,
        channel_id: &str,
    ) -> Vec<crate::services::message_service::MessageRecord> {
        self.messages().channel_messages_for_tests(channel_id).await
    }

    pub async fn run_channel_join_memory_updates(
        &self,
        channel_id: &str,
    ) -> Result<(), MemoryMaintainerError> {
        let ready_agent_ids = self
            .memory_maintainer()
            .run_pending_channel_join_updates(channel_id)
            .await?;
        for agent_id in ready_agent_ids {
            self.messages()
                .create_agent_channel_message(channel_id, &agent_id, "已就位")
                .await?;
        }
        Ok(())
    }

    pub async fn fail_agent_channel_memory_update(
        &self,
        channel_id: &str,
        agent_id: &str,
    ) -> Result<(), MemoryMaintainerError> {
        self.memory_events().fail_update(agent_id, channel_id).await;
        self.channels()
            .set_member_readiness(
                channel_id,
                agent_id,
                crate::services::channel_service::ChannelMemberReadiness::MemoryFailed,
            )
            .await?;
        Ok(())
    }

    pub fn agent_dm(&self) -> AgentDmService {
        AgentDmService::new(
            self.conversation_service.clone(),
            self.card_service.clone(),
            self.member_service.clone(),
            self.worker.clone(),
            self.agent_dm_runs.clone(),
            self.reset_runtime.clone(),
        )
    }

    pub fn worker_commands(&self) -> Vec<Value> {
        self.worker_transport.commands()
    }

    pub async fn handle_worker_event(&self, event: Value) -> Result<(), String> {
        let activity_guard = match self.reset_runtime.begin_launch().await {
            Ok(guard) => guard,
            Err(_) => return Ok(()),
        };
        if let Some(run_id) = event.get("run_id").and_then(Value::as_str) {
            if self.reset_runtime.should_ignore_worker_event(run_id).await {
                return Ok(());
            }
        }
        let handled_by_coordinator = self
            .channel_orchestrator()
            .handle_coordinator_worker_event_with_launch_guard(event.clone(), &activity_guard)
            .await
            .map_err(|error| error.to_string())?;
        if !handled_by_coordinator {
            self.agent_dm()
                .handle_worker_event_with_launch_guard(event, &activity_guard)
                .await
                .map_err(|error| error.to_string())?;
        }
        Ok(())
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
