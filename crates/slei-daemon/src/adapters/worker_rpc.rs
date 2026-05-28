use std::sync::{Arc, Mutex};

use serde_json::Value;

#[derive(Clone, Debug, Default)]
pub struct WorkerTransport {
    commands: Arc<Mutex<Vec<Value>>>,
}

impl WorkerTransport {
    pub fn fake() -> Self {
        Self::default()
    }

    pub fn send(&self, command: Value) -> Result<(), WorkerRpcError> {
        self.commands
            .lock()
            .map_err(|_| WorkerRpcError::PoisonedTransport)?
            .push(command);
        Ok(())
    }

    pub fn commands(&self) -> Vec<Value> {
        self.commands
            .lock()
            .expect("fake worker transport lock")
            .clone()
    }
}

#[derive(Clone, Debug)]
pub struct WorkerEvent {
    value: Value,
}

impl WorkerEvent {
    pub fn from_json(value: Value) -> Result<Self, WorkerRpcError> {
        let event_type = value
            .get("type")
            .and_then(Value::as_str)
            .ok_or(WorkerRpcError::MissingEventType)?;

        match event_type {
            "output_delta"
            | "tool_started"
            | "permission_requested"
            | "human_question_requested"
            | "product_tool_requested"
            | "tool_completed"
            | "completed"
            | "failed" => Ok(Self { value }),
            other => Err(WorkerRpcError::UnknownEventType(other.to_string())),
        }
    }

    pub fn to_run_event(&self) -> Result<Value, WorkerRpcError> {
        if self.value["type"] == "permission_requested" {
            require_string(&self.value, "request_id")?;
            require_string(&self.value, "run_id")?;
            require_string(&self.value, "tool_use_id")?;
            require_string(&self.value, "agent_id")?;
        }

        Ok(self.value.clone())
    }
}

#[derive(Debug, thiserror::Error)]
pub enum WorkerRpcError {
    #[error("worker transport lock poisoned")]
    PoisonedTransport,
    #[error("worker event missing type")]
    MissingEventType,
    #[error("unknown worker event type: {0}")]
    UnknownEventType(String),
    #[error("worker event missing required field: {0}")]
    MissingField(&'static str),
}

fn require_string(value: &Value, key: &'static str) -> Result<(), WorkerRpcError> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(|_| ())
        .ok_or(WorkerRpcError::MissingField(key))
}
