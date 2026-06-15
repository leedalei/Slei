use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use serde_json::json;
use slei_storage::db::SleiDb;
use slei_storage::repositories::{Repositories, TaskQueryRow, TaskReplyRow, TaskRootRow};
use tokio::sync::Mutex as AsyncMutex;
use uuid::Uuid;

use crate::services::idempotency::namespaced_key;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TaskStatus {
    PendingAssignment,
    InProgress,
    InReview,
    Done,
}

impl TaskStatus {
    pub fn columns() -> [TaskStatus; 4] {
        [
            TaskStatus::PendingAssignment,
            TaskStatus::InProgress,
            TaskStatus::InReview,
            TaskStatus::Done,
        ]
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskRecord {
    pub id: String,
    pub channel_id: String,
    pub creator_id: String,
    pub assignee_id: Option<String>,
    pub source_message_id: Option<String>,
    pub assignment_reason: Option<String>,
    pub needs_assignment: bool,
    pub title: String,
    pub status: TaskStatus,
    pub attention_required: bool,
    pub root_deleted: bool,
    pub root_body: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskReply {
    pub id: String,
    pub sender_id: String,
    pub role: Option<String>,
    pub body: String,
    pub status: Option<String>,
    pub created_at: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AddTaskReplyOutcome {
    pub task_id: String,
    pub reply: TaskReply,
    pub created: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskSummaryView {
    pub id: String,
    pub channel_id: String,
    pub creator_id: String,
    pub assignee_id: Option<String>,
    pub source_message_id: Option<String>,
    pub title: String,
    pub status: TaskStatus,
    pub attention_required: bool,
    pub reply_count: usize,
    pub updated_at: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskThreadMessage {
    pub id: String,
    pub task_id: String,
    pub sender_id: String,
    pub role: String,
    pub body: String,
    pub status: Option<String>,
    pub created_at: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskThreadView {
    pub task: TaskSummaryView,
    pub root: TaskThreadMessage,
    pub replies: Vec<TaskThreadMessage>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct TaskQuery {
    pub channel_id: Option<String>,
    pub creator_id: Option<String>,
    pub assignee_id: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TaskColumn {
    pub status: TaskStatus,
    pub tasks: Vec<TaskRecord>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TaskBoard {
    pub columns: Vec<TaskColumn>,
}

impl TaskBoard {
    pub fn column(&self, status: TaskStatus) -> Option<&TaskColumn> {
        self.columns.iter().find(|column| column.status == status)
    }
}

#[derive(Clone, Debug)]
pub struct TaskService {
    repos: Repositories,
    idempotency: Arc<Mutex<TaskIdempotencyState>>,
    idempotency_gate: Arc<AsyncMutex<()>>,
}

#[derive(Debug, Default)]
struct TaskIdempotencyState {
    task_idempotency: HashMap<String, String>,
    reply_idempotency: HashMap<String, (String, String)>,
    status_idempotency: HashMap<String, TaskSummaryView>,
}

impl TaskService {
    pub fn for_tests() -> Self {
        Self::new(repositories_blocking(
            std::env::temp_dir().join(format!("slei-tasks-{}", Uuid::new_v4())),
        ))
    }

    pub fn new(repos: Repositories) -> Self {
        Self {
            repos,
            idempotency: Arc::new(Mutex::new(TaskIdempotencyState::default())),
            idempotency_gate: Arc::new(AsyncMutex::new(())),
        }
    }

    pub fn clear_for_development_reset(&self) {
        *self.idempotency.lock().expect("task idempotency lock") = TaskIdempotencyState::default();
    }

    pub async fn create_task_root(
        &self,
        channel_id: &str,
        creator_id: &str,
        title: &str,
        idempotency_key: &str,
    ) -> Result<TaskRecord, TaskError> {
        let idempotency_key = namespaced_key("task:create_root", idempotency_key)
            .ok_or(TaskError::MissingIdempotencyKey)?;
        let _idempotency_guard = self.idempotency_gate.lock().await;
        if let Some(task_id) = self.task_id_for_idempotency(&idempotency_key).await? {
            self.idempotency
                .lock()
                .expect("task idempotency lock")
                .task_idempotency
                .insert(idempotency_key.clone(), task_id.clone());
            return self.task(&task_id).await;
        }
        let existing_task_id = {
            self.idempotency
                .lock()
                .expect("task idempotency lock")
                .task_idempotency
                .get(&idempotency_key)
                .cloned()
        };
        if let Some(task_id) = existing_task_id {
            return self.task(&task_id).await;
        }

        let now = now_string();
        let task = TaskRecord {
            id: format!("task_{}", Uuid::new_v4().simple()),
            channel_id: channel_id.to_string(),
            creator_id: creator_id.to_string(),
            assignee_id: None,
            source_message_id: None,
            assignment_reason: None,
            needs_assignment: true,
            title: title.to_string(),
            status: TaskStatus::PendingAssignment,
            attention_required: true,
            root_deleted: false,
            root_body: title.to_string(),
            created_at: now.clone(),
            updated_at: now,
        };
        self.repos
            .upsert_task_root_idempotent(
                task_record_to_row(&task),
                &idempotency_key,
                &json!({ "taskId": task.id }).to_string(),
            )
            .await
            .map_err(storage_error)?;
        self.idempotency
            .lock()
            .expect("task idempotency lock")
            .task_idempotency
            .insert(idempotency_key, task.id.clone());
        Ok(task)
    }

    pub async fn create_from_coordinator(
        &self,
        channel_id: &str,
        creator_id: &str,
        source_message_id: &str,
        title: &str,
        assignee_id: Option<String>,
        assignment_reason: &str,
        idempotency_key: &str,
    ) -> Result<TaskRecord, TaskError> {
        let idempotency_key = namespaced_key("task:create_from_coordinator", idempotency_key)
            .ok_or(TaskError::MissingIdempotencyKey)?;
        let _idempotency_guard = self.idempotency_gate.lock().await;
        if let Some(task_id) = self.task_id_for_idempotency(&idempotency_key).await? {
            self.idempotency
                .lock()
                .expect("task idempotency lock")
                .task_idempotency
                .insert(idempotency_key.clone(), task_id.clone());
            return self.task(&task_id).await;
        }
        let existing_task_id = {
            self.idempotency
                .lock()
                .expect("task idempotency lock")
                .task_idempotency
                .get(&idempotency_key)
                .cloned()
        };
        if let Some(task_id) = existing_task_id {
            return self.task(&task_id).await;
        }

        let has_assignee = assignee_id.is_some();
        let now = now_string();
        let task = TaskRecord {
            id: format!("task_{}", Uuid::new_v4().simple()),
            channel_id: channel_id.to_string(),
            creator_id: creator_id.to_string(),
            needs_assignment: !has_assignee,
            assignee_id,
            source_message_id: Some(source_message_id.to_string()),
            assignment_reason: Some(assignment_reason.to_string()),
            title: title.to_string(),
            status: if has_assignee {
                TaskStatus::InProgress
            } else {
                TaskStatus::PendingAssignment
            },
            attention_required: !has_assignee,
            root_deleted: false,
            root_body: title.to_string(),
            created_at: now.clone(),
            updated_at: now,
        };
        self.repos
            .upsert_task_root_idempotent(
                task_record_to_row(&task),
                &idempotency_key,
                &json!({ "taskId": task.id }).to_string(),
            )
            .await
            .map_err(storage_error)?;
        self.idempotency
            .lock()
            .expect("task idempotency lock")
            .task_idempotency
            .insert(idempotency_key, task.id.clone());
        Ok(task)
    }

    pub async fn create_from_source_message(
        &self,
        source_message_id: &str,
        creator_id: &str,
        idempotency_key: &str,
    ) -> Result<TaskRecord, TaskError> {
        let source_message_id = source_message_id.trim();
        let creator_id = creator_id.trim();
        if source_message_id.is_empty() || creator_id.is_empty() {
            return Err(TaskError::InvalidTaskInput);
        }
        let idempotency_key = namespaced_key("task:create_from_source_message", idempotency_key)
            .ok_or(TaskError::MissingIdempotencyKey)?;
        let _idempotency_guard = self.idempotency_gate.lock().await;

        if let Some(existing) = self.task_for_source_message(source_message_id).await {
            self.idempotency
                .lock()
                .expect("task idempotency lock")
                .task_idempotency
                .insert(idempotency_key, existing.id.clone());
            return Ok(existing);
        }
        if let Some(task_id) = self.task_id_for_idempotency(&idempotency_key).await? {
            self.idempotency
                .lock()
                .expect("task idempotency lock")
                .task_idempotency
                .insert(idempotency_key.clone(), task_id.clone());
            return self.task(&task_id).await;
        }
        let existing_task_id = {
            self.idempotency
                .lock()
                .expect("task idempotency lock")
                .task_idempotency
                .get(&idempotency_key)
                .cloned()
        };
        if let Some(task_id) = existing_task_id {
            return self.task(&task_id).await;
        }

        let source = self
            .repos
            .channel_message(source_message_id)
            .await
            .map_err(storage_error)?
            .ok_or(TaskError::TaskNotFound)?;
        let source_body = source.body.unwrap_or_default();
        let now = now_string();
        let task = TaskRecord {
            id: format!("task_{}", Uuid::new_v4().simple()),
            channel_id: source.channel_id,
            creator_id: creator_id.to_string(),
            assignee_id: None,
            source_message_id: Some(source_message_id.to_string()),
            assignment_reason: None,
            needs_assignment: true,
            title: title_from_body(&source_body, source_message_id),
            status: TaskStatus::PendingAssignment,
            attention_required: true,
            root_deleted: false,
            root_body: source_body,
            created_at: now.clone(),
            updated_at: now,
        };
        self.repos
            .upsert_task_root_idempotent(
                task_record_to_row(&task),
                &idempotency_key,
                &json!({ "taskId": task.id }).to_string(),
            )
            .await
            .map_err(storage_error)?;
        self.idempotency
            .lock()
            .expect("task idempotency lock")
            .task_idempotency
            .insert(idempotency_key, task.id.clone());
        Ok(task)
    }

    pub async fn add_reply(
        &self,
        task_id: &str,
        sender_id: &str,
        body: &str,
        idempotency_key: &str,
    ) -> Result<TaskReply, TaskError> {
        Ok(self
            .add_reply_with_role(task_id, sender_id, None, body, idempotency_key)
            .await?
            .reply)
    }

    pub async fn add_reply_with_task(
        &self,
        task_id: &str,
        sender_id: &str,
        body: &str,
        idempotency_key: &str,
    ) -> Result<AddTaskReplyOutcome, TaskError> {
        self.add_reply_with_role(task_id, sender_id, None, body, idempotency_key)
            .await
    }

    pub async fn add_reply_with_role(
        &self,
        task_id: &str,
        sender_id: &str,
        role: Option<&str>,
        body: &str,
        idempotency_key: &str,
    ) -> Result<AddTaskReplyOutcome, TaskError> {
        let task_id = task_id.trim();
        let sender_id = sender_id.trim();
        let body = body.trim();
        if task_id.is_empty() || sender_id.is_empty() || body.is_empty() {
            return Err(TaskError::InvalidTaskInput);
        }
        let idempotency_key = namespaced_key("task:add_reply", idempotency_key)
            .ok_or(TaskError::MissingIdempotencyKey)?;
        let _idempotency_guard = self.idempotency_gate.lock().await;
        if let Some((existing_task_id, existing_reply_id)) =
            self.reply_id_for_idempotency(&idempotency_key).await?
        {
            self.idempotency
                .lock()
                .expect("task idempotency lock")
                .reply_idempotency
                .insert(
                    idempotency_key.clone(),
                    (existing_task_id.clone(), existing_reply_id.clone()),
                );
            let reply = self
                .reply_by_id(&existing_task_id, &existing_reply_id)
                .await?;
            return Ok(AddTaskReplyOutcome {
                task_id: existing_task_id,
                reply,
                created: false,
            });
        }
        let existing_reply = {
            self.idempotency
                .lock()
                .expect("task idempotency lock")
                .reply_idempotency
                .get(&idempotency_key)
                .cloned()
        };
        if let Some((existing_task_id, existing_reply_id)) = existing_reply {
            let reply = self
                .repos
                .task_replies(&existing_task_id)
                .await
                .map_err(storage_error)?
                .into_iter()
                .map(task_reply_from_row)
                .find(|reply| reply.id == existing_reply_id)
                .ok_or(TaskError::TaskNotFound)?;
            return Ok(AddTaskReplyOutcome {
                task_id: existing_task_id,
                reply,
                created: false,
            });
        }
        self.task(task_id).await?;

        let now = now_string();
        let reply = TaskReply {
            id: format!("reply_{}", Uuid::new_v4().simple()),
            sender_id: sender_id.to_string(),
            role: role
                .map(str::trim)
                .filter(|role| !role.is_empty())
                .map(ToString::to_string)
                .or_else(|| role_for_sender(sender_id)),
            body: body.to_string(),
            status: Some("done".to_string()),
            created_at: now.clone(),
        };
        self.repos
            .insert_task_reply_idempotent(
                task_reply_to_row(task_id, &reply),
                &idempotency_key,
                &json!({ "taskId": task_id, "replyId": reply.id }).to_string(),
            )
            .await
            .map_err(storage_error)?;
        self.idempotency
            .lock()
            .expect("task idempotency lock")
            .reply_idempotency
            .insert(idempotency_key, (task_id.to_string(), reply.id.clone()));
        Ok(AddTaskReplyOutcome {
            task_id: task_id.to_string(),
            reply,
            created: true,
        })
    }

    pub async fn thread_context(&self, task_id: &str) -> Result<TaskThreadView, TaskError> {
        self.thread_view(task_id).await
    }

    pub async fn thread_view(&self, task_id: &str) -> Result<TaskThreadView, TaskError> {
        let task = self.task(task_id).await?;
        let replies = self
            .repos
            .task_replies(task_id)
            .await
            .map_err(storage_error)?
            .into_iter()
            .map(task_reply_from_row)
            .collect::<Vec<_>>();
        let reply_count = replies.len();
        Ok(TaskThreadView {
            task: summary_for(&task, reply_count),
            root: TaskThreadMessage {
                id: format!("root_{}", task.id),
                task_id: task.id.clone(),
                sender_id: task.creator_id.clone(),
                role: role_for_sender(&task.creator_id).unwrap_or_else(|| "human".to_string()),
                body: task.root_body.clone(),
                status: Some("done".to_string()),
                created_at: task.created_at.clone(),
            },
            replies: replies
                .into_iter()
                .map(|reply| thread_message_for_reply(task_id, reply))
                .collect(),
        })
    }

    pub async fn task_summary(&self, task_id: &str) -> Result<TaskSummaryView, TaskError> {
        let task = self.task(task_id).await?;
        let reply_count = self
            .repos
            .task_replies(task_id)
            .await
            .map_err(storage_error)?
            .len();
        Ok(summary_for(&task, reply_count))
    }

    pub async fn task_summary_for_source_message(
        &self,
        source_message_id: &str,
    ) -> Option<TaskSummaryView> {
        let task = self.task_for_source_message(source_message_id).await?;
        let reply_count = self.repos.task_replies(&task.id).await.ok()?.len();
        Some(summary_for(&task, reply_count))
    }

    pub async fn update_status(&self, task_id: &str, status: TaskStatus) -> Result<(), TaskError> {
        self.task(task_id).await?;
        self.repos
            .update_task_status(task_id, status_to_storage(status))
            .await
            .map_err(storage_error)?;
        Ok(())
    }

    pub async fn update_status_idempotent(
        &self,
        task_id: &str,
        status: TaskStatus,
        idempotency_key: &str,
    ) -> Result<TaskSummaryView, TaskError> {
        let task_id = task_id.trim();
        if task_id.is_empty() {
            return Err(TaskError::InvalidTaskInput);
        }
        let idempotency_key = namespaced_key("task:update_status", idempotency_key)
            .ok_or(TaskError::MissingIdempotencyKey)?;
        let _idempotency_guard = self.idempotency_gate.lock().await;
        if let Some(task) = self
            .status_summary_for_idempotency(&idempotency_key)
            .await?
        {
            self.idempotency
                .lock()
                .expect("task idempotency lock")
                .status_idempotency
                .insert(idempotency_key.clone(), task.clone());
            return Ok(task);
        }
        let existing_task = {
            self.idempotency
                .lock()
                .expect("task idempotency lock")
                .status_idempotency
                .get(&idempotency_key)
                .cloned()
        };
        if let Some(task) = existing_task {
            return Ok(task);
        }

        self.update_status(task_id, status).await?;
        let task = self.task_summary(task_id).await?;
        self.repos
            .record_idempotent_response(
                &idempotency_key,
                task_id,
                &serde_json::to_string(&task)
                    .map_err(|error| TaskError::Storage(error.to_string()))?,
            )
            .await
            .map_err(storage_error)?;
        self.idempotency
            .lock()
            .expect("task idempotency lock")
            .status_idempotency
            .insert(idempotency_key, task.clone());
        Ok(task)
    }

    pub async fn assign(
        &self,
        task_id: &str,
        assignee_id: Option<String>,
    ) -> Result<(), TaskError> {
        let task = self.task(task_id).await?;
        let (needs_assignment, attention_required, status) = match task.status {
            TaskStatus::PendingAssignment | TaskStatus::InProgress => (
                assignee_id.is_none(),
                assignee_id.is_none(),
                if assignee_id.is_some() {
                    TaskStatus::InProgress
                } else {
                    TaskStatus::PendingAssignment
                },
            ),
            TaskStatus::InReview | TaskStatus::Done => {
                (false, task.attention_required, task.status)
            }
        };
        self.repos
            .update_task_assignment(
                task_id,
                assignee_id.as_deref(),
                needs_assignment,
                attention_required,
                status_to_storage(status),
            )
            .await
            .map_err(storage_error)?;
        Ok(())
    }

    pub async fn set_attention_required(
        &self,
        task_id: &str,
        required: bool,
    ) -> Result<(), TaskError> {
        self.task(task_id).await?;
        self.repos
            .update_task_attention(task_id, required)
            .await
            .map_err(storage_error)?;
        Ok(())
    }

    pub async fn list_tasks(&self, query: TaskQuery) -> Vec<TaskRecord> {
        let mut tasks = self
            .repos
            .list_tasks(task_query_to_row(query))
            .await
            .expect("load tasks")
            .into_iter()
            .map(task_record_from_row)
            .collect::<Vec<_>>();
        tasks.sort_by(|left, right| left.title.cmp(&right.title).then(left.id.cmp(&right.id)));
        tasks
    }

    pub async fn list_task_summaries(&self, query: TaskQuery) -> Vec<TaskSummaryView> {
        let tasks = self
            .repos
            .list_tasks(task_query_to_row(query))
            .await
            .expect("load task summaries")
            .into_iter()
            .map(task_record_from_row)
            .collect::<Vec<_>>();
        let mut summaries = Vec::with_capacity(tasks.len());
        for task in tasks {
            let reply_count = self
                .repos
                .task_replies(&task.id)
                .await
                .expect("load task replies")
                .len();
            summaries.push(summary_for(&task, reply_count));
        }
        summaries.sort_by(|left, right| {
            right
                .updated_at
                .cmp(&left.updated_at)
                .then(left.id.cmp(&right.id))
        });
        summaries
    }

    pub async fn board(&self, query: TaskQuery) -> TaskBoard {
        let tasks = self.list_tasks(query).await;
        let columns = TaskStatus::columns()
            .into_iter()
            .map(|status| TaskColumn {
                status,
                tasks: tasks
                    .iter()
                    .filter(|task| task.status == status)
                    .cloned()
                    .collect(),
            })
            .collect();

        TaskBoard { columns }
    }

    pub async fn delete_task_root(&self, task_id: &str) -> Result<(), TaskError> {
        let task = self.task(task_id).await?;
        if task.status != TaskStatus::Done {
            return Err(TaskError::ActiveTaskRootDeletionBlocked);
        }
        self.repos
            .mark_task_root_deleted(task_id)
            .await
            .map_err(storage_error)?;
        Ok(())
    }

    pub async fn task(&self, task_id: &str) -> Result<TaskRecord, TaskError> {
        self.repos
            .task_by_id(task_id)
            .await
            .map_err(storage_error)?
            .map(task_record_from_row)
            .ok_or(TaskError::TaskNotFound)
    }

    pub async fn task_for_source_message(&self, source_message_id: &str) -> Option<TaskRecord> {
        self.repos
            .task_by_source_message(source_message_id)
            .await
            .ok()
            .flatten()
            .map(task_record_from_row)
    }

    async fn task_id_for_idempotency(
        &self,
        idempotency_key: &str,
    ) -> Result<Option<String>, TaskError> {
        let Some(payload) = self
            .repos
            .idempotent_response(idempotency_key)
            .await
            .map_err(storage_error)?
        else {
            return Ok(None);
        };
        Ok(Some(idempotent_task_id(&payload)))
    }

    async fn reply_id_for_idempotency(
        &self,
        idempotency_key: &str,
    ) -> Result<Option<(String, String)>, TaskError> {
        let Some(payload) = self
            .repos
            .idempotent_response(idempotency_key)
            .await
            .map_err(storage_error)?
        else {
            return Ok(None);
        };
        Ok(Some(idempotent_reply_ids(&payload)?))
    }

    async fn status_summary_for_idempotency(
        &self,
        idempotency_key: &str,
    ) -> Result<Option<TaskSummaryView>, TaskError> {
        let Some(payload) = self
            .repos
            .idempotent_response(idempotency_key)
            .await
            .map_err(storage_error)?
        else {
            return Ok(None);
        };
        serde_json::from_str(&payload)
            .map(Some)
            .map_err(|error| TaskError::Storage(error.to_string()))
    }

    async fn reply_by_id(&self, task_id: &str, reply_id: &str) -> Result<TaskReply, TaskError> {
        self.repos
            .task_replies(task_id)
            .await
            .map_err(storage_error)?
            .into_iter()
            .map(task_reply_from_row)
            .find(|reply| reply.id == reply_id)
            .ok_or(TaskError::TaskNotFound)
    }
}

fn summary_for(task: &TaskRecord, reply_count: usize) -> TaskSummaryView {
    TaskSummaryView {
        id: task.id.clone(),
        channel_id: task.channel_id.clone(),
        creator_id: task.creator_id.clone(),
        assignee_id: task.assignee_id.clone(),
        source_message_id: task.source_message_id.clone(),
        title: task.title.clone(),
        status: task.status,
        attention_required: task.attention_required,
        reply_count,
        updated_at: task.updated_at.clone(),
    }
}

pub(crate) fn thread_message_for_reply(task_id: &str, reply: TaskReply) -> TaskThreadMessage {
    TaskThreadMessage {
        id: reply.id,
        task_id: task_id.to_string(),
        sender_id: reply.sender_id,
        role: reply.role.unwrap_or_else(|| "human".to_string()),
        body: reply.body,
        status: reply.status,
        created_at: reply.created_at,
    }
}

fn task_record_to_row(task: &TaskRecord) -> TaskRootRow {
    TaskRootRow {
        id: task.id.clone(),
        channel_id: task.channel_id.clone(),
        creator_id: task.creator_id.clone(),
        assignee_id: task.assignee_id.clone(),
        source_message_id: task.source_message_id.clone(),
        assignment_reason: task.assignment_reason.clone(),
        needs_assignment: task.needs_assignment,
        title: task.title.clone(),
        status: status_to_storage(task.status).to_string(),
        attention_required: task.attention_required,
        root_deleted: task.root_deleted,
        root_body: task.root_body.clone(),
        created_at: task.created_at.clone(),
        updated_at: task.updated_at.clone(),
    }
}

fn task_record_from_row(row: TaskRootRow) -> TaskRecord {
    TaskRecord {
        id: row.id,
        channel_id: row.channel_id,
        creator_id: row.creator_id,
        assignee_id: row.assignee_id,
        source_message_id: row.source_message_id,
        assignment_reason: row.assignment_reason,
        needs_assignment: row.needs_assignment,
        title: row.title,
        status: status_from_storage(&row.status),
        attention_required: row.attention_required,
        root_deleted: row.root_deleted,
        root_body: row.root_body,
        created_at: row.created_at,
        updated_at: row.updated_at,
    }
}

fn task_reply_to_row(task_id: &str, reply: &TaskReply) -> TaskReplyRow {
    TaskReplyRow {
        id: reply.id.clone(),
        task_id: task_id.to_string(),
        sender_id: reply.sender_id.clone(),
        role: reply.role.clone(),
        body: reply.body.clone(),
        status: reply.status.clone(),
        created_at: reply.created_at.clone(),
    }
}

fn task_reply_from_row(row: TaskReplyRow) -> TaskReply {
    TaskReply {
        id: row.id,
        sender_id: row.sender_id,
        role: row.role,
        body: row.body,
        status: row.status,
        created_at: row.created_at,
    }
}

fn task_query_to_row(query: TaskQuery) -> TaskQueryRow {
    TaskQueryRow {
        channel_id: query.channel_id,
        creator_id: query.creator_id,
        assignee_id: query.assignee_id,
    }
}

fn idempotent_task_id(payload: &str) -> String {
    serde_json::from_str::<serde_json::Value>(payload)
        .ok()
        .and_then(|value| {
            value
                .get("taskId")
                .and_then(|id| id.as_str())
                .map(ToString::to_string)
                .or_else(|| {
                    value
                        .get("task_id")
                        .and_then(|id| id.as_str())
                        .map(ToString::to_string)
                })
        })
        .unwrap_or_else(|| payload.to_string())
}

fn idempotent_reply_ids(payload: &str) -> Result<(String, String), TaskError> {
    let value = serde_json::from_str::<serde_json::Value>(payload)
        .map_err(|error| TaskError::Storage(error.to_string()))?;
    let task_id = value
        .get("taskId")
        .and_then(|id| id.as_str())
        .ok_or_else(|| TaskError::Storage("missing idempotent task id".to_string()))?
        .to_string();
    let reply_id = value
        .get("replyId")
        .and_then(|id| id.as_str())
        .ok_or_else(|| TaskError::Storage("missing idempotent reply id".to_string()))?
        .to_string();
    Ok((task_id, reply_id))
}

fn status_to_storage(status: TaskStatus) -> &'static str {
    match status {
        TaskStatus::PendingAssignment => "pending_assignment",
        TaskStatus::InProgress => "in_progress",
        TaskStatus::InReview => "in_review",
        TaskStatus::Done => "done",
    }
}

fn status_from_storage(status: &str) -> TaskStatus {
    match status {
        "in_progress" => TaskStatus::InProgress,
        "in_review" => TaskStatus::InReview,
        "done" => TaskStatus::Done,
        _ => TaskStatus::PendingAssignment,
    }
}

fn now_string() -> String {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .to_string()
}

fn title_from_body(body: &str, source_message_id: &str) -> String {
    let body = body.trim();
    if body.is_empty() {
        return format!("Task from {source_message_id}");
    }
    let mut title = body.chars().take(80).collect::<String>();
    if body.chars().count() > 80 {
        title.push_str("...");
    }
    title
}

fn role_for_sender(sender_id: &str) -> Option<String> {
    if sender_id.starts_with("agent") {
        Some("agent".to_string())
    } else if sender_id.starts_with("human") {
        Some("human".to_string())
    } else if sender_id.starts_with("system") {
        Some("system".to_string())
    } else {
        None
    }
}

fn repositories_blocking(data_root: PathBuf) -> Repositories {
    std::thread::spawn(move || {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("create task repository runtime");
        runtime.block_on(async move {
            std::fs::create_dir_all(&data_root).expect("create task data root");
            let database_url = format!("sqlite://{}", data_root.join("slei.sqlite").display());
            let db = SleiDb::connect(&database_url)
                .await
                .expect("connect task db");
            db.migrate().await.expect("migrate task db");
            Repositories::new(db.pool().clone())
        })
    })
    .join()
    .expect("initialize task repositories")
}

#[derive(Debug, thiserror::Error)]
pub enum TaskError {
    #[error("task not found")]
    TaskNotFound,
    #[error("idempotency-key is required")]
    MissingIdempotencyKey,
    #[error("task input is invalid")]
    InvalidTaskInput,
    #[error("active task root cannot be deleted")]
    ActiveTaskRootDeletionBlocked,
    #[error("task storage error: {0}")]
    Storage(String),
}

fn storage_error(error: sqlx::Error) -> TaskError {
    match error {
        sqlx::Error::RowNotFound => TaskError::TaskNotFound,
        other => TaskError::Storage(other.to_string()),
    }
}
