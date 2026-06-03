use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};

use serde::Serialize;
use serde_json::json;
use uuid::Uuid;

use crate::services::agent_inbox_service::AgentInboxService;
use crate::services::channel_service::{ChannelError, ChannelMemberReadiness, ChannelService};
use crate::services::coordinator_service::{
    CoordinatorAction, CoordinatorInput, CoordinatorService,
};
use crate::services::member_service::MemberService;
use crate::services::message_service::{MessageError, MessageService};
use crate::services::orchestration_store::OrchestrationStore;
use crate::services::task_service::{TaskError, TaskService};

#[derive(Clone, Debug)]
pub struct SendChannelMessageInput {
    pub channel_id: String,
    pub author_id: String,
    pub body: String,
    pub idempotency_key: String,
}

#[derive(Clone, Debug)]
pub struct SendChannelMessageOutcome {
    pub message_id: String,
    pub action: String,
    pub task_id: Option<String>,
    pub assignee_agent_id: Option<String>,
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
        }
    }

    pub async fn send_channel_message(
        &self,
        input: SendChannelMessageInput,
    ) -> Result<SendChannelMessageOutcome, ChannelOrchestratorError> {
        if let Some(outcome) = self
            .outcome_idempotency
            .lock()
            .expect("channel orchestrator idempotency lock")
            .get(&input.idempotency_key)
            .cloned()
        {
            return Ok(outcome);
        }

        let message = self
            .messages
            .create_human_channel_message(
                &input.channel_id,
                &input.author_id,
                &input.body,
                &input.idempotency_key,
            )
            .await?;

        let channel_members = self.channels.channel_members(&input.channel_id).await?;
        let readiness_by_agent = channel_members
            .iter()
            .map(|member| (member.agent_id.clone(), member.readiness.clone()))
            .collect::<HashMap<_, _>>();
        let member_ids = readiness_by_agent.keys().cloned().collect::<HashSet<_>>();
        let explicit_agent_ids = self
            .resolve_explicit_mentions(&input.body, &member_ids)
            .await;
        let ready_agent_ids = channel_members
            .iter()
            .filter(|member| member.readiness == ChannelMemberReadiness::Ready)
            .map(|member| member.agent_id.clone())
            .collect::<Vec<_>>();

        let decision = self
            .coordinator
            .decide(CoordinatorInput {
                channel_id: input.channel_id.clone(),
                message_id: message.id.clone(),
                body: input.body.clone(),
                explicit_agent_ids: explicit_agent_ids.clone(),
                ready_agent_ids,
            })
            .await;

        let mut task_id = None;
        match decision.action {
            CoordinatorAction::RequestAgentReply => {
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
                        self.agent_inbox
                            .create_human_mention(
                                &agent_id,
                                &input.channel_id,
                                &message.id,
                                readiness.clone(),
                            )
                            .await;
                    }
                }
            }
            CoordinatorAction::CreateTaskAndAssign | CoordinatorAction::NeedsManualAssignment => {
                let assignee = match decision.action {
                    CoordinatorAction::CreateTaskAndAssign => decision.assignee_agent_id.clone(),
                    _ => None,
                };
                let task = self
                    .tasks
                    .create_from_coordinator(
                        &input.channel_id,
                        &input.author_id,
                        &message.id,
                        &input.body,
                        assignee.clone(),
                        &decision.reason,
                        &format!("{}:coordinator-task", input.idempotency_key),
                    )
                    .await?;
                self.messages
                    .create_task_card_message(&input.channel_id, &task.id, &message.id)
                    .await?;
                if let Some(agent_id) = assignee.as_deref() {
                    self.agent_inbox
                        .create_task_assignment(agent_id, &input.channel_id, &task.id, &message.id)
                        .await;
                }
                task_id = Some(task.id);
            }
            CoordinatorAction::ArchiveOnly => {}
        }

        self.persist_routing_context(
            &decision.id,
            &input.channel_id,
            &message.id,
            task_id.as_deref(),
            &decision.reason,
            decision.assignee_agent_id.as_deref(),
        )
        .await?;

        let outcome = SendChannelMessageOutcome {
            message_id: message.id,
            action: enum_storage_str(&decision.action),
            task_id,
            assignee_agent_id: decision.assignee_agent_id,
        };
        self.outcome_idempotency
            .lock()
            .expect("channel orchestrator idempotency lock")
            .insert(input.idempotency_key, outcome.clone());
        Ok(outcome)
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

    async fn persist_routing_context(
        &self,
        decision_id: &str,
        channel_id: &str,
        message_id: &str,
        task_id: Option<&str>,
        assignment_reason: &str,
        assignee_agent_id: Option<&str>,
    ) -> Result<(), ChannelOrchestratorError> {
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

fn explicit_handles(body: &str) -> Vec<String> {
    body.split_whitespace()
        .filter_map(|part| part.strip_prefix('@'))
        .filter_map(|handle| {
            let normalized = handle
                .trim_matches(|character: char| {
                    !(character.is_ascii_alphanumeric() || character == '-')
                })
                .to_lowercase();
            (!normalized.is_empty()).then(|| format!("@{normalized}"))
        })
        .collect()
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
    Json(#[from] serde_json::Error),
    #[error("invalid coordinator decision id")]
    InvalidDecisionId,
    #[error("orchestration persistence error: {0}")]
    Sql(#[from] sqlx::Error),
}
