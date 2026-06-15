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
use crate::services::card_service::{CardError, CardService};
use crate::services::channel_service::{
    ChannelError, ChannelMemberReadiness, ChannelMemberRecord, ChannelService,
};
use crate::services::coordinator_service::{
    build_coordinator_prompt, parse_and_validate_coordinator_json, CoordinatorDecision,
    CoordinatorDecisionError, CoordinatorPromptInput, CoordinatorPromptMember,
    CoordinatorRuntimeInput, CoordinatorService, WorkspaceMount,
};
use crate::services::member_service::{is_internal_coordinator_id, MemberError, MemberService};
use crate::services::message_service::{MessageError, MessageKind, MessageService};
use crate::services::orchestration_store::OrchestrationStore;
use crate::services::reset_service::{ResetLaunchGuard, ResetRuntimeError, ResetRuntimeState};
use crate::services::task_service::{
    thread_message_for_reply, TaskError, TaskService, TaskStatus, TaskThreadMessage,
};

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
    agent_id: String,
    source_message_id: String,
    output: String,
}

impl ChannelOrchestratorService {
    pub fn new(
        messages: MessageService,
        channels: ChannelService,
        coordinator: CoordinatorService,
        cards: CardService,
        tasks: TaskService,
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

        let message = match self
            .messages
            .channel_message_for_idempotency(&input.idempotency_key)
            .await
        {
            Some(message) => message,
            None => {
                self.channels.channel_members(&input.channel_id).await?;
                self.messages
                    .create_human_channel_message(
                        &input.channel_id,
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

        let readiness_by_agent = channel_members
            .iter()
            .map(|member| (member.agent_id.clone(), member.readiness.clone()))
            .collect::<HashMap<_, _>>();
        let member_ids = readiness_by_agent.keys().cloned().collect::<HashSet<_>>();
        let explicit_agent_ids = self
            .resolve_explicit_mentions(&message_body, &member_ids)
            .await;
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
                return Ok(pending_outcome(run.message_id, run.run_id));
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
        let outcome = pending_outcome(message.id, run.run_id);
        self.outcome_idempotency
            .lock()
            .expect("channel orchestrator idempotency lock")
            .insert(input.idempotency_key, outcome.clone());
        Ok(outcome)
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
        _activity_guard: &ResetLaunchGuard,
    ) -> Result<TaskReplyReceipt, ChannelOrchestratorError> {
        let _send_guard = self.send_lock.lock().await;
        let reply_outcome = self
            .tasks
            .add_reply_with_task(task_id, sender_id, body, idempotency_key)
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
        _activity_guard: &ResetLaunchGuard,
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
                Ok(true)
            }
            Some("completed") => {
                let record = runs.remove(run_id).expect("channel agent run exists");
                drop(runs);
                let body = record.output.trim();
                if !body.is_empty() {
                    self.messages
                        .create_agent_channel_message(&record.channel_id, &record.agent_id, body)
                        .await?;
                    if is_channel_join_run(&record.source_message_id) {
                        self.channels
                            .set_member_readiness(
                                &record.channel_id,
                                &record.agent_id,
                                ChannelMemberReadiness::Ready,
                            )
                            .await?;
                    }
                    let _ = self
                        .orchestration
                        .record_diagnostic_event(
                            "channel_agent_runtime.completed",
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
                Ok(true)
            }
            Some("failed") => {
                let record = runs.remove(run_id).expect("channel agent run exists");
                drop(runs);
                let message = event
                    .get("message")
                    .and_then(Value::as_str)
                    .unwrap_or("Agent runtime failed");
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
                } else {
                    self.messages
                        .create_agent_channel_message(&record.channel_id, &record.agent_id, message)
                        .await?;
                }
                let _ = self
                    .orchestration
                    .record_diagnostic_event(
                        "channel_agent_runtime.failed",
                        &format!(
                            "run_id={} agent_id={} channel_id={} source_message_id={}",
                            run_id, record.agent_id, record.channel_id, record.source_message_id
                        ),
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
                    .create_agent_card_channel_message(
                        &record.channel_id,
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
                let task = match self.tasks.task_for_source_message(&message.id).await {
                    Some(task) => task,
                    None => {
                        self.tasks
                            .create_from_coordinator(
                                &message.channel_id,
                                &message.author_id,
                                &message.id,
                                message_body,
                                assignee.clone(),
                                &reason,
                                &format!("{}:coordinator-task", run.idempotency_key),
                            )
                            .await?
                    }
                };
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
                    self.create_task_assignment_once(
                        &agent_id,
                        &message.channel_id,
                        &task.id,
                        &message.id,
                    )
                    .await;
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
                    self.create_task_assignment_once(
                        &agent_id,
                        &message.channel_id,
                        task_id,
                        &message.id,
                    )
                    .await;
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

    async fn start_channel_agent_reply_once(
        &self,
        agent_id: &str,
        channel_id: &str,
        source_message_id: &str,
        prompt: &str,
    ) -> Result<(), ChannelOrchestratorError> {
        self.start_channel_agent_run_once(agent_id, channel_id, source_message_id, prompt, None)
            .await
    }

    async fn start_channel_agent_run_once(
        &self,
        agent_id: &str,
        channel_id: &str,
        source_message_id: &str,
        prompt: &str,
        agent: Option<crate::services::member_service::ProductAgentRecord>,
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
        let run_id = format!("run_{}", Uuid::new_v4().simple());
        self.channel_agent_runs.lock().await.insert(
            run_id.clone(),
            ChannelAgentRunRecord {
                channel_id: channel_id.to_string(),
                agent_id: agent_id.to_string(),
                source_message_id: source_message_id.to_string(),
                output: String::new(),
            },
        );
        let session = self.worker.create_session(CreateSessionRequest {
            agent_id: agent.id.clone(),
            cwd: agent.workspace_path.clone(),
            session_id: Uuid::new_v4().to_string(),
            resume_session: false,
        })?;
        self.worker
            .start_run(&run_id, &session, prompt, Vec::new())?;
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
        Ok(())
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

    async fn create_task_assignment_once(
        &self,
        agent_id: &str,
        channel_id: &str,
        task_id: &str,
        message_id: &str,
    ) {
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
        }
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

fn pending_outcome(message_id: String, coordinator_run_id: String) -> SendChannelMessageOutcome {
    SendChannelMessageOutcome {
        message_id,
        action: "coordinator_pending".to_string(),
        task_id: None,
        assignee_agent_id: None,
        assignee_agent_ids: Vec::new(),
        coordinator_run_id: Some(coordinator_run_id),
        decision_status: Some("pending".to_string()),
    }
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
