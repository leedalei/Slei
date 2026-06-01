use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::PathBuf;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
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

#[derive(Clone, Debug, Default)]
pub struct ConversationService {
    root: Arc<PathBuf>,
    inner: Arc<Mutex<ConversationState>>,
}

#[derive(Debug, Default)]
struct ConversationState {
    conversations: HashMap<String, ConversationRecord>,
    dm_by_agent: HashMap<String, String>,
    sessions: HashMap<String, ConversationSessionRecord>,
    messages: HashMap<String, Vec<ConversationMessageRecord>>,
    attachments: HashMap<String, ConversationAttachmentRecord>,
}

impl ConversationService {
    pub fn new(root: PathBuf) -> Self {
        Self {
            inner: Arc::new(Mutex::new(ConversationState::load(&root))),
            root: Arc::new(root),
        }
    }

    pub async fn list_conversations(&self) -> Vec<ConversationRecord> {
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

    pub async fn create_dm(
        &self,
        agent_id: &str,
    ) -> Result<(ConversationRecord, bool), ConversationError> {
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
        persist_index(&self.root, &state.conversations)?;
        persist_sessions(&self.root, &state.sessions)?;
        Ok((conversation, true))
    }

    pub async fn list_messages(
        &self,
        conversation_id: &str,
    ) -> Result<Vec<ConversationMessageRecord>, ConversationError> {
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

    pub async fn get_conversation(
        &self,
        conversation_id: &str,
    ) -> Result<ConversationRecord, ConversationError> {
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
        if let Some(active_session_id) = active_session_id {
            if let Some(record) = state.sessions.get_mut(&active_session_id) {
                record.runtime_session = Some(session.clone());
                record.updated_at = current_timestamp();
            }
        }
        persist_index(&self.root, &state.conversations)?;
        persist_sessions(&self.root, &state.sessions)?;
        Ok((session, true))
    }

    pub async fn mark_runtime_session_ready(
        &self,
        conversation_id: &str,
    ) -> Result<ConversationRecord, ConversationError> {
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
        persist_index(&self.root, &state.conversations)?;
        persist_sessions(&self.root, &state.sessions)?;
        Ok(updated)
    }

    pub async fn reset_runtime_session(
        &self,
        conversation_id: &str,
    ) -> Result<ConversationRecord, ConversationError> {
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
            clear_session_messages(&mut state, conversation_id, &active_session_id);
        }
        persist_index(&self.root, &state.conversations)?;
        persist_sessions(&self.root, &state.sessions)?;
        persist_messages(
            &self.root,
            conversation_id,
            state.messages.get(conversation_id),
        )?;
        persist_attachments(&self.root, &state.attachments)?;
        Ok(updated)
    }

    pub async fn list_sessions(
        &self,
        conversation_id: &str,
    ) -> Result<Vec<ConversationSessionRecord>, ConversationError> {
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
        persist_index(&self.root, &state.conversations)?;
        persist_sessions(&self.root, &state.sessions)?;
        Ok((updated, session))
    }

    pub async fn activate_session(
        &self,
        conversation_id: &str,
        session_id: &str,
    ) -> Result<(ConversationRecord, ConversationSessionRecord), ConversationError> {
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
        persist_index(&self.root, &state.conversations)?;
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
        let trimmed = body.trim();
        if trimmed.is_empty() && attachment_ids.is_empty() {
            return Err(ConversationError::InvalidMessage);
        }

        let mut state = self.inner.lock().await;
        if !state.conversations.contains_key(conversation_id) {
            return Err(ConversationError::ConversationNotFound);
        }
        ensure_legacy_session(&mut state, conversation_id);
        let resolved_session_id = session_id.map(str::to_string).or_else(|| {
            state
                .conversations
                .get(conversation_id)
                .and_then(|conversation| conversation.active_session_id.clone())
        });
        let attachments = attachment_ids
            .iter()
            .filter_map(|id| state.attachments.get(id).cloned())
            .collect::<Vec<_>>();
        if attachments.len() != attachment_ids.len() {
            return Err(ConversationError::InvalidMessage);
        }
        if let Some(key) = idempotency_key {
            if let Some(existing) = state
                .messages
                .get(conversation_id)
                .and_then(|messages| messages.iter().find(|message| message.id == key))
                .cloned()
            {
                return Ok(existing);
            }
        }

        let message = ConversationMessageRecord {
            id: idempotency_key
                .filter(|key| !key.trim().is_empty())
                .map(str::to_string)
                .unwrap_or_else(|| format!("msg_{}", Uuid::new_v4().simple())),
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
        persist_index(&self.root, &state.conversations)?;
        persist_sessions(&self.root, &state.sessions)?;
        persist_messages(
            &self.root,
            conversation_id,
            state.messages.get(conversation_id),
        )?;
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
        persist_index(&self.root, &state.conversations)?;
        persist_sessions(&self.root, &state.sessions)?;
        persist_messages(
            &self.root,
            conversation_id,
            state.messages.get(conversation_id),
        )?;
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
        persist_index(&self.root, &state.conversations)?;
        persist_sessions(&self.root, &state.sessions)?;
        persist_messages(
            &self.root,
            conversation_id,
            state.messages.get(conversation_id),
        )?;
        Ok(updated)
    }

    pub async fn store_attachment(
        &self,
        name: &str,
        mime_type: &str,
        bytes_base64: &str,
    ) -> Result<ConversationAttachmentRecord, ConversationError> {
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
        persist_attachments(&self.root, &state.attachments)?;
        Ok(attachment)
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
        persist_messages(
            &self.root,
            conversation_id,
            state.messages.get(conversation_id),
        )?;
        Ok(updated)
    }
}

impl ConversationState {
    fn load(root: &PathBuf) -> Self {
        let mut conversations = load_index(root);
        let mut state = Self::default();
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

fn persist_index(
    root: &PathBuf,
    conversations: &HashMap<String, ConversationRecord>,
) -> Result<(), ConversationError> {
    let path = root.join("conversations/index.json");
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(ConversationError::Io)?;
    }
    let mut ordered = conversations.values().cloned().collect::<Vec<_>>();
    ordered.sort_by(|left, right| left.created_at.cmp(&right.created_at));
    let payload = serde_json::to_string_pretty(&ordered).map_err(ConversationError::Json)?;
    fs::write(path, payload).map_err(ConversationError::Io)
}

fn persist_messages(
    root: &PathBuf,
    conversation_id: &str,
    messages: Option<&Vec<ConversationMessageRecord>>,
) -> Result<(), ConversationError> {
    let path = messages_path(root, conversation_id);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(ConversationError::Io)?;
    }
    let payload = serde_json::to_string_pretty(messages.unwrap_or(&Vec::new()))
        .map_err(ConversationError::Json)?;
    fs::write(path, payload).map_err(ConversationError::Io)
}

fn persist_sessions(
    root: &PathBuf,
    sessions: &HashMap<String, ConversationSessionRecord>,
) -> Result<(), ConversationError> {
    let path = root.join("conversations/sessions.json");
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(ConversationError::Io)?;
    }
    let mut ordered = sessions.values().cloned().collect::<Vec<_>>();
    ordered.sort_by(|left, right| left.created_at.cmp(&right.created_at));
    let payload = serde_json::to_string_pretty(&ordered).map_err(ConversationError::Json)?;
    fs::write(path, payload).map_err(ConversationError::Io)
}

fn persist_attachments(
    root: &PathBuf,
    attachments: &HashMap<String, ConversationAttachmentRecord>,
) -> Result<(), ConversationError> {
    let path = root.join("attachments/index.json");
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(ConversationError::Io)?;
    }
    let payload = serde_json::to_string_pretty(&attachments.values().cloned().collect::<Vec<_>>())
        .map_err(ConversationError::Json)?;
    fs::write(path, payload).map_err(ConversationError::Io)
}

fn messages_path(root: &PathBuf, conversation_id: &str) -> PathBuf {
    let safe_id = safe_conversation_id(conversation_id);
    root.join("conversations/messages")
        .join(format!("{safe_id}.json"))
}

fn safe_conversation_id(conversation_id: &str) -> String {
    conversation_id.replace(':', "_").replace('/', "_")
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
) {
    let Some(messages) = state.messages.get_mut(conversation_id) else {
        return;
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
        return;
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
    for attachment_id in removed_attachment_ids.difference(&referenced_attachment_ids) {
        if let Some(attachment) = state.attachments.remove(attachment_id) {
            if let Some(path) = attachment.cache_path {
                let _ = fs::remove_file(&path);
                if let Some(parent) = std::path::Path::new(&path).parent() {
                    let _ = fs::remove_dir(parent);
                }
            }
        }
    }
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
