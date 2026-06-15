use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use serde_json::json;
use slei_storage::db::SleiDb;
use slei_storage::repositories::{ChannelMessageRow, NewChannelMessageRow, Repositories};
use tokio::sync::Mutex as AsyncMutex;
use uuid::Uuid;

use crate::services::card_service::InteractiveCardView;
use crate::services::idempotency::namespaced_key;

#[derive(Clone, Debug)]
pub struct SendMessageDraft {
    pub channel_id: String,
    pub author_id: String,
    pub body: String,
    pub as_task: bool,
    pub workspace_count: usize,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageRecord {
    pub id: String,
    pub channel_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    pub author_id: String,
    pub body: Option<String>,
    #[serde(default)]
    pub as_task: bool,
    pub kind: MessageKind,
    pub deleted: bool,
    pub edited: bool,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub cards: Vec<InteractiveCardView>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum MessageKind {
    Human,
    Agent,
    TaskCard,
    Tombstone,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
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

#[derive(Clone, Debug)]
pub struct MessageService {
    repos: Repositories,
    inner: Arc<Mutex<MessageState>>,
    idempotency_gate: Arc<AsyncMutex<()>>,
}

#[derive(Debug, Default)]
struct MessageState {
    idempotency: HashMap<String, SendMessageOutcome>,
    primary_agents: HashMap<String, String>,
    agent_handles: HashMap<String, String>,
    event_payloads: Vec<String>,
    channel_message_idempotency: HashMap<String, String>,
}

impl MessageService {
    pub fn for_tests() -> Self {
        Self::persistent(repositories_blocking(
            std::env::temp_dir().join(format!("slei-messages-{}", Uuid::new_v4())),
        ))
    }

    pub fn persistent(repos: Repositories) -> Self {
        Self {
            repos,
            inner: Arc::new(Mutex::new(MessageState::default())),
            idempotency_gate: Arc::new(AsyncMutex::new(())),
        }
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

    pub fn clear_for_development_reset(&self) {
        *self.inner.lock().expect("message state lock") = MessageState::default();
    }

    pub async fn send_message(
        &self,
        draft: SendMessageDraft,
        idempotency_key: &str,
    ) -> Result<SendMessageOutcome, MessageError> {
        let idempotency_key =
            namespaced_key("message:send", idempotency_key).ok_or(MessageError::InvalidMessage)?;
        let _idempotency_guard = self.idempotency_gate.lock().await;
        if let Some(payload) = self
            .repos
            .idempotent_response(&idempotency_key)
            .await
            .map_err(message_storage_error)?
        {
            let outcome: SendMessageOutcome = serde_json::from_str(&payload)
                .map_err(|error| MessageError::Storage(error.to_string()))?;
            self.inner
                .lock()
                .expect("message state lock")
                .idempotency
                .insert(idempotency_key.clone(), outcome.clone());
            return Ok(outcome);
        }
        if let Some(outcome) = self
            .inner
            .lock()
            .expect("message state lock")
            .idempotency
            .get(&idempotency_key)
            .cloned()
        {
            return Ok(outcome);
        }

        let message = build_message_with_as_task(
            &draft.channel_id,
            None,
            &draft.author_id,
            Some(&draft.body),
            MessageKind::Human,
            draft.as_task,
        );
        let outcome = {
            let state = self.inner.lock().expect("message state lock");
            if let Some(handle) = first_mention(&draft.body) {
                if let Some(agent_id) = state.agent_handles.get(&handle) {
                    SendMessageOutcome::AgentRun {
                        message_id: message.id.clone(),
                        agent_id: agent_id.clone(),
                        restricted_no_workspace: draft.workspace_count == 0,
                    }
                } else {
                    SendMessageOutcome::HumanNotification {
                        message_id: message.id.clone(),
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
                    message_id: message.id.clone(),
                    agent_id,
                    restricted_no_workspace: draft.workspace_count == 0,
                }
            }
        };

        self.insert_record_idempotent(
            message.clone(),
            &idempotency_key,
            &serde_json::to_string(&outcome)
                .map_err(|error| MessageError::Storage(error.to_string()))?,
        )
        .await?;
        self.inner
            .lock()
            .expect("message state lock")
            .event_payloads
            .push(format!("message.created:{}", message.id));
        self.inner
            .lock()
            .expect("message state lock")
            .idempotency
            .insert(idempotency_key, outcome.clone());
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
        self.create_agent_channel_message_with_session(channel_id, None, author_id, body)
            .await
    }

    pub async fn create_agent_channel_message_with_session(
        &self,
        channel_id: &str,
        session_id: Option<&str>,
        author_id: &str,
        body: &str,
    ) -> Result<MessageRecord, MessageError> {
        if channel_id.trim().is_empty() || author_id.trim().is_empty() || body.trim().is_empty() {
            return Err(MessageError::InvalidMessage);
        }
        self.insert_channel_message(channel_id, session_id, author_id, body, MessageKind::Agent)
            .await
    }

    pub async fn create_agent_card_channel_message(
        &self,
        channel_id: &str,
        author_id: &str,
        message_id: &str,
        cards: Vec<InteractiveCardView>,
    ) -> Result<MessageRecord, MessageError> {
        self.create_agent_card_channel_message_with_session(
            channel_id, None, author_id, message_id, cards,
        )
        .await
    }

    pub async fn create_agent_card_channel_message_with_session(
        &self,
        channel_id: &str,
        session_id: Option<&str>,
        author_id: &str,
        message_id: &str,
        cards: Vec<InteractiveCardView>,
    ) -> Result<MessageRecord, MessageError> {
        if channel_id.trim().is_empty() || author_id.trim().is_empty() || cards.is_empty() {
            return Err(MessageError::InvalidMessage);
        }
        let mut message = build_message_with_session(
            channel_id,
            session_id,
            author_id,
            Some(""),
            MessageKind::Agent,
        );
        message.id = message_id.to_string();
        message.cards = cards;
        self.insert_record(message.clone()).await?;
        Ok(message)
    }

    pub async fn create_human_channel_message(
        &self,
        channel_id: &str,
        author_id: &str,
        body: &str,
        idempotency_key: &str,
        as_task: bool,
    ) -> Result<MessageRecord, MessageError> {
        self.create_human_channel_message_with_session(
            channel_id,
            None,
            author_id,
            body,
            idempotency_key,
            as_task,
        )
        .await
    }

    pub async fn create_human_channel_message_with_session(
        &self,
        channel_id: &str,
        session_id: Option<&str>,
        author_id: &str,
        body: &str,
        idempotency_key: &str,
        as_task: bool,
    ) -> Result<MessageRecord, MessageError> {
        if channel_id.trim().is_empty()
            || author_id.trim().is_empty()
            || body.trim().is_empty()
            || idempotency_key.trim().is_empty()
        {
            return Err(MessageError::InvalidMessage);
        }
        let idempotency_key = namespaced_key("message:create_human", idempotency_key)
            .ok_or(MessageError::InvalidMessage)?;
        let _idempotency_guard = self.idempotency_gate.lock().await;
        if let Some(payload) = self
            .repos
            .idempotent_response(&idempotency_key)
            .await
            .map_err(message_storage_error)?
        {
            let message_id = idempotent_entity_id(&payload);
            self.inner
                .lock()
                .expect("message state lock")
                .channel_message_idempotency
                .insert(idempotency_key.clone(), message_id.clone());
            return self.message(&message_id).await;
        }
        let idempotent_message_id = {
            self.inner
                .lock()
                .expect("message state lock")
                .channel_message_idempotency
                .get(&idempotency_key)
                .cloned()
        };
        if let Some(message_id) = idempotent_message_id {
            return self.message(&message_id).await;
        }

        let message = build_message_with_as_task(
            channel_id,
            session_id,
            author_id,
            Some(body),
            MessageKind::Human,
            as_task,
        );
        self.insert_record_idempotent(
            message.clone(),
            &idempotency_key,
            &json!({ "messageId": message.id }).to_string(),
        )
        .await?;
        let mut state = self.inner.lock().expect("message state lock");
        state
            .channel_message_idempotency
            .insert(idempotency_key, message.id.clone());
        state
            .event_payloads
            .push(format!("message.created:{}", message.id));
        Ok(message)
    }

    pub async fn channel_message_for_idempotency(
        &self,
        idempotency_key: &str,
    ) -> Option<MessageRecord> {
        let idempotency_key = namespaced_key("message:create_human", idempotency_key)?;
        if let Ok(Some(payload)) = self.repos.idempotent_response(&idempotency_key).await {
            return self.message(&idempotent_entity_id(&payload)).await.ok();
        }
        let message_id = {
            self.inner
                .lock()
                .expect("message state lock")
                .channel_message_idempotency
                .get(&idempotency_key)
                .cloned()?
        };
        self.message(&message_id).await.ok()
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
        if let Some(existing) =
            self.channel_messages(channel_id)
                .await
                .into_iter()
                .find(|message| {
                    message.kind == MessageKind::TaskCard
                        && message.body.as_deref() == Some(body.as_str())
                        && !message.deleted
                })
        {
            return Ok(existing);
        }
        self.insert_channel_message(
            channel_id,
            None,
            "channel_coordinator",
            &body,
            MessageKind::TaskCard,
        )
        .await
    }

    pub async fn channel_messages(&self, channel_id: &str) -> Vec<MessageRecord> {
        self.repos
            .channel_messages_by_channel(channel_id)
            .await
            .expect("load channel messages")
            .into_iter()
            .map(message_row_to_record)
            .filter(|message| !message.deleted)
            .collect()
    }

    pub async fn channel_messages_for_session(
        &self,
        channel_id: &str,
        session_id: &str,
    ) -> Vec<MessageRecord> {
        self.repos
            .channel_messages_by_channel_and_session(channel_id, Some(session_id))
            .await
            .expect("load channel messages")
            .into_iter()
            .map(message_row_to_record)
            .filter(|message| !message.deleted)
            .collect()
    }

    pub async fn channel_messages_for_tests(&self, channel_id: &str) -> Vec<MessageRecord> {
        self.channel_messages(channel_id).await
    }

    pub async fn delete_human_message(&self, message_id: &str) -> Result<(), MessageError> {
        let message = self.message(message_id).await?;
        if message.kind == MessageKind::Agent {
            return Err(MessageError::AgentMessageImmutable);
        }
        self.repos
            .update_message_tombstone(message_id)
            .await
            .map_err(message_storage_error)?;
        self.inner
            .lock()
            .expect("message state lock")
            .event_payloads
            .push(format!("message.deleted:{message_id}"));
        Ok(())
    }

    pub async fn edit_human_message(
        &self,
        message_id: &str,
        body: &str,
    ) -> Result<(), MessageError> {
        let message = self.message(message_id).await?;
        if message.kind != MessageKind::Human {
            return Err(MessageError::AgentMessageImmutable);
        }
        self.repos
            .update_human_message_body(message_id, body)
            .await
            .map_err(message_storage_error)?;
        Ok(())
    }

    pub async fn message(&self, message_id: &str) -> Result<MessageRecord, MessageError> {
        self.repos
            .channel_message(message_id)
            .await
            .map_err(message_storage_error)?
            .map(message_row_to_record)
            .ok_or(MessageError::MessageNotFound)
    }

    pub async fn reconstructed_context(&self, channel_id: &str) -> String {
        self.channel_messages(channel_id)
            .await
            .into_iter()
            .filter_map(|message| message.body)
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
        let message = build_message(channel_id, author_id, Some(body), kind);
        self.insert_record(message.clone())
            .await
            .expect("insert test message");
        message.id
    }

    async fn insert_channel_message(
        &self,
        channel_id: &str,
        session_id: Option<&str>,
        author_id: &str,
        body: &str,
        kind: MessageKind,
    ) -> Result<MessageRecord, MessageError> {
        let message =
            build_message_with_session(channel_id, session_id, author_id, Some(body), kind);
        self.insert_record(message.clone()).await?;
        self.inner
            .lock()
            .expect("message state lock")
            .event_payloads
            .push(format!("message.created:{}", message.id));
        Ok(message)
    }

    async fn insert_record(&self, message: MessageRecord) -> Result<(), MessageError> {
        self.repos
            .insert_channel_message(NewChannelMessageRow {
                id: message.id,
                channel_id: message.channel_id,
                session_id: message.session_id,
                author_id: message.author_id,
                body: message.body,
                as_task: message.as_task,
                kind: kind_to_storage(&message.kind).to_string(),
            })
            .await
            .map_err(message_storage_error)?;
        Ok(())
    }

    async fn insert_record_idempotent(
        &self,
        message: MessageRecord,
        idempotency_key: &str,
        response_payload: &str,
    ) -> Result<(), MessageError> {
        self.repos
            .insert_channel_message_idempotent(
                NewChannelMessageRow {
                    id: message.id,
                    channel_id: message.channel_id,
                    session_id: message.session_id,
                    author_id: message.author_id,
                    body: message.body,
                    as_task: message.as_task,
                    kind: kind_to_storage(&message.kind).to_string(),
                },
                idempotency_key,
                response_payload,
            )
            .await
            .map_err(message_storage_error)?;
        Ok(())
    }
}

fn idempotent_entity_id(payload: &str) -> String {
    serde_json::from_str::<serde_json::Value>(payload)
        .ok()
        .and_then(|value| {
            value
                .get("messageId")
                .and_then(|id| id.as_str())
                .map(ToString::to_string)
                .or_else(|| {
                    value
                        .get("message_id")
                        .and_then(|id| id.as_str())
                        .map(ToString::to_string)
                })
        })
        .unwrap_or_else(|| payload.to_string())
}

fn build_message(
    channel_id: &str,
    author_id: &str,
    body: Option<&str>,
    kind: MessageKind,
) -> MessageRecord {
    build_message_with_as_task(channel_id, None, author_id, body, kind, false)
}

fn build_message_with_session(
    channel_id: &str,
    session_id: Option<&str>,
    author_id: &str,
    body: Option<&str>,
    kind: MessageKind,
) -> MessageRecord {
    build_message_with_as_task(channel_id, session_id, author_id, body, kind, false)
}

fn build_message_with_as_task(
    channel_id: &str,
    session_id: Option<&str>,
    author_id: &str,
    body: Option<&str>,
    kind: MessageKind,
    as_task: bool,
) -> MessageRecord {
    MessageRecord {
        id: format!("msg_{}", Uuid::new_v4().simple()),
        channel_id: channel_id.to_string(),
        session_id: session_id.map(ToString::to_string),
        author_id: author_id.to_string(),
        body: body.map(ToString::to_string),
        as_task,
        kind,
        deleted: false,
        edited: false,
        cards: Vec::new(),
    }
}

fn message_row_to_record(row: ChannelMessageRow) -> MessageRecord {
    MessageRecord {
        id: row.id,
        channel_id: row.channel_id,
        session_id: row.session_id,
        author_id: row.author_id,
        body: row.body,
        as_task: row.as_task,
        kind: kind_from_storage(&row.kind),
        deleted: row.deleted,
        edited: row.edited,
        cards: Vec::new(),
    }
}

fn kind_to_storage(kind: &MessageKind) -> &'static str {
    match kind {
        MessageKind::Human => "human",
        MessageKind::Agent => "agent",
        MessageKind::TaskCard => "task_card",
        MessageKind::Tombstone => "tombstone",
    }
}

fn kind_from_storage(kind: &str) -> MessageKind {
    match kind {
        "agent" => MessageKind::Agent,
        "task_card" => MessageKind::TaskCard,
        "tombstone" => MessageKind::Tombstone,
        _ => MessageKind::Human,
    }
}

fn first_mention(body: &str) -> Option<String> {
    body.split_whitespace()
        .find_map(|part| part.strip_prefix('@').map(|handle| handle.to_string()))
}

fn repositories_blocking(data_root: PathBuf) -> Repositories {
    std::thread::spawn(move || {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("create message repository runtime");
        runtime.block_on(async move {
            std::fs::create_dir_all(&data_root).expect("create message data root");
            let database_url = format!("sqlite://{}", data_root.join("slei.sqlite").display());
            let db = SleiDb::connect(&database_url)
                .await
                .expect("connect message db");
            db.migrate().await.expect("migrate message db");
            Repositories::new(db.pool().clone())
        })
    })
    .join()
    .expect("initialize message repositories")
}

fn message_storage_error(error: sqlx::Error) -> MessageError {
    MessageError::Storage(error.to_string())
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
    #[error("message storage error: {0}")]
    Storage(String),
}
