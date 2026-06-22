use serde::{Deserialize, Serialize};
use slei_storage::repositories::{Repositories, SavedMessageRow};
use thiserror::Error;
use uuid::Uuid;

#[derive(Clone, Debug)]
pub struct SavedMessageService {
    repos: Repositories,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SaveMessageRequest {
    pub message_id: String,
    pub source_id: String,
    pub source_kind: String,
    pub session_id: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SavedMessageView {
    pub id: String,
    pub message_id: String,
    pub source_id: String,
    pub source_kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    pub saved_at: String,
    pub body: String,
    pub author_id: String,
    pub author_name: String,
    pub message_created_at: String,
    pub source_name: String,
    pub source_label: String,
    pub message_deleted: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SaveMessageOutcome {
    pub saved_message: SavedMessageView,
    pub created: bool,
}

#[derive(Debug, Error)]
pub enum SavedMessageError {
    #[error("invalid saved message")]
    InvalidSavedMessage,
    #[error("saved message not found")]
    SavedMessageNotFound,
    #[error("storage error: {0}")]
    Storage(String),
}

impl SavedMessageService {
    pub fn new(repos: Repositories) -> Self {
        Self { repos }
    }

    pub async fn list_saved_messages(&self) -> Result<Vec<SavedMessageView>, SavedMessageError> {
        let rows = self
            .repos
            .saved_messages()
            .await
            .map_err(saved_storage_error)?;
        let mut views = Vec::with_capacity(rows.len());
        for row in rows {
            views.push(self.enrich_saved_message(row).await?);
        }
        Ok(views)
    }

    pub async fn save_message(
        &self,
        request: SaveMessageRequest,
    ) -> Result<SaveMessageOutcome, SavedMessageError> {
        let message_id = normalize_required(&request.message_id)?;
        let source_id = normalize_required(&request.source_id)?;
        let source_kind = normalize_source_kind(&request.source_kind)?;
        let session_id = request
            .session_id
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToString::to_string);

        if let Some(existing) = self
            .repos
            .saved_messages()
            .await
            .map_err(saved_storage_error)?
            .into_iter()
            .find(|saved| saved.message_id == message_id)
        {
            return Ok(SaveMessageOutcome {
                saved_message: self.enrich_saved_message(existing).await?,
                created: false,
            });
        }

        let row = SavedMessageRow {
            id: format!("saved:{source_kind}:{source_id}:{message_id}"),
            message_id,
            source_id,
            source_kind,
            session_id,
            saved_at: current_timestamp(),
        };
        self.repos
            .upsert_saved_message(row.clone())
            .await
            .map_err(saved_storage_error)?;
        Ok(SaveMessageOutcome {
            saved_message: self.enrich_saved_message(row).await?,
            created: true,
        })
    }

    pub async fn unsave_message(&self, message_id: &str) -> Result<(), SavedMessageError> {
        let message_id = normalize_required(message_id)?;
        self.repos
            .delete_saved_message(&message_id)
            .await
            .map_err(saved_storage_error)?;
        Ok(())
    }

    async fn enrich_saved_message(
        &self,
        row: SavedMessageRow,
    ) -> Result<SavedMessageView, SavedMessageError> {
        let source_name = self.source_name(&row).await?;
        let source_label = source_label(&row.source_kind, &source_name);
        let mut body = String::new();
        let mut author_id = String::new();
        let mut message_created_at = String::new();
        let mut message_deleted = true;

        if row.source_kind == "dm" {
            if let Some(message) = self
                .repos
                .conversation_messages(&row.source_id)
                .await
                .map_err(saved_storage_error)?
                .into_iter()
                .find(|message| message.id == row.message_id)
            {
                body = message.body;
                author_id = message.author_id;
                message_created_at = message.created_at;
                message_deleted = false;
            }
        } else if let Some(message) = self
            .repos
            .channel_message(&row.message_id)
            .await
            .map_err(saved_storage_error)?
        {
            author_id = message.author_id;
            message_created_at = message.created_at;
            if !message.deleted {
                body = message.body.unwrap_or_default();
                message_deleted = false;
            }
        }

        let author_name = self.author_name(&author_id).await?;

        Ok(SavedMessageView {
            id: row.id,
            message_id: row.message_id,
            source_id: row.source_id,
            source_kind: row.source_kind,
            session_id: row.session_id,
            saved_at: row.saved_at,
            body,
            author_id: author_id.clone(),
            author_name,
            message_created_at,
            source_name,
            source_label,
            message_deleted,
        })
    }

    async fn source_name(&self, row: &SavedMessageRow) -> Result<String, SavedMessageError> {
        if row.source_kind == "dm" {
            let Some(conversation) = self
                .repos
                .conversation(&row.source_id)
                .await
                .map_err(saved_storage_error)?
            else {
                return Ok(row.source_id.clone());
            };
            return self.author_name(&conversation.agent_id).await;
        }

        let channel_name = self
            .repos
            .channels()
            .await
            .map_err(saved_storage_error)?
            .into_iter()
            .find(|channel| channel.id == row.source_id)
            .map(|channel| channel.name)
            .unwrap_or_else(|| row.source_id.clone());
        Ok(channel_name)
    }

    async fn author_name(&self, author_id: &str) -> Result<String, SavedMessageError> {
        if author_id.trim().is_empty() {
            return Ok(String::new());
        }
        Ok(self
            .repos
            .agent_by_id(author_id)
            .await
            .map_err(saved_storage_error)?
            .map(|agent| agent.name)
            .unwrap_or_else(|| author_id.to_string()))
    }
}

fn normalize_required(value: &str) -> Result<String, SavedMessageError> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(SavedMessageError::InvalidSavedMessage);
    }
    Ok(trimmed.to_string())
}

fn normalize_source_kind(value: &str) -> Result<String, SavedMessageError> {
    let source_kind = normalize_required(value)?;
    if !matches!(source_kind.as_str(), "channel" | "dm") {
        return Err(SavedMessageError::InvalidSavedMessage);
    }
    Ok(source_kind)
}

fn source_label(source_kind: &str, source_name: &str) -> String {
    if source_kind == "dm" {
        return format!("私聊 · {source_name}");
    }
    format!("群聊 · #{}", source_name.trim_start_matches('#'))
}

fn current_timestamp() -> String {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| format!("{:020}", duration.as_nanos()))
        .unwrap_or_else(|_| Uuid::new_v4().simple().to_string())
}

fn saved_storage_error(error: sqlx::Error) -> SavedMessageError {
    SavedMessageError::Storage(error.to_string())
}
