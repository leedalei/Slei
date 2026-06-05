use std::collections::HashMap;
use std::sync::Arc;

use serde_json::Value;
use tokio::sync::Mutex;
use uuid::Uuid;

use crate::adapters::claude_worker::{
    ClaudeWorkerAdapter, ClaudeWorkerError, CreateSessionRequest, RuntimeSession,
};
use crate::adapters::worker_rpc::{WorkerEvent, WorkerRpcError};
use crate::services::card_service::{CardError, CardService, InteractiveCardView};
use crate::services::conversation_service::{
    ConversationError, ConversationMessageRecord, ConversationService,
};
use crate::services::member_service::{MemberError, MemberService};

#[derive(Clone, Debug)]
pub struct AgentDmService {
    conversations: ConversationService,
    cards: CardService,
    members: MemberService,
    worker: ClaudeWorkerAdapter,
    runs: AgentDmRunStore,
}

#[derive(Clone, Debug, Default)]
pub struct AgentDmRunStore {
    inner: Arc<Mutex<AgentDmState>>,
}

#[derive(Clone, Debug)]
struct AgentDmRunRecord {
    conversation_id: String,
    agent_id: String,
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
    ) -> Self {
        Self {
            conversations,
            cards,
            members,
            worker,
            runs,
        }
    }

    pub async fn start_for_human_message(
        &self,
        conversation_id: &str,
        message: &ConversationMessageRecord,
    ) -> Result<Option<String>, AgentDmError> {
        if !message.author_id.starts_with("human:") {
            return Ok(None);
        }
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
        self.worker.start_run(&run_id, &session, &prompt, context)?;
        self.runs.inner.lock().await.runs.insert(
            run_id.clone(),
            AgentDmRunRecord {
                conversation_id: conversation_id.to_string(),
                agent_id: agent.id,
            },
        );
        self.conversations
            .upsert_run_message(
                conversation_id,
                &conversation.agent_id,
                &run_id,
                None,
                Some("running"),
            )
            .await?;
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
        let event = WorkerEvent::from_json(value)?;
        let event = event.to_run_event()?;
        let Some(run_id) = event.get("run_id").and_then(Value::as_str) else {
            return Ok(());
        };
        let Some(record) = self.runs.inner.lock().await.runs.get(run_id).cloned() else {
            return Ok(());
        };

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
            }
            Some("product_tool_requested") => {
                let tool_name = event
                    .get("tool_name")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
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
                self.conversations
                    .upsert_card_message(
                        &record.conversation_id,
                        agent_id,
                        &message_id,
                        vec![card],
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
}
