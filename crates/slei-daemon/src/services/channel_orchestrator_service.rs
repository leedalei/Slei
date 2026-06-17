use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};
use tokio::sync::Mutex as AsyncMutex;

use serde::Serialize;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::adapters::claude_worker::{
    ClaudeWorkerAdapter, ClaudeWorkerError, CreateSessionRequest,
};
use crate::services::agent_inbox_service::AgentInboxService;
use crate::services::agent_prompt_service::{build_agent_system_prompt, AgentSystemPromptInput};
use crate::services::card_service::{CardError, CardService};
use crate::services::channel_service::{
    ChannelError, ChannelMemberReadiness, ChannelMemberRecord, ChannelService,
};
use crate::services::claim_service::{ClaimError, ClaimService};
use crate::services::coordinator_service::{
    build_coordinator_prompt, parse_and_validate_coordinator_json, CoordinatorDecision,
    CoordinatorDecisionError, CoordinatorPromptInput, CoordinatorPromptMember,
    CoordinatorRuntimeInput, CoordinatorService, WorkspaceMount,
};
use crate::services::member_service::{is_internal_coordinator_id, MemberError, MemberService};
use crate::services::message_service::{MessageError, MessageKind, MessageRecord, MessageService};
use crate::services::orchestration_store::OrchestrationStore;
use crate::services::reset_service::{ResetLaunchGuard, ResetRuntimeError, ResetRuntimeState};
use crate::services::task_service::{
    thread_message_for_reply, TaskError, TaskRecord, TaskService, TaskStatus, TaskThreadMessage,
};
use slei_storage::repositories::{sanitize_activity_payload_preview, NewAgentActivityEventRow};

#[derive(Clone, Debug)]
pub struct SendChannelMessageInput {
    pub channel_id: String,
    pub author_id: String,
    pub body: String,
    pub idempotency_key: String,
    pub as_task: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SendChannelMessageOutcome {
    pub message_id: String,
    pub action: String,
    pub task_id: Option<String>,
    pub assignee_agent_id: Option<String>,
    pub assignee_agent_ids: Vec<String>,
    pub coordinator_run_id: Option<String>,
    pub decision_status: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskReplyRoute {
    pub handoff_agent_ids: Vec<String>,
    pub needs_assignment: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskReplyReceipt {
    pub reply: TaskThreadMessage,
    pub route: TaskReplyRoute,
}

#[derive(Clone, Debug)]
struct ResolvedCoordinatorDecision {
    action: String,
    assignee_agent_id: Option<String>,
    assignee_agent_ids: Vec<String>,
    coordinator_run_id: Option<String>,
    decision_status: Option<String>,
}

#[derive(Clone, Debug)]
pub struct ChannelOrchestratorService {
    messages: MessageService,
    channels: ChannelService,
    coordinator: CoordinatorService,
    cards: CardService,
    tasks: TaskService,
    claims: ClaimService,
    agent_inbox: AgentInboxService,
    orchestration: OrchestrationStore,
    members: MemberService,
    worker: ClaudeWorkerAdapter,
    reset_runtime: ResetRuntimeState,
    outcome_idempotency: Arc<Mutex<HashMap<String, SendChannelMessageOutcome>>>,
    send_lock: Arc<AsyncMutex<()>>,
    channel_agent_runs: Arc<AsyncMutex<HashMap<String, ChannelAgentRunRecord>>>,
}

#[derive(Clone, Debug)]
struct ChannelAgentRunRecord {
    channel_id: String,
    session_id: Option<String>,
    agent_id: String,
    source_message_id: String,
    task_id: Option<String>,
    suppress_visible_output: bool,
    output: String,
}

impl ChannelOrchestratorService {
    pub fn new(
        messages: MessageService,
        channels: ChannelService,
        coordinator: CoordinatorService,
        cards: CardService,
        tasks: TaskService,
        claims: ClaimService,
        agent_inbox: AgentInboxService,
        orchestration: OrchestrationStore,
        members: MemberService,
        worker: ClaudeWorkerAdapter,
        reset_runtime: ResetRuntimeState,
    ) -> Self {
        Self {
            messages,
            channels,
            coordinator,
            cards,
            tasks,
            claims,
            agent_inbox,
            orchestration,
            members,
            worker,
            reset_runtime,
            outcome_idempotency: Arc::new(Mutex::new(HashMap::new())),
            send_lock: Arc::new(AsyncMutex::new(())),
            channel_agent_runs: Arc::new(AsyncMutex::new(HashMap::new())),
        }
    }

    pub async fn send_channel_message(
        &self,
        input: SendChannelMessageInput,
    ) -> Result<SendChannelMessageOutcome, ChannelOrchestratorError> {
        let launch_guard = self.begin_runtime_launch().await?;
        self.send_channel_message_with_launch_guard(input, &launch_guard)
            .await
    }

    pub async fn send_channel_message_with_launch_guard(
        &self,
        input: SendChannelMessageInput,
        launch_guard: &ResetLaunchGuard,
    ) -> Result<SendChannelMessageOutcome, ChannelOrchestratorError> {
        let _send_guard = self.send_lock.lock().await;
        if let Some(outcome) = self
            .outcome_idempotency
            .lock()
            .expect("channel orchestrator idempotency lock")
            .get(&input.idempotency_key)
            .cloned()
        {
            if outcome.action != "coordinator_pending" {
                return Ok(outcome);
            }
        }
        if input.channel_id == "all" {
            let coordinator = self
                .members
                .ensure_channel_coordinator_agent("all", "all", "local-node")
                .await?;
            self.channels
                .add_agent_to_channel("all", &coordinator.id)
                .await?;
            self.channels
                .set_member_readiness("all", &coordinator.id, ChannelMemberReadiness::Ready)
                .await?;
        }
        self.sync_declared_channel_members(&input.channel_id)
            .await?;

        let active_session = self.channels.active_session(&input.channel_id).await?;
        let message = match self
            .messages
            .channel_message_for_idempotency(&input.idempotency_key)
            .await
        {
            Some(message) => message,
            None => {
                self.channels.channel_members(&input.channel_id).await?;
                self.messages
                    .create_human_channel_message_with_session(
                        &input.channel_id,
                        Some(&active_session.id),
                        &input.author_id,
                        &input.body,
                        &input.idempotency_key,
                        input.as_task,
                    )
                    .await?
            }
        };
        let channel_id = message.channel_id.clone();
        let author_id = message.author_id.clone();
        let channel_members = self.channels.channel_members(&channel_id).await?;

        if message.deleted || message.kind != MessageKind::Human {
            return Err(ChannelOrchestratorError::InactiveIdempotentMessage {
                message_id: message.id,
            });
        }
        let message_body = message.body.clone().ok_or_else(|| {
            ChannelOrchestratorError::InactiveIdempotentMessage {
                message_id: message.id.clone(),
            }
        })?;
        if let Some(decision) = self.existing_decision_for_message(&message.id).await? {
            let run = self
                .orchestration
                .coordinator_runtime_run_for_idempotency(&input.idempotency_key)
                .await?;
            let outcome = self
                .outcome_for_completed_decision(&message.id, decision, run.as_ref())
                .await?;
            self.recover_completed_decision_side_effects(&message, &message_body, &outcome)
                .await?;
            self.outcome_idempotency
                .lock()
                .expect("channel orchestrator idempotency lock")
                .insert(input.idempotency_key, outcome.clone());
            return Ok(outcome);
        }

        if !message.as_task {
            let assignee_agent_ids = self
                .create_broadcast_deliveries_for_members(&message, &channel_members)
                .await?;
            let outcome = SendChannelMessageOutcome {
                message_id: message.id,
                action: "broadcast_delivered".to_string(),
                task_id: None,
                assignee_agent_id: None,
                assignee_agent_ids,
                coordinator_run_id: None,
                decision_status: Some("completed".to_string()),
            };
            self.outcome_idempotency
                .lock()
                .expect("channel orchestrator idempotency lock")
                .insert(input.idempotency_key, outcome.clone());
            return Ok(outcome);
        }

        let readiness_by_agent = channel_members
            .iter()
            .map(|member| (member.agent_id.clone(), member.readiness.clone()))
            .collect::<HashMap<_, _>>();
        let member_ids = readiness_by_agent.keys().cloned().collect::<HashSet<_>>();
        let explicit_agent_ids = self
            .resolve_explicit_mentions(&message_body, &member_ids)
            .await;
        if message.as_task {
            let assignee_agent_id = explicit_agent_ids.first().cloned();
            let task = self
                .ensure_source_task(
                    &message,
                    &message_body,
                    assignee_agent_id.clone(),
                    "user explicitly converted message to task",
                    &format!("{}:explicit-as-task", input.idempotency_key),
                )
                .await?;
            if !explicit_agent_ids.is_empty() {
                let decision_id = Uuid::new_v4();
                let reason = "explicit channel task mention routed without coordinator runtime";
                self.orchestration
                    .record_decision(
                        decision_id,
                        &message.channel_id,
                        &message.id,
                        "task_command",
                        "create_task_and_assign",
                        assignee_agent_id.as_deref(),
                        &explicit_agent_ids,
                        reason,
                    )
                    .await?;
                for agent_id in &explicit_agent_ids {
                    self.create_task_assignment_and_start_once(
                        agent_id,
                        &message.channel_id,
                        &task.id,
                        &message.id,
                        &message_body,
                    )
                    .await?;
                }
                self.persist_routing_context_packages(
                    &decision_id.to_string(),
                    None,
                    &message.channel_id,
                    Some(&message.channel_id),
                    &message.id,
                    &message_body,
                    Some(&task.id),
                    "task_command",
                    "create_task_and_assign",
                    reason,
                    assignee_agent_id.as_deref(),
                    &explicit_agent_ids,
                )
                .await?;
                let outcome = SendChannelMessageOutcome {
                    message_id: message.id,
                    action: "create_task_and_assign".to_string(),
                    task_id: Some(task.id),
                    assignee_agent_id,
                    assignee_agent_ids: explicit_agent_ids,
                    coordinator_run_id: None,
                    decision_status: Some("completed".to_string()),
                };
                self.outcome_idempotency
                    .lock()
                    .expect("channel orchestrator idempotency lock")
                    .insert(input.idempotency_key, outcome.clone());
                return Ok(outcome);
            }
        }

        if !message.as_task && !explicit_agent_ids.is_empty() {
            let decision_id = Uuid::new_v4();
            let assignee_agent_id = explicit_agent_ids.first().cloned();
            let reason = "explicit channel mention routed without coordinator runtime";
            self.orchestration
                .record_decision(
                    decision_id,
                    &message.channel_id,
                    &message.id,
                    "consultation",
                    "request_agent_reply",
                    assignee_agent_id.as_deref(),
                    &explicit_agent_ids,
                    reason,
                )
                .await?;
            for agent_id in &explicit_agent_ids {
                if let Some(readiness) = readiness_by_agent.get(agent_id) {
                    self.create_human_mention_once(
                        agent_id,
                        &message.channel_id,
                        &message.id,
                        readiness.clone(),
                    )
                    .await;
                    self.start_channel_agent_reply_once(
                        agent_id,
                        &message.channel_id,
                        &message.id,
                        &message_body,
                    )
                    .await?;
                }
            }
            self.persist_routing_context_packages(
                &decision_id.to_string(),
                None,
                &message.channel_id,
                Some(&message.channel_id),
                &message.id,
                &message_body,
                None,
                "consultation",
                "request_agent_reply",
                reason,
                assignee_agent_id.as_deref(),
                &explicit_agent_ids,
            )
            .await?;
            let outcome = SendChannelMessageOutcome {
                message_id: message.id,
                action: "request_agent_reply".to_string(),
                task_id: None,
                assignee_agent_id,
                assignee_agent_ids: explicit_agent_ids,
                coordinator_run_id: None,
                decision_status: Some("completed".to_string()),
            };
            self.outcome_idempotency
                .lock()
                .expect("channel orchestrator idempotency lock")
                .insert(input.idempotency_key, outcome.clone());
            return Ok(outcome);
        }

        if let Some(run) = self
            .orchestration
            .coordinator_runtime_run_for_idempotency(&input.idempotency_key)
            .await?
        {
            if run.status == "pending" {
                let task_id = self
                    .tasks
                    .task_for_source_message(&run.message_id)
                    .await
                    .map(|task| task.id);
                return Ok(pending_outcome(run.message_id, run.run_id, task_id));
            }
            return Ok(SendChannelMessageOutcome {
                message_id: run.message_id,
                action: "needs_manual_assignment".to_string(),
                task_id: None,
                assignee_agent_id: None,
                assignee_agent_ids: Vec::new(),
                coordinator_run_id: Some(run.run_id),
                decision_status: Some(run.status),
            });
        }

        let coordinator_input = self
            .coordinator_runtime_input(
                format!("coord_run_{}", Uuid::new_v4().simple()),
                &channel_id,
                &message.id,
                &author_id,
                &message_body,
                &channel_members,
            )
            .await?;
        let prompt = build_coordinator_prompt(CoordinatorPromptInput {
            channel_id: coordinator_input.channel_id.clone(),
            channel_name: coordinator_input.channel_name.clone(),
            message_id: coordinator_input.message_id.clone(),
            author_id: coordinator_input.author_id.clone(),
            body: coordinator_input.body.clone(),
            members: coordinator_input.members.clone(),
            context_refs: coordinator_input.context_refs.clone(),
            workspace_mounts: coordinator_input.workspace_mounts.clone(),
        });
        self.orchestration
            .create_coordinator_runtime_run(
                &coordinator_input.run_id,
                &channel_id,
                &message.id,
                &input.idempotency_key,
                &prompt,
            )
            .await?;
        self.record_coordinator_runtime_diagnostic(
            "coordinator_runtime.created",
            &coordinator_input.run_id,
            &channel_id,
            &message.id,
            format!("prompt_len={}", prompt.len()),
        )
        .await;
        self.record_coordinator_runtime_diagnostic(
            "coordinator_runtime.starting",
            &coordinator_input.run_id,
            &channel_id,
            &message.id,
            format!(
                "workspace_mounts={}",
                coordinator_input.workspace_mounts.len()
            ),
        )
        .await;
        let coordinator_run_id = coordinator_input.run_id.clone();
        let run = match self
            .coordinator
            .start_runtime_run_with_launch_guard(coordinator_input, launch_guard)
            .await
        {
            Ok(run) => run,
            Err(error) => {
                self.record_coordinator_runtime_diagnostic(
                    "coordinator_runtime.start_failed",
                    &coordinator_run_id,
                    &channel_id,
                    &message.id,
                    format!("error={}", error),
                )
                .await;
                let _ = self
                    .orchestration
                    .finish_coordinator_runtime_run(
                        &coordinator_run_id,
                        "failed",
                        Some(&error.to_string()),
                    )
                    .await;
                return Err(error.into());
            }
        };
        self.record_coordinator_runtime_diagnostic(
            "coordinator_runtime.started",
            &run.run_id,
            &channel_id,
            &message.id,
            "worker_run_started".to_string(),
        )
        .await;
        let outcome = pending_outcome(message.id, run.run_id, None);
        let task_id = self
            .tasks
            .task_for_source_message(&outcome.message_id)
            .await
            .map(|task| task.id);
        let outcome = SendChannelMessageOutcome { task_id, ..outcome };
        self.outcome_idempotency
            .lock()
            .expect("channel orchestrator idempotency lock")
            .insert(input.idempotency_key, outcome.clone());
        Ok(outcome)
    }

    pub async fn broadcast_existing_channel_message(
        &self,
        message: &crate::services::message_service::MessageRecord,
    ) -> Result<Vec<String>, ChannelOrchestratorError> {
        if message.channel_id == "all" {
            self.channels.list_channels().await;
        }
        self.sync_declared_channel_members(&message.channel_id)
            .await?;
        let channel_members = self.channels.channel_members(&message.channel_id).await?;
        self.create_broadcast_deliveries_for_members(message, &channel_members)
            .await
    }

    pub async fn add_task_reply(
        &self,
        task_id: &str,
        sender_id: &str,
        body: &str,
        idempotency_key: &str,
    ) -> Result<TaskReplyReceipt, ChannelOrchestratorError> {
        let activity_guard = self.begin_runtime_launch().await?;
        self.add_task_reply_with_launch_guard(
            task_id,
            sender_id,
            body,
            idempotency_key,
            &activity_guard,
        )
        .await
    }

    pub async fn add_task_reply_with_launch_guard(
        &self,
        task_id: &str,
        sender_id: &str,
        body: &str,
        idempotency_key: &str,
        activity_guard: &ResetLaunchGuard,
    ) -> Result<TaskReplyReceipt, ChannelOrchestratorError> {
        self.add_task_reply_with_role_with_launch_guard(
            task_id,
            sender_id,
            None,
            body,
            idempotency_key,
            activity_guard,
        )
        .await
    }

    pub async fn add_task_reply_with_role_with_launch_guard(
        &self,
        task_id: &str,
        sender_id: &str,
        role: Option<&str>,
        body: &str,
        idempotency_key: &str,
        _activity_guard: &ResetLaunchGuard,
    ) -> Result<TaskReplyReceipt, ChannelOrchestratorError> {
        let _send_guard = self.send_lock.lock().await;
        let reply_outcome = self
            .tasks
            .add_reply_with_role(task_id, sender_id, role, body, idempotency_key)
            .await?;
        let reply = reply_outcome.reply;
        let task = self.tasks.task(&reply_outcome.task_id).await?;
        let channel_members = self.channels.channel_members(&task.channel_id).await?;
        let readiness_by_agent = channel_members
            .iter()
            .map(|member| (member.agent_id.clone(), member.readiness.clone()))
            .collect::<HashMap<_, _>>();
        let member_ids = readiness_by_agent.keys().cloned().collect::<HashSet<_>>();
        let explicit_agent_ids = self
            .resolve_explicit_mentions(&reply.body, &member_ids)
            .await;

        let mut handoff_agent_ids = Vec::new();
        for agent_id in explicit_agent_ids {
            if let Some(readiness) = readiness_by_agent.get(&agent_id) {
                let created = self
                    .create_task_handoff_once(
                        &agent_id,
                        &task.channel_id,
                        &task.id,
                        &reply.id,
                        &reply.sender_id,
                        &reply.body,
                        readiness.clone(),
                    )
                    .await;
                handoff_agent_ids.push(agent_id.clone());
                if created {
                    self.start_channel_agent_task_reply_once(
                        &agent_id,
                        &task.channel_id,
                        &reply.id,
                        &task.id,
                        &reply.body,
                        Some("visible @mention handoff"),
                    )
                    .await?;
                    self.update_status_for_created_handoff(&task.id, task.status)
                        .await?;
                }
            }
        }

        let public_reply = thread_message_for_reply(&reply_outcome.task_id, reply);
        let needs_assignment = handoff_agent_ids.is_empty()
            && task.assignee_id.is_none()
            && reply_requires_work(&public_reply.body);
        Ok(TaskReplyReceipt {
            reply: public_reply,
            route: TaskReplyRoute {
                handoff_agent_ids,
                needs_assignment,
            },
        })
    }

    pub async fn start_channel_agent_join_report(
        &self,
        channel_id: &str,
        agent_id: &str,
    ) -> Result<(), ChannelOrchestratorError> {
        let agent = self.members.get_product_agent(agent_id).await?;
        let prompt = format!(
            "你刚完成加入频道 #{channel_id} 的记忆初始化。请根据你当前工作区里的 MEMORY.md 和 notes/channels.md，自主写一条简短入场消息发到频道里。说明你是谁、负责什么、用户或其他成员什么时候应该 mention 你。不要承诺开始无关工作，不要输出 JSON，不要复述这些系统要求。"
        );
        self.start_channel_agent_run_once(
            agent_id,
            channel_id,
            &format!("channel_join:{channel_id}:{agent_id}"),
            &prompt,
            Some(agent),
            None,
            None,
        )
        .await
    }

    pub async fn handle_coordinator_worker_event(
        &self,
        event: Value,
    ) -> Result<bool, ChannelOrchestratorError> {
        let activity_guard = match self.reset_runtime.begin_launch().await {
            Ok(guard) => guard,
            Err(ResetRuntimeError::ResetInProgress) => {
                return Ok(event.get("run_id").and_then(Value::as_str).is_some());
            }
        };
        self.handle_coordinator_worker_event_with_launch_guard(event, &activity_guard)
            .await
    }

    pub(crate) async fn handle_coordinator_worker_event_with_launch_guard(
        &self,
        event: Value,
        _activity_guard: &ResetLaunchGuard,
    ) -> Result<bool, ChannelOrchestratorError> {
        let _send_guard = self.send_lock.lock().await;
        let Some(run_id) = event.get("run_id").and_then(Value::as_str) else {
            return Ok(false);
        };
        if self.reset_runtime.should_ignore_worker_event(run_id).await {
            return Ok(true);
        }
        let Some(run) = self.orchestration.coordinator_runtime_run(run_id).await? else {
            return Ok(false);
        };

        match event.get("type").and_then(Value::as_str) {
            Some("output_delta") => {
                if run.status == "pending" {
                    let delta = event
                        .get("delta")
                        .and_then(Value::as_str)
                        .unwrap_or_default();
                    self.orchestration
                        .append_coordinator_runtime_output(run_id, delta)
                        .await?;
                    self.record_coordinator_runtime_diagnostic(
                        "coordinator_runtime.output_delta",
                        run_id,
                        &run.channel_id,
                        &run.message_id,
                        format!("delta_len={}", delta.len()),
                    )
                    .await;
                }
                Ok(true)
            }
            Some("completed") => {
                if run.status == "pending" {
                    self.record_coordinator_runtime_diagnostic(
                        "coordinator_runtime.completed_event",
                        run_id,
                        &run.channel_id,
                        &run.message_id,
                        "worker_completed".to_string(),
                    )
                    .await;
                    self.complete_coordinator_runtime_run(run_id).await?;
                }
                Ok(true)
            }
            Some("failed") => {
                if run.status == "pending" {
                    let message = event
                        .get("message")
                        .and_then(Value::as_str)
                        .unwrap_or("Coordinator worker failed");
                    self.record_coordinator_runtime_diagnostic(
                        "coordinator_runtime.failed_event",
                        run_id,
                        &run.channel_id,
                        &run.message_id,
                        "worker_failed".to_string(),
                    )
                    .await;
                    self.fail_coordinator_runtime_run(run_id, message).await?;
                }
                Ok(true)
            }
            _ => Ok(true),
        }
    }

    pub(crate) async fn handle_channel_agent_worker_event_with_launch_guard(
        &self,
        event: Value,
        activity_guard: &ResetLaunchGuard,
    ) -> Result<bool, ChannelOrchestratorError> {
        let Some(run_id) = event.get("run_id").and_then(Value::as_str) else {
            return Ok(false);
        };
        if self.reset_runtime.should_ignore_worker_event(run_id).await {
            return Ok(true);
        }
        let event_type = event.get("type").and_then(Value::as_str);
        let mut runs = self.channel_agent_runs.lock().await;
        let Some(record) = runs.get_mut(run_id) else {
            return Ok(false);
        };
        match event_type {
            Some("output_delta") => {
                let delta = event
                    .get("delta")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                record.output.push_str(delta);
                let record = record.clone();
                drop(runs);
                self.record_channel_agent_activity(
                    &record,
                    run_id,
                    "output.delta",
                    "info",
                    format!("输出片段：{} 字符", delta.chars().count()),
                    Some(event.to_string()),
                    None,
                    None,
                )
                .await;
                Ok(true)
            }
            Some("completed") => {
                let record = runs.remove(run_id).expect("channel agent run exists");
                drop(runs);
                let body = record.output.trim();
                self.record_channel_agent_activity(
                    &record,
                    run_id,
                    "run.completed",
                    "info",
                    format!("运行完成：run={run_id}"),
                    Some(event.to_string()),
                    None,
                    Some(true),
                )
                .await;
                let mut visible_output_created = false;
                if !body.is_empty() {
                    if is_channel_join_run(&record.source_message_id) {
                        self.messages
                            .create_agent_channel_message_with_session(
                                &record.channel_id,
                                record.session_id.as_deref(),
                                &record.agent_id,
                                body,
                            )
                            .await?;
                        self.channels
                            .set_member_readiness(
                                &record.channel_id,
                                &record.agent_id,
                                ChannelMemberReadiness::Ready,
                            )
                            .await?;
                        visible_output_created = true;
                    } else if let Some(task_id) = record.task_id.as_deref() {
                        self.add_task_reply_with_launch_guard(
                            task_id,
                            &record.agent_id,
                            body,
                            &format!("channel-agent-run:{run_id}:task-reply"),
                            activity_guard,
                        )
                        .await?;
                        visible_output_created = true;
                    } else if !record.suppress_visible_output {
                        let _ = self
                            .orchestration
                            .record_diagnostic_event(
                                "channel_agent_runtime.output_suppressed",
                                &format!(
                                    "run_id={} agent_id={} channel_id={} source_message_id={}",
                                    run_id,
                                    record.agent_id,
                                    record.channel_id,
                                    record.source_message_id
                                ),
                            )
                            .await;
                    } else {
                        let _ = self
                            .orchestration
                            .record_diagnostic_event(
                                "channel_agent_runtime.broadcast_stdout_suppressed",
                                &format!(
                                    "run_id={} agent_id={} channel_id={} source_message_id={} output_len={} note=visible_replies_require_slei_cli_claim_send",
                                    run_id,
                                    record.agent_id,
                                    record.channel_id,
                                    record.source_message_id,
                                    body.len()
                                ),
                            )
                            .await;
                    }
                }
                if record.suppress_visible_output && record.task_id.is_none() {
                    if let Ok(marked) = self
                        .claims
                        .mark_message_delivery_completed_for_run(
                            &record.source_message_id,
                            &record.agent_id,
                            run_id,
                        )
                        .await
                    {
                        let _ = self
                            .orchestration
                            .record_diagnostic_event(
                                "channel_agent_runtime.delivery_completed",
                                &format!(
                                    "run_id={} agent_id={} channel_id={} source_message_id={} marked={}",
                                    run_id,
                                    record.agent_id,
                                    record.channel_id,
                                    record.source_message_id,
                                    marked
                                ),
                            )
                            .await;
                    }
                }
                let _ = self
                    .orchestration
                    .record_diagnostic_event(
                        "channel_agent_runtime.completed",
                        &format!(
                            "run_id={} agent_id={} channel_id={} source_message_id={} output_len={} visible_output_created={}",
                            run_id,
                            record.agent_id,
                            record.channel_id,
                            record.source_message_id,
                            body.len(),
                            visible_output_created
                        ),
                    )
                    .await;
                Ok(true)
            }
            Some("failed") => {
                let record = runs.remove(run_id).expect("channel agent run exists");
                drop(runs);
                let message = event
                    .get("message")
                    .and_then(Value::as_str)
                    .unwrap_or("Agent runtime failed");
                self.record_channel_agent_activity(
                    &record,
                    run_id,
                    "run.failed",
                    "error",
                    format!("运行失败：{}", activity_summary_message(message)),
                    Some(event.to_string()),
                    None,
                    Some(false),
                )
                .await;
                if is_channel_join_run(&record.source_message_id) {
                    let _ = self
                        .orchestration
                        .record_diagnostic_event(
                            "channel_join_report.failed",
                            &format!(
                                "run_id={} agent_id={} channel_id={} message={}",
                                run_id, record.agent_id, record.channel_id, message
                            ),
                        )
                        .await;
                } else if let Some(task_id) = record.task_id.as_deref() {
                    self.add_task_reply_with_launch_guard(
                        task_id,
                        &record.agent_id,
                        message,
                        &format!("channel-agent-run:{run_id}:task-failed"),
                        activity_guard,
                    )
                    .await?;
                } else if !record.suppress_visible_output {
                    let _ = self
                        .orchestration
                        .record_diagnostic_event(
                            "channel_agent_runtime.failed_output_suppressed",
                            &format!(
                                "run_id={} agent_id={} channel_id={} source_message_id={}",
                                run_id,
                                record.agent_id,
                                record.channel_id,
                                record.source_message_id
                            ),
                        )
                        .await;
                }
                if record.suppress_visible_output && record.task_id.is_none() {
                    if let Ok(marked) = self
                        .claims
                        .mark_message_delivery_failed_for_run(
                            &record.source_message_id,
                            &record.agent_id,
                            run_id,
                        )
                        .await
                    {
                        let _ = self
                            .orchestration
                            .record_diagnostic_event(
                                "channel_agent_runtime.delivery_failed",
                                &format!(
                                    "run_id={} agent_id={} channel_id={} source_message_id={} marked={} message={}",
                                    run_id,
                                    record.agent_id,
                                    record.channel_id,
                                    record.source_message_id,
                                    marked,
                                    diagnostic_token(message)
                                ),
                            )
                            .await;
                    }
                }
                let _ = self
                    .orchestration
                    .record_diagnostic_event(
                        "channel_agent_runtime.failed",
                        &format!(
                            "run_id={} agent_id={} channel_id={} source_message_id={} message={}",
                            run_id,
                            record.agent_id,
                            record.channel_id,
                            record.source_message_id,
                            diagnostic_token(message)
                        ),
                    )
                    .await;
                Ok(true)
            }
            Some("tool_started") => {
                let record = record.clone();
                drop(runs);
                let tool_name = worker_tool_name(&event);
                self.record_channel_agent_activity(
                    &record,
                    run_id,
                    "tool.started",
                    "info",
                    format!("开始执行工具：{tool_name}"),
                    Some(event.to_string()),
                    Some(tool_name.to_string()),
                    None,
                )
                .await;
                Ok(true)
            }
            Some("tool_completed") => {
                let record = record.clone();
                drop(runs);
                let tool_name = worker_tool_name(&event);
                let ok = event.get("ok").and_then(Value::as_bool).unwrap_or(true);
                self.record_channel_agent_activity(
                    &record,
                    run_id,
                    "tool.completed",
                    if ok { "info" } else { "error" },
                    format!("工具完成：{tool_name} ok={ok}"),
                    Some(event.to_string()),
                    Some(tool_name.to_string()),
                    Some(ok),
                )
                .await;
                Ok(true)
            }
            Some("product_tool_requested") => {
                let record = record.clone();
                drop(runs);
                let tool_name = event
                    .get("tool_name")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                self.record_channel_agent_activity(
                    &record,
                    run_id,
                    "tool.started",
                    "info",
                    format!("开始执行工具：{tool_name}"),
                    Some(event.to_string()),
                    Some(tool_name.to_string()),
                    None,
                )
                .await;
                if tool_name != "slei_propose_interactive_card" {
                    return Ok(true);
                }
                let event_agent_id = event
                    .get("agent_id")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                if event_agent_id != record.agent_id {
                    return Ok(true);
                }
                let tool_use_id = event
                    .get("tool_use_id")
                    .and_then(Value::as_str)
                    .unwrap_or("tool");
                let payload = event
                    .get("payload")
                    .ok_or(ChannelOrchestratorError::InvalidWorkerEvent("payload"))?;
                let card = self
                    .cards
                    .propose_product_tool_card(
                        run_id,
                        &record.agent_id,
                        &record.channel_id,
                        payload,
                        &format!("channel-product-tool:{run_id}:{tool_use_id}"),
                    )
                    .await?;
                let message_id = format!("card_message_{}", card.id);
                let card = self.cards.attach_message_id(&card.id, &message_id).await?;
                self.messages
                    .create_agent_card_channel_message_with_session(
                        &record.channel_id,
                        record.session_id.as_deref(),
                        &record.agent_id,
                        &message_id,
                        vec![card.to_view()],
                    )
                    .await?;
                Ok(true)
            }
            _ => Ok(true),
        }
    }

    async fn complete_coordinator_runtime_run(
        &self,
        run_id: &str,
    ) -> Result<(), ChannelOrchestratorError> {
        let Some(run) = self.orchestration.coordinator_runtime_run(run_id).await? else {
            return Ok(());
        };
        if run.status != "pending" {
            return Ok(());
        }
        self.record_coordinator_runtime_diagnostic(
            "coordinator_runtime.completing",
            run_id,
            &run.channel_id,
            &run.message_id,
            format!("output_len={}", run.output.len()),
        )
        .await;
        let message = self.messages.message(&run.message_id).await?;
        let message_body = message.body.clone().ok_or_else(|| {
            ChannelOrchestratorError::InactiveIdempotentMessage {
                message_id: message.id.clone(),
            }
        })?;
        let channel_members = self.channels.channel_members(&message.channel_id).await?;
        let prompt_members = self.prompt_members(&channel_members).await;
        let decision = match parse_and_validate_coordinator_json(&run.output, &prompt_members) {
            Ok(mut decision) => {
                decision.channel_id = message.channel_id.clone();
                decision.message_id = message.id.clone();
                decision
            }
            Err(error) => {
                self.record_coordinator_runtime_diagnostic(
                    "coordinator_runtime.decision_parse_failed",
                    run_id,
                    &run.channel_id,
                    &run.message_id,
                    format!("error={}", error),
                )
                .await;
                self.persist_failed_coordinator_decision(&run, &message, &message_body, &error)
                    .await?;
                return Ok(());
            }
        };
        self.record_coordinator_runtime_diagnostic(
            "coordinator_runtime.decision_parsed",
            run_id,
            &run.channel_id,
            &run.message_id,
            format!(
                "action={} assignee_agent_ids={}",
                enum_storage_str(&decision.action),
                decision.assignee_agent_ids.len()
            ),
        )
        .await;

        self.apply_completed_coordinator_decision(&run, &message, &message_body, decision)
            .await?;
        self.orchestration
            .finish_coordinator_runtime_run(run_id, "completed", None)
            .await?;
        self.record_coordinator_runtime_diagnostic(
            "coordinator_runtime.completed",
            run_id,
            &run.channel_id,
            &run.message_id,
            "decision_applied".to_string(),
        )
        .await;
        Ok(())
    }

    async fn begin_runtime_launch(&self) -> Result<ResetLaunchGuard, ChannelOrchestratorError> {
        Ok(self.reset_runtime.begin_launch().await?)
    }

    pub fn clear_reset_caches(&self) {
        self.outcome_idempotency
            .lock()
            .expect("channel orchestrator idempotency lock")
            .clear();
    }

    async fn fail_coordinator_runtime_run(
        &self,
        run_id: &str,
        message: &str,
    ) -> Result<(), ChannelOrchestratorError> {
        let Some(run) = self.orchestration.coordinator_runtime_run(run_id).await? else {
            return Ok(());
        };
        let source_message = self.messages.message(&run.message_id).await?;
        let message_body = source_message.body.clone().unwrap_or_default();
        self.persist_failed_coordinator_decision(
            &run,
            &source_message,
            &message_body,
            &CoordinatorDecisionError::Worker(message.to_string()),
        )
        .await?;
        self.record_coordinator_runtime_diagnostic(
            "coordinator_runtime.failed",
            run_id,
            &run.channel_id,
            &run.message_id,
            "decision_failed".to_string(),
        )
        .await;
        Ok(())
    }

    async fn record_coordinator_runtime_diagnostic(
        &self,
        event_type: &str,
        run_id: &str,
        channel_id: &str,
        message_id: &str,
        detail: String,
    ) {
        let _ = self
            .orchestration
            .record_diagnostic_event(
                event_type,
                &format!(
                    "run_id={} channel_id={} message_id={} {}",
                    run_id, channel_id, message_id, detail
                ),
            )
            .await;
    }

    async fn persist_failed_coordinator_decision(
        &self,
        run: &slei_storage::repositories::CoordinatorRuntimeRunRecord,
        message: &crate::services::message_service::MessageRecord,
        message_body: &str,
        error: &CoordinatorDecisionError,
    ) -> Result<(), ChannelOrchestratorError> {
        let decision_id = Uuid::new_v4();
        let reason = format!("Coordinator decision failed: {error}");
        self.orchestration
            .record_decision(
                decision_id,
                &message.channel_id,
                &message.id,
                "ambiguous",
                "needs_manual_assignment",
                None,
                &[],
                &reason,
            )
            .await?;
        self.persist_routing_context_packages(
            &decision_id.to_string(),
            Some(&run.run_id),
            &message.channel_id,
            Some(&message.channel_id),
            &message.id,
            message_body,
            None,
            "ambiguous",
            "needs_manual_assignment",
            &reason,
            None,
            &[],
        )
        .await?;
        self.orchestration
            .finish_coordinator_runtime_run(&run.run_id, "failed", Some(&error.to_string()))
            .await?;
        Ok(())
    }

    async fn apply_completed_coordinator_decision(
        &self,
        run: &slei_storage::repositories::CoordinatorRuntimeRunRecord,
        message: &crate::services::message_service::MessageRecord,
        message_body: &str,
        decision: CoordinatorDecision,
    ) -> Result<SendChannelMessageOutcome, ChannelOrchestratorError> {
        let decision_id = Uuid::parse_str(&decision.id)
            .map_err(|_| ChannelOrchestratorError::InvalidDecisionId)?;
        let channel_members = self.channels.channel_members(&message.channel_id).await?;
        let readiness_by_agent = channel_members
            .iter()
            .map(|member| (member.agent_id.clone(), member.readiness.clone()))
            .collect::<HashMap<_, _>>();
        let member_ids = readiness_by_agent.keys().cloned().collect::<HashSet<_>>();
        let explicit_agent_ids = self
            .resolve_explicit_mentions(message_body, &member_ids)
            .await;
        let mut intent = enum_storage_str(&decision.intent);
        let mut action = enum_storage_str(&decision.action);
        let mut assignee_agent_id = decision.assignee_agent_id.clone();
        let mut assignee_agent_ids = decision.assignee_agent_ids.clone();
        let mut reason = decision.reason.clone();
        if message.as_task {
            let task_targets = if !explicit_agent_ids.is_empty() {
                explicit_agent_ids.clone()
            } else if !assignee_agent_ids.is_empty() {
                assignee_agent_ids.clone()
            } else {
                assignee_agent_id.iter().cloned().collect()
            };
            assignee_agent_id = task_targets.first().cloned();
            assignee_agent_ids = task_targets;
            action = if !assignee_agent_ids.is_empty() {
                "create_task_and_assign".to_string()
            } else {
                "needs_manual_assignment".to_string()
            };
            intent = "task_command".to_string();
            reason = "user explicitly converted message to task".to_string();
        }
        self.orchestration
            .record_decision(
                decision_id,
                &message.channel_id,
                &message.id,
                &intent,
                &action,
                assignee_agent_id.as_deref(),
                &assignee_agent_ids,
                &reason,
            )
            .await?;

        let mut task_id = None;
        match action.as_str() {
            "request_agent_reply" => {
                let targets = if assignee_agent_ids.is_empty() {
                    assignee_agent_id.iter().cloned().collect::<Vec<_>>()
                } else {
                    assignee_agent_ids.clone()
                };
                for agent_id in targets {
                    if let Some(readiness) = readiness_by_agent.get(&agent_id) {
                        self.create_human_mention_once(
                            &agent_id,
                            &message.channel_id,
                            &message.id,
                            readiness.clone(),
                        )
                        .await;
                        self.start_channel_agent_reply_once(
                            &agent_id,
                            &message.channel_id,
                            &message.id,
                            message_body,
                        )
                        .await?;
                    }
                }
            }
            "create_task_and_assign" | "needs_manual_assignment" if intent == "task_command" => {
                let assignee = if action == "create_task_and_assign" {
                    assignee_agent_id.clone()
                } else {
                    None
                };
                let task = self
                    .ensure_source_task(
                        message,
                        message_body,
                        assignee.clone(),
                        &reason,
                        &format!("{}:coordinator-task", run.idempotency_key),
                    )
                    .await?;
                let targets = if assignee_agent_ids.is_empty() {
                    assignee
                        .as_ref()
                        .or(task.assignee_id.as_ref())
                        .cloned()
                        .into_iter()
                        .collect::<Vec<_>>()
                } else {
                    assignee_agent_ids.clone()
                };
                for agent_id in targets {
                    self.create_task_assignment_and_start_once(
                        &agent_id,
                        &message.channel_id,
                        &task.id,
                        &message.id,
                        message_body,
                    )
                    .await?;
                }
                task_id = Some(task.id);
            }
            _ => {}
        }

        self.persist_routing_context_packages(
            &decision.id,
            Some(&run.run_id),
            &message.channel_id,
            Some(&message.channel_id),
            &message.id,
            message_body,
            task_id.as_deref(),
            &intent,
            &action,
            &reason,
            assignee_agent_id.as_deref(),
            &assignee_agent_ids,
        )
        .await?;

        let outcome = SendChannelMessageOutcome {
            message_id: message.id.clone(),
            action,
            task_id,
            assignee_agent_id,
            assignee_agent_ids,
            coordinator_run_id: Some(run.run_id.clone()),
            decision_status: Some("completed".to_string()),
        };
        self.outcome_idempotency
            .lock()
            .expect("channel orchestrator idempotency lock")
            .insert(run.idempotency_key.clone(), outcome.clone());
        Ok(outcome)
    }

    async fn existing_decision_for_message(
        &self,
        message_id: &str,
    ) -> Result<Option<ResolvedCoordinatorDecision>, ChannelOrchestratorError> {
        Ok(self
            .orchestration
            .decisions_for_message(message_id)
            .await?
            .into_iter()
            .next()
            .map(|decision| ResolvedCoordinatorDecision {
                action: decision.action,
                assignee_agent_id: decision.assignee_agent_id,
                assignee_agent_ids: decision.assignee_agent_ids,
                coordinator_run_id: None,
                decision_status: Some("completed".to_string()),
            }))
    }

    async fn outcome_for_completed_decision(
        &self,
        message_id: &str,
        mut decision: ResolvedCoordinatorDecision,
        run: Option<&slei_storage::repositories::CoordinatorRuntimeRunRecord>,
    ) -> Result<SendChannelMessageOutcome, ChannelOrchestratorError> {
        let task_id = if matches!(
            decision.action.as_str(),
            "create_task_and_assign" | "needs_manual_assignment"
        ) {
            self.tasks
                .task_for_source_message(message_id)
                .await
                .map(|task| task.id)
        } else {
            None
        };
        if let Some(run) = run {
            decision.coordinator_run_id = Some(run.run_id.clone());
            decision.decision_status = Some(run.status.clone());
        }
        Ok(SendChannelMessageOutcome {
            message_id: message_id.to_string(),
            action: decision.action,
            task_id,
            assignee_agent_id: decision.assignee_agent_id,
            assignee_agent_ids: decision.assignee_agent_ids,
            coordinator_run_id: decision.coordinator_run_id,
            decision_status: decision.decision_status,
        })
    }

    async fn recover_completed_decision_side_effects(
        &self,
        message: &crate::services::message_service::MessageRecord,
        message_body: &str,
        outcome: &SendChannelMessageOutcome,
    ) -> Result<(), ChannelOrchestratorError> {
        match outcome.action.as_str() {
            "request_agent_reply" => {
                let readiness_by_agent = self
                    .channels
                    .channel_members(&message.channel_id)
                    .await?
                    .into_iter()
                    .map(|member| (member.agent_id, member.readiness))
                    .collect::<HashMap<_, _>>();
                let targets = if outcome.assignee_agent_ids.is_empty() {
                    outcome
                        .assignee_agent_id
                        .iter()
                        .cloned()
                        .collect::<Vec<_>>()
                } else {
                    outcome.assignee_agent_ids.clone()
                };
                for agent_id in targets {
                    if let Some(readiness) = readiness_by_agent.get(&agent_id) {
                        let created = self
                            .create_human_mention_once(
                                &agent_id,
                                &message.channel_id,
                                &message.id,
                                readiness.clone(),
                            )
                            .await;
                        if created {
                            self.start_channel_agent_reply_once(
                                &agent_id,
                                &message.channel_id,
                                &message.id,
                                message_body,
                            )
                            .await?;
                        }
                    }
                }
            }
            "create_task_and_assign" => {
                let Some(task_id) = outcome.task_id.as_deref() else {
                    return Ok(());
                };
                let targets = if outcome.assignee_agent_ids.is_empty() {
                    outcome
                        .assignee_agent_id
                        .iter()
                        .cloned()
                        .collect::<Vec<_>>()
                } else {
                    outcome.assignee_agent_ids.clone()
                };
                for agent_id in targets {
                    self.create_task_assignment_and_start_once(
                        &agent_id,
                        &message.channel_id,
                        task_id,
                        &message.id,
                        message_body,
                    )
                    .await?;
                }
            }
            "needs_manual_assignment" => {}
            _ => {}
        }
        Ok(())
    }

    async fn coordinator_runtime_input(
        &self,
        run_id: String,
        channel_id: &str,
        message_id: &str,
        author_id: &str,
        body: &str,
        channel_members: &[ChannelMemberRecord],
    ) -> Result<CoordinatorRuntimeInput, ChannelOrchestratorError> {
        let workspace_mounts = self
            .channels
            .workspaces(channel_id)
            .await?
            .into_iter()
            .map(|mount| WorkspaceMount {
                path: mount.path,
                label: mount.label,
            })
            .collect::<Vec<_>>();
        Ok(CoordinatorRuntimeInput {
            run_id,
            channel_id: channel_id.to_string(),
            channel_name: channel_id.to_string(),
            message_id: message_id.to_string(),
            author_id: author_id.to_string(),
            body: body.to_string(),
            members: self.prompt_members(channel_members).await,
            context_refs: vec![format!("channels/{channel_id}/summary")],
            workspace_mounts,
        })
    }

    async fn prompt_members(
        &self,
        channel_members: &[ChannelMemberRecord],
    ) -> Vec<CoordinatorPromptMember> {
        let product_agents = self
            .members
            .list_product_agents()
            .await
            .into_iter()
            .map(|agent| (agent.id.clone(), agent))
            .collect::<HashMap<_, _>>();
        channel_members
            .iter()
            .map(|member| {
                if let Some(agent) = product_agents.get(&member.agent_id) {
                    CoordinatorPromptMember {
                        agent_id: agent.id.clone(),
                        name: agent.name.clone(),
                        handle: agent.handle.clone(),
                        agent_kind: agent.agent_kind.clone(),
                        readiness: readiness_label(&member.readiness).to_string(),
                    }
                } else {
                    CoordinatorPromptMember {
                        agent_id: member.agent_id.clone(),
                        name: member.agent_id.clone(),
                        handle: format!("@{}", member.agent_id),
                        agent_kind: if member.agent_id.starts_with("agent_coordinator_") {
                            "coordinator"
                        } else {
                            "agent"
                        }
                        .to_string(),
                        readiness: readiness_label(&member.readiness).to_string(),
                    }
                }
            })
            .collect()
    }

    async fn resolve_explicit_mentions(
        &self,
        body: &str,
        member_ids: &HashSet<String>,
    ) -> Vec<String> {
        let mentioned_handles = explicit_handles(body);
        if mentioned_handles.is_empty() {
            return Vec::new();
        }

        let handle_to_agent = self
            .members
            .list_product_agents()
            .await
            .into_iter()
            .map(|agent| (agent.handle.to_lowercase(), agent.id))
            .collect::<HashMap<_, _>>();
        let mut resolved = Vec::new();
        for handle in mentioned_handles {
            if let Some(agent_id) = handle_to_agent.get(&handle) {
                if member_ids.contains(agent_id)
                    && !is_internal_coordinator_id(agent_id)
                    && !resolved.contains(agent_id)
                {
                    resolved.push(agent_id.clone());
                }
            }
        }
        resolved
    }

    async fn create_human_mention_once(
        &self,
        agent_id: &str,
        channel_id: &str,
        message_id: &str,
        readiness: ChannelMemberReadiness,
    ) -> bool {
        let already_created = self
            .agent_inbox
            .events_for_agent(agent_id)
            .await
            .into_iter()
            .any(|event| {
                event.event_type == "human_mention"
                    && event.channel_id == channel_id
                    && event.message_id == message_id
            });
        if !already_created {
            let event = self
                .agent_inbox
                .create_human_mention(agent_id, channel_id, message_id, readiness)
                .await;
            let _ = self
                .orchestration
                .record_diagnostic_event(
                    "agent_inbox.created",
                    &format!(
                        "event_id={} agent_id={} channel_id={} message_id={} event_type={} delivery_state={:?}",
                        event.id,
                        event.agent_id,
                        event.channel_id,
                        event.message_id,
                        event.event_type,
                        event.delivery_state
                    ),
                )
                .await;
            return true;
        }
        false
    }

    async fn ensure_source_task(
        &self,
        message: &crate::services::message_service::MessageRecord,
        message_body: &str,
        assignee_id: Option<String>,
        assignment_reason: &str,
        idempotency_key: &str,
    ) -> Result<TaskRecord, ChannelOrchestratorError> {
        if let Some(task) = self.tasks.task_for_source_message(&message.id).await {
            if assignee_id.is_some() && task.assignee_id != assignee_id {
                self.tasks.assign(&task.id, assignee_id).await?;
                return Ok(self.tasks.task(&task.id).await?);
            }
            return Ok(task);
        }
        Ok(self
            .tasks
            .create_from_coordinator(
                &message.channel_id,
                &message.author_id,
                &message.id,
                message_body,
                assignee_id,
                assignment_reason,
                idempotency_key,
            )
            .await?)
    }

    async fn start_channel_agent_reply_once(
        &self,
        agent_id: &str,
        channel_id: &str,
        source_message_id: &str,
        prompt: &str,
    ) -> Result<(), ChannelOrchestratorError> {
        self.start_channel_agent_run_once(
            agent_id,
            channel_id,
            source_message_id,
            prompt,
            None,
            None,
            None,
        )
        .await
    }

    async fn start_channel_agent_task_reply_once(
        &self,
        agent_id: &str,
        channel_id: &str,
        source_message_id: &str,
        task_id: &str,
        prompt: &str,
        note_kind: Option<&str>,
    ) -> Result<(), ChannelOrchestratorError> {
        self.start_channel_agent_run_once(
            agent_id,
            channel_id,
            source_message_id,
            prompt,
            None,
            Some(task_id.to_string()),
            note_kind.map(str::to_string),
        )
        .await
    }

    async fn start_channel_agent_run_once(
        &self,
        agent_id: &str,
        channel_id: &str,
        source_message_id: &str,
        prompt: &str,
        agent: Option<crate::services::member_service::ProductAgentRecord>,
        task_id: Option<String>,
        note_kind: Option<String>,
    ) -> Result<(), ChannelOrchestratorError> {
        let run_id = format!("run_{}", Uuid::new_v4().simple());
        self.start_channel_agent_run_once_with_run_id(
            &run_id,
            agent_id,
            channel_id,
            source_message_id,
            prompt,
            agent,
            task_id,
            note_kind,
            false,
        )
        .await
    }

    async fn start_channel_agent_run_once_with_run_id(
        &self,
        run_id: &str,
        agent_id: &str,
        channel_id: &str,
        source_message_id: &str,
        prompt: &str,
        agent: Option<crate::services::member_service::ProductAgentRecord>,
        task_id: Option<String>,
        note_kind: Option<String>,
        suppress_visible_output: bool,
    ) -> Result<(), ChannelOrchestratorError> {
        if self.channel_agent_runs.lock().await.values().any(|run| {
            run.agent_id == agent_id
                && run.channel_id == channel_id
                && run.source_message_id == source_message_id
        }) {
            return Ok(());
        }
        let agent = match agent {
            Some(agent) => agent,
            None => self.members.get_product_agent(agent_id).await?,
        };
        let session_id = self
            .messages
            .message(source_message_id)
            .await
            .ok()
            .and_then(|message| message.session_id)
            .or_else(|| None);
        let session_id = match session_id {
            Some(session_id) => Some(session_id),
            None => self
                .channels
                .active_session(channel_id)
                .await
                .ok()
                .map(|session| session.id),
        };
        self.channel_agent_runs.lock().await.insert(
            run_id.to_string(),
            ChannelAgentRunRecord {
                channel_id: channel_id.to_string(),
                session_id,
                agent_id: agent_id.to_string(),
                source_message_id: source_message_id.to_string(),
                task_id: task_id.clone(),
                suppress_visible_output,
                output: String::new(),
            },
        );
        let session = match self.worker.create_session(CreateSessionRequest {
            agent_id: agent.id.clone(),
            cwd: agent.workspace_path.clone(),
            session_id: Uuid::new_v4().to_string(),
            resume_session: false,
        }) {
            Ok(session) => session,
            Err(error) => {
                self.channel_agent_runs.lock().await.remove(run_id);
                return Err(error.into());
            }
        };
        let channel_name = format!("#{channel_id}");
        let task_notes = task_id.as_ref().map(|task_id| {
            format!(
                "{}; source message id: {source_message_id}; task id: {task_id}",
                note_kind.as_deref().unwrap_or("task assignment")
            )
        });
        let system_prompt = build_agent_system_prompt(AgentSystemPromptInput {
            agent_id: &agent.id,
            handle: &agent.handle,
            name: &agent.name,
            role: &agent.description,
            node_id: &agent.node_id,
            cwd: &agent.workspace_path,
            session_id: &session.session_id,
            model: &agent.model,
            channel_id: Some(channel_id),
            channel_name: Some(&channel_name),
            message_id: Some(source_message_id),
            task_id: task_id.as_deref(),
            runtime_kind: &agent.runtime_kind,
            legacy_mode: false,
            source_message_id: Some(source_message_id),
            notes: task_notes.as_deref(),
        });
        if let Err(error) =
            self.worker
                .start_run(run_id, &session, prompt, &system_prompt, Vec::new())
        {
            self.channel_agent_runs.lock().await.remove(run_id);
            return Err(error.into());
        }
        let _ = self
            .orchestration
            .record_diagnostic_event(
                "channel_agent_runtime.started",
                &format!(
                    "run_id={} agent_id={} channel_id={} source_message_id={}",
                    run_id, agent_id, channel_id, source_message_id
                ),
            )
            .await;
        let record = ChannelAgentRunRecord {
            channel_id: channel_id.to_string(),
            session_id: None,
            agent_id: agent_id.to_string(),
            source_message_id: source_message_id.to_string(),
            task_id,
            suppress_visible_output,
            output: String::new(),
        };
        self.record_channel_agent_activity(
            &record,
            run_id,
            "run.started",
            "info",
            format!("运行开始：run={run_id}"),
            Some(format!(
                "run_id={run_id} agent_id={agent_id} channel_id={channel_id} message_id={source_message_id}"
            )),
            None,
            None,
        )
        .await;
        self.record_channel_agent_activity(
            &record,
            run_id,
            "input.received",
            "info",
            format!("收到频道 #{channel_id} 消息 {source_message_id}"),
            Some(format!(
                "channel_id={channel_id} message_id={source_message_id} prompt={prompt}"
            )),
            None,
            None,
        )
        .await;
        Ok(())
    }

    async fn record_channel_agent_activity(
        &self,
        record: &ChannelAgentRunRecord,
        run_id: &str,
        event_kind: &str,
        severity: &str,
        summary: String,
        payload_preview: Option<String>,
        tool_name: Option<String>,
        ok: Option<bool>,
    ) {
        let _ = self
            .orchestration
            .repos()
            .record_agent_activity_event(NewAgentActivityEventRow {
                agent_id: record.agent_id.clone(),
                run_id: Some(run_id.to_string()),
                channel_id: Some(record.channel_id.clone()),
                message_id: Some(record.source_message_id.clone()),
                task_id: record.task_id.clone(),
                event_kind: event_kind.to_string(),
                severity: severity.to_string(),
                summary,
                payload_preview,
                tool_name,
                ok,
                state: None,
                phase: None,
                reason: None,
            })
            .await;
    }

    async fn sync_declared_channel_members(
        &self,
        channel_id: &str,
    ) -> Result<(), ChannelOrchestratorError> {
        let agents = self.members.list_product_agents().await;
        for agent in agents {
            if agent.agent_kind == "coordinator"
                || !agent.channel_ids.iter().any(|id| id == channel_id)
            {
                continue;
            }
            self.channels
                .add_agent_to_channel(channel_id, &agent.id)
                .await?;
        }
        Ok(())
    }

    async fn create_broadcast_deliveries_for_members(
        &self,
        message: &MessageRecord,
        channel_members: &[ChannelMemberRecord],
    ) -> Result<Vec<String>, ChannelOrchestratorError> {
        let mut delivered_agent_ids = Vec::new();
        let mut seen = HashSet::new();
        for member in channel_members {
            if !seen.insert(member.agent_id.clone()) {
                continue;
            }
            if is_internal_coordinator_id(&member.agent_id) {
                continue;
            }
            let agent = self.members.get_product_agent(&member.agent_id).await?;
            if agent.agent_kind == "coordinator" || agent.system_owned {
                continue;
            }
            self.claims
                .create_message_delivery(&message.id, &message.channel_id, &agent.id)
                .await?;
            let run_id = format!("run_{}", Uuid::new_v4().simple());
            if self
                .claims
                .mark_message_delivery_running(&message.id, &agent.id, &run_id)
                .await?
            {
                let prompt = broadcast_message_prompt(&agent.id, message);
                if let Err(error) = self
                    .start_channel_agent_run_once_with_run_id(
                        &run_id,
                        &agent.id,
                        &message.channel_id,
                        &message.id,
                        &prompt,
                        Some(agent.clone()),
                        None,
                        None,
                        true,
                    )
                    .await
                {
                    let _ = self
                        .claims
                        .mark_message_delivery_pending_for_run(&message.id, &agent.id, &run_id)
                        .await;
                    return Err(error);
                }
            }
            delivered_agent_ids.push(agent.id);
        }
        Ok(delivered_agent_ids)
    }

    async fn create_task_assignment_once(
        &self,
        agent_id: &str,
        channel_id: &str,
        task_id: &str,
        message_id: &str,
    ) -> bool {
        let already_created = self
            .agent_inbox
            .events_for_agent(agent_id)
            .await
            .into_iter()
            .any(|event| {
                event.event_type == "task_assigned"
                    && event.channel_id == channel_id
                    && event.task_id.as_deref() == Some(task_id)
                    && event.message_id == message_id
            });
        if !already_created {
            self.agent_inbox
                .create_task_assignment(agent_id, channel_id, task_id, message_id)
                .await;
            return true;
        }
        false
    }

    async fn create_task_assignment_and_start_once(
        &self,
        agent_id: &str,
        channel_id: &str,
        task_id: &str,
        message_id: &str,
        prompt: &str,
    ) -> Result<(), ChannelOrchestratorError> {
        if self
            .create_task_assignment_once(agent_id, channel_id, task_id, message_id)
            .await
        {
            self.start_channel_agent_task_reply_once(
                agent_id,
                channel_id,
                message_id,
                task_id,
                prompt,
                Some("task assignment"),
            )
            .await?;
        }
        Ok(())
    }

    async fn create_task_handoff_once(
        &self,
        agent_id: &str,
        channel_id: &str,
        task_id: &str,
        reply_id: &str,
        sender_id: &str,
        handoff_text: &str,
        readiness: ChannelMemberReadiness,
    ) -> bool {
        let already_created = self
            .agent_inbox
            .events_for_agent(agent_id)
            .await
            .into_iter()
            .any(|event| {
                event.event_type == "task_handoff"
                    && event.channel_id == channel_id
                    && event.task_id.as_deref() == Some(task_id)
                    && event.message_id == reply_id
            });
        if already_created {
            return false;
        }

        self.agent_inbox
            .create_task_handoff_with_details(
                agent_id,
                channel_id,
                task_id,
                reply_id,
                readiness,
                Some(sender_id),
                Some(handoff_text),
            )
            .await;
        true
    }

    async fn update_status_for_created_handoff(
        &self,
        task_id: &str,
        current_status: TaskStatus,
    ) -> Result<(), TaskError> {
        match current_status {
            TaskStatus::PendingAssignment | TaskStatus::InProgress => {
                self.tasks
                    .update_status(task_id, TaskStatus::InProgress)
                    .await
            }
            TaskStatus::InReview | TaskStatus::Done => Ok(()),
        }
    }

    async fn persist_routing_context_packages(
        &self,
        decision_id: &str,
        coordinator_run_id: Option<&str>,
        channel_id: &str,
        channel_name: Option<&str>,
        message_id: &str,
        message_body: &str,
        task_id: Option<&str>,
        intent: &str,
        action: &str,
        assignment_reason: &str,
        assignee_agent_id: Option<&str>,
        assignee_agent_ids: &[String],
    ) -> Result<(), ChannelOrchestratorError> {
        let expected_package_count = assignee_agent_ids.len().max(1);
        if self
            .orchestration
            .routing_context_packages_for_message(message_id)
            .await?
            .len()
            >= expected_package_count
        {
            return Ok(());
        }
        let decision_id = Uuid::parse_str(decision_id)
            .map_err(|_| ChannelOrchestratorError::InvalidDecisionId)?;
        let safe_memory_refs = if !assignee_agent_ids.is_empty() {
            vec!["MEMORY.md", "notes/channels.md", "notes/relationships.md"]
        } else {
            Vec::new()
        };
        let workspace_mounts = self.channels.workspaces(channel_id).await?;
        let context_target_ids = if assignee_agent_ids.is_empty() {
            vec![None]
        } else {
            assignee_agent_ids
                .iter()
                .map(|agent_id| Some(agent_id.as_str()))
                .collect::<Vec<_>>()
        };
        for target_agent_id in context_target_ids {
            let payload = json!({
                "sourceMessageId": message_id,
                "currentMessageId": message_id,
                "coordinatorRunId": coordinator_run_id,
                "channelId": channel_id,
                "channelName": channel_name,
                "targetAgentId": target_agent_id,
                "taskId": task_id,
                "intent": intent,
                "action": action,
                "compatAssigneeAgentId": assignee_agent_id,
                "targetAgentIds": assignee_agent_ids,
                "assignmentReason": assignment_reason,
                "sourceBody": message_body,
                "relatedMessageIds": [message_id],
                "channelSummaryRef": format!("channels/{channel_id}/summary"),
                "taskThreadRef": task_id.map(|id| format!("tasks/{id}/thread")),
                "safeMemoryRefs": safe_memory_refs,
                "workspaceMounts": workspace_mounts,
            });
            self.orchestration
                .record_routing_context_package(
                    Uuid::new_v4(),
                    decision_id,
                    message_id,
                    &serde_json::to_string(&payload)?,
                    false,
                )
                .await?;
        }
        Ok(())
    }
}

impl From<CoordinatorDecision> for ResolvedCoordinatorDecision {
    fn from(decision: CoordinatorDecision) -> Self {
        Self {
            action: enum_storage_str(&decision.action),
            assignee_agent_id: decision.assignee_agent_id,
            assignee_agent_ids: decision.assignee_agent_ids,
            coordinator_run_id: None,
            decision_status: Some("completed".to_string()),
        }
    }
}

fn pending_outcome(
    message_id: String,
    coordinator_run_id: String,
    task_id: Option<String>,
) -> SendChannelMessageOutcome {
    SendChannelMessageOutcome {
        message_id,
        action: "coordinator_pending".to_string(),
        task_id,
        assignee_agent_id: None,
        assignee_agent_ids: Vec::new(),
        coordinator_run_id: Some(coordinator_run_id),
        decision_status: Some("pending".to_string()),
    }
}

fn broadcast_message_prompt(agent_id: &str, message: &MessageRecord) -> String {
    let message_type = match message.kind {
        MessageKind::Human => "human",
        MessageKind::Agent => "agent",
        MessageKind::TaskCard => "task_card",
        MessageKind::Tombstone => "tombstone",
    };
    let body = message.body.as_deref().unwrap_or_default();
    let visible_message = format!(
        "[target=#{} msg={} time={} type={}] {}: {}",
        message.channel_id, message.id, message.created_at, message_type, message.author_id, body
    );
    format!(
        "agent_id={agent_id}\nchannel_id={channel_id}\nmessage_id={message_id}\nauthor_id={author_id}\ncreated_at={created_at}\n\nTriggering message:\n{visible_message}\n\nDecide whether this message needs your response. If you should handle it, first run exactly:\nslei message claim {message_id} --agent {agent_id}\n\nIf the claim succeeds, use the Slei CLI for all follow-up work: pull history with `slei message read --channel #{channel_id}`, update status with `slei agent status --agent {agent_id} --state ... --phase ...`, send channel replies by piping the body from stdin, for example `printf \"...\" | slei message send --target \"#{channel_id}\" --agent {agent_id}`, and create/read/update tasks with `slei task` commands. Do not rely on this prompt for channel history; fetch history with CLI only when needed.",
        channel_id = message.channel_id,
        message_id = message.id,
        author_id = message.author_id,
        created_at = message.created_at,
    )
}

fn readiness_label(readiness: &ChannelMemberReadiness) -> &'static str {
    match readiness {
        ChannelMemberReadiness::Joining => "joining",
        ChannelMemberReadiness::MemorySyncing => "memory_syncing",
        ChannelMemberReadiness::Ready => "ready",
        ChannelMemberReadiness::MemoryFailed => "memory_failed",
        ChannelMemberReadiness::Unavailable => "unavailable",
    }
}

fn is_channel_join_run(source_message_id: &str) -> bool {
    source_message_id.starts_with("channel_join:")
}

fn explicit_handles(body: &str) -> Vec<String> {
    let mut handles = Vec::new();
    let mut characters = body.char_indices().peekable();
    while let Some((_, character)) = characters.next() {
        if character != '@' {
            continue;
        }

        let mut handle = String::from("@");
        while let Some((_, next)) = characters.peek() {
            if next.is_ascii_alphanumeric() || *next == '-' || *next == '_' {
                handle.push(next.to_ascii_lowercase());
                characters.next();
            } else {
                break;
            }
        }
        if handle.len() > 1 {
            handles.push(handle);
        }
    }
    handles
}

fn reply_requires_work(body: &str) -> bool {
    [
        "实现",
        "修复",
        "检查",
        "整理",
        "创建",
        "改一下",
        "写一个",
        "生成",
        "调查",
        "验证",
        "继续",
    ]
    .iter()
    .any(|marker| body.contains(marker))
}

fn diagnostic_token(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join("_")
}

fn activity_summary_message(value: &str) -> String {
    const MAX_CHARS: usize = 120;
    let normalized = value.split_whitespace().collect::<Vec<_>>().join(" ");
    sanitize_activity_payload_preview(&normalized, MAX_CHARS)
}

fn worker_tool_name(event: &Value) -> &str {
    event
        .get("tool_name")
        .and_then(Value::as_str)
        .or_else(|| event.get("name").and_then(Value::as_str))
        .unwrap_or("tool")
}

fn enum_storage_str<T>(value: &T) -> String
where
    T: Serialize,
{
    serde_json::to_value(value)
        .expect("serialize enum")
        .as_str()
        .expect("enum serializes to string")
        .to_string()
}

#[derive(Debug, thiserror::Error)]
pub enum ChannelOrchestratorError {
    #[error(transparent)]
    Message(#[from] MessageError),
    #[error(transparent)]
    Channel(#[from] ChannelError),
    #[error(transparent)]
    Task(#[from] TaskError),
    #[error(transparent)]
    Member(#[from] MemberError),
    #[error(transparent)]
    Card(#[from] CardError),
    #[error(transparent)]
    Claim(#[from] ClaimError),
    #[error(transparent)]
    Coordinator(#[from] CoordinatorDecisionError),
    #[error(transparent)]
    Worker(#[from] ClaudeWorkerError),
    #[error(transparent)]
    Reset(#[from] ResetRuntimeError),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
    #[error("invalid coordinator decision id")]
    InvalidDecisionId,
    #[error("worker channel event is missing or invalid field: {0}")]
    InvalidWorkerEvent(&'static str),
    #[error("inactive idempotent message cannot be routed: {message_id}")]
    InactiveIdempotentMessage { message_id: String },
    #[error("orchestration persistence error: {0}")]
    Sql(#[from] sqlx::Error),
}
