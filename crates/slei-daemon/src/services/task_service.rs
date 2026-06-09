use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
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

#[derive(Clone, Debug, Default)]
pub struct TaskService {
    inner: Arc<Mutex<TaskState>>,
}

#[derive(Debug, Default)]
struct TaskState {
    tasks: HashMap<String, TaskRecord>,
    task_idempotency: HashMap<String, String>,
    replies: HashMap<String, Vec<TaskReply>>,
    reply_idempotency: HashMap<String, (String, String)>,
}

impl TaskService {
    pub fn for_tests() -> Self {
        Self::default()
    }

    pub async fn create_task_root(
        &self,
        channel_id: &str,
        creator_id: &str,
        title: &str,
        idempotency_key: &str,
    ) -> Result<TaskRecord, TaskError> {
        let mut state = self.inner.lock().expect("task state lock");
        if let Some(task_id) = state.task_idempotency.get(idempotency_key) {
            return state
                .tasks
                .get(task_id)
                .cloned()
                .ok_or(TaskError::TaskNotFound);
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
        state
            .task_idempotency
            .insert(idempotency_key.to_string(), task.id.clone());
        state.tasks.insert(task.id.clone(), task.clone());
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
        let mut state = self.inner.lock().expect("task state lock");
        if let Some(task_id) = state.task_idempotency.get(idempotency_key) {
            return state
                .tasks
                .get(task_id)
                .cloned()
                .ok_or(TaskError::TaskNotFound);
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
        state
            .task_idempotency
            .insert(idempotency_key.to_string(), task.id.clone());
        state.tasks.insert(task.id.clone(), task.clone());
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
        let mut state = self.inner.lock().expect("task state lock");
        if let Some((existing_task_id, existing_reply_id)) =
            state.reply_idempotency.get(idempotency_key)
        {
            let reply = state
                .replies
                .get(existing_task_id)
                .and_then(|replies| replies.iter().find(|reply| reply.id == *existing_reply_id))
                .cloned()
                .ok_or(TaskError::TaskNotFound)?;
            return Ok(AddTaskReplyOutcome {
                task_id: existing_task_id.clone(),
                reply,
                created: false,
            });
        }
        if !state.tasks.contains_key(task_id) {
            return Err(TaskError::TaskNotFound);
        }

        let now = now_string();
        let reply = TaskReply {
            id: format!("reply_{}", Uuid::new_v4().simple()),
            sender_id: sender_id.to_string(),
            role: role_for_sender(sender_id),
            body: body.to_string(),
            status: Some("done".to_string()),
            created_at: now.clone(),
        };
        state.reply_idempotency.insert(
            idempotency_key.to_string(),
            (task_id.to_string(), reply.id.clone()),
        );
        state
            .replies
            .entry(task_id.to_string())
            .or_default()
            .push(reply.clone());
        if let Some(task) = state.tasks.get_mut(task_id) {
            task.updated_at = now;
        }
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
        let state = self.inner.lock().expect("task state lock");
        let task = state.tasks.get(task_id).ok_or(TaskError::TaskNotFound)?;
        let replies = state.replies.get(task_id).cloned().unwrap_or_default();
        Ok(TaskThreadView {
            task: summary_for(&state, task),
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
                .map(|reply| thread_message_for_reply(&task.id, reply))
                .collect(),
        })
    }

    pub async fn task_summary(&self, task_id: &str) -> Result<TaskSummaryView, TaskError> {
        let state = self.inner.lock().expect("task state lock");
        let task = state.tasks.get(task_id).ok_or(TaskError::TaskNotFound)?;
        Ok(summary_for(&state, task))
    }

    pub async fn update_status(&self, task_id: &str, status: TaskStatus) -> Result<(), TaskError> {
        let mut state = self.inner.lock().expect("task state lock");
        let task = state
            .tasks
            .get_mut(task_id)
            .ok_or(TaskError::TaskNotFound)?;
        task.status = status;
        task.updated_at = now_string();
        Ok(())
    }

    pub async fn assign(
        &self,
        task_id: &str,
        assignee_id: Option<String>,
    ) -> Result<(), TaskError> {
        let mut state = self.inner.lock().expect("task state lock");
        let task = state
            .tasks
            .get_mut(task_id)
            .ok_or(TaskError::TaskNotFound)?;
        match task.status {
            TaskStatus::PendingAssignment | TaskStatus::InProgress => {
                task.needs_assignment = assignee_id.is_none();
                task.attention_required = assignee_id.is_none();
                task.status = if assignee_id.is_some() {
                    TaskStatus::InProgress
                } else {
                    TaskStatus::PendingAssignment
                };
            }
            TaskStatus::InReview | TaskStatus::Done => {
                task.needs_assignment = false;
            }
        }
        task.assignee_id = assignee_id;
        task.updated_at = now_string();
        Ok(())
    }

    pub async fn set_attention_required(
        &self,
        task_id: &str,
        required: bool,
    ) -> Result<(), TaskError> {
        let mut state = self.inner.lock().expect("task state lock");
        let task = state
            .tasks
            .get_mut(task_id)
            .ok_or(TaskError::TaskNotFound)?;
        task.attention_required = required;
        task.updated_at = now_string();
        Ok(())
    }

    pub async fn list_tasks(&self, query: TaskQuery) -> Vec<TaskRecord> {
        let mut tasks = self
            .inner
            .lock()
            .expect("task state lock")
            .tasks
            .values()
            .filter(|task| !task.root_deleted)
            .filter(|task| {
                query
                    .channel_id
                    .as_ref()
                    .is_none_or(|channel_id| task.channel_id == *channel_id)
            })
            .filter(|task| {
                query
                    .creator_id
                    .as_ref()
                    .is_none_or(|creator_id| task.creator_id == *creator_id)
            })
            .filter(|task| {
                query
                    .assignee_id
                    .as_ref()
                    .is_none_or(|assignee_id| task.assignee_id.as_ref() == Some(assignee_id))
            })
            .cloned()
            .collect::<Vec<_>>();
        tasks.sort_by(|left, right| left.title.cmp(&right.title).then(left.id.cmp(&right.id)));
        tasks
    }

    pub async fn list_task_summaries(&self, query: TaskQuery) -> Vec<TaskSummaryView> {
        let state = self.inner.lock().expect("task state lock");
        let mut summaries = state
            .tasks
            .values()
            .filter(|task| !task.root_deleted)
            .filter(|task| {
                query
                    .channel_id
                    .as_ref()
                    .is_none_or(|id| task.channel_id == *id)
            })
            .filter(|task| {
                query
                    .creator_id
                    .as_ref()
                    .is_none_or(|id| task.creator_id == *id)
            })
            .filter(|task| {
                query
                    .assignee_id
                    .as_ref()
                    .is_none_or(|id| task.assignee_id.as_ref() == Some(id))
            })
            .map(|task| summary_for(&state, task))
            .collect::<Vec<_>>();
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
        let mut state = self.inner.lock().expect("task state lock");
        let task = state
            .tasks
            .get_mut(task_id)
            .ok_or(TaskError::TaskNotFound)?;
        if task.status != TaskStatus::Done {
            return Err(TaskError::ActiveTaskRootDeletionBlocked);
        }
        task.root_deleted = true;
        task.updated_at = now_string();
        Ok(())
    }

    pub async fn task(&self, task_id: &str) -> Result<TaskRecord, TaskError> {
        self.inner
            .lock()
            .expect("task state lock")
            .tasks
            .get(task_id)
            .cloned()
            .ok_or(TaskError::TaskNotFound)
    }

    pub async fn task_for_source_message(&self, source_message_id: &str) -> Option<TaskRecord> {
        self.inner
            .lock()
            .expect("task state lock")
            .tasks
            .values()
            .find(|task| task.source_message_id.as_deref() == Some(source_message_id))
            .cloned()
    }
}

fn summary_for(state: &TaskState, task: &TaskRecord) -> TaskSummaryView {
    TaskSummaryView {
        id: task.id.clone(),
        channel_id: task.channel_id.clone(),
        creator_id: task.creator_id.clone(),
        assignee_id: task.assignee_id.clone(),
        source_message_id: task.source_message_id.clone(),
        title: task.title.clone(),
        status: task.status,
        attention_required: task.attention_required,
        reply_count: state
            .replies
            .get(&task.id)
            .map(|replies| replies.len())
            .unwrap_or_default(),
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
    } else {
        None
    }
}

#[derive(Debug, thiserror::Error)]
pub enum TaskError {
    #[error("task not found")]
    TaskNotFound,
    #[error("active task root cannot be deleted")]
    ActiveTaskRootDeletionBlocked,
}
