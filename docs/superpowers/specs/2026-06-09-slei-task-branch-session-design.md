# Slei Task Branch Session Design

## Goal

Make a Slei task behave like a focused branch session inside a channel chat.

When the user checks "转为任务", the channel timeline should keep only the task root entry and a compact reply-count affordance. Agent replies and follow-up commands should be collected inside the task drawer, not scattered through the outer channel. The drawer acts like the task's independent session: it shows task-scoped replies and has its own composer for issuing follow-up commands.

## Confirmed Product Decisions

- Outer channel mode: collapsed. The channel shows the task root and a "N 条回复" button; task replies do not appear as normal channel messages.
- First recipient: the channel coordinator. The coordinator decides assignment or marks the task as pending assignment.
- Session shape: one task has one main task session. Multiple agents can participate, but the UI presents one task thread.
- Completed tasks: users can continue replying after completion. A reply that requires work can reopen the task to in progress.
- Task states: only four states are needed.
  - `pending_assignment`: 待指派
  - `in_progress`: 进行中
  - `in_review`: 待评审
  - `done`: 已完成

## Current Code Context

The desktop app already has a local task-thread prototype:

- `apps/desktop/src/app/model.ts` has `createTaskFromChatMessage` and `appendTaskReply`.
- `apps/desktop/src/features/tasks/TasksPageView.tsx` renders task cards and a right-side thread drawer from local `SleiFixtures`.
- `apps/desktop/src/features/chat/ChatPageView.tsx` supports the "转为任务" checkbox and a channel task tab.
- `apps/desktop/src/features/chat/TaskRootCard.ts` and `ThreadPanel.ts` are lightweight render helpers for earlier tests.

The daemon already has the stronger foundation for the production shape:

- `crates/slei-daemon/src/services/task_service.rs` manages task roots, replies, idempotency, board queries, and thread context.
- `crates/slei-daemon/src/api/tasks.rs` exposes task create, reply, and thread endpoints.
- `crates/slei-daemon/src/services/channel_orchestrator_service.rs` creates coordinator-driven tasks, task cards, agent inbox events, and routing context packages.
- `crates/slei-storage/src/migrations.rs` already has `tasks`, `thread_replies`, `runtime_sessions`, `event_log`, and `agent_inbox_events`.

The design should therefore promote daemon task data to the source of truth instead of extending fixture-local task state.

## Architecture

Use daemon `TaskService` as the task thread source of truth.

The desktop app should treat tasks as daemon-backed entities. It may keep temporary optimistic UI state while sending, but persisted task roots, reply counts, thread replies, assignment, and status should come from daemon APIs.

The architecture has four layers:

1. Daemon task domain
   - Owns task records, task replies, idempotency, status changes, assignment, and task thread context.
   - Provides a complete task-thread view, not only the current `context` string.

2. Protocol and desktop bridge
   - Adds task commands such as `listTasks`, `getTaskThread`, `createTask`, `replyToTask`, and `updateTaskStatus`.
   - Maps daemon task records into desktop view models.

3. Desktop state and routing
   - Loads tasks from daemon for the active channel and tasks page.
   - Opens a right-side drawer for a selected `taskId`.
   - Refreshes task cards from daemon events, receipts, or polling.

4. UI components
   - `TaskRootEntry` in the channel timeline renders the task root, reply count, assignee, and status tag.
   - `TaskThreadDrawer` renders the task thread and composer.
   - `TaskComposer` submits task-scoped replies to `replyToTask(taskId, body)`.

## Data Model

Task summary view:

```ts
type TaskSummaryView = {
  id: string;
  channelId: string;
  sourceMessageId?: string;
  creatorId: string;
  assigneeId?: string;
  title: string;
  status: "pending_assignment" | "in_progress" | "in_review" | "done";
  attentionRequired: boolean;
  replyCount: number;
  updatedAt: string;
};
```

Task thread view:

```ts
type TaskThreadView = {
  task: TaskSummaryView;
  root: TaskThreadMessageView;
  replies: TaskThreadMessageView[];
};
```

Task thread message view:

```ts
type TaskThreadMessageView = {
  id: string;
  taskId: string;
  senderId: string;
  role: "human" | "agent" | "system";
  body: string;
  attachments?: ConversationAttachmentView[];
  runId?: string;
  status?: "pending" | "running" | "done" | "failed" | "approval";
  createdAt: string;
};
```

The existing storage table `thread_replies` can evolve toward this shape. The important product boundary is that task-thread messages are associated with `taskId`, not duplicated into the outer channel timeline.

## Persistence

Task persistence lives in the daemon storage layer.

Recommended persistent entities:

- `tasks`: task root, channel, source message, creator, assignee, title, four-state status, attention flag, timestamps.
- `task_replies` or evolved `thread_replies`: task-scoped messages with sender, role, body, attachments, run id, status, and timestamps.
- `runtime_sessions`: task-scoped runtime session rows keyed by `task_id`, with channel and agent scope where needed.
- `agent_inbox_events`: task assignment and task handoff events.
- `event_log`: task lifecycle events for UI refresh and diagnostics.
- `idempotent_mutations`: create/reply/status mutation dedupe.

Outer channel messages should not store copies of task replies. They only store the task root entry or `task_card` reference. The UI resolves current reply count and state through task summaries.

## Context Passing

Task execution context is assembled by the daemon from three sources.

Root context:

- Original user message and selected attachments.
- Channel id, channel name, project paths, and creator.
- Coordinator assignment reason.
- Initial assignee when one exists.

Thread context:

- The task root and task replies.
- Recent tool or runtime status entries associated with the task.
- A summary can be added later when the reply list grows large, but the first version can pass the bounded recent thread directly.

Safe channel context:

- Channel summary reference.
- Related source message ids.
- Participating channel members.
- Safe memory references already present in routing context packages.

Agent prompt construction should be task scoped. A worker receiving a task assignment should see the task title, status, channel, project paths, and task thread. It should not receive the full channel timeline by default.

## First Recipient

Task roots first go to the channel coordinator.

Flow:

1. User sends a channel message with "转为任务" checked.
2. Daemon creates or resolves the channel root message and task root.
3. The channel coordinator evaluates intent, channel members, readiness, and project context.
4. If a suitable agent exists, the task moves to `in_progress`, stores `assigneeId`, and creates a `task_assigned` inbox event.
5. If no suitable agent exists, the task remains `pending_assignment`, sets `attentionRequired=true`, and the outer task entry shows the pending-assignment tag.

Explicit mentions can help the coordinator choose an agent, but the route still passes through the coordinator so idempotency, readiness checks, and routing context remain centralized.

## Flow

Task creation:

1. User checks "转为任务" and sends in a channel.
2. Desktop calls a daemon-backed send/create path with `asTask=true`.
3. Daemon persists the root channel message and task.
4. Channel timeline shows one task root entry with reply count and status tag.

Assignment:

1. Coordinator decides whether an agent can own the task.
2. If assigned, daemon updates the task to `in_progress` and emits `task_assigned`.
3. If not assigned, daemon updates the task to `pending_assignment` and flags attention.

Agent execution:

1. Agent runner consumes `task_assigned` or `task_handoff`.
2. Runner creates or resumes the task runtime session using `taskId`.
3. Streaming progress, tool calls, approvals, failures, and final responses are written to task replies.
4. The outer channel does not receive these agent reply bodies.

Drawer conversation:

1. User clicks "N 条回复".
2. Desktop opens `TaskThreadDrawer` and calls `getTaskThread(taskId)`.
3. User types in the drawer composer.
4. Desktop calls `replyToTask(taskId, body)`.
5. If the reply mentions an agent, daemon emits `task_handoff`.
6. If there is no explicit agent and work is implied, daemon can ask the coordinator to route again.

Review and completion:

1. Agent result moves the task to `in_review`.
2. User confirms the result and marks the task `done`.
3. Done tasks remain replyable.
4. A later reply that asks for more work can move the task back to `in_progress`.

## Outer Channel Task Entry

The task root entry should replace scattered task replies in the channel timeline.

It should show:

- Task title.
- Creator and assignee when available.
- Reply count button, labeled like "N 条回复".
- Right-bottom status tag.
- Optional attention indicator when pending assignment needs user action.

Status tag colors:

- 待指派: amber
- 进行中: blue
- 待评审: violet
- 已完成: green

The entry should avoid rendering task reply bodies in the outer timeline.

## Error Handling

- Duplicate submit: all task create and reply mutations use idempotency keys.
- Missing task: drawer shows a not-found state and removes stale selection.
- Missing assignee: task stays `pending_assignment` with attention required.
- Runtime unavailable: task remains assigned or pending assignment, but the thread gets a system/status reply and the outer tag remains visible.
- Agent failure: failed run is written as a task reply with failed status, not as an outer channel message.
- Permission approval: approval cards in task runs are stored and rendered inside the task thread.

## Testing

Unit tests:

- Task status mapping supports only four states.
- Task summary maps daemon records to desktop view model.
- Task root entries render reply counts and status tags.
- Task-thread messages are filtered out of the outer channel timeline.

Daemon tests:

- Creating a task persists `pending_assignment` first.
- Coordinator assignment updates task to `in_progress`.
- No suitable agent leaves task `pending_assignment` with attention required.
- Agent reply with `taskId` appends to task replies and not channel messages.
- Reply idempotency prevents duplicate thread messages.

Desktop integration tests:

- Sending with "转为任务" creates a collapsed task entry in the channel.
- Clicking "N 条回复" opens the right drawer.
- Drawer composer appends a task-scoped reply.
- Agent response appears in the drawer and not in the outer timeline.
- Pending-assignment task shows the right-bottom status tag.

## Open Implementation Notes

- Existing local fixture helpers can remain for tests, but production behavior should flow through daemon task APIs.
- `TaskService::thread_context` should be supplemented by a richer thread view endpoint before the desktop drawer depends on daemon persistence.
- `ChannelMessageView(kind="task_card")` currently gets filtered out in `channelMessageToSleiMessage`; the desktop should instead convert it into a task root entry.
- The current task statuses in front-end fixtures and task board include extra states. They should be narrowed to the four confirmed states during implementation.
