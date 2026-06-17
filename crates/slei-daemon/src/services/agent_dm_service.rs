use std::collections::HashMap;
use std::sync::Arc;

use serde_json::Value;
use tokio::sync::Mutex;
use uuid::Uuid;

use crate::adapters::claude_worker::{
    ClaudeWorkerAdapter, ClaudeWorkerError, CreateSessionRequest, RuntimeSession,
};
use crate::adapters::worker_rpc::{WorkerEvent, WorkerRpcError};
use crate::services::agent_prompt_service::{build_agent_system_prompt, AgentSystemPromptInput};
use crate::services::card_service::{CardError, CardService, InteractiveCardView};
use crate::services::conversation_service::{
    ConversationError, ConversationMessageRecord, ConversationService,
};
use crate::services::member_service::{MemberError, MemberService};
use crate::services::reset_service::{ResetLaunchGuard, ResetRuntimeError, ResetRuntimeState};
use slei_storage::repositories::{
    sanitize_activity_payload_preview, NewAgentActivityEventRow, Repositories,
};

#[derive(Clone, Debug)]
pub struct AgentDmService {
    conversations: ConversationService,
    cards: CardService,
    members: MemberService,
    worker: ClaudeWorkerAdapter,
    runs: AgentDmRunStore,
    reset_runtime: ResetRuntimeState,
    repos: Repositories,
}

#[derive(Clone, Debug, Default)]
pub struct AgentDmRunStore {
    inner: Arc<Mutex<AgentDmState>>,
}

#[derive(Clone, Debug)]
struct AgentDmRunRecord {
    conversation_id: String,
    agent_id: String,
    message_id: String,
    generation: u64,
}

#[derive(Clone, Debug)]
struct PermissionApprovalRecord {
    request_id: String,
    run_id: String,
    tool_use_id: String,
    agent_id: String,
    conversation_id: String,
    session_id: Option<String>,
    tool_name: String,
    target_path: Option<String>,
    message_id: String,
    card_id: String,
}

#[derive(Debug, Default)]
struct AgentDmState {
    runs: HashMap<String, AgentDmRunRecord>,
    permission_approvals: HashMap<String, PermissionApprovalRecord>,
}

impl AgentDmService {
    pub fn new(
        conversations: ConversationService,
        cards: CardService,
        members: MemberService,
        worker: ClaudeWorkerAdapter,
        runs: AgentDmRunStore,
        reset_runtime: ResetRuntimeState,
        repos: Repositories,
    ) -> Self {
        Self {
            conversations,
            cards,
            members,
            worker,
            runs,
            reset_runtime,
            repos,
        }
    }

    pub async fn start_for_human_message(
        &self,
        conversation_id: &str,
        message: &ConversationMessageRecord,
    ) -> Result<Option<String>, AgentDmError> {
        let launch_guard = self.reset_runtime.begin_launch().await?;
        self.start_for_human_message_with_launch_guard(conversation_id, message, &launch_guard)
            .await
    }

    pub(crate) async fn start_for_human_message_with_launch_guard(
        &self,
        conversation_id: &str,
        message: &ConversationMessageRecord,
        launch_guard: &ResetLaunchGuard,
    ) -> Result<Option<String>, AgentDmError> {
        if !message.author_id.starts_with("human:") {
            return Ok(None);
        }
        let generation = launch_guard.generation();
        let conversation = self.conversations.get_conversation(conversation_id).await?;
        if conversation.kind != "dm" {
            return Ok(None);
        }
        let agent = self
            .members
            .get_product_agent(&conversation.agent_id)
            .await?;
        let run_id = format!("run_{}", Uuid::new_v4().simple());
        let (runtime_session, _) = self
            .conversations
            .ensure_runtime_session(conversation_id, &agent.runtime_kind)
            .await?;
        let resume_session = runtime_session.status == "ready";
        let session = self.worker.create_session(CreateSessionRequest {
            agent_id: agent.id.clone(),
            cwd: agent.workspace_path.clone(),
            session_id: runtime_session.session_id,
            resume_session,
        })?;
        let context = if resume_session {
            Vec::new()
        } else {
            self.conversations
                .runtime_context(conversation_id, &agent.id, &message.id, 5)
                .await?
        };
        let prompt = ConversationService::prompt_with_attachments(message);
        let system_prompt = build_agent_system_prompt(AgentSystemPromptInput {
            agent_id: &agent.id,
            handle: &agent.handle,
            name: &agent.name,
            role: &agent.description,
            node_id: &agent.node_id,
            cwd: &agent.workspace_path,
            session_id: &session.session_id,
            model: &agent.model,
            channel_id: None,
            channel_name: None,
            message_id: Some(&message.id),
            task_id: None,
            runtime_kind: &agent.runtime_kind,
            legacy_mode: false,
            source_message_id: None,
            notes: None,
        });
        self.worker
            .start_run(&run_id, &session, &prompt, &system_prompt, context)?;
        let record = AgentDmRunRecord {
            conversation_id: conversation_id.to_string(),
            agent_id: agent.id,
            message_id: message.id.clone(),
            generation,
        };
        self.runs
            .inner
            .lock()
            .await
            .runs
            .insert(run_id.clone(), record.clone());
        self.conversations
            .upsert_run_message(
                conversation_id,
                &conversation.agent_id,
                &run_id,
                None,
                Some("running"),
            )
            .await?;
        self.record_activity(
            &record,
            &run_id,
            "run.started",
            "info",
            format!("运行开始：run={run_id}"),
            Some(format!(
                "run_id={run_id} conversation_id={conversation_id} message_id={}",
                message.id
            )),
            None,
            None,
        )
        .await;
        self.record_activity(
            &record,
            &run_id,
            "input.received",
            "info",
            format!("收到 DM {} 消息 {}", conversation_id, message.id),
            Some(format!(
                "conversation_id={conversation_id} message_id={} prompt={prompt}",
                message.id
            )),
            None,
            None,
        )
        .await;
        Ok(Some(run_id))
    }

    pub async fn reset_runtime_session(
        &self,
        conversation_id: &str,
    ) -> Result<crate::services::conversation_service::ConversationRecord, AgentDmError> {
        let conversation = self.conversations.get_conversation(conversation_id).await?;
        if let Some(runtime_session) = conversation.runtime_session.clone() {
            let agent = self
                .members
                .get_product_agent(&conversation.agent_id)
                .await?;
            let session = RuntimeSession {
                session_id: runtime_session.session_id,
                agent_id: agent.id,
                runtime: runtime_session.runtime_kind,
                cwd: agent.workspace_path,
                persist_session: true,
                resume_session: true,
                capabilities: crate::adapters::claude_worker::RuntimeCapabilities {
                    resume_session: true,
                },
            };
            self.worker.clear_session(&session)?;
        }
        Ok(self
            .conversations
            .reset_runtime_session(conversation_id)
            .await?)
    }

    pub async fn handle_worker_event(&self, value: Value) -> Result<(), AgentDmError> {
        let activity_guard = match self.reset_runtime.begin_launch().await {
            Ok(guard) => guard,
            Err(ResetRuntimeError::ResetInProgress) => return Ok(()),
        };
        self.handle_worker_event_with_launch_guard(value, &activity_guard)
            .await
    }

    pub(crate) async fn handle_worker_event_with_launch_guard(
        &self,
        value: Value,
        _activity_guard: &ResetLaunchGuard,
    ) -> Result<(), AgentDmError> {
        let event = WorkerEvent::from_json(value)?;
        let event = event.to_run_event()?;
        let Some(run_id) = event.get("run_id").and_then(Value::as_str) else {
            return Ok(());
        };
        if self.reset_runtime.should_ignore_worker_event(run_id).await {
            return Ok(());
        }
        let Some(record) = self.runs.inner.lock().await.runs.get(run_id).cloned() else {
            return Ok(());
        };
        if self
            .reset_runtime
            .is_stale_generation(record.generation)
            .await
        {
            return Ok(());
        }

        match event.get("type").and_then(Value::as_str) {
            Some("output_delta") => {
                let delta = event
                    .get("delta")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                self.conversations
                    .upsert_run_message(
                        &record.conversation_id,
                        &record.agent_id,
                        run_id,
                        Some(delta),
                        Some("running"),
                    )
                    .await?;
                self.record_activity(
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
            }
            Some("completed") => {
                self.conversations
                    .upsert_run_message(
                        &record.conversation_id,
                        &record.agent_id,
                        run_id,
                        None,
                        Some("done"),
                    )
                    .await?;
                self.conversations
                    .mark_runtime_session_ready(&record.conversation_id)
                    .await?;
                self.record_activity(
                    &record,
                    run_id,
                    "run.completed",
                    "info",
                    format!("运行完成：run={run_id}"),
                    Some(format!(
                        "conversation_id={} message_id={} event={}",
                        record.conversation_id, record.message_id, event
                    )),
                    None,
                    Some(true),
                )
                .await;
            }
            Some("failed") => {
                let message = event
                    .get("message")
                    .and_then(Value::as_str)
                    .unwrap_or("Agent runtime failed");
                self.conversations
                    .upsert_run_message(
                        &record.conversation_id,
                        &record.agent_id,
                        run_id,
                        Some(message),
                        Some("failed"),
                    )
                    .await?;
                self.record_activity(
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
            }
            Some("tool_started") => {
                let tool_name = worker_tool_name(&event);
                self.record_activity(
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
            }
            Some("tool_completed") => {
                let tool_name = worker_tool_name(&event);
                let ok = event.get("ok").and_then(Value::as_bool).unwrap_or(true);
                self.record_activity(
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
            }
            Some("product_tool_requested") => {
                let tool_name = event
                    .get("tool_name")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                self.record_activity(
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
                    return Ok(());
                }
                let tool_use_id = event
                    .get("tool_use_id")
                    .and_then(Value::as_str)
                    .ok_or(AgentDmError::InvalidWorkerEvent("tool_use_id"))?;
                let agent_id = event
                    .get("agent_id")
                    .and_then(Value::as_str)
                    .ok_or(AgentDmError::InvalidWorkerEvent("agent_id"))?;
                if agent_id != record.agent_id {
                    return Err(AgentDmError::AgentMismatch);
                }
                let payload = event
                    .get("payload")
                    .ok_or(AgentDmError::InvalidWorkerEvent("payload"))?;
                let card = self
                    .cards
                    .propose_product_tool_card(
                        run_id,
                        agent_id,
                        &record.conversation_id,
                        payload,
                        &format!("product-tool:{run_id}:{tool_use_id}"),
                    )
                    .await?;
                let message_id = format!("card_message_{}", card.id);
                let card = self.cards.attach_message_id(&card.id, &message_id).await?;
                self.conversations
                    .upsert_card_message(
                        &record.conversation_id,
                        agent_id,
                        &message_id,
                        vec![card.to_view()],
                        Some("done"),
                    )
                    .await?;
            }
            Some("permission_requested") => {
                let request_id = event
                    .get("request_id")
                    .and_then(Value::as_str)
                    .ok_or(AgentDmError::InvalidWorkerEvent("request_id"))?;
                let tool_use_id = event
                    .get("tool_use_id")
                    .and_then(Value::as_str)
                    .ok_or(AgentDmError::InvalidWorkerEvent("tool_use_id"))?;
                let agent_id = event
                    .get("agent_id")
                    .and_then(Value::as_str)
                    .ok_or(AgentDmError::InvalidWorkerEvent("agent_id"))?;
                if agent_id != record.agent_id {
                    return Err(AgentDmError::AgentMismatch);
                }
                let tool_name = event
                    .get("tool_name")
                    .and_then(Value::as_str)
                    .unwrap_or("Write");
                let target_path = event
                    .get("target_path")
                    .and_then(Value::as_str)
                    .map(str::to_string)
                    .or_else(|| {
                        event
                            .get("input")
                            .and_then(|input| input.get("file_path"))
                            .and_then(Value::as_str)
                            .map(str::to_string)
                    });
                let session_id = event
                    .get("session_id")
                    .and_then(Value::as_str)
                    .map(str::to_string);
                let card_id = format!("card_permission_{request_id}");
                let message_id = format!("permission_message_{request_id}");
                let card = permission_approval_card(
                    &card_id,
                    request_id,
                    run_id,
                    tool_use_id,
                    agent_id,
                    tool_name,
                    target_path.as_deref(),
                    session_id.as_deref(),
                    "pending",
                );
                self.conversations
                    .upsert_card_message(
                        &record.conversation_id,
                        agent_id,
                        &message_id,
                        vec![card],
                        Some("approval"),
                    )
                    .await?;
                self.runs.inner.lock().await.permission_approvals.insert(
                    request_id.to_string(),
                    PermissionApprovalRecord {
                        request_id: request_id.to_string(),
                        run_id: run_id.to_string(),
                        tool_use_id: tool_use_id.to_string(),
                        agent_id: agent_id.to_string(),
                        conversation_id: record.conversation_id,
                        session_id,
                        tool_name: tool_name.to_string(),
                        target_path,
                        message_id,
                        card_id,
                    },
                );
            }
            _ => {}
        }
        Ok(())
    }

    async fn record_activity(
        &self,
        record: &AgentDmRunRecord,
        run_id: &str,
        event_kind: &str,
        severity: &str,
        summary: String,
        payload_preview: Option<String>,
        tool_name: Option<String>,
        ok: Option<bool>,
    ) {
        let _ = self
            .repos
            .record_agent_activity_event(NewAgentActivityEventRow {
                agent_id: record.agent_id.clone(),
                run_id: Some(run_id.to_string()),
                channel_id: None,
                message_id: Some(record.message_id.clone()),
                task_id: None,
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

    pub async fn resolve_permission(
        &self,
        request_id: &str,
        decision: &str,
    ) -> Result<ConversationMessageRecord, AgentDmError> {
        let approval = self
            .runs
            .inner
            .lock()
            .await
            .permission_approvals
            .get(request_id)
            .cloned()
            .ok_or(AgentDmError::InvalidWorkerEvent("request_id"))?;
        let normalized = match decision {
            "approve" | "approve_once" => "approve_once",
            "approve_session" => "approve_session",
            "deny" => "deny",
            _ => return Err(AgentDmError::InvalidWorkerEvent("decision")),
        };
        self.worker
            .resolve_permission(&approval.request_id, normalized)?;
        let state = if normalized == "deny" {
            "rejected"
        } else {
            "done"
        };
        let status = if normalized == "deny" {
            "failed"
        } else {
            "done"
        };
        let card = permission_approval_card(
            &approval.card_id,
            &approval.request_id,
            &approval.run_id,
            &approval.tool_use_id,
            &approval.agent_id,
            &approval.tool_name,
            approval.target_path.as_deref(),
            approval.session_id.as_deref(),
            state,
        );
        Ok(self
            .conversations
            .upsert_card_message(
                &approval.conversation_id,
                &approval.agent_id,
                &approval.message_id,
                vec![card],
                Some(status),
            )
            .await?)
    }
}

impl AgentDmRunStore {
    pub async fn active_run_ids(&self) -> Vec<String> {
        self.inner.lock().await.runs.keys().cloned().collect()
    }

    pub async fn cancel_all_for_reset(
        &self,
        worker: &ClaudeWorkerAdapter,
        reset_runtime: &ResetRuntimeState,
    ) -> Result<(), ClaudeWorkerError> {
        let run_ids = {
            let mut state = self.inner.lock().await;
            state.permission_approvals.clear();
            state
                .runs
                .drain()
                .map(|(run_id, _)| run_id)
                .collect::<Vec<_>>()
        };
        reset_runtime.mark_cancelled_runs(run_ids.clone()).await;
        for run_id in run_ids {
            worker.cancel_run(&run_id)?;
        }
        Ok(())
    }
}

fn permission_approval_card(
    card_id: &str,
    request_id: &str,
    run_id: &str,
    tool_use_id: &str,
    agent_id: &str,
    tool_name: &str,
    target_path: Option<&str>,
    session_id: Option<&str>,
    state: &str,
) -> InteractiveCardView {
    let target = target_path.unwrap_or("未知路径");
    InteractiveCardView {
        id: card_id.to_string(),
        kind: "permissionApproval".to_string(),
        state: state.to_string(),
        title: "需要写入授权".to_string(),
        summary: format!("{tool_name} {target}"),
        draft: serde_json::json!({
            "requestId": request_id,
            "runId": run_id,
            "toolUseId": tool_use_id,
            "agentId": agent_id,
            "toolName": tool_name,
            "targetPath": target,
            "sessionId": session_id,
            "risk": "controlled",
            "scope": "session",
        }),
        action_label: "允许一次".to_string(),
        done_label: "已处理".to_string(),
    }
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
pub enum AgentDmError {
    #[error(transparent)]
    Conversation(#[from] ConversationError),
    #[error(transparent)]
    Member(#[from] MemberError),
    #[error(transparent)]
    Card(#[from] CardError),
    #[error("worker product tool event is missing or invalid field: {0}")]
    InvalidWorkerEvent(&'static str),
    #[error("worker product tool agent does not match the active run")]
    AgentMismatch,
    #[error(transparent)]
    Worker(#[from] ClaudeWorkerError),
    #[error(transparent)]
    WorkerRpc(#[from] WorkerRpcError),
    #[error(transparent)]
    Reset(#[from] ResetRuntimeError),
}
