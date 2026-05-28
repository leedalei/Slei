use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use serde::Serialize;
use serde_json::json;
use tokio::sync::Mutex;

use crate::services::event_service::EventService;

#[derive(Clone, Debug)]
pub struct RunOrchestrator {
    events: EventService,
    redactor: Arc<Mutex<RollingRedactor>>,
    terminal_runs: Arc<Mutex<HashSet<String>>>,
}

impl RunOrchestrator {
    pub fn for_tests(secrets: Vec<String>) -> Self {
        Self {
            events: EventService::new(),
            redactor: Arc::new(Mutex::new(RollingRedactor::new(secrets))),
            terminal_runs: Arc::new(Mutex::new(HashSet::new())),
        }
    }

    pub fn events(&self) -> &EventService {
        &self.events
    }

    pub async fn emit_output_delta(
        &self,
        run_id: &str,
        delta: &str,
    ) -> Result<(), RunOrchestratorError> {
        if self.terminal_runs.lock().await.contains(run_id) {
            return Ok(());
        }

        let redacted = self.redactor.lock().await.redact(run_id, delta);
        self.events
            .append(
                "run.output_delta",
                json!({
                    "run_id": run_id,
                    "delta": redacted,
                }),
            )
            .await;
        Ok(())
    }

    pub async fn cancel_run(&self, run_id: &str) -> Result<(), RunOrchestratorError> {
        let mut terminal_runs = self.terminal_runs.lock().await;
        if !terminal_runs.insert(run_id.to_string()) {
            return Ok(());
        }
        drop(terminal_runs);

        self.events
            .append("run.cancelled", json!({ "run_id": run_id }))
            .await;
        Ok(())
    }

    pub async fn complete_run(&self, run_id: &str) -> Result<(), RunOrchestratorError> {
        let mut terminal_runs = self.terminal_runs.lock().await;
        if !terminal_runs.insert(run_id.to_string()) {
            return Ok(());
        }
        drop(terminal_runs);

        self.events
            .append("run.completed", json!({ "run_id": run_id }))
            .await;
        Ok(())
    }
}

#[derive(Debug, thiserror::Error)]
pub enum RunOrchestratorError {}

#[derive(Debug)]
struct RollingRedactor {
    secrets: Vec<String>,
    previous_by_run: HashMap<String, String>,
}

impl RollingRedactor {
    fn new(secrets: Vec<String>) -> Self {
        Self {
            secrets,
            previous_by_run: HashMap::new(),
        }
    }

    fn redact(&mut self, run_id: &str, delta: &str) -> String {
        let previous = self
            .previous_by_run
            .get(run_id)
            .cloned()
            .unwrap_or_default();
        let combined = format!("{previous}{delta}");
        let redacted = self
            .secrets
            .iter()
            .fold(combined, |text, secret| text.replace(secret, "[REDACTED]"));

        self.previous_by_run
            .insert(run_id.to_string(), retain_tail(&redacted));
        redacted
    }
}

fn retain_tail(value: &str) -> String {
    value
        .chars()
        .rev()
        .take(128)
        .collect::<String>()
        .chars()
        .rev()
        .collect()
}

#[derive(Clone, Debug)]
pub struct ContextMessageRecord {
    pub channel_id: String,
    pub task_id: Option<String>,
    pub agent_id: String,
    pub role: String,
    pub content: Option<String>,
    pub deleted: bool,
}

#[derive(Clone, Debug, Serialize)]
pub struct ContextMessage {
    pub role: String,
    pub content: String,
}

pub struct ContextAssembler;

impl ContextAssembler {
    pub fn assemble(records: Vec<ContextMessageRecord>) -> Vec<ContextMessage> {
        records
            .into_iter()
            .filter(|record| !record.deleted)
            .filter_map(|record| {
                record.content.map(|content| ContextMessage {
                    role: record.role,
                    content,
                })
            })
            .collect()
    }
}
