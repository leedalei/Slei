use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};
use std::time::Instant;
use tokio::sync::Mutex as AsyncMutex;

use serde::Serialize;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::adapters::claude_worker::{
    ClaudeWorkerAdapter, ClaudeWorkerError, CreateSessionRequest,
};
use crate::services::agent_inbox_service::AgentInboxService;
use crate::services::agent_message_todo_service::{
    AgentMessageTodoError, AgentMessageTodoListQuery, AgentMessageTodoService,
    PendingMessageTodoPrompt,
};
use crate::services::agent_prompt_service::{build_agent_system_prompt, AgentSystemPromptInput};
use crate::services::card_service::{CardError, CardService};
use crate::services::channel_service::{
    ChannelError, ChannelMemberReadiness, ChannelMemberRecord, ChannelService,
};
use crate::services::claim_service::{ClaimError, ClaimService};
use crate::services::member_service::{MemberError, MemberService};
use crate::services::message_service::{MessageError, MessageKind, MessageRecord, MessageService};
use crate::services::message_thread_service::MessageThreadReplyView;
use crate::services::message_thread_service::{MessageThreadError, MessageThreadService};
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
pub struct ChannelOrchestratorService {
    messages: MessageService,
    channels: ChannelService,
    cards: CardService,
    tasks: TaskService,
    message_threads: MessageThreadService,
    claims: ClaimService,
    agent_message_todos: AgentMessageTodoService,
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
    started_at: Instant,
    first_tool_latency_recorded: bool,
}

impl ChannelOrchestratorService {
    pub fn new(
        messages: MessageService,
        channels: ChannelService,
        cards: CardService,
        tasks: TaskService,
        message_threads: MessageThreadService,
        claims: ClaimService,
        agent_message_todos: AgentMessageTodoService,
        agent_inbox: AgentInboxService,
        orchestration: OrchestrationStore,
        members: MemberService,
        worker: ClaudeWorkerAdapter,
        reset_runtime: ResetRuntimeState,
    ) -> Self {
        Self {
            messages,
            channels,
            cards,
            tasks,
            message_threads,
            claims,
            agent_message_todos,
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
        _launch_guard: &ResetLaunchGuard,
    ) -> Result<SendChannelMessageOutcome, ChannelOrchestratorError> {
        let _send_guard = self.send_lock.lock().await;
        if let Some(outcome) = self
            .outcome_idempotency
            .lock()
            .expect("channel orchestrator idempotency lock")
            .get(&input.idempotency_key)
            .cloned()
        {
            return Ok(outcome);
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
                let reason = "user explicitly converted message to task";
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
                    decision_id,
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
            let assignee_agent_ids = self
                .create_broadcast_deliveries_for_members(&message, &channel_members)
                .await?;
            let outcome = SendChannelMessageOutcome {
                message_id: message.id,
                action: "broadcast_delivered".to_string(),
                task_id: Some(task.id),
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

        unreachable!("channel messages are handled by broadcast or explicit task assignment")
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
        let delivered_agent_ids = self
            .create_broadcast_deliveries_for_members(message, &channel_members)
            .await?;
        if delivered_agent_ids.is_empty()
            && message.kind == MessageKind::Agent
            && explicit_handles(message.body.as_deref().unwrap_or_default()).is_empty()
        {
            let _ = self
                .start_next_pending_todo_for_channel(&message.channel_id, message)
                .await?;
        }
        Ok(delivered_agent_ids)
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
        let public_reply = thread_message_for_reply(&reply_outcome.task_id, reply.clone());
        if task.status == TaskStatus::Done {
            return Ok(TaskReplyReceipt {
                reply: public_reply,
                route: TaskReplyRoute {
                    handoff_agent_ids: Vec::new(),
                    needs_assignment: false,
                },
            });
        }
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
            if agent_id == reply.sender_id {
                continue;
            }
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

    pub async fn add_message_thread_reply_with_launch_guard(
        &self,
        thread_id: &str,
        sender_id: &str,
        role: Option<&str>,
        body: &str,
        idempotency_key: &str,
        _activity_guard: &ResetLaunchGuard,
    ) -> Result<MessageThreadReplyView, ChannelOrchestratorError> {
        let _send_guard = self.send_lock.lock().await;
        let reply = self
            .message_threads
            .add_reply(thread_id, sender_id, role, body, idempotency_key)
            .await?;
        let thread = self.message_threads.get_thread(thread_id).await?.thread;
        if thread.source_kind != "channel" {
            return Ok(reply);
        }
        if explicit_handles(&reply.body).is_empty() {
            return Ok(reply);
        }

        let channel_members = self.channels.channel_members(&thread.source_id).await?;
        let readiness_by_agent = channel_members
            .iter()
            .map(|member| (member.agent_id.clone(), member.readiness.clone()))
            .collect::<HashMap<_, _>>();
        let member_ids = readiness_by_agent.keys().cloned().collect::<HashSet<_>>();
        let explicit_agent_ids = self
            .resolve_explicit_mentions(&reply.body, &member_ids)
            .await;

        for agent_id in explicit_agent_ids {
            if agent_id == reply.sender_id {
                continue;
            }
            if readiness_by_agent.contains_key(&agent_id) {
                self.claims
                    .create_message_delivery(&reply.id, &thread.source_id, &agent_id)
                    .await?;
                let run_id = format!("run_{}", Uuid::new_v4().simple());
                if !self
                    .claims
                    .mark_message_delivery_running(&reply.id, &agent_id, &run_id)
                    .await?
                {
                    continue;
                }
                if let Err(error) = self
                    .start_channel_agent_run_once_with_run_id(
                        &run_id,
                        &agent_id,
                        &thread.source_id,
                        &reply.id,
                        &thread_reply_prompt(&thread.id, &thread.source_message_id, &reply),
                        None,
                        None,
                        Some(format!(
                            "message thread reply; thread id: {}; source message id: {}",
                            thread.id, thread.source_message_id
                        )),
                        false,
                        false,
                    )
                    .await
                {
                    let _ = self
                        .claims
                        .mark_message_delivery_pending_for_run(&reply.id, &agent_id, &run_id)
                        .await;
                    return Err(error);
                }
            }
        }
        Ok(reply)
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
                drop(runs);
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
                    format!(
                        "运行完成：run={run_id} output_chars={}",
                        body.chars().count()
                    ),
                    Some(format!(
                        "output_chars={} output={} event={}",
                        body.chars().count(),
                        body,
                        event
                    )),
                    None,
                    Some(true),
                )
                .await;
                self.agent_message_todos.mark_done_for_run(run_id).await?;
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
                self.agent_message_todos
                    .restore_pending_for_run(run_id)
                    .await?;
                let message = event
                    .get("message")
                    .and_then(Value::as_str)
                    .unwrap_or("Agent runtime failed");
                self.record_channel_agent_activity(
                    &record,
                    run_id,
                    "run.failed",
                    "error",
                    format!(
                        "运行失败：{} output_chars={}",
                        activity_summary_message(message),
                        record.output.trim().chars().count()
                    ),
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
                let first_tool_latency_payload = if !record.first_tool_latency_recorded {
                    record.first_tool_latency_recorded = true;
                    let latency_ms = record.started_at.elapsed().as_millis();
                    Some(format!(
                        "run_id={} agent_id={} channel_id={} source_message_id={} latency_ms={}",
                        run_id,
                        record.agent_id,
                        record.channel_id,
                        record.source_message_id,
                        latency_ms
                    ))
                } else {
                    None
                };
                let record = record.clone();
                drop(runs);
                if let Some(payload) = first_tool_latency_payload {
                    let _ = self
                        .orchestration
                        .record_diagnostic_event(
                            "channel_agent_runtime.first_tool_latency",
                            &payload,
                        )
                        .await;
                }
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

    async fn begin_runtime_launch(&self) -> Result<ResetLaunchGuard, ChannelOrchestratorError> {
        Ok(self.reset_runtime.begin_launch().await?)
    }

    pub fn clear_reset_caches(&self) {
        self.outcome_idempotency
            .lock()
            .expect("channel orchestrator idempotency lock")
            .clear();
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

        let handle_to_agent = self.members.list_product_agents().await.into_iter().fold(
            HashMap::<String, Vec<String>>::new(),
            |mut handles, agent| {
                handles
                    .entry(agent.handle.to_lowercase())
                    .or_default()
                    .push(agent.id);
                handles
            },
        );
        let mut resolved = Vec::new();
        for handle in mentioned_handles {
            if let Some(agent_ids) = handle_to_agent.get(&handle) {
                if agent_ids.len() > 1 {
                    let _ = self
                        .orchestration
                        .record_diagnostic_event(
                            "mention.resolve_ambiguous_handle",
                            &format!("handle={} agent_ids={}", handle, agent_ids.join(",")),
                        )
                        .await;
                    continue;
                }
                if let Some(agent_id) = agent_ids.first() {
                    if member_ids.contains(agent_id) && !resolved.contains(agent_id) {
                        resolved.push(agent_id.clone());
                    }
                }
            }
        }
        resolved
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
        let thread = self
            .message_threads
            .ensure_thread_for_source_message(&message.id, &message.author_id, idempotency_key)
            .await?;
        Ok(self
            .tasks
            .create_from_source_with_assignment_and_thread(
                &message.channel_id,
                &message.author_id,
                &message.id,
                message_body,
                assignee_id,
                assignment_reason,
                idempotency_key,
                Some(thread.thread.id),
            )
            .await?)
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
        inject_pending_todos: bool,
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
        let source_message = self.messages.message(source_message_id).await.ok();
        let session_id = source_message
            .as_ref()
            .and_then(|message| message.session_id.clone())
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
                started_at: Instant::now(),
                first_tool_latency_recorded: false,
            },
        );
        let session = match self.worker.create_session(CreateSessionRequest {
            agent_id: agent.id.clone(),
            cwd: agent.workspace_path.clone(),
            session_id: Uuid::new_v4().to_string(),
            resume_session: false,
            persist_session: false,
        }) {
            Ok(session) => session,
            Err(error) => {
                self.channel_agent_runs.lock().await.remove(run_id);
                return Err(error.into());
            }
        };
        let pending_todos = if inject_pending_todos {
            match self
                .agent_message_todos
                .mark_running_for_prompt(&agent.id, channel_id, run_id, 5)
                .await
            {
                Ok(pending_todos) => pending_todos,
                Err(error) => {
                    self.agent_message_todos
                        .restore_pending_for_run(run_id)
                        .await?;
                    self.channel_agent_runs.lock().await.remove(run_id);
                    return Err(error.into());
                }
            }
        } else {
            Vec::new()
        };
        let prompt = if inject_pending_todos {
            let Some(message) = source_message.as_ref() else {
                self.agent_message_todos
                    .restore_pending_for_run(run_id)
                    .await?;
                self.channel_agent_runs.lock().await.remove(run_id);
                return Err(MessageError::MessageNotFound.into());
            };
            channel_run_prompt(&agent.id, message, &pending_todos)
        } else {
            prompt.to_string()
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
                .start_run(run_id, &session, &prompt, &system_prompt, Vec::new())
        {
            self.agent_message_todos
                .restore_pending_for_run(run_id)
                .await?;
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
            started_at: Instant::now(),
            first_tool_latency_recorded: false,
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
            if !agent.channel_ids.iter().any(|id| id == channel_id) {
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
        let target_agent_ids = self
            .delivery_target_agent_ids_for_message(message, channel_members)
            .await;
        for agent_id in target_agent_ids {
            let agent = self.members.get_product_agent(&agent_id).await?;
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

    async fn start_next_pending_todo_for_channel(
        &self,
        channel_id: &str,
        trigger_message: &MessageRecord,
    ) -> Result<Option<String>, ChannelOrchestratorError> {
        let pending_todos = self
            .agent_message_todos
            .list(AgentMessageTodoListQuery {
                agent_id: None,
                channel_id: Some(channel_id.to_string()),
                status: Some("pending".to_string()),
                include_deleted: false,
                limit: Some(50),
            })
            .await?;
        let channel_members = self.channels.channel_members(channel_id).await?;
        let member_ids = channel_members
            .iter()
            .map(|member| member.agent_id.clone())
            .collect::<HashSet<_>>();

        for todo in pending_todos {
            if todo.agent_id == trigger_message.author_id {
                continue;
            }
            if !member_ids.contains(&todo.agent_id) {
                continue;
            }
            if self
                .channel_agent_runs
                .lock()
                .await
                .values()
                .any(|run| run.agent_id == todo.agent_id && run.channel_id == channel_id)
            {
                continue;
            }
            let agent = self.members.get_product_agent(&todo.agent_id).await?;
            let run_id = format!("run_{}", Uuid::new_v4().simple());
            self.start_channel_agent_run_once_with_run_id(
                &run_id,
                &agent.id,
                channel_id,
                &trigger_message.id,
                "",
                Some(agent.clone()),
                None,
                None,
                true,
                true,
            )
            .await?;
            return Ok(Some(agent.id));
        }

        Ok(None)
    }

    async fn delivery_target_agent_ids_for_message(
        &self,
        message: &MessageRecord,
        channel_members: &[ChannelMemberRecord],
    ) -> Vec<String> {
        let member_ids = channel_members
            .iter()
            .map(|member| member.agent_id.clone())
            .collect::<HashSet<_>>();
        let mut targets = match message.kind {
            MessageKind::Human => channel_members
                .iter()
                .map(|member| member.agent_id.clone())
                .collect::<Vec<_>>(),
            MessageKind::Agent => {
                let body = message.body.as_deref().unwrap_or_default();
                self.resolve_explicit_mentions(body, &member_ids).await
            }
            MessageKind::TaskCard | MessageKind::Tombstone => Vec::new(),
        };
        let mut seen = HashSet::new();
        targets.retain(|agent_id| {
            agent_id != &message.author_id
                && member_ids.contains(agent_id)
                && seen.insert(agent_id.clone())
        });
        targets
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
        decision_id: Uuid,
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

fn broadcast_message_prompt(agent_id: &str, message: &MessageRecord) -> String {
    channel_run_prompt(agent_id, message, &[])
}

fn channel_run_prompt(
    agent_id: &str,
    message: &MessageRecord,
    pending_todos: &[PendingMessageTodoPrompt],
) -> String {
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
    let pending_todo_guidance = if pending_todos.is_empty() {
        format!(
            r##"Classify the message with the system Claim Intent Classes. If you should respond, first run:

```bash
slei message claim {message_id} --agent {agent_id}
```

If the claim fails, exit silently."##,
            message_id = message.id,
        )
    } else {
        format!(
            r##"Pending Message Todos are present. Process those pending todos even if the current trigger is not claimable.

For the current trigger message itself, classify it with the system Claim Intent Classes. If you should respond to the trigger, first run:

```bash
slei message claim {message_id} --agent {agent_id}
```

If the trigger claim fails, continue processing Pending Message Todos. Do not claim the current trigger solely for todo progression."##,
            message_id = message.id,
        )
    };
    let mut prompt = format!(
        r##"# Slei Channel Run Packet

## Runtime Context
- Agent ID: `{agent_id}`
- Channel ID: `{channel_id}`
- Message ID: `{message_id}`
- Author ID: `{author_id}`
- Created At: `{created_at}`

## Triggering Message
```text
{visible_message}
```

## Required First Action
{pending_todo_guidance}

## Optional Context Lookup
Read nearby messages only when classification needs flow, order, prior participants, or topic continuity.

```bash
slei message read --channel "#{channel_id}" --around {message_id}
```

## Visible Reply
If the claim succeeds, use Slei CLI for visible work. Send channel replies through stdin:

```bash
printf "..." | slei message send --target "#{channel_id}" --agent {agent_id}
```

Use `slei agent status --agent {agent_id} --state ... --phase ...` for truthful progress. Use `slei task` commands when the work belongs to a task."##,
        channel_id = message.channel_id,
        message_id = message.id,
        author_id = message.author_id,
        created_at = message.created_at,
        pending_todo_guidance = pending_todo_guidance,
    );

    if !pending_todos.is_empty() {
        prompt.push_str(
            r##"

## Pending Message Todos
Process pending todos even if the current trigger is not claimable.
Do not claim the current trigger solely for todo progression.
Do not claim the todo source message.
Use `slei message read --channel "#all" --from-message msg_A --to-message msg_B` for source-message ranges.

"##,
        );
        for todo in pending_todos {
            prompt.push_str(&format!(
                r##"### Todo `{todo_id}`
- Todo ID: `{todo_id}`
- Channel ID: `{todo_channel_id}`
- Message ID: `{todo_message_id}`
- Author ID: `{todo_author_id}`
- Claim Owner Agent ID: `{claim_owner_agent_id}`
- Created At: `{todo_created_at}`

```text
{todo_body}
```

```bash
slei message read --channel "#{todo_channel_id}" --from-message {todo_message_id} --to-message {todo_message_id}
```

"##,
                todo_id = todo.id,
                todo_channel_id = todo.channel_id,
                todo_message_id = todo.message_id,
                todo_author_id = todo.author_id,
                claim_owner_agent_id = todo.claim_owner_agent_id,
                todo_created_at = todo.created_at,
                todo_body = todo.body,
            ));
        }
    }

    prompt
}

fn thread_reply_prompt(
    thread_id: &str,
    source_message_id: &str,
    reply: &MessageThreadReplyView,
) -> String {
    format!(
        r#"# Slei Message Thread Reply

- Thread ID: `{thread_id}`
- Source Message ID: `{source_message_id}`
- Reply ID: `{reply_id}`
- Sender ID: `{sender_id}`

## Thread Reply
```text
{body}
```

This reply belongs to a message thread. Keep follow-up work scoped to the thread context; do not create a new nested thread."#,
        reply_id = reply.id,
        sender_id = reply.sender_id,
        body = reply.body,
    )
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

#[derive(Debug, thiserror::Error)]
pub enum ChannelOrchestratorError {
    #[error(transparent)]
    Message(#[from] MessageError),
    #[error(transparent)]
    Channel(#[from] ChannelError),
    #[error(transparent)]
    Task(#[from] TaskError),
    #[error(transparent)]
    MessageThread(#[from] MessageThreadError),
    #[error(transparent)]
    Member(#[from] MemberError),
    #[error(transparent)]
    Card(#[from] CardError),
    #[error(transparent)]
    Claim(#[from] ClaimError),
    #[error(transparent)]
    AgentMessageTodo(#[from] AgentMessageTodoError),
    #[error(transparent)]
    Worker(#[from] ClaudeWorkerError),
    #[error(transparent)]
    Reset(#[from] ResetRuntimeError),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
    #[error("worker channel event is missing or invalid field: {0}")]
    InvalidWorkerEvent(&'static str),
    #[error("inactive idempotent message cannot be routed: {message_id}")]
    InactiveIdempotentMessage { message_id: String },
    #[error("orchestration persistence error: {0}")]
    Sql(#[from] sqlx::Error),
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::message_service::{MessageKind, MessageRecord};

    #[test]
    fn broadcast_message_prompt_is_a_markdown_run_packet() {
        let prompt = broadcast_message_prompt(
            "agent_nova",
            &MessageRecord {
                id: "msg_group_1".to_string(),
                sequence: None,
                channel_id: "all".to_string(),
                session_id: Some("session_all".to_string()),
                author_id: "human_lei".to_string(),
                body: Some("@all 早上好".to_string()),
                as_task: false,
                kind: MessageKind::Human,
                deleted: false,
                edited: false,
                created_at: "2026-06-17T06:28:04Z".to_string(),
                cards: Vec::new(),
            },
        );

        assert!(prompt.contains("# Slei Channel Run Packet"));
        assert!(prompt.contains("## Runtime Context"));
        assert!(prompt.contains("- Agent ID: `agent_nova`"));
        assert!(prompt.contains("- Channel ID: `all`"));
        assert!(prompt.contains("## Triggering Message"));
        assert!(prompt.contains("```text\n[target=#all msg=msg_group_1 time=2026-06-17T06:28:04Z type=human] human_lei: @all 早上好\n```"));
        assert!(prompt.contains("## Required First Action"));
        assert!(prompt.contains("```bash\nslei message claim msg_group_1 --agent agent_nova\n```"));
        assert!(prompt.contains("## Optional Context Lookup"));
        assert!(prompt.contains("slei message read --channel \"#all\" --around msg_group_1"));
        assert!(prompt.contains("## Visible Reply"));
        assert!(prompt
            .contains("printf \"...\" | slei message send --target \"#all\" --agent agent_nova"));
    }

    #[test]
    fn pending_todos_are_injected_into_run_packet() {
        let message = MessageRecord {
            id: "msg_trigger".to_string(),
            sequence: None,
            channel_id: "all".to_string(),
            session_id: Some("session_all".to_string()),
            author_id: "agent_coda".to_string(),
            body: Some("Agent progress signal without a mention".to_string()),
            as_task: false,
            kind: MessageKind::Agent,
            deleted: false,
            edited: false,
            created_at: "2026-06-18T06:28:04Z".to_string(),
            cards: Vec::new(),
        };
        let pending_todos = vec![PendingMessageTodoPrompt {
            id: "todo_1".to_string(),
            channel_id: "all".to_string(),
            message_id: "msg_A".to_string(),
            author_id: "human_lei".to_string(),
            created_at: "2026-06-18T06:00:00Z".to_string(),
            claim_owner_agent_id: "agent_coda".to_string(),
            body: "Continue processing this older message.".to_string(),
        }];

        let prompt = channel_run_prompt("agent_nova", &message, &pending_todos);

        assert!(prompt.contains("## Pending Message Todos"));
        assert!(prompt.contains("- Todo ID: `todo_1`"));
        assert!(prompt.contains("- Channel ID: `all`"));
        assert!(prompt.contains("- Message ID: `msg_A`"));
        assert!(prompt.contains("- Author ID: `human_lei`"));
        assert!(prompt.contains("- Claim Owner Agent ID: `agent_coda`"));
        assert!(prompt.contains("- Created At: `2026-06-18T06:00:00Z`"));
        assert!(prompt.contains("Continue processing this older message."));
        assert!(
            prompt.contains("Process pending todos even if the current trigger is not claimable.")
        );
        assert!(prompt.contains("Do not claim the current trigger solely for todo progression."));
        assert!(prompt.contains("Do not claim the todo source message."));
        assert!(prompt
            .contains("If the trigger claim fails, continue processing Pending Message Todos."));
        assert!(!prompt.contains("If the claim fails, exit silently."));
        assert!(prompt.contains(
            "slei message read --channel \"#all\" --from-message msg_A --to-message msg_A"
        ));
        assert!(!prompt.contains("slei todo update"));
        assert!(!prompt.contains("slei todo delete"));
        assert!(!prompt.contains("slei todo clear"));
        assert!(!prompt.contains("slei todo reopen"));
    }
}
