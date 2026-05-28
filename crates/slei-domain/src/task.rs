use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub enum TaskStatus {
    Todo,
    InProgress,
    InReview,
    Done,
    Closed,
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum TaskError {
    #[error("invalid task transition from {from:?} to {to:?}")]
    InvalidTransition { from: TaskStatus, to: TaskStatus },
}

pub fn transition_task(from: TaskStatus, to: TaskStatus) -> Result<TaskStatus, TaskError> {
    let allowed = matches!(
        (from, to),
        (TaskStatus::Todo, TaskStatus::InProgress)
            | (TaskStatus::InProgress, TaskStatus::InReview)
            | (TaskStatus::InReview, TaskStatus::InProgress)
            | (TaskStatus::InReview, TaskStatus::Done)
            | (TaskStatus::Todo, TaskStatus::Closed)
            | (TaskStatus::InProgress, TaskStatus::Closed)
            | (TaskStatus::InReview, TaskStatus::Closed)
            | (TaskStatus::Done, TaskStatus::Closed)
    );

    if allowed {
        Ok(to)
    } else {
        Err(TaskError::InvalidTransition { from, to })
    }
}
