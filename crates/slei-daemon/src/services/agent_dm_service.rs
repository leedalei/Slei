use std::collections::HashMap;
use std::sync::Arc;

use serde_json::Value;
use tokio::sync::Mutex;
use uuid::Uuid;

use crate::adapters::claude_worker::{
    ClaudeWorkerAdapter, ClaudeWorkerError, CreateSessionRequest, RuntimeSession,
};
use crate::adapters::worker_rpc::{WorkerEvent, WorkerRpcError};
use crate::services::card_service::{CardError, CardService};
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
    inner: Arc<Mutex<HashMap<String, AgentDmRunRecord>>>,
}

#[derive(Clone, Debug)]
struct AgentDmRunRecord {
    conversation_id: String,
    agent_id: String,
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
        self.runs.inner.lock().await.insert(
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
        let Some(record) = self.runs.inner.lock().await.get(run_id).cloned() else {
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
            _ => {}
        }
        Ok(())
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
