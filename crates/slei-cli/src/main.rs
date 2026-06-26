#![cfg_attr(test, allow(dead_code))]

mod client;

use anyhow::{bail, Context, Result};
use clap::{error::ErrorKind, Args, Parser, Subcommand};
use client::DaemonClient;
use serde::Serialize;
use serde_json::{json, Value};
use tokio::io::AsyncReadExt;
use uuid::Uuid;

#[derive(Debug, Parser)]
#[command(
    name = "slei-cli",
    version,
    about = "Command line client for the Slei daemon"
)]
pub struct Cli {
    #[command(subcommand)]
    pub command: Command,
}

#[derive(Debug, Subcommand)]
pub enum Command {
    #[command(subcommand)]
    Message(MessageCommand),
    #[command(subcommand)]
    Todo(TodoCommand),
    #[command(subcommand)]
    Task(TaskCommand),
    #[command(subcommand)]
    Agent(AgentCommand),
}

#[derive(Debug, Subcommand)]
pub enum MessageCommand {
    Claim {
        msg_id: String,
        #[arg(long)]
        agent: String,
    },
    Send(SendMessageArgs),
    Read(ReadArgs),
    Search(SearchArgs),
}

#[derive(Debug, Args)]
pub struct SendMessageArgs {
    #[arg(long)]
    pub target: String,
    #[arg(long)]
    pub agent: String,
    #[arg(long)]
    pub idempotency_key: Option<String>,
}

#[derive(Debug, Args)]
pub struct ReadArgs {
    #[arg(long)]
    pub channel: String,
    #[arg(long)]
    pub limit: Option<i64>,
    #[arg(long)]
    pub after: Option<i64>,
    #[arg(long)]
    pub before: Option<i64>,
    #[arg(long)]
    pub around: Option<String>,
    #[arg(long)]
    pub from_message: Option<String>,
    #[arg(long)]
    pub to_message: Option<String>,
}

#[derive(Debug, Args)]
pub struct SearchArgs {
    #[arg(long)]
    pub query: String,
    #[arg(long)]
    pub limit: Option<i64>,
}

#[derive(Debug, Subcommand)]
pub enum TodoCommand {
    List(TodoListArgs),
    Show { todo_id: String },
    Create(TodoCreateArgs),
    Update(TodoUpdateArgs),
    Delete(TodoDeleteArgs),
    Clear(TodoClearArgs),
}

#[derive(Debug, Args)]
pub struct TodoListArgs {
    #[arg(long)]
    pub agent: Option<String>,
    #[arg(long)]
    pub channel: Option<String>,
    #[arg(long)]
    pub status: Option<String>,
}

#[derive(Debug, Args)]
pub struct TodoCreateArgs {
    #[arg(long)]
    pub agent: String,
    #[arg(long)]
    pub channel: String,
    #[arg(long)]
    pub message: String,
    #[arg(long)]
    pub note: Option<String>,
    #[arg(long)]
    pub idempotency_key: Option<String>,
}

#[derive(Debug, Args)]
pub struct TodoUpdateArgs {
    pub todo_id: String,
    #[arg(long)]
    pub status: String,
    #[arg(long)]
    pub note: Option<String>,
    #[arg(long)]
    pub idempotency_key: Option<String>,
}

#[derive(Debug, Args)]
pub struct TodoDeleteArgs {
    pub todo_id: String,
    #[arg(long)]
    pub idempotency_key: Option<String>,
}

#[derive(Debug, Args)]
pub struct TodoClearArgs {
    #[arg(long)]
    pub agent: Option<String>,
    #[arg(long)]
    pub channel: Option<String>,
    #[arg(long)]
    pub status: Option<String>,
    #[arg(long)]
    pub note: Option<String>,
    #[arg(long)]
    pub idempotency_key: Option<String>,
}

#[derive(Debug, Subcommand)]
pub enum TaskCommand {
    Create(CreateTaskArgs),
    Claim {
        task_id: String,
        #[arg(long)]
        agent: String,
    },
    Reply(TaskReplyArgs),
    Update(TaskUpdateArgs),
    List(TaskListArgs),
    Thread {
        task_id: String,
    },
}

#[derive(Debug, Args)]
pub struct CreateTaskArgs {
    #[arg(long)]
    pub source_message: String,
    #[arg(long)]
    pub agent: String,
    #[arg(long)]
    pub idempotency_key: Option<String>,
}

#[derive(Debug, Args)]
pub struct TaskReplyArgs {
    pub task_id: String,
    #[arg(long)]
    pub agent: String,
    #[arg(long)]
    pub idempotency_key: Option<String>,
}

#[derive(Debug, Args)]
pub struct TaskUpdateArgs {
    pub task_id: String,
    #[arg(long)]
    pub status: String,
    #[arg(long)]
    pub idempotency_key: Option<String>,
}

#[derive(Debug, Args)]
pub struct TaskListArgs {
    #[arg(long)]
    pub channel: String,
}

#[derive(Debug, Subcommand)]
pub enum AgentCommand {
    Status(AgentStatusArgs),
}

#[derive(Debug, Args)]
pub struct AgentStatusArgs {
    #[arg(long)]
    pub agent: String,
    #[arg(long)]
    pub state: String,
    #[arg(long)]
    pub phase: Option<String>,
    #[arg(long)]
    pub reason: Option<String>,
    #[arg(long)]
    pub run_id: Option<String>,
    #[arg(long)]
    pub channel: Option<String>,
    #[arg(long)]
    pub message: Option<String>,
    #[arg(long)]
    pub task: Option<String>,
    #[arg(long)]
    pub idempotency_key: Option<String>,
}

#[derive(Debug, PartialEq, Eq)]
pub struct NormalizedChannel {
    pub channel: String,
    pub around: Option<String>,
}

#[tokio::main]
async fn main() {
    let exit_code = match run().await {
        Ok(exit_code) => exit_code,
        Err(error) => {
            eprintln!("{error:#}");
            1
        }
    };
    std::process::exit(exit_code);
}

async fn run() -> Result<i32> {
    let cli = match Cli::try_parse() {
        Ok(cli) => cli,
        Err(error)
            if matches!(
                error.kind(),
                ErrorKind::DisplayHelp | ErrorKind::DisplayVersion
            ) =>
        {
            error.print()?;
            return Ok(0);
        }
        Err(error) => return Err(error.into()),
    };
    let client = DaemonClient::from_env()?;
    let exit_code = execute(cli, &client).await?;
    Ok(exit_code)
}

async fn execute(cli: Cli, client: &DaemonClient) -> Result<i32> {
    let (json, exit_code) = match cli.command {
        Command::Message(command) => execute_message(command, client).await?,
        Command::Todo(command) => execute_todo(command, client).await?,
        Command::Task(command) => execute_task(command, client).await?,
        Command::Agent(command) => execute_agent(command, client).await?,
    };
    println!("{}", serde_json::to_string(&json)?);
    Ok(exit_code)
}

async fn execute_message(command: MessageCommand, client: &DaemonClient) -> Result<(Value, i32)> {
    match command {
        MessageCommand::Claim { msg_id, agent } => {
            let body = json!({ "agentId": agent });
            let response: Value = client
                .post_json(&format!("/v1/claims/messages/{msg_id}"), &body)
                .await?;
            let exit_code = claim_exit_code(&response);
            Ok((response, exit_code))
        }
        MessageCommand::Send(args) => {
            let target = normalize_send_target(&args.target)?;
            let body_text = stdin_body().await?;
            let key = idempotency_key(args.idempotency_key);
            let body = json!({
                "target": target,
                "agentId": args.agent,
                "body": body_text,
            });
            let response = client
                .post_json_idempotent("/v1/messages/send", &body, &key)
                .await?;
            Ok((response, 0))
        }
        MessageCommand::Read(args) => {
            let normalized = normalize_channel_arg(&args.channel, args.around.as_deref())?;
            let path = query_path("/v1/messages/read", message_read_pairs(&normalized, &args))?;
            let response = client.get_json(&path).await?;
            Ok((response, 0))
        }
        MessageCommand::Search(args) => {
            let mut pairs = vec![("query".to_string(), args.query)];
            if let Some(limit) = args.limit {
                pairs.push(("limit".to_string(), limit.to_string()));
            }
            let response = client
                .get_json(&query_path("/v1/messages/search", pairs)?)
                .await?;
            Ok((response, 0))
        }
    }
}

async fn execute_todo(command: TodoCommand, client: &DaemonClient) -> Result<(Value, i32)> {
    match command {
        TodoCommand::List(args) => {
            let path = query_path("/v1/agent-message-todos", todo_list_pairs(args)?)?;
            let response = client.get_json(&path).await?;
            Ok((response, 0))
        }
        TodoCommand::Show { todo_id } => {
            let response = client
                .get_json(&format!("/v1/agent-message-todos/{todo_id}"))
                .await?;
            Ok((response, 0))
        }
        TodoCommand::Create(args) => {
            let key = idempotency_key(args.idempotency_key);
            let channel_id = normalize_channel_arg(&args.channel, None)?.channel;
            let body = TodoCreateBody {
                agent_id: args.agent,
                channel_id,
                message_id: args.message,
                note: args.note,
            };
            let response = client
                .post_json_idempotent("/v1/agent-message-todos", &body, &key)
                .await?;
            Ok((response, 0))
        }
        TodoCommand::Update(args) => {
            let key = idempotency_key(args.idempotency_key);
            let body = TodoUpdateBody {
                status: args.status,
                note: args.note,
            };
            let response = client
                .patch_json_idempotent(
                    &format!("/v1/agent-message-todos/{}", args.todo_id),
                    &body,
                    &key,
                )
                .await?;
            Ok((response, 0))
        }
        TodoCommand::Delete(args) => {
            let key = idempotency_key(args.idempotency_key);
            let response = client
                .delete_json_idempotent(&format!("/v1/agent-message-todos/{}", args.todo_id), &key)
                .await?;
            Ok((response, 0))
        }
        TodoCommand::Clear(args) => {
            let key = idempotency_key(args.idempotency_key);
            let body = TodoClearBody {
                agent_id: args.agent,
                channel_id: match args.channel {
                    Some(channel) => Some(normalize_channel_arg(&channel, None)?.channel),
                    None => None,
                },
                status: args.status,
                note: args.note,
            };
            let response = client
                .post_json_idempotent("/v1/agent-message-todos/clear", &body, &key)
                .await?;
            Ok((response, 0))
        }
    }
}

async fn execute_task(command: TaskCommand, client: &DaemonClient) -> Result<(Value, i32)> {
    match command {
        TaskCommand::Create(args) => {
            let key = idempotency_key(args.idempotency_key);
            let body = json!({
                "sourceMessageId": args.source_message,
                "creatorId": args.agent,
            });
            let response = client
                .post_json_idempotent("/v1/tasks/from-source-message", &body, &key)
                .await?;
            Ok((response, 0))
        }
        TaskCommand::Claim { task_id, agent } => {
            let body = json!({ "agentId": agent });
            let response: Value = client
                .post_json(&format!("/v1/claims/tasks/{task_id}"), &body)
                .await?;
            let exit_code = claim_exit_code(&response);
            Ok((response, exit_code))
        }
        TaskCommand::Reply(args) => {
            let key = idempotency_key(args.idempotency_key);
            let body_text = stdin_body().await?;
            let body = json!({
                "agentId": args.agent,
                "role": "agent",
                "body": body_text,
            });
            let response = client
                .post_json_idempotent(&format!("/v1/tasks/{}/replies", args.task_id), &body, &key)
                .await?;
            Ok((response, 0))
        }
        TaskCommand::Update(args) => {
            let key = idempotency_key(args.idempotency_key);
            let body = json!({ "status": args.status });
            let response = client
                .patch_json_idempotent(&format!("/v1/tasks/{}", args.task_id), &body, &key)
                .await?;
            Ok((response, 0))
        }
        TaskCommand::List(args) => {
            let normalized = normalize_channel_arg(&args.channel, None)?;
            let path = query_path(
                "/v1/tasks",
                vec![("channel".to_string(), normalized.channel)],
            )?;
            let response = client.get_json(&path).await?;
            Ok((response, 0))
        }
        TaskCommand::Thread { task_id } => {
            let response = client
                .get_json(&format!("/v1/tasks/{task_id}/thread"))
                .await?;
            Ok((response, 0))
        }
    }
}

async fn execute_agent(command: AgentCommand, client: &DaemonClient) -> Result<(Value, i32)> {
    match command {
        AgentCommand::Status(args) => {
            let key = idempotency_key(args.idempotency_key);
            let channel_id = match args.channel {
                Some(channel) => Some(normalize_channel_arg(&channel, None)?.channel),
                None => None,
            };
            let body = AgentStatusBody {
                state: args.state,
                phase: args.phase,
                reason: args.reason,
                run_id: args.run_id,
                channel_id,
                message_id: args.message,
                task_id: args.task,
            };
            let response = client
                .post_json_idempotent(&format!("/v1/agents/{}/status", args.agent), &body, &key)
                .await?;
            Ok((response, 0))
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentStatusBody {
    state: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    phase: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    run_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    channel_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    message_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    task_id: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct TodoCreateBody {
    agent_id: String,
    channel_id: String,
    message_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    note: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct TodoUpdateBody {
    status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    note: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct TodoClearBody {
    #[serde(skip_serializing_if = "Option::is_none")]
    agent_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    channel_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    note: Option<String>,
}

pub fn normalize_channel_arg(
    channel: &str,
    explicit_around: Option<&str>,
) -> Result<NormalizedChannel> {
    let trimmed = channel.trim();
    if trimmed.is_empty() {
        bail!("channel cannot be blank");
    }

    let without_hash = trimmed.strip_prefix('#').unwrap_or(trimmed);
    let (channel_id, embedded_around) = match without_hash.split_once(':') {
        Some((channel_id, around)) => (channel_id, Some(around)),
        None => (without_hash, None),
    };

    let channel_id = channel_id.trim();
    if channel_id.is_empty() {
        bail!("channel cannot be blank");
    }

    let around = explicit_around
        .or(embedded_around)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned);

    Ok(NormalizedChannel {
        channel: channel_id.to_string(),
        around,
    })
}

pub fn normalize_send_target(target: &str) -> Result<String> {
    let target = target.trim();
    if target.is_empty() {
        bail!("target cannot be blank");
    }
    Ok(target.to_string())
}

pub(crate) fn claim_exit_code(response: &Value) -> i32 {
    if response
        .get("claimed")
        .and_then(Value::as_bool)
        .is_some_and(|claimed| !claimed)
    {
        2
    } else {
        0
    }
}

fn idempotency_key(key: Option<String>) -> String {
    match key
        .map(|key| key.trim().to_string())
        .filter(|key| !key.is_empty())
    {
        Some(key) => key,
        None => {
            let key = Uuid::new_v4().to_string();
            eprintln!("debug: generated idempotency-key {key}");
            key
        }
    }
}

async fn stdin_body() -> Result<String> {
    let mut body = String::new();
    tokio::io::stdin()
        .read_to_string(&mut body)
        .await
        .context("failed to read stdin")?;
    Ok(body)
}

fn message_read_pairs(normalized: &NormalizedChannel, args: &ReadArgs) -> Vec<(String, String)> {
    let mut pairs = vec![("channel".to_string(), normalized.channel.clone())];
    if let Some(limit) = args.limit {
        pairs.push(("limit".to_string(), limit.to_string()));
    }
    if let Some(after) = args.after {
        pairs.push(("after".to_string(), after.to_string()));
    }
    if let Some(before) = args.before {
        pairs.push(("before".to_string(), before.to_string()));
    }
    if let Some(around) = &normalized.around {
        pairs.push(("around".to_string(), around.clone()));
    }
    if let Some(from_message) = &args.from_message {
        pairs.push(("fromMessage".to_string(), from_message.clone()));
    }
    if let Some(to_message) = &args.to_message {
        pairs.push(("toMessage".to_string(), to_message.clone()));
    }
    pairs
}

fn todo_list_pairs(args: TodoListArgs) -> Result<Vec<(String, String)>> {
    let mut pairs = Vec::new();
    if let Some(agent) = args.agent {
        pairs.push(("agentId".to_string(), agent));
    }
    if let Some(channel) = args.channel {
        pairs.push((
            "channelId".to_string(),
            normalize_channel_arg(&channel, None)?.channel,
        ));
    }
    if let Some(status) = args.status {
        if status == "deleted" {
            pairs.push(("includeDeleted".to_string(), "true".to_string()));
        }
        pairs.push(("status".to_string(), status));
    }
    Ok(pairs)
}

fn query_path(path: &str, pairs: Vec<(String, String)>) -> Result<String> {
    let mut url = reqwest::Url::parse("http://slei.local").expect("static base URL is valid");
    url.set_path(path);
    {
        let mut query = url.query_pairs_mut();
        for (key, value) in pairs {
            query.append_pair(&key, &value);
        }
    }
    let mut output = url.path().to_string();
    if let Some(query) = url.query() {
        output.push('?');
        output.push_str(query);
    }
    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    #[tokio::test]
    async fn message_read_adds_message_id_range_query_args() {
        assert_cli_request(
            &[
                "slei",
                "message",
                "read",
                "--channel",
                "#all",
                "--from-message",
                "msg_a",
                "--to-message",
                "msg_b",
            ],
            ExpectedRequest {
                method: "GET",
                path: "/v1/messages/read?channel=all&fromMessage=msg_a&toMessage=msg_b",
                body: None,
                idempotency_key: None,
            },
        )
        .await;
    }

    #[tokio::test]
    async fn todo_list_builds_filtered_query() {
        assert_cli_request(
            &[
                "slei",
                "todo",
                "list",
                "--agent",
                "agent_coda",
                "--channel",
                "#all",
                "--status",
                "pending",
            ],
            ExpectedRequest {
                method: "GET",
                path: "/v1/agent-message-todos?agentId=agent_coda&channelId=all&status=pending",
                body: None,
                idempotency_key: None,
            },
        )
        .await;
    }

    #[tokio::test]
    async fn todo_list_status_deleted_includes_deleted_rows() {
        assert_cli_request(
            &["slei", "todo", "list", "--status", "deleted"],
            ExpectedRequest {
                method: "GET",
                path: "/v1/agent-message-todos?includeDeleted=true&status=deleted",
                body: None,
                idempotency_key: None,
            },
        )
        .await;
    }

    #[tokio::test]
    async fn todo_show_builds_id_path() {
        assert_cli_request(
            &["slei", "todo", "show", "todo_123"],
            ExpectedRequest {
                method: "GET",
                path: "/v1/agent-message-todos/todo_123",
                body: None,
                idempotency_key: None,
            },
        )
        .await;
    }

    #[tokio::test]
    async fn todo_create_posts_body_with_idempotency_key() {
        assert_cli_request(
            &[
                "slei",
                "todo",
                "create",
                "--agent",
                "agent_coda",
                "--channel",
                "#all",
                "--message",
                "msg_1",
                "--note",
                "manual recovery",
                "--idempotency-key",
                "create-key",
            ],
            ExpectedRequest {
                method: "POST",
                path: "/v1/agent-message-todos",
                body: Some(json!({
                    "agentId": "agent_coda",
                    "channelId": "all",
                    "messageId": "msg_1",
                    "note": "manual recovery",
                })),
                idempotency_key: Some("create-key"),
            },
        )
        .await;
    }

    #[tokio::test]
    async fn todo_update_patches_status_and_note_with_idempotency_key() {
        assert_cli_request(
            &[
                "slei",
                "todo",
                "update",
                "todo_123",
                "--status",
                "done",
                "--note",
                "manually resolved",
                "--idempotency-key",
                "update-key",
            ],
            ExpectedRequest {
                method: "PATCH",
                path: "/v1/agent-message-todos/todo_123",
                body: Some(json!({
                    "status": "done",
                    "note": "manually resolved",
                })),
                idempotency_key: Some("update-key"),
            },
        )
        .await;
    }

    #[tokio::test]
    async fn todo_delete_sends_delete_with_idempotency_key() {
        assert_cli_request(
            &[
                "slei",
                "todo",
                "delete",
                "todo_123",
                "--idempotency-key",
                "delete-key",
            ],
            ExpectedRequest {
                method: "DELETE",
                path: "/v1/agent-message-todos/todo_123",
                body: None,
                idempotency_key: Some("delete-key"),
            },
        )
        .await;
    }

    #[tokio::test]
    async fn todo_clear_posts_filters_with_idempotency_key() {
        assert_cli_request(
            &[
                "slei",
                "todo",
                "clear",
                "--agent",
                "agent_coda",
                "--channel",
                "#all",
                "--status",
                "pending",
                "--note",
                "cleanup",
                "--idempotency-key",
                "clear-key",
            ],
            ExpectedRequest {
                method: "POST",
                path: "/v1/agent-message-todos/clear",
                body: Some(json!({
                    "agentId": "agent_coda",
                    "channelId": "all",
                    "status": "pending",
                    "note": "cleanup",
                })),
                idempotency_key: Some("clear-key"),
            },
        )
        .await;
    }

    struct ExpectedRequest {
        method: &'static str,
        path: &'static str,
        body: Option<Value>,
        idempotency_key: Option<&'static str>,
    }

    async fn assert_cli_request(args: &[&str], expected: ExpectedRequest) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base_url = format!("http://{}", listener.local_addr().unwrap());
        let server = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let request = read_request(&mut stream).await;
            let response = r#"{"ok":true}"#;
            stream
                .write_all(
                    format!(
                        "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\n\r\n{}",
                        response.len(),
                        response
                    )
                    .as_bytes(),
                )
                .await
                .unwrap();
            request
        });

        let cli = Cli::try_parse_from(args).unwrap();
        let client = DaemonClient::for_base_url(&base_url).unwrap();
        let exit_code = execute(cli, &client).await.unwrap();
        assert_eq!(exit_code, 0);

        let request = server.await.unwrap();
        assert_eq!(request.method, expected.method);
        assert_eq!(request.path, expected.path);
        assert_eq!(
            request.headers.get("idempotency-key").map(String::as_str),
            expected.idempotency_key
        );
        match expected.body {
            Some(expected_body) => {
                let actual: Value = serde_json::from_str(&request.body).unwrap();
                assert_eq!(actual, expected_body);
            }
            None => assert!(request.body.is_empty(), "unexpected body: {}", request.body),
        }
    }

    struct CapturedRequest {
        method: String,
        path: String,
        headers: HashMap<String, String>,
        body: String,
    }

    async fn read_request(stream: &mut tokio::net::TcpStream) -> CapturedRequest {
        let mut bytes = Vec::new();
        let mut buffer = [0_u8; 1024];
        let header_end = loop {
            let read = stream.read(&mut buffer).await.unwrap();
            assert!(read > 0, "client closed before sending headers");
            bytes.extend_from_slice(&buffer[..read]);
            if let Some(index) = find_header_end(&bytes) {
                break index;
            }
        };

        let header_text = String::from_utf8(bytes[..header_end].to_vec()).unwrap();
        let mut lines = header_text.split("\r\n");
        let request_line = lines.next().unwrap();
        let mut request_parts = request_line.split_whitespace();
        let method = request_parts.next().unwrap().to_string();
        let path = request_parts.next().unwrap().to_string();

        let mut headers = HashMap::new();
        for line in lines.filter(|line| !line.is_empty()) {
            let (name, value) = line.split_once(':').unwrap();
            headers.insert(name.to_ascii_lowercase(), value.trim().to_string());
        }

        let content_length = headers
            .get("content-length")
            .and_then(|value| value.parse::<usize>().ok())
            .unwrap_or(0);
        let body_start = header_end + 4;
        let mut body = bytes[body_start..].to_vec();
        while body.len() < content_length {
            let read = stream.read(&mut buffer).await.unwrap();
            assert!(read > 0, "client closed before sending body");
            body.extend_from_slice(&buffer[..read]);
        }
        body.truncate(content_length);

        CapturedRequest {
            method,
            path,
            headers,
            body: String::from_utf8(body).unwrap(),
        }
    }

    fn find_header_end(bytes: &[u8]) -> Option<usize> {
        bytes.windows(4).position(|window| window == b"\r\n\r\n")
    }
}
