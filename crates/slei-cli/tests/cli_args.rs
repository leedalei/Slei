#[path = "../src/main.rs"]
mod cli;

use clap::Parser;
use cli::{
    claim_exit_code, normalize_channel_arg, normalize_send_target, AgentCommand, Cli, Command,
    MessageCommand, ReadArgs, TaskCommand,
};
use serde_json::json;
use std::process::Command as ProcessCommand;
use std::process::Output;

#[test]
fn parses_message_commands() {
    let cli =
        Cli::try_parse_from(["slei", "message", "claim", "msg_123", "--agent", "agent_a"]).unwrap();
    assert!(matches!(
        cli.command,
        Command::Message(MessageCommand::Claim { msg_id, agent })
            if msg_id == "msg_123" && agent == "agent_a"
    ));

    let cli = Cli::try_parse_from([
        "slei", "message", "send", "--target", "#all", "--agent", "agent_a",
    ])
    .unwrap();
    assert!(matches!(
        cli.command,
        Command::Message(MessageCommand::Send(args))
            if args.target == "#all" && args.agent == "agent_a"
    ));

    let cli = Cli::try_parse_from(["slei", "message", "search", "--query", "关键词"]).unwrap();
    assert!(matches!(
        cli.command,
        Command::Message(MessageCommand::Search(args)) if args.query == "关键词"
    ));
}

#[test]
fn parses_message_read_windows() {
    let cases = [
        (
            [
                "slei",
                "message",
                "read",
                "--channel",
                "#all",
                "--limit",
                "20",
            ],
            Some(20),
            None,
            None,
            None,
        ),
        (
            [
                "slei",
                "message",
                "read",
                "--channel",
                "#all",
                "--after",
                "10",
            ],
            None,
            Some(10),
            None,
            None,
        ),
        (
            [
                "slei",
                "message",
                "read",
                "--channel",
                "#all",
                "--before",
                "10",
            ],
            None,
            None,
            Some(10),
            None,
        ),
    ];

    for (argv, limit, after, before, around) in cases {
        let cli = Cli::try_parse_from(argv).unwrap();
        assert!(matches!(
            cli.command,
            Command::Message(MessageCommand::Read(ReadArgs {
                channel,
                limit: parsed_limit,
                after: parsed_after,
                before: parsed_before,
                around: parsed_around,
            })) if channel == "#all"
                && parsed_limit == limit
                && parsed_after == after
                && parsed_before == before
                && parsed_around.as_deref() == around
        ));
    }

    let cli = Cli::try_parse_from([
        "slei",
        "message",
        "read",
        "--channel",
        "#all",
        "--around",
        "msg_123",
    ])
    .unwrap();
    assert!(matches!(
        cli.command,
        Command::Message(MessageCommand::Read(ReadArgs { around, .. }))
            if around.as_deref() == Some("msg_123")
    ));
}

#[test]
fn parses_task_commands() {
    let cli = Cli::try_parse_from([
        "slei",
        "task",
        "create",
        "--source-message",
        "msg_123",
        "--agent",
        "agent_a",
    ])
    .unwrap();
    assert!(matches!(
        cli.command,
        Command::Task(TaskCommand::Create(args))
            if args.source_message == "msg_123" && args.agent == "agent_a"
    ));

    let cli =
        Cli::try_parse_from(["slei", "task", "claim", "task_1", "--agent", "agent_a"]).unwrap();
    assert!(matches!(
        cli.command,
        Command::Task(TaskCommand::Claim { task_id, agent })
            if task_id == "task_1" && agent == "agent_a"
    ));

    let cli =
        Cli::try_parse_from(["slei", "task", "reply", "task_1", "--agent", "agent_a"]).unwrap();
    assert!(matches!(
        cli.command,
        Command::Task(TaskCommand::Reply(args))
            if args.task_id == "task_1" && args.agent == "agent_a"
    ));

    let cli = Cli::try_parse_from([
        "slei",
        "task",
        "update",
        "task_1",
        "--status",
        "in_progress",
    ])
    .unwrap();
    assert!(matches!(
        cli.command,
        Command::Task(TaskCommand::Update(args))
            if args.task_id == "task_1" && args.status == "in_progress"
    ));

    let cli = Cli::try_parse_from(["slei", "task", "list", "--channel", "#all"]).unwrap();
    assert!(matches!(
        cli.command,
        Command::Task(TaskCommand::List(args)) if args.channel == "#all"
    ));

    let cli = Cli::try_parse_from(["slei", "task", "thread", "task_1"]).unwrap();
    assert!(matches!(
        cli.command,
        Command::Task(TaskCommand::Thread { task_id }) if task_id == "task_1"
    ));
}

#[test]
fn parses_agent_status_command() {
    let cli = Cli::try_parse_from([
        "slei",
        "agent",
        "status",
        "--agent",
        "agent_a",
        "--state",
        "working",
        "--phase",
        "reading_history",
    ])
    .unwrap();

    assert!(matches!(
        cli.command,
        Command::Agent(AgentCommand::Status(args))
            if args.agent == "agent_a"
                && args.state == "working"
                && args.phase.as_deref() == Some("reading_history")
    ));
}

#[test]
fn normalizes_channels_and_targets() {
    let normalized = normalize_channel_arg("#all", None).unwrap();
    assert_eq!(normalized.channel, "all");
    assert_eq!(normalized.around, None);

    let normalized = normalize_channel_arg("#all:msg_123", None).unwrap();
    assert_eq!(normalized.channel, "all");
    assert_eq!(normalized.around.as_deref(), Some("msg_123"));

    let normalized = normalize_channel_arg("#all:msg_123", Some("msg_999")).unwrap();
    assert_eq!(normalized.channel, "all");
    assert_eq!(normalized.around.as_deref(), Some("msg_999"));

    assert_eq!(normalize_send_target("#all").unwrap(), "#all");
    assert!(normalize_send_target("   ").is_err());
}

#[test]
fn cli_parameter_errors_exit_one_without_stdout() {
    let output = run_slei(["message", "send", "--target", "#all"]);

    assert_eq!(output.status.code(), Some(1));
    assert!(output.stdout.is_empty());
    assert!(String::from_utf8_lossy(&output.stderr).contains("error:"));
}

#[test]
fn cli_help_exits_zero_and_writes_stdout() {
    let output = run_slei(["--help"]);

    assert_eq!(output.status.code(), Some(0));
    assert!(output.stderr.is_empty());
    let stdout = String::from_utf8_lossy(&output.stdout);
    assert!(stdout.contains("Command line client for the Slei daemon"));
    assert!(stdout.contains("Usage:"));
}

#[test]
fn cli_version_exits_zero() {
    let output = run_slei(["--version"]);

    assert_eq!(output.status.code(), Some(0));
    assert!(output.stderr.is_empty());
    assert!(String::from_utf8_lossy(&output.stdout).contains("slei"));
}

#[test]
fn claimed_false_remains_exit_two() {
    assert_eq!(claim_exit_code(&json!({ "claimed": false })), 2);
    assert_eq!(claim_exit_code(&json!({ "claimed": true })), 0);
    assert_eq!(claim_exit_code(&json!({ "ok": true })), 0);
}

fn run_slei(args: impl IntoIterator<Item = &'static str>) -> Output {
    ProcessCommand::new(env!("CARGO_BIN_EXE_slei"))
        .args(args)
        .output()
        .unwrap()
}
