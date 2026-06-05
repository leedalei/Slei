use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};
use tokio::sync::Mutex as AsyncMutex;

use serde::Serialize;
use serde_json::json;
use uuid::Uuid;

use crate::services::agent_inbox_service::AgentInboxService;
use crate::services::channel_service::{ChannelError, ChannelMemberReadiness, ChannelService};
use crate::services::coordinator_service::{
    CoordinatorDecision, CoordinatorInput, CoordinatorService,
};
use crate::services::member_service::{MemberError, MemberService};
use crate::services::message_service::{MessageError, MessageKind, MessageService};
use crate::services::orchestration_store::OrchestrationStore;
use crate::services::task_service::{TaskError, TaskReply, TaskService};

#[derive(Clone, Debug)]
pub struct SendChannelMessageInput {
    pub channel_id: String,
    pub author_id: String,
    pub body: String,
    pub idempotency_key: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SendChannelMessageOutcome {
    pub message_id: String,
    pub action: String,
    pub task_id: Option<String>,
    pub assignee_agent_id: Option<String>,
}

#[derive(Clone, Debug)]
struct ResolvedCoordinatorDecision {
    id: String,
    action: String,
    assignee_agent_id: Option<String>,
    reason: String,
}

#[derive(Clone, Debug)]
pub struct ChannelOrchestratorService {
    messages: MessageService,
    channels: ChannelService,
    coordinator: CoordinatorService,
    tasks: TaskService,
    agent_inbox: AgentInboxService,
    orchestration: OrchestrationStore,
    members: MemberService,
    outcome_idempotency: Arc<Mutex<HashMap<String, SendChannelMessageOutcome>>>,
    send_lock: Arc<AsyncMutex<()>>,
}

impl ChannelOrchestratorService {
    pub fn new(
        messages: MessageService,
        channels: ChannelService,
        coordinator: CoordinatorService,
        tasks: TaskService,
        agent_inbox: AgentInboxService,
        orchestration: OrchestrationStore,
        members: MemberService,
    ) -> Self {
        Self {
            messages,
            channels,
            coordinator,
            tasks,
            agent_inbox,
            orchestration,
            members,
            outcome_idempotency: Arc::new(Mutex::new(HashMap::new())),
            send_lock: Arc::new(AsyncMutex::new(())),
        }
    }

    pub async fn send_channel_message(
        &self,
        input: SendChannelMessageInput,
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
                    )
                    .await?
            }
        };
        let channel_id = message.channel_id.clone();
        let author_id = message.author_id.clone();
        let channel_members = self.channels.channel_members(&channel_id).await?;
        let readiness_by_agent = channel_members
            .iter()
            .map(|member| (member.agent_id.clone(), member.readiness.clone()))
            .collect::<HashMap<_, _>>();
        let member_ids = readiness_by_agent.keys().cloned().collect::<HashSet<_>>();
        let ready_agent_ids = channel_members
            .iter()
            .filter(|member| member.readiness == ChannelMemberReadiness::Ready)
            .map(|member| member.agent_id.clone())
            .collect::<Vec<_>>();

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
        let explicit_agent_ids = self
            .resolve_explicit_mentions(&message_body, &member_ids)
            .await;
        let decision = match self.existing_decision_for_message(&message.id).await? {
            Some(decision) => decision,
            None => self
                .coordinator
                .decide(CoordinatorInput {
                    channel_id: channel_id.clone(),
                    message_id: message.id.clone(),
                    body: message_body.clone(),
                    explicit_agent_ids: explicit_agent_ids.clone(),
                    ready_agent_ids,
                })
                .await
                .into(),
        };
        let _ = self
            .orchestration
            .record_diagnostic_event(
                "channel_message.decision",
                &format!(
                    "channel_id={} message_id={} action={} assignee_agent_id={} reason={}",
                    channel_id,
                    message.id,
                    decision.action,
                    decision.assignee_agent_id.as_deref().unwrap_or("none"),
                    decision.reason
                ),
            )
            .await;

        let mut task_id = None;
        match decision.action.as_str() {
            "request_agent_reply" => {
                let targets = if explicit_agent_ids.is_empty() {
                    decision
                        .assignee_agent_id
                        .iter()
                        .cloned()
                        .collect::<Vec<_>>()
                } else {
                    explicit_agent_ids
                };
                for agent_id in targets {
                    if let Some(readiness) = readiness_by_agent.get(&agent_id) {
                        self.create_human_mention_once(
                            &agent_id,
                            &channel_id,
                            &message.id,
                            readiness.clone(),
                        )
                        .await;
                    }
                }
            }
            "create_task_and_assign" | "needs_manual_assignment" => {
                let assignee = if decision.action == "create_task_and_assign" {
                    decision.assignee_agent_id.clone()
                } else {
                    None
                };
                let task = match self.tasks.task_for_source_message(&message.id).await {
                    Some(task) => task,
                    None => {
                        self.tasks
                            .create_from_coordinator(
                                &channel_id,
                                &author_id,
                                &message.id,
                                &message_body,
                                assignee.clone(),
                                &decision.reason,
                                &format!("{}:coordinator-task", input.idempotency_key),
                            )
                            .await?
                    }
                };
                self.messages
                    .create_task_card_message(&channel_id, &task.id, &message.id)
                    .await?;
                if let Some(agent_id) = assignee.as_deref() {
                    self.create_task_assignment_once(agent_id, &channel_id, &task.id, &message.id)
                        .await;
                } else if let Some(agent_id) = task.assignee_id.as_deref() {
                    self.create_task_assignment_once(agent_id, &channel_id, &task.id, &message.id)
                        .await;
                }
                task_id = Some(task.id);
            }
            "archive_only" => {}
            _ => {}
        }

        self.persist_routing_context(
            &decision.id,
            &channel_id,
            &message.id,
            task_id.as_deref(),
            &decision.reason,
            decision.assignee_agent_id.as_deref(),
        )
        .await?;

        let outcome = SendChannelMessageOutcome {
            message_id: message.id,
            action: decision.action,
            task_id,
            assignee_agent_id: decision.assignee_agent_id,
        };
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
    ) -> Result<TaskReply, ChannelOrchestratorError> {
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

        for agent_id in explicit_agent_ids {
            if let Some(readiness) = readiness_by_agent.get(&agent_id) {
                self.create_task_handoff_once(
                    &agent_id,
                    &task.channel_id,
                    &task.id,
                    &reply.id,
                    &reply.sender_id,
                    &reply.body,
                    readiness.clone(),
                )
                .await;
            }
        }

        Ok(reply)
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
                id: decision.id.to_string(),
                action: decision.action,
                assignee_agent_id: decision.assignee_agent_id,
                reason: decision.reason,
            }))
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
                if member_ids.contains(agent_id) && !resolved.contains(agent_id) {
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
    ) {
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
        }
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
            if agent.runtime_thread.status == "ready" {
                self.channels
                    .set_member_readiness(channel_id, &agent.id, ChannelMemberReadiness::Ready)
                    .await?;
            }
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
    ) {
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
        if !already_created {
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
        }
    }

    async fn persist_routing_context(
        &self,
        decision_id: &str,
        channel_id: &str,
        message_id: &str,
        task_id: Option<&str>,
        assignment_reason: &str,
        assignee_agent_id: Option<&str>,
    ) -> Result<(), ChannelOrchestratorError> {
        if !self
            .orchestration
            .routing_context_packages_for_message(message_id)
            .await?
            .is_empty()
        {
            return Ok(());
        }
        let decision_id = Uuid::parse_str(decision_id)
            .map_err(|_| ChannelOrchestratorError::InvalidDecisionId)?;
        let safe_memory_refs = if assignee_agent_id.is_some() {
            vec!["MEMORY.md", "notes/channels.md", "notes/relationships.md"]
        } else {
            Vec::new()
        };
        let payload = json!({
            "currentMessageId": message_id,
            "taskId": task_id,
            "assignmentReason": assignment_reason,
            "relatedMessageIds": [message_id],
            "channelSummaryRef": format!("channels/{channel_id}/summary"),
            "taskThreadRef": task_id.map(|id| format!("tasks/{id}/thread")),
            "safeMemoryRefs": safe_memory_refs,
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
        Ok(())
    }
}

impl From<CoordinatorDecision> for ResolvedCoordinatorDecision {
    fn from(decision: CoordinatorDecision) -> Self {
        Self {
            id: decision.id,
            action: enum_storage_str(&decision.action),
            assignee_agent_id: decision.assignee_agent_id,
            reason: decision.reason,
        }
    }
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
            if next.is_ascii_alphanumeric() || *next == '-' {
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
    Json(#[from] serde_json::Error),
    #[error("invalid coordinator decision id")]
    InvalidDecisionId,
    #[error("inactive idempotent message cannot be routed: {message_id}")]
    InactiveIdempotentMessage { message_id: String },
    #[error("orchestration persistence error: {0}")]
    Sql(#[from] sqlx::Error),
}
