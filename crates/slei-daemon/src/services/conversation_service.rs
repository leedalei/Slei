use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::PathBuf;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use slei_storage::repositories::{
    ConversationAttachmentRow, ConversationMessageRow, ConversationRow, ConversationSessionRow,
    Repositories,
};
use tokio::sync::Mutex;
use uuid::Uuid;

use crate::services::card_service::InteractiveCardView;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ConversationRecord {
    pub id: String,
    pub kind: String,
    pub agent_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub active_session_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub runtime_session: Option<RuntimeSessionRecord>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ConversationSessionRecord {
    pub id: String,
    pub conversation_id: String,
    pub title: String,
    pub status: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub runtime_session: Option<RuntimeSessionRecord>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ConversationAttachmentRecord {
    pub id: String,
    pub name: String,
    pub mime_type: String,
    pub size: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cache_path: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeSessionRecord {
    pub runtime_kind: String,
    pub session_id: String,
    pub status: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ConversationMessageRecord {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sequence: Option<i64>,
    pub conversation_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    pub author_id: String,
    pub body: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub attachments: Vec<ConversationAttachmentRecord>,
    #[serde(default)]
    pub cards: Vec<InteractiveCardView>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub run_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    pub created_at: String,
}

#[derive(Clone, Debug)]
pub struct ConversationService {
    repos: Repositories,
    root: Arc<PathBuf>,
    inner: Arc<Mutex<ConversationState>>,
}

#[derive(Debug, Default)]
struct ConversationState {
    loaded: bool,
    conversations: HashMap<String, ConversationRecord>,
    dm_by_agent: HashMap<String, String>,
    sessions: HashMap<String, ConversationSessionRecord>,
    messages: HashMap<String, Vec<ConversationMessageRecord>>,
    attachments: HashMap<String, ConversationAttachmentRecord>,
}

impl ConversationService {
    pub fn new(repos: Repositories, root: PathBuf) -> Self {
        Self {
            repos,
            inner: Arc::new(Mutex::new(ConversationState::default())),
            root: Arc::new(root),
        }
    }

    pub async fn list_conversations(&self) -> Vec<ConversationRecord> {
        if let Err(error) = self.ensure_loaded().await {
            eprintln!("failed to load conversations from sqlite: {error}");
            return Vec::new();
        }
        let mut conversations = self
            .inner
            .lock()
            .await
            .conversations
            .values()
            .cloned()
            .collect::<Vec<_>>();
        conversations.sort_by(|left, right| left.created_at.cmp(&right.created_at));
        conversations
    }

    pub async fn clear_for_development_reset(&self) {
        *self.inner.lock().await = ConversationState::loaded_empty();
    }

    pub async fn create_dm(
        &self,
        agent_id: &str,
    ) -> Result<(ConversationRecord, bool), ConversationError> {
        self.ensure_loaded().await?;
        let trimmed = agent_id.trim();
        if trimmed.is_empty() {
            return Err(ConversationError::InvalidConversation);
        }

        let mut state = self.inner.lock().await;
        if let Some(id) = state.dm_by_agent.get(trimmed) {
            let conversation = state
                .conversations
                .get(id)
                .cloned()
                .ok_or(ConversationError::ConversationNotFound)?;
            return Ok((conversation, false));
        }

        let now = current_timestamp();
        let conversation_id = format!("dm:{trimmed}");
        let session = ConversationSessionRecord {
            id: format!("session:{}:default", safe_conversation_id(&conversation_id)),
            conversation_id: conversation_id.clone(),
            title: "新会话".to_string(),
            status: "ready".to_string(),
            runtime_session: None,
            created_at: now.clone(),
            updated_at: now.clone(),
        };
        let conversation = ConversationRecord {
            id: conversation_id,
            kind: "dm".to_string(),
            agent_id: trimmed.to_string(),
            active_session_id: Some(session.id.clone()),
            runtime_session: None,
            created_at: now.clone(),
            updated_at: now,
        };
        state
            .dm_by_agent
            .insert(trimmed.to_string(), conversation.id.clone());
        state
            .conversations
            .insert(conversation.id.clone(), conversation.clone());
        state.sessions.insert(session.id.clone(), session);
        self.persist_conversation(&conversation).await?;
        self.persist_session(
            state
                .sessions
                .get(
                    conversation
                        .active_session_id
                        .as_deref()
                        .ok_or(ConversationError::ConversationNotFound)?,
                )
                .ok_or(ConversationError::ConversationNotFound)?,
        )
        .await?;
        Ok((conversation, true))
    }

    pub async fn list_messages(
        &self,
        conversation_id: &str,
    ) -> Result<Vec<ConversationMessageRecord>, ConversationError> {
        self.ensure_loaded().await?;
        let state = self.inner.lock().await;
        if !state.conversations.contains_key(conversation_id) {
            return Err(ConversationError::ConversationNotFound);
        }
        Ok(state
            .messages
            .get(conversation_id)
            .cloned()
            .unwrap_or_default())
    }

    pub async fn list_messages_page(
        &self,
        conversation_id: &str,
        before_sequence: Option<i64>,
        around_message_id: Option<&str>,
        limit: i64,
    ) -> Result<Vec<ConversationMessageRecord>, ConversationError> {
        let all = self.list_messages(conversation_id).await?;
        let limit = limit.clamp(1, 200) as usize;
        let mut indexed = all
            .into_iter()
            .enumerate()
            .map(|(index, mut message)| {
                message.sequence = Some(index as i64 + 1);
                message
            })
            .collect::<Vec<_>>();

        if let Some(around_message_id) =
            around_message_id.map(str::trim).filter(|id| !id.is_empty())
        {
            let Some(center) = indexed
                .iter()
                .position(|message| message.id == around_message_id)
            else {
                return Ok(Vec::new());
            };
            let before = limit / 2;
            let start = center.saturating_sub(before);
            let end = (start + limit).min(indexed.len());
            return Ok(indexed.drain(start..end).collect());
        }

        if let Some(before_sequence) = before_sequence {
            indexed.retain(|message| message.sequence.unwrap_or_default() < before_sequence);
            let start = indexed.len().saturating_sub(limit);
            return Ok(indexed.drain(start..).collect());
        }

        let start = indexed.len().saturating_sub(limit);
        Ok(indexed.drain(start..).collect())
    }

    pub async fn message(
        &self,
        message_id: &str,
    ) -> Result<ConversationMessageRecord, ConversationError> {
        self.ensure_loaded().await?;
        self.inner
            .lock()
            .await
            .messages
            .values()
            .flat_map(|messages| messages.iter())
            .find(|message| message.id == message_id)
            .cloned()
            .ok_or(ConversationError::ConversationNotFound)
    }

    pub async fn get_conversation(
        &self,
        conversation_id: &str,
    ) -> Result<ConversationRecord, ConversationError> {
        self.ensure_loaded().await?;
        self.inner
            .lock()
            .await
            .conversations
            .get(conversation_id)
            .cloned()
            .ok_or(ConversationError::ConversationNotFound)
    }

    pub async fn ensure_runtime_session(
        &self,
        conversation_id: &str,
        runtime_kind: &str,
    ) -> Result<(RuntimeSessionRecord, bool), ConversationError> {
        self.ensure_loaded().await?;
        let mut state = self.inner.lock().await;
        let conversation = state
            .conversations
            .get_mut(conversation_id)
            .ok_or(ConversationError::ConversationNotFound)?;
        if let Some(session) = conversation.runtime_session.clone() {
            return Ok((session, false));
        }

        let now = current_timestamp();
        let session = RuntimeSessionRecord {
            runtime_kind: runtime_kind.trim().to_string(),
            session_id: Uuid::new_v4().to_string(),
            status: "pending".to_string(),
            created_at: now.clone(),
            updated_at: now.clone(),
        };
        conversation.runtime_session = Some(session.clone());
        let active_session_id = conversation.active_session_id.clone();
        conversation.updated_at = now;
        let updated = conversation.clone();
        let mut updated_session = None;
        if let Some(active_session_id) = active_session_id {
            if let Some(record) = state.sessions.get_mut(&active_session_id) {
                record.runtime_session = Some(session.clone());
                record.updated_at = current_timestamp();
                updated_session = Some(record.clone());
            }
        }
        self.persist_conversation(&updated).await?;
        if let Some(record) = updated_session {
            self.persist_session(&record).await?;
        }
        Ok((session, true))
    }

    pub async fn mark_runtime_session_ready(
        &self,
        conversation_id: &str,
    ) -> Result<ConversationRecord, ConversationError> {
        self.ensure_loaded().await?;
        let mut state = self.inner.lock().await;
        let conversation = state
            .conversations
            .get_mut(conversation_id)
            .ok_or(ConversationError::ConversationNotFound)?;
        if let Some(session) = conversation.runtime_session.as_mut() {
            session.status = "ready".to_string();
            session.updated_at = current_timestamp();
        }
        let active_session_id = conversation.active_session_id.clone();
        let updated = conversation.clone();
        if let Some(active_session_id) = active_session_id {
            if let Some(record) = state.sessions.get_mut(&active_session_id) {
                record.runtime_session = updated.runtime_session.clone();
                record.updated_at = current_timestamp();
            }
        }
        self.persist_conversation(&updated).await?;
        if let Some(active_session_id) = updated.active_session_id.as_deref() {
            if let Some(record) = state.sessions.get(active_session_id) {
                self.persist_session(record).await?;
            }
        }
        Ok(updated)
    }

    pub async fn reset_runtime_session(
        &self,
        conversation_id: &str,
    ) -> Result<ConversationRecord, ConversationError> {
        self.ensure_loaded().await?;
        let mut state = self.inner.lock().await;
        ensure_legacy_session(&mut state, conversation_id);
        let conversation = state
            .conversations
            .get_mut(conversation_id)
            .ok_or(ConversationError::ConversationNotFound)?;
        conversation.runtime_session = None;
        let active_session_id = conversation.active_session_id.clone();
        conversation.updated_at = current_timestamp();
        let updated = conversation.clone();
        if let Some(active_session_id) = active_session_id {
            if let Some(record) = state.sessions.get_mut(&active_session_id) {
                record.runtime_session = None;
                record.title = "新会话".to_string();
                record.status = "ready".to_string();
                record.updated_at = current_timestamp();
            }
            let removed_attachments =
                clear_session_messages(&mut state, conversation_id, &active_session_id);
            self.repos
                .delete_conversation_messages_for_session(conversation_id, &active_session_id)
                .await
                .map_err(storage_error)?;
            for attachment in removed_attachments {
                self.repos
                    .delete_conversation_attachment(&attachment.id)
                    .await
                    .map_err(storage_error)?;
            }
        }
        self.persist_conversation(&updated).await?;
        if let Some(active_session_id) = updated.active_session_id.as_deref() {
            if let Some(record) = state.sessions.get(active_session_id) {
                self.persist_session(record).await?;
            }
        }
        Ok(updated)
    }

    pub async fn clear_messages(&self, conversation_id: &str) -> Result<(), ConversationError> {
        self.ensure_loaded().await?;
        let mut state = self.inner.lock().await;
        let conversation = state
            .conversations
            .get_mut(conversation_id)
            .ok_or(ConversationError::ConversationNotFound)?;
        conversation.updated_at = current_timestamp();
        let updated = conversation.clone();
        let removed_attachments = clear_all_messages(&mut state, conversation_id);
        self.repos
            .delete_conversation_messages(conversation_id)
            .await
            .map_err(storage_error)?;
        for attachment in removed_attachments {
            self.repos
                .delete_conversation_attachment(&attachment.id)
                .await
                .map_err(storage_error)?;
        }
        self.persist_conversation(&updated).await?;
        Ok(())
    }

    pub async fn list_sessions(
        &self,
        conversation_id: &str,
    ) -> Result<Vec<ConversationSessionRecord>, ConversationError> {
        self.ensure_loaded().await?;
        let mut state = self.inner.lock().await;
        if !state.conversations.contains_key(conversation_id) {
            return Err(ConversationError::ConversationNotFound);
        }
        ensure_legacy_session(&mut state, conversation_id);
        let mut sessions = state
            .sessions
            .values()
            .filter(|session| session.conversation_id == conversation_id)
            .cloned()
            .collect::<Vec<_>>();
        sessions.sort_by(|left, right| right.updated_at.cmp(&left.updated_at));
        Ok(sessions)
    }

    pub async fn create_session(
        &self,
        conversation_id: &str,
    ) -> Result<(ConversationRecord, ConversationSessionRecord), ConversationError> {
        self.ensure_loaded().await?;
        let mut state = self.inner.lock().await;
        let now = current_timestamp();
        let conversation = state
            .conversations
            .get_mut(conversation_id)
            .ok_or(ConversationError::ConversationNotFound)?;
        let session = ConversationSessionRecord {
            id: format!(
                "session:{}:{}",
                safe_conversation_id(conversation_id),
                Uuid::new_v4().simple()
            ),
            conversation_id: conversation_id.to_string(),
            title: "新会话".to_string(),
            status: "ready".to_string(),
            runtime_session: None,
            created_at: now.clone(),
            updated_at: now.clone(),
        };
        conversation.active_session_id = Some(session.id.clone());
        conversation.runtime_session = None;
        conversation.updated_at = now;
        let updated = conversation.clone();
        state.sessions.insert(session.id.clone(), session.clone());
        self.persist_conversation(&updated).await?;
        self.persist_session(&session).await?;
        Ok((updated, session))
    }

    pub async fn activate_session(
        &self,
        conversation_id: &str,
        session_id: &str,
    ) -> Result<(ConversationRecord, ConversationSessionRecord), ConversationError> {
        self.ensure_loaded().await?;
        let mut state = self.inner.lock().await;
        ensure_legacy_session(&mut state, conversation_id);
        let session = state
            .sessions
            .get(session_id)
            .filter(|session| session.conversation_id == conversation_id)
            .cloned()
            .ok_or(ConversationError::ConversationNotFound)?;
        let conversation = state
            .conversations
            .get_mut(conversation_id)
            .ok_or(ConversationError::ConversationNotFound)?;
        conversation.active_session_id = Some(session.id.clone());
        conversation.runtime_session = session.runtime_session.clone();
        conversation.updated_at = current_timestamp();
        let updated = conversation.clone();
        self.persist_conversation(&updated).await?;
        Ok((updated, session))
    }

    pub async fn append_message(
        &self,
        conversation_id: &str,
        author_id: &str,
        body: &str,
        idempotency_key: Option<&str>,
    ) -> Result<ConversationMessageRecord, ConversationError> {
        self.append_message_with_metadata(
            conversation_id,
            author_id,
            body,
            idempotency_key,
            None,
            &[],
            None,
            None,
        )
        .await
    }

    pub async fn append_message_with_session(
        &self,
        conversation_id: &str,
        author_id: &str,
        body: &str,
        idempotency_key: Option<&str>,
        session_id: Option<&str>,
        attachment_ids: &[String],
    ) -> Result<ConversationMessageRecord, ConversationError> {
        self.append_message_with_metadata(
            conversation_id,
            author_id,
            body,
            idempotency_key,
            session_id,
            attachment_ids,
            None,
            None,
        )
        .await
    }

    pub async fn append_message_with_metadata(
        &self,
        conversation_id: &str,
        author_id: &str,
        body: &str,
        idempotency_key: Option<&str>,
        session_id: Option<&str>,
        attachment_ids: &[String],
        run_id: Option<&str>,
        status: Option<&str>,
    ) -> Result<ConversationMessageRecord, ConversationError> {
        self.ensure_loaded().await?;
        let trimmed = body.trim();
        if trimmed.is_empty() && attachment_ids.is_empty() {
            return Err(ConversationError::InvalidMessage);
        }

        let mut state = self.inner.lock().await;
        if !state.conversations.contains_key(conversation_id) {
            return Err(ConversationError::ConversationNotFound);
        }
        ensure_legacy_session(&mut state, conversation_id);
        let resolved_session_id = if let Some(session_id) = session_id {
            let session = state
                .sessions
                .get(session_id)
                .filter(|session| session.conversation_id == conversation_id)
                .ok_or(ConversationError::ConversationNotFound)?;
            Some(session.id.clone())
        } else {
            state
                .conversations
                .get(conversation_id)
                .and_then(|conversation| conversation.active_session_id.clone())
        };
        let attachments = attachment_ids
            .iter()
            .filter_map(|id| state.attachments.get(id).cloned())
            .collect::<Vec<_>>();
        if attachments.len() != attachment_ids.len() {
            return Err(ConversationError::InvalidMessage);
        }
        let idempotency_key = idempotency_key.map(str::trim).filter(|key| !key.is_empty());
        if let Some(key) = idempotency_key {
            if let Some(existing) = state
                .messages
                .get(conversation_id)
                .and_then(|messages| {
                    messages
                        .iter()
                        .find(|message| idempotent_message_matches_key(message, key))
                })
                .cloned()
            {
                return Ok(existing);
            }
        }

        let message = ConversationMessageRecord {
            id: idempotency_key
                .map(|key| message_id_for_idempotency_key(&state, conversation_id, key))
                .unwrap_or_else(|| format!("msg_{}", Uuid::new_v4().simple())),
            sequence: None,
            conversation_id: conversation_id.to_string(),
            session_id: resolved_session_id.clone(),
            author_id: author_id.trim().to_string(),
            body: trimmed.to_string(),
            attachments,
            cards: Vec::new(),
            run_id: run_id.map(str::to_string),
            status: status.map(str::to_string),
            created_at: current_timestamp(),
        };
        state
            .messages
            .entry(conversation_id.to_string())
            .or_default()
            .push(message.clone());
        if let Some(conversation) = state.conversations.get_mut(conversation_id) {
            conversation.updated_at = message.created_at.clone();
            conversation.active_session_id = resolved_session_id
                .clone()
                .or_else(|| conversation.active_session_id.clone());
        }
        if let Some(session_id) = resolved_session_id {
            if let Some(session) = state.sessions.get_mut(&session_id) {
                if session.title == "新会话" && !trimmed.is_empty() {
                    session.title = trimmed.chars().take(40).collect();
                }
                session.updated_at = message.created_at.clone();
            }
        }
        self.persist_conversation(
            state
                .conversations
                .get(conversation_id)
                .ok_or(ConversationError::ConversationNotFound)?,
        )
        .await?;
        if let Some(session_id) = message.session_id.as_deref() {
            if let Some(session) = state.sessions.get(session_id) {
                self.persist_session(session).await?;
            }
        }
        self.persist_message(&message).await?;
        Ok(message)
    }

    pub async fn upsert_run_message(
        &self,
        conversation_id: &str,
        author_id: &str,
        run_id: &str,
        body_delta: Option<&str>,
        status: Option<&str>,
    ) -> Result<ConversationMessageRecord, ConversationError> {
        self.ensure_loaded().await?;
        let mut state = self.inner.lock().await;
        if !state.conversations.contains_key(conversation_id) {
            return Err(ConversationError::ConversationNotFound);
        }
        ensure_legacy_session(&mut state, conversation_id);
        let active_session_id = state
            .conversations
            .get(conversation_id)
            .and_then(|conversation| conversation.active_session_id.clone());
        let messages = state
            .messages
            .entry(conversation_id.to_string())
            .or_default();
        let updated = if let Some(message) = messages
            .iter_mut()
            .find(|message| message.run_id.as_deref() == Some(run_id))
        {
            if let Some(delta) = body_delta {
                message.body.push_str(delta);
            }
            if let Some(status) = status {
                message.status = Some(status.to_string());
            }
            message.clone()
        } else {
            let message = ConversationMessageRecord {
                id: format!("run_message_{run_id}"),
                sequence: None,
                conversation_id: conversation_id.to_string(),
                session_id: active_session_id.clone(),
                author_id: author_id.trim().to_string(),
                body: body_delta.unwrap_or_default().to_string(),
                attachments: Vec::new(),
                cards: Vec::new(),
                run_id: Some(run_id.to_string()),
                status: Some(status.unwrap_or("running").to_string()),
                created_at: current_timestamp(),
            };
            messages.push(message.clone());
            message
        };
        if let Some(conversation) = state.conversations.get_mut(conversation_id) {
            conversation.updated_at = updated.created_at.clone();
        }
        if let Some(session_id) = active_session_id {
            if let Some(session) = state.sessions.get_mut(&session_id) {
                session.updated_at = updated.created_at.clone();
            }
        }
        self.persist_conversation(
            state
                .conversations
                .get(conversation_id)
                .ok_or(ConversationError::ConversationNotFound)?,
        )
        .await?;
        if let Some(session_id) = updated.session_id.as_deref() {
            if let Some(session) = state.sessions.get(session_id) {
                self.persist_session(session).await?;
            }
        }
        self.persist_message(&updated).await?;
        Ok(updated)
    }

    pub async fn upsert_card_message(
        &self,
        conversation_id: &str,
        author_id: &str,
        message_id: &str,
        cards: Vec<InteractiveCardView>,
        status: Option<&str>,
    ) -> Result<ConversationMessageRecord, ConversationError> {
        self.ensure_loaded().await?;
        let mut state = self.inner.lock().await;
        if !state.conversations.contains_key(conversation_id) {
            return Err(ConversationError::ConversationNotFound);
        }
        if message_id_belongs_to_another_conversation(&state, conversation_id, message_id) {
            return Err(ConversationError::InvalidMessage);
        }
        ensure_legacy_session(&mut state, conversation_id);
        let active_session_id = state
            .conversations
            .get(conversation_id)
            .and_then(|conversation| conversation.active_session_id.clone());
        let messages = state
            .messages
            .entry(conversation_id.to_string())
            .or_default();
        let updated =
            if let Some(message) = messages.iter_mut().find(|message| message.id == message_id) {
                message.cards = cards;
                if let Some(status) = status {
                    message.status = Some(status.to_string());
                }
                message.clone()
            } else {
                let message = ConversationMessageRecord {
                    id: message_id.to_string(),
                    sequence: None,
                    conversation_id: conversation_id.to_string(),
                    session_id: active_session_id.clone(),
                    author_id: author_id.trim().to_string(),
                    body: String::new(),
                    attachments: Vec::new(),
                    cards,
                    run_id: None,
                    status: status.map(str::to_string),
                    created_at: current_timestamp(),
                };
                messages.push(message.clone());
                message
            };
        if let Some(conversation) = state.conversations.get_mut(conversation_id) {
            conversation.updated_at = updated.created_at.clone();
        }
        self.persist_conversation(
            state
                .conversations
                .get(conversation_id)
                .ok_or(ConversationError::ConversationNotFound)?,
        )
        .await?;
        self.persist_message(&updated).await?;
        Ok(updated)
    }

    pub async fn store_attachment(
        &self,
        name: &str,
        mime_type: &str,
        bytes_base64: &str,
    ) -> Result<ConversationAttachmentRecord, ConversationError> {
        self.ensure_loaded().await?;
        let file_name = sanitize_attachment_name(name)?;
        let bytes = decode_base64(bytes_base64).map_err(|_| ConversationError::InvalidMessage)?;
        let mime_type = if mime_type.trim().is_empty() {
            "application/octet-stream".to_string()
        } else {
            mime_type.trim().to_string()
        };
        let id = format!("att_{}", Uuid::new_v4().simple());
        let path = self.root.join("attachments").join(&id).join(&file_name);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(ConversationError::Io)?;
        }
        fs::write(&path, &bytes).map_err(ConversationError::Io)?;
        let attachment = ConversationAttachmentRecord {
            id,
            name: file_name,
            mime_type: mime_type.clone(),
            size: bytes.len() as u64,
            url: if mime_type.starts_with("image/") {
                Some(format!("data:{mime_type};base64,{bytes_base64}"))
            } else {
                None
            },
            cache_path: Some(path.to_string_lossy().to_string()),
        };
        let mut state = self.inner.lock().await;
        state
            .attachments
            .insert(attachment.id.clone(), attachment.clone());
        self.persist_attachment(&attachment, Some(bytes_base64))
            .await?;
        Ok(attachment)
    }

    pub async fn attachments_by_ids(
        &self,
        attachment_ids: &[String],
    ) -> Result<Vec<ConversationAttachmentRecord>, ConversationError> {
        self.ensure_loaded().await?;
        let state = self.inner.lock().await;
        Ok(attachment_ids
            .iter()
            .filter_map(|id| state.attachments.get(id).cloned())
            .collect())
    }

    pub fn prompt_with_attachments(message: &ConversationMessageRecord) -> String {
        if message.attachments.is_empty() {
            return message.body.clone();
        }
        let mut prompt = message.body.clone();
        prompt.push_str("\n\nAttachments:");
        for attachment in &message.attachments {
            prompt.push_str(&format!(
                "\n- {} ({}, {} bytes) {}",
                attachment.name,
                attachment.mime_type,
                attachment.size,
                attachment.cache_path.clone().unwrap_or_default()
            ));
        }
        prompt
    }

    pub async fn runtime_context(
        &self,
        conversation_id: &str,
        agent_id: &str,
        before_message_id: &str,
        max_rounds: usize,
    ) -> Result<Vec<Value>, ConversationError> {
        let max_messages = max_rounds.saturating_mul(2);
        if max_messages == 0 {
            return Ok(Vec::new());
        }

        let mut messages = self
            .list_messages(conversation_id)
            .await?
            .into_iter()
            .take_while(|message| message.id != before_message_id)
            .filter(|message| !message.body.trim().is_empty())
            .collect::<Vec<_>>();
        if messages.len() > max_messages {
            messages = messages.split_off(messages.len() - max_messages);
        }

        Ok(messages
            .into_iter()
            .map(|message| {
                let role = if message.author_id.starts_with("human:") {
                    "user"
                } else if message.author_id == agent_id {
                    "assistant"
                } else {
                    "system"
                };
                json!({ "role": role, "content": message.body })
            })
            .collect())
    }

    pub async fn attach_cards(
        &self,
        conversation_id: &str,
        message_id: &str,
        cards: Vec<InteractiveCardView>,
    ) -> Result<ConversationMessageRecord, ConversationError> {
        self.ensure_loaded().await?;
        let mut state = self.inner.lock().await;
        let messages = state
            .messages
            .get_mut(conversation_id)
            .ok_or(ConversationError::ConversationNotFound)?;
        let message = messages
            .iter_mut()
            .find(|message| message.id == message_id)
            .ok_or(ConversationError::ConversationNotFound)?;
        message.cards = cards;
        let updated = message.clone();
        self.persist_message(&updated).await?;
        Ok(updated)
    }

    async fn persist_conversation(
        &self,
        conversation: &ConversationRecord,
    ) -> Result<(), ConversationError> {
        self.repos
            .upsert_conversation(conversation_to_row(conversation))
            .await
            .map_err(storage_error)
    }

    async fn persist_session(
        &self,
        session: &ConversationSessionRecord,
    ) -> Result<(), ConversationError> {
        self.repos
            .upsert_conversation_session(session_to_row(session)?)
            .await
            .map_err(storage_error)
    }

    async fn persist_message(
        &self,
        message: &ConversationMessageRecord,
    ) -> Result<(), ConversationError> {
        self.repos
            .insert_conversation_message(message_to_row(message)?)
            .await
            .map_err(storage_error)
    }

    async fn persist_attachment(
        &self,
        attachment: &ConversationAttachmentRecord,
        bytes_base64: Option<&str>,
    ) -> Result<(), ConversationError> {
        self.repos
            .upsert_conversation_attachment(attachment_to_row(attachment, bytes_base64))
            .await
            .map_err(storage_error)
    }

    async fn ensure_loaded(&self) -> Result<(), ConversationError> {
        let mut state = self.inner.lock().await;
        if state.loaded {
            return Ok(());
        }
        *state = ConversationState::load(&self.repos, &self.root).await?;
        Ok(())
    }
}

impl ConversationState {
    fn loaded_empty() -> Self {
        Self {
            loaded: true,
            ..Self::default()
        }
    }

    async fn load(repos: &Repositories, root: &PathBuf) -> Result<Self, ConversationError> {
        let rows = repos.conversations().await.map_err(storage_error)?;
        let mut state = Self::loaded_empty();
        for row in rows {
            let sessions = repos
                .conversation_sessions(&row.id)
                .await
                .map_err(storage_error)?
                .into_iter()
                .map(session_from_row)
                .collect::<Result<Vec<_>, _>>()?;
            for session in sessions {
                state.sessions.insert(session.id.clone(), session);
            }

            let messages = repos
                .conversation_messages(&row.id)
                .await
                .map_err(storage_error)?
                .into_iter()
                .map(|message| message_from_row(repos, message))
                .collect::<Vec<_>>();
            let mut records = Vec::new();
            for message in messages {
                records.push(message.await?);
            }

            let runtime_session = row
                .active_session_id
                .as_deref()
                .and_then(|session_id| state.sessions.get(session_id))
                .and_then(|session| session.runtime_session.clone());
            let conversation = conversation_from_row(row, runtime_session);
            if conversation.kind == "dm" {
                state
                    .dm_by_agent
                    .insert(conversation.agent_id.clone(), conversation.id.clone());
            }
            for message in &records {
                for attachment in &message.attachments {
                    state
                        .attachments
                        .insert(attachment.id.clone(), attachment.clone());
                }
            }
            state.messages.insert(conversation.id.clone(), records);
            state
                .conversations
                .insert(conversation.id.clone(), conversation);
        }
        for attachment in repos
            .conversation_attachments()
            .await
            .map_err(storage_error)?
            .into_iter()
            .map(attachment_from_row)
        {
            state.attachments.insert(attachment.id.clone(), attachment);
        }
        let legacy_state = Self::load_legacy_json(root);
        merge_legacy_state(repos, &mut state, legacy_state).await?;
        Ok(state)
    }

    fn load_legacy_json(root: &PathBuf) -> Self {
        let mut conversations = load_index(root);
        let mut state = Self::loaded_empty();
        state.sessions = load_sessions(root);
        state.attachments = load_attachments(root);
        for conversation in &mut conversations {
            if conversation.active_session_id.is_none() {
                conversation.active_session_id = Some(format!(
                    "session:{}:default",
                    safe_conversation_id(&conversation.id)
                ));
            }
            if !state
                .sessions
                .values()
                .any(|session| session.conversation_id == conversation.id)
            {
                let session = legacy_session_for_conversation(conversation);
                state.sessions.insert(session.id.clone(), session);
            }
            if conversation.kind == "dm" {
                state
                    .dm_by_agent
                    .insert(conversation.agent_id.clone(), conversation.id.clone());
            }
            state.messages.insert(
                conversation.id.clone(),
                load_messages(
                    root,
                    &conversation.id,
                    conversation.active_session_id.as_deref(),
                ),
            );
            state
                .conversations
                .insert(conversation.id.clone(), conversation.clone());
        }
        state
    }
}

fn load_index(root: &PathBuf) -> Vec<ConversationRecord> {
    fs::read_to_string(root.join("conversations/index.json"))
        .ok()
        .and_then(|raw| serde_json::from_str::<Vec<ConversationRecord>>(&raw).ok())
        .unwrap_or_default()
}

fn load_messages(
    root: &PathBuf,
    conversation_id: &str,
    legacy_session_id: Option<&str>,
) -> Vec<ConversationMessageRecord> {
    let mut messages = fs::read_to_string(messages_path(root, conversation_id))
        .ok()
        .and_then(|raw| serde_json::from_str::<Vec<ConversationMessageRecord>>(&raw).ok())
        .unwrap_or_default();
    for message in &mut messages {
        if message.session_id.is_none() {
            message.session_id = legacy_session_id.map(str::to_string);
        }
    }
    messages
}

fn load_sessions(root: &PathBuf) -> HashMap<String, ConversationSessionRecord> {
    fs::read_to_string(root.join("conversations/sessions.json"))
        .ok()
        .and_then(|raw| serde_json::from_str::<Vec<ConversationSessionRecord>>(&raw).ok())
        .unwrap_or_default()
        .into_iter()
        .map(|session| (session.id.clone(), session))
        .collect()
}

fn load_attachments(root: &PathBuf) -> HashMap<String, ConversationAttachmentRecord> {
    fs::read_to_string(root.join("attachments/index.json"))
        .ok()
        .and_then(|raw| serde_json::from_str::<Vec<ConversationAttachmentRecord>>(&raw).ok())
        .unwrap_or_default()
        .into_iter()
        .map(|attachment| (attachment.id.clone(), attachment))
        .collect()
}

async fn merge_legacy_state(
    repos: &Repositories,
    state: &mut ConversationState,
    legacy_state: ConversationState,
) -> Result<(), ConversationError> {
    let existing_message_ids = state
        .messages
        .values()
        .flat_map(|messages| messages.iter().map(|message| message.id.clone()))
        .collect::<HashSet<_>>();
    let mut existing_message_ids = existing_message_ids;

    for conversation in legacy_state.conversations.into_values() {
        if let Some(existing) = state.conversations.get_mut(&conversation.id) {
            let mut changed = false;
            if existing.active_session_id.is_none() && conversation.active_session_id.is_some() {
                existing.active_session_id = conversation.active_session_id.clone();
                changed = true;
            }
            if existing.runtime_session.is_none() && conversation.runtime_session.is_some() {
                existing.runtime_session = conversation.runtime_session.clone();
                changed = true;
            }
            if changed {
                repos
                    .upsert_conversation(conversation_to_row(existing))
                    .await
                    .map_err(storage_error)?;
            }
            continue;
        }
        repos
            .upsert_conversation(conversation_to_row(&conversation))
            .await
            .map_err(storage_error)?;
        if conversation.kind == "dm" {
            state
                .dm_by_agent
                .insert(conversation.agent_id.clone(), conversation.id.clone());
        }
        state.messages.entry(conversation.id.clone()).or_default();
        state
            .conversations
            .insert(conversation.id.clone(), conversation);
    }

    for session in legacy_state.sessions.into_values() {
        if state.sessions.contains_key(&session.id) {
            continue;
        }
        repos
            .upsert_conversation_session(session_to_row(&session)?)
            .await
            .map_err(storage_error)?;
        let updated_conversation = backfill_conversation_runtime_from_session(state, &session);
        state.sessions.insert(session.id.clone(), session);
        if let Some(conversation) = updated_conversation {
            repos
                .upsert_conversation(conversation_to_row(&conversation))
                .await
                .map_err(storage_error)?;
        }
    }

    for attachment in legacy_state.attachments.into_values() {
        if state.attachments.contains_key(&attachment.id) {
            continue;
        }
        repos
            .upsert_conversation_attachment(attachment_to_row(&attachment, None))
            .await
            .map_err(storage_error)?;
        state.attachments.insert(attachment.id.clone(), attachment);
    }

    for messages in legacy_state.messages.into_values() {
        for message in messages {
            for attachment in &message.attachments {
                if state.attachments.contains_key(&attachment.id) {
                    continue;
                }
                repos
                    .upsert_conversation_attachment(attachment_to_row(attachment, None))
                    .await
                    .map_err(storage_error)?;
                state
                    .attachments
                    .insert(attachment.id.clone(), attachment.clone());
            }
            if !existing_message_ids.insert(message.id.clone()) {
                continue;
            }
            repos
                .insert_conversation_message(message_to_row(&message)?)
                .await
                .map_err(storage_error)?;
            state
                .messages
                .entry(message.conversation_id.clone())
                .or_default()
                .push(message);
        }
    }
    Ok(())
}

fn conversation_to_row(conversation: &ConversationRecord) -> ConversationRow {
    ConversationRow {
        id: conversation.id.clone(),
        kind: conversation.kind.clone(),
        agent_id: conversation.agent_id.clone(),
        active_session_id: conversation.active_session_id.clone(),
        runtime_status: conversation
            .runtime_session
            .as_ref()
            .map(|session| session.status.clone()),
        created_at: conversation.created_at.clone(),
        updated_at: conversation.updated_at.clone(),
    }
}

fn conversation_from_row(
    row: ConversationRow,
    runtime_session: Option<RuntimeSessionRecord>,
) -> ConversationRecord {
    ConversationRecord {
        id: row.id,
        kind: row.kind,
        agent_id: row.agent_id,
        active_session_id: row.active_session_id,
        runtime_session,
        created_at: row.created_at,
        updated_at: row.updated_at,
    }
}

fn session_to_row(
    session: &ConversationSessionRecord,
) -> Result<ConversationSessionRow, ConversationError> {
    Ok(ConversationSessionRow {
        id: session.id.clone(),
        conversation_id: session.conversation_id.clone(),
        title: session.title.clone(),
        status: session.status.clone(),
        runtime_session_payload: session
            .runtime_session
            .as_ref()
            .map(serde_json::to_string)
            .transpose()
            .map_err(ConversationError::Json)?,
        created_at: session.created_at.clone(),
        updated_at: session.updated_at.clone(),
    })
}

fn session_from_row(
    row: ConversationSessionRow,
) -> Result<ConversationSessionRecord, ConversationError> {
    Ok(ConversationSessionRecord {
        id: row.id,
        conversation_id: row.conversation_id,
        title: row.title,
        status: row.status,
        runtime_session: row
            .runtime_session_payload
            .as_deref()
            .map(serde_json::from_str)
            .transpose()
            .map_err(ConversationError::Json)?,
        created_at: row.created_at,
        updated_at: row.updated_at,
    })
}

fn message_to_row(
    message: &ConversationMessageRecord,
) -> Result<ConversationMessageRow, ConversationError> {
    let attachment_ids = message
        .attachments
        .iter()
        .map(|attachment| attachment.id.clone())
        .collect::<Vec<_>>();
    Ok(ConversationMessageRow {
        id: message.id.clone(),
        conversation_id: message.conversation_id.clone(),
        session_id: message.session_id.clone(),
        author_id: message.author_id.clone(),
        body: message.body.clone(),
        status: message.status.clone(),
        run_id: message.run_id.clone(),
        attachment_ids: serde_json::to_string(&attachment_ids).map_err(ConversationError::Json)?,
        cards_payload: serde_json::to_string(&message.cards).map_err(ConversationError::Json)?,
        created_at: message.created_at.clone(),
    })
}

async fn message_from_row(
    repos: &Repositories,
    row: ConversationMessageRow,
) -> Result<ConversationMessageRecord, ConversationError> {
    let attachment_ids = serde_json::from_str::<Vec<String>>(&row.attachment_ids)
        .map_err(ConversationError::Json)?;
    let mut attachments = Vec::new();
    for attachment_id in attachment_ids {
        if let Some(attachment) = repos
            .conversation_attachment(&attachment_id)
            .await
            .map_err(storage_error)?
        {
            attachments.push(attachment_from_row(attachment));
        }
    }
    Ok(ConversationMessageRecord {
        id: row.id,
        sequence: None,
        conversation_id: row.conversation_id,
        session_id: row.session_id,
        author_id: row.author_id,
        body: row.body,
        attachments,
        cards: serde_json::from_str(&row.cards_payload).map_err(ConversationError::Json)?,
        run_id: row.run_id,
        status: row.status,
        created_at: row.created_at,
    })
}

fn attachment_to_row(
    attachment: &ConversationAttachmentRecord,
    bytes_base64: Option<&str>,
) -> ConversationAttachmentRow {
    ConversationAttachmentRow {
        id: attachment.id.clone(),
        name: attachment.name.clone(),
        mime_type: attachment.mime_type.clone(),
        size: attachment.size,
        url: attachment.url.clone(),
        cache_path: attachment.cache_path.clone(),
        bytes_base64: bytes_base64.map(str::to_string),
    }
}

fn attachment_from_row(row: ConversationAttachmentRow) -> ConversationAttachmentRecord {
    ConversationAttachmentRecord {
        id: row.id,
        name: row.name,
        mime_type: row.mime_type,
        size: row.size,
        url: row.url,
        cache_path: row.cache_path,
    }
}

fn messages_path(root: &PathBuf, conversation_id: &str) -> PathBuf {
    let safe_id = safe_conversation_id(conversation_id);
    root.join("conversations/messages")
        .join(format!("{safe_id}.json"))
}

fn safe_conversation_id(conversation_id: &str) -> String {
    conversation_id.replace(':', "_").replace('/', "_")
}

fn idempotent_message_matches_key(message: &ConversationMessageRecord, key: &str) -> bool {
    message.id == key || message.id == scoped_idempotent_message_id(&message.conversation_id, key)
}

fn message_id_for_idempotency_key(
    state: &ConversationState,
    conversation_id: &str,
    key: &str,
) -> String {
    let key_is_used_by_another_conversation = state
        .messages
        .values()
        .flat_map(|messages| messages.iter())
        .any(|message| message.id == key && message.conversation_id != conversation_id);
    if !key_is_used_by_another_conversation {
        return key.to_string();
    }

    let scoped_id = scoped_idempotent_message_id(conversation_id, key);
    unique_message_id(state, scoped_id)
}

fn scoped_idempotent_message_id(conversation_id: &str, key: &str) -> String {
    let mut hash = 0xcbf29ce484222325_u64;
    for byte in conversation_id
        .bytes()
        .chain(std::iter::once(0))
        .chain(key.bytes())
    {
        hash ^= u64::from(byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("msg_idem_{hash:016x}")
}

fn unique_message_id(state: &ConversationState, candidate: String) -> String {
    if !message_id_exists(state, &candidate) {
        return candidate;
    }
    for suffix in 2.. {
        let next = format!("{candidate}_{suffix}");
        if !message_id_exists(state, &next) {
            return next;
        }
    }
    unreachable!("unbounded message id suffix search should always find a free id")
}

fn message_id_exists(state: &ConversationState, id: &str) -> bool {
    state
        .messages
        .values()
        .flat_map(|messages| messages.iter())
        .any(|message| message.id == id)
}

fn message_id_belongs_to_another_conversation(
    state: &ConversationState,
    conversation_id: &str,
    message_id: &str,
) -> bool {
    state
        .messages
        .values()
        .flat_map(|messages| messages.iter())
        .any(|message| message.id == message_id && message.conversation_id != conversation_id)
}

fn backfill_conversation_runtime_from_session(
    state: &mut ConversationState,
    session: &ConversationSessionRecord,
) -> Option<ConversationRecord> {
    if session.runtime_session.is_none() {
        return None;
    }
    let conversation = state.conversations.get_mut(&session.conversation_id)?;
    if conversation.active_session_id.as_deref() != Some(session.id.as_str()) {
        return None;
    }
    if conversation.runtime_session == session.runtime_session {
        return None;
    }
    conversation.runtime_session = session.runtime_session.clone();
    Some(conversation.clone())
}

fn legacy_session_for_conversation(conversation: &ConversationRecord) -> ConversationSessionRecord {
    ConversationSessionRecord {
        id: conversation.active_session_id.clone().unwrap_or_else(|| {
            format!("session:{}:default", safe_conversation_id(&conversation.id))
        }),
        conversation_id: conversation.id.clone(),
        title: "新会话".to_string(),
        status: "ready".to_string(),
        runtime_session: conversation.runtime_session.clone(),
        created_at: conversation.created_at.clone(),
        updated_at: conversation.updated_at.clone(),
    }
}

fn ensure_legacy_session(state: &mut ConversationState, conversation_id: &str) {
    let Some(conversation) = state.conversations.get_mut(conversation_id) else {
        return;
    };
    if conversation.active_session_id.is_none() {
        conversation.active_session_id = Some(format!(
            "session:{}:default",
            safe_conversation_id(conversation_id)
        ));
    }
    let active = conversation.active_session_id.clone();
    if let Some(active) = active {
        state
            .sessions
            .entry(active)
            .or_insert_with(|| legacy_session_for_conversation(conversation));
    }
}

fn clear_session_messages(
    state: &mut ConversationState,
    conversation_id: &str,
    active_session_id: &str,
) -> Vec<ConversationAttachmentRecord> {
    let Some(messages) = state.messages.get_mut(conversation_id) else {
        return Vec::new();
    };
    let removed_attachment_ids = messages
        .iter()
        .filter(|message| message.session_id.as_deref() == Some(active_session_id))
        .flat_map(|message| {
            message
                .attachments
                .iter()
                .map(|attachment| attachment.id.clone())
        })
        .collect::<HashSet<_>>();
    messages.retain(|message| message.session_id.as_deref() != Some(active_session_id));
    if removed_attachment_ids.is_empty() {
        return Vec::new();
    }
    let referenced_attachment_ids = state
        .messages
        .values()
        .flat_map(|messages| messages.iter())
        .flat_map(|message| {
            message
                .attachments
                .iter()
                .map(|attachment| attachment.id.clone())
        })
        .collect::<HashSet<_>>();
    let mut removed = Vec::new();
    for attachment_id in removed_attachment_ids.difference(&referenced_attachment_ids) {
        if let Some(attachment) = state.attachments.remove(attachment_id) {
            if let Some(path) = attachment.cache_path.as_deref() {
                let _ = fs::remove_file(&path);
                if let Some(parent) = std::path::Path::new(&path).parent() {
                    let _ = fs::remove_dir(parent);
                }
            }
            removed.push(attachment);
        }
    }
    removed
}

fn clear_all_messages(
    state: &mut ConversationState,
    conversation_id: &str,
) -> Vec<ConversationAttachmentRecord> {
    let removed_attachment_ids = state
        .messages
        .remove(conversation_id)
        .unwrap_or_default()
        .into_iter()
        .flat_map(|message| {
            message
                .attachments
                .into_iter()
                .map(|attachment| attachment.id)
        })
        .collect::<HashSet<_>>();
    if removed_attachment_ids.is_empty() {
        state
            .messages
            .insert(conversation_id.to_string(), Vec::new());
        return Vec::new();
    }
    let referenced_attachment_ids = state
        .messages
        .values()
        .flat_map(|messages| messages.iter())
        .flat_map(|message| {
            message
                .attachments
                .iter()
                .map(|attachment| attachment.id.clone())
        })
        .collect::<HashSet<_>>();
    let mut removed = Vec::new();
    for attachment_id in removed_attachment_ids.difference(&referenced_attachment_ids) {
        if let Some(attachment) = state.attachments.remove(attachment_id) {
            if let Some(path) = attachment.cache_path.as_deref() {
                let _ = fs::remove_file(&path);
                if let Some(parent) = std::path::Path::new(&path).parent() {
                    let _ = fs::remove_dir(parent);
                }
            }
            removed.push(attachment);
        }
    }
    state
        .messages
        .insert(conversation_id.to_string(), Vec::new());
    removed
}

fn sanitize_attachment_name(name: &str) -> Result<String, ConversationError> {
    let file_name = std::path::Path::new(name)
        .file_name()
        .and_then(|value| value.to_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or(ConversationError::InvalidMessage)?;
    if file_name == "." || file_name == ".." || file_name.contains('/') || file_name.contains('\\')
    {
        return Err(ConversationError::InvalidMessage);
    }
    Ok(file_name.to_string())
}

fn decode_base64(input: &str) -> Result<Vec<u8>, ()> {
    let mut output = Vec::new();
    let mut buffer = 0u32;
    let mut bits = 0u8;
    for byte in input.bytes().filter(|byte| !byte.is_ascii_whitespace()) {
        if byte == b'=' {
            break;
        }
        let value = match byte {
            b'A'..=b'Z' => byte - b'A',
            b'a'..=b'z' => byte - b'a' + 26,
            b'0'..=b'9' => byte - b'0' + 52,
            b'+' => 62,
            b'/' => 63,
            _ => return Err(()),
        } as u32;
        buffer = (buffer << 6) | value;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            output.push(((buffer >> bits) & 0xff) as u8);
        }
    }
    Ok(output)
}

fn current_timestamp() -> String {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs().to_string())
        .unwrap_or_else(|_| "0".to_string())
}

#[derive(Debug, thiserror::Error)]
pub enum ConversationError {
    #[error("conversation not found")]
    ConversationNotFound,
    #[error("invalid conversation")]
    InvalidConversation,
    #[error("invalid message")]
    InvalidMessage,
    #[error("conversation io error: {0}")]
    Io(std::io::Error),
    #[error("conversation json error: {0}")]
    Json(serde_json::Error),
}

fn storage_error(error: sqlx::Error) -> ConversationError {
    ConversationError::Io(std::io::Error::new(
        std::io::ErrorKind::Other,
        error.to_string(),
    ))
}
