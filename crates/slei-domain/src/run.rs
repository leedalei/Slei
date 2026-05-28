use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum RunStatus {
    Queued,
    Running,
    WaitingApproval,
    Completed,
    Failed,
    Cancelled,
    Rejected,
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum RunError {
    #[error("invalid run transition from {from:?} to {to:?}")]
    InvalidTransition { from: RunStatus, to: RunStatus },
}

pub fn transition_run(from: RunStatus, to: RunStatus) -> Result<RunStatus, RunError> {
    let allowed = matches!(
        (from, to),
        (RunStatus::Queued, RunStatus::Running)
            | (RunStatus::Queued, RunStatus::Cancelled)
            | (RunStatus::Running, RunStatus::WaitingApproval)
            | (RunStatus::WaitingApproval, RunStatus::Running)
            | (RunStatus::WaitingApproval, RunStatus::Rejected)
            | (RunStatus::WaitingApproval, RunStatus::Cancelled)
            | (RunStatus::Running, RunStatus::Completed)
            | (RunStatus::Running, RunStatus::Failed)
            | (RunStatus::Running, RunStatus::Cancelled)
    );

    if allowed {
        Ok(to)
    } else {
        Err(RunError::InvalidTransition { from, to })
    }
}
