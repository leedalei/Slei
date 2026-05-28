use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use uuid::Uuid;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TaskStatus {
    Todo,
    InProgress,
    InReview,
    Done,
    Closed,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TaskRecord {
    pub id: String,
    pub channel_id: String,
    pub creator_id: String,
    pub title: String,
    pub status: TaskStatus,
    pub root_deleted: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TaskReply {
    pub id: String,
    pub sender_id: String,
    pub body: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TaskThreadContext {
    pub task_id: String,
    pub reply_count: usize,
    pub context: String,
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
            title: title.to_string(),
            status: TaskStatus::InProgress,
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
        if !state.tasks.contains_key(task_id) {
            return Err(TaskError::TaskNotFound);
        }
        let replies = state.replies.get(task_id).cloned().unwrap_or_default();
        Ok(TaskThreadContext {
            task_id: task_id.to_string(),
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
