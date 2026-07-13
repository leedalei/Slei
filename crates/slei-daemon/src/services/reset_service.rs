use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::Mutex as StdMutex;

use serde::Serialize;
use tokio::sync::{OwnedRwLockReadGuard, OwnedRwLockWriteGuard, RwLock as AsyncRwLock};

use crate::adapters::claude_worker::{ClaudeWorkerAdapter, ClaudeWorkerError};
use crate::services::agent_dm_service::AgentDmRunStore;
use crate::services::agent_inbox_service::AgentInboxService;
use crate::services::card_service::CardService;
use crate::services::channel_orchestrator_service::ChannelOrchestratorService;
use crate::services::channel_service::ChannelService;
use crate::services::conversation_service::ConversationService;
use crate::services::event_service::EventService;
use crate::services::member_service::MemberService;
use crate::services::memory_event_service::MemoryEventService;
use crate::services::message_service::MessageService;
use crate::services::node_service::NodeService;
use crate::services::orchestration_store::OrchestrationStore;
use crate::services::settings_service::SettingsService;
use crate::services::task_service::TaskService;
use crate::services::workspace_service::WorkspaceService;

const DEVELOPMENT_RESET_PATHS: &[&str] = &[
    "agents",
    "channels",
    "conversations",
    "attachments",
    "cards",
    "settings",
    "saved",
];

#[derive(Clone, Debug)]
pub struct ResetService {
    data_root: Arc<PathBuf>,
    orchestration: OrchestrationStore,
    agent_dm_runs: AgentDmRunStore,
    channel_orchestrator: ChannelOrchestratorService,
    channels: ChannelService,
    messages: MessageService,
    conversations: ConversationService,
    tasks: TaskService,
    members: MemberService,
    cards: CardService,
    settings: SettingsService,
    workspaces: WorkspaceService,
    events: EventService,
    agent_inbox: AgentInboxService,
    memory_events: MemoryEventService,
    nodes: NodeService,
    worker: ClaudeWorkerAdapter,
    runtime: ResetRuntimeState,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DevelopmentResetReceipt {
    pub database_reset: bool,
    pub removed_paths: Vec<String>,
    pub remaining_paths: Vec<String>,
}

impl ResetService {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        data_root: PathBuf,
        orchestration: OrchestrationStore,
        agent_dm_runs: AgentDmRunStore,
        channel_orchestrator: ChannelOrchestratorService,
        channels: ChannelService,
        messages: MessageService,
        conversations: ConversationService,
        tasks: TaskService,
        members: MemberService,
        cards: CardService,
        settings: SettingsService,
        workspaces: WorkspaceService,
        events: EventService,
        agent_inbox: AgentInboxService,
        memory_events: MemoryEventService,
        nodes: NodeService,
        worker: ClaudeWorkerAdapter,
        runtime: ResetRuntimeState,
    ) -> Self {
        Self {
            data_root: Arc::new(data_root),
            orchestration,
            agent_dm_runs,
            channel_orchestrator,
            channels,
            messages,
            conversations,
            tasks,
            members,
            cards,
            settings,
            workspaces,
            events,
            agent_inbox,
            memory_events,
            nodes,
            worker,
            runtime,
        }
    }

    pub async fn reset_development_state(&self) -> Result<DevelopmentResetReceipt, ResetError> {
        let guard = self.runtime.begin_reset().await?;
        let result = self.reset_development_state_inner().await;
        guard.finish().await;
        result
    }

    pub fn runtime(&self) -> &ResetRuntimeState {
        &self.runtime
    }

    async fn reset_development_state_inner(&self) -> Result<DevelopmentResetReceipt, ResetError> {
        self.agent_dm_runs
            .cancel_all_for_reset(&self.worker, &self.runtime)
            .await?;
        self.orchestration.repos().reset_mutable_state().await?;
        self.clear_process_local_state().await;

        let mut removed_paths = Vec::new();
        let mut remaining_paths = Vec::new();
        for relative_path in DEVELOPMENT_RESET_PATHS {
            let path = self.data_root.join(relative_path);
            if path.exists() {
                remove_path(&path)?;
                removed_paths.push((*relative_path).to_string());
            }
            if path.exists() {
                remaining_paths.push((*relative_path).to_string());
            }
        }
        std::fs::create_dir_all(&*self.data_root)?;

        Ok(DevelopmentResetReceipt {
            database_reset: true,
            removed_paths,
            remaining_paths,
        })
    }

    async fn clear_process_local_state(&self) {
        self.channel_orchestrator.clear_reset_caches();
        self.channels.clear_for_development_reset().await;
        self.messages.clear_for_development_reset();
        self.conversations.clear_for_development_reset().await;
        self.tasks.clear_for_development_reset();
        self.members.clear_for_development_reset().await;
        self.cards.clear_for_development_reset();
        self.settings.clear_for_development_reset().await;
        self.workspaces.clear_for_development_reset().await;
        self.events.clear_for_development_reset().await;
        self.agent_inbox.clear_for_development_reset().await;
        self.memory_events.clear_for_development_reset().await;
        self.nodes.clear_for_development_reset();
    }
}

#[derive(Clone, Debug, Default)]
pub struct ResetRuntimeState {
    inner: Arc<StdMutex<ResetRuntimeInner>>,
    activity_gate: Arc<AsyncRwLock<()>>,
}

#[derive(Debug, Default)]
struct ResetRuntimeInner {
    generation: u64,
    resetting: bool,
    cancelled_run_ids: HashSet<String>,
}

#[derive(Debug)]
pub struct ResetRuntimeGuard {
    token: ResetStateToken,
    _activity_gate: OwnedRwLockWriteGuard<()>,
}

#[derive(Debug)]
pub struct ResetLaunchGuard {
    generation: u64,
    _activity_gate: OwnedRwLockReadGuard<()>,
}

impl ResetRuntimeState {
    pub async fn begin_reset(&self) -> Result<ResetRuntimeGuard, ResetRuntimeError> {
        {
            let mut inner = self.inner.lock().expect("reset runtime state lock");
            if inner.resetting {
                return Err(ResetRuntimeError::ResetInProgress);
            }
            inner.generation = inner.generation.saturating_add(1);
            inner.resetting = true;
            inner.cancelled_run_ids.clear();
        }
        let token = ResetStateToken {
            runtime: self.clone(),
            active: true,
        };
        let activity_gate = self.activity_gate.clone().write_owned().await;
        Ok(ResetRuntimeGuard {
            token,
            _activity_gate: activity_gate,
        })
    }

    pub async fn begin_launch(&self) -> Result<ResetLaunchGuard, ResetRuntimeError> {
        self.ensure_can_launch().await?;
        let activity_gate = self.activity_gate.clone().read_owned().await;
        let generation = self.ensure_can_launch().await?;
        Ok(ResetLaunchGuard {
            generation,
            _activity_gate: activity_gate,
        })
    }

    pub async fn ensure_can_launch(&self) -> Result<u64, ResetRuntimeError> {
        let inner = self.inner.lock().expect("reset runtime state lock");
        if inner.resetting {
            return Err(ResetRuntimeError::ResetInProgress);
        }
        Ok(inner.generation)
    }

    pub async fn mark_cancelled_run(&self, run_id: &str) {
        self.inner
            .lock()
            .expect("reset runtime state lock")
            .cancelled_run_ids
            .insert(run_id.to_string());
    }

    pub async fn mark_cancelled_runs<I>(&self, run_ids: I)
    where
        I: IntoIterator<Item = String>,
    {
        let mut inner = self.inner.lock().expect("reset runtime state lock");
        inner.cancelled_run_ids.extend(run_ids);
    }

    pub async fn should_ignore_worker_event(&self, run_id: &str) -> bool {
        let inner = self.inner.lock().expect("reset runtime state lock");
        inner.resetting || inner.cancelled_run_ids.contains(run_id)
    }

    pub async fn is_stale_generation(&self, generation: u64) -> bool {
        self.inner
            .lock()
            .expect("reset runtime state lock")
            .generation
            != generation
    }

    fn clear_resetting(&self) {
        self.inner
            .lock()
            .expect("reset runtime state lock")
            .resetting = false;
    }
}

impl ResetRuntimeGuard {
    pub async fn finish(mut self) {
        self.token.finish();
    }
}

impl ResetLaunchGuard {
    pub fn generation(&self) -> u64 {
        self.generation
    }
}

#[derive(Debug)]
struct ResetStateToken {
    runtime: ResetRuntimeState,
    active: bool,
}

impl ResetStateToken {
    fn finish(&mut self) {
        if self.active {
            self.runtime.clear_resetting();
            self.active = false;
        }
    }
}

impl Drop for ResetStateToken {
    fn drop(&mut self) {
        self.finish();
    }
}

#[derive(Debug, thiserror::Error)]
pub enum ResetRuntimeError {
    #[error("reset in progress; runtime launches are temporarily disabled")]
    ResetInProgress,
}

fn remove_path(path: &std::path::Path) -> Result<(), std::io::Error> {
    if path.is_dir() {
        std::fs::remove_dir_all(path)
    } else {
        std::fs::remove_file(path)
    }
}

#[derive(Debug, thiserror::Error)]
pub enum ResetError {
    #[error(transparent)]
    Runtime(#[from] ResetRuntimeError),
    #[error(transparent)]
    Worker(#[from] ClaudeWorkerError),
    #[error(transparent)]
    Storage(#[from] sqlx::Error),
    #[error(transparent)]
    Io(#[from] std::io::Error),
}
