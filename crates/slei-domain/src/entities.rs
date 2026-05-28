use serde::{Deserialize, Serialize};
use thiserror::Error;
use uuid::Uuid;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum MemberKind {
    Human,
    Agent,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum MessageKind {
    Text,
    SystemEvent,
    InteractiveCard,
    Tombstone,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum MessageBody {
    Text(String),
    Payload(serde_json::Value),
    Tombstone,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Message {
    pub id: Uuid,
    pub author: MemberKind,
    pub kind: MessageKind,
    pub body: MessageBody,
    pub deleted: bool,
    pub edited: bool,
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum MessageError {
    #[error("agent messages are immutable in the MVP")]
    AgentMessageImmutable,
    #[error("message is already deleted")]
    AlreadyDeleted,
}

impl Message {
    pub fn human_text(body: impl Into<String>) -> Self {
        Self {
            id: Uuid::new_v4(),
            author: MemberKind::Human,
            kind: MessageKind::Text,
            body: MessageBody::Text(body.into()),
            deleted: false,
            edited: false,
        }
    }

    pub fn agent_text(body: impl Into<String>) -> Self {
        Self {
            id: Uuid::new_v4(),
            author: MemberKind::Agent,
            kind: MessageKind::Text,
            body: MessageBody::Text(body.into()),
            deleted: false,
            edited: false,
        }
    }

    pub fn delete_to_tombstone(self) -> Result<Self, MessageError> {
        if self.deleted {
            return Err(MessageError::AlreadyDeleted);
        }
        if self.author == MemberKind::Agent {
            return Err(MessageError::AgentMessageImmutable);
        }

        Ok(Self {
            id: self.id,
            author: self.author,
            kind: MessageKind::Tombstone,
            body: MessageBody::Tombstone,
            deleted: true,
            edited: self.edited,
        })
    }
}
