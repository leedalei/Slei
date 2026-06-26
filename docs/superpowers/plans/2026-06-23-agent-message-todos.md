# Agent Message Todos Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build daemon-owned Agent message todos so failed claim participants with existing deliveries can be serially reawakened with pending todo context, plus CLI/API management and message-id range reads.

**Architecture:** Add a dedicated SQLite `agent_message_todos` table and repository/service methods; integrate todo creation into daemon claim handling; inject pending todos into channel run packets during mention/broadcast/todo-only runs; advance todo lifecycle from daemon worker events. UI remains unchanged and routing state stays in daemon/SQLite. ADR 0005 must be updated with the new guardrails.

**Tech Stack:** Rust workspace (`slei-storage`, `slei-daemon`, `slei-cli`), SQLite migrations via sqlx, Axum HTTP API, existing Claude worker orchestration, existing Rust integration tests.

---

## Knowledge Context

Relevant historical note: `docs/knowledge/runtime-errors/channel-agent-broadcast-no-reply-20260617.md`.

Key implementation guardrail: delivery/run state must be explicitly closed out and tested. Do not treat `broadcast_delivered` or worker spawn as proof of claim/reply. Todo lifecycle must follow worker start/completed/failed and leave diagnostics where useful.

## File Structure

- Create: `crates/slei-storage/migrations/0010_agent_message_todos.sql`
  - Owns SQLite table, indexes, and schema version 10.
- Modify: `crates/slei-storage/src/migrations.rs`
  - Registers migration 10.
- Modify: `crates/slei-storage/src/repositories/mod.rs`
  - Adds todo row structs, CRUD/query/lifecycle methods, reset table lists, and message-id range read query support.
- Modify: `crates/slei-storage/src/lib.rs`
  - Adds storage tests for migration, repository, reset, and message range reads.
- Create: `crates/slei-daemon/src/services/agent_message_todo_service.rs`
  - Encapsulates todo creation, API management, prompt selection, lifecycle transitions, and validation.
- Modify: `crates/slei-daemon/src/services/mod.rs`
  - Exports the new service.
- Modify: `crates/slei-daemon/src/state.rs`
  - Constructs and exposes `agent_message_todos()` service.
- Create: `crates/slei-daemon/src/api/agent_message_todos.rs`
  - Adds HTTP CRUD/clear handlers.
- Modify: `crates/slei-daemon/src/api/mod.rs`, `crates/slei-daemon/src/app.rs`
  - Registers the new API routes.
- Modify: `crates/slei-daemon/src/api/claims.rs`, `crates/slei-daemon/src/services/claim_service.rs`
  - Creates pending todo on failed message claim when an existing delivery and processable channel message exist.
- Modify: `crates/slei-daemon/src/api/messages.rs`, `crates/slei-daemon/src/services/message_service.rs`
  - Adds `fromMessage` / `toMessage` inclusive range read.
- Modify: `crates/slei-daemon/src/services/channel_orchestrator_service.rs`
  - Injects pending todos into prompt, marks running/done/pending, and starts one todo-only run after no-mention Agent channel messages.
- Modify: `crates/slei-daemon/src/services/agent_prompt_service.rs`
  - Adds system prompt guidance for Pending Message Todos and CLI range reads.
- Modify: `crates/slei-cli/src/main.rs`
  - Adds `todo` command group and message range read args.
- Modify: `docs/architecture/0005-channel-routing-and-multi-agent-flow.md`
  - Updates routing guardrails to include failed-claim todos and prompt override behavior.
- Test: `crates/slei-daemon/tests/broadcast_claim_api.rs`
  - Claim API, todo API, message range read, CLI-facing API behavior.
- Test: `crates/slei-daemon/tests/channel_orchestration_flow.rs`
  - Orchestrator todo injection, no-mention serial progression, lifecycle transitions.
- Test: `crates/slei-cli/src/main.rs` unit tests
  - CLI command path/query/body construction.

## Implementation Tasks

### Task 1: Storage Migration And Repository Model

**Files:**
- Create: `crates/slei-storage/migrations/0010_agent_message_todos.sql`
- Modify: `crates/slei-storage/src/migrations.rs`
- Modify: `crates/slei-storage/src/repositories/mod.rs`
- Modify: `crates/slei-storage/src/lib.rs`

- [ ] **Step 1: Write failing migration tests**

Add assertions in `crates/slei-storage/src/lib.rs`:

```rust
#[tokio::test]
async fn migration_creates_agent_message_todos() {
    let (url, _path) = sqlite_file_url("agent-message-todos-migration");
    let db = SleiDb::connect(&url).await.unwrap();
    db.migrate().await.unwrap();

    assert!(db.table_exists("agent_message_todos").await.unwrap());

    let versions = sqlx::query_scalar::<_, i64>(
        "SELECT version FROM schema_migrations ORDER BY version ASC",
    )
    .fetch_all(db.pool())
    .await
    .unwrap();
    assert_eq!(versions.last().copied(), Some(10));
}
```

Update existing migration version tests from `1..=9` to `1..=10`.

- [ ] **Step 2: Run storage migration tests and verify failure**

Run:

```sh
cargo test -p slei-storage migration_creates_agent_message_todos migration_records_every_known_version
```

Expected: fails because migration 10 and table do not exist.

- [ ] **Step 3: Add migration 10**

Create `crates/slei-storage/migrations/0010_agent_message_todos.sql`:

```sql
CREATE TABLE IF NOT EXISTS agent_message_todos (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL UNIQUE,
    agent_id TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    message_id TEXT NOT NULL REFERENCES messages(id),
    message_author_id TEXT NOT NULL,
    message_created_at TEXT NOT NULL,
    claim_owner_agent_id TEXT NOT NULL,
    status TEXT NOT NULL,
    run_id TEXT,
    note TEXT,
    last_prompted_at TEXT,
    completed_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(agent_id, message_id)
);

CREATE INDEX IF NOT EXISTS idx_agent_message_todos_agent_channel_status
    ON agent_message_todos(agent_id, channel_id, status, created_at);

CREATE INDEX IF NOT EXISTS idx_agent_message_todos_channel_status
    ON agent_message_todos(channel_id, status, created_at);

CREATE INDEX IF NOT EXISTS idx_agent_message_todos_run_id
    ON agent_message_todos(run_id);

INSERT OR IGNORE INTO schema_migrations(version) VALUES (10);
```

Register it in `crates/slei-storage/src/migrations.rs`:

```rust
pub const MIGRATION_0010: &str = include_str!("../migrations/0010_agent_message_todos.sql");

pub const MIGRATIONS: &[(i64, &str)] = &[
    (1, MIGRATION_0001),
    (2, MIGRATION_0002),
    (3, MIGRATION_0003),
    (4, MIGRATION_0004),
    (5, MIGRATION_0005),
    (6, MIGRATION_0006),
    (7, MIGRATION_0007),
    (8, MIGRATION_0008),
    (9, MIGRATION_0009),
    (10, MIGRATION_0010),
];
```

- [ ] **Step 4: Add reset table and sequence coverage**

In `crates/slei-storage/src/repositories/mod.rs`, add:

```rust
"agent_message_todos",
```

to `RESET_MUTABLE_TABLES`, and add:

```rust
"agent_message_todos",
```

to `RESET_MUTABLE_SEQUENCE_TABLES`.

Update reset tests in `crates/slei-storage/src/lib.rs` to seed at least one todo row before reset and include it in sequence assertions.

- [ ] **Step 5: Run migration/reset tests**

Run:

```sh
cargo test -p slei-storage migration_creates_agent_message_todos migration_records_every_known_version reset_mutable_state
```

Expected: passes.

- [ ] **Step 6: Commit**

```sh
git add crates/slei-storage/migrations/0010_agent_message_todos.sql crates/slei-storage/src/migrations.rs crates/slei-storage/src/repositories/mod.rs crates/slei-storage/src/lib.rs
git commit -m "feat(storage): add agent message todos table"
```

### Task 2: Todo Repository Operations

**Files:**
- Modify: `crates/slei-storage/src/repositories/mod.rs`
- Modify: `crates/slei-storage/src/lib.rs`

- [ ] **Step 1: Write failing repository tests**

Add tests covering:

```rust
#[tokio::test]
async fn agent_message_todo_crud_and_unique_agent_message() { /* create, duplicate, list */ }

#[tokio::test]
async fn agent_message_todo_lifecycle_transitions_clear_run_id() { /* pending -> running -> done, failed restore */ }

#[tokio::test]
async fn agent_message_todo_soft_delete_and_reopen_are_explicit() { /* deleted hidden by default, show by id, update to pending */ }
```

Test expectations:

- duplicate create for `(agent_id, message_id)` returns the existing row instead of inserting.
- `mark_agent_message_todos_running(agent, channel, run, 5)` returns oldest pending rows and sets `status='running'`, `run_id=run`.
- `mark_agent_message_todos_done_for_run(run)` sets `status='done'`, `completed_at IS NOT NULL`, `run_id IS NULL`.
- `restore_agent_message_todos_pending_for_run(run)` sets `status='pending'`, `run_id IS NULL`.
- `delete_agent_message_todo(id)` sets `status='deleted'`.

- [ ] **Step 2: Run tests and verify failure**

```sh
cargo test -p slei-storage agent_message_todo
```

Expected: fails because repository structs/methods do not exist.

- [ ] **Step 3: Add repository structs**

In `crates/slei-storage/src/repositories/mod.rs`, add structs near existing row structs:

```rust
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AgentMessageTodoRow {
    pub sequence: i64,
    pub id: String,
    pub agent_id: String,
    pub channel_id: String,
    pub message_id: String,
    pub message_author_id: String,
    pub message_created_at: String,
    pub claim_owner_agent_id: String,
    pub status: String,
    pub run_id: Option<String>,
    pub note: Option<String>,
    pub last_prompted_at: Option<String>,
    pub completed_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone)]
pub struct NewAgentMessageTodoRow {
    pub agent_id: String,
    pub channel_id: String,
    pub message_id: String,
    pub message_author_id: String,
    pub message_created_at: String,
    pub claim_owner_agent_id: String,
    pub note: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub struct AgentMessageTodoQueryRow {
    pub agent_id: Option<String>,
    pub channel_id: Option<String>,
    pub status: Option<String>,
    pub include_deleted: bool,
    pub limit: Option<i64>,
}
```

- [ ] **Step 4: Add repository methods**

Implement methods on `Repositories`:

```rust
pub async fn create_agent_message_todo(&self, row: NewAgentMessageTodoRow) -> Result<AgentMessageTodoRow, sqlx::Error>;
pub async fn agent_message_todo(&self, todo_id: &str) -> Result<Option<AgentMessageTodoRow>, sqlx::Error>;
pub async fn agent_message_todos(&self, query: AgentMessageTodoQueryRow) -> Result<Vec<AgentMessageTodoRow>, sqlx::Error>;
pub async fn update_agent_message_todo_status(&self, todo_id: &str, status: &str, note: Option<&str>) -> Result<Option<AgentMessageTodoRow>, sqlx::Error>;
pub async fn delete_agent_message_todo(&self, todo_id: &str) -> Result<Option<AgentMessageTodoRow>, sqlx::Error>;
pub async fn clear_agent_message_todos(&self, query: AgentMessageTodoQueryRow, note: Option<&str>) -> Result<Vec<AgentMessageTodoRow>, sqlx::Error>;
pub async fn mark_agent_message_todos_running(&self, agent_id: &str, channel_id: &str, run_id: &str, limit: i64) -> Result<Vec<AgentMessageTodoRow>, sqlx::Error>;
pub async fn mark_agent_message_todos_done_for_run(&self, run_id: &str) -> Result<Vec<AgentMessageTodoRow>, sqlx::Error>;
pub async fn restore_agent_message_todos_pending_for_run(&self, run_id: &str) -> Result<Vec<AgentMessageTodoRow>, sqlx::Error>;
```

Use `Uuid::new_v4()` for ids. For create, use `ON CONFLICT(agent_id, message_id) DO NOTHING`, then fetch by `(agent_id, message_id)` so `done/deleted` are not reopened automatically.

- [ ] **Step 5: Run repository tests**

```sh
cargo test -p slei-storage agent_message_todo
```

Expected: passes.

- [ ] **Step 6: Commit**

```sh
git add crates/slei-storage/src/repositories/mod.rs crates/slei-storage/src/lib.rs
git commit -m "feat(storage): add agent message todo repository"
```

### Task 3: Message ID Range Read

**Files:**
- Modify: `crates/slei-storage/src/repositories/mod.rs`
- Modify: `crates/slei-storage/src/lib.rs`
- Modify: `crates/slei-daemon/src/services/message_service.rs`
- Modify: `crates/slei-daemon/src/api/messages.rs`
- Modify: `crates/slei-daemon/tests/broadcast_claim_api.rs`

- [ ] **Step 1: Write failing storage and API tests**

In storage tests, create three messages and assert inclusive range:

```rust
let rows = repos
    .read_channel_messages(MessageReadQueryRow {
        channel_id: "all".to_string(),
        limit: Some(20),
        after_sequence: None,
        before_sequence: None,
        around_message_id: None,
        from_message_id: Some(first.id.clone()),
        to_message_id: Some(third.id.clone()),
    })
    .await
    .unwrap();
assert_eq!(rows.iter().map(|row| row.id.as_str()).collect::<Vec<_>>(), vec![first.id, second.id, third.id]);
```

In `broadcast_claim_api.rs`, add API tests:

- `/v1/messages/read?channel=all&fromMessage=<first>&toMessage=<third>&limit=20` returns first, second, third.
- reversed order returns the same ascending order.
- mixed channel or deleted endpoint returns `400`.
- `fromMessage` with `around` returns `400`.
- range reads do not expose `task_card`, `tombstone`, `task_root`, `task_reply`, or legacy `task_card:` control messages.

- [ ] **Step 2: Run tests and verify failure**

```sh
cargo test -p slei-storage message_range
cargo test -p slei-daemon --test broadcast_claim_api message_read_api_reads_inclusive_message_id_range
```

Expected: fails because query fields are missing.

- [ ] **Step 3: Extend storage query**

Add fields to `MessageReadQueryRow`:

```rust
pub from_message_id: Option<String>,
pub to_message_id: Option<String>,
```

In `read_channel_messages`, reject mixed modes at service/API layer; repository should support range by resolving both endpoint `rowid`s in the same `channel_id` and `deleted=0`, sorting min/max, and returning:

```sql
WHERE channel_id = ?
  AND rowid >= ?
  AND rowid <= ?
  AND deleted = 0
  AND kind NOT IN ('task_root', 'task_reply', 'task_card', 'tombstone')
  AND (content IS NULL OR content NOT LIKE 'task_card:%')
ORDER BY rowid ASC
LIMIT ?
```

- [ ] **Step 4: Extend daemon API and service**

In `ReadMessagesQuery`, add:

```rust
from_message: Option<String>,
to_message: Option<String>,
```

with serde camelCase producing `fromMessage` / `toMessage`.

In `MessageService::read_agent_messages`, add args and validate:

- `fromMessage` and `toMessage` must be provided together.
- range mode is mutually exclusive with `around`, `after`, and `before`.
- blank ids are invalid.
- endpoint not found/deleted/wrong channel becomes `MessageError::InvalidMessage` and HTTP 400.

- [ ] **Step 5: Run range tests**

```sh
cargo test -p slei-storage message_range
cargo test -p slei-daemon --test broadcast_claim_api message_read_api_reads_inclusive_message_id_range
```

Expected: passes.

- [ ] **Step 6: Commit**

```sh
git add crates/slei-storage/src/repositories/mod.rs crates/slei-storage/src/lib.rs crates/slei-daemon/src/services/message_service.rs crates/slei-daemon/src/api/messages.rs crates/slei-daemon/tests/broadcast_claim_api.rs
git commit -m "feat(messages): read inclusive message id ranges"
```

### Task 4: Todo Service And HTTP API

**Files:**
- Create: `crates/slei-daemon/src/services/agent_message_todo_service.rs`
- Modify: `crates/slei-daemon/src/services/mod.rs`
- Modify: `crates/slei-daemon/src/state.rs`
- Create: `crates/slei-daemon/src/api/agent_message_todos.rs`
- Modify: `crates/slei-daemon/src/api/mod.rs`
- Modify: `crates/slei-daemon/src/app.rs`
- Modify: `crates/slei-daemon/tests/broadcast_claim_api.rs`

- [ ] **Step 1: Write failing API tests**

In `broadcast_claim_api.rs`, add tests for:

- `POST /v1/agent-message-todos` creates a manual pending todo for a valid message.
- `GET /v1/agent-message-todos?agentId=agent_coda&channelId=all&status=pending` lists it.
- `GET /v1/agent-message-todos/{id}` shows it even after delete.
- `PATCH /v1/agent-message-todos/{id}` changes status to `done` and writes note.
- `DELETE /v1/agent-message-todos/{id}` soft-deletes.
- `POST /v1/agent-message-todos/clear` soft-deletes all matching pending todos.
- write calls without `idempotency-key` return 400.
- repeating the same idempotency key for create/update/delete/clear replays the original JSON response and does not apply the side effect twice.

- [ ] **Step 2: Run tests and verify failure**

```sh
cargo test -p slei-daemon --test broadcast_claim_api agent_message_todo_api
```

Expected: fails because routes do not exist.

- [ ] **Step 3: Implement service**

Create `AgentMessageTodoService` with methods:

```rust
pub async fn list(&self, query: AgentMessageTodoListQuery) -> Result<Vec<AgentMessageTodo>, AgentMessageTodoError>;
pub async fn get(&self, todo_id: &str) -> Result<AgentMessageTodo, AgentMessageTodoError>;
pub async fn create_manual_idempotent(&self, input: CreateAgentMessageTodoInput, idempotency_key: &str) -> Result<AgentMessageTodo, AgentMessageTodoError>;
pub async fn update_idempotent(&self, todo_id: &str, input: UpdateAgentMessageTodoInput, idempotency_key: &str) -> Result<AgentMessageTodo, AgentMessageTodoError>;
pub async fn delete_idempotent(&self, todo_id: &str, idempotency_key: &str) -> Result<AgentMessageTodo, AgentMessageTodoError>;
pub async fn clear_idempotent(&self, input: ClearAgentMessageTodosInput, idempotency_key: &str) -> Result<Vec<AgentMessageTodo>, AgentMessageTodoError>;
```

Validation:

- manual API status updates allow `pending`, `done`, and `deleted`; they do not allow manually setting `running`, because `running` requires a daemon-owned `run_id`.
- manual create validates message exists, channel matches, not deleted, processable kind.
- manual create requires `agent_id`, `channel_id`, `message_id`.
- processable validation must match range-read filtering: reject `task_card`, `tombstone`, `task_root`, `task_reply`, and legacy `task_card:` control content.

Idempotency:

- Use existing `idempotency::namespaced_key` pattern with separate namespaces such as `agent-message-todo:create`, `agent-message-todo:update`, `agent-message-todo:delete`, and `agent-message-todo:clear`.
- Store/replay the exact JSON response through the existing idempotent mutation repository path, matching task/message write behavior.
- API handlers must reject missing or blank `idempotency-key` before invoking write service methods.

- [ ] **Step 4: Register service and routes**

In `state.rs`, add a field and accessor similar to existing services:

```rust
agent_message_todos: AgentMessageTodoService,
pub fn agent_message_todos(&self) -> AgentMessageTodoService { self.agent_message_todos.clone() }
```

In `api/mod.rs`:

```rust
pub mod agent_message_todos;
```

In `app.rs`, register:

```rust
.route("/v1/agent-message-todos", get(api::agent_message_todos::list).post(api::agent_message_todos::create))
.route("/v1/agent-message-todos/clear", post(api::agent_message_todos::clear))
.route(
    "/v1/agent-message-todos/{id}",
    get(api::agent_message_todos::get)
        .patch(api::agent_message_todos::update)
        .delete(api::agent_message_todos::delete),
)
```

- [ ] **Step 5: Run API tests**

```sh
cargo test -p slei-daemon --test broadcast_claim_api agent_message_todo_api
```

Expected: passes.

- [ ] **Step 6: Commit**

```sh
git add crates/slei-daemon/src/services/agent_message_todo_service.rs crates/slei-daemon/src/services/mod.rs crates/slei-daemon/src/state.rs crates/slei-daemon/src/api/agent_message_todos.rs crates/slei-daemon/src/api/mod.rs crates/slei-daemon/src/app.rs crates/slei-daemon/tests/broadcast_claim_api.rs
git commit -m "feat(daemon): add agent message todo API"
```

### Task 5: Failed Claim Creates Pending Todo

**Files:**
- Modify: `crates/slei-daemon/src/services/agent_message_todo_service.rs`
- Modify: `crates/slei-daemon/src/services/claim_service.rs`
- Modify: `crates/slei-daemon/src/api/claims.rs`
- Modify: `crates/slei-daemon/tests/broadcast_claim_api.rs`

- [ ] **Step 1: Write failing claim tests**

Add tests:

- A message has delivery for `agent_b`.
- `agent_a` claims first.
- `agent_b` claims and gets `claimed=false`.
- daemon creates one pending todo for `agent_b`.
- duplicate failed claim keeps one todo.
- no delivery means no todo.
- `task_card`, `tombstone`, old task control, and deleted messages do not create todo.
- agent-authored processable channel message with delivery can create todo.

- [ ] **Step 2: Run tests and verify failure**

```sh
cargo test -p slei-daemon --test broadcast_claim_api failed_message_claim_creates_agent_message_todo
```

Expected: fails because claim path does not call todo service.

- [ ] **Step 3: Add service helper for failed claim**

In `AgentMessageTodoService`:

```rust
pub async fn create_pending_from_failed_claim(
    &self,
    message_id: &str,
    failed_agent_id: &str,
    claim_owner_agent_id: &str,
) -> Result<Option<AgentMessageTodo>, AgentMessageTodoError>
```

Implementation:

- fetch message by id.
- reject deleted and non-processable kinds.
- fetch deliveries for message and require a delivery where `agent_id == failed_agent_id`.
- create repository row with message author/time/channel and claim owner.
- return `Ok(None)` for non-eligible cases, not a hard error.

- [ ] **Step 4: Integrate claim API**

After `state.claims().claim_message(...)` returns `claimed=false`, call:

```rust
if !response.claimed {
    if let Some(owner) = response.agent_id.as_deref() {
        let _ = state
            .agent_message_todos()
            .create_pending_from_failed_claim(&message_id, &payload.agent_id, owner)
            .await;
    }
}
```

Do not change claim response JSON or exit semantics.

- [ ] **Step 5: Run claim tests**

```sh
cargo test -p slei-daemon --test broadcast_claim_api failed_message_claim_creates_agent_message_todo
```

Expected: passes.

- [ ] **Step 6: Commit**

```sh
git add crates/slei-daemon/src/services/agent_message_todo_service.rs crates/slei-daemon/src/services/claim_service.rs crates/slei-daemon/src/api/claims.rs crates/slei-daemon/tests/broadcast_claim_api.rs
git commit -m "feat(daemon): create todos from failed message claims"
```

### Task 6: Prompt Injection And Todo Lifecycle In Orchestrator

**Files:**
- Modify: `crates/slei-daemon/src/services/channel_orchestrator_service.rs`
- Modify: `crates/slei-daemon/src/services/agent_prompt_service.rs`
- Modify: `crates/slei-daemon/tests/channel_orchestration_flow.rs`

- [ ] **Step 1: Write failing prompt tests**

Add/extend unit tests for `broadcast_message_prompt` or a new prompt builder:

- run packet includes `## Pending Message Todos`.
- todo entries include todo id, channel id, message id, author id, claim owner, created time, body.
- prompt says:
  - process pending todos even if current trigger is not claimable.
  - do not claim current trigger solely for todo progression.
  - do not claim todo source message.
  - use `slei-cli message read --channel "#all" --from-message msg_A --to-message msg_B`.
- prompt does not contain `slei-cli todo update`, `slei-cli todo delete`, `slei-cli todo clear`, or `slei-cli todo reopen`.

- [ ] **Step 2: Run prompt tests and verify failure**

```sh
cargo test -p slei-daemon channel_orchestrator_service::tests::pending_todos_are_injected_into_run_packet agent_prompt_service::tests::system_prompt_mentions_pending_todos_without_management_commands
```

Expected: fails because prompt code does not accept todos.

- [ ] **Step 3: Introduce prompt todo DTO**

In `channel_orchestrator_service.rs`, add a local struct or import a service DTO:

```rust
#[derive(Debug, Clone)]
struct PendingMessageTodoPrompt {
    id: String,
    channel_id: String,
    message_id: String,
    author_id: String,
    created_at: String,
    claim_owner_agent_id: String,
    body: String,
}
```

Do not build `body` from todo rows alone. Add a todo service helper that fetches each source message and returns prompt-ready rows:

```rust
pub async fn mark_running_for_prompt(
    &self,
    agent_id: &str,
    channel_id: &str,
    run_id: &str,
    limit: i64,
) -> Result<Vec<PendingMessageTodoPrompt>, AgentMessageTodoError>
```

The helper must:

- select oldest pending todos for the agent/channel.
- mark them `running` with `run_id` and `last_prompted_at`.
- fetch each source message body from `messages`.
- skip or restore any todo whose source message is now deleted or no longer processable.
- return prompt DTOs with non-empty `body` strings.

Keep selection, marking, body fetch, and invalid-source restoration transactional where practical. No invalid source message should leave a todo stuck in `running`.

Refactor `broadcast_message_prompt(agent_id, message)` into:

```rust
fn channel_run_prompt(agent_id: &str, message: &MessageRecord, pending_todos: &[PendingMessageTodoPrompt]) -> String
```

Keep old behavior when `pending_todos.is_empty()`.

- [ ] **Step 4: Add lifecycle hooks around run start**

Only after duplicate-run and active-run checks have decided that a worker will actually start, and immediately before building the prompt, call:

```rust
let pending_todos = self
    .agent_message_todos
    .mark_running_for_prompt(&agent.id, channel_id, &run_id, 5)
    .await?;
```

If worker `start_run` fails, call:

```rust
self.agent_message_todos.restore_pending_for_run(run_id).await;
```

On worker completed, call:

```rust
self.agent_message_todos.mark_done_for_run(run_id).await;
```

On worker failed, call:

```rust
self.agent_message_todos.restore_pending_for_run(run_id).await;
```

Ensure these calls happen for:

- human broadcast runs.
- top-level Agent mention runs.
- todo-only runs triggered by no-mention Agent messages.

Do not run them for task replies unless the implementation intentionally reuses the same channel run path and spec scope remains top-level channel messages only.

- [ ] **Step 5: Add todo-only run trigger**

After a top-level Agent channel message without resolvable mentions is persisted, call a helper:

```rust
async fn start_next_pending_todo_for_channel(
    &self,
    channel_id: &str,
    trigger_message: &MessageRecord,
) -> Result<Option<String>, ChannelOrchestratorError>
```

Behavior:

- query oldest pending todo in `channel_id`.
- skip `trigger_message.author_id`.
- skip agents with active channel run in `channel_agent_runs`.
- start one run with trigger message prompt and pending todos.
- return started agent id for diagnostics/tests.

- [ ] **Step 6: Write orchestrator integration tests**

Add tests in `channel_orchestration_flow.rs`:

- mention run injects target agent's current-channel pending todos only.
- multi-mention run injects each target's own todos only.
- human no-mention message broadcast runs may inject existing todos but do not create an additional todo-only run.
- Agent no-mention message starts exactly one todo-only run when pending todos exist.
- todo-only run does not require delivery/claim on the trigger message.
- worker completed marks run todos `done`.
- worker failed and start failure restore todos to `pending`.
- reset while a todo-bound run is in flight clears todos; later worker events for the old run do not restore or complete cleared todos.

- [ ] **Step 7: Run orchestrator tests**

```sh
cargo test -p slei-daemon --test channel_orchestration_flow agent_message_todo
```

Expected: passes.

- [ ] **Step 8: Commit**

```sh
git add crates/slei-daemon/src/services/channel_orchestrator_service.rs crates/slei-daemon/src/services/agent_prompt_service.rs crates/slei-daemon/tests/channel_orchestration_flow.rs
git commit -m "feat(daemon): inject and advance agent message todos"
```

### Task 7: CLI Todo Commands And Message Range Args

**Files:**
- Modify: `crates/slei-cli/src/main.rs`

- [ ] **Step 1: Write failing CLI unit tests**

Add tests for:

- `slei-cli message read --channel "#all" --from-message msg_a --to-message msg_b` builds `/v1/messages/read?channel=all&fromMessage=msg_a&toMessage=msg_b`.
- `slei-cli todo list --agent agent_coda --channel "#all" --status pending` builds `GET /v1/agent-message-todos?agentId=agent_coda&channelId=all&status=pending`.
- `slei-cli todo show todo_123` builds `GET /v1/agent-message-todos/todo_123`.
- `slei-cli todo create --agent agent_coda --channel "#all" --message msg_1` builds `POST /v1/agent-message-todos`.
- `slei-cli todo update todo_123 --status done` builds `PATCH /v1/agent-message-todos/todo_123`.
- `slei-cli todo delete todo_123` builds `DELETE /v1/agent-message-todos/todo_123`.
- `slei-cli todo clear --agent agent_coda --channel "#all" --status pending` builds `POST /v1/agent-message-todos/clear`.

- [ ] **Step 2: Run CLI tests and verify failure**

```sh
cargo test -p slei-cli
```

Expected: fails because commands are missing.

- [ ] **Step 3: Add command enums and args**

Add to `Command`:

```rust
#[command(subcommand)]
Todo(TodoCommand),
```

Add:

```rust
#[derive(Debug, Subcommand)]
pub enum TodoCommand {
    List(TodoListArgs),
    Show { todo_id: String },
    Create(TodoCreateArgs),
    Update(TodoUpdateArgs),
    Delete { todo_id: String },
    Clear(TodoClearArgs),
}
```

Add `from_message` and `to_message` to `ReadArgs`:

```rust
#[arg(long)]
pub from_message: Option<String>,
#[arg(long)]
pub to_message: Option<String>,
```

- [ ] **Step 4: Implement execute_todo**

Use existing `DaemonClient` helpers:

- list/show use `get_json`.
- create uses `post_json_idempotent`.
- update uses `patch_json_idempotent`.
- delete uses a new `delete_json` helper if missing, or add one in `crates/slei-cli/src/client.rs`.
- clear uses `post_json_idempotent`.

Normalize channel args with `normalize_channel_arg`.

- [ ] **Step 5: Run CLI tests**

```sh
cargo test -p slei-cli
```

Expected: passes.

- [ ] **Step 6: Commit**

```sh
git add crates/slei-cli/src/main.rs crates/slei-cli/src/client.rs
git commit -m "feat(cli): add todo commands and message range reads"
```

### Task 8: ADR And Spec Alignment

**Files:**
- Modify: `docs/architecture/0005-channel-routing-and-multi-agent-flow.md`
- Optionally modify: `docs/superpowers/specs/2026-06-23-agent-message-todos-design.md` only if implementation discovers wording drift.

- [ ] **Step 1: Update ADR 0005**

Add a section after claim / Channel Group Address explaining:

- failed claim with existing delivery creates `agent_message_todos`.
- todo creation is not coordinator routing and not UI routing.
- processable channel messages, not only human messages, may create todos if they had delivery.
- top-level mention runs inject current-channel pending todos for each mentioned Agent.
- human no-mention keeps broadcast behavior and does not additionally start todo-only run.
- Agent no-mention messages may serially trigger one pending todo run.
- Pending Message Todos override the normal current-trigger claim/silence path.
- Agent must not claim todo source messages or current triggers solely for todo progression.
- `slei-cli message read --from-message --to-message` is available for inclusive context windows.

- [ ] **Step 2: Run architecture guardrails**

```sh
pnpm test:guardrails
```

Expected: passes.

- [ ] **Step 3: Commit**

```sh
git add docs/architecture/0005-channel-routing-and-multi-agent-flow.md docs/superpowers/specs/2026-06-23-agent-message-todos-design.md
git commit -m "docs: update channel routing todo guardrails"
```

### Task 9: Full Verification And Cleanup

**Files:**
- All files changed in previous tasks.

- [ ] **Step 1: Run formatting**

```sh
cargo fmt --check
```

Expected: passes. If it fails, run `cargo fmt`, inspect formatting-only diff, and rerun `cargo fmt --check`.

- [ ] **Step 2: Run focused Rust tests**

```sh
cargo test -p slei-storage
cargo test -p slei-daemon --test broadcast_claim_api
cargo test -p slei-daemon --test channel_orchestration_flow
cargo test -p slei-cli
```

Expected: all pass.

- [ ] **Step 3: Run guardrails**

```sh
pnpm test:guardrails
```

Expected: passes.

- [ ] **Step 4: Inspect final diff**

```sh
git status --short
git log --oneline -8
```

Expected: working tree clean after final commits; recent commits correspond to the tasks above.

- [ ] **Step 5: Record manual validation note**

In the final implementation summary, include:

- whether App was running during tests.
- exact test commands run.
- any tests skipped and why.
- note that Slei project policy requires asking whether to merge to `master` or another branch after completion.
