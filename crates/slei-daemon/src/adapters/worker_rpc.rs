use std::io::{BufRead, Read, Write};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;

use serde_json::Value;

type WorkerEventHandler = Arc<dyn Fn(Value) + Send + Sync + 'static>;

#[derive(Clone, Default)]
pub struct WorkerTransport {
    commands: Arc<Mutex<Vec<Value>>>,
    local_runner: Arc<Mutex<Option<LocalRunnerTransport>>>,
    fail_next_sends: Arc<Mutex<usize>>,
}

#[derive(Clone)]
struct LocalRunnerTransport {
    runner_path: PathBuf,
    event_handler: WorkerEventHandler,
}

impl std::fmt::Debug for WorkerTransport {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("WorkerTransport")
            .field("commands", &self.commands)
            .field(
                "local_runner",
                &self
                    .local_runner
                    .lock()
                    .map(|runner| runner.is_some())
                    .unwrap_or(false),
            )
            .field(
                "fail_next_sends",
                &self.fail_next_sends.lock().map(|count| *count).unwrap_or(0),
            )
            .finish()
    }
}

impl WorkerTransport {
    pub fn fake() -> Self {
        Self::default()
    }

    pub fn local_runner(
        runner_path: PathBuf,
        event_handler: impl Fn(Value) + Send + Sync + 'static,
    ) -> Self {
        let transport = Self::default();
        transport.configure_local_runner(runner_path, event_handler);
        transport
    }

    pub fn configure_local_runner(
        &self,
        runner_path: PathBuf,
        event_handler: impl Fn(Value) + Send + Sync + 'static,
    ) {
        *self
            .local_runner
            .lock()
            .expect("local worker transport lock") = Some(LocalRunnerTransport {
            runner_path,
            event_handler: Arc::new(event_handler),
        });
    }

    pub fn send(&self, command: Value) -> Result<(), WorkerRpcError> {
        {
            let mut fail_next_sends = self
                .fail_next_sends
                .lock()
                .map_err(|_| WorkerRpcError::PoisonedTransport)?;
            if *fail_next_sends > 0 {
                *fail_next_sends -= 1;
                return Err(WorkerRpcError::ForcedTransportFailure);
            }
        }
        self.commands
            .lock()
            .map_err(|_| WorkerRpcError::PoisonedTransport)?
            .push(command.clone());
        let local_runner = self
            .local_runner
            .lock()
            .map_err(|_| WorkerRpcError::PoisonedTransport)?
            .clone();
        if let Some(local_runner) = local_runner {
            local_runner.send(command);
        }
        Ok(())
    }

    pub fn commands(&self) -> Vec<Value> {
        self.commands
            .lock()
            .expect("fake worker transport lock")
            .clone()
    }

    #[doc(hidden)]
    pub fn fail_next_send_for_tests(&self) {
        *self
            .fail_next_sends
            .lock()
            .expect("fake worker transport lock") += 1;
    }
}

impl LocalRunnerTransport {
    fn send(&self, command: Value) {
        if command.get("type").and_then(Value::as_str) != Some("start_run") {
            return;
        }
        let runner_path = self.runner_path.clone();
        let handler = self.event_handler.clone();
        thread::spawn(move || {
            run_local_runner_command(runner_path, command, handler);
        });
    }
}

fn run_local_runner_command(runner_path: PathBuf, command: Value, handler: WorkerEventHandler) {
    let run_id = command
        .get("run_id")
        .and_then(Value::as_str)
        .unwrap_or("unknown")
        .to_string();
    let cwd = command
        .get("session")
        .and_then(|session| session.get("cwd"))
        .and_then(Value::as_str)
        .unwrap_or(".");
    let payload = match serde_json::to_string(&command) {
        Ok(payload) => payload,
        Err(error) => {
            handler(json_failed_event(
                &run_id,
                &format!("failed to serialize worker command: {error}"),
            ));
            return;
        }
    };
    let mut child = match Command::new("node")
        .arg(&runner_path)
        .current_dir(cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
    {
        Ok(child) => child,
        Err(error) => {
            handler(json_failed_event(
                &run_id,
                &format!("failed to start worker runner: {error}"),
            ));
            return;
        }
    };
    if let Some(stdin) = child.stdin.as_mut() {
        if let Err(error) = stdin.write_all(payload.as_bytes()) {
            handler(json_failed_event(
                &run_id,
                &format!("failed to write worker input: {error}"),
            ));
            return;
        }
    }
    drop(child.stdin.take());

    let Some(stdout) = child.stdout.take() else {
        handler(json_failed_event(&run_id, "worker stdout was not captured"));
        return;
    };
    let stderr = child.stderr.take();
    let stderr_handle = stderr.map(|stderr| {
        thread::spawn(move || {
            let mut text = String::new();
            let _ = std::io::BufReader::new(stderr).read_to_string(&mut text);
            text
        })
    });

    for line in std::io::BufReader::new(stdout).lines() {
        match line {
            Ok(line) if line.trim().is_empty() => {}
            Ok(line) => match serde_json::from_str::<Value>(&line) {
                Ok(event) => handler(event),
                Err(error) => handler(json_failed_event(
                    &run_id,
                    &format!("invalid worker event JSON: {error}"),
                )),
            },
            Err(error) => {
                handler(json_failed_event(
                    &run_id,
                    &format!("failed to read worker output: {error}"),
                ));
                break;
            }
        }
    }
    match child.wait() {
        Ok(status) if status.success() => {}
        Ok(status) => {
            let stderr = stderr_handle
                .and_then(|handle| handle.join().ok())
                .unwrap_or_default();
            let detail = stderr.trim();
            let message;
            let message = if detail.is_empty() {
                message = format!("worker runner exited with status {status}");
                message.as_str()
            } else {
                detail
            };
            handler(json_failed_event(&run_id, message));
        }
        Err(error) => handler(json_failed_event(
            &run_id,
            &format!("failed to wait for worker runner: {error}"),
        )),
    }
}

fn json_failed_event(run_id: &str, message: &str) -> Value {
    serde_json::json!({
        "type": "failed",
        "run_id": run_id,
        "message": message,
    })
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
        if self.value["type"] == "product_tool_requested" {
            require_string(&self.value, "run_id")?;
            require_string(&self.value, "tool_use_id")?;
            require_string(&self.value, "agent_id")?;
            require_string(&self.value, "tool_name")?;
            self.value
                .get("payload")
                .ok_or(WorkerRpcError::MissingField("payload"))?;
        }

        Ok(self.value.clone())
    }
}

#[derive(Debug, thiserror::Error)]
pub enum WorkerRpcError {
    #[error("worker transport lock poisoned")]
    PoisonedTransport,
    #[error("forced worker transport failure")]
    ForcedTransportFailure,
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
