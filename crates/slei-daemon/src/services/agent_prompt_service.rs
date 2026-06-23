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

## Claim Intent Classes
Classify each triggering message before claiming. These Markdown rules are the operating contract for channel claim decisions.

### 1. Direct Address
A message is directed to one or more specific agents only when it explicitly mentions their `@handle`. Display names are not stable routing identifiers.

- If it mentions {handle}, claim it unless the body says otherwise.
- If it mentions another agent and not you, do not claim unless the visible message is also a Channel Group Address, your active task, or an explicit handoff to you.

Agent-authored messages (`type=agent`) default to silence. Claim an Agent-authored message only when it explicitly mentions {handle} and assigns you a concrete follow-up task or decision. Do not reply merely to acknowledge another Agent.

### 2. Channel Group Address
A message is addressed to the channel group when it invites, greets, asks, consults, requests, or coordinates with the channel community as a whole, even if it does not use explicit group words.

`@all` always means Channel Group Address, not Direct Address to a single agent.

Examples: greetings, check-ins, `@all`, `大家`, `各位`, `我们`, `谁来`, `有人吗`, `早上好`, `怎么看`, `报数`, `每个人说一下`, open consultation, group request, lightweight social interaction.

- This is a sequential group participation flow.
- Each agent may participate once.
- Before claiming, check whether you already participated in this flow.
- Claim only the latest relevant message in the flow.
- Do not claim your own channel message unless it explicitly asks you to continue.
- Do not claim another Agent's ordinary reply unless it explicitly mentions {handle} and asks you to continue.
- If the flow expects ordering, continue the sequence based on visible history.
- If you claim successfully, reply briefly and naturally from your role/persona.
- If another agent already claimed the latest message, exit silently and wait for the next visible message.

Optional context lookup:

- For a Channel Group Address, you may read nearby previous messages before claiming when needed.
- Read history if you need to determine the original group prompt, current sequence/order, which agents have already participated, whether the latest message belongs to the same group flow, or whether the user has changed topic.
- Prefer the smallest useful window, for example `slei message read --channel "#channel" --around <msgId>` or `slei message read --channel "#channel" --limit 20`.
- Do not read history just to answer a simple standalone greeting if the current message is sufficient.

### 3. Specialized Work Request
A message asks for concrete work but does not address the whole group.

- Claim only if the work fits your role, active task, or prior handoff.
- If another agent is a better fit or already claimed, exit silently.
- For `type=agent` messages, this class still requires an explicit mention of {handle}.

### Required Claim Command
- Before doing visible work for a channel message, run `slei message claim <msg-id> --agent <agent-id>`.
- If the claim fails, another agent already claimed it, or the message is no longer actionable, exit silently. Do not send a channel reply explaining the failed claim.

## Pending Message Todos
Some channel runs may include pending message todos in the run packet. These are daemon-owned reminders that an earlier message still needs your attention after a failed claim.

- Process pending todos even if the current trigger is not claimable.
- Do not claim the current trigger solely for todo progression.
- Do not claim the todo source message.
- Read the source message range when needed with `slei message read --channel "#all" --from-message msg_A --to-message msg_B`.
- Visible replies and handoffs still use `slei message send`; the daemon advances todo status from the worker run lifecycle.

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
- Read channel membership, rosters, associated projects, and handoff relationships from `notes/channels.md`; do not duplicate those channel facts in `MEMORY.md`.
- Update `MEMORY.md` directly only when task Active Context should survive handoff, wait, or exit, then use `slei agent status` to record that you are updating memory.

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
        assert!(prompt.contains("## Claim Intent Classes"));
        assert!(prompt.contains("### 1. Direct Address"));
        assert!(prompt.contains("### 2. Channel Group Address"));
        assert!(prompt.contains("### 3. Specialized Work Request"));
        assert!(prompt.contains("Agent ID: agent_coda"));
        assert!(prompt.contains("Handle: @coda"));
        assert!(prompt.contains("`@all` always means Channel Group Address"));
        assert!(prompt.contains("read nearby previous messages before claiming when needed"));
        assert!(prompt.contains("Each agent may participate once"));
        assert!(prompt.contains("Agent-authored messages (`type=agent`) default to silence"));
        assert!(prompt.contains("Display names are not stable routing identifiers"));
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
        assert!(prompt.contains("If it mentions another agent and not you, do not claim"));
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
    fn system_prompt_mentions_pending_todos_without_management_commands() {
        let prompt = build_agent_system_prompt(sample_input());

        assert!(prompt.contains("## Pending Message Todos"));
        assert!(
            prompt.contains("Process pending todos even if the current trigger is not claimable.")
        );
        assert!(prompt.contains("Do not claim the current trigger solely for todo progression."));
        assert!(prompt.contains("Do not claim the todo source message."));
        assert!(prompt.contains(
            "slei message read --channel \"#all\" --from-message msg_A --to-message msg_B"
        ));
        assert!(!prompt.contains("slei todo update"));
        assert!(!prompt.contains("slei todo delete"));
        assert!(!prompt.contains("slei todo clear"));
        assert!(!prompt.contains("slei todo reopen"));
    }
}
