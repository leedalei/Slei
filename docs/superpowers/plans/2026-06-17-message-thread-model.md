# Unified Message Thread Model Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将频道和私聊统一为连续主消息流，并让任意主消息拥有一级 message thread；任务成为 message thread 的增强属性。

**Architecture:** daemon/SQLite 是 source of truth。新增 `message_threads` 与新版 `thread_replies` 语义，任务通过 `thread_id/source_message_id` 关联 thread。Desktop 只渲染 daemon DTO，使用 TanStack Virtual 展示主 timeline，不再展示或创建频道/私聊 session。

**Tech Stack:** Rust, Axum, SQLx/SQLite, Tauri commands, TypeScript, React, Vitest, TanStack Virtual, existing shadcn-style UI components.

---

## Knowledge Retrieval Results

**Search Context:** 统一 message thread、任务 thread、频道/私聊消息分页与虚拟列表。
**Keywords Used:** task-thread, message, session, daemon, react, channel-agent。
**Files Scanned:** 2 relevant docs.
**Relevant Matches:** 2.

### Relevant Knowledge

#### 1. 任务线程回复使用稳定 ID 和角色字段
- **File:** `docs/knowledge/best-practices/task-thread-stable-ids-and-reply-roles-20260529.md`
- **Relevance:** 新 `thread_replies` 必须保留稳定 ID、sender/role，不能依赖 `Date.now()`。
- **Key Insight:** thread/root/reply ID 应由 daemon 或稳定 source/reply 序号生成，测试要断言稳定 ID 和 role。
- **Severity:** medium

#### 2. 频道广播消息显示执行中但没有 Agent 回复
- **File:** `docs/knowledge/runtime-errors/channel-agent-broadcast-no-reply-20260617.md`
- **Relevance:** thread reply 必须走 daemon 路由/claim/run，不能依赖 worker stdout 或 UI 本地评论。
- **Key Insight:** 可见产品动作必须由 daemon API/CLI 写入，delivery/run 需要 terminal 状态与 diagnostics。
- **Severity:** high

---

## File Structure

### Daemon / Storage

- Modify: `crates/slei-storage/src/migrations.rs`
  Add migration 0007 include.
- Create: `crates/slei-storage/migrations/0007_message_threads.sql`
  Add `message_threads`, evolve `thread_replies`, add indexes, add `tasks.thread_id`.
- Modify: `crates/slei-storage/src/repositories/mod.rs`
  Add row structs and repository methods for message threads, thread replies, paged message reads, and task/thread joins.
- Create: `crates/slei-daemon/src/services/message_thread_service.rs`
  Own thread creation, source validation, reply append/list, summary aggregation, and non-nesting rules.
- Modify: `crates/slei-daemon/src/services/mod.rs`
  Export the new service.
- Modify: `crates/slei-daemon/src/state.rs`
  Construct and expose `message_threads()`.
- Modify: `crates/slei-daemon/src/app.rs`
  Register message thread routes.
- Create: `crates/slei-daemon/src/api/message_threads.rs`
  Add create/open thread, get thread, append reply endpoints.
- Modify: `crates/slei-daemon/src/api/mod.rs`
  Export the API module.
- Modify: `crates/slei-daemon/src/api/messages.rs`
  Return paged channel messages with `pageInfo`, `threadSummary`, `taskSummary`.
- Modify: `crates/slei-daemon/src/api/conversations.rs`
  Return paged DM messages with the same summary shape; accept `asTask` on DM sends.
- Modify: `crates/slei-daemon/src/services/message_service.rs`
  Add channel message paging helpers and source lookup support.
- Modify: `crates/slei-daemon/src/services/conversation_service.rs`
  Add DM message paging helpers, source lookup support, and `asTask` persistence/handling as needed.
- Modify: `crates/slei-daemon/src/services/task_service.rs`
  Ensure task creation creates/reuses message thread and stores `thread_id`.
- Modify: `crates/slei-daemon/src/services/channel_orchestrator_service.rs`
  Route thread replies through the same claim/run flow without writing them into the main timeline.
- Modify: `crates/slei-cli/src/main.rs`
  Add or update CLI support for message thread read/reply if agent prompt needs it.
- Modify: `crates/slei-daemon/src/services/agent_prompt_service.rs`
  Document thread target behavior for agents.

### Desktop / Tauri

- Modify: `apps/desktop/package.json`
  Add `@tanstack/react-virtual`.
- Modify: lockfile at repo root if package manager updates it.
- Modify: `apps/desktop/src/lib/daemon-bridge.ts`
  Add thread DTOs, paged message request types, thread APIs, and remove session-centric bridge use from chat path.
- Modify: `apps/desktop/src-tauri/src/commands.rs`
  Add thread commands and paged message command arguments.
- Modify: `apps/desktop/src-tauri/src/daemon_broker.rs`
  Proxy new daemon endpoints; offline broker returns empty continuous messages and rejects mutations.
- Modify: `apps/desktop/src/app/types.ts`
  Add `SleiMessage.thread`, `SleiThread`, `SleiThreadReply`, page info types.
- Modify: `apps/desktop/src/app/model.ts`
  Remove session filtering helpers from chat flow, forward DM `asTask`, add message merge/page helpers.
- Modify: `apps/desktop/src/app/SleiApp.tsx`
  Replace session creation/selection handlers with paged message and thread handlers.
- Modify: `apps/desktop/src/app/SleiAppFrame.tsx`
  Remove session props from chat route wiring.
- Modify: `apps/desktop/src/app/routes/ChatRoute.tsx`
  Pass new thread and paging props.
- Modify: `apps/desktop/src/features/chat/ChatPageView.tsx`
  Remove session UI, add message thread action, use virtualized timeline, show task/thread summaries.
- Modify: `apps/desktop/src/features/chat/TaskRootEntry.tsx`
  Rename or adapt to a generic source message row with optional task summary and no border.
- Create: `apps/desktop/src/features/chat/MessageThreadDrawer.tsx`
  Shared drawer for normal threads and task threads.
- Create: `apps/desktop/src/features/chat/VirtualMessageTimeline.tsx`
  TanStack Virtual wrapper for main timeline.
- Modify: `apps/desktop/src/features/tasks/TaskThreadDrawer.tsx`
  Either replace with `MessageThreadDrawer` or become a thin task-specific wrapper.
- Modify: `apps/desktop/src/i18n/types.ts`
- Modify: `apps/desktop/src/i18n/messages/zh-CN/chat.ts`
- Modify: `apps/desktop/src/i18n/messages/en-US/chat.ts`
  Add message thread labels and remove/stop using session labels in chat.

### Docs / Tests

- Modify: `docs/architecture/0006-task-source-message-card.md`
  Update ADR to message thread + task enhancement model.
- Potentially modify: `docs/architecture/0005-channel-routing-and-multi-agent-flow.md`
  Only if thread target syntax changes agent CLI/API instructions.
- Create: `crates/slei-daemon/tests/message_thread_api.rs`
- Modify: `crates/slei-daemon/tests/task_api.rs`
- Modify: `crates/slei-daemon/tests/task_service.rs`
- Modify: `crates/slei-daemon/tests/channel_orchestration_flow.rs`
- Modify: `apps/desktop/src/features/chat/ChatPageView.test.tsx`
- Modify: `apps/desktop/src/app/model.test.ts`
- Add or modify: `apps/desktop/e2e/task-thread-flow.spec.tsx`
- Add or modify: `apps/desktop/e2e/chat.spec.ts`

---

## Task 1: Storage Schema And Repository Contracts

**Files:**
- Create: `crates/slei-storage/migrations/0007_message_threads.sql`
- Modify: `crates/slei-storage/src/migrations.rs`
- Modify: `crates/slei-storage/src/repositories/mod.rs`
- Test: `crates/slei-storage/src/lib.rs` or new focused storage tests under `crates/slei-storage/tests/`

- [ ] **Step 1: Write failing storage tests**

Add tests covering:

```rust
#[tokio::test]
async fn message_thread_is_unique_per_source_message() {
    // insert a source message
    // ensure thread twice with different idempotency keys
    // assert same source_message_id maps to one thread
}

#[tokio::test]
async fn thread_reply_rows_keep_sender_role_and_stable_order() {
    // insert a source message and thread
    // insert replies with sender_id and role
    // assert replies are returned in sequence ASC
}

#[tokio::test]
async fn task_root_can_reference_message_thread() {
    // insert source, thread, task root
    // assert task row includes thread_id and source_message_id
}
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```bash
cargo test -p slei-storage message_thread -- --nocapture
```

Expected: FAIL because repository structs/methods and migration do not exist.

- [ ] **Step 3: Add migration**

Create `crates/slei-storage/migrations/0007_message_threads.sql`:

```sql
CREATE TABLE IF NOT EXISTS message_threads (
    id TEXT PRIMARY KEY,
    source_message_id TEXT NOT NULL UNIQUE,
    source_kind TEXT NOT NULL,
    source_id TEXT NOT NULL,
    created_by TEXT NOT NULL,
    reply_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_message_threads_source
    ON message_threads(source_kind, source_id, updated_at);

CREATE INDEX IF NOT EXISTS idx_message_threads_source_message_id
    ON message_threads(source_message_id);

ALTER TABLE tasks ADD COLUMN thread_id TEXT;

CREATE INDEX IF NOT EXISTS idx_tasks_thread_id
    ON tasks(thread_id);

CREATE TABLE IF NOT EXISTS message_thread_replies (
    id TEXT PRIMARY KEY,
    thread_id TEXT NOT NULL REFERENCES message_threads(id),
    sender_id TEXT NOT NULL,
    role TEXT NOT NULL,
    body TEXT NOT NULL,
    status TEXT,
    run_id TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_message_thread_replies_thread_id
    ON message_thread_replies(thread_id, rowid);
```

If SQLite rejects `rowid` inside index syntax in this form, use `created_at, id` ordering and keep `rowid` only in SELECT queries.

- [ ] **Step 4: Register migration**

Modify `crates/slei-storage/src/migrations.rs`:

```rust
pub const MIGRATION_0007: &str = include_str!("../migrations/0007_message_threads.sql");

pub const MIGRATIONS: &[(i64, &str)] = &[
    (1, MIGRATION_0001),
    (2, MIGRATION_0002),
    (3, MIGRATION_0003),
    (4, MIGRATION_0004),
    (5, MIGRATION_0005),
    (6, MIGRATION_0006),
    (7, MIGRATION_0007),
];
```

- [ ] **Step 5: Add repository rows and methods**

Add structs:

```rust
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MessageThreadRow {
    pub id: String,
    pub source_message_id: String,
    pub source_kind: String,
    pub source_id: String,
    pub created_by: String,
    pub reply_count: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MessageThreadReplyRow {
    pub id: String,
    pub thread_id: String,
    pub sender_id: String,
    pub role: String,
    pub body: String,
    pub status: Option<String>,
    pub run_id: Option<String>,
    pub created_at: String,
}
```

Add methods in `Repositories`:

```rust
pub async fn upsert_message_thread_idempotent(
    &self,
    row: MessageThreadRow,
    idempotency_key: &str,
    response_payload: &str,
) -> Result<(), sqlx::Error>;

pub async fn message_thread_by_source_message(
    &self,
    source_message_id: &str,
) -> Result<Option<MessageThreadRow>, sqlx::Error>;

pub async fn message_thread_by_id(
    &self,
    thread_id: &str,
) -> Result<Option<MessageThreadRow>, sqlx::Error>;

pub async fn message_threads_for_source_messages(
    &self,
    source_message_ids: &[String],
) -> Result<Vec<MessageThreadRow>, sqlx::Error>;

pub async fn insert_message_thread_reply_idempotent(
    &self,
    row: MessageThreadReplyRow,
    idempotency_key: &str,
    response_payload: &str,
) -> Result<(), sqlx::Error>;

pub async fn message_thread_replies(
    &self,
    thread_id: &str,
) -> Result<Vec<MessageThreadReplyRow>, sqlx::Error>;
```

Implementation detail: reply insert and thread `reply_count` update must be in the same transaction.

- [ ] **Step 6: Run storage tests and format**

Run:

```bash
cargo fmt
cargo test -p slei-storage message_thread -- --nocapture
```

Expected: PASS.

---

## Task 2: Daemon Message Thread Service

**Files:**
- Create: `crates/slei-daemon/src/services/message_thread_service.rs`
- Modify: `crates/slei-daemon/src/services/mod.rs`
- Modify: `crates/slei-daemon/src/state.rs`
- Modify: `crates/slei-daemon/src/services/message_service.rs`
- Modify: `crates/slei-daemon/src/services/conversation_service.rs`
- Test: `crates/slei-daemon/tests/message_thread_api.rs`

- [ ] **Step 1: Write failing daemon service/API tests**

Create `crates/slei-daemon/tests/message_thread_api.rs` with tests:

```rust
#[tokio::test]
async fn create_thread_from_channel_message_is_idempotent_and_not_a_task() {
    // create channel source message
    // POST /v1/message-threads/from-source-message twice
    // assert same thread id, replyCount 0
    // GET /v1/tasks?channelId=all returns no task for that source
}

#[tokio::test]
async fn create_thread_from_dm_message_is_idempotent_and_not_a_task() {
    // create agent + dm conversation + dm source message
    // POST /v1/message-threads/from-source-message twice
    // assert sourceKind dm, sourceId is conversation id
}

#[tokio::test]
async fn cannot_create_nested_thread_from_thread_reply() {
    // create source thread and a reply
    // POST /v1/message-threads/from-source-message with reply id
    // assert 400
}

#[tokio::test]
async fn thread_reply_updates_reply_count_and_preserves_role() {
    // POST reply with senderId/role/body
    // GET thread
    // assert replyCount and role
}
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
cargo test -p slei-daemon --test message_thread_api -- --nocapture
```

Expected: FAIL because routes and service do not exist.

- [ ] **Step 3: Add service types**

In `message_thread_service.rs`:

```rust
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageThreadSummaryView {
    pub id: String,
    pub source_message_id: String,
    pub source_kind: String,
    pub source_id: String,
    pub reply_count: usize,
    pub updated_at: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageThreadReplyView {
    pub id: String,
    pub thread_id: String,
    pub sender_id: String,
    pub role: String,
    pub body: String,
    pub status: Option<String>,
    pub run_id: Option<String>,
    pub created_at: String,
}

#[derive(Clone)]
pub struct MessageThreadService {
    repos: Repositories,
    messages: MessageService,
    conversations: ConversationService,
}
```

- [ ] **Step 4: Implement source validation**

Add a private source resolver:

```rust
enum ThreadSource {
    Channel { source_id: String },
    Dm { source_id: String },
}
```

Resolution order:

1. Try `MessageService::message(source_message_id)` for channel messages.
2. Try `ConversationService::message(source_message_id)` for DM messages. Add this helper if missing.
3. If the id belongs to a `message_thread_replies` row, return `InvalidThreadInput`.
4. Otherwise return `SourceMessageNotFound`.

- [ ] **Step 5: Implement ensure thread**

Method:

```rust
pub async fn ensure_thread_for_source_message(
    &self,
    source_message_id: &str,
    created_by: &str,
    idempotency_key: &str,
) -> Result<MessageThreadSummaryView, MessageThreadError>
```

Rules:

- Trim and validate input.
- Use idempotency namespace `message_thread:ensure`.
- If existing thread for source exists, return it.
- Generate stable-enough daemon ID with `thread_<uuid>`; do not use `Date.now()`.
- Persist via repository transaction.

- [ ] **Step 6: Implement replies**

Method:

```rust
pub async fn add_reply(
    &self,
    thread_id: &str,
    sender_id: &str,
    role: Option<&str>,
    body: &str,
    idempotency_key: &str,
) -> Result<MessageThreadReplyView, MessageThreadError>
```

Rules:

- Validate non-empty body.
- Default role from `sender_id`: `human:*` -> `human`, `agent*` -> `agent`, otherwise `system`.
- Stable reply id from daemon UUID or repository idempotency, not browser time.
- Persist and update thread reply count in one transaction.

- [ ] **Step 7: Wire state**

Add `message_threads` to `AppState` constructor and accessor:

```rust
pub fn message_threads(&self) -> &MessageThreadService {
    &self.message_threads
}
```

- [ ] **Step 8: Run tests**

Run:

```bash
cargo fmt
cargo test -p slei-daemon --test message_thread_api -- --nocapture
```

Expected: PASS.

---

## Task 3: Message Thread API And Paged Main Message Lists

**Files:**
- Create: `crates/slei-daemon/src/api/message_threads.rs`
- Modify: `crates/slei-daemon/src/api/mod.rs`
- Modify: `crates/slei-daemon/src/app.rs`
- Modify: `crates/slei-daemon/src/api/messages.rs`
- Modify: `crates/slei-daemon/src/api/conversations.rs`
- Modify: `crates/slei-daemon/src/services/message_service.rs`
- Modify: `crates/slei-daemon/src/services/conversation_service.rs`
- Test: `crates/slei-daemon/tests/message_thread_api.rs`
- Test: `crates/slei-daemon/tests/broadcast_claim_api.rs`

- [ ] **Step 1: Write failing paging tests**

Add tests:

```rust
#[tokio::test]
async fn channel_message_list_defaults_to_latest_fifty_and_pages_thirty_before_cursor() {
    // create 55 channel messages
    // GET /v1/channels/all/messages
    // assert messages 06..55 and pageInfo.hasMoreBefore true
    // GET ?before=<oldestCursor>
    // assert 01..05 and hasMoreBefore false
}

#[tokio::test]
async fn conversation_message_list_defaults_to_latest_fifty_and_pages_thirty_before_cursor() {
    // create 55 dm messages
    // assert same behavior for /v1/conversations/{id}/messages
}

#[tokio::test]
async fn message_list_around_message_id_returns_target_window_with_summaries() {
    // create many messages and a thread/task for target
    // GET ?aroundMessageId=<target>
    // assert target appears with threadSummary/taskSummary
}
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
cargo test -p slei-daemon --test broadcast_claim_api message_list -- --nocapture
```

Expected: FAIL because list endpoints return full session-based data and no `pageInfo`.

- [ ] **Step 3: Add page request/response types**

Use shared constants in daemon API:

```rust
const INITIAL_MESSAGE_LIMIT: i64 = 50;
const BEFORE_MESSAGE_LIMIT: i64 = 30;
```

Query:

```rust
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessagePageQuery {
    before: Option<i64>,
    around_message_id: Option<String>,
    limit: Option<i64>,
}
```

Response:

```rust
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PageInfo {
    pub has_more_before: bool,
    pub oldest_cursor: Option<i64>,
    pub newest_cursor: Option<i64>,
}
```

- [ ] **Step 4: Add sequence/cursor to message rows and views**

Channel and DM views should expose cursor:

```rust
#[serde(skip_serializing_if = "Option::is_none")]
sequence: Option<i64>,
```

Repository SELECTs should include `rowid AS sequence`.

- [ ] **Step 5: Implement channel paging**

Add `MessageService::channel_messages_page(channel_id, before, around, limit)` using rowid ordering:

- No cursor: latest 50 ordered ASC.
- `before`: latest 30 older than cursor ordered ASC.
- `aroundMessageId`: a centered window around target.

Do not filter by channel session.

- [ ] **Step 6: Implement DM paging**

Add `ConversationService::list_messages_page(conversation_id, before, around, limit)` using conversation message order/rowid.

Do not filter by conversation session.

- [ ] **Step 7: Attach summaries**

For each returned main message:

- Fetch `threadSummary` by source message id.
- Fetch `taskSummary` by source message id.
- Preserve existing cards/attachments logic.

- [ ] **Step 8: Add message thread API routes**

Register:

```rust
.route("/v1/message-threads/from-source-message", post(api::message_threads::create_from_source_message))
.route("/v1/message-threads/{id}", get(api::message_threads::get))
.route("/v1/message-threads/{id}/replies", post(api::message_threads::reply))
```

- [ ] **Step 9: Run focused API tests**

Run:

```bash
cargo fmt
cargo test -p slei-daemon --test message_thread_api -- --nocapture
cargo test -p slei-daemon --test broadcast_claim_api message_list -- --nocapture
```

Expected: PASS.

---

## Task 4: Task Service Uses Message Threads

**Files:**
- Modify: `crates/slei-daemon/src/services/task_service.rs`
- Modify: `crates/slei-daemon/src/api/tasks.rs`
- Modify: `crates/slei-daemon/src/services/channel_orchestrator_service.rs`
- Modify: `crates/slei-storage/src/repositories/mod.rs`
- Test: `crates/slei-daemon/tests/task_api.rs`
- Test: `crates/slei-daemon/tests/task_service.rs`
- Test: `crates/slei-daemon/tests/channel_orchestration_flow.rs`

- [ ] **Step 1: Write failing task/thread integration tests**

Add tests:

```rust
#[tokio::test]
async fn task_created_from_source_message_ensures_thread_and_returns_thread_summary() {
    // create source message
    // POST /v1/tasks/from-source-message
    // assert task.sourceMessageId and task.threadId
    // assert source message list contains both taskSummary and threadSummary
}

#[tokio::test]
async fn normal_thread_then_task_reuses_same_thread() {
    // create normal thread from source
    // create task from same source
    // assert task.threadId == existing thread id
}

#[tokio::test]
async fn task_then_normal_thread_open_reuses_task_thread_without_duplicate() {
    // create task from source
    // create/open normal thread from same source
    // assert same thread id and no second task
}
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
cargo test -p slei-daemon --test task_api task_created_from_source -- --nocapture
cargo test -p slei-daemon --test task_service source_message -- --nocapture
```

Expected: FAIL because tasks do not reference message threads yet.

- [ ] **Step 3: Add `thread_id` to task rows/views**

Update `TaskRootRow`, `TaskRecord`, `TaskSummaryView`, row mapping, JSON serialization.

Add field:

```rust
pub thread_id: Option<String>,
```

- [ ] **Step 4: Ensure thread before task create**

In task creation from source:

```rust
let thread = self
    .message_threads
    .ensure_thread_for_source_message(source_message_id, creator_id, idempotency_key)
    .await?;
```

Avoid circular service dependencies by either:

- Passing `MessageThreadService` into `TaskService`, or
- Moving source/thread ensure orchestration into an API-level/domain coordinator service.

Preferred: introduce a small `TaskThreadCoordinatorService` only if direct dependencies become tangled; otherwise keep it simple.

- [ ] **Step 5: Keep legacy task reply compatibility**

Until desktop is migrated:

- Existing `GET /v1/tasks/{id}/thread` must still work.
- It can read replies from new `message_thread_replies` when `thread_id` exists.
- It should fall back to old `task_replies` for legacy rows.

- [ ] **Step 6: Run task tests**

Run:

```bash
cargo fmt
cargo test -p slei-daemon --test task_api -- --nocapture
cargo test -p slei-daemon --test task_service -- --nocapture
```

Expected: PASS.

---

## Task 5: Thread Reply Routing And Agent Runtime

**Files:**
- Modify: `crates/slei-daemon/src/services/channel_orchestrator_service.rs`
- Modify: `crates/slei-daemon/src/services/claim_service.rs`
- Modify: `crates/slei-daemon/src/services/agent_prompt_service.rs`
- Modify: `crates/slei-cli/src/main.rs`
- Test: `crates/slei-daemon/tests/channel_orchestration_flow.rs`
- Test: `crates/slei-cli/tests/cli_args.rs`

- [ ] **Step 1: Write failing route tests**

Add tests:

```rust
#[tokio::test]
async fn thread_reply_with_visible_mention_launches_agent_without_main_timeline_message() {
    // create source message + thread
    // add reply "@coda please check"
    // assert route/run created
    // assert channel main messages do not include reply body
}

#[tokio::test]
async fn thread_reply_delivery_reaches_terminal_state() {
    // exercise worker completed/failed path for thread reply delivery
    // assert diagnostics and delivery terminal state
}
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
cargo test -p slei-daemon --test channel_orchestration_flow thread_reply -- --nocapture
```

Expected: FAIL because thread replies do not route yet.

- [ ] **Step 3: Define thread target syntax**

Use a target that cannot collide with main channel messages:

```text
target=#all:thread:<thread_id>
target=dm:<agent_id>:thread:<thread_id>
```

Update agent prompt docs to explain:

- claim/read/send semantics for thread replies.
- thread replies are visible only in thread.
- no nested thread creation from thread replies.

- [ ] **Step 4: Add orchestrator method**

Add:

```rust
pub async fn add_message_thread_reply_with_launch_guard(
    &self,
    thread_id: &str,
    sender_id: &str,
    role: Option<&str>,
    body: &str,
    idempotency_key: &str,
    launch_guard: &ResetActivityGuard,
) -> Result<AddMessageThreadReplyReceipt, ChannelOrchestratorError>
```

Internally:

1. Persist reply through `MessageThreadService`.
2. Build routing package from source message + thread context.
3. Create delivery/run like channel/task reply flow.
4. Do not write reply into `messages`.

- [ ] **Step 5: Add CLI support if needed**

If agents need to reply/read generic threads:

```bash
slei thread reply <thread-id> --agent <agent-id>
slei thread read <thread-id>
```

Tests in `crates/slei-cli/tests/cli_args.rs` should assert args parse correctly.

- [ ] **Step 6: Run routing tests**

Run:

```bash
cargo fmt
cargo test -p slei-daemon --test channel_orchestration_flow thread_reply -- --nocapture
cargo test -p slei-cli --test cli_args thread -- --nocapture
```

Expected: PASS.

---

## Task 6: Desktop Bridge And Tauri Commands

**Files:**
- Modify: `apps/desktop/src/lib/daemon-bridge.ts`
- Modify: `apps/desktop/src-tauri/src/commands.rs`
- Modify: `apps/desktop/src-tauri/src/daemon_broker.rs`
- Test: `apps/desktop/src/lib/daemon-bridge.test.ts`
- Test: Rust command tests if present in `apps/desktop/src-tauri/src/`

- [ ] **Step 1: Write failing bridge tests**

Add expectations for:

```ts
expect(bridge.listChannelMessages("all", { before: 10 })).to call list_channel_messages_command with before
expect(offlineBridge.createMessageThreadFromSource(...)).rejects.toThrow("daemon offline")
expect(offlineBridge.listChannelMessages("all")).resolves.toEqual({ messages: [], pageInfo: ... })
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
pnpm --filter @slei/desktop test -- src/lib/daemon-bridge.test.ts
```

Expected: FAIL before bridge APIs exist.

- [ ] **Step 3: Add DTOs**

Add:

```ts
export type MessagePageInfo = {
  hasMoreBefore: boolean;
  oldestCursor?: number;
  newestCursor?: number;
};

export type MessageThreadSummaryView = {
  id: string;
  sourceMessageId: string;
  sourceKind: "channel" | "dm" | string;
  sourceId: string;
  replyCount: number;
  updatedAt: string;
};

export type MessageThreadReplyView = {
  id: string;
  threadId: string;
  senderId: string;
  role: "human" | "agent" | "system" | string;
  body: string;
  status?: string;
  runId?: string;
  createdAt: string;
};
```

Extend `ChannelMessageView` and `ConversationMessageView` with:

```ts
sequence?: number;
thread?: MessageThreadSummaryView;
task?: TaskSummaryView;
```

- [ ] **Step 4: Change bridge methods**

Use options objects:

```ts
listChannelMessages(channelId: string, query?: { before?: number; aroundMessageId?: string; limit?: number }): Promise<ChannelMessageListReceipt>;
listConversationMessages(conversationId: string, query?: { before?: number; aroundMessageId?: string; limit?: number }): Promise<ConversationMessageListReceipt>;
createMessageThreadFromSource(request: { sourceMessageId: string; createdBy: string }): Promise<MessageThreadReceipt>;
getMessageThread(threadId: string): Promise<MessageThreadReceipt>;
replyToMessageThread(threadId: string, request: { senderId: string; role?: string; body: string }): Promise<MessageThreadReplyReceipt>;
```

- [ ] **Step 5: Tauri commands**

Add matching command functions and invoke names:

```ts
"create_message_thread_from_source_command"
"get_message_thread_command"
"reply_to_message_thread_command"
```

Update list message commands to accept query objects instead of `sessionId`.

- [ ] **Step 6: Offline broker**

Offline list should return:

```ts
{
  messages: [],
  pageInfo: { hasMoreBefore: false }
}
```

Mutations reject with `daemon offline`.

- [ ] **Step 7: Run bridge tests**

Run:

```bash
pnpm --filter @slei/desktop test -- src/lib/daemon-bridge.test.ts
```

Expected: PASS.

---

## Task 7: Desktop State Model And Message Paging

**Files:**
- Modify: `apps/desktop/src/app/types.ts`
- Modify: `apps/desktop/src/app/model.ts`
- Modify: `apps/desktop/src/app/SleiApp.tsx`
- Modify: `apps/desktop/src/app/SleiAppFrame.tsx`
- Modify: `apps/desktop/src/app/routes/ChatRoute.tsx`
- Test: `apps/desktop/src/app/model.test.ts`
- Test: `apps/desktop/src/app/SleiApp.test.ts`

- [ ] **Step 1: Write failing model tests**

Add tests:

```ts
it("merges older message pages before existing messages without duplicates", () => {});
it("replaces around-message window and keeps focused message", () => {});
it("forwards asTask for direct messages", async () => {});
it("does not filter visible chat messages by session id", () => {});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
pnpm --filter @slei/desktop test -- src/app/model.test.ts src/app/SleiApp.test.ts
```

Expected: FAIL before model changes.

- [ ] **Step 3: Extend app types**

In `apps/desktop/src/app/types.ts`:

```ts
export type SleiMessageThread = {
  id: string;
  sourceMessageId: string;
  sourceKind: "channel" | "dm" | string;
  sourceId: string;
  replyCount: number;
  updatedAt: string;
  replies?: SleiMessageThreadReply[];
  task?: SleiTask;
};

export type SleiMessageThreadReply = {
  id: string;
  threadId: string;
  sender: string;
  role?: SleiMessage["role"];
  body: string;
  status?: string;
  runId?: string;
  createdAt: string;
};
```

Extend `SleiMessage`:

```ts
sequence?: number;
thread?: SleiMessageThread;
task?: SleiTask;
```

Extend `SleiFixtures`:

```ts
messagePages?: Record<string, { hasMoreBefore: boolean; oldestCursor?: number; newestCursor?: number }>;
messageThreads?: SleiMessageThread[];
```

- [ ] **Step 4: Add merge helpers**

In `model.ts`:

```ts
export function mergeMessagePage(
  current: SleiMessage[],
  incoming: SleiMessage[],
  mode: "replace" | "prepend" | "append",
  sourceIds: string[],
): SleiMessage[] {
  // stable by message.id
  // replace removes current messages for sourceIds first
  // prepend inserts incoming before existing source messages
  // append inserts incoming after existing source messages
}
```

Also update `sendChatComposerMessage` so DM request includes:

```ts
asTask: Boolean(input.asTask)
```

- [ ] **Step 5: Remove session state from chat path**

In `SleiApp.tsx` and frame/route wiring:

- Stop passing `activeSessionId` to `ChatPage`.
- Stop calling `listChannelSessions`, `createChannelSession`, `activateChannelSession`, `listConversationSessions`, `createConversationSession`, `activateConversationSession` from chat UI flow.
- Keep runtime session APIs only for daemon/agent internals if other parts need them.
- Saved-message select should navigate by source id + message id, then use `aroundMessageId` if message is not loaded.

- [ ] **Step 6: Add thread handlers**

In `SleiApp.tsx`:

```ts
async function handleMessageThreadOpen(message: SleiMessage) {
  const receipt = message.thread
    ? await bridge.getMessageThread(message.thread.id)
    : await bridge.createMessageThreadFromSource({ sourceMessageId: message.id, createdBy: "human:local" });
  // merge thread into state and open drawer
}

async function handleMessageThreadReply(threadId: string, body: string) {
  const receipt = await bridge.replyToMessageThread(threadId, { senderId: "human:local", body });
  // merge reply and refresh source message/thread summary
}
```

- [ ] **Step 7: Run model/app tests**

Run:

```bash
pnpm --filter @slei/desktop test -- src/app/model.test.ts src/app/SleiApp.test.ts
```

Expected: PASS.

---

## Task 8: Desktop Chat UI And Shared Thread Drawer

**Files:**
- Modify: `apps/desktop/src/features/chat/ChatPageView.tsx`
- Modify: `apps/desktop/src/features/chat/TaskRootEntry.tsx`
- Create: `apps/desktop/src/features/chat/MessageThreadDrawer.tsx`
- Modify: `apps/desktop/src/features/tasks/TaskThreadDrawer.tsx`
- Modify: `apps/desktop/src/i18n/types.ts`
- Modify: `apps/desktop/src/i18n/messages/zh-CN/chat.ts`
- Modify: `apps/desktop/src/i18n/messages/en-US/chat.ts`
- Test: `apps/desktop/src/features/chat/ChatPageView.test.tsx`
- Test: `apps/desktop/src/features/chat/ThreadPanel.test.ts`

- [ ] **Step 1: Write failing UI tests**

Add tests:

```tsx
it("does not render new session or history controls in channel and DM headers", () => {});
it("shows asTask checkbox for DMs", () => {});
it("renders msg icon on main timeline messages", () => {});
it("does not render msg icon inside thread replies", () => {});
it("renders task source messages without a border", () => {});
it("opens a normal thread drawer without task status controls", async () => {});
it("opens a task thread drawer with status controls", async () => {});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
pnpm --filter @slei/desktop test -- src/features/chat/ChatPageView.test.tsx
```

Expected: FAIL before UI changes.

- [ ] **Step 3: Remove session UI**

In `ChatPageView.tsx`:

- Remove imports `History`, `Plus`, `Sheet`, `SheetClose`, `SheetContent`, `SheetHeader`, `SheetTitle` if unused.
- Remove props:
  - `activeSessionId`
  - `onChannelNewSession`
  - `onChannelSessionSelect`
  - `onConversationHistoryToggle`
  - `onConversationNewSession`
  - `onConversationSessionSelect`
  - `sessionDrawerOpen`
- Remove `activeSessions`, `sortedActiveSessions`, `activeSession`.
- Replace DM title:

```tsx
const detailTitle = dmMember ? dmMember.name : stripChannelHash(activeChannel.name);
```

- Replace subtitle:

```tsx
const detailSubtitle = dmMember
  ? dmMember.handle
  : activeChannel.projectName
    ? messages.chat.projectPrefix(activeChannel.projectName)
    : activeChannel.description;
```

- [ ] **Step 4: Stop session filtering and allow DM asTask**

Replace visible message calculation:

```tsx
const visibleMessages = filterConversationMessages(data.messages, {
  channel: activeTargetId,
});
```

Set:

```tsx
const allowAsTask = true;
```

Do not pass `sessionId` to `submitComposerDraftWithFeedback`.

- [ ] **Step 5: Add message thread action**

Use lucide `MessageSquare` or existing icon:

```tsx
<Button
  aria-label={message.thread ? messages.chat.openThread : messages.chat.startThread}
  data-testid="slei-message-thread-button"
  onClick={() => void onMessageThreadOpen?.(message)}
  size="icon-xs"
  title={message.thread ? messages.chat.openThread : messages.chat.startThread}
  type="button"
  variant="ghost"
>
  <MessageSquare aria-hidden="true" size={14} />
  {message.thread?.replyCount ? <span>{messages.chat.replyCount(message.thread.replyCount)}</span> : null}
</Button>
```

For task messages, reuse the same thread button and render status next to it.

- [ ] **Step 6: Create shared drawer**

`MessageThreadDrawer.tsx` props:

```ts
{
  open: boolean;
  sourceMessage?: SleiMessage;
  thread?: SleiMessageThread;
  task?: SleiTask;
  messages: DesktopMessages;
  mentionMembers: SleiMember[];
  onClose: () => void;
  onReply?: (threadId: string, body: string) => Promise<void> | void;
  onTaskStatusChange?: (taskId: string, status: SleiTaskStatus) => Promise<void> | void;
}
```

Do not render msg icon for replies.

- [ ] **Step 7: Remove task card border**

In `TaskRootEntry.tsx`, change article class from:

```tsx
"... rounded-lg border border-primary/30 ..."
```

to:

```tsx
"group grid grid-cols-[auto_minmax(0,1fr)] gap-3 rounded-lg px-2 py-2 text-sm transition-colors hover:bg-muted/50"
```

- [ ] **Step 8: Run UI tests**

Run:

```bash
pnpm --filter @slei/desktop test -- src/features/chat/ChatPageView.test.tsx
```

Expected: PASS.

---

## Task 9: TanStack Virtual Timeline

**Files:**
- Modify: `apps/desktop/package.json`
- Modify: package lockfile
- Create: `apps/desktop/src/features/chat/VirtualMessageTimeline.tsx`
- Modify: `apps/desktop/src/features/chat/ChatPageView.tsx`
- Test: `apps/desktop/src/features/chat/ChatPageView.test.tsx`
- E2E: `apps/desktop/e2e/chat.spec.ts`

- [ ] **Step 1: Install dependency**

Run:

```bash
pnpm --filter @slei/desktop add @tanstack/react-virtual
```

Expected: package manifest and lockfile update.

- [ ] **Step 2: Write failing virtual timeline tests**

Add tests asserting source includes/uses:

```ts
useVirtualizer
getItemKey
measureElement
scrollToIndex
```

Add DOM test with many messages:

```tsx
it("renders a bounded number of virtualized message rows for large histories", () => {
  // render 300 messages
  // assert rendered article count is well below 300 after layout mocks
});
```

- [ ] **Step 3: Run tests and verify failure**

Run:

```bash
pnpm --filter @slei/desktop test -- src/features/chat/ChatPageView.test.tsx
```

Expected: FAIL before virtual timeline exists.

- [ ] **Step 4: Implement VirtualMessageTimeline**

Core structure:

```tsx
const rowVirtualizer = useVirtualizer({
  count: messages.length,
  getScrollElement: () => scrollParentRef.current,
  estimateSize: () => 96,
  getItemKey: (index) => messages[index]?.id ?? index,
  measureElement: (element) => element.getBoundingClientRect().height,
  overscan: 8,
});
```

Render:

```tsx
<div ref={scrollParentRef} data-testid="slei-chat-timeline" className="min-h-0 overflow-auto">
  <div style={{ height: rowVirtualizer.getTotalSize(), position: "relative" }}>
    {rowVirtualizer.getVirtualItems().map((virtualRow) => {
      const message = messages[virtualRow.index];
      return (
        <div
          key={virtualRow.key}
          data-index={virtualRow.index}
          ref={rowVirtualizer.measureElement}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            transform: `translateY(${virtualRow.start}px)`,
          }}
        >
          {renderMessage(message)}
        </div>
      );
    })}
  </div>
</div>
```

- [ ] **Step 5: Add paging callbacks**

Props:

```ts
onLoadEarlier?: () => Promise<void> | void;
hasMoreBefore?: boolean;
loadingBefore?: boolean;
focusedMessageId?: string;
onFocusedMessageMissing?: (messageId: string) => Promise<void> | void;
```

When first virtual item index is near 0 and `hasMoreBefore`, call `onLoadEarlier`.

- [ ] **Step 6: Preserve scroll on prepend**

Use TanStack Virtual anchoring where available. If current package version does not expose `anchorTo`, manually preserve:

1. Before load, record first visible message id and its top offset.
2. After merge, find new index and `scrollToIndex`.
3. Adjust by measured offset if needed.

- [ ] **Step 7: Focused message behavior**

If `focusedMessageId` is loaded:

```ts
const index = messages.findIndex((message) => message.id === focusedMessageId);
rowVirtualizer.scrollToIndex(index, { align: "center" });
```

If missing, parent calls daemon with `aroundMessageId`, replaces/merges page, then retries.

- [ ] **Step 8: Run tests**

Run:

```bash
pnpm --filter @slei/desktop test -- src/features/chat/ChatPageView.test.tsx
pnpm --filter @slei/desktop lint
```

Expected: PASS.

---

## Task 10: ADR Updates

**Files:**
- Modify: `docs/architecture/0006-task-source-message-card.md`
- Potentially modify: `docs/architecture/0005-channel-routing-and-multi-agent-flow.md`

- [ ] **Step 1: Update ADR 0006**

Rewrite the title and decision sections to reflect:

- Message thread is the shared source-message child conversation model.
- Task is an enhancement on a source message thread.
- Normal message thread does not enter TASK.
- Task source message stays in place and no `task_card` message is created.
- Task card no longer requires border.
- `thread_replies`/`message_thread_replies` keep stable reply id and role.

- [ ] **Step 2: Update ADR 0005 only if target syntax changes**

If CLI/API introduces generic thread target syntax, update:

```text
slei thread read <thread-id>
slei thread reply <thread-id> --agent <agent-id>
```

and explain thread reply routing guardrails.

- [ ] **Step 3: Verify docs**

Run:

```bash
git diff --check docs/architecture/0006-task-source-message-card.md docs/architecture/0005-channel-routing-and-multi-agent-flow.md
```

Expected: no whitespace errors.

---

## Task 11: Full Verification

**Files:**
- All touched files.

- [ ] **Step 1: Run Rust formatting**

Run:

```bash
cargo fmt --check
```

Expected: PASS.

- [ ] **Step 2: Run daemon/storage tests**

Run:

```bash
cargo test -p slei-storage
cargo test -p slei-daemon --test message_thread_api
cargo test -p slei-daemon --test task_api
cargo test -p slei-daemon --test task_service
cargo test -p slei-daemon --test channel_orchestration_flow
cargo test -p slei-daemon --test broadcast_claim_api
```

Expected: PASS.

- [ ] **Step 3: Run desktop tests**

Run:

```bash
pnpm --filter @slei/desktop test -- src/app/model.test.ts src/lib/daemon-bridge.test.ts src/features/chat/ChatPageView.test.tsx
pnpm --filter @slei/desktop lint
```

Expected: PASS.

- [ ] **Step 4: Run targeted e2e**

Run:

```bash
pnpm --filter @slei/desktop test:e2e -- e2e/chat.spec.ts e2e/task-thread-flow.spec.tsx e2e/saved-messages.spec.tsx
```

Expected: PASS.

- [ ] **Step 5: Manual smoke test**

Check:

1. Channel header has no new-session/history controls.
2. DM header has no new-session/history controls.
3. DM composer can send as task.
4. Main message msg icon opens normal thread and does not create TASK entry.
5. Sending with as-task creates TASK entry and opens same thread model.
6. Thread replies do not appear in main timeline.
7. Thread replies with `@agent` trigger daemon routing.
8. Large message list scrolls smoothly, loads older 30 at top, and search/saved jump highlights target.

---

## Implementation Order

1. Task 1: Storage schema and repository contracts.
2. Task 2: Daemon message thread service.
3. Task 3: API and paged message lists.
4. Task 4: Task service integration.
5. Task 5: Thread reply routing.
6. Task 6: Desktop bridge and Tauri commands.
7. Task 7: Desktop state model and paging.
8. Task 8: Desktop chat UI and drawer.
9. Task 9: TanStack Virtual timeline.
10. Task 10: ADR updates.
11. Task 11: Full verification.

Do not start UI implementation before daemon DTOs and bridge contracts are tested. Do not remove old session storage tables in the first pass; first stop using them in new product paths and keep migration compatibility explicit.
