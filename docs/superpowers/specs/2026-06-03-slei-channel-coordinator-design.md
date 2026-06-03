# Slei Channel Coordinator And Agent Memory Design

- Status: Design approved for documentation
- Date: 2026-06-03
- Product area: Channels, agent routing, task creation, agent memory, persistence

## Summary

Slei channels should behave like durable group workspaces with long-lived Agent
membership. Each channel has an internal Coordinator that listens to channel
events, decides whether a message should become a task, and performs only the
initial task assignment. The Coordinator is not a visible member and does not
post chat messages. Visible conversation remains owned by humans, Agents,
system status entries, and task cards.

When Agents join a channel, they update their own memory document package
through a memory-maintainer Skill. The system provides structured facts, but it
does not directly script strict markdown edits. Agents then use their own memory
and injected task context to decide whether to mention another Agent, notify the
user, or finish the task.

This design replaces the earlier ordinary-message rule that a primary Agent
responds to messages without explicit mentions. Ordinary messages now flow
through the channel Coordinator, which may archive, summarize, route to an
Agent, or create a task.

## Goals

- Let users create a channel and select which Agents should join.
- Persist channel membership as a long-lived product fact.
- Update each joining Agent's memory package so it knows the channel, members,
  roles, and collaboration relationships.
- Let each joining Agent report that it is ready only after its memory update
  succeeds.
- Avoid broadcasting full channel context to every Agent.
- Route no-mention channel messages through a per-channel invisible
  Coordinator.
- Automatically create tasks for command-like or delivery-oriented messages.
- Assign each new task to exactly one initial Agent.
- Keep all later task flow visible through Agent-authored `@agent` mentions.
- Persist visible collaboration data and internal routing data locally.

## Non-Goals

- Building a global multi-channel scheduler.
- Having the Coordinator continue to manage task handoffs after initial
  assignment.
- Showing Coordinator messages in the channel timeline.
- Automatically choosing downstream task Agents from database relationships.
- Treating Agent memory markdown as a rigid script-generated config file.
- Requiring all Agents to finish joining before a channel becomes usable.

## Confirmed Decisions

| Topic | Decision |
| --- | --- |
| Channel membership | Long-lived membership, not temporary listening |
| Coordinator scope | One logical invisible Coordinator per channel |
| Coordinator output | Structured internal decisions, not visible chat text |
| No-mention messages | Routed through the channel Coordinator |
| Task creation | Coordinator directly creates tasks for command/delivery intent |
| First task assignee | Coordinator assigns one initial Agent |
| Later task handoff | Current Agent decides and posts visible `@agent` mentions |
| Agent memory update | Each Agent runs its own memory-maintainer Skill |
| Memory shape | Short `MEMORY.md` entry plus linked `notes/*.md` details |
| Channel availability | Channel is usable immediately; Agent readiness arrives later |
| Internal data | Coordinator decisions, inbox events, and memory events are persisted |

## Channel Creation And Joining

The create-channel dialog collects the channel name, description, and selected
Agents. The Agent selector is a multi-select list showing each Agent's avatar,
handle, role, runtime status, and short capability description.

On submit, the daemon persists:

- the channel
- selected channel members
- the channel's Coordinator configuration
- a channel-created event
- one `memory_update_requested` event per selected Agent

The channel becomes visible and usable immediately after the channel and
membership rows are saved. Agents do not need to finish memory synchronization
before the user can post messages.

Each selected Agent then starts a lightweight memory-maintainer run. The input
is structured channel facts, not raw markdown instructions:

```json
{
  "event": "joined_channel",
  "agent": "@alice-win",
  "channel": "#win-dev",
  "members": [
    {
      "handle": "@alice-win",
      "role": "研发团队架构师",
      "relationshipHints": ["需要技术方案、验收标准、架构判断时可咨询"]
    },
    {
      "handle": "@coda-win",
      "role": "开发工程师",
      "relationshipHints": ["方案明确后可进行编码实现"]
    },
    {
      "handle": "@qa-win",
      "role": "QA / 验收工程师",
      "relationshipHints": ["实现完成后可验收、设计回归测试"]
    }
  ]
}
```

The Agent's memory-maintainer Skill updates its document package in its own
voice. The system records the result as `memory_updated` or `memory_failed`.
After a successful update, the daemon sends a `channel_joined` inbox event to
the Agent. The Agent reads its current memory and posts a visible ready message
in the channel.

The member list can show these joining states:

- `joining`: membership saved, memory update not started
- `memory_syncing`: memory-maintainer run is active
- `ready`: memory updated and ready message posted
- `memory_failed`: memory update failed and can be retried
- `unavailable`: runtime cannot start the Agent

The Coordinator may only auto-assign new tasks to Agents in `ready` state.

## Agent Memory Package

Each Agent owns its memory package. The main file is stable and concise:

```md
# alice-win

## Role
研发团队架构师。负责与用户头脑风暴、确定技术方案、撰写验收标准和架构设计文档。

## Collaboration Constraints
- 我完成自己的阶段工作后，应根据 notes/relationships.md 判断是否需要 @ 其他 Agent。
- 如果我不确定应该交给谁，不要猜测；应说明不确定点并 @ 用户确认。
- 如果任务已经完成且不需要其他 Agent 参与，应 @ 用户验收。
- 如果任务涉及权限、危险操作或需求歧义，应先 @ 用户确认。

## Key Knowledge
- notes/team.md - 团队成员、职责、频道内角色
- notes/channels.md - 我加入的频道、频道规则、频道成员
- notes/relationships.md - 我和其他 Agent 的协作关系
- notes/preferences.md - 用户偏好、沟通限制、确认习惯
```

Detailed information lives in linked files:

- `notes/team.md`: team structure and roles
- `notes/channels.md`: channel roster, channel purpose, channel-level rules
- `notes/relationships.md`: Agent-to-Agent collaboration relationships
- `notes/preferences.md`: user preferences and stable constraints

`notes/relationships.md` describes relationships and handoff expectations, not
a fixed workflow engine:

```md
# Collaboration Relationships

## @coda-win
角色：开发工程师
我什么时候应该 @TA：
- 技术方案已经明确，需要编码实现
- 需要开发评估实现成本

TA 什么时候可能 @我：
- 实现遇到架构歧义
- 需要确认验收标准

## @qa-win
角色：QA / 验收工程师
我什么时候应该 @TA：
- 需要根据方案设计测试点
- 实现完成后需要验收
```

The database may keep relationship summaries and document hashes for search,
debugging, and context selection. It must not become the authoritative source
for downstream handoff decisions. The current Agent decides downstream mentions
from its injected memory context.

## Coordinator Decision Flow

Every channel message is first persisted, then offered to the channel
Coordinator. The Coordinator reads:

- current message body, author, attachments, and explicit mentions
- channel roster and member readiness
- channel purpose and policy
- recent relevant message window
- current channel summary
- related tasks
- Agent role, capability, and availability summaries

The Coordinator returns structured data. It does not return visible prose for
the channel.

Example:

```json
{
  "intent": "task_command",
  "action": "create_task_and_assign",
  "assigneeAgentId": "agent_alice_win",
  "reason": "The user requested implementation work that needs architecture first.",
  "contextPackage": {
    "currentMessageId": "msg_123",
    "channelSummaryRef": "summary_9",
    "relatedMessageIds": ["msg_119", "msg_120"],
    "expectedOutput": "Architecture plan, acceptance criteria, and visible next handoff if needed."
  }
}
```

Supported action classes:

- `archive_only`: persist and do not notify any Agent
- `update_channel_summary`: update summary or memory material only
- `notify_agent_observe`: let an Agent observe without requiring a reply
- `request_agent_reply`: ask one Agent to reply in the channel
- `create_task_and_assign`: create a task and assign one initial Agent
- `needs_manual_assignment`: create or mark an item that needs user choice
- `routing_failed`: record an internal failure without inventing a response

Explicit mentions are routed directly to mentioned Agents. The Coordinator may
still package context and persist a decision, but it should not override the
human's explicit target.

For messages without mentions:

- consultation intent routes to the most relevant ready Agent to reply in the
  channel
- command or delivery intent creates a task and assigns one initial ready Agent
- status, noise, or casual messages may only update summaries
- ambiguous messages should be handled conservatively as consultation unless
  they contain clear delivery language, responsibility, or output expectations

## Intent Skill

The Coordinator uses a channel-intent Skill to classify message intent. The
Skill should distinguish at least:

- `consultation`: asking for explanation, advice, options, or discussion
- `task_command`: asking for an implementation, change, investigation,
  document, test, review, or other deliverable
- `status_update`: reporting progress or state
- `handoff_or_mention`: explicitly asking another member to act
- `noise`: casual or non-actionable content
- `ambiguous`: insufficient confidence

The Skill returns structured confidence and reasoning. The Coordinator uses
that result plus member readiness and channel policy to choose an action.

## Task Creation And Initial Assignment

When the Coordinator chooses `create_task_and_assign`, the daemon creates:

- a task root linked to the source channel message
- an initial task thread
- a visible task card in the channel timeline
- an `agent_inbox_event` for the initial assignee
- a persisted Coordinator decision explaining why that Agent was selected

The task opens in the right-side task thread by default. The channel timeline
also keeps the task card as a durable entry point.

The Coordinator assigns one initial ready Agent only. It does not create a
multi-agent plan, assign downstream Agents, or silently continue the workflow.

If no suitable ready Agent exists, the task is created with
`needs_assignment`. The task card and thread show that user assignment is
needed.

## Task Handoff After Initial Assignment

After initial assignment, the current Agent owns downstream collaboration. The
system injects context, but it does not choose the next Agent.

The Agent receives:

- task root message
- Coordinator initial assignment reason
- task thread history
- related channel summary and a small relevant message window
- current channel roster and visible member status
- relevant `MEMORY.md` and `notes/*.md` snippets
- attachments and artifact references
- permission constraints

The Agent then decides whether to:

- finish and report in the task thread
- mention one or more Agents visibly with `@agent`
- ask the user for confirmation
- request approval for risky actions

Visible `@agent` mentions in a task thread create task-scoped inbox events for
the mentioned Agents. These events include the task context package and the
mentioning Agent's handoff message.

## Runtime Context Assembly

Agents should not receive full channel history. Runtime context is assembled
from scoped records:

- direct current prompt or handoff message
- task thread records for the current task
- channel records selected by relevance and recency
- channel and task summaries
- artifacts and attachment references
- Agent memory snippets chosen from the Agent's markdown package

This aligns with the existing worker direction of reconstructing provider
context from Slei-owned records and disabling provider transcript persistence.

## Persistence Model

The daemon and SQLite remain the authoritative local product store.

Visible collaboration data:

- `channels`
- `channel_members`
- `messages`
- `tasks`
- `task_replies`
- `artifacts`

Internal orchestration data:

- `channel_coordinators`
- `coordinator_decisions`
- `agent_inbox_events`
- `memory_update_events`
- `routing_context_packages`

Summary and context data:

- `channel_summaries`
- `task_summaries`
- `agent_context_records`

Agent document metadata:

- Agent `MEMORY.md` path
- `notes/*.md` paths
- document hash or version
- last update event id
- last update status and timestamp

The database stores internal events for recovery, debugging, and explanation.
Internal events are not shown in the ordinary channel timeline unless surfaced
through a diagnostic or status UI.

The markdown memory files remain the user-inspectable source for each Agent's
self-understanding.

## Deletion Semantics

When a user deletes a visible message, the message body must be removed from
visible storage and runtime context material. Only tombstone metadata remains.
Coordinator decisions and context packages that copied deleted body text must
clear that body text or retain only references to tombstoned ids.

Agent memory updates that incorporated deleted user content need a future
cleanup policy. For this design, memory update events must record source
message ids so later cleanup can identify affected notes.

## Error Handling

Channel creation succeeds once the channel and membership facts are saved.
Memory updates proceed asynchronously.

Memory update failure:

- member state becomes `memory_failed`
- user can retry the update
- Coordinator does not auto-assign tasks to that Agent until it is ready
- no failure chatter is posted to the channel by default

Coordinator failure:

- source message remains visible and persisted
- internal `routing_failed` event is recorded
- UI may show a small system status that routing needs manual handling
- no Agent response is fabricated

Initial assignment failure:

- task remains created with `needs_assignment`
- task card and thread make manual assignment available

Agent runtime failure:

- visible channel or task entry shows failed status when the Agent was expected
  to reply visibly
- internal failures for memory sync stay in member state and diagnostics

## UI Requirements

Channel creation:

- add Agent multi-select to the create-channel modal
- show Agent avatar, handle, role, runtime status, and short capability
- channel opens immediately after creation

Member readiness:

- show joining and memory readiness state in channel member surfaces
- allow retry for `memory_failed`

Channel timeline:

- do not show Coordinator messages
- show Agent ready messages after memory update
- show task cards when Coordinator creates tasks
- show lightweight routing failure status only when manual handling is needed

Task thread:

- automatically open after Coordinator-created tasks
- show source message, initial assignee, and assignment reason
- keep all later handoffs visible through `@agent` replies

Diagnostics:

- expose Coordinator decisions and inbox events in a debug or diagnostics
  surface, not the main timeline

## Testing Requirements

Focused tests should cover:

- channel creation persists selected members and creates memory update events
- channel is usable before Agent memory updates finish
- Agent ready message occurs only after `memory_updated`
- Coordinator classifies consultation intent without creating a task
- Coordinator creates and assigns a task for command intent
- Coordinator does not visibly post messages
- explicit `@agent` routes to the mentioned Agent without being overridden
- Coordinator assigns only ready Agents
- no ready Agent creates `needs_assignment`
- task-thread `@agent` creates task-scoped inbox events
- downstream task handoff is not auto-selected by the system
- deletion removes message body from runtime context packages
- internal decisions and inbox events are persisted but hidden from timeline

## Implementation Planning Notes

This spec spans daemon persistence, desktop UI, worker context assembly, and
Agent memory behavior. The implementation plan should be split into incremental
phases:

1. Persist channel members, Coordinator decisions, inbox events, and memory
   update events.
2. Add channel creation Agent selection and readiness states.
3. Add memory-maintainer run orchestration and ready messages.
4. Add Coordinator intent classification and structured decisions.
5. Add automatic task creation and initial assignment.
6. Add task-scoped mention inbox events and context packaging.
7. Add diagnostics and deletion cleanup for internal context packages.
