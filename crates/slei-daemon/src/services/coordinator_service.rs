use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;
use uuid::Uuid;

use crate::adapters::claude_worker::{ClaudeWorkerAdapter, CreateSessionRequest};
use crate::adapters::worker_rpc::WorkerTransport;
use crate::services::member_service::{is_internal_coordinator_id, GLOBAL_COORDINATOR_AGENT_ID};
use crate::services::orchestration_store::OrchestrationStore;
use crate::services::reset_service::{ResetLaunchGuard, ResetRuntimeState};

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum IntentKind {
    Consultation,
    TaskCommand,
    StatusUpdate,
    Noise,
    Ambiguous,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CoordinatorAction {
    ArchiveOnly,
    RequestAgentReply,
    CreateTaskAndAssign,
    NeedsManualAssignment,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RouteMode {
    Explicit,
    Broadcast,
    Semantic,
    Task,
    None,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CoordinatorInput {
    pub channel_id: String,
    pub message_id: String,
    pub body: String,
    pub explicit_agent_ids: Vec<String>,
    pub ready_agent_ids: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CoordinatorDecision {
    pub id: String,
    pub channel_id: String,
    pub message_id: String,
    pub intent: IntentKind,
    pub action: CoordinatorAction,
    pub assignee_agent_id: Option<String>,
    pub assignee_agent_ids: Vec<String>,
    pub task: Option<CoordinatorTaskJson>,
    pub reason: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CoordinatorPromptInput {
    pub channel_id: String,
    pub channel_name: String,
    pub message_id: String,
    pub author_id: String,
    pub body: String,
    pub members: Vec<CoordinatorPromptMember>,
    pub context_refs: Vec<String>,
    pub workspace_mounts: Vec<WorkspaceMount>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CoordinatorPromptMember {
    pub agent_id: String,
    pub name: String,
    pub handle: String,
    pub agent_kind: String,
    pub readiness: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceMount {
    pub path: String,
    pub label: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CoordinatorDecisionJson {
    pub intent: IntentKind,
    pub action: CoordinatorAction,
    pub route_mode: RouteMode,
    pub primary_assignee_agent_id: Option<String>,
    pub target_agent_ids: Vec<String>,
    pub task: Option<CoordinatorTaskJson>,
    pub reason: String,
    pub confidence: f32,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CoordinatorTaskJson {
    pub title: String,
    pub summary: String,
    pub assignee_agent_id: Option<String>,
    pub collaborator_agent_ids: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CoordinatorRuntimeInput {
    pub run_id: String,
    pub channel_id: String,
    pub channel_name: String,
    pub message_id: String,
    pub author_id: String,
    pub body: String,
    pub members: Vec<CoordinatorPromptMember>,
    pub context_refs: Vec<String>,
    pub workspace_mounts: Vec<WorkspaceMount>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CoordinatorRuntimeRun {
    pub run_id: String,
    pub message_id: String,
}

#[derive(Clone, Debug, PartialEq, Eq, thiserror::Error)]
pub enum CoordinatorDecisionError {
    #[error("invalid coordinator JSON: {0}")]
    InvalidJson(String),
    #[error("invalid coordinator target: {0}")]
    InvalidTarget(String),
    #[error("compat coordinator target missing from target list: {0}")]
    MissingCompatTarget(String),
    #[error("worker error: {0}")]
    Worker(String),
}

#[derive(Clone, Debug)]
pub struct CoordinatorService {
    store: OrchestrationStore,
    worker: ClaudeWorkerAdapter,
    reset_runtime: ResetRuntimeState,
    cache: Arc<Mutex<Vec<CoordinatorDecision>>>,
}

impl CoordinatorService {
    pub fn new(store: OrchestrationStore) -> Self {
        Self::new_with_worker(store, ClaudeWorkerAdapter::new(WorkerTransport::fake()))
    }

    pub fn new_with_worker(store: OrchestrationStore, worker: ClaudeWorkerAdapter) -> Self {
        Self::new_with_worker_and_reset(store, worker, ResetRuntimeState::default())
    }

    pub fn new_with_worker_and_reset(
        store: OrchestrationStore,
        worker: ClaudeWorkerAdapter,
        reset_runtime: ResetRuntimeState,
    ) -> Self {
        Self {
            store,
            worker,
            reset_runtime,
            cache: Arc::new(Mutex::new(Vec::new())),
        }
    }

    pub async fn start_runtime_run(
        &self,
        input: CoordinatorRuntimeInput,
    ) -> Result<CoordinatorRuntimeRun, CoordinatorDecisionError> {
        let launch_guard = self
            .reset_runtime
            .begin_launch()
            .await
            .map_err(|error| CoordinatorDecisionError::Worker(error.to_string()))?;
        self.start_runtime_run_with_launch_guard(input, &launch_guard)
            .await
    }

    pub(crate) async fn start_runtime_run_with_launch_guard(
        &self,
        input: CoordinatorRuntimeInput,
        _launch_guard: &ResetLaunchGuard,
    ) -> Result<CoordinatorRuntimeRun, CoordinatorDecisionError> {
        let prompt = build_coordinator_prompt(CoordinatorPromptInput {
            channel_id: input.channel_id.clone(),
            channel_name: input.channel_name,
            message_id: input.message_id.clone(),
            author_id: input.author_id,
            body: input.body,
            members: input.members,
            context_refs: input.context_refs,
            workspace_mounts: input.workspace_mounts.clone(),
        });
        let cwd = input
            .workspace_mounts
            .first()
            .map(|mount| mount.path.clone())
            .unwrap_or_else(|| ".".to_string());
        let session = self
            .worker
            .create_session(CreateSessionRequest {
                agent_id: GLOBAL_COORDINATOR_AGENT_ID.to_string(),
                cwd,
                session_id: Uuid::new_v4().to_string(),
                resume_session: false,
            })
            .map_err(|error| CoordinatorDecisionError::Worker(error.to_string()))?;
        self.worker
            .start_run(&input.run_id, &session, &prompt, Vec::new())
            .map_err(|error| CoordinatorDecisionError::Worker(error.to_string()))?;
        Ok(CoordinatorRuntimeRun {
            run_id: input.run_id,
            message_id: input.message_id,
        })
    }

    pub async fn decide(&self, input: CoordinatorInput) -> CoordinatorDecision {
        let id = Uuid::new_v4();
        let intent = classify_intent(&input.body);
        let ready_reply_agent_ids = input
            .ready_agent_ids
            .iter()
            .filter(|agent_id| !is_internal_coordinator_id(agent_id))
            .cloned()
            .collect::<Vec<_>>();
        let ready_assignee = ready_reply_agent_ids.first().cloned();
        let action = if !input.explicit_agent_ids.is_empty() {
            CoordinatorAction::RequestAgentReply
        } else if is_broadcast_or_greeting(&input.body) && ready_assignee.is_some() {
            CoordinatorAction::RequestAgentReply
        } else {
            action_for_intent(&intent, ready_assignee.as_deref())
        };
        let assignee_agent_id = assignee_for_action(
            &action,
            &intent,
            &input.explicit_agent_ids,
            &ready_reply_agent_ids,
        );
        let reason = reason_for_decision(&intent, &action, assignee_agent_id.as_deref());

        let decision = CoordinatorDecision {
            id: id.to_string(),
            channel_id: input.channel_id,
            message_id: input.message_id,
            intent,
            action,
            assignee_agent_ids: assignee_agent_id.iter().cloned().collect(),
            assignee_agent_id,
            task: None,
            reason,
        };

        self.store
            .record_decision(
                id,
                &decision.channel_id,
                &decision.message_id,
                &enum_as_storage_str(&decision.intent),
                &enum_as_storage_str(&decision.action),
                decision.assignee_agent_id.as_deref(),
                &decision.assignee_agent_ids,
                &decision.reason,
            )
            .await
            .expect("persist coordinator decision");
        eprintln!(
            "[slei-coordinator] channel_id={} message_id={} intent={} action={} assignee_agent_id={} ready_agents={} explicit_agents={} reason={}",
            decision.channel_id,
            decision.message_id,
            enum_as_storage_str(&decision.intent),
            enum_as_storage_str(&decision.action),
            decision.assignee_agent_id.as_deref().unwrap_or("none"),
            ready_reply_agent_ids.join(","),
            input.explicit_agent_ids.join(","),
            decision.reason
        );
        self.cache.lock().await.push(decision.clone());
        decision
    }

    pub async fn cached_decisions(&self) -> Vec<CoordinatorDecision> {
        self.cache.lock().await.clone()
    }
}

pub fn build_coordinator_prompt(input: CoordinatorPromptInput) -> String {
    let roster = input
        .members
        .iter()
        .map(|member| {
            format!(
                "- agentId: {}\n  name: {}\n  handle: {}\n  agentKind: {}\n  readiness: {}",
                member.agent_id, member.name, member.handle, member.agent_kind, member.readiness
            )
        })
        .collect::<Vec<_>>()
        .join("\n");
    let context_refs = if input.context_refs.is_empty() {
        "[]".to_string()
    } else {
        serde_json::to_string(&input.context_refs).expect("serialize context refs")
    };
    let workspace_mounts =
        serde_json::to_string(&input.workspace_mounts).expect("serialize workspace mounts");

    format!(
        r#"Coordinator must not visibly answer the user. You are a control-plane router for channel messages.
Return JSON only.

Routing policy:
- Mentions may appear at the beginning, middle, or end of the message.
- Users may request one Agent, multiple Agents, or semantic groups without exact @handle syntax.
- Choose only non-coordinator channel members as downstream targets.
- For task commands, return task metadata instead of an ordinary visible reply.
- After routing, there is no product-level "primary Agent" workflow. You are only choosing which Agent(s) to @ first.
- Routed Agents decide any later handoff themselves from their memory of channel members and relationships.
- The primaryAssigneeAgentId and task.assigneeAgentId fields are compatibility fields only. For request_agent_reply, targetAgentIds is the source of truth.
- Do not explain routing in prose. Return only the JSON object.

Channel:
- channelId: {channel_id}
- channelName: {channel_name}
- messageId: {message_id}
- authorId: {author_id}

Raw message body:
{body}

Channel members:
{roster}

Context refs:
{context_refs}

Workspace mounts:
{workspace_mounts}

Schema:
{{
  "intent": "consultation | task_command | status_update | noise | ambiguous",
  "action": "request_agent_reply | create_task_and_assign | needs_manual_assignment | archive_only",
  "routeMode": "explicit | broadcast | semantic | task | none",
  "primaryAssigneeAgentId": "agent_id or null",
  "targetAgentIds": ["agent_id"],
  "task": {{
    "title": "short task title",
    "summary": "task summary",
    "assigneeAgentId": "agent_id or null",
    "collaboratorAgentIds": ["agent_id"]
  }},
  "reason": "brief reason",
  "confidence": 0.0
}}"#,
        channel_id = input.channel_id,
        channel_name = input.channel_name,
        message_id = input.message_id,
        author_id = input.author_id,
        body = input.body,
        roster = roster,
        context_refs = context_refs,
        workspace_mounts = workspace_mounts,
    )
}

pub fn parse_and_validate_coordinator_json(
    raw: &str,
    members: &[CoordinatorPromptMember],
) -> Result<CoordinatorDecision, CoordinatorDecisionError> {
    let parsed: CoordinatorDecisionJson = serde_json::from_str(raw)
        .map_err(|error| CoordinatorDecisionError::InvalidJson(error.to_string()))?;
    validate_coordinator_decision(parsed, members)
}

fn validate_coordinator_decision(
    parsed: CoordinatorDecisionJson,
    members: &[CoordinatorPromptMember],
) -> Result<CoordinatorDecision, CoordinatorDecisionError> {
    let mut target_agent_ids = Vec::new();
    for agent_id in parsed.target_agent_ids {
        validate_member_target(&agent_id, members)?;
        if !target_agent_ids.contains(&agent_id) {
            target_agent_ids.push(agent_id);
        }
    }

    if let Some(primary) = parsed.primary_assignee_agent_id.as_deref() {
        validate_member_target(primary, members)?;
        if !target_agent_ids.iter().any(|agent_id| agent_id == primary) {
            return Err(CoordinatorDecisionError::MissingCompatTarget(
                primary.to_string(),
            ));
        }
    }

    if let Some(task) = parsed.task.as_ref() {
        if let Some(assignee) = task.assignee_agent_id.as_deref() {
            validate_member_target(assignee, members)?;
        }
        for collaborator in &task.collaborator_agent_ids {
            validate_member_target(collaborator, members)?;
        }
    }

    let assignee_agent_id = parsed
        .task
        .as_ref()
        .and_then(|task| task.assignee_agent_id.clone())
        .or(parsed.primary_assignee_agent_id);

    Ok(CoordinatorDecision {
        id: Uuid::new_v4().to_string(),
        channel_id: String::new(),
        message_id: String::new(),
        intent: parsed.intent,
        action: parsed.action,
        assignee_agent_id,
        assignee_agent_ids: target_agent_ids,
        task: parsed.task,
        reason: parsed.reason,
    })
}

fn validate_member_target(
    agent_id: &str,
    members: &[CoordinatorPromptMember],
) -> Result<(), CoordinatorDecisionError> {
    let Some(member) = members.iter().find(|member| member.agent_id == agent_id) else {
        return Err(CoordinatorDecisionError::InvalidTarget(
            agent_id.to_string(),
        ));
    };
    if member.agent_kind == "coordinator" || is_internal_coordinator_id(&member.agent_id) {
        return Err(CoordinatorDecisionError::InvalidTarget(
            agent_id.to_string(),
        ));
    }
    Ok(())
}

fn classify_intent(body: &str) -> IntentKind {
    let trimmed = body.trim();
    if trimmed.is_empty() {
        return IntentKind::Noise;
    }

    if contains_any(
        trimmed,
        &[
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
        ],
    ) {
        return IntentKind::TaskCommand;
    }

    if contains_any(
        trimmed,
        &["?", "？", "怎么看", "为什么", "怎么", "没人说话"],
    ) {
        return IntentKind::Consultation;
    }

    IntentKind::Ambiguous
}

fn is_broadcast_or_greeting(body: &str) -> bool {
    contains_any(
        body,
        &[
            "大家",
            "所有人",
            "@all",
            "@everyone",
            "hello",
            "hi",
            "嗨",
            "你好",
            "报数",
        ],
    )
}

fn action_for_intent(intent: &IntentKind, ready_assignee: Option<&str>) -> CoordinatorAction {
    match (intent, ready_assignee) {
        (IntentKind::TaskCommand, Some(_)) => CoordinatorAction::CreateTaskAndAssign,
        (IntentKind::TaskCommand, None) => CoordinatorAction::NeedsManualAssignment,
        (IntentKind::Consultation, Some(_)) => CoordinatorAction::RequestAgentReply,
        _ => CoordinatorAction::ArchiveOnly,
    }
}

fn assignee_for_action(
    action: &CoordinatorAction,
    intent: &IntentKind,
    explicit_agent_ids: &[String],
    ready_agent_ids: &[String],
) -> Option<String> {
    match (action, intent) {
        (CoordinatorAction::RequestAgentReply, _) if !explicit_agent_ids.is_empty() => {
            explicit_agent_ids.first().cloned()
        }
        (CoordinatorAction::RequestAgentReply, _)
        | (CoordinatorAction::CreateTaskAndAssign, IntentKind::TaskCommand) => {
            ready_agent_ids.first().cloned()
        }
        _ => None,
    }
}

fn reason_for_decision(
    intent: &IntentKind,
    action: &CoordinatorAction,
    assignee_agent_id: Option<&str>,
) -> String {
    match (intent, action, assignee_agent_id) {
        (_, CoordinatorAction::RequestAgentReply, Some(agent_id)) => {
            format!("requesting reply from {agent_id}")
        }
        (IntentKind::TaskCommand, CoordinatorAction::CreateTaskAndAssign, Some(agent_id)) => {
            format!("task command assigned to ready agent {agent_id}")
        }
        (IntentKind::TaskCommand, CoordinatorAction::NeedsManualAssignment, None) => {
            "task command has no ready assignee".to_string()
        }
        (IntentKind::Noise, CoordinatorAction::ArchiveOnly, None) => {
            "empty message archived".to_string()
        }
        _ => "no coordinator action required".to_string(),
    }
}

fn contains_any(body: &str, markers: &[&str]) -> bool {
    markers.iter().any(|marker| body.contains(marker))
}

fn enum_as_storage_str<T>(value: &T) -> String
where
    T: Serialize,
{
    serde_json::to_value(value)
        .expect("serialize coordinator enum")
        .as_str()
        .expect("coordinator enum serializes to string")
        .to_string()
}
