use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use serde::Serialize;
use uuid::Uuid;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TaskStatus {
    Todo,
    InProgress,
    InReview,
    Done,
    Closed,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskRecord {
    pub id: String,
    pub channel_id: String,
    pub creator_id: String,
    pub assignee_id: Option<String>,
    pub title: String,
    pub status: TaskStatus,
    pub attention_required: bool,
    pub root_deleted: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskReply {
    pub id: String,
    pub sender_id: String,
    pub body: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskThreadContext {
    pub task_id: String,
    pub status: TaskStatus,
    pub reply_count: usize,
    pub context: String,
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

        let task = TaskRecord {
            id: format!("task_{}", Uuid::new_v4().simple()),
            channel_id: channel_id.to_string(),
            creator_id: creator_id.to_string(),
            assignee_id: None,
            title: title.to_string(),
            status: TaskStatus::InProgress,
            attention_required: false,
            root_deleted: false,
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
        let mut state = self.inner.lock().expect("task state lock");
        if let Some((existing_task_id, existing_reply_id)) =
            state.reply_idempotency.get(idempotency_key)
        {
            return state
                .replies
                .get(existing_task_id)
                .and_then(|replies| replies.iter().find(|reply| reply.id == *existing_reply_id))
                .cloned()
                .ok_or(TaskError::TaskNotFound);
        }
        if !state.tasks.contains_key(task_id) {
            return Err(TaskError::TaskNotFound);
        }

        let reply = TaskReply {
            id: format!("reply_{}", Uuid::new_v4().simple()),
            sender_id: sender_id.to_string(),
            body: body.to_string(),
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
        Ok(reply)
    }

    pub async fn thread_context(&self, task_id: &str) -> Result<TaskThreadContext, TaskError> {
        let state = self.inner.lock().expect("task state lock");
        let task = state.tasks.get(task_id).ok_or(TaskError::TaskNotFound)?;
        let replies = state.replies.get(task_id).cloned().unwrap_or_default();
        Ok(TaskThreadContext {
            task_id: task_id.to_string(),
            status: task.status,
            reply_count: replies.len(),
            context: replies
                .iter()
                .map(|reply| reply.body.clone())
                .collect::<Vec<_>>()
                .join("\n"),
        })
    }

    pub async fn update_status(&self, task_id: &str, status: TaskStatus) -> Result<(), TaskError> {
        let mut state = self.inner.lock().expect("task state lock");
        let task = state
            .tasks
            .get_mut(task_id)
            .ok_or(TaskError::TaskNotFound)?;
        task.status = status;
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
        task.assignee_id = assignee_id;
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

    pub async fn board(&self, query: TaskQuery) -> TaskBoard {
        let tasks = self.list_tasks(query).await;
        let columns = [
            TaskStatus::Todo,
            TaskStatus::InProgress,
            TaskStatus::InReview,
            TaskStatus::Done,
            TaskStatus::Closed,
        ]
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
        if task.status != TaskStatus::Closed {
            return Err(TaskError::ActiveTaskRootDeletionBlocked);
        }
        task.root_deleted = true;
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
}

#[derive(Debug, thiserror::Error)]
pub enum TaskError {
    #[error("task not found")]
    TaskNotFound,
    #[error("active task root cannot be deleted")]
    ActiveTaskRootDeletionBlocked,
}
