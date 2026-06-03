use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use uuid::Uuid;

#[derive(Clone, Debug)]
pub struct SendMessageDraft {
    pub channel_id: String,
    pub author_id: String,
    pub body: String,
    pub as_task: bool,
    pub workspace_count: usize,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MessageRecord {
    pub id: String,
    pub channel_id: String,
    pub author_id: String,
    pub body: Option<String>,
    pub kind: MessageKind,
    pub deleted: bool,
    pub edited: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum MessageKind {
    Human,
    Agent,
    TaskCard,
    Tombstone,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SendMessageOutcome {
    AgentRun {
        message_id: String,
        agent_id: String,
        restricted_no_workspace: bool,
    },
    HumanNotification {
        message_id: String,
        handle: String,
    },
}

impl SendMessageOutcome {
    pub fn message_id(&self) -> String {
        match self {
            SendMessageOutcome::AgentRun { message_id, .. }
            | SendMessageOutcome::HumanNotification { message_id, .. } => message_id.clone(),
        }
    }
}

#[derive(Clone, Debug, Default)]
pub struct MessageService {
    inner: Arc<Mutex<MessageState>>,
}

#[derive(Debug, Default)]
struct MessageState {
    messages: HashMap<String, MessageRecord>,
    idempotency: HashMap<String, SendMessageOutcome>,
    primary_agents: HashMap<String, String>,
    agent_handles: HashMap<String, String>,
    event_payloads: Vec<String>,
    channel_message_idempotency: HashMap<String, String>,
}

impl MessageService {
    pub fn for_tests() -> Self {
        Self::default()
    }

    pub fn set_primary_agent_for_tests(&self, channel_id: &str, agent_id: &str) {
        self.inner
            .lock()
            .expect("message state lock")
            .primary_agents
            .insert(channel_id.to_string(), agent_id.to_string());
    }

    pub fn add_agent_for_tests(&self, handle: &str, agent_id: &str) {
        self.inner
            .lock()
            .expect("message state lock")
            .agent_handles
            .insert(handle.to_string(), agent_id.to_string());
    }

    pub async fn send_message(
        &self,
        draft: SendMessageDraft,
        idempotency_key: &str,
    ) -> Result<SendMessageOutcome, MessageError> {
        let mut state = self.inner.lock().expect("message state lock");
        if let Some(outcome) = state.idempotency.get(idempotency_key) {
            return Ok(outcome.clone());
        }

        let message = MessageRecord {
            id: format!("msg_{}", Uuid::new_v4().simple()),
            channel_id: draft.channel_id.clone(),
            author_id: draft.author_id,
            body: Some(draft.body.clone()),
            kind: MessageKind::Human,
            deleted: false,
            edited: false,
        };
        state.messages.insert(message.id.clone(), message.clone());
        state
            .event_payloads
            .push(format!("message.created:{}", message.id));

        let outcome = if let Some(handle) = first_mention(&draft.body) {
            if let Some(agent_id) = state.agent_handles.get(&handle) {
                SendMessageOutcome::AgentRun {
                    message_id: message.id,
                    agent_id: agent_id.clone(),
                    restricted_no_workspace: draft.workspace_count == 0,
                }
            } else {
                SendMessageOutcome::HumanNotification {
                    message_id: message.id,
                    handle,
                }
            }
        } else {
            let agent_id = state
                .primary_agents
                .get(&draft.channel_id)
                .cloned()
                .ok_or(MessageError::PrimaryAgentMissing)?;
            SendMessageOutcome::AgentRun {
                message_id: message.id,
                agent_id,
                restricted_no_workspace: draft.workspace_count == 0,
            }
        };

        state
            .idempotency
            .insert(idempotency_key.to_string(), outcome.clone());
        Ok(outcome)
    }

    pub async fn insert_human_for_tests(
        &self,
        channel_id: &str,
        author_id: &str,
        body: &str,
    ) -> String {
        self.insert_for_tests(channel_id, author_id, body, MessageKind::Human)
            .await
    }

    pub async fn insert_agent_for_tests(
        &self,
        channel_id: &str,
        author_id: &str,
        body: &str,
    ) -> String {
        self.insert_for_tests(channel_id, author_id, body, MessageKind::Agent)
            .await
    }

    pub async fn create_agent_channel_message(
        &self,
        channel_id: &str,
        author_id: &str,
        body: &str,
    ) -> Result<MessageRecord, MessageError> {
        if channel_id.trim().is_empty() || author_id.trim().is_empty() || body.trim().is_empty() {
            return Err(MessageError::InvalidMessage);
        }
        self.insert_channel_message(channel_id, author_id, body, MessageKind::Agent)
            .await
    }

    pub async fn create_human_channel_message(
        &self,
        channel_id: &str,
        author_id: &str,
        body: &str,
        idempotency_key: &str,
    ) -> Result<MessageRecord, MessageError> {
        if channel_id.trim().is_empty()
            || author_id.trim().is_empty()
            || body.trim().is_empty()
            || idempotency_key.trim().is_empty()
        {
            return Err(MessageError::InvalidMessage);
        }
        let mut state = self.inner.lock().expect("message state lock");
        if let Some(message_id) = state.channel_message_idempotency.get(idempotency_key) {
            return state
                .messages
                .get(message_id)
                .cloned()
                .ok_or(MessageError::MessageNotFound);
        }

        let message = build_message(channel_id, author_id, Some(body), MessageKind::Human);
        state
            .channel_message_idempotency
            .insert(idempotency_key.to_string(), message.id.clone());
        state.messages.insert(message.id.clone(), message.clone());
        state
            .event_payloads
            .push(format!("message.created:{}", message.id));
        Ok(message)
    }

    pub async fn channel_message_for_idempotency(
        &self,
        idempotency_key: &str,
    ) -> Option<MessageRecord> {
        let state = self.inner.lock().expect("message state lock");
        state
            .channel_message_idempotency
            .get(idempotency_key)
            .and_then(|message_id| state.messages.get(message_id))
            .cloned()
    }

    pub async fn create_task_card_message(
        &self,
        channel_id: &str,
        task_id: &str,
        source_message_id: &str,
    ) -> Result<MessageRecord, MessageError> {
        if channel_id.trim().is_empty()
            || task_id.trim().is_empty()
            || source_message_id.trim().is_empty()
        {
            return Err(MessageError::InvalidMessage);
        }
        let body = format!("task_card:{task_id}:source:{source_message_id}");
        {
            let state = self.inner.lock().expect("message state lock");
            if let Some(existing) = state.messages.values().find(|message| {
                message.channel_id == channel_id
                    && message.kind == MessageKind::TaskCard
                    && message.body.as_deref() == Some(body.as_str())
                    && !message.deleted
            }) {
                return Ok(existing.clone());
            }
        }
        self.insert_channel_message(
            channel_id,
            "channel_coordinator",
            &body,
            MessageKind::TaskCard,
        )
        .await
    }

    pub async fn channel_messages_for_tests(&self, channel_id: &str) -> Vec<MessageRecord> {
        let mut messages = self
            .inner
            .lock()
            .expect("message state lock")
            .messages
            .values()
            .filter(|message| message.channel_id == channel_id)
            .filter(|message| !message.deleted)
            .cloned()
            .collect::<Vec<_>>();
        messages.sort_by(|left, right| left.id.cmp(&right.id));
        messages
    }

    pub async fn delete_human_message(&self, message_id: &str) -> Result<(), MessageError> {
        let mut state = self.inner.lock().expect("message state lock");
        let message = state
            .messages
            .get_mut(message_id)
            .ok_or(MessageError::MessageNotFound)?;
        if message.kind == MessageKind::Agent {
            return Err(MessageError::AgentMessageImmutable);
        }
        message.kind = MessageKind::Tombstone;
        message.body = None;
        message.deleted = true;
        state
            .event_payloads
            .push(format!("message.deleted:{message_id}"));
        Ok(())
    }

    pub async fn edit_human_message(
        &self,
        message_id: &str,
        body: &str,
    ) -> Result<(), MessageError> {
        let mut state = self.inner.lock().expect("message state lock");
        let message = state
            .messages
            .get_mut(message_id)
            .ok_or(MessageError::MessageNotFound)?;
        if message.kind != MessageKind::Human {
            return Err(MessageError::AgentMessageImmutable);
        }
        message.body = Some(body.to_string());
        message.edited = true;
        Ok(())
    }

    pub async fn message(&self, message_id: &str) -> Result<MessageRecord, MessageError> {
        self.inner
            .lock()
            .expect("message state lock")
            .messages
            .get(message_id)
            .cloned()
            .ok_or(MessageError::MessageNotFound)
    }

    pub async fn reconstructed_context(&self, channel_id: &str) -> String {
        self.inner
            .lock()
            .expect("message state lock")
            .messages
            .values()
            .filter(|message| message.channel_id == channel_id)
            .filter(|message| !message.deleted)
            .filter_map(|message| message.body.clone())
            .collect::<Vec<_>>()
            .join("\n")
    }

    pub async fn event_payloads(&self) -> Vec<String> {
        self.inner
            .lock()
            .expect("message state lock")
            .event_payloads
            .clone()
    }

    async fn insert_for_tests(
        &self,
        channel_id: &str,
        author_id: &str,
        body: &str,
        kind: MessageKind,
    ) -> String {
        let mut state = self.inner.lock().expect("message state lock");
        let id = format!("msg_{}", Uuid::new_v4().simple());
        state.messages.insert(
            id.clone(),
            MessageRecord {
                id: id.clone(),
                channel_id: channel_id.to_string(),
                author_id: author_id.to_string(),
                body: Some(body.to_string()),
                kind,
                deleted: false,
                edited: false,
            },
        );
        id
    }

    async fn insert_channel_message(
        &self,
        channel_id: &str,
        author_id: &str,
        body: &str,
        kind: MessageKind,
    ) -> Result<MessageRecord, MessageError> {
        let mut state = self.inner.lock().expect("message state lock");
        let message = build_message(channel_id, author_id, Some(body), kind);
        state.messages.insert(message.id.clone(), message.clone());
        state
            .event_payloads
            .push(format!("message.created:{}", message.id));
        Ok(message)
    }
}

fn build_message(
    channel_id: &str,
    author_id: &str,
    body: Option<&str>,
    kind: MessageKind,
) -> MessageRecord {
    MessageRecord {
        id: format!("msg_{}", Uuid::new_v4().simple()),
        channel_id: channel_id.to_string(),
        author_id: author_id.to_string(),
        body: body.map(ToString::to_string),
        kind,
        deleted: false,
        edited: false,
    }
}

fn first_mention(body: &str) -> Option<String> {
    body.split_whitespace()
        .find_map(|part| part.strip_prefix('@').map(|handle| handle.to_string()))
}

#[derive(Debug, thiserror::Error)]
pub enum MessageError {
    #[error("primary agent missing")]
    PrimaryAgentMissing,
    #[error("message not found")]
    MessageNotFound,
    #[error("agent messages are immutable")]
    AgentMessageImmutable,
    #[error("invalid message")]
    InvalidMessage,
}
