use std::collections::HashMap;
use std::sync::{Arc, Mutex};

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum DelegationSource {
    UserMention,
    TypedVisibleRequest,
    FreeformText,
}

#[derive(Clone, Debug)]
pub struct DelegationRequest {
    pub source: DelegationSource,
    pub parent_run_id: String,
    pub from_agent_id: String,
    pub to_agent_id: String,
    pub task_id: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DelegationRecord {
    pub parent_run_id: String,
    pub child_run_id: String,
    pub from_agent_id: String,
    pub to_agent_id: String,
    pub task_id: String,
}

#[derive(Clone, Debug, Default)]
pub struct DelegationService {
    inner: Arc<Mutex<DelegationState>>,
}

#[derive(Debug, Default)]
struct DelegationState {
    records: Vec<DelegationRecord>,
    timeline: HashMap<String, Vec<String>>,
}

impl DelegationService {
    pub fn for_tests() -> Self {
        Self::default()
    }

    pub async fn create_delegation(
        &self,
        request: DelegationRequest,
    ) -> Result<DelegationRecord, DelegationError> {
        if request.source == DelegationSource::FreeformText {
            return Err(DelegationError::VisibleRecordRequired);
        }

        let mut state = self.inner.lock().expect("delegation state lock");
        let ancestors = ancestors_for(&state.records, &request.parent_run_id);
        if ancestors.iter().any(|record| {
            record.from_agent_id == request.to_agent_id || record.to_agent_id == request.to_agent_id
        }) {
            return Err(DelegationError::CycleRejected);
        }
        if ancestors.len() >= 5 {
            return Err(DelegationError::DepthExceeded);
        }

        let child_run_id = format!("{}/{}", request.parent_run_id, request.to_agent_id);
        let visible = format!(
            "@{} delegated from @{}",
            request.to_agent_id, request.from_agent_id
        );
        state
            .timeline
            .entry(request.task_id.clone())
            .or_default()
            .push(visible);
        let record = DelegationRecord {
            parent_run_id: request.parent_run_id,
            child_run_id,
            from_agent_id: request.from_agent_id,
            to_agent_id: request.to_agent_id,
            task_id: request.task_id,
        };
        state.records.push(record.clone());
        Ok(record)
    }

    pub async fn timeline_for_task(&self, task_id: &str) -> Vec<String> {
        self.inner
            .lock()
            .expect("delegation state lock")
            .timeline
            .get(task_id)
            .cloned()
            .unwrap_or_default()
    }
}

fn ancestors_for(records: &[DelegationRecord], parent_run_id: &str) -> Vec<DelegationRecord> {
    let mut ancestors = Vec::new();
    let mut current = parent_run_id.to_string();
    while let Some(record) = records.iter().find(|record| record.child_run_id == current) {
        ancestors.push(record.clone());
        current = record.parent_run_id.clone();
    }
    ancestors
}

#[derive(Debug, thiserror::Error)]
pub enum DelegationError {
    #[error("visible delegation record is required before child run")]
    VisibleRecordRequired,
    #[error("delegation depth exceeded")]
    DepthExceeded,
    #[error("delegation cycle rejected")]
    CycleRejected,
}
