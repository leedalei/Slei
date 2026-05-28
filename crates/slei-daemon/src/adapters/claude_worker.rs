use serde_json::{json, Value};
use uuid::Uuid;

use crate::adapters::worker_rpc::{WorkerRpcError, WorkerTransport};

#[derive(Clone, Debug)]
pub struct ClaudeWorkerAdapter {
    transport: WorkerTransport,
}

#[derive(Clone, Debug)]
pub struct CreateSessionRequest {
    pub agent_id: String,
    pub cwd: String,
}

#[derive(Clone, Debug)]
pub struct RuntimeSession {
    pub session_id: String,
    pub agent_id: String,
    pub runtime: String,
    pub cwd: String,
    pub persist_session: bool,
    pub capabilities: RuntimeCapabilities,
}

#[derive(Clone, Debug)]
pub struct RuntimeCapabilities {
    pub resume_session: bool,
}

impl ClaudeWorkerAdapter {
    pub fn new(transport: WorkerTransport) -> Self {
        Self { transport }
    }

    pub fn create_session(
        &self,
        request: CreateSessionRequest,
    ) -> Result<RuntimeSession, ClaudeWorkerError> {
        Ok(RuntimeSession {
            session_id: format!("session_{}", Uuid::new_v4().simple()),
            agent_id: request.agent_id,
            runtime: "ClaudeCode".to_string(),
            cwd: request.cwd,
            persist_session: false,
            capabilities: RuntimeCapabilities {
                resume_session: false,
            },
        })
    }

    pub fn start_run(
        &self,
        run_id: &str,
        session: &RuntimeSession,
        prompt: &str,
        context: Vec<Value>,
    ) -> Result<(), ClaudeWorkerError> {
        self.transport.send(json!({
            "type": "start_run",
            "run_id": run_id,
            "session": {
                "session_id": session.session_id,
                "agent_id": session.agent_id,
                "runtime": session.runtime,
                "cwd": session.cwd,
                "persist_session": false,
            },
            "input": {
                "prompt": prompt,
                "context": context,
            }
        }))?;
        Ok(())
    }

    pub fn cancel_run(&self, run_id: &str) -> Result<(), ClaudeWorkerError> {
        self.transport
            .send(json!({ "type": "cancel", "run_id": run_id }))?;
        Ok(())
    }

    pub fn resume_session(&self, _opaque_token: &str) -> Result<RuntimeSession, ClaudeWorkerError> {
        Err(ClaudeWorkerError::ResumeUnsupported)
    }
}

#[derive(Debug, thiserror::Error)]
pub enum ClaudeWorkerError {
    #[error("Claude MVP resume is not supported")]
    ResumeUnsupported,
    #[error(transparent)]
    WorkerRpc(#[from] WorkerRpcError),
}
