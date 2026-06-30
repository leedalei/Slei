use crate::adapters::claude_worker::ClaudeWorkerAdapter;
use crate::adapters::worker_rpc::WorkerTransport;
use crate::auth::AuthToken;
use crate::services::agent_dm_service::{AgentDmRunStore, AgentDmService};
use crate::services::agent_inbox_service::AgentInboxService;
use crate::services::agent_message_todo_service::AgentMessageTodoService;
use crate::services::card_service::CardService;
use crate::services::channel_join_report_service::ChannelJoinReportService;
use crate::services::channel_orchestrator_service::ChannelOrchestratorService;
use crate::services::channel_service::ChannelService;
use crate::services::claim_service::ClaimService;
use crate::services::conversation_service::ConversationService;
use crate::services::event_service::EventService;
use crate::services::member_service::MemberService;
use crate::services::memory_event_service::MemoryEventService;
use crate::services::memory_maintainer_service::{MemoryMaintainerError, MemoryMaintainerService};
use crate::services::message_service::MessageService;
use crate::services::message_thread_service::MessageThreadService;
use crate::services::node_service::NodeService;
use crate::services::orchestration_store::OrchestrationStore;
use crate::services::reset_service::{ResetRuntimeState, ResetService};
use crate::services::saved_message_service::SavedMessageService;
use crate::services::search_service::SearchService;
use crate::services::settings_service::SettingsService;
use crate::services::task_service::TaskService;
use crate::services::workspace_service::WorkspaceService;
use serde_json::Value;
use slei_storage::db::SleiDb;
use slei_storage::repositories::{NodeRow, Repositories};
use std::path::PathBuf;

#[derive(Clone, Debug)]
pub struct AppState {
    pub auth_token: AuthToken,
    pub daemon_version: &'static str,
    pub protocol_version: &'static str,
    data_root: PathBuf,
    node_service: NodeService,
    member_service: MemberService,
    channel_service: ChannelService,
    card_service: CardService,
    conversation_service: ConversationService,
    workspace_service: WorkspaceService,
    event_service: EventService,
    settings_service: SettingsService,
    task_service: TaskService,
    agent_message_todos: AgentMessageTodoService,
    claims: ClaimService,
    orchestration_store: OrchestrationStore,
    agent_inbox_service: AgentInboxService,
    memory_event_service: MemoryEventService,
    memory_maintainer_service: MemoryMaintainerService,
    channel_join_report_service: ChannelJoinReportService,
    message_service: MessageService,
    message_thread_service: MessageThreadService,
    channel_orchestrator_service: ChannelOrchestratorService,
    search_service: SearchService,
    saved_message_service: SavedMessageService,
    reset_service: ResetService,
    reset_runtime: ResetRuntimeState,
    worker: ClaudeWorkerAdapter,
    worker_transport: WorkerTransport,
    agent_dm_runs: AgentDmRunStore,
}

impl AppState {
    pub fn for_desktop(auth_token: AuthToken) -> Self {
        let data_root = default_data_root();
        let (repos, local_node) = repositories_blocking(data_root.clone());
        let orchestration_store = OrchestrationStore::new(repos.clone());
        let state = Self::with_agent_root_and_store(
            auth_token,
            data_root.clone(),
            repos.clone(),
            local_node,
            orchestration_store,
            MessageService::persistent(repos),
        );
        if let Ok(handle) = tokio::runtime::Handle::try_current() {
            let event_state = state.clone();
            state.worker_transport.configure_local_runner(
                default_local_runner_path(),
                move |event| {
                    let event_state = event_state.clone();
                    handle.spawn(async move {
                        if let Err(error) = event_state.handle_worker_event(event).await {
                            eprintln!("slei worker event failed: {error}");
                        }
                    });
                },
            );
        }
        state
    }

    pub fn for_tests(auth_token: AuthToken) -> Self {
        Self::for_tests_with_agent_root(
            auth_token,
            std::env::temp_dir().join(format!("slei-app-tests-{}", uuid::Uuid::new_v4())),
        )
    }

    pub fn for_tests_with_agent_root(auth_token: AuthToken, agent_data_root: PathBuf) -> Self {
        let (repos, local_node) = repositories_blocking(agent_data_root.clone());
        let orchestration_store = OrchestrationStore::new(repos.clone());
        Self::for_tests_with_agent_root_and_store(
            auth_token,
            agent_data_root,
            repos,
            local_node,
            orchestration_store,
        )
    }

    pub async fn for_tests_with_agent_root_async(
        auth_token: AuthToken,
        agent_data_root: PathBuf,
    ) -> Self {
        let (repos, local_node) = repositories_for_data_root(agent_data_root.clone()).await;
        let orchestration_store = OrchestrationStore::new(repos.clone());
        Self::for_tests_with_agent_root_and_store(
            auth_token,
            agent_data_root,
            repos,
            local_node,
            orchestration_store,
        )
    }

    fn for_tests_with_agent_root_and_store(
        auth_token: AuthToken,
        agent_data_root: PathBuf,
        repos: Repositories,
        local_node: Option<NodeRow>,
        orchestration_store: OrchestrationStore,
    ) -> Self {
        Self::with_agent_root_and_store(
            auth_token,
            agent_data_root,
            repos.clone(),
            local_node,
            orchestration_store,
            MessageService::persistent(repos),
        )
    }

    fn with_agent_root_and_store(
        auth_token: AuthToken,
        agent_data_root: PathBuf,
        repos: Repositories,
        local_node: Option<NodeRow>,
        orchestration_store: OrchestrationStore,
        message_service: MessageService,
    ) -> Self {
        let event_service = EventService::new();
        let data_root = agent_data_root.clone();
        let worker_transport = WorkerTransport::fake();
        let worker = ClaudeWorkerAdapter::new(worker_transport.clone());
        let reset_runtime = ResetRuntimeState::default();
        let agent_dm_runs = AgentDmRunStore::default();
        let node_service = NodeService::new(repos.clone(), local_node);
        let member_service =
            MemberService::for_tests_with_data_root_and_repos(agent_data_root, repos.clone());
        let channel_service = ChannelService::new(repos.clone());
        let card_service = CardService::new(repos.clone());
        let conversation_service = ConversationService::new(repos.clone(), data_root.clone());
        let workspace_service = WorkspaceService::new(event_service.clone());
        let settings_service = SettingsService::new(repos.clone());
        let agent_inbox_service = AgentInboxService::new(orchestration_store.clone());
        let memory_event_service = MemoryEventService::new(orchestration_store.clone());
        let task_service = TaskService::new(repos.clone());
        let agent_message_todos = AgentMessageTodoService::new(repos.clone());
        let message_thread_service = MessageThreadService::new(
            repos.clone(),
            message_service.clone(),
            conversation_service.clone(),
        );
        let claims = ClaimService::new(repos.clone());
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
            card_service.clone(),
            task_service.clone(),
            message_thread_service.clone(),
            claims.clone(),
            agent_message_todos.clone(),
            agent_inbox_service.clone(),
            event_service.clone(),
            orchestration_store.clone(),
            member_service.clone(),
            settings_service.clone(),
            worker.clone(),
            reset_runtime.clone(),
        );
        let search_service = SearchService::new(repos.clone());
        let saved_message_service = SavedMessageService::new(repos.clone());
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
            data_root,
            node_service,
            member_service,
            channel_service,
            card_service,
            conversation_service,
            workspace_service,
            event_service,
            settings_service,
            task_service,
            agent_message_todos,
            claims,
            orchestration_store,
            agent_inbox_service,
            memory_event_service,
            memory_maintainer_service,
            channel_join_report_service,
            message_service,
            message_thread_service,
            channel_orchestrator_service,
            search_service,
            saved_message_service,
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

    pub fn data_root(&self) -> &PathBuf {
        &self.data_root
    }

    pub fn tasks(&self) -> &TaskService {
        &self.task_service
    }

    pub fn agent_message_todos(&self) -> AgentMessageTodoService {
        self.agent_message_todos.clone()
    }

    pub fn claims(&self) -> &ClaimService {
        &self.claims
    }

    pub fn orchestration(&self) -> &OrchestrationStore {
        &self.orchestration_store
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

    pub fn message_threads(&self) -> &MessageThreadService {
        &self.message_thread_service
    }

    pub fn channel_orchestrator(&self) -> &ChannelOrchestratorService {
        &self.channel_orchestrator_service
    }

    pub fn search(&self) -> &SearchService {
        &self.search_service
    }

    pub fn saved_messages(&self) -> &SavedMessageService {
        &self.saved_message_service
    }

    pub fn reset(&self) -> &ResetService {
        &self.reset_service
    }

    pub async fn channel_messages_for_tests(
        &self,
        channel_id: &str,
    ) -> Vec<crate::services::message_service::MessageRecord> {
        let mut messages = self.messages().channel_messages_for_tests(channel_id).await;
        for message in &mut messages {
            message.cards = self
                .cards()
                .cards_for_message(&message.id)
                .await
                .unwrap_or_default();
        }
        messages
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
            if let Err(error) = self
                .channel_orchestrator()
                .start_channel_agent_join_report(channel_id, &agent_id)
                .await
            {
                eprintln!(
                    "slei channel join report failed to start: channel_id={channel_id} agent_id={agent_id} error={error}"
                );
            }
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
            self.settings_service.clone(),
            self.worker.clone(),
            self.agent_dm_runs.clone(),
            self.reset_runtime.clone(),
            self.orchestration_store.repos(),
        )
    }

    pub fn worker_commands(&self) -> Vec<Value> {
        self.worker_transport.commands()
    }

    #[doc(hidden)]
    pub fn fail_next_worker_send_for_tests(&self) {
        self.worker_transport.fail_next_send_for_tests();
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
        let handled_by_channel_agent = self
            .channel_orchestrator()
            .handle_channel_agent_worker_event_with_launch_guard(event.clone(), &activity_guard)
            .await
            .map_err(|error| error.to_string())?;
        if !handled_by_channel_agent {
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

fn default_local_runner_path() -> PathBuf {
    if let Ok(path) = std::env::var("SLEI_CLAUDE_AGENT_RUNNER") {
        return PathBuf::from(path);
    }
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(std::path::Path::parent)
        .map(|repo_root| repo_root.join("workers/claude-agent/dist/local-runner.js"))
        .unwrap_or_else(|| PathBuf::from("workers/claude-agent/dist/local-runner.js"))
}

async fn repositories_for_data_root(data_root: PathBuf) -> (Repositories, Option<NodeRow>) {
    std::fs::create_dir_all(&data_root).expect("create data root");
    let database_url = format!("sqlite://{}", data_root.join("slei.sqlite").display());
    let db = SleiDb::connect(&database_url)
        .await
        .expect("connect application db");
    db.migrate().await.expect("migrate application db");
    let repos = Repositories::new(db.pool().clone());
    repos
        .seed_default_agent_role_presets()
        .await
        .expect("seed agent role presets");
    let local_node = repos.node("local-node").await.expect("load local node");
    (repos, local_node)
}

fn repositories_blocking(data_root: PathBuf) -> (Repositories, Option<NodeRow>) {
    std::thread::spawn(move || {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("create storage runtime");
        runtime.block_on(repositories_for_data_root(data_root))
    })
    .join()
    .expect("initialize repositories")
}
