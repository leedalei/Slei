#![cfg_attr(test, allow(dead_code))]

mod client;

use anyhow::{bail, Context, Result};
use clap::{Args, Parser, Subcommand};
use client::DaemonClient;
use serde::Serialize;
use serde_json::{json, Value};
use tokio::io::AsyncReadExt;
use uuid::Uuid;

#[derive(Debug, Parser)]
#[command(
    name = "slei",
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
}

#[derive(Debug, Args)]
pub struct SearchArgs {
    #[arg(long)]
    pub query: String,
    #[arg(long)]
    pub limit: Option<i64>,
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
    let cli = Cli::try_parse()?;
    let client = DaemonClient::from_env()?;
    let exit_code = execute(cli, &client).await?;
    Ok(exit_code)
}

async fn execute(cli: Cli, client: &DaemonClient) -> Result<i32> {
    let (json, exit_code) = match cli.command {
        Command::Message(command) => execute_message(command, client).await?,
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
    pairs
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
