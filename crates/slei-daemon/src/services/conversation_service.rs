use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;
use uuid::Uuid;

use crate::services::card_service::InteractiveCardView;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ConversationRecord {
    pub id: String,
    pub kind: String,
    pub agent_id: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ConversationMessageRecord {
    pub id: String,
    pub conversation_id: String,
    pub author_id: String,
    pub body: String,
    #[serde(default)]
    pub cards: Vec<InteractiveCardView>,
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
    messages: HashMap<String, Vec<ConversationMessageRecord>>,
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
        let conversation = ConversationRecord {
            id: format!("dm:{trimmed}"),
            kind: "dm".to_string(),
            agent_id: trimmed.to_string(),
            created_at: now.clone(),
            updated_at: now,
        };
        state
            .dm_by_agent
            .insert(trimmed.to_string(), conversation.id.clone());
        state
            .conversations
            .insert(conversation.id.clone(), conversation.clone());
        persist_index(&self.root, &state.conversations)?;
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

    pub async fn append_message(
        &self,
        conversation_id: &str,
        author_id: &str,
        body: &str,
        idempotency_key: Option<&str>,
    ) -> Result<ConversationMessageRecord, ConversationError> {
        let trimmed = body.trim();
        if trimmed.is_empty() {
            return Err(ConversationError::InvalidMessage);
        }

        let mut state = self.inner.lock().await;
        if !state.conversations.contains_key(conversation_id) {
            return Err(ConversationError::ConversationNotFound);
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
            author_id: author_id.trim().to_string(),
            body: trimmed.to_string(),
            cards: Vec::new(),
            created_at: current_timestamp(),
        };
        state
            .messages
            .entry(conversation_id.to_string())
            .or_default()
            .push(message.clone());
        if let Some(conversation) = state.conversations.get_mut(conversation_id) {
            conversation.updated_at = message.created_at.clone();
        }
        persist_index(&self.root, &state.conversations)?;
        persist_messages(
            &self.root,
            conversation_id,
            state.messages.get(conversation_id),
        )?;
        Ok(message)
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
        let conversations = load_index(root);
        let mut state = Self::default();
        for conversation in conversations {
            if conversation.kind == "dm" {
                state
                    .dm_by_agent
                    .insert(conversation.agent_id.clone(), conversation.id.clone());
            }
            state.messages.insert(
                conversation.id.clone(),
                load_messages(root, &conversation.id),
            );
            state
                .conversations
                .insert(conversation.id.clone(), conversation);
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

fn load_messages(root: &PathBuf, conversation_id: &str) -> Vec<ConversationMessageRecord> {
    fs::read_to_string(messages_path(root, conversation_id))
        .ok()
        .and_then(|raw| serde_json::from_str::<Vec<ConversationMessageRecord>>(&raw).ok())
        .unwrap_or_default()
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

fn messages_path(root: &PathBuf, conversation_id: &str) -> PathBuf {
    let safe_id = conversation_id.replace(':', "_").replace('/', "_");
    root.join("conversations/messages")
        .join(format!("{safe_id}.json"))
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
