use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use slei_storage::db::SleiDb;
use slei_storage::repositories::{Repositories, TaskQueryRow, TaskReplyRow, TaskRootRow};
use tokio::sync::Mutex as AsyncMutex;
use uuid::Uuid;

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

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
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

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
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
        let _idempotency_guard = self.idempotency_gate.lock().await;
        let existing_task_id = {
            self.idempotency
                .lock()
                .expect("task idempotency lock")
                .task_idempotency
                .get(idempotency_key)
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
            .upsert_task_root(task_record_to_row(&task))
            .await
            .map_err(storage_error)?;
        self.idempotency
            .lock()
            .expect("task idempotency lock")
            .task_idempotency
            .insert(idempotency_key.to_string(), task.id.clone());
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
        let _idempotency_guard = self.idempotency_gate.lock().await;
        let existing_task_id = {
            self.idempotency
                .lock()
                .expect("task idempotency lock")
                .task_idempotency
                .get(idempotency_key)
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
            .upsert_task_root(task_record_to_row(&task))
            .await
            .map_err(storage_error)?;
        self.idempotency
            .lock()
            .expect("task idempotency lock")
            .task_idempotency
            .insert(idempotency_key.to_string(), task.id.clone());
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
            .add_reply_with_task(task_id, sender_id, body, idempotency_key)
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
        let _idempotency_guard = self.idempotency_gate.lock().await;
        let existing_reply = {
            self.idempotency
                .lock()
                .expect("task idempotency lock")
                .reply_idempotency
                .get(idempotency_key)
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
            role: role_for_sender(sender_id),
            body: body.to_string(),
            status: Some("done".to_string()),
            created_at: now.clone(),
        };
        self.repos
            .insert_task_reply(task_reply_to_row(task_id, &reply))
            .await
            .map_err(storage_error)?;
        self.idempotency
            .lock()
            .expect("task idempotency lock")
            .reply_idempotency
            .insert(
                idempotency_key.to_string(),
                (task_id.to_string(), reply.id.clone()),
            );
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

    pub async fn update_status(&self, task_id: &str, status: TaskStatus) -> Result<(), TaskError> {
        self.task(task_id).await?;
        self.repos
            .update_task_status(task_id, status_to_storage(status))
            .await
            .map_err(storage_error)?;
        Ok(())
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
    #[error("active task root cannot be deleted")]
    ActiveTaskRootDeletionBlocked,
}

fn storage_error(error: sqlx::Error) -> TaskError {
    let _ = error;
    TaskError::TaskNotFound
}
