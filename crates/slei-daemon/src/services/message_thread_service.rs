use serde::{Deserialize, Serialize};
use slei_storage::repositories::{MessageThreadReplyRow, MessageThreadRow, Repositories};
use uuid::Uuid;

use crate::services::conversation_service::{ConversationError, ConversationService};
use crate::services::idempotency::namespaced_key;
use crate::services::message_service::{MessageError, MessageService};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MessageThreadSummaryView {
    pub id: String,
    pub source_message_id: String,
    pub source_kind: String,
    pub source_id: String,
    pub reply_count: usize,
    pub updated_at: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MessageThreadReplyView {
    pub id: String,
    pub thread_id: String,
    pub sender_id: String,
    pub role: String,
    pub body: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub run_id: Option<String>,
    pub created_at: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EnsureMessageThreadOutcome {
    pub thread: MessageThreadSummaryView,
    pub created: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MessageThreadView {
    pub thread: MessageThreadSummaryView,
    pub replies: Vec<MessageThreadReplyView>,
}

#[derive(Clone, Debug)]
pub struct MessageThreadService {
    repos: Repositories,
    messages: MessageService,
    conversations: ConversationService,
}

impl MessageThreadService {
    pub fn new(
        repos: Repositories,
        messages: MessageService,
        conversations: ConversationService,
    ) -> Self {
        Self {
            repos,
            messages,
            conversations,
        }
    }

    pub async fn ensure_thread_for_source_message(
        &self,
        source_message_id: &str,
        created_by: &str,
        idempotency_key: &str,
    ) -> Result<EnsureMessageThreadOutcome, MessageThreadError> {
        let source_message_id = source_message_id.trim();
        let created_by = created_by.trim();
        if source_message_id.is_empty() || created_by.is_empty() {
            return Err(MessageThreadError::InvalidThreadInput);
        }
        let idempotency_key = namespaced_key("message_thread:ensure", idempotency_key)
            .ok_or(MessageThreadError::MissingIdempotencyKey)?;

        if let Some(existing) = self
            .repos
            .message_thread_by_source_message(source_message_id)
            .await
            .map_err(storage_error)?
        {
            return Ok(EnsureMessageThreadOutcome {
                thread: summary_from_row(existing),
                created: false,
            });
        }

        let source = self.resolve_source(source_message_id).await?;
        let now = now_string();
        let row = MessageThreadRow {
            id: format!("thread_{}", Uuid::new_v4().simple()),
            source_message_id: source_message_id.to_string(),
            source_kind: source.kind,
            source_id: source.id,
            created_by: created_by.to_string(),
            reply_count: 0,
            created_at: now.clone(),
            updated_at: now,
        };
        self.repos
            .upsert_message_thread_idempotent(
                row.clone(),
                &idempotency_key,
                &serde_json::json!({ "threadId": row.id }).to_string(),
            )
            .await
            .map_err(storage_error)?;
        let stored = self
            .repos
            .message_thread_by_source_message(source_message_id)
            .await
            .map_err(storage_error)?
            .ok_or(MessageThreadError::ThreadNotFound)?;
        Ok(EnsureMessageThreadOutcome {
            thread: summary_from_row(stored),
            created: true,
        })
    }

    pub async fn get_thread(
        &self,
        thread_id: &str,
    ) -> Result<MessageThreadView, MessageThreadError> {
        let thread_id = thread_id.trim();
        if thread_id.is_empty() {
            return Err(MessageThreadError::InvalidThreadInput);
        }
        let thread = self
            .repos
            .message_thread_by_id(thread_id)
            .await
            .map_err(storage_error)?
            .ok_or(MessageThreadError::ThreadNotFound)?;
        let replies = self
            .repos
            .message_thread_replies(thread_id)
            .await
            .map_err(storage_error)?
            .into_iter()
            .map(reply_from_row)
            .collect();
        Ok(MessageThreadView {
            thread: summary_from_row(thread),
            replies,
        })
    }

    pub async fn thread_summary_for_source_message(
        &self,
        source_message_id: &str,
    ) -> Option<MessageThreadSummaryView> {
        self.repos
            .message_thread_by_source_message(source_message_id)
            .await
            .ok()
            .flatten()
            .map(summary_from_row)
    }

    pub async fn add_reply(
        &self,
        thread_id: &str,
        sender_id: &str,
        role: Option<&str>,
        body: &str,
        idempotency_key: &str,
    ) -> Result<MessageThreadReplyView, MessageThreadError> {
        let thread_id = thread_id.trim();
        let sender_id = sender_id.trim();
        let body = body.trim();
        if thread_id.is_empty() || sender_id.is_empty() || body.is_empty() {
            return Err(MessageThreadError::InvalidThreadInput);
        }
        self.repos
            .message_thread_by_id(thread_id)
            .await
            .map_err(storage_error)?
            .ok_or(MessageThreadError::ThreadNotFound)?;

        let idempotency_key = namespaced_key("message_thread:reply", idempotency_key)
            .ok_or(MessageThreadError::MissingIdempotencyKey)?;
        if let Some(payload) = self
            .repos
            .idempotent_response(&idempotency_key)
            .await
            .map_err(storage_error)?
        {
            return serde_json::from_str::<MessageThreadReplyView>(&payload)
                .map_err(|error| MessageThreadError::Storage(error.to_string()));
        }

        let created_at = now_string();
        let row = MessageThreadReplyRow {
            id: format!("reply_{}", Uuid::new_v4().simple()),
            thread_id: thread_id.to_string(),
            sender_id: sender_id.to_string(),
            role: role
                .map(str::trim)
                .filter(|role| !role.is_empty())
                .map(str::to_string)
                .unwrap_or_else(|| default_role(sender_id).to_string()),
            body: body.to_string(),
            status: None,
            run_id: None,
            created_at,
        };
        let reply = reply_from_row(row.clone());
        let payload = serde_json::to_string(&reply)
            .map_err(|error| MessageThreadError::Storage(error.to_string()))?;
        self.repos
            .insert_message_thread_reply_idempotent(row, &idempotency_key, &payload)
            .await
            .map_err(storage_error)?;
        Ok(reply)
    }

    async fn resolve_source(
        &self,
        source_message_id: &str,
    ) -> Result<ThreadSource, MessageThreadError> {
        match self.messages.message(source_message_id).await {
            Ok(message) => {
                return Ok(ThreadSource {
                    kind: "channel".to_string(),
                    id: message.channel_id,
                });
            }
            Err(MessageError::MessageNotFound) => {}
            Err(error) => return Err(MessageThreadError::Storage(error.to_string())),
        }

        match self.conversations.message(source_message_id).await {
            Ok(message) => {
                return Ok(ThreadSource {
                    kind: "dm".to_string(),
                    id: message.conversation_id,
                });
            }
            Err(ConversationError::ConversationNotFound) => {}
            Err(error) => return Err(MessageThreadError::Storage(error.to_string())),
        }

        if self
            .repos
            .message_thread_reply_by_id(source_message_id)
            .await
            .map_err(storage_error)?
            .is_some()
        {
            return Err(MessageThreadError::NestedThreadNotAllowed);
        }

        Err(MessageThreadError::SourceMessageNotFound)
    }
}

#[derive(Debug, thiserror::Error)]
pub enum MessageThreadError {
    #[error("message thread not found")]
    ThreadNotFound,
    #[error("source message not found")]
    SourceMessageNotFound,
    #[error("nested message threads are not allowed")]
    NestedThreadNotAllowed,
    #[error("invalid message thread input")]
    InvalidThreadInput,
    #[error("missing idempotency key")]
    MissingIdempotencyKey,
    #[error("message thread storage error: {0}")]
    Storage(String),
}

struct ThreadSource {
    kind: String,
    id: String,
}

fn summary_from_row(row: MessageThreadRow) -> MessageThreadSummaryView {
    MessageThreadSummaryView {
        id: row.id,
        source_message_id: row.source_message_id,
        source_kind: row.source_kind,
        source_id: row.source_id,
        reply_count: row.reply_count.max(0) as usize,
        updated_at: row.updated_at,
    }
}

fn reply_from_row(row: MessageThreadReplyRow) -> MessageThreadReplyView {
    MessageThreadReplyView {
        id: row.id,
        thread_id: row.thread_id,
        sender_id: row.sender_id,
        role: row.role,
        body: row.body,
        status: row.status,
        run_id: row.run_id,
        created_at: row.created_at,
    }
}

fn default_role(sender_id: &str) -> &'static str {
    if sender_id.starts_with("human") {
        "human"
    } else if sender_id.starts_with("agent") {
        "agent"
    } else {
        "system"
    }
}

fn storage_error(error: sqlx::Error) -> MessageThreadError {
    MessageThreadError::Storage(error.to_string())
}

fn now_string() -> String {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs().to_string())
        .unwrap_or_else(|_| "0".to_string())
}
