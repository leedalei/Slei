# Slei Task Branch Session Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build daemon-backed task branch sessions where channel tasks render as collapsed root entries and all task replies, including Agent output, live inside a right-side task drawer.

**Architecture:** Promote daemon `TaskService` to the source of truth for task summaries, status, and thread messages. Wire task APIs through the Tauri/desktop bridge, render channel `task_card` messages as task root entries, and adapt the existing desktop Agent runtime path so assigned or handed-off Agent replies are persisted with `taskId` instead of appended to the outer channel timeline.

**Tech Stack:** Rust daemon services/API with Axum tests, Tauri command/broker bridge, TypeScript React 19 desktop UI, Vitest SSR/e2e-style component tests, shadcn/Radix Sheet, lucide-react icons.

---

## Source Documents

- Spec: `docs/superpowers/specs/2026-06-09-slei-task-branch-session-design.md`
- Prior local prototype plan: `docs/superpowers/plans/2026-05-29-slei-task-thread-flow.md`
- Relevant knowledge: `docs/knowledge/best-practices/task-thread-stable-ids-and-reply-roles-20260529.md`

## Scope Boundary

This plan implements the first shippable task-branch session.

It does not wire the daemon `/v1/runs` endpoint or a background daemon runner, because `crates/slei-daemon/src/api/runs.rs` is currently a not-implemented stub. Instead, it keeps using the existing desktop Agent DM runtime path from `apps/desktop/src/app/SleiApp.tsx`, but changes task-assigned and task-handoff output to call `replyToTask(taskId, ...)`. This preserves the product requirement that Agent replies do not appear in the outer channel and keeps the work buildable.

Task reply routing rule for this first version:

- Explicit `@agent` in the task drawer creates a task handoff to that agent.
- A work-like reply without an explicit mention reopens the task to `in_progress` when the task already has an assignee; otherwise it sets `pending_assignment` and `attentionRequired`.
- Plain comments simply append to the task thread.

## File Structure

### Daemon Domain And API

- Modify `crates/slei-daemon/src/services/task_service.rs`
  - Four-state `TaskStatus`.
  - Add task root body, reply timestamps/status, reply count, and richer `TaskThreadView`.
  - Add `list_task_summaries`, `thread_view`, and `update_status`.

- Modify `crates/slei-daemon/src/services/channel_orchestrator_service.rs`
  - Ensure coordinator-created tasks start as `in_progress` only when assigned, otherwise `pending_assignment`.
  - Return task reply routing outcome with handoff agent ids.
  - Reopen done tasks or mark pending assignment based on drawer replies.

- Modify `crates/slei-daemon/src/api/tasks.rs`
  - Add `GET /v1/tasks`.
  - Return rich `thread` view from `GET /v1/tasks/{id}/thread`.
  - Add `PATCH /v1/tasks/{id}/status`.
  - Return reply route metadata from `POST /v1/tasks/{id}/replies`.

- Modify `crates/slei-daemon/src/app.rs`
  - Register new task routes.

- Test `crates/slei-daemon/tests/task_api.rs`
  - API coverage for list/thread/status/reply route metadata.

- Test `crates/slei-daemon/tests/task_board.rs`
  - Four status columns only.

- Test `crates/slei-daemon/tests/channel_orchestration_flow.rs`
  - Coordinator assignment and manual assignment status behavior.

### Protocol And Desktop Bridge

- Modify `packages/protocol-client/src/contracts.ts`
  - Add `asTask` to channel sends so checking "转为任务" forces task creation instead of relying on text inference.
  - Add task status, task summary, task thread, task reply request/receipt, task status request/receipt contracts.

- Modify `packages/protocol-client/src/contracts.test.ts`
  - Assert the new task contracts.

- Modify `apps/desktop/src/lib/daemon-bridge.ts`
  - Add `asTask` to `SendChannelMessageRequest`.
  - Add TypeScript task bridge types and methods.
  - Add mock task storage fallback.
  - Add Tauri `invoke` calls for task commands.

- Modify `apps/desktop/src-tauri/src/daemon_broker.rs`
  - Add `as_task` to `SendChannelMessageRequest`.
  - Add Rust task view/request/receipt structs.
  - Add local fallback task store.
  - Add daemon HTTP calls for task endpoints.

- Modify `apps/desktop/src-tauri/src/commands.rs`
  - Add command wrappers for `list_tasks`, `get_task_thread`, `reply_to_task`, `update_task_status`.

- Modify `apps/desktop/src-tauri/src/lib.rs`
  - Register the new Tauri commands.
  - Add broker command tests.

### Desktop Models And State

- Modify `apps/desktop/src/app/fixtures.ts`
  - Change `SleiTask` to four task statuses.
  - Add `replyCount`, `creatorId`, `assigneeId`, `attentionRequired`, and optional `thread`.
  - Keep fixture `replies` only for SSR tests and mock mode.

- Modify `apps/desktop/src/app/model.ts`
  - Replace local task helpers with daemon-view helpers.
  - Add `taskStatusLabelKey`, `taskStatusClassName`, `parseTaskCardBody`, and `taskRequiresWork`.

- Modify `apps/desktop/src/app/SleiApp.tsx`
  - Load tasks from daemon bridge.
  - Refresh daemon tasks on initial active-channel load and active channel changes.
  - Convert `task_card` channel messages into task root entries.
  - Filter source human messages when a matching task card exists.
  - Add `handleTaskReply`, `handleTaskStatusChange`, and `runTaskAgentReply`.
  - Use `replyToTask` for all task drawer replies and task Agent output.

- Modify `apps/desktop/src/app/SleiAppFrame.tsx`
  - Pass task thread handlers into chat/tasks routes.

### Desktop UI

- Create `apps/desktop/src/features/tasks/TaskStatusBadge.tsx`
  - Shared four-state status badge.

- Create `apps/desktop/src/features/tasks/TaskThreadDrawer.tsx`
  - Shared right-side drawer, reply list, status actions, and composer.

- Create `apps/desktop/src/features/chat/TaskRootEntry.tsx`
  - Collapsed channel task root entry with "N 条回复" button and bottom-right status tag.

- Modify `apps/desktop/src/features/chat/ChatPageView.tsx`
  - Render `TaskRootEntry` in the chat timeline.
  - Open `TaskThreadDrawer` from channel task root entries.
  - Hide task-thread replies from the outer channel.

- Modify `apps/desktop/src/features/tasks/TasksPageView.tsx`
  - Reuse `TaskStatusBadge` and `TaskThreadDrawer`.
  - Use `replyCount` instead of `task.replies?.length` for task cards.

- Modify `apps/desktop/src/features/tasks/types.ts`, `TaskCard.ts`, `BoardView.ts`, `ListView.ts`
  - Narrow string-render helper statuses to the four confirmed task statuses.

- Modify `apps/desktop/src/i18n/types.ts`
  - Add task drawer/status strings.

- Modify `apps/desktop/src/i18n/messages/zh-CN/tasks.ts`
  - Add `pending_assignment`, reply count, status actions, and drawer strings.

- Modify `apps/desktop/src/i18n/messages/en-US/tasks.ts`
  - Add matching English strings.

### Desktop Tests

- Add `apps/desktop/e2e/task-branch-session.spec.tsx`
  - Collapsed task root entry.
  - Drawer reply flow.
  - Agent output appears inside task drawer only.
  - Pending assignment status tag.

- Modify `apps/desktop/e2e/task-thread-flow.spec.tsx`
  - Update old local-task expectations to four statuses and daemon-shaped view models.

- Modify `apps/desktop/e2e/channel-embedded-views.spec.tsx`
  - Update status text and reply count assumptions.

---

## Task 1: Daemon Four-State Task Model And Thread View

**Files:**
- Modify: `crates/slei-daemon/src/services/task_service.rs`
- Test: `crates/slei-daemon/tests/task_board.rs`
- Test: `crates/slei-daemon/tests/task_api.rs`
- Test: `crates/slei-daemon/tests/task_service.rs`

- [ ] **Step 1: Update failing board test for four statuses**

In `crates/slei-daemon/tests/task_board.rs`, change the status expectation to four statuses only and add a pending assignment assertion:

```rust
assert_eq!(
    board
        .columns
        .iter()
        .map(|column| column.status)
        .collect::<Vec<_>>(),
    vec![
        TaskStatus::PendingAssignment,
        TaskStatus::InProgress,
        TaskStatus::InReview,
        TaskStatus::Done,
    ]
);
assert_eq!(board.column(TaskStatus::PendingAssignment).unwrap().tasks.len(), 1);
```

- [ ] **Step 2: Run board test to verify it fails**

Run:

```bash
cargo test -p slei-daemon --test task_board
```

Expected: FAIL because `PendingAssignment` does not exist and `Closed` is still present.

- [ ] **Step 3: Write failing thread-view API test**

In `crates/slei-daemon/tests/task_api.rs`, extend `task_api_creates_roots_and_appends_thread_replies`:

```rust
assert_eq!(json["task"]["status"], "pending_assignment");

// after posting a reply and reading /thread:
assert_eq!(json["thread"]["task"]["id"], task_id);
assert_eq!(json["thread"]["task"]["replyCount"], 1);
assert_eq!(json["thread"]["root"]["role"], "human");
assert_eq!(json["thread"]["root"]["body"], "把任务 Thread 做完");
assert_eq!(json["thread"]["replies"][0]["body"], "我会继续在这个任务 session 里处理");
```

- [ ] **Step 4: Run task API test to verify it fails**

Run:

```bash
cargo test -p slei-daemon --test task_api task_api_creates_roots_and_appends_thread_replies
```

Expected: FAIL because `/thread` returns `taskId/replyCount/context`, not a rich thread view.

- [ ] **Step 5: Implement four-state enum**

In `crates/slei-daemon/src/services/task_service.rs`, replace `TaskStatus` with:

```rust
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TaskStatus {
    PendingAssignment,
    InProgress,
    InReview,
    Done,
}
```

Add:

```rust
impl TaskStatus {
    pub fn columns() -> [TaskStatus; 4] {
        [
            TaskStatus::PendingAssignment,
            TaskStatus::InProgress,
            TaskStatus::InReview,
            TaskStatus::Done,
        ]
    }
}
```

- [ ] **Step 6: Add rich task view structs**

In `task_service.rs`, add:

```rust
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskSummaryView {
    pub id: String,
    pub channel_id: String,
    pub creator_id: String,
    pub assignee_id: Option<String>,
    pub source_message_id: Option<String>,
    pub title: String,
    pub status: TaskStatus,
    pub attention_required: bool,
    pub reply_count: usize,
    pub updated_at: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskThreadMessage {
    pub id: String,
    pub task_id: String,
    pub sender_id: String,
    pub role: String,
    pub body: String,
    pub status: Option<String>,
    pub created_at: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskThreadView {
    pub task: TaskSummaryView,
    pub root: TaskThreadMessage,
    pub replies: Vec<TaskThreadMessage>,
}
```

- [ ] **Step 7: Extend records with root body and timestamps**

In `TaskRecord`, add:

```rust
pub root_body: String,
pub updated_at: String,
```

In `TaskReply`, add:

```rust
pub status: Option<String>,
pub created_at: String,
```

Use `Uuid::new_v4()` ids as existing code does, and use a small helper:

```rust
fn now_string() -> String {
    chrono::Utc::now().to_rfc3339()
}
```

If `chrono` is not already in this crate, avoid adding a dependency and use:

```rust
fn now_string() -> String {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .to_string()
}
```

- [ ] **Step 8: Update task creation defaults**

In `create_task_root`, create unassigned manual tasks as:

```rust
status: TaskStatus::PendingAssignment,
needs_assignment: true,
attention_required: true,
root_body: title.to_string(),
updated_at: now.clone(),
```

In `create_from_coordinator`, use:

```rust
let has_assignee = assignee_id.is_some();
status: if has_assignee { TaskStatus::InProgress } else { TaskStatus::PendingAssignment },
needs_assignment: !has_assignee,
attention_required: !has_assignee,
root_body: title.to_string(),
updated_at: now.clone(),
```

Update `TaskService::assign` so manual assignment moves the task out of `pending_assignment`:

```rust
task.needs_assignment = assignee_id.is_none();
task.attention_required = assignee_id.is_none();
task.status = if assignee_id.is_some() {
    TaskStatus::InProgress
} else {
    TaskStatus::PendingAssignment
};
task.assignee_id = assignee_id;
task.updated_at = now_string();
```

This keeps the four-state model consistent for manually assigned tasks and existing board tests that call `assign(... Some(agent))`.

- [ ] **Step 9: Add summary and thread methods**

In `TaskService`, add:

```rust
pub async fn list_task_summaries(&self, query: TaskQuery) -> Vec<TaskSummaryView> {
    let state = self.inner.lock().expect("task state lock");
    let mut summaries = state.tasks.values()
        .filter(|task| !task.root_deleted)
        .filter(|task| query.channel_id.as_ref().is_none_or(|id| task.channel_id == *id))
        .filter(|task| query.creator_id.as_ref().is_none_or(|id| task.creator_id == *id))
        .filter(|task| query.assignee_id.as_ref().is_none_or(|id| task.assignee_id.as_ref() == Some(id)))
        .map(|task| summary_for(&state, task))
        .collect::<Vec<_>>();
    summaries.sort_by(|left, right| right.updated_at.cmp(&left.updated_at).then(left.id.cmp(&right.id)));
    summaries
}

pub async fn thread_view(&self, task_id: &str) -> Result<TaskThreadView, TaskError> {
    let state = self.inner.lock().expect("task state lock");
    let task = state.tasks.get(task_id).ok_or(TaskError::TaskNotFound)?;
    let replies = state.replies.get(task_id).cloned().unwrap_or_default();
    Ok(TaskThreadView {
        task: summary_for(&state, task),
        root: TaskThreadMessage {
            id: format!("root_{}", task.id),
            task_id: task.id.clone(),
            sender_id: task.creator_id.clone(),
            role: role_for_sender(&task.creator_id).unwrap_or_else(|| "human".to_string()),
            body: task.root_body.clone(),
            status: Some("done".to_string()),
            created_at: task.updated_at.clone(),
        },
        replies: replies
            .into_iter()
            .map(|reply| thread_message_for_reply(&task.id, reply))
            .collect(),
    })
}
```

Implement `summary_for` and expose `thread_message_for_reply` for orchestrator receipts:

```rust
pub(crate) fn thread_message_for_reply(task_id: &str, reply: TaskReply) -> TaskThreadMessage {
    TaskThreadMessage {
        id: reply.id,
        task_id: task_id.to_string(),
        sender_id: reply.sender_id,
        role: reply.role.unwrap_or_else(|| "human".to_string()),
        body: reply.body,
        status: reply.status,
        created_at: reply.created_at,
    }
}
```

- [ ] **Step 10: Update board and delete logic**

Use `TaskStatus::columns()` in `board`.

Change `delete_task_root` to allow only `TaskStatus::Done` deletion or keep deletion blocked for all non-done tasks:

```rust
if task.status != TaskStatus::Done {
    return Err(TaskError::ActiveTaskRootDeletionBlocked);
}
```

In `crates/slei-daemon/tests/task_service.rs`, replace the old `TaskStatus::Closed` deletion setup with `TaskStatus::Done` or update the assertion to match the chosen non-done deletion rule. There should be no `TaskStatus::Closed` references after this task.

- [ ] **Step 11: Run daemon task tests**

Run:

```bash
cargo test -p slei-daemon --test task_board
cargo test -p slei-daemon --test task_api
```

Expected: PASS.

- [ ] **Step 12: Commit daemon task model**

```bash
git add crates/slei-daemon/src/services/task_service.rs crates/slei-daemon/tests/task_board.rs crates/slei-daemon/tests/task_api.rs crates/slei-daemon/tests/task_service.rs
git commit -m "feat: add daemon task thread views"
```

---

## Task 2: Daemon Task API, Status Updates, And Reply Routing Metadata

**Files:**
- Modify: `crates/slei-daemon/src/api/tasks.rs`
- Modify: `crates/slei-daemon/src/api/messages.rs`
- Modify: `crates/slei-daemon/src/app.rs`
- Modify: `crates/slei-daemon/src/services/channel_orchestrator_service.rs`
- Test: `crates/slei-daemon/tests/task_api.rs`
- Test: `crates/slei-daemon/tests/channel_orchestration_flow.rs`

- [ ] **Step 1: Write failing task list/status API tests**

In `crates/slei-daemon/tests/task_api.rs`, add:

```rust
#[tokio::test]
async fn task_api_lists_tasks_and_updates_status() {
    let token = AuthToken::from_static("test-token");
    let app = build_router(AppState::for_tests(token.clone()));

    let created = app.clone().oneshot(
        Request::builder()
            .method("POST")
            .uri("/v1/tasks")
            .header("authorization", token.authorization_header())
            .header("content-type", "application/json")
            .header("idempotency-key", "task-list-create")
            .body(Body::from(json!({
                "channelId": "all",
                "creatorId": "human:local",
                "title": "实现任务分支"
            }).to_string()))
            .unwrap(),
    ).await.unwrap();
    let body = to_bytes(created.into_body(), usize::MAX).await.unwrap();
    let task_id = serde_json::from_slice::<Value>(&body).unwrap()["task"]["id"].as_str().unwrap().to_string();

    let listed = app.clone().oneshot(
        Request::builder()
            .uri("/v1/tasks?channelId=all")
            .header("authorization", token.authorization_header())
            .body(Body::empty())
            .unwrap(),
    ).await.unwrap();
    let body = to_bytes(listed.into_body(), usize::MAX).await.unwrap();
    let json: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["tasks"][0]["id"], task_id);
    assert_eq!(json["tasks"][0]["status"], "pending_assignment");

    let updated = app.oneshot(
        Request::builder()
            .method("PATCH")
            .uri(format!("/v1/tasks/{task_id}/status"))
            .header("authorization", token.authorization_header())
            .header("content-type", "application/json")
            .body(Body::from(json!({ "status": "done" }).to_string()))
            .unwrap(),
    ).await.unwrap();
    assert_eq!(updated.status(), StatusCode::OK);
}
```

- [ ] **Step 2: Write failing explicit asTask channel-send test**

In `crates/slei-daemon/tests/channel_orchestration_flow.rs`, add or extend a public channel message API test so a message without task keywords still creates a task when `asTask` is true:

```rust
let response = app
    .clone()
    .oneshot(
        Request::builder()
            .method("POST")
            .uri("/v1/channels/dev/messages")
            .header("authorization", token.authorization_header())
            .header("content-type", "application/json")
            .header("idempotency-key", "explicit-as-task")
            .body(Body::from(json!({
                "authorId": "human_lei",
                "body": "这是一条需要单独收敛的讨论",
                "asTask": true
            }).to_string()))
            .unwrap(),
    )
    .await
    .unwrap();
let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
let json: Value = serde_json::from_slice(&body).unwrap();
assert_eq!(json["outcome"]["action"], "needs_manual_assignment");
assert!(json["outcome"]["taskId"].as_str().is_some());
```

Add a second assertion for explicit mentions so the checkbox semantics do not regress into outer-channel replies:

```rust
let response = app
    .clone()
    .oneshot(
        Request::builder()
            .method("POST")
            .uri("/v1/channels/dev/messages")
            .header("authorization", token.authorization_header())
            .header("content-type", "application/json")
            .header("idempotency-key", "explicit-as-task-with-mention")
            .body(Body::from(json!({
                "authorId": "human_lei",
                "body": "@agent_coda 这也要收敛成任务",
                "asTask": true
            }).to_string()))
            .unwrap(),
    )
    .await
    .unwrap();
let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
let json: Value = serde_json::from_slice(&body).unwrap();
assert_eq!(json["outcome"]["action"], "create_task_and_assign");
assert_eq!(json["outcome"]["assigneeAgentId"], "agent_coda");
assert!(json["outcome"]["taskId"].as_str().is_some());
```

- [ ] **Step 3: Write failing reply routing test**

In `task_api_reply_routes_mentions_through_orchestrator_once_per_idempotency_key`, assert the reply receipt includes route metadata:

```rust
assert_eq!(json["route"]["handoffAgentIds"][0], "agent_coda");
```

- [ ] **Step 4: Run tests to verify failure**

Run:

```bash
cargo test -p slei-daemon --test task_api
```

Expected: FAIL because routes/response fields do not exist.

- [ ] **Step 5: Add API request/response structs**

In `crates/slei-daemon/src/api/tasks.rs`, add:

```rust
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskListQuery {
    channel_id: Option<String>,
    creator_id: Option<String>,
    assignee_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateTaskStatusRequest {
    status: TaskStatus,
}
```

Import `axum::extract::Query` and `TaskStatus`.

- [ ] **Step 6: Add `asTask` to channel message API**

In `crates/slei-daemon/src/api/messages.rs`, update `SendChannelMessageRequest`:

```rust
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendChannelMessageRequest {
    author_id: String,
    body: String,
    #[serde(default)]
    as_task: bool,
}
```

Pass `as_task` into `SendChannelMessageInput`.

In `crates/slei-daemon/src/services/channel_orchestrator_service.rs`, add `pub as_task: bool` to `SendChannelMessageInput`. In the decision path, force task intent whenever `input.as_task` is true. This must override `request_agent_reply`, `archive_only`, and consultation-style decisions so checked channel messages never produce outer-channel Agent replies.

```rust
let decision = if input.as_task {
    let assignee_agent_id = decision
        .assignee_agent_id
        .clone()
        .or_else(|| explicit_agent_ids.first().cloned());
    let action = if assignee_agent_id.is_some() {
        "create_task_and_assign"
    } else {
        "needs_manual_assignment"
    };
    ResolvedCoordinatorDecision {
        action: action.to_string(),
        assignee_agent_id,
        reason: "user explicitly converted message to task".to_string(),
        ..decision
    }
} else {
    decision
};
```

If the existing `ResolvedCoordinatorDecision` cannot use struct update because of ownership, build the replacement explicitly. The match that follows should route `create_task_and_assign` and `needs_manual_assignment` through task creation, never through `request_agent_reply`, when `as_task` is true.

- [ ] **Step 7: Add list and status handlers**

Add:

```rust
pub async fn list(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<TaskListQuery>,
) -> Response {
    if !state.auth_token.is_authorized(&headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let tasks = state.tasks().list_task_summaries(TaskQuery {
        channel_id: query.channel_id,
        creator_id: query.creator_id,
        assignee_id: query.assignee_id,
    }).await;
    Json(json!({ "tasks": tasks })).into_response()
}

pub async fn update_status(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
    Json(payload): Json<UpdateTaskStatusRequest>,
) -> Response {
    if !state.auth_token.is_authorized(&headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    match state.tasks().update_status(&id, payload.status).await {
        Ok(()) => match state.tasks().task_summary(&id).await {
            Ok(task) => Json(json!({ "task": task })).into_response(),
            Err(error) => task_error_response(error),
        },
        Err(error) => task_error_response(error),
    }
}
```

If `task_summary` does not exist yet, add it to `TaskService` as a thin wrapper around `summary_for`. Status create/update/list responses should return `TaskSummaryView`, not raw `TaskRecord`.

- [ ] **Step 8: Return rich thread view**

Change `thread` handler to:

```rust
match state.tasks().thread_view(&id).await {
    Ok(thread) => Json(json!({ "thread": thread })).into_response(),
    Err(error) => task_error_response(error),
}
```

- [ ] **Step 9: Add reply route metadata in orchestrator**

In `channel_orchestrator_service.rs`, introduce:

```rust
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskReplyRoute {
    pub handoff_agent_ids: Vec<String>,
    pub needs_assignment: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskReplyReceipt {
    pub reply: TaskThreadMessage,
    pub route: TaskReplyRoute,
}
```

Change `add_task_reply` to return `TaskReplyReceipt`.

- [ ] **Step 10: Implement drawer reply routing**

In `add_task_reply`, collect explicit handoff ids and update status:

```rust
let mut handoff_agent_ids = Vec::new();
for agent_id in explicit_agent_ids {
    if let Some(readiness) = readiness_by_agent.get(&agent_id) {
        self.create_task_handoff_once(
            &agent_id,
            &task.channel_id,
            &task.id,
            &reply.id,
            &reply.sender_id,
            &reply.body,
            readiness.clone(),
        )
        .await;
        handoff_agent_ids.push(agent_id.clone());
        self.tasks.update_status(&task.id, TaskStatus::InProgress).await?;
    }
}

if handoff_agent_ids.is_empty() && reply_requires_work(&reply.body) {
    if let Some(agent_id) = task.assignee_id.as_deref() {
        if let Some(readiness) = readiness_by_agent.get(agent_id) {
            self.create_task_handoff_once(
                agent_id,
                &task.channel_id,
                &task.id,
                &reply.id,
                &reply.sender_id,
                &reply.body,
                readiness.clone(),
            )
            .await;
            handoff_agent_ids.push(agent_id.to_string());
            self.tasks.update_status(&task.id, TaskStatus::InProgress).await?;
        }
    } else {
        self.tasks.update_status(&task.id, TaskStatus::PendingAssignment).await?;
        self.tasks.set_attention_required(&task.id, true).await?;
    }
}
```

Use a private helper:

```rust
fn reply_requires_work(body: &str) -> bool {
    ["实现", "修复", "检查", "整理", "创建", "改一下", "写一个", "生成", "调查", "验证", "继续"]
        .iter()
        .any(|marker| body.contains(marker))
}
```

When returning from `add_task_reply`, convert the internal reply before building the receipt:

```rust
use crate::services::task_service::thread_message_for_reply;

let public_reply = thread_message_for_reply(&reply_outcome.task_id, reply);
let needs_assignment = handoff_agent_ids.is_empty()
    && task.assignee_id.is_none()
    && reply_requires_work(&public_reply.body);
Ok(TaskReplyReceipt {
    reply: public_reply,
    route: TaskReplyRoute {
        handoff_agent_ids,
        needs_assignment,
    },
})
```

- [ ] **Step 11: Update task reply API response**

In `api/tasks.rs`, return:

```rust
Ok(receipt) => (StatusCode::CREATED, Json(json!({
    "reply": receipt.reply,
    "route": receipt.route
}))).into_response(),
```

The `reply` field must be the public `TaskThreadMessage` shape with `taskId` and `createdAt`, not the internal `TaskReply` shape.

- [ ] **Step 12: Register routes**

In `crates/slei-daemon/src/app.rs`, change task routes to:

```rust
.route("/v1/tasks", get(api::tasks::list).post(api::tasks::create))
.route("/v1/tasks/{id}/replies", post(api::tasks::reply))
.route("/v1/tasks/{id}/thread", get(api::tasks::thread))
.route("/v1/tasks/{id}/status", patch(api::tasks::update_status))
```

Add `patch` import if needed.

- [ ] **Step 13: Run daemon API/orchestration tests**

Run:

```bash
cargo test -p slei-daemon --test task_api
cargo test -p slei-daemon --test channel_orchestration_flow
```

Expected: PASS.

- [ ] **Step 14: Commit daemon API**

```bash
git add crates/slei-daemon/src/api/tasks.rs crates/slei-daemon/src/api/messages.rs crates/slei-daemon/src/app.rs crates/slei-daemon/src/services/channel_orchestrator_service.rs crates/slei-daemon/tests/task_api.rs crates/slei-daemon/tests/channel_orchestration_flow.rs
git commit -m "feat: expose task branch API"
```

---

## Task 3: Protocol, Tauri, And Desktop Bridge Task APIs

**Files:**
- Modify: `packages/protocol-client/src/contracts.ts`
- Modify: `packages/protocol-client/src/contracts.test.ts`
- Modify: `apps/desktop/src/lib/daemon-bridge.ts`
- Modify: `apps/desktop/src-tauri/src/daemon_broker.rs`
- Modify: `apps/desktop/src-tauri/src/commands.rs`
- Modify: `apps/desktop/src-tauri/src/lib.rs`

- [ ] **Step 1: Write failing protocol contract tests**

In `packages/protocol-client/src/contracts.test.ts`, add:

```ts
test("exposes task branch contracts", () => {
  const channelRequest = {
    authorId: "human_lei",
    body: "请转成任务但正文不含动词",
    asTask: true,
  } satisfies SendChannelMessageRequest;
  const task = {
    id: "task_1",
    channelId: "all",
    creatorId: "human:local",
    title: "实现任务分支",
    status: "pending_assignment",
    attentionRequired: true,
    replyCount: 0,
    updatedAt: "1",
  } satisfies TaskSummaryView;
  const thread = {
    task,
    root: { id: "root_task_1", taskId: "task_1", senderId: "human:local", role: "human", body: "实现任务分支", createdAt: "1" },
    replies: [],
  } satisfies TaskThreadView;
  const receipt = {
    reply: { id: "reply_1", taskId: "task_1", senderId: "human:local", role: "human", body: "@coda 继续", createdAt: "2" },
    route: { handoffAgentIds: ["agent_coda"], needsAssignment: false },
  } satisfies TaskReplyReceipt;

  expect(channelRequest.asTask).toBe(true);
  expect(thread.task.status).toBe("pending_assignment");
  expect(receipt.route.handoffAgentIds).toEqual(["agent_coda"]);
});
```

Import the new types.

- [ ] **Step 2: Run protocol test to verify it fails**

Run:

```bash
pnpm --filter @slei/protocol-client test
```

Expected: FAIL because the new types do not exist.

- [ ] **Step 3: Add protocol task contracts**

In `packages/protocol-client/src/contracts.ts`, add:

```ts
export interface SendChannelMessageRequest {
  authorId: string;
  body: string;
  asTask?: boolean;
}

export type TaskStatus = "pending_assignment" | "in_progress" | "in_review" | "done";

export interface TaskSummaryView {
  id: string;
  channelId: string;
  creatorId: string;
  assigneeId?: string;
  sourceMessageId?: string;
  title: string;
  status: TaskStatus;
  attentionRequired: boolean;
  replyCount: number;
  updatedAt: string;
}

export interface TaskThreadMessageView {
  id: string;
  taskId: string;
  senderId: string;
  role: "human" | "agent" | "system" | string;
  body: string;
  status?: string;
  createdAt: string;
}

export interface TaskThreadView {
  task: TaskSummaryView;
  root: TaskThreadMessageView;
  replies: TaskThreadMessageView[];
}

export interface TaskReplyRequest {
  senderId: string;
  body: string;
}

export interface TaskReplyRoute {
  handoffAgentIds: string[];
  needsAssignment: boolean;
}

export interface TaskReplyReceipt {
  reply: TaskThreadMessageView;
  route: TaskReplyRoute;
}
```

- [ ] **Step 4: Add desktop bridge TypeScript types**

In `apps/desktop/src/lib/daemon-bridge.ts`, add equivalent exported types:

```ts
export type SendChannelMessageRequest = {
  authorId: string;
  body: string;
  asTask?: boolean;
};
export type TaskStatusView = "pending_assignment" | "in_progress" | "in_review" | "done";
export type TaskSummaryView = {
  id: string;
  channelId: string;
  creatorId: string;
  assigneeId?: string;
  sourceMessageId?: string;
  title: string;
  status: TaskStatusView;
  attentionRequired: boolean;
  replyCount: number;
  updatedAt: string;
};
export type TaskThreadMessageView = {
  id: string;
  taskId: string;
  senderId: string;
  role: "human" | "agent" | "system" | string;
  body: string;
  status?: string;
  createdAt: string;
};
export type TaskThreadView = {
  task: TaskSummaryView;
  root: TaskThreadMessageView;
  replies: TaskThreadMessageView[];
};
export type TaskListReceipt = { tasks: TaskSummaryView[] };
export type TaskThreadReceipt = { thread: TaskThreadView };
export type TaskReplyRequest = { senderId: string; body: string };
export type TaskReplyRoute = { handoffAgentIds: string[]; needsAssignment: boolean };
export type TaskReplyReceipt = { reply: TaskThreadMessageView; route: TaskReplyRoute };
export type TaskStatusUpdateRequest = { status: TaskStatusView };
export type TaskReceipt = { task: TaskSummaryView };
```

- [ ] **Step 5: Extend `DaemonBridge`**

Add methods:

```ts
listTasks(query?: { channelId?: string; creatorId?: string; assigneeId?: string }): Promise<TaskListReceipt>;
getTaskThread(taskId: string): Promise<TaskThreadReceipt>;
replyToTask(taskId: string, request: TaskReplyRequest): Promise<TaskReplyReceipt>;
updateTaskStatus(taskId: string, request: TaskStatusUpdateRequest): Promise<TaskReceipt>;
```

- [ ] **Step 6: Add Tauri invokes**

In `createDaemonBridge`, add:

```ts
listTasks: (query = {}) => invoke<TaskListReceipt>("list_tasks_command", { query }),
getTaskThread: (taskId: string) => invoke<TaskThreadReceipt>("get_task_thread_command", { taskId }),
replyToTask: (taskId: string, request: TaskReplyRequest) => invoke<TaskReplyReceipt>("reply_to_task_command", { taskId, request }),
updateTaskStatus: (taskId: string, request: TaskStatusUpdateRequest) => invoke<TaskReceipt>("update_task_status_command", { taskId, request }),
```

- [ ] **Step 7: Add mock bridge fallback**

In `createDaemonBridgeMock`, add a local `tasks` array and `taskThreads` map. Implement methods minimally:

```ts
async listTasks(query = {}) {
  return { tasks: tasks.filter((task) => !query.channelId || task.channelId === query.channelId) };
},
async getTaskThread(taskId) {
  const thread = taskThreads.get(taskId);
  if (!thread) throw new Error("task not found");
  return { thread };
},
async replyToTask(taskId, request) {
  const thread = taskThreads.get(taskId);
  if (!thread) throw new Error("task not found");
  const reply = { id: `reply-${taskId}-${thread.replies.length + 1}`, taskId, senderId: request.senderId, role: request.senderId.startsWith("agent") ? "agent" : "human", body: request.body.trim(), createdAt: String(Date.now()) };
  thread.replies.push(reply);
  thread.task.replyCount = thread.replies.length;
  return { reply, route: { handoffAgentIds: [], needsAssignment: false } };
}
```

- [ ] **Step 8: Add Rust broker task structs**

In `apps/desktop/src-tauri/src/daemon_broker.rs`, add camelCase serde structs matching the TS bridge.

Keep names parallel:

```rust
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SendChannelMessageRequest {
    pub author_id: String,
    pub body: String,
    #[serde(default)]
    pub as_task: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskSummaryView {
    pub id: String,
    pub channel_id: String,
    pub creator_id: String,
    pub assignee_id: Option<String>,
    pub source_message_id: Option<String>,
    pub title: String,
    pub status: String,
    pub attention_required: bool,
    pub reply_count: usize,
    pub updated_at: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskThreadMessageView {
    pub id: String,
    pub task_id: String,
    pub sender_id: String,
    pub role: String,
    pub body: String,
    pub status: Option<String>,
    pub created_at: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskThreadView {
    pub task: TaskSummaryView,
    pub root: TaskThreadMessageView,
    pub replies: Vec<TaskThreadMessageView>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskListQuery {
    pub channel_id: Option<String>,
    pub creator_id: Option<String>,
    pub assignee_id: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskListReceipt {
    pub tasks: Vec<TaskSummaryView>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskThreadReceipt {
    pub thread: TaskThreadView,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskReplyRequest {
    pub sender_id: String,
    pub body: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskReplyRoute {
    pub handoff_agent_ids: Vec<String>,
    pub needs_assignment: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskReplyReceipt {
    pub reply: TaskThreadMessageView,
    pub route: TaskReplyRoute,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskStatusUpdateRequest {
    pub status: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskReceipt {
    pub task: TaskSummaryView,
}
```

- [ ] **Step 9: Preserve `asTask` through broker send**

In `apps/desktop/src-tauri/src/daemon_broker.rs`, make sure the existing channel message send method serializes `asTask` in the JSON body sent to daemon:

```rust
json!({
    "authorId": request.author_id,
    "body": request.body,
    "asTask": request.as_task,
})
```

Keep local mock logic compatible: when `request.as_task` is true, local fallback should create a task outcome even if the message body would not match the old task-command heuristic.

- [ ] **Step 10: Add broker methods**

Add public methods:

```rust
pub fn list_tasks(&self, query: TaskListQuery) -> TaskListReceipt
pub fn get_task_thread(&self, task_id: &str) -> Result<TaskThreadReceipt, TaskError>
pub fn reply_to_task(&self, task_id: &str, request: TaskReplyRequest) -> Result<TaskReplyReceipt, TaskError>
pub fn update_task_status(&self, task_id: &str, request: TaskStatusUpdateRequest) -> Result<TaskReceipt, TaskError>
```

Use daemon HTTP when connected:

- `GET /v1/tasks?channelId=all`
- `GET /v1/tasks/{id}/thread`
- `POST /v1/tasks/{id}/replies`
- `PATCH /v1/tasks/{id}/status`

Use generated idempotency keys for replies:

```rust
let idempotency_key = format!("desktop-task-reply-{}", monotonic_id());
```

Add local fallback storage for tests.

- [ ] **Step 11: Add command wrappers**

In `apps/desktop/src-tauri/src/commands.rs`, add wrappers and Tauri commands:

```rust
pub fn list_tasks(broker: &DaemonBroker, query: TaskListQuery) -> TaskListReceipt {
    broker.list_tasks(query)
}

pub fn get_task_thread(
    broker: &DaemonBroker,
    task_id: &str,
) -> Result<TaskThreadReceipt, TaskError> {
    broker.get_task_thread(task_id)
}

#[tauri::command]
pub fn list_tasks_command(state: tauri::State<'_, DaemonBroker>, query: TaskListQuery) -> TaskListReceipt {
    list_tasks(state.inner(), query)
}
```

Add equivalent commands for `get_task_thread`, `reply_to_task`, and `update_task_status`.

- [ ] **Step 12: Register commands**

In `apps/desktop/src-tauri/src/lib.rs`, add the commands to `generate_handler!`.

Also import command functions in the `#[cfg(test)]` module.

- [ ] **Step 13: Add broker command tests**

In `apps/desktop/src-tauri/src/lib.rs` tests, add:

```rust
#[test]
fn task_reply_command_uses_daemon_route_with_idempotency_key() {
    // Follow channel_message_command_uses_daemon_route_with_idempotency_key:
    // start a TcpListener, call reply_to_task, assert:
    // - POST /v1/tasks/task_1/replies
    // - Authorization header exists
    // - Idempotency-Key header starts with desktop-task-reply-
    // - response deserializes to TaskReplyReceipt
}
```

Also update the existing channel message command test to assert `"asTask":true` is present when the request sets `as_task: true`.

- [ ] **Step 14: Run bridge tests**

Run:

```bash
pnpm --filter @slei/protocol-client test
cargo test -p slei-desktop
pnpm --filter @slei/desktop typecheck
```

Expected: PASS.

- [ ] **Step 15: Commit protocol and bridge**

```bash
git add packages/protocol-client/src/contracts.ts packages/protocol-client/src/contracts.test.ts apps/desktop/src/lib/daemon-bridge.ts apps/desktop/src-tauri/src/daemon_broker.rs apps/desktop/src-tauri/src/commands.rs apps/desktop/src-tauri/src/lib.rs
git commit -m "feat: wire task branch bridge"
```

---

## Task 4: Desktop Task View Model And Status Labels

**Files:**
- Modify: `apps/desktop/src/app/fixtures.ts`
- Modify: `apps/desktop/src/app/SleiApp.tsx`
- Modify: `apps/desktop/src/app/model.ts`
- Modify: `apps/desktop/src/i18n/types.ts`
- Modify: `apps/desktop/src/i18n/messages/zh-CN/tasks.ts`
- Modify: `apps/desktop/src/i18n/messages/en-US/tasks.ts`
- Modify: `apps/desktop/src/features/tasks/TasksPageView.tsx`
- Modify: `apps/desktop/src/features/tasks/types.ts`
- Modify: `apps/desktop/src/features/tasks/TaskCard.ts`
- Modify: `apps/desktop/src/features/tasks/BoardView.ts`
- Test: `apps/desktop/e2e/task-thread-flow.spec.tsx`
- Test: `apps/desktop/e2e/channel-embedded-views.spec.tsx`
- Test: `apps/desktop/e2e/tasks.spec.ts`
- Test: `apps/desktop/e2e/mvp-acceptance.spec.ts`

- [ ] **Step 1: Update failing desktop task model tests**

In `apps/desktop/e2e/task-thread-flow.spec.tsx`, change the task root expectation:

```ts
expect(task.status).toBe("pending_assignment");
expect(task.creatorId).toBe("human:local");
expect(task.replyCount).toBe(0);
expect(task.attentionRequired).toBe(true);
```

Keep stable-id expectations for local fixture helpers.

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @slei/desktop test -- e2e/task-thread-flow.spec.tsx
pnpm --filter @slei/desktop test -- e2e/channel-embedded-views.spec.tsx
```

Expected: FAIL because local `SleiTask.status` still uses `todo` in fixtures and channel embedded test fixtures.

- [ ] **Step 3: Update `SleiTask` types**

In `apps/desktop/src/app/fixtures.ts`, replace `SleiTask` with:

```ts
export type SleiTaskStatus = "pending_assignment" | "in_progress" | "in_review" | "done";

export type SleiTask = {
  id: string;
  title: string;
  owner: string;
  status: SleiTaskStatus;
  creatorId?: string;
  assigneeId?: string;
  attention?: string;
  attentionRequired?: boolean;
  channelId?: string;
  sourceMessageId?: string;
  replyCount?: number;
  updatedAt?: string;
  replies?: SleiTaskReply[];
};
```

Update fixture statuses:

- `todo` -> `pending_assignment`
- `in_progress` remains
- `in_review` remains
- `done` remains

Then update every current desktop `todo` status reference:

- `apps/desktop/src/app/SleiApp.tsx`: local task-card fallback should use `status: outcome.assigneeAgentId ? "in_progress" : "pending_assignment"`.
- `apps/desktop/src/features/tasks/TasksPageView.tsx`: board columns should be `["pending_assignment", "in_progress", "in_review", "done"]`.
- `apps/desktop/e2e/channel-embedded-views.spec.tsx`: test fixture tasks should use `status: "pending_assignment"`.
- `apps/desktop/e2e/tasks.spec.ts`: replace `"In Progress"` fixture status with `"in_progress"`, replace `TODO 0`/`CLOSED 0` expectations with the rendered labels for the four canonical states, and remove closed-column expectations.
- `apps/desktop/e2e/mvp-acceptance.spec.ts`: replace `"In Progress"` fixture statuses with `"in_progress"` so the optional full desktop suite does not fail after the status type narrows.

Run `rg -n '"todo"|\\btodo\\b' apps/desktop/src apps/desktop/e2e` after the edit; expected no task-status usages remain. Non-task prose can stay only if it is not typed as `SleiTask.status`.

- [ ] **Step 4: Update local helper defaults**

In `apps/desktop/src/app/model.ts`, update `createTaskFromChatMessage`:

```ts
return {
  id: `task-${message.id}`,
  title,
  owner: message.author,
  creatorId: "human:local",
  status: "pending_assignment",
  attentionRequired: true,
  channelId,
  sourceMessageId: message.id,
  replyCount: 0,
  replies: [{ id: `root-${message.id}`, sender: message.author, role: message.role, body: message.body }],
};
```

- [ ] **Step 5: Add task-card body parser**

In `model.ts`, add:

```ts
export function parseTaskCardBody(body: string): { taskId: string; sourceMessageId?: string } | null {
  const match = /^task_card:([^:]+)(?::source:(.+))?$/.exec(body.trim());
  if (!match) return null;
  return { taskId: match[1], sourceMessageId: match[2] };
}
```

- [ ] **Step 6: Add work-request helper**

In `model.ts`, add:

```ts
export function taskReplyRequiresWork(body: string): boolean {
  return ["实现", "修复", "检查", "整理", "创建", "改一下", "写一个", "生成", "调查", "验证", "继续"].some((marker) => body.includes(marker));
}
```

- [ ] **Step 7: Update i18n types and messages**

In `apps/desktop/src/i18n/types.ts`, update status record to `Record<SleiTaskStatus, string>` and add:

```ts
replyCountButton: (count: number) => string;
markInReview: string;
markDone: string;
pendingAssignment: string;
```

In `zh-CN/tasks.ts`:

```ts
replyCountButton: (count: number) => `${count} 条回复`,
markInReview: "标记待评审",
markDone: "标记已完成",
pendingAssignment: "待指派",
status: {
  pending_assignment: "待指派",
  in_progress: "进行中",
  in_review: "待评审",
  done: "已完成",
},
```

In `en-US/tasks.ts`, add matching English strings.

- [ ] **Step 8: Update string-render task helpers**

In `apps/desktop/src/features/tasks/types.ts`:

```ts
export type TaskStatus = "pending_assignment" | "in_progress" | "in_review" | "done";
export const TASK_STATUSES: TaskStatus[] = ["pending_assignment", "in_progress", "in_review", "done"];
```

Render display text through `messages.tasks.status[task.status]` or a local label map. Do not persist display labels as status values.

Update `TaskCard.ts` `NEXT_STATUS` to cycle canonical status values:

```ts
const NEXT_STATUS: Record<TaskStatus, TaskStatus> = {
  pending_assignment: "in_progress",
  in_progress: "in_review",
  in_review: "done",
  done: "in_progress",
};
```

- [ ] **Step 9: Run desktop model/i18n tests**

Run:

```bash
pnpm --filter @slei/desktop test -- e2e/task-thread-flow.spec.tsx e2e/channel-embedded-views.spec.tsx e2e/tasks.spec.ts e2e/mvp-acceptance.spec.ts e2e/i18n.spec.tsx
pnpm --filter @slei/desktop typecheck
```

Expected: PASS.

- [ ] **Step 10: Commit desktop task model**

```bash
git add apps/desktop/src/app/fixtures.ts apps/desktop/src/app/SleiApp.tsx apps/desktop/src/app/model.ts apps/desktop/src/i18n/types.ts apps/desktop/src/i18n/messages/zh-CN/tasks.ts apps/desktop/src/i18n/messages/en-US/tasks.ts apps/desktop/src/features/tasks/TasksPageView.tsx apps/desktop/src/features/tasks/types.ts apps/desktop/src/features/tasks/TaskCard.ts apps/desktop/src/features/tasks/BoardView.ts apps/desktop/e2e/task-thread-flow.spec.tsx apps/desktop/e2e/channel-embedded-views.spec.tsx apps/desktop/e2e/tasks.spec.ts apps/desktop/e2e/mvp-acceptance.spec.ts
git commit -m "feat: narrow desktop task states"
```

---

## Task 5: Shared Task Drawer And Status Badge UI

**Files:**
- Create: `apps/desktop/src/features/tasks/TaskStatusBadge.tsx`
- Create: `apps/desktop/src/features/tasks/TaskThreadDrawer.tsx`
- Modify: `apps/desktop/src/features/tasks/TasksPageView.tsx`
- Test: `apps/desktop/e2e/task-thread-flow.spec.tsx`

- [ ] **Step 1: Write failing drawer/status test**

In `apps/desktop/e2e/task-thread-flow.spec.tsx`, add:

```ts
it("renders four-state task drawer controls", () => {
  const data = createSleiFixtures({
    tasks: [{
      id: "T-900",
      title: "任务分支",
      owner: "Lei",
      status: "in_review",
      channelId: "all",
      replyCount: 2,
      replies: [
        { id: "root", sender: "Lei", role: "human", body: "根消息" },
        { id: "reply", sender: "Coda", role: "agent", body: "结果" },
      ],
    }],
  });
  const html = renderToStaticMarkup(<SleiAppFrame activeTaskId="T-900" activeView="tasks" data={data} locale="zh-CN" runtimeSetup={readyRuntime} />);
  expect(html).toContain("待评审");
  expect(html).toContain("标记已完成");
  expect(html).toContain("2 条回复");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @slei/desktop test -- e2e/task-thread-flow.spec.tsx
```

Expected: FAIL because shared drawer/status controls do not exist.

- [ ] **Step 3: Create `TaskStatusBadge.tsx`**

Implement:

```tsx
import type { DesktopMessages } from "../../i18n";
import type { SleiTaskStatus } from "../../app/fixtures";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const STATUS_CLASS: Record<SleiTaskStatus, string> = {
  pending_assignment: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  in_progress: "border-blue-500/40 bg-blue-500/10 text-blue-700 dark:text-blue-300",
  in_review: "border-violet-500/40 bg-violet-500/10 text-violet-700 dark:text-violet-300",
  done: "border-green-500/40 bg-green-500/10 text-green-700 dark:text-green-300",
};

export function TaskStatusBadge({ className, messages, status }: { className?: string; messages: DesktopMessages; status: SleiTaskStatus }) {
  return <Badge className={cn("w-fit", STATUS_CLASS[status], className)} variant="outline">{messages.tasks.status[status]}</Badge>;
}
```

- [ ] **Step 4: Create `TaskThreadDrawer.tsx`**

Implement props:

```tsx
export function TaskThreadDrawer(input: {
  messages: DesktopMessages;
  open: boolean;
  task?: SleiTask;
  onClose: () => void;
  onReply?: (taskId: string, body: string) => Promise<void> | void;
  onStatusChange?: (taskId: string, status: SleiTaskStatus) => Promise<void> | void;
}) {
  const [replyDraft, setReplyDraft] = useState("");
  const task = input.task;
  async function submitReply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = replyDraft.trim();
    if (!task || !body) return;
    await input.onReply?.(task.id, body);
    setReplyDraft("");
  }
  return (
    <Sheet open={input.open} onOpenChange={(open) => !open && input.onClose()}>
      <SheetContent aria-label={input.messages.tasks.thread} className="w-[min(100vw,680px)] gap-0 p-0 sm:max-w-[680px]" showCloseButton={false}>
        {task ? (
          <>
            <SheetHeader className="relative border-b p-5 pr-14">
              <TaskStatusBadge messages={input.messages} status={task.status} />
              <SheetTitle>{task.title}</SheetTitle>
              <SheetDescription>{task.owner} - {input.messages.tasks.replyCountButton(task.replyCount ?? task.replies?.length ?? 0)}</SheetDescription>
              <Button aria-label={input.messages.tasks.closeThread} className="absolute right-3 top-3" onClick={input.onClose} size="icon-sm" type="button" variant="ghost">
                <X aria-hidden="true" className="size-4" />
              </Button>
            </SheetHeader>
            <ScrollArea className="min-h-0 flex-1">
              <div className="grid gap-3 p-5">
                {(task.replies ?? []).map((reply) => (
                  <article className="grid gap-2 rounded-lg border bg-muted/30 p-3" data-reply-role={reply.role ?? "human"} key={reply.id}>
                    <strong className="text-sm">{reply.sender}</strong>
                    <MarkdownMessage markdown={reply.body} />
                  </article>
                ))}
              </div>
            </ScrollArea>
            <SheetFooter className="border-t p-4">
              <form className="grid gap-3" onSubmit={submitReply}>
                <Textarea aria-label={input.messages.tasks.replyPlaceholder} onChange={(event) => setReplyDraft(event.currentTarget.value)} placeholder={input.messages.tasks.replyPlaceholder} value={replyDraft} />
                <div className="flex flex-wrap justify-end gap-2">
                  {task.status === "in_progress" ? <Button onClick={() => input.onStatusChange?.(task.id, "in_review")} type="button" variant="outline">{input.messages.tasks.markInReview}</Button> : null}
                  {task.status === "in_review" ? <Button onClick={() => input.onStatusChange?.(task.id, "done")} type="button" variant="outline">{input.messages.tasks.markDone}</Button> : null}
                  <Button type="submit"><Send aria-hidden="true" className="size-4" />{input.messages.tasks.sendReply}</Button>
                </div>
              </form>
            </SheetFooter>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
```

Use `Sheet`, `ScrollArea`, `Textarea`, `Button`, `Send`, `X`, and `MarkdownMessage`.

Status actions:

```tsx
{task.status === "in_progress" ? <Button onClick={() => onStatusChange?.(task.id, "in_review")}>{messages.tasks.markInReview}</Button> : null}
{task.status === "in_review" ? <Button onClick={() => onStatusChange?.(task.id, "done")}>{messages.tasks.markDone}</Button> : null}
```

Reply count display:

```tsx
messages.tasks.replyCountButton(task.replyCount ?? task.replies?.length ?? 0)
```

- [ ] **Step 5: Replace inline drawer in `TasksPageView.tsx`**

Remove the local `Sheet` block and use:

```tsx
<TaskThreadDrawer
  messages={messages}
  onClose={() => setSelectedTaskId(undefined)}
  onReply={onTaskReply}
  onStatusChange={onTaskStatusChange}
  open={Boolean(selectedTask)}
  task={selectedTask}
/>
```

Update `TasksPage` props to include:

```ts
onTaskStatusChange?: (taskId: string, status: SleiTask["status"]) => Promise<void> | void
```

- [ ] **Step 6: Use `TaskStatusBadge` on task cards**

Replace direct `Badge` status rendering in `TaskCard`.

- [ ] **Step 7: Run UI tests**

Run:

```bash
pnpm --filter @slei/desktop test -- e2e/task-thread-flow.spec.tsx e2e/tasks.spec.ts
pnpm --filter @slei/desktop typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit shared drawer UI**

```bash
git add apps/desktop/src/features/tasks/TaskStatusBadge.tsx apps/desktop/src/features/tasks/TaskThreadDrawer.tsx apps/desktop/src/features/tasks/TasksPageView.tsx apps/desktop/e2e/task-thread-flow.spec.tsx
git commit -m "feat: add shared task thread drawer"
```

---

## Task 6: Collapsed Channel Task Root Entries

**Files:**
- Create: `apps/desktop/src/features/chat/TaskRootEntry.tsx`
- Modify: `apps/desktop/src/features/chat/ChatPageView.tsx`
- Modify: `apps/desktop/src/app/SleiApp.tsx`
- Modify: `apps/desktop/src/app/SleiAppFrame.tsx`
- Modify: `apps/desktop/src/app/routes/TasksRoute.tsx`
- Test: `apps/desktop/e2e/task-branch-session.spec.tsx`
- Test: `apps/desktop/e2e/channel-embedded-views.spec.tsx`

- [ ] **Step 1: Write failing collapsed timeline test**

Create `apps/desktop/e2e/task-branch-session.spec.tsx`:

```tsx
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SleiAppFrame } from "../src/app/SleiApp";
import { createSleiFixtures } from "../src/app/fixtures";

const readyRuntime = {
  loading: false,
  error: undefined,
  hasClaudeRuntimeReady: true,
  nodes: createSleiFixtures().nodes,
};

describe("task branch sessions", () => {
  it("renders a collapsed task root entry and hides the source channel message", () => {
    const html = renderToStaticMarkup(
      <SleiAppFrame
        activeView="chat"
        data={createSleiFixtures({
          messages: [
            { id: "msg_root", author: "Lei", role: "human", time: "10:00", body: "实现任务分支", channelId: "all" },
            { id: "task_card_1", author: "channel_coordinator", role: "system", time: "10:00", body: "task_card:task_1:source:msg_root", channelId: "all" },
          ],
          tasks: [{ id: "task_1", title: "实现任务分支", owner: "Lei", creatorId: "human:local", status: "pending_assignment", channelId: "all", sourceMessageId: "msg_root", replyCount: 0, attentionRequired: true }],
        })}
        locale="zh-CN"
        runtimeSetup={readyRuntime}
      />,
    );
    expect(html).toContain("实现任务分支");
    expect(html).toContain("0 条回复");
    expect(html).toContain("待指派");
    expect(html).toContain("data-task-root-entry");
    expect(html).not.toContain('data-message-id="msg_root"');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @slei/desktop test -- e2e/task-branch-session.spec.tsx
```

Expected: FAIL because `task_card` is filtered out and no task root entry exists.

- [ ] **Step 3: Create `TaskRootEntry.tsx`**

Implement:

```tsx
export function TaskRootEntry(input: {
  messages: DesktopMessages;
  onOpen: () => void;
  task: SleiTask;
}) {
  const replyCount = input.task.replyCount ?? input.task.replies?.length ?? 0;
  return (
    <article className="group relative grid gap-2 rounded-lg border bg-card px-3 py-3 text-sm" data-task-root-entry={input.task.id}>
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <strong className="block break-words">{input.task.title}</strong>
          <small className="text-xs text-muted-foreground">{input.task.owner}</small>
        </div>
        <Button onClick={input.onOpen} size="sm" type="button" variant="outline">
          <MessageSquare aria-hidden="true" className="size-3.5" />
          {input.messages.tasks.replyCountButton(replyCount)}
        </Button>
      </div>
      <TaskStatusBadge className="justify-self-end" messages={input.messages} status={input.task.status} />
    </article>
  );
}
```

- [ ] **Step 4: Preserve task-card messages in `SleiApp.tsx`**

In `channelMessageToSleiMessage`, remove `message.kind === "task_card"` from the early return.

For task cards, return:

```ts
const taskCard = message.kind === "task_card" ? parseTaskCardBody(message.body ?? "") : null;
return {
  id: message.id,
  author: messages.common.system,
  role: "system",
  time: "",
  body: message.body ?? "",
  channelId: message.channelId,
  taskCard,
};
```

Add `taskCard?: { taskId: string; sourceMessageId?: string }` to `SleiMessage`.

- [ ] **Step 5: Filter source human messages in chat timeline**

In `ChatPageView.tsx`, compute:

```ts
const taskCardsBySource = new Set(
  visibleMessages
    .map((message) => message.taskCard?.sourceMessageId)
    .filter((id): id is string => Boolean(id))
);
const timelineMessages = visibleMessages
  .filter((message) => !isTransientAgentActivity(message))
  .filter((message) => !taskCardsBySource.has(message.id));
```

- [ ] **Step 6: Render `TaskRootEntry`**

Inside the timeline map:

```tsx
if (message.taskCard) {
  const task = data.tasks.find((candidate) => candidate.id === message.taskCard?.taskId);
  if (!task) return null;
  return (
    <TaskRootEntry
      key={message.id}
      messages={messages}
      onOpen={() => setSelectedTaskId(task.id)}
      task={task}
    />
  );
}
```

Add `selectedTaskId` state and render `TaskThreadDrawer` at the page level.

- [ ] **Step 7: Pass task status handler through routes**

Update `SleiAppFrameProps`, `renderWorkspace`, `TasksRoute`, and `ChatRoute` if needed to pass:

```ts
onTaskStatusChange?: (taskId: string, status: SleiTask["status"]) => Promise<void> | void;
```

- [ ] **Step 8: Run collapsed task tests**

Run:

```bash
pnpm --filter @slei/desktop test -- e2e/task-branch-session.spec.tsx e2e/channel-embedded-views.spec.tsx
pnpm --filter @slei/desktop typecheck
```

Expected: PASS.

- [ ] **Step 9: Commit collapsed task root UI**

```bash
git add apps/desktop/src/features/chat/TaskRootEntry.tsx apps/desktop/src/features/chat/ChatPageView.tsx apps/desktop/src/app/SleiApp.tsx apps/desktop/src/app/SleiAppFrame.tsx apps/desktop/src/app/routes/TasksRoute.tsx apps/desktop/e2e/task-branch-session.spec.tsx apps/desktop/e2e/channel-embedded-views.spec.tsx
git commit -m "feat: collapse channel task roots"
```

---

## Task 7: Load Daemon Tasks And Persist Drawer Replies

**Files:**
- Modify: `apps/desktop/src/app/SleiApp.tsx`
- Modify: `apps/desktop/src/app/SleiAppFrame.tsx`
- Modify: `apps/desktop/src/app/model.ts`
- Modify: `apps/desktop/src/features/chat/ChatPageView.tsx`
- Modify: `apps/desktop/src/features/tasks/TasksPageView.tsx`
- Test: `apps/desktop/e2e/task-branch-session.spec.tsx`

- [ ] **Step 1: Write failing bridge-state test**

In `apps/desktop/e2e/task-branch-session.spec.tsx`, add an SSR test for drawer replies using a spy callback:

```tsx
it("wires task reply handlers into chat task drawer", () => {
  const chatSource = readFileSync(new URL("../src/features/chat/ChatPageView.tsx", import.meta.url), "utf8");
  const appSource = readFileSync(new URL("../src/app/SleiApp.tsx", import.meta.url), "utf8");
  expect(chatSource).toContain("onTaskReply");
  expect(chatSource).toContain("TaskThreadDrawer");
  expect(appSource).toContain("handleTaskReply");
  expect(appSource).toContain("replyToTask");
});
```

This is a source-level guard because SSR cannot submit the drawer form. `ChatPageView` owns the drawer callback plumbing, while `SleiApp` owns bridge persistence.

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @slei/desktop test -- e2e/task-branch-session.spec.tsx
```

Expected: FAIL until handlers are wired.

- [ ] **Step 3: Add task loading helpers in `SleiApp.tsx`**

Add:

```ts
async function refreshTasks(channelId?: string) {
  const receipt = await bridge.listTasks(channelId ? { channelId } : {});
  setData((current) => createSleiFixtures({
    ...current,
    tasks: mergeTaskSummaries(current.tasks, receipt.tasks, current.members),
  }));
}
```

Implement `mergeTaskSummaries` near existing helpers:

```ts
function taskSummaryToSleiTask(task: TaskSummaryView, members: SleiMember[]): SleiTask {
  const owner = members.find((member) => member.id === task.assigneeId)?.name
    ?? members.find((member) => member.id === task.creatorId)?.name
    ?? task.creatorId;
  return {
    id: task.id,
    title: task.title,
    owner,
    creatorId: task.creatorId,
    assigneeId: task.assigneeId,
    status: task.status,
    attentionRequired: task.attentionRequired,
    attention: task.attentionRequired ? "需要关注" : undefined,
    channelId: task.channelId,
    sourceMessageId: task.sourceMessageId,
    replyCount: task.replyCount,
    updatedAt: task.updatedAt,
  };
}
```

- [ ] **Step 4: Refresh tasks on initial load and channel changes**

In `SleiApp.tsx`, add an effect after `refreshTasks` is defined:

```ts
useEffect(() => {
  if (!activeChannelId) return;
  void refreshTasks(activeChannelId);
}, [activeChannelId]);
```

This is required for reload/resume: persisted daemon `task_card` channel messages can exist before `data.tasks` is populated. Without this load, the collapsed task root entry would render `null`.

- [ ] **Step 5: Refresh tasks after channel sends**

In `handleSendMessage`, after a channel send with `result.receipt.outcome.taskId`, call:

```ts
await refreshTasks(targetId);
```

Keep the local task-card creation path only as an optimistic fallback if bridge task APIs throw.

- [ ] **Step 6: Pass `asTask` through channel sends**

In `apps/desktop/src/app/model.ts`, update `sendChatComposerMessage` so channel messages include `asTask`:

```ts
receipt: await input.bridge.sendChannelMessage(input.activeChannelId, {
  authorId: `human:${handle}`,
  body,
  asTask: Boolean(input.asTask),
}),
```

Add `asTask?: boolean` to the `sendChatComposerMessage` input type and pass `options?.asTask` from `handleSendMessage`.

- [ ] **Step 7: Implement task reply handler**

Replace local `appendTaskReply` usage:

```ts
async function handleTaskReply(taskId: string, body: string) {
  const trimmed = body.trim();
  if (!trimmed) return;
  await bridge.replyToTask(taskId, {
    senderId: "human:local",
    body: trimmed,
  });
  await refreshTaskThreadIntoState(taskId);
  await refreshTasks(activeChannelId);
}
```

This task persists drawer replies and refreshes UI state. Task 8 consumes `receipt.route.handoffAgentIds` after `runTaskAgentReply` exists.

- [ ] **Step 8: Implement task status handler**

```ts
async function handleTaskStatusChange(taskId: string, status: SleiTask["status"]) {
  await bridge.updateTaskStatus(taskId, { status });
  setData((current) => createSleiFixtures({
    ...current,
    tasks: current.tasks.map((task) => task.id === taskId ? { ...task, status } : task),
  }));
}
```

- [ ] **Step 9: Load task thread into selected task state**

Implement:

```ts
async function refreshTaskThreadIntoState(taskId: string) {
  const receipt = await bridge.getTaskThread(taskId);
  setData((current) => createSleiFixtures({
    ...current,
    tasks: current.tasks.map((task) =>
      task.id === taskId
        ? {
            ...taskSummaryToSleiTask(receipt.thread.task, current.members),
            replies: [
              taskThreadMessageToReply(receipt.thread.root, current.members),
              ...receipt.thread.replies.map((reply) => taskThreadMessageToReply(reply, current.members)),
            ],
          }
        : task,
    ),
  }));
}
```

- [ ] **Step 10: Call thread load when drawer opens**

In `ChatPageView.tsx` and `TasksPageView.tsx`, add optional:

```ts
onTaskThreadOpen?: (taskId: string) => Promise<void> | void;
```

Call it when selecting a task:

```ts
onTaskThreadOpen?.(task.id);
setSelectedTaskId(task.id);
```

- [ ] **Step 11: Run state wiring tests**

Run:

```bash
pnpm --filter @slei/desktop test -- e2e/task-branch-session.spec.tsx e2e/task-thread-flow.spec.tsx
pnpm --filter @slei/desktop typecheck
```

Expected: PASS.

- [ ] **Step 12: Commit daemon task state wiring**

```bash
git add apps/desktop/src/app/SleiApp.tsx apps/desktop/src/app/SleiAppFrame.tsx apps/desktop/src/app/model.ts apps/desktop/src/features/chat/ChatPageView.tsx apps/desktop/src/features/tasks/TasksPageView.tsx apps/desktop/e2e/task-branch-session.spec.tsx
git commit -m "feat: persist task drawer replies"
```

---

## Task 8: Task-Scoped Agent Output Writeback

**Files:**
- Modify: `apps/desktop/src/app/SleiApp.tsx`
- Test: `apps/desktop/e2e/task-branch-session.spec.tsx`

- [ ] **Step 1: Write failing source-level test for task Agent output**

In `apps/desktop/e2e/task-branch-session.spec.tsx`, add:

```ts
it("does not append task agent replies to the outer channel timeline", () => {
  const source = readFileSync(new URL("../src/app/SleiApp.tsx", import.meta.url), "utf8");
  expect(source).toContain("runTaskAgentReply");
  expect(source).toContain("replyToTask");
  expect(source).toContain("taskId");
  expect(source).not.toContain("agentActivity = createChannelAgentActivityMessage(result.receipt.outcome");
});
```

This protects the product boundary: task agent output must be persisted through `replyToTask`.

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @slei/desktop test -- e2e/task-branch-session.spec.tsx
```

Expected: FAIL until `runTaskAgentReply` exists and task assignment no longer creates outer activity messages.

- [ ] **Step 3: Extract shared Agent run helper input**

In `SleiApp.tsx`, add:

```ts
type TaskAgentReplyInput = {
  agentId: string;
  channelId: string;
  sourceBody: string;
  taskId: string;
  triggerBody?: string;
};
```

- [ ] **Step 4: Implement task prompt**

Add:

```ts
function taskAgentReplyPrompt(input: { channelId: string; taskId: string; sourceBody: string; triggerBody?: string }): string {
  const channelName = input.channelId.startsWith("#") ? input.channelId : `#${input.channelId}`;
  return [
    `你正在处理 ${channelName} 中的任务 ${input.taskId}。`,
    "请只基于这个任务线程继续处理；不要把回复发回外层频道。",
    input.triggerBody ? "用户在任务线程中的最新指令：" : "任务根消息：",
    input.triggerBody ?? input.sourceBody,
  ].join("\n");
}
```

- [ ] **Step 5: Implement `runTaskAgentReply`**

Use the body of `runChannelAgentReply` as a template, but final writeback is:

```ts
const combinedBody = replies.map((message) => message.body).filter(Boolean).join("\n\n").trim();
await bridge.replyToTask(input.taskId, {
  senderId: input.agentId,
  body: combinedBody || "智能体回复为空。",
});
await refreshTaskThreadIntoState(input.taskId);
await bridge.updateTaskStatus(input.taskId, { status: replies.some((message) => message.status === "failed") ? "in_progress" : "in_review" });
await refreshTasks(input.channelId);
```

For timeout/failure, write a failed-looking task reply body and keep status `in_progress`.

- [ ] **Step 6: Start task Agent reply after channel task assignment**

In `handleSendMessage`, change post-send routing:

```ts
if (result.receipt.outcome.taskId && result.receipt.outcome.assigneeAgentId) {
  void runTaskAgentReply({
    agentId: result.receipt.outcome.assigneeAgentId,
    channelId: targetId,
    sourceBody: channelMessage.body,
    taskId: result.receipt.outcome.taskId,
  });
} else if (result.receipt.outcome.action === "request_agent_reply") {
  void runChannelAgentReply(result.receipt.outcome, channelMessage, targetId);
}
```

Do not create `createChannelAgentActivityMessage` for task assignments.

- [ ] **Step 7: Start task Agent reply after drawer handoff**

In `handleTaskReply`, change the `await bridge.replyToTask(...)` call to store the receipt, then after `refreshTaskThreadIntoState` start one task-scoped Agent run per handoff agent:

```ts
const receipt = await bridge.replyToTask(taskId, {
  senderId: "human:local",
  body: trimmed,
});
await refreshTaskThreadIntoState(taskId);
const task = data.tasks.find((candidate) => candidate.id === taskId);
const channelId = task?.channelId ?? activeChannelId ?? "all";
for (const agentId of receipt.route.handoffAgentIds) {
  void runTaskAgentReply({
    agentId,
    channelId,
    sourceBody: task?.title ?? trimmed,
    taskId,
    triggerBody: trimmed,
  });
}
```

- [ ] **Step 8: Run task Agent tests**

Run:

```bash
pnpm --filter @slei/desktop test -- e2e/task-branch-session.spec.tsx
pnpm --filter @slei/desktop typecheck
```

Expected: PASS.

- [ ] **Step 9: Commit task Agent writeback**

```bash
git add apps/desktop/src/app/SleiApp.tsx apps/desktop/e2e/task-branch-session.spec.tsx
git commit -m "feat: write agent replies to task threads"
```

---

## Task 9: End-To-End Verification And Cleanup

**Files:**
- Modify as needed only if verification reveals integration gaps.

- [ ] **Step 1: Run daemon task-focused tests**

Run:

```bash
cargo test -p slei-daemon --test task_api
cargo test -p slei-daemon --test task_board
cargo test -p slei-daemon --test channel_orchestration_flow
```

Expected: PASS.

- [ ] **Step 2: Run Tauri bridge tests**

Run:

```bash
cargo test -p slei-desktop
```

Expected: PASS.

- [ ] **Step 3: Run protocol tests**

Run:

```bash
pnpm --filter @slei/protocol-client test
```

Expected: PASS.

- [ ] **Step 4: Run desktop task/chat tests**

Run:

```bash
pnpm --filter @slei/desktop test -- e2e/task-branch-session.spec.tsx e2e/task-thread-flow.spec.tsx e2e/channel-embedded-views.spec.tsx e2e/tasks.spec.ts e2e/chat.spec.ts e2e/composer-submit.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Run desktop typecheck**

Run:

```bash
pnpm --filter @slei/desktop typecheck
```

Expected: PASS.

- [ ] **Step 6: Run full desktop test suite if time allows**

Run:

```bash
pnpm --filter @slei/desktop test
```

Expected: PASS.

- [ ] **Step 7: Check formatting-sensitive diff**

Run:

```bash
git diff --check
```

Expected: no output.

- [ ] **Step 8: Commit final cleanup if needed**

If Step 1-7 required any fixes:

```bash
git add apps/desktop/src crates/slei-daemon/src crates/slei-daemon/tests packages/protocol-client/src
git commit -m "test: verify task branch sessions"
```

If no files changed, do not create an empty commit.

---

## Implementation Notes For Workers

- Use @superpowers:test-driven-development for each implementation task.
- Use @superpowers:verification-before-completion before claiming the task is complete.
- Use @superpowers:finishing-a-development-branch after all tasks pass.
- Do not start on `master`; this worktree is currently detached and already contains the design commit.
- Do not revert unrelated user changes if they appear during implementation.
- Keep the first version focused: no daemon background task runner, no new notification center UI, no status states beyond `pending_assignment`, `in_progress`, `in_review`, and `done`.
