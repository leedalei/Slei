pub struct AgentSystemPromptInput<'a> {
    pub agent_id: &'a str,
    pub handle: &'a str,
    pub name: &'a str,
    pub role: &'a str,
    pub node_id: &'a str,
    pub cwd: &'a str,
    pub session_id: &'a str,
    pub model: &'a str,
    pub channel_id: Option<&'a str>,
    pub channel_name: Option<&'a str>,
    pub message_id: Option<&'a str>,
    pub task_id: Option<&'a str>,
    pub runtime_kind: &'a str,
    pub legacy_mode: bool,
    pub source_message_id: Option<&'a str>,
    pub notes: Option<&'a str>,
}

pub fn build_agent_system_prompt(input: AgentSystemPromptInput<'_>) -> String {
    let task_id = input.task_id.unwrap_or("none");
    let channel_id = input.channel_id.unwrap_or("none");
    let channel_name = input.channel_name.unwrap_or("none");
    let message_id = input.message_id.unwrap_or("none");
    let source_message_id = input.source_message_id.unwrap_or("none");
    let notes = input.notes.unwrap_or("none");
    let legacy_mode = if input.legacy_mode {
        "enabled"
    } else {
        "disabled"
    };

    format!(
        r##"## Slei Agent Identity
- Agent ID: {agent_id}
- Handle: {handle}
- Name: {name}
- Role: {role}
- You are an autonomous Slei agent running inside the daemon-managed runtime.

## Runtime Context
- Agent ID: {agent_id}
- Server/Node ID: {node_id}
- cwd: {cwd}
- session: {session_id}
- model: {model}
- runtime kind: {runtime_kind}
- legacy mode: {legacy_mode}
- channel id: {channel_id}
- channel name: {channel_name}
- triggering message id: {message_id}
- task id: {task_id}
- source message id: {source_message_id}
- notes: {notes}

## Message Header Format
Visible channel messages are represented with this header:
`[target=#channel msg=<msg-id> time=<iso8601> type=<human|agent|system>]`

Use the header to understand target, message identity, event time, and author type. Do not invent missing history from the prompt; read it through Slei CLI commands.

## Claim Rules
- If a message explicitly mentions {handle}, treat it as a direct request unless the body says otherwise.
- If a message explicitly mentions another agent and does not mention {handle}, do not claim it unless it is already your active task or an explicit handoff to you.
- If the message is assigned to your role, active task, or prior handoff, you may claim it as self-responsibility even without a mention.
- Before doing visible work for a channel message, run `slei message claim <msg-id> --agent <agent-id>`.
- If the claim fails, another agent already claimed it, or the message is no longer actionable, exit silently. Do not send a channel reply explaining the failed claim.
- If you are uncertain, read nearby history before claiming. Claim only when you can contribute.

## Slei CLI Commands
All visible product flow must go through `slei` CLI commands.

Message intake and claims:
- `slei message claim <msg-id> --agent <agent-id>`

History reading:
- `slei message read --channel "#channel" --limit 20`
- `slei message read --channel "#channel:msgId"`
- `slei message read --channel "#channel" --after <seqNo>`
- `slei message read --channel "#channel" --before <seqNo>`
- `slei message read --channel "#channel" --around <msgId>`
- `slei message search --query "关键词"`

Visible replies and task operations:
- Send channel replies with `slei message send --target "#channel" --agent <agent-id>` and pipe the body through stdin.
- Create a task from a source message with `slei task create --source-message <msg-id> --agent <agent-id>`.
- Claim a task with `slei task claim <task-id> --agent <agent-id>`.
- Reply to a task with `slei task reply <task-id> --agent <agent-id>` and include concise progress or results.
- Update task status with `slei task update <task-id> --status <status>`.
- List tasks with `slei task list --channel "#channel"`.
- Read a task thread with `slei task thread <task-id>`.
- To hand work to another agent, send a visible `@mention` with the next owner and task/thread context, then update the task/status as needed.
- Update status with `slei agent status --agent <agent-id> --state working --phase "正在阅读历史"` and keep phase text truthful.
- Update `MEMORY.md` directly when Active Context should survive handoff, wait, or exit, then use `slei agent status` to record that you are updating memory.

## Runtime Status Phases
Use status phases such as:
- 正在阅读历史
- 正在查询待办
- 正在更新记忆
- 正在回复/转交

These operations are logged by the daemon. Each agent keeps 最近 100 条 recent status/log entries; older entries are removed when the limit is exceeded.

## MEMORY Active Context
Maintain Active Context for long tasks, waiting for user confirmation, cross-channel items, handoff, and before exit.

Format each Active Context entry with:
- 频道
- 时间
- 当前处理事项
- 进展

最多 3 个频道/事项. When a new channel/item must be added beyond the limit, replace the oldest item. Keep this short and actionable so the next run can resume without guessing.

## Output Rules
- All visible channel/task flow must use the `slei` CLI.
- Ordinary stdout is only local process output; it will not automatically become a channel message.
- Do not depend on local mock state for production behavior. The daemon is the source of truth for messages, claims, tasks, memory, status, and persistence.
"##,
        agent_id = input.agent_id,
        handle = input.handle,
        name = input.name,
        role = input.role,
        node_id = input.node_id,
        cwd = input.cwd,
        session_id = input.session_id,
        model = input.model,
        runtime_kind = input.runtime_kind,
        legacy_mode = legacy_mode,
        channel_id = channel_id,
        channel_name = channel_name,
        message_id = message_id,
        task_id = task_id,
        source_message_id = source_message_id,
        notes = notes,
    )
}

pub fn build_legacy_coordinator_system_prompt() -> String {
    "Slei coordinator runtime. Route messages through daemon-owned state and return only the requested coordinator output. Do not answer users visibly from the coordinator."
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_input() -> AgentSystemPromptInput<'static> {
        AgentSystemPromptInput {
            agent_id: "agent_coda",
            handle: "@coda",
            name: "Coda",
            role: "implementation worker",
            node_id: "node_local",
            cwd: "/tmp/slei",
            session_id: "session_123",
            model: "gpt-5",
            channel_id: Some("dev"),
            channel_name: Some("#dev"),
            message_id: Some("msg_123"),
            task_id: Some("task_6"),
            runtime_kind: "channel",
            legacy_mode: false,
            source_message_id: Some("msg_root"),
            notes: Some("Task 6 worker"),
        }
    }

    #[test]
    fn system_prompt_includes_identity_cli_header_rules_and_memory_contract() {
        let prompt = build_agent_system_prompt(sample_input());

        assert!(prompt.contains("## Slei Agent Identity"));
        assert!(prompt.contains("Agent ID: agent_coda"));
        assert!(prompt.contains("Handle: @coda"));
        assert!(prompt.contains("slei message claim <msg-id> --agent <agent-id>"));
        assert!(prompt.contains("slei message read --channel \"#channel\" --around <msgId>"));
        assert!(prompt
            .contains("[target=#channel msg=<msg-id> time=<iso8601> type=<human|agent|system>]"));
        assert!(prompt.contains("Active Context"));
        assert!(prompt.contains("最多 3 个频道/事项"));
        assert!(prompt.contains("正在阅读历史"));
        assert!(prompt.contains("最近 100 条"));
        assert!(prompt.contains("slei task create --source-message <msg-id> --agent <agent-id>"));
        assert!(prompt.contains("slei task claim <task-id> --agent <agent-id>"));
        assert!(prompt.contains("slei task update <task-id> --status <status>"));
        assert!(prompt.contains("slei task list --channel \"#channel\""));
        assert!(prompt.contains("slei task thread <task-id>"));
        assert!(prompt.contains("does not mention @coda, do not claim"));
        assert!(!prompt.contains("slei message check"));
        assert!(!prompt.contains("slei task transfer"));
        assert!(!prompt.contains("slei memory update"));
        assert!(!prompt.contains("raft "));
    }

    #[test]
    fn system_prompt_supports_dm_without_channel_context() {
        let prompt = build_agent_system_prompt(AgentSystemPromptInput {
            channel_id: None,
            channel_name: None,
            message_id: None,
            task_id: None,
            source_message_id: None,
            notes: None,
            ..sample_input()
        });

        assert!(prompt.contains("- channel id: none"));
        assert!(prompt.contains("- channel name: none"));
        assert!(prompt.contains("- triggering message id: none"));
        assert!(prompt.contains("- task id: none"));
        assert!(!prompt.contains("raft "));
    }

    #[test]
    fn legacy_prompt_is_minimal_and_slei_named() {
        let prompt = build_legacy_coordinator_system_prompt();

        assert!(prompt.contains("Slei"));
        assert!(prompt.contains("coordinator"));
        assert!(!prompt.contains("raft "));
    }
}
