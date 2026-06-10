# Slei SQLite Reset Architecture Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 移除 production mock 数据，把可变产品状态统一收口到 daemon + SQLite，并提供可快捷执行的开发 reset。

**Architecture:** daemon 是业务逻辑和持久化唯一边界，UI 只展示 daemon DTO 和维护交互状态。SQLite 通过 `crates/slei-storage` 提供 schema、repository、事务 reset 和幂等记录；Tauri broker 只桥接 daemon，不再维护 JSON 产品数据库。

**Tech Stack:** Rust 2021、Tokio、Axum、SQLx SQLite、Tauri v2、React 19、TypeScript、Vitest、pnpm。

---

## 范围检查

这份计划覆盖一个顺序耦合的架构迁移，而不是多个互不相关的功能。每个 task 都必须能独立测试和提交，后续 task 依赖前面 task 产出的 SQLite schema、repository 或 daemon API。

实现时不要重写 UI 视觉，不要移除 JSON 协议序列化，不要删除 agent runtime 必须看到的 `MEMORY.md`、notes、`SKILL.md` 文件形态。

## 文件结构

### 新增文件

- `crates/slei-storage/migrations/0002_app_state.sql`: 新增 production app state 表和索引。
- `crates/slei-daemon/src/services/reset_service.rs`: daemon reset 业务逻辑，负责 DB 清空、旧 JSON 清理、agent workspace 删除。
- `crates/slei-daemon/src/api/dev.rs`: guarded dev reset API。
- `crates/slei-daemon/tests/dev_reset.rs`: reset 集成测试。
- `scripts/dev-reset.mjs`: 开发快捷 reset 命令。
- `scripts/verify-architecture-guardrails.mjs`: production mock/JSON 写入静态守护。
- `apps/desktop/src/app/types.ts`: production view model 类型，从 `fixtures.ts` 拆出。
- `apps/desktop/src/app/empty-data.ts`: production 空 view model factory。
- `apps/desktop/src/test/fixtures.ts`: UI 测试 fixture factory。

### 修改文件

- `AGENTS.md`: 已新增中文文档规范；实现过程中保持 daemon-first、SQLite-first 规范。
- `package.json`: 增加 `dev:reset` 和 `verify:architecture` 脚本。
- `crates/slei-storage/src/migrations.rs`: 引入 0002 migration。
- `crates/slei-storage/src/db.rs`: 支持多 migration、事务 reset、legacy repair 辅助。
- `crates/slei-storage/src/repositories/mod.rs`: 增加 app-state repository methods。
- `crates/slei-storage/src/lib.rs`: 增加 migration、repository、reset 测试。
- `crates/slei-daemon/src/services/mod.rs`: 导出 `reset_service`。
- `crates/slei-daemon/src/state.rs`: 持有共享 SQLite repositories/reset service，服务从同一个 data root 初始化。
- `crates/slei-daemon/src/app.rs`: 注册 `/v1/dev/reset`。
- `crates/slei-daemon/src/api/mod.rs`: 导出 `dev` API。
- `crates/slei-daemon/src/services/channel_service.rs`: 从 JSON 迁移到 SQLite。
- `crates/slei-daemon/src/services/message_service.rs`: 从 `channels/messages.json` 迁移到 SQLite。
- `crates/slei-daemon/src/services/task_service.rs`: 从内存迁移到 SQLite。
- `crates/slei-daemon/src/services/member_service.rs`: agent index 从 JSON 迁移到 SQLite，workspace 文件仍保留为文件。
- `crates/slei-daemon/src/services/card_service.rs`: 从 `cards/index.json` 迁移到 SQLite。
- `crates/slei-daemon/src/services/conversation_service.rs`: 从 conversation JSON 迁移到 SQLite。
- `crates/slei-daemon/src/services/settings_service.rs`: 从内存迁移到 SQLite。
- `crates/slei-daemon/src/services/node_service.rs`: 本机 node name 等可变状态迁移到 SQLite。
- `apps/desktop/src-tauri/src/daemon_broker.rs`: 移除 JSON fallback persistence 和 mock workspace fallback。
- `apps/desktop/src-tauri/src/commands.rs`: 如暴露 native dev reset，需要增加 guarded command。
- `apps/desktop/src/lib/daemon-bridge.ts`: production bridge 不再落到 broad mock；mock 只供测试。
- `apps/desktop/src/app/fixtures.ts`: 改为 test-only 或删除 production 导入。
- `apps/desktop/src/app/SleiApp.tsx`: 初始状态改为空 view model，production 数据只从 daemon refresh 进入。
- `apps/desktop/src/app/SleiAppFrame.tsx`: 类型导入从 `fixtures.ts` 切到 `types.ts`。
- `apps/desktop/src/features/**`: 类型导入从 `fixtures.ts` 切到 `types.ts`，保留展示逻辑。
- `apps/desktop/e2e/*.spec.*`、`apps/desktop/src/**/*.test.*`: 测试导入改到 `apps/desktop/src/test/fixtures.ts`。

## 约定

- 每个 task 完成后运行该 task 指定测试。
- 每个 task 单独提交，提交信息使用 `feat:`、`refactor:`、`test:` 或 `chore:`。
- SQL migration 必须可重复运行：新表用 `CREATE TABLE IF NOT EXISTS`，旧表新增列通过 Rust repair helper 检查后 `ALTER TABLE`。
- 旧 JSON 只允许 read-only import 或 reset cleanup。新写入路径只写 SQLite。
- 测试中允许 fixture/mock，但 production 源码不得依赖 fixture 默认数据填充界面。

---

### Task 1: SQLite migration runner 支持多版本

**Files:**
- Modify: `crates/slei-storage/src/migrations.rs`
- Modify: `crates/slei-storage/src/db.rs`
- Modify: `crates/slei-storage/src/lib.rs`

- [ ] **Step 1: 写失败测试，证明 migration runner 会记录多个版本**

在 `crates/slei-storage/src/lib.rs` 的 `#[cfg(test)] mod tests` 中新增：

```rust
#[tokio::test]
async fn migration_records_every_known_version() {
    let (url, _path) = sqlite_file_url("migration-versions");
    let db = SleiDb::connect(&url).await.unwrap();

    db.migrate().await.unwrap();

    let versions = sqlx::query_scalar::<_, i64>(
        "SELECT version FROM schema_migrations ORDER BY version ASC",
    )
    .fetch_all(db.pool())
    .await
    .unwrap();

    assert_eq!(versions, vec![1, 2]);
}
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cargo test -p slei-storage migration_records_every_known_version`

Expected: FAIL，`versions` 只有 `[1]` 或 0002 不存在。

- [ ] **Step 3: 增加 migration 常量列表**

在 `crates/slei-storage/src/migrations.rs` 保留 `MIGRATION_0001`，新增：

```rust
pub const MIGRATION_0002: &str = include_str!("../migrations/0002_app_state.sql");

pub const MIGRATIONS: &[(i64, &str)] = &[
    (1, MIGRATION_0001),
    (2, MIGRATION_0002),
];
```

如果 `include_str!` 路径不通过，使用相对 `src/migrations.rs` 的 `include_str!("../migrations/0002_app_state.sql")`。

- [ ] **Step 4: 新建空 0002 migration 文件**

Create `crates/slei-storage/migrations/0002_app_state.sql`:

```sql
CREATE TABLE IF NOT EXISTS app_metadata (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO schema_migrations(version) VALUES (2);
```

- [ ] **Step 5: 更新 migrate runner**

在 `crates/slei-storage/src/db.rs` 中把 `MIGRATION_0001` import 改为 `MIGRATIONS`，并让 `migrate()` 遍历所有 migration：

```rust
use crate::migrations::MIGRATIONS;

pub async fn migrate(&self) -> Result<(), sqlx::Error> {
    for (_version, migration) in MIGRATIONS {
        for statement in migration.split(';') {
            let statement = statement.trim();
            if !statement.is_empty() {
                sqlx::query(statement).execute(&self.pool).await?;
            }
        }
    }
    self.repair_legacy_sequence_columns().await?;
    self.repair_legacy_coordinator_columns().await?;
    Ok(())
}
```

- [ ] **Step 6: 运行 storage 测试**

Run: `cargo test -p slei-storage`

Expected: PASS。

- [ ] **Step 7: Commit**

```bash
git add crates/slei-storage/src/migrations.rs crates/slei-storage/src/db.rs crates/slei-storage/src/lib.rs crates/slei-storage/migrations/0002_app_state.sql
git commit -m "feat: support versioned sqlite migrations"
```

---

### Task 2: 增加 app-state SQLite schema 和 repository

**Files:**
- Modify: `crates/slei-storage/migrations/0002_app_state.sql`
- Modify: `crates/slei-storage/src/db.rs`
- Modify: `crates/slei-storage/src/repositories/mod.rs`
- Modify: `crates/slei-storage/src/lib.rs`

- [ ] **Step 1: 写失败测试，覆盖核心表**

在 `crates/slei-storage/src/lib.rs` 新增：

```rust
#[tokio::test]
async fn migration_creates_app_state_tables() {
    let (url, _path) = sqlite_file_url("app-state");
    let db = SleiDb::connect(&url).await.unwrap();
    db.migrate().await.unwrap();

    for table in [
        "agents",
        "channels",
        "channel_members",
        "channel_workspace_mounts",
        "conversations",
        "conversation_sessions",
        "conversation_messages",
        "conversation_attachments",
        "saved_messages",
        "interactive_cards",
        "user_preferences",
        "nodes",
    ] {
        assert!(db.table_exists(table).await.unwrap(), "missing {table}");
    }
}
```

- [ ] **Step 2: 写失败测试，证明 repository 能持久化 channel 和 agent**

在同一个 test module 中新增：

```rust
#[tokio::test]
async fn repositories_persist_agents_channels_and_memberships() {
    let (url, _path) = sqlite_file_url("agents-channels");
    let db = SleiDb::connect(&url).await.unwrap();
    db.migrate().await.unwrap();
    let repos = Repositories::new(db.pool().clone());

    repos
        .upsert_agent("agent_coda", "Coda", "@coda", "agent", false, "ClaudeCode", "Sonnet", "local-node", "开发", "agent_coda")
        .await
        .unwrap();
    repos
        .upsert_channel("all", "all", Some("默认团队频道"), true, "Controlled")
        .await
        .unwrap();
    repos
        .upsert_channel_member("all", "agent_coda", "ready")
        .await
        .unwrap();

    assert_eq!(repos.agents().await.unwrap()[0].id, "agent_coda");
    assert_eq!(repos.channels().await.unwrap()[0].id, "all");
    assert_eq!(repos.channel_members("all").await.unwrap()[0].agent_id, "agent_coda");
}
```

- [ ] **Step 3: 运行测试确认失败**

Run: `cargo test -p slei-storage app_state repositories_persist_agents_channels_and_memberships`

Expected: FAIL，表或 repository method 不存在。

- [ ] **Step 4: 扩展 0002 SQL**

将 `crates/slei-storage/migrations/0002_app_state.sql` 扩展为包含以下表。保留 `app_metadata` 和 `schema_migrations` 插入。

```sql
CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    handle TEXT NOT NULL UNIQUE,
    agent_kind TEXT NOT NULL DEFAULT 'agent',
    system_owned INTEGER NOT NULL DEFAULT 0,
    runtime_kind TEXT NOT NULL,
    model TEXT NOT NULL,
    node_id TEXT NOT NULL,
    description TEXT NOT NULL,
    workspace_path TEXT NOT NULL,
    memory_path TEXT NOT NULL,
    docs_path TEXT NOT NULL,
    avatar_seed TEXT NOT NULL,
    runtime_status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS channels (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    is_default INTEGER NOT NULL DEFAULT 0,
    permission TEXT NOT NULL DEFAULT 'Controlled',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS channel_members (
    channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    joined_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    readiness TEXT NOT NULL DEFAULT 'joining',
    PRIMARY KEY(channel_id, agent_id)
);

CREATE TABLE IF NOT EXISTS channel_workspace_mounts (
    channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    path TEXT NOT NULL,
    label TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(channel_id, path)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_channel_workspace_mounts_path
    ON channel_workspace_mounts(path);

CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    agent_id TEXT,
    active_session_id TEXT,
    runtime_status TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS conversation_sessions (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'ready',
    runtime_session_payload TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS conversation_attachments (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size INTEGER NOT NULL,
    url TEXT,
    cache_path TEXT,
    bytes_base64 TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS conversation_messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    session_id TEXT,
    author_id TEXT NOT NULL,
    body TEXT NOT NULL,
    status TEXT,
    run_id TEXT,
    attachment_ids TEXT NOT NULL DEFAULT '[]',
    cards_payload TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_conversation_messages_conversation_id
    ON conversation_messages(conversation_id);

CREATE TABLE IF NOT EXISTS saved_messages (
    id TEXT PRIMARY KEY,
    message_id TEXT NOT NULL,
    source_id TEXT NOT NULL,
    source_kind TEXT NOT NULL,
    session_id TEXT,
    saved_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(message_id)
);

CREATE TABLE IF NOT EXISTS interactive_cards (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    conversation_id TEXT,
    message_id TEXT,
    action_payload TEXT NOT NULL,
    template_payload TEXT,
    state TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_interactive_cards_run_id
    ON interactive_cards(run_id);

CREATE INDEX IF NOT EXISTS idx_interactive_cards_conversation_id
    ON interactive_cards(conversation_id);

CREATE TABLE IF NOT EXISTS user_preferences (
    profile_id TEXT PRIMARY KEY DEFAULT 'local',
    locale TEXT NOT NULL,
    time_zone TEXT NOT NULL,
    theme TEXT NOT NULL,
    font_size TEXT NOT NULL,
    notify_mentions INTEGER NOT NULL,
    notify_human_replies INTEGER NOT NULL,
    notify_approvals INTEGER NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS nodes (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    platform TEXT,
    arch TEXT,
    hostname TEXT,
    status TEXT NOT NULL DEFAULT 'connected',
    daemon_version TEXT,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO schema_migrations(version) VALUES (2);
```

- [ ] **Step 5: 修复现有表缺列**

在 `crates/slei-storage/src/db.rs` 增加 repair helper，给 0001 的 `messages`、`tasks`、`thread_replies` 补齐 service 需要的列：

```rust
async fn repair_legacy_app_state_columns(&self) -> Result<(), sqlx::Error> {
    self.add_column_if_missing("messages", "author_id", "TEXT").await?;
    self.add_column_if_missing("messages", "as_task", "INTEGER NOT NULL DEFAULT 0").await?;
    self.add_column_if_missing("messages", "edited", "INTEGER NOT NULL DEFAULT 0").await?;
    self.add_column_if_missing("tasks", "creator_id", "TEXT NOT NULL DEFAULT 'human:local'").await?;
    self.add_column_if_missing("tasks", "assignee_id", "TEXT").await?;
    self.add_column_if_missing("tasks", "source_message_id", "TEXT").await?;
    self.add_column_if_missing("tasks", "assignment_reason", "TEXT").await?;
    self.add_column_if_missing("tasks", "needs_assignment", "INTEGER NOT NULL DEFAULT 1").await?;
    self.add_column_if_missing("tasks", "attention_required", "INTEGER NOT NULL DEFAULT 1").await?;
    self.add_column_if_missing("tasks", "root_deleted", "INTEGER NOT NULL DEFAULT 0").await?;
    self.add_column_if_missing("tasks", "root_body", "TEXT NOT NULL DEFAULT ''").await?;
    self.add_column_if_missing("tasks", "updated_at", "TEXT NOT NULL DEFAULT ''").await?;
    self.add_column_if_missing("thread_replies", "sender_id", "TEXT").await?;
    self.add_column_if_missing("thread_replies", "role", "TEXT").await?;
    self.add_column_if_missing("thread_replies", "status", "TEXT").await?;
    sqlx::query("UPDATE tasks SET updated_at = created_at WHERE updated_at = ''")
        .execute(&self.pool)
        .await?;
    Ok(())
}

async fn add_column_if_missing(
    &self,
    table: &str,
    column: &str,
    definition: &str,
) -> Result<(), sqlx::Error> {
    if self.table_exists(table).await? && !self.column_exists(table, column).await? {
        let sql = format!("ALTER TABLE {table} ADD COLUMN {column} {definition}");
        sqlx::query(&sql).execute(&self.pool).await?;
    }
    Ok(())
}
```

在 `migrate()` 末尾调用 `self.repair_legacy_app_state_columns().await?;`。

- [ ] **Step 6: 增加 repository record 类型和 methods**

在 `crates/slei-storage/src/repositories/mod.rs` 顶部新增 record struct，保持字段和 daemon service record 接近：

```rust
impl std::fmt::Debug for Repositories {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.debug_struct("Repositories").finish()
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AgentRow {
    pub id: String,
    pub name: String,
    pub handle: String,
    pub agent_kind: String,
    pub system_owned: bool,
    pub runtime_kind: String,
    pub model: String,
    pub node_id: String,
    pub description: String,
    pub workspace_path: String,
    pub memory_path: String,
    pub docs_path: String,
    pub avatar_seed: String,
    pub runtime_status: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChannelRow {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub is_default: bool,
    pub permission: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChannelMemberRow {
    pub channel_id: String,
    pub agent_id: String,
    pub joined_at: String,
    pub readiness: String,
}
```

在 `impl Repositories` 中先实现 Task 2 测试需要的最小 methods：

```rust
pub async fn upsert_agent(
    &self,
    id: &str,
    name: &str,
    handle: &str,
    agent_kind: &str,
    system_owned: bool,
    runtime_kind: &str,
    model: &str,
    node_id: &str,
    description: &str,
    avatar_seed: &str,
) -> Result<(), sqlx::Error> {
    let workspace_path = format!("agents/{id}");
    let memory_path = format!("{workspace_path}/MEMORY.md");
    let docs_path = format!("{workspace_path}/docs");
    sqlx::query(
        "INSERT INTO agents(
            id, name, handle, agent_kind, system_owned, runtime_kind, model, node_id,
            description, workspace_path, memory_path, docs_path, avatar_seed, runtime_status
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ready')
         ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            handle = excluded.handle,
            description = excluded.description,
            updated_at = CURRENT_TIMESTAMP",
    )
    .bind(id)
    .bind(name)
    .bind(handle)
    .bind(agent_kind)
    .bind(if system_owned { 1 } else { 0 })
    .bind(runtime_kind)
    .bind(model)
    .bind(node_id)
    .bind(description)
    .bind(workspace_path)
    .bind(memory_path)
    .bind(docs_path)
    .bind(avatar_seed)
    .execute(&self.pool)
    .await?;
    Ok(())
}
```

同时实现 `agents()`, `upsert_channel()`, `channels()`, `upsert_channel_member()`, `channel_members()`。

- [ ] **Step 7: 运行 storage 测试**

Run: `cargo test -p slei-storage`

Expected: PASS。

- [ ] **Step 8: Commit**

```bash
git add crates/slei-storage/migrations/0002_app_state.sql crates/slei-storage/src/db.rs crates/slei-storage/src/repositories/mod.rs crates/slei-storage/src/lib.rs
git commit -m "feat: add sqlite app state tables"
```

---

### Task 3: 增加 SQLite reset primitive

**Files:**
- Modify: `crates/slei-storage/src/repositories/mod.rs`
- Modify: `crates/slei-storage/src/lib.rs`

- [ ] **Step 1: 写失败测试，证明 reset 保留 schema migrations 并清业务表**

在 `crates/slei-storage/src/lib.rs` 新增：

```rust
#[tokio::test]
async fn reset_mutable_state_preserves_schema_migrations() {
    let (url, _path) = sqlite_file_url("reset");
    let db = SleiDb::connect(&url).await.unwrap();
    db.migrate().await.unwrap();
    let repos = Repositories::new(db.pool().clone());

    repos
        .upsert_channel("all", "all", Some("默认团队频道"), true, "Controlled")
        .await
        .unwrap();
    repos
        .append_event("test.event", Uuid::new_v4(), "{}")
        .await
        .unwrap();

    repos.reset_mutable_state().await.unwrap();

    let channel_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM channels")
        .fetch_one(db.pool())
        .await
        .unwrap();
    let event_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM event_log")
        .fetch_one(db.pool())
        .await
        .unwrap();
    let migration_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM schema_migrations")
        .fetch_one(db.pool())
        .await
        .unwrap();

    assert_eq!(channel_count, 0);
    assert_eq!(event_count, 0);
    assert!(migration_count >= 2);
}
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cargo test -p slei-storage reset_mutable_state_preserves_schema_migrations`

Expected: FAIL，`reset_mutable_state` 不存在。

- [ ] **Step 3: 实现 reset_mutable_state**

在 `crates/slei-storage/src/repositories/mod.rs` 的 `impl Repositories` 中新增：

```rust
pub async fn reset_mutable_state(&self) -> Result<(), sqlx::Error> {
    let mut tx = self.pool.begin().await?;
    sqlx::query("PRAGMA defer_foreign_keys = ON").execute(&mut *tx).await?;
    for table in [
        "routing_context_packages",
        "memory_document_states",
        "memory_update_events",
        "agent_inbox_events",
        "coordinator_runtime_runs",
        "coordinator_decisions",
        "channel_coordinators",
        "idempotent_mutations",
        "event_log",
        "runtime_sessions",
        "thread_replies",
        "tasks",
        "messages",
        "saved_messages",
        "conversation_messages",
        "conversation_attachments",
        "conversation_sessions",
        "conversations",
        "interactive_cards",
        "channel_workspace_mounts",
        "channel_members",
        "channels",
        "agents",
        "user_preferences",
        "nodes",
        "app_metadata",
    ] {
        let sql = format!("DELETE FROM {table}");
        sqlx::query(&sql).execute(&mut *tx).await?;
    }
    tx.commit().await?;
    Ok(())
}
```

如果 SQLite 版本对 `PRAGMA defer_foreign_keys` 行为不一致，保持删除顺序从子表到父表，并删除该 PRAGMA。

- [ ] **Step 4: 运行 storage 测试**

Run: `cargo test -p slei-storage`

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add crates/slei-storage/src/repositories/mod.rs crates/slei-storage/src/lib.rs
git commit -m "feat: reset mutable sqlite state"
```

---

### Task 4: 增加 daemon ResetService 和 guarded dev reset API

**Files:**
- Create: `crates/slei-daemon/src/services/reset_service.rs`
- Create: `crates/slei-daemon/src/api/dev.rs`
- Create: `crates/slei-daemon/tests/dev_reset.rs`
- Modify: `crates/slei-daemon/src/services/mod.rs`
- Modify: `crates/slei-daemon/src/api/mod.rs`
- Modify: `crates/slei-daemon/src/app.rs`
- Modify: `crates/slei-daemon/src/state.rs`
- Modify: `crates/slei-daemon/src/services/agent_dm_service.rs`
- Modify: `crates/slei-daemon/src/services/channel_orchestrator_service.rs`
- Modify: `crates/slei-daemon/src/services/orchestration_store.rs`
- Modify: `crates/slei-daemon/src/adapters/claude_worker.rs`

- [ ] **Step 1: 写失败测试，reset API 默认禁用**

Create `crates/slei-daemon/tests/dev_reset.rs`:

```rust
use axum::body::Body;
use axum::body::to_bytes;
use slei_daemon::app::build_router;
use slei_daemon::auth::AuthToken;
use slei_daemon::state::AppState;
use tower::ServiceExt;

static ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

#[tokio::test]
async fn dev_reset_is_forbidden_without_env_guard() {
    let _guard = ENV_LOCK.lock().unwrap();
    std::env::remove_var("SLEI_ENABLE_DEV_RESET");
    let state = AppState::for_tests_with_agent_root_async(
        AuthToken::from_static("test-token"),
        tempfile_root("dev-reset-disabled"),
    )
    .await;
    let app = build_router(state);

    let response = app
        .oneshot(
            axum::http::Request::builder()
                .method("POST")
                .uri("/v1/dev/reset")
                .header("authorization", "Bearer test-token")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), axum::http::StatusCode::FORBIDDEN);
}

fn tempfile_root(label: &str) -> std::path::PathBuf {
    std::env::temp_dir().join(format!("slei-{label}-{}", uuid::Uuid::new_v4()))
}
```

Add `uuid` is already dependency. If `uuid` is not visible in integration test, use `slei_daemon` dependency tree or add `uuid.workspace = true` under `crates/slei-daemon/Cargo.toml` dev-dependencies.

所有读写 `SLEI_ENABLE_DEV_RESET` 的测试都必须先获取 `ENV_LOCK`，避免 Rust 并行测试互相污染 env var。

- [ ] **Step 2: 运行测试确认失败**

Run: `cargo test -p slei-daemon dev_reset_is_forbidden_without_env_guard`

Expected: FAIL，route 不存在或 compile fail。

- [ ] **Step 3: 实现 ResetService receipt**

Create `crates/slei-daemon/src/services/reset_service.rs`:

```rust
use serde::Serialize;
use slei_storage::repositories::Repositories;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Clone, Debug)]
pub struct ResetService {
    data_root: PathBuf,
    repos: Repositories,
    quiescer: RuntimeQuiescer,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ResetReceipt {
    pub database_reset: bool,
    pub removed_paths: Vec<String>,
    pub remaining_paths: Vec<String>,
}

impl ResetService {
    pub fn new(data_root: PathBuf, repos: Repositories, quiescer: RuntimeQuiescer) -> Self {
        Self { data_root, repos, quiescer }
    }

    pub async fn reset_development_state(&self) -> Result<ResetReceipt, ResetError> {
        let _guard = self.quiescer.quiesce_for_reset().await?;
        self.repos.reset_mutable_state().await.map_err(ResetError::Database)?;
        let mut removed_paths = Vec::new();
        let mut remaining_paths = Vec::new();

        for path in self.reset_paths() {
            if !path.exists() {
                continue;
            }
            match remove_path(&path) {
                Ok(()) => removed_paths.push(display_path(&path)),
                Err(_) => remaining_paths.push(display_path(&path)),
            }
        }

        fs::create_dir_all(&self.data_root).map_err(ResetError::Io)?;
        Ok(ResetReceipt {
            database_reset: true,
            removed_paths,
            remaining_paths,
        })
    }

    fn reset_paths(&self) -> Vec<PathBuf> {
        vec![
            self.data_root.join("agents"),
            self.data_root.join("channels"),
            self.data_root.join("conversations"),
            self.data_root.join("attachments"),
            self.data_root.join("cards"),
            self.data_root.join("settings"),
            self.data_root.join("saved"),
        ]
    }
}

fn remove_path(path: &Path) -> std::io::Result<()> {
    if path.is_dir() {
        fs::remove_dir_all(path)
    } else {
        fs::remove_file(path)
    }
}

fn display_path(path: &Path) -> String {
    path.to_string_lossy().to_string()
}

#[derive(Clone, Debug, Default)]
pub struct RuntimeQuiescer {
    // Wire this to existing coordinator/DM run state in AppState.
}

impl RuntimeQuiescer {
    pub async fn quiesce_for_reset(&self) -> Result<ResetGuard, ResetError>;
}

pub struct ResetGuard {}

#[derive(Debug, thiserror::Error)]
pub enum ResetError {
    #[error("reset database error: {0}")]
    Database(sqlx::Error),
    #[error("reset io error: {0}")]
    Io(std::io::Error),
    #[error("reset runtime quiesce error: {0}")]
    Runtime(String),
}
```

`RuntimeQuiescer` 不能保持空实现。执行 Task 4 时必须把它接到现有 coordinator/DM worker 状态上，至少做到：

- reset 开始后，新 run launch 返回 `reset in progress` 或等价错误。
- 已知 active coordinator runtime runs 被标为 cancelled 或 failed，不再继续追加 output。
- 已知 active Agent DM runs 被取消或忽略后续 worker event。
- `handle_worker_event` 在 reset-in-progress 时丢弃或拒绝旧 run event，避免清库后旧事件重新写入。

具体实现拆分：

- 在 `reset_service.rs` 中增加共享 `ResetRuntimeState`：

```rust
#[derive(Clone, Debug, Default)]
pub struct ResetRuntimeState {
    inner: std::sync::Arc<tokio::sync::RwLock<ResetRuntimeInner>>,
}

#[derive(Debug, Default)]
struct ResetRuntimeInner {
    generation: u64,
    resetting: bool,
    cancelled_runs: std::collections::HashSet<String>,
}

impl ResetRuntimeState {
    pub async fn is_resetting(&self) -> bool;
    pub async fn generation(&self) -> u64;
    pub async fn mark_run_cancelled(&self, run_id: &str);
    pub async fn is_run_cancelled(&self, run_id: &str) -> bool;
}
```

- `RuntimeQuiescer` 持有 `ResetRuntimeState`、`AgentDmRunStore`、`OrchestrationStore` 和 `ClaudeWorkerAdapter`。
- 给 `AgentDmRunStore` 增加 `active_run_ids()` 和 `cancel_all_for_reset()`；取消时从内存 active runs 删除，并调用 `ClaudeWorkerAdapter::cancel_run(run_id)`。
- 给 `OrchestrationStore`/repositories 增加 `pending_coordinator_runtime_run_ids()` 和 `cancel_pending_coordinator_runs_for_reset()`，把 pending/running coordinator runs 标为 `cancelled` 或 `failed`。
- 在 `AgentDmService::start_for_human_message` 和 `ChannelOrchestratorService::send_channel_message` 启动 run 前检查 `ResetRuntimeState::is_resetting()`，reset 期间返回明确错误。
- 在 `AgentDmService::handle_worker_event` 和 `ChannelOrchestratorService::handle_coordinator_worker_event` 开头检查 `cancelled_runs` 和 `resetting`；匹配时直接返回 `Ok(())`，不得写 DB。
- 在 `AppState::handle_worker_event` 进入时也检查 stale/cancelled run id，作为统一兜底。

- [ ] **Step 4: 注册 service 到 AppState**

在 `crates/slei-daemon/src/services/mod.rs` 添加：

```rust
pub mod reset_service;
```

在 `crates/slei-daemon/src/state.rs` 增加字段和 getter：

```rust
use crate::services::reset_service::ResetService;

reset_service: ResetService,

pub fn reset(&self) -> &ResetService {
    &self.reset_service
}
```

在 `with_agent_root_and_store` 中用同一个 data root 构造。为了拿到 `Repositories`，给 `OrchestrationStore` 增加 `repos()` getter，或在 `state.rs` 中显式初始化 `SleiDb`/`Repositories` 后同时传给 orchestration 和 reset。推荐后者，在后续服务迁移时复用。

- [ ] **Step 5: 实现 guarded API**

Create `crates/slei-daemon/src/api/dev.rs`:

```rust
use axum::extract::State;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::json;

use crate::state::AppState;

pub async fn reset(State(state): State<AppState>, headers: axum::http::HeaderMap) -> Response {
    if !state.auth_token.is_authorized(&headers) {
        return axum::http::StatusCode::UNAUTHORIZED.into_response();
    }
    if std::env::var("SLEI_ENABLE_DEV_RESET").ok().as_deref() != Some("1") {
        return (
            axum::http::StatusCode::FORBIDDEN,
            Json(json!({ "error": "development reset is disabled" })),
        )
            .into_response();
    }
    match state.reset().reset_development_state().await {
        Ok(receipt) => Json(json!({ "reset": receipt })).into_response(),
        Err(error) => (
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": error.to_string() })),
        )
            .into_response(),
    }
}
```

- [ ] **Step 6: 注册 route**

在 `crates/slei-daemon/src/api/mod.rs` 添加：

```rust
pub mod dev;
```

在 `crates/slei-daemon/src/app.rs` 添加：

```rust
.route("/v1/dev/reset", axum::routing::post(api::dev::reset))
```

- [ ] **Step 7: 扩展成功 reset 测试**

在 `crates/slei-daemon/tests/dev_reset.rs` 增加：

```rust
#[tokio::test]
async fn dev_reset_clears_database_and_agent_workspace_when_enabled() {
    let _guard = ENV_LOCK.lock().unwrap();
    std::env::set_var("SLEI_ENABLE_DEV_RESET", "1");
    let root = tempfile_root("dev-reset-enabled");
    std::fs::create_dir_all(root.join("agents/agent_coda/docs")).unwrap();
    std::fs::write(root.join("agents/agent_coda/MEMORY.md"), "old memory").unwrap();
    std::fs::create_dir_all(root.join("channels")).unwrap();
    std::fs::write(root.join("channels/index.json"), "[]").unwrap();

    let state = AppState::for_tests_with_agent_root_async(
        AuthToken::from_static("test-token"),
        root.clone(),
    )
    .await;
    state
        .channels()
        .create_channel(
            slei_daemon::services::channel_service::ChannelDraft {
                name: "dev".to_string(),
                description: None,
                permission: slei_daemon::services::channel_service::PermissionPreset::Controlled,
            },
            "reset-channel",
        )
        .await
        .unwrap();
    let app = build_router(state);

    let response = app
        .oneshot(
            axum::http::Request::builder()
                .method("POST")
                .uri("/v1/dev/reset")
                .header("authorization", "Bearer test-token")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), axum::http::StatusCode::OK);
    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["reset"]["databaseReset"], true);
    assert!(!root.join("agents/agent_coda/MEMORY.md").exists());
    assert!(!root.join("channels/index.json").exists());
    assert!(!root.join("attachments/index.json").exists());
    std::env::remove_var("SLEI_ENABLE_DEV_RESET");
}
```

再新增 stale worker event 测试，确保 reset 后旧事件不会重新写入：

```rust
#[tokio::test]
async fn dev_reset_ignores_stale_worker_events_after_cleanup() {
    let _guard = ENV_LOCK.lock().unwrap();
    std::env::set_var("SLEI_ENABLE_DEV_RESET", "1");
    let root = tempfile_root("dev-reset-stale-event");
    let state = AppState::for_tests_with_agent_root_async(
        AuthToken::from_static("test-token"),
        root.clone(),
    )
    .await;

    state
        .orchestration()
        .create_coordinator_runtime_run("coord_run_stale", "all", "msg_stale", "idem-stale", "prompt")
        .await
        .unwrap();
    state
        .handle_worker_event(serde_json::json!({
            "type": "output_delta",
            "run_id": "coord_run_stale",
            "delta": "{\"action\":\"noop\""
        }))
        .await
        .unwrap();

    let app = build_router(state.clone());
    let response = app
        .oneshot(
            axum::http::Request::builder()
                .method("POST")
                .uri("/v1/dev/reset")
                .header("authorization", "Bearer test-token")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), axum::http::StatusCode::OK);

    state
        .handle_worker_event(serde_json::json!({
            "type": "completed",
            "run_id": "coord_run_stale"
        }))
        .await
        .unwrap();

    assert!(state
        .orchestration()
        .coordinator_runtime_run("coord_run_stale")
        .await
        .unwrap()
        .is_none());
    std::env::remove_var("SLEI_ENABLE_DEV_RESET");
}
```

这个测试必须失败直到 `RuntimeQuiescer`、run cancellation 和 stale event guard 都接好。

- [ ] **Step 8: 运行 daemon reset 测试**

Run: `cargo test -p slei-daemon dev_reset`

Expected: PASS。

- [ ] **Step 9: Commit**

```bash
git add crates/slei-daemon/src/services/reset_service.rs crates/slei-daemon/src/api/dev.rs crates/slei-daemon/src/services/mod.rs crates/slei-daemon/src/api/mod.rs crates/slei-daemon/src/app.rs crates/slei-daemon/src/state.rs crates/slei-daemon/tests/dev_reset.rs crates/slei-daemon/Cargo.toml
git commit -m "feat: add guarded development reset"
```

---

### Task 5: 增加快捷 reset 脚本

**Files:**
- Create: `scripts/dev-reset.mjs`
- Modify: `package.json`

- [ ] **Step 1: 写失败检查**

Run: `pnpm dev:reset --help`

Expected: FAIL，script 不存在。

- [ ] **Step 2: 增加 root script**

Modify `package.json`:

```json
{
  "scripts": {
    "dev:reset": "node scripts/dev-reset.mjs",
    "verify:architecture": "node scripts/verify-architecture-guardrails.mjs"
  }
}
```

保留已有 `test`、`typecheck`、`lint`。

- [ ] **Step 3: 实现脚本**

Create `scripts/dev-reset.mjs`:

```js
#!/usr/bin/env node

const endpoint = process.env.SLEI_DAEMON_ENDPOINT ?? "http://127.0.0.1:4319";
const token = process.env.SLEI_DAEMON_TOKEN ?? "desktop-session-token";

if (process.argv.includes("--help")) {
  console.log("Usage: SLEI_ENABLE_DEV_RESET=1 pnpm dev:reset");
  console.log("Calls POST /v1/dev/reset on the local Slei daemon.");
  process.exit(0);
}

if (process.env.SLEI_ENABLE_DEV_RESET !== "1") {
  console.error("Refusing to reset: set SLEI_ENABLE_DEV_RESET=1");
  process.exit(2);
}

const response = await fetch(`${endpoint}/v1/dev/reset`, {
  method: "POST",
  headers: {
    authorization: `Bearer ${token}`,
  },
});

const text = await response.text();
if (!response.ok) {
  console.error(text);
  process.exit(1);
}

console.log(text);
```

- [ ] **Step 4: 验证 help**

Run: `pnpm dev:reset --help`

Expected: PASS，输出 usage，不触发 reset。

- [ ] **Step 5: 验证 guard**

Run: `pnpm dev:reset`

Expected: FAIL exit 2，输出 `Refusing to reset`。

- [ ] **Step 6: Commit**

```bash
git add package.json scripts/dev-reset.mjs
git commit -m "chore: add development reset command"
```

---

### Task 6: 迁移 ChannelService 和 MessageService 到 SQLite

**Files:**
- Modify: `crates/slei-storage/src/repositories/mod.rs`
- Modify: `crates/slei-daemon/src/services/channel_service.rs`
- Modify: `crates/slei-daemon/src/services/message_service.rs`
- Modify: `crates/slei-daemon/src/state.rs`
- Modify: `crates/slei-daemon/tests/channel_chat.rs`
- Modify: `crates/slei-daemon/tests/channel_coordinator.rs`

- [ ] **Step 1: 写失败测试，production channel/message 不再写 JSON**

在 `crates/slei-daemon/tests/channel_chat.rs` 新增：

```rust
#[tokio::test]
async fn channel_and_message_services_do_not_write_json_snapshots() {
    let root = std::env::temp_dir().join(format!("slei-no-channel-json-{}", uuid::Uuid::new_v4()));
    let state = AppState::for_tests_with_agent_root_async(
        AuthToken::from_static("test-token"),
        root.clone(),
    )
    .await;

    state
        .channels()
        .create_channel(
            ChannelDraft {
                name: "dev".to_string(),
                description: Some("Dev".to_string()),
                permission: PermissionPreset::Controlled,
            },
            "channel-json-test",
        )
        .await
        .unwrap();
    state
        .messages()
        .create_human_channel_message("dev", "human:local", "hello", "message-json-test", false)
        .await
        .unwrap();

    assert!(!root.join("channels/index.json").exists());
    assert!(!root.join("channels/members.json").exists());
    assert!(!root.join("channels/workspaces.json").exists());
    assert!(!root.join("channels/messages.json").exists());
}
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cargo test -p slei-daemon channel_and_message_services_do_not_write_json_snapshots`

Expected: FAIL，因为现有 service 会写 JSON。

- [ ] **Step 3: 补 repository methods**

在 `Repositories` 中实现：

```rust
pub async fn delete_channel(&self, channel_id: &str) -> Result<(), sqlx::Error>;
pub async fn upsert_channel_workspace_mount(&self, channel_id: &str, path: &str, label: &str) -> Result<(), sqlx::Error>;
pub async fn channel_workspace_mounts(&self, channel_id: &str) -> Result<Vec<WorkspaceMountRow>, sqlx::Error>;
pub async fn update_channel_member_readiness(&self, channel_id: &str, agent_id: &str, readiness: &str) -> Result<(), sqlx::Error>;
pub async fn remove_channel_member(&self, channel_id: &str, agent_id: &str) -> Result<Option<ChannelMemberRow>, sqlx::Error>;
pub async fn remove_agent_from_channel_memberships(&self, agent_id: &str) -> Result<(), sqlx::Error>;
pub async fn insert_channel_message(&self, row: NewChannelMessageRow) -> Result<(), sqlx::Error>;
pub async fn channel_messages_by_channel(&self, channel_id: &str) -> Result<Vec<ChannelMessageRow>, sqlx::Error>;
pub async fn update_message_tombstone(&self, message_id: &str) -> Result<(), sqlx::Error>;
pub async fn update_human_message_body(&self, message_id: &str, body: &str) -> Result<(), sqlx::Error>;
```

Use `messages` table from 0001 plus repaired columns. Map `kind` values to existing service strings: `human`, `agent`, `task_card`, `tombstone`.

- [ ] **Step 4: 修改 ChannelService 构造函数**

将 `ChannelService` 改为持有 `Repositories`，保留内存中的 idempotency map：

```rust
#[derive(Clone, Debug)]
pub struct ChannelService {
    repos: Repositories,
    idempotency: Arc<Mutex<ChannelIdempotencyState>>,
}
```

保留 `for_tests()`，让它创建临时 SQLite DB。新增 `new(repos: Repositories)` 给 `AppState` 使用。

- [ ] **Step 5: 修改 ChannelService methods**

逐个把 `load_channels`、`persist_channels`、`load_members`、`persist_members`、`load_workspaces`、`persist_workspaces` 的调用替换为 repository calls。

重要行为：

- `list_channels()` 从 SQLite 读 channels，并附加 workspace paths。
- `create_channel()` 用 SQLite unique constraint 和 service-level normalize 检查 duplicate。
- `ensure_default_channel()` 只在 daemon 初始化或 list/create 前调用 repository upsert，创建空 id `all`。
- `add_agent_to_channel_with_outcome()` 查 channel 是否存在，插入 `channel_members`，重复加入返回 `created=false`。
- `mount_workspace()` 使用 `channel_workspace_mounts.path` unique index 拒绝重复 path。

- [ ] **Step 6: 修改 MessageService 构造函数**

将 `MessageService::persistent(data_root)` 替换为 SQLite 构造：

```rust
pub fn persistent(repos: Repositories) -> Self
```

保留 `MessageService::for_tests()` 用 in-memory 或临时 SQLite。推荐测试也使用 SQLite，减少双路径。

- [ ] **Step 7: 修改 MessageService methods**

把 `persist_messages()` 和 `load_persisted_messages()` 删除。`create_human_channel_message`、`create_agent_channel_message`、`create_task_card_message`、`channel_messages`、`delete_human_message`、`edit_human_message`、`message`、`reconstructed_context` 都通过 repository。

保留内存 idempotency map 仅作短期缓存；后续 Task 9 迁入 `idempotent_mutations`。

- [ ] **Step 8: 修改 AppState 初始化**

在 `state.rs` 中用共享 `Repositories` 初始化：

```rust
let repos = repositories_blocking(data_root.clone());
let orchestration_store = OrchestrationStore::new(repos.clone());
let channel_service = ChannelService::new(repos.clone());
let message_service = MessageService::persistent(repos.clone());
let reset_runtime_state = ResetRuntimeState::default();
let agent_dm_runs = AgentDmRunStore::default();
let worker_adapter = ClaudeWorkerAdapter::new(worker_transport.clone());
let reset_service = ResetService::new(
    data_root.clone(),
    repos.clone(),
    RuntimeQuiescer::new(
        reset_runtime_state.clone(),
        agent_dm_runs.clone(),
        orchestration_store.clone(),
        worker_adapter.clone(),
    ),
);
```

`repositories_blocking` 负责 connect `data_root/slei.sqlite` 并 migrate。

- [ ] **Step 9: 运行相关 daemon 测试**

Run:

```bash
cargo test -p slei-daemon channel_chat
cargo test -p slei-daemon channel_coordinator
cargo test -p slei-daemon channel_orchestration_flow
```

Expected: PASS。

- [ ] **Step 10: Commit**

```bash
git add crates/slei-storage/src/repositories/mod.rs crates/slei-daemon/src/services/channel_service.rs crates/slei-daemon/src/services/message_service.rs crates/slei-daemon/src/state.rs crates/slei-daemon/tests/channel_chat.rs crates/slei-daemon/tests/channel_coordinator.rs
git commit -m "refactor: persist channels and messages in sqlite"
```

---

### Task 7: 迁移 TaskService 到 SQLite

**Files:**
- Modify: `crates/slei-storage/src/repositories/mod.rs`
- Modify: `crates/slei-daemon/src/services/task_service.rs`
- Modify: `crates/slei-daemon/src/state.rs`
- Modify: `crates/slei-daemon/tests/task_api.rs`
- Modify: `crates/slei-daemon/tests/task_service.rs`

- [ ] **Step 1: 写失败测试，task reload 后仍存在**

在 `crates/slei-daemon/tests/task_service.rs` 新增：

```rust
#[tokio::test]
async fn tasks_survive_service_reload() {
    let root = std::env::temp_dir().join(format!("slei-task-reload-{}", uuid::Uuid::new_v4()));
    let first = AppState::for_tests_with_agent_root_async(
        AuthToken::from_static("test-token"),
        root.clone(),
    )
    .await;
    let task = first
        .tasks()
        .create_task_root("all", "human:local", "持久化任务", "task-reload-key")
        .await
        .unwrap();
    first.tasks().add_reply(&task.id, "human:local", "reply", "reply-reload-key").await.unwrap();

    let second = AppState::for_tests_with_agent_root_async(
        AuthToken::from_static("test-token"),
        root,
    )
    .await;
    let thread = second.tasks().thread_view(&task.id).await.unwrap();

    assert_eq!(thread.task.title, "持久化任务");
    assert_eq!(thread.replies.len(), 1);
}
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cargo test -p slei-daemon tasks_survive_service_reload`

Expected: FAIL，因为 TaskService 当前是内存。

- [ ] **Step 3: 补 repository task methods**

在 `Repositories` 中实现：

```rust
pub async fn upsert_task_root(&self, row: TaskRootRow) -> Result<(), sqlx::Error>;
pub async fn task_by_id(&self, task_id: &str) -> Result<Option<TaskRootRow>, sqlx::Error>;
pub async fn task_by_source_message(&self, source_message_id: &str) -> Result<Option<TaskRootRow>, sqlx::Error>;
pub async fn list_tasks(&self, query: TaskQueryRow) -> Result<Vec<TaskRootRow>, sqlx::Error>;
pub async fn update_task_status(&self, task_id: &str, status: &str) -> Result<(), sqlx::Error>;
pub async fn update_task_assignment(&self, task_id: &str, assignee_id: Option<&str>, needs_assignment: bool, attention_required: bool, status: &str) -> Result<(), sqlx::Error>;
pub async fn update_task_attention(&self, task_id: &str, required: bool) -> Result<(), sqlx::Error>;
pub async fn mark_task_root_deleted(&self, task_id: &str) -> Result<(), sqlx::Error>;
pub async fn insert_task_reply(&self, row: TaskReplyRow) -> Result<(), sqlx::Error>;
pub async fn task_replies(&self, task_id: &str) -> Result<Vec<TaskReplyRow>, sqlx::Error>;
```

Use existing `tasks` and `thread_replies` tables plus repaired columns.

现有 0001 schema 有硬约束：

- `tasks.root_message_id TEXT NOT NULL REFERENCES messages(id)`
- `thread_replies.author_message_id TEXT NOT NULL REFERENCES messages(id)`

`TaskService::create_task_root` 支持没有 source message 的 standalone task，所以 SQLite 实现必须采用 synthetic message rows，而不是直接插入空 `root_message_id`。

具体策略：

- standalone task root 创建 synthetic root message：
  - id: `task_root_msg_<task_id>`
  - channel_id: task channel
  - author_kind: `human`
  - author_id: creator id
  - kind: `task_root`
  - content/body: task title/root body
  - deleted: `0`
- coordinator-created task 如果有 `source_message_id` 且 messages 表存在该 message，就用真实 source message 作为 `root_message_id`；否则同样创建 synthetic root message，并把 `source_message_id` 存在 repaired task column。
- task reply 创建 synthetic author message：
  - id: `task_reply_msg_<reply_id>`
  - channel_id: task channel
  - author_kind: 由 sender id 推断 human/agent/system
  - author_id: sender id
  - kind: `task_reply`
  - content/body: reply body
  - deleted: `0`
  - `thread_replies.author_message_id` 引用这个 synthetic message id。
- `TaskService::thread_view` 仍从 `tasks.root_body` 和 `thread_replies` 组装 task thread，不把 synthetic messages 渲染到外层 channel timeline。

在 repository methods 中把 synthetic message insert 和 task/reply insert 放入同一个 SQLite transaction，避免 FK 半成品。

- [ ] **Step 4: 修改 TaskService 构造函数**

把 `TaskService` 改为：

```rust
#[derive(Clone, Debug)]
pub struct TaskService {
    repos: Repositories,
    idempotency: Arc<Mutex<TaskIdempotencyState>>,
}
```

保留 idempotency map 直到 Task 9。新增 `TaskService::new(repos: Repositories)`。

- [ ] **Step 5: 替换内存 HashMap 读写**

把 `tasks`、`replies` 的读写替换为 repository calls，保持 public API 和 DTO 不变：

- `create_task_root`
- `create_from_coordinator`
- `add_reply_with_task`
- `thread_view`
- `task_summary`
- `update_status`
- `assign`
- `set_attention_required`
- `list_tasks`
- `list_task_summaries`
- `board`
- `delete_task_root`
- `task`
- `task_for_source_message`

- [ ] **Step 6: 修改 AppState 使用 SQLite TaskService**

在 `state.rs` 中用 `TaskService::new(repos.clone())` 替换 `TaskService::for_tests()`。

- [ ] **Step 7: 运行 task 测试**

Run:

```bash
cargo test -p slei-daemon task_service
cargo test -p slei-daemon task_api
cargo test -p slei-daemon task_board
```

Expected: PASS。

- [ ] **Step 8: Commit**

```bash
git add crates/slei-storage/src/repositories/mod.rs crates/slei-daemon/src/services/task_service.rs crates/slei-daemon/src/state.rs crates/slei-daemon/tests/task_api.rs crates/slei-daemon/tests/task_service.rs
git commit -m "refactor: persist tasks in sqlite"
```

---

### Task 8: 迁移 MemberService、CardService、SettingsService、NodeService

**Files:**
- Modify: `crates/slei-storage/src/repositories/mod.rs`
- Modify: `crates/slei-daemon/src/services/member_service.rs`
- Modify: `crates/slei-daemon/src/services/card_service.rs`
- Modify: `crates/slei-daemon/src/services/settings_service.rs`
- Modify: `crates/slei-daemon/src/services/node_service.rs`
- Modify: `crates/slei-daemon/src/state.rs`
- Modify: `crates/slei-daemon/tests/guide_bootstrap.rs`
- Modify: `crates/slei-daemon/tests/interactive_cards.rs`
- Modify: `crates/slei-daemon/tests/settings_identity.rs`
- Modify: `crates/slei-daemon/tests/capabilities.rs`

- [ ] **Step 1: 写失败测试，agent/card/settings reload 后仍存在且不写 JSON**

在对应测试文件中新增断言：

```rust
assert!(!root.join("agents/index.json").exists());
assert!(!root.join("cards/index.json").exists());
assert!(!root.join("settings/preferences.json").exists());
```

并新增 reload 测试：第一次 `AppState` 创建 agent、card、preferences，第二次用同一 root 初始化后能读回。

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
cargo test -p slei-daemon guide_bootstrap interactive_cards settings_identity
```

Expected: FAIL，JSON 文件存在或 reload 丢状态。

- [ ] **Step 3: 补 repository methods**

实现以下 methods。`InteractiveCardRow` 必须能完整还原当前 `InteractiveCard`，不要只保存 `InteractiveCardView` 的展示字段：

```rust
pub async fn agent_by_id(&self, id: &str) -> Result<Option<AgentRow>, sqlx::Error>;
pub async fn agent_by_handle(&self, handle: &str) -> Result<Option<AgentRow>, sqlx::Error>;
pub async fn delete_agent(&self, id: &str) -> Result<(), sqlx::Error>;
pub async fn update_agent(&self, row: AgentUpdateRow) -> Result<(), sqlx::Error>;
pub async fn upsert_interactive_card(&self, row: InteractiveCardRow) -> Result<(), sqlx::Error>;
pub async fn interactive_card(&self, id: &str) -> Result<Option<InteractiveCardRow>, sqlx::Error>;
pub async fn interactive_cards(&self) -> Result<Vec<InteractiveCardRow>, sqlx::Error>;
pub async fn upsert_user_preferences(&self, row: UserPreferencesRow) -> Result<(), sqlx::Error>;
pub async fn user_preferences(&self) -> Result<Option<UserPreferencesRow>, sqlx::Error>;
pub async fn upsert_node(&self, row: NodeRow) -> Result<(), sqlx::Error>;
pub async fn node(&self, id: &str) -> Result<Option<NodeRow>, sqlx::Error>;
pub async fn nodes(&self) -> Result<Vec<NodeRow>, sqlx::Error>;
```

`InteractiveCardRow` 结构必须包含：

```rust
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InteractiveCardRow {
    pub id: String,
    pub run_id: String,
    pub agent_id: String,
    pub conversation_id: Option<String>,
    pub message_id: Option<String>,
    pub action_payload: String,
    pub template_payload: Option<String>,
    pub state: String,
}
```

`action_payload` 存 `CardAction` 的 JSON string，`template_payload` 存 `InteractiveCardTemplate` 的 JSON string。这样 reload 后可以恢复 `run_id`、`agent_id`、`conversation_id`、`message_id`、`action`、`view` 和 `state`，不会丢失执行或关联信息。

- [ ] **Step 4: 迁移 MemberService**

保留 workspace 文件创建逻辑，但 agent index 改为 SQLite：

- `load_product_agents` 只作为 legacy import helper，迁移后不再写 `agents/index.json`。
- `persist_product_agents` 删除或改成 no-op migration-only helper。
- `create_product_agent` 写 SQLite `agents`，然后创建 workspace 文件。
- `list_product_agents` 从 SQLite 读。
- `update_product_agent` 更新 SQLite。
- `delete_product_agent` 删除 SQLite row，并删除 channel memberships；workspace 删除交给 reset 或 delete 行为按现有产品要求处理。

- [ ] **Step 5: 迁移 CardService**

把 `cards/index.json` 读写替换为 `interactive_cards` repository。序列化 `CardAction` 和 `InteractiveCardTemplate` 到 SQLite TEXT 字段是允许的，因为它是单行 payload 字段，不是 JSON 文件数据库。

`CardService::card()` 和 `propose_product_tool_card()` reload 后必须能返回与迁移前等价的 `InteractiveCard`/`InteractiveCardView`。`decide()` 和 `complete()` 必须保留已有幂等语义，并通过 Task 10 的 `idempotent_mutations` 做 restart-safe 幂等。

- [ ] **Step 6: 迁移 SettingsService**

把 `SettingsState.preferences` 初始化改为 repository lookup，缺省仍使用当前 default preferences。所有 setter 更新 SQLite。`preferences()` 从 repository 读，或维护短期 cache 并同步写 SQLite。

- [ ] **Step 7: 迁移 NodeService**

保留 runtime/device 探测，但 local node name 等可变字段写 SQLite `nodes`。`rename_local_node` 更新 repository。列表时优先合并探测信息和 SQLite name。

- [ ] **Step 8: 运行相关测试**

Run:

```bash
cargo test -p slei-daemon guide_bootstrap
cargo test -p slei-daemon interactive_cards
cargo test -p slei-daemon settings_identity
cargo test -p slei-daemon capabilities
```

Expected: PASS。

- [ ] **Step 9: Commit**

```bash
git add crates/slei-storage/src/repositories/mod.rs crates/slei-daemon/src/services/member_service.rs crates/slei-daemon/src/services/card_service.rs crates/slei-daemon/src/services/settings_service.rs crates/slei-daemon/src/services/node_service.rs crates/slei-daemon/src/state.rs crates/slei-daemon/tests/guide_bootstrap.rs crates/slei-daemon/tests/interactive_cards.rs crates/slei-daemon/tests/settings_identity.rs crates/slei-daemon/tests/capabilities.rs
git commit -m "refactor: persist agents cards settings and nodes in sqlite"
```

---

### Task 9: 迁移 ConversationService 和 saved messages 到 SQLite

**Files:**
- Modify: `crates/slei-storage/src/repositories/mod.rs`
- Modify: `crates/slei-daemon/src/services/conversation_service.rs`
- Modify: `crates/slei-daemon/src/state.rs`
- Modify: `crates/slei-daemon/tests/agent_workspace.rs`
- Modify: `crates/slei-daemon/tests/agent_dm_service.rs` if present
- Modify: `crates/slei-daemon/tests/message_deletion.rs`

- [ ] **Step 1: 写失败测试，conversation reload 后仍存在且不写 JSON**

在 conversation 相关测试中新增：

```rust
assert!(!root.join("conversations/index.json").exists());
assert!(!root.join("conversations/sessions.json").exists());
assert!(!root.join("saved/messages.json").exists());
assert!(!root.join("conversations/messages").exists());
assert!(!root.join("attachments/index.json").exists());
```

并用同一 root 初始化两次 `AppState`，确认 DM conversation、session、message、saved message、attachment metadata 和 attachment `cache_path` 可读回。调用 `ConversationService::prompt_with_attachments()` 时，reload 后的 prompt 仍必须包含附件名和 cache path。

- [ ] **Step 2: 运行测试确认失败**

Run: `cargo test -p slei-daemon conversation`

Expected: FAIL 或 compile failure，根据现有测试命名调整为具体 test 名。

- [ ] **Step 3: 补 repository conversation methods**

实现：

```rust
pub async fn upsert_conversation(&self, row: ConversationRow) -> Result<(), sqlx::Error>;
pub async fn conversations(&self) -> Result<Vec<ConversationRow>, sqlx::Error>;
pub async fn conversation(&self, id: &str) -> Result<Option<ConversationRow>, sqlx::Error>;
pub async fn upsert_conversation_session(&self, row: ConversationSessionRow) -> Result<(), sqlx::Error>;
pub async fn conversation_sessions(&self, conversation_id: &str) -> Result<Vec<ConversationSessionRow>, sqlx::Error>;
pub async fn insert_conversation_message(&self, row: ConversationMessageRow) -> Result<(), sqlx::Error>;
pub async fn conversation_messages(&self, conversation_id: &str) -> Result<Vec<ConversationMessageRow>, sqlx::Error>;
pub async fn upsert_conversation_attachment(&self, row: ConversationAttachmentRow) -> Result<(), sqlx::Error>;
pub async fn conversation_attachment(&self, id: &str) -> Result<Option<ConversationAttachmentRow>, sqlx::Error>;
pub async fn upsert_saved_message(&self, row: SavedMessageRow) -> Result<(), sqlx::Error>;
pub async fn delete_saved_message(&self, message_id: &str) -> Result<(), sqlx::Error>;
pub async fn saved_messages(&self) -> Result<Vec<SavedMessageRow>, sqlx::Error>;
```

`ConversationAttachmentRow` 必须完整保留当前 `ConversationAttachmentRecord`：

```rust
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConversationAttachmentRow {
    pub id: String,
    pub name: String,
    pub mime_type: String,
    pub size: u64,
    pub url: Option<String>,
    pub cache_path: Option<String>,
    pub bytes_base64: Option<String>,
}
```

- [ ] **Step 4: 迁移 ConversationService**

把 file helpers `load_local_*_at_root` 和 `persist_local_*_at_root` 改为 legacy import-only 或删除。所有 public methods 继续返回原 DTO。

`attachment_ids` 和 `cards_payload` 存 SQLite TEXT JSON 字段是允许的，因为这是 row payload，不是 JSON 文件数据库。

附件迁移要求：

- 上传附件时继续把缓存文件写到 data root 的 `attachments/<attachment_id>/<filename>`。
- SQLite `conversation_attachments.cache_path` 保存缓存文件路径。
- `ConversationMessageRecord.attachments` 从 SQLite attachment ids 还原。
- `ConversationService::prompt_with_attachments()` reload 后仍能输出 cache path。
- 旧 `attachments/index.json` 只能作为 migration import 输入，迁移后不得再写。
- reset cleanup 必须删除 `attachments/index.json` 和整个 runtime-generated `attachments/` 目录。

- [ ] **Step 5: 运行 conversation/DM 测试**

Run:

```bash
cargo test -p slei-daemon agent_workspace
cargo test -p slei-daemon message_deletion
cargo test -p slei-daemon agent_dm
```

Expected: PASS。若 `agent_dm` test target 名不同，使用 `cargo test -p slei-daemon dm`。

- [ ] **Step 6: Commit**

```bash
git add crates/slei-storage/src/repositories/mod.rs crates/slei-daemon/src/services/conversation_service.rs crates/slei-daemon/src/state.rs crates/slei-daemon/tests/agent_workspace.rs crates/slei-daemon/tests/message_deletion.rs
git commit -m "refactor: persist conversations in sqlite"
```

---

### Task 10: 持久化幂等记录并清理 service 内存幂等依赖

**Files:**
- Modify: `crates/slei-storage/src/repositories/mod.rs`
- Modify: `crates/slei-daemon/src/services/channel_service.rs`
- Modify: `crates/slei-daemon/src/services/message_service.rs`
- Modify: `crates/slei-daemon/src/services/task_service.rs`
- Modify: `crates/slei-daemon/src/services/card_service.rs`
- Modify: `crates/slei-daemon/tests/recovery.rs`
- Modify: `crates/slei-daemon/tests/task_api.rs`
- Modify: `crates/slei-daemon/tests/channel_chat.rs`
- Modify: `crates/slei-daemon/tests/interactive_cards.rs`

- [ ] **Step 1: 写失败测试，daemon reload 后幂等 key 仍生效**

在 `crates/slei-daemon/tests/recovery.rs` 新增：

```rust
#[tokio::test]
async fn idempotent_mutations_survive_daemon_reload() {
    let root = std::env::temp_dir().join(format!("slei-idempotency-{}", uuid::Uuid::new_v4()));
    let first = AppState::for_tests_with_agent_root_async(
        AuthToken::from_static("test-token"),
        root.clone(),
    )
    .await;
    let first_message = first
        .messages()
        .create_human_channel_message("all", "human:local", "hello", "idem-message", false)
        .await
        .unwrap();

    let second = AppState::for_tests_with_agent_root_async(
        AuthToken::from_static("test-token"),
        root,
    )
    .await;
    let second_message = second
        .messages()
        .create_human_channel_message("all", "human:local", "hello", "idem-message", false)
        .await
        .unwrap();

    assert_eq!(first_message.id, second_message.id);
}
```

在 `crates/slei-daemon/tests/interactive_cards.rs` 新增 card 幂等 reload 测试：

```rust
#[tokio::test]
async fn card_proposal_idempotency_survives_daemon_reload() {
    let root = std::env::temp_dir().join(format!("slei-card-idem-{}", uuid::Uuid::new_v4()));
    let first = AppState::for_tests_with_agent_root_async(
        AuthToken::from_static("test-token"),
        root.clone(),
    )
    .await;
    let first_card = first
        .cards()
        .propose_card(
            CardProposal {
                run_id: "run_1".to_string(),
                agent_id: "agent_coda".to_string(),
                action: CardAction::CreateAgent {
                    name: "Coda".to_string(),
                    permission: "Controlled".to_string(),
                },
            },
            "card-idem",
        )
        .await
        .unwrap();

    let second = AppState::for_tests_with_agent_root_async(
        AuthToken::from_static("test-token"),
        root,
    )
    .await;
    let second_card = second
        .cards()
        .propose_card(
            CardProposal {
                run_id: "run_1".to_string(),
                agent_id: "agent_coda".to_string(),
                action: CardAction::CreateAgent {
                    name: "Coda".to_string(),
                    permission: "Controlled".to_string(),
                },
            },
            "card-idem",
        )
        .await
        .unwrap();

    assert_eq!(first_card.id, second_card.id);
}
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cargo test -p slei-daemon idempotent_mutations_survive_daemon_reload`

Expected: FAIL，因为 idempotency map 是内存。

- [ ] **Step 3: 增加 idempotency repository helpers**

在 `Repositories` 中实现基础 helpers，并额外提供“mutation + idempotency 同事务”的 helpers：

```rust
pub async fn idempotent_response(&self, key: &str) -> Result<Option<String>, sqlx::Error>;
pub async fn record_idempotent_response(&self, key: &str, entity_id: &str, response_payload: &str) -> Result<(), sqlx::Error>;
```

response payload 使用 `serde_json::to_string` 存储 receipt 或 entity id 列表。

同事务要求是硬约束：创建 message/task/card/channel 等 mutation 与 `idempotent_mutations` 写入必须在同一个 SQLite transaction 中完成。不要先写业务表、再单独调用 `record_idempotent_response()`，否则 crash 后 retry 会重复创建。

推荐添加 repository methods，例如：

```rust
pub async fn insert_channel_message_idempotent(
    &self,
    idempotency_key: &str,
    row: NewChannelMessageRow,
    response_payload: &str,
) -> Result<(), sqlx::Error>;

pub async fn insert_task_idempotent(
    &self,
    idempotency_key: &str,
    row: TaskRootRow,
    response_payload: &str,
) -> Result<(), sqlx::Error>;

pub async fn upsert_interactive_card_idempotent(
    &self,
    idempotency_key: &str,
    row: InteractiveCardRow,
    response_payload: &str,
) -> Result<(), sqlx::Error>;
```

这些 methods 内部必须 `BEGIN` transaction，先检查/写业务 row，再写 `idempotent_mutations`，最后 `COMMIT`。如果 `idempotency_key` 已存在，service 直接反序列化 existing response，不再执行 mutation。

- [ ] **Step 4: 替换 service 内存幂等**

在 channel/message/task/card service 中：

- 进入 mutation 时先查 `idempotent_mutations`。
- 创建成功后在同一个 SQLite transaction 内写入 response payload。
- 保留内存 map 只作为性能 cache，不能作为唯一来源；或直接删除内存 map。
- `CardService::propose_card`、`propose_product_tool_card`、`decide`、`complete` 都必须使用 durable idempotency。

- [ ] **Step 5: 运行恢复相关测试**

Run:

```bash
cargo test -p slei-daemon recovery
cargo test -p slei-daemon task_api
cargo test -p slei-daemon channel_chat
cargo test -p slei-daemon interactive_cards
```

Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add crates/slei-storage/src/repositories/mod.rs crates/slei-daemon/src/services/channel_service.rs crates/slei-daemon/src/services/message_service.rs crates/slei-daemon/src/services/task_service.rs crates/slei-daemon/src/services/card_service.rs crates/slei-daemon/tests/recovery.rs crates/slei-daemon/tests/task_api.rs crates/slei-daemon/tests/channel_chat.rs crates/slei-daemon/tests/interactive_cards.rs
git commit -m "feat: persist mutation idempotency"
```

---

### Task 11: 清理 Tauri broker JSON fallback 和 mock workspace

**Files:**
- Modify: `apps/desktop/src-tauri/src/daemon_broker.rs`
- Modify: `apps/desktop/src-tauri/src/commands.rs`
- Modify: `apps/desktop/src-tauri/src/lib.rs`

- [ ] **Step 1: 写失败测试，broker 不再写 preferences/agents JSON**

在 `apps/desktop/src-tauri/src/lib.rs` 对应 test module 中新增：

```rust
static DATA_ROOT_ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

#[test]
fn broker_does_not_persist_product_state_json_when_daemon_unavailable() {
    let _guard = DATA_ROOT_ENV_LOCK.lock().unwrap();
    let root = std::env::temp_dir().join(format!("slei-broker-no-json-{}", uuid::Uuid::new_v4()));
    std::env::set_var("SLEI_DATA_ROOT", root.to_string_lossy().to_string());
    let broker = DaemonBroker::default_local();

    let _ = broker.update_preferences(PreferencesUpdateRequest {
        locale: Some("en-US".to_string()),
        time_zone: None,
        appearance: None,
        notifications: None,
    });

    assert!(!root.join("settings/preferences.json").exists());
    assert!(!root.join("agents/index.json").exists());
    std::env::remove_var("SLEI_DATA_ROOT");
}
```

如果 `uuid` 未在 `apps/desktop/src-tauri/Cargo.toml` 测试可用，添加 dev-dependency 或使用 timestamp。

- [ ] **Step 2: 运行测试确认失败**

Run: `cargo test -p slei-desktop broker_does_not_persist_product_state_json_when_daemon_unavailable`

Expected: FAIL，因为当前 broker 会写 JSON。

- [ ] **Step 3: 删除本地 JSON persistence helpers**

在 `daemon_broker.rs` 删除或停用这些 production 写入 helper：

- `load_local_preferences`
- `persist_local_preferences`
- `load_local_agents_at_root`
- `persist_local_agents_at_root`
- `load_local_conversations_at_root`
- `persist_local_conversations_at_root`
- `load_local_saved_messages_at_root`
- `persist_local_saved_messages_at_root`
- conversation messages JSON helpers

保留测试需要的 builder 时，把测试数据注入 memory-only fields，不落盘。

- [ ] **Step 4: fallback 改为离线空 receipt**

当 daemon request 失败时：

- `list_nodes()` 返回 runtime 探测 local node 或空节点，但不持久化 fake name。
- `list_agents()` 返回空列表。
- `list_channels()` 返回 daemon 不可用时的空列表或 daemon-created `all` 缺省 receipt，按 UI 空状态选择；不要写 JSON。
- `list_preferences()` 返回 default preferences in memory，不写文件。
- mutation 在 daemon 不可用时返回错误或 offline receipt，不创建本地 product state。

- [ ] **Step 5: workspace browse 不再 mock 内容**

`list_agent_workspace` 和 `read_agent_workspace_file` fallback 不应调用 mock 内容。daemon 不可用或 agent 不存在时返回 error。真实 workspace 文件读取应继续通过 daemon API 或受边界保护的 native read。

- [ ] **Step 6: 运行 Tauri tests**

Run: `cargo test -p slei-desktop`

Expected: PASS。

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src-tauri/src/daemon_broker.rs apps/desktop/src-tauri/src/commands.rs apps/desktop/src-tauri/src/lib.rs apps/desktop/src-tauri/Cargo.toml
git commit -m "refactor: remove desktop json fallback persistence"
```

---

### Task 12: 拆分 UI production types 和 test fixtures

**Files:**
- Create: `apps/desktop/src/app/types.ts`
- Create: `apps/desktop/src/app/empty-data.ts`
- Create: `apps/desktop/src/test/fixtures.ts`
- Modify: `apps/desktop/src/app/fixtures.ts`
- Modify: `apps/desktop/src/app/SleiApp.tsx`
- Modify: `apps/desktop/src/app/SleiAppFrame.tsx`
- Modify: `apps/desktop/src/features/**/*.tsx`
- Modify: `apps/desktop/src/**/*.test.tsx`
- Modify: `apps/desktop/e2e/*.spec.tsx`

- [ ] **Step 1: 写失败静态测试，production 不导入 fixtures**

先不用新脚本，在 shell 运行：

```bash
rg -n "from \"\\./fixtures\"|from \"\\.\\./app/fixtures\"|from \"\\.\\./\\.\\./app/fixtures\"" apps/desktop/src --glob '!**/*.test.*'
```

Expected: 当前会输出 production 导入，作为待清理基线。

- [ ] **Step 2: 新建 production types**

Create `apps/desktop/src/app/types.ts`，从 `fixtures.ts` 移入所有 type：

```ts
export type SleiChannel = {
  id: string;
  name: string;
  description: string;
  unread: number;
  projectName?: string;
  projectPaths?: string[];
};

export type SleiChannelMemberReadiness = "joining" | "memory_syncing" | "ready" | "memory_failed" | "unavailable";

// 继续移入 SleiMessage、SleiTaskStatus、SleiTask、SleiTaskReply、SleiMember、SleiFixtures。
```

- [ ] **Step 3: 新建空数据 factory**

Create `apps/desktop/src/app/empty-data.ts`:

```ts
import type { SleiFixtures } from "./types";

export function createEmptySleiData(overrides: Partial<SleiFixtures> = {}): SleiFixtures {
  return {
    nodes: overrides.nodes ?? [],
    conversations: overrides.conversations ?? [],
    conversationSessions: overrides.conversationSessions ?? [],
    channels: overrides.channels ?? [],
    messages: overrides.messages ?? [],
    tasks: overrides.tasks ?? [],
    members: overrides.members ?? [],
  };
}
```

- [ ] **Step 4: 移动测试 fixtures**

Create `apps/desktop/src/test/fixtures.ts`，把 `createSleiFixtures` 改为调用 `createEmptySleiData`，把 `createDemoMembers` 移到这里。测试显式传入 demo data。

```ts
import { createEmptySleiData } from "../app/empty-data";
import type { SleiFixtures, SleiMember } from "../app/types";

export function createSleiFixtures(overrides: Partial<SleiFixtures> = {}): SleiFixtures {
  return createEmptySleiData(overrides);
}

export function createDemoMembers(): SleiMember[] {
  return [
    // 保留原测试 demo members。
  ];
}
```

- [ ] **Step 5: production 导入改到 types/empty-data**

在 production 文件中：

- `import type ... from "./fixtures"` 改为 `from "./types"`。
- `createSleiFixtures` 改为 `createEmptySleiData`。
- `SleiApp` 初始 state 改为 `useState(createEmptySleiData())`。

- [ ] **Step 6: tests/e2e 导入改到 test fixtures**

把测试中的：

```ts
import { createSleiFixtures } from "../src/app/fixtures";
```

改为：

```ts
import { createSleiFixtures } from "../src/test/fixtures";
```

根据相对路径调整 `src/app/**/*.test.tsx` 为 `../test/fixtures` 或 `../../test/fixtures`。

- [ ] **Step 7: 删除或瘦身旧 fixtures.ts**

如果仍需兼容，`apps/desktop/src/app/fixtures.ts` 只 re-export types 并抛错阻止 production 使用：

```ts
export type * from "./types";
```

不要在该文件保留 demo 默认数据。

- [ ] **Step 8: 运行 UI typecheck 和 tests**

Run:

```bash
pnpm --filter @slei/desktop typecheck
pnpm --filter @slei/desktop test
```

Expected: PASS。

- [ ] **Step 9: Commit**

```bash
git add apps/desktop/src/app/types.ts apps/desktop/src/app/empty-data.ts apps/desktop/src/test/fixtures.ts apps/desktop/src/app/fixtures.ts apps/desktop/src/app/SleiApp.tsx apps/desktop/src/app/SleiAppFrame.tsx apps/desktop/src/features apps/desktop/src apps/desktop/e2e
git commit -m "refactor: make desktop fixtures test-only"
```

---

### Task 13: 清理 daemon-bridge production mock fallback

**Files:**
- Modify: `apps/desktop/src/lib/daemon-bridge.ts`
- Modify: `apps/desktop/src/app/SleiApp.test.ts`
- Modify: `apps/desktop/e2e/shell.spec.ts`
- Modify: `apps/desktop/e2e/empty-state.spec.tsx`

- [ ] **Step 1: 写失败测试，非 Tauri production bridge 不返回 mock data**

在 `apps/desktop/src/app/SleiApp.test.ts` 或新增 `apps/desktop/src/lib/daemon-bridge.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { createDaemonBridge } from "../lib/daemon-bridge";

describe("createDaemonBridge production fallback", () => {
  it("returns offline empty receipts outside Tauri instead of mock product data", async () => {
    const bridge = createDaemonBridge();

    await expect(bridge.daemonStatus()).resolves.toMatchObject({ connected: false });
    await expect(bridge.listAgents()).resolves.toEqual({ agents: [] });
    await expect(bridge.listTasks()).resolves.toEqual({ tasks: [] });
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @slei/desktop test -- daemon-bridge`

Expected: FAIL，因为当前 fallback mock 有 fake node/channel 行为。

- [ ] **Step 3: 明确 test-only mock export**

保留 `createDaemonBridgeMock`，但 production `createDaemonBridge()` 在 `!hasTauriRuntime()` 时返回 `createOfflineDaemonBridge()`。

新增：

```ts
function createOfflineDaemonBridge(): DaemonBridge {
  const offline = async () => {
    throw new Error("daemon offline");
  };
  return {
    logFrontendEvent: async () => undefined,
    daemonStatus: async () => ({ connected: false, label: "offline" }),
    listNodes: async () => ({ nodes: [] }),
    refreshRuntimeStatus: async () => ({ nodes: [] }),
    listAgents: async () => ({ agents: [] }),
    listChannels: async () => ({ channels: [] }),
    listTasks: async () => ({ tasks: [] }),
    listConversations: async () => ({ conversations: [] }),
    listPreferences: async () => ({ preferences: defaultUserPreferences() }),
    createAgent: offline,
    updateAgent: offline,
    deleteAgent: offline,
    createChannel: offline,
    addChannelMember: offline,
    removeChannelMember: offline,
    sendChannelMessage: offline,
    deleteChannelMessage: offline,
    editChannelMessage: offline,
    createDmConversation: offline,
    sendConversationMessage: offline,
    uploadConversationAttachment: offline,
    saveMessage: offline,
    unsaveMessage: offline,
    proposeCardDecision: offline,
    completeCard: offline,
    createTask: offline,
    replyToTask: offline,
    updateTaskStatus: offline,
    renameLocalNode: offline,
    bootstrapGuideAgent: async () => ({ status: "runtimeUnavailable" }),
    listChannelMembers: async () => ({ members: [] }),
    listChannelMessages: async () => ({ messages: [] }),
    listConversationSessions: async () => ({ sessions: [] }),
    listConversationMessages: async () => ({ messages: [] }),
    listSavedMessages: async () => ({ savedMessages: [] }),
    listAgentSkills: async () => ({ skills: [] }),
    openAgentPath: offline,
    listAgentWorkspace: offline,
    readAgentWorkspaceFile: offline,
  };
}
```

Reader 用空 receipt，mutation 用 offline error。不要调用 `mockAgentWorkspaceEntries` 或 `mockAgentWorkspaceFileContent`。

- [ ] **Step 4: 把 mock workspace helpers 移到 test-only 区域**

如果 tests 还需要，保留 helper 但只由 `createDaemonBridgeMock` 调用，并重命名为：

```ts
function testMockAgentWorkspaceEntries(...)
function testMockAgentWorkspaceFileContent(...)
```

production bridge 不引用这两个函数。

- [ ] **Step 5: 更新 tests 显式使用 createDaemonBridgeMock**

需要 mock product data 的 tests 改为直接构造 `createDaemonBridgeMock({ connected: true, ... })`。

- [ ] **Step 6: 运行 UI tests**

Run:

```bash
pnpm --filter @slei/desktop typecheck
pnpm --filter @slei/desktop test
```

Expected: PASS。

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/lib/daemon-bridge.ts apps/desktop/src/app/SleiApp.test.ts apps/desktop/e2e/shell.spec.ts apps/desktop/e2e/empty-state.spec.tsx
git commit -m "refactor: remove production bridge mock fallback"
```

---

### Task 14: 添加 architecture guardrail 脚本

**Files:**
- Create: `scripts/verify-architecture-guardrails.mjs`
- Modify: `package.json`
- Modify: `apps/desktop/package.json` if package-level script is useful

- [ ] **Step 1: 写脚本并先让它扫描当前已清理状态**

Create `scripts/verify-architecture-guardrails.mjs`:

```js
#!/usr/bin/env node

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd();
const violations = [];

const productionRoots = [
  "apps/desktop/src",
  "apps/desktop/src-tauri/src",
  "crates/slei-daemon/src",
];

const ignored = [
  ".test.",
  "/test/",
  "/tests/",
  "/e2e/",
  "apps/desktop/src/test/fixtures.ts",
];

const allowedLegacyJsonContexts = [
  "legacy import",
  "migration import",
  "reset cleanup",
  "reset_paths",
  "resetPaths",
  "read_legacy",
  "load_legacy",
];

const forbiddenPatterns = [
  { label: "production fixture factory", pattern: /createSleiFixtures\s*\(/ },
  { label: "demo member factory", pattern: /createDemoMembers\s*\(/ },
  { label: "mock workspace helper", pattern: /mockAgentWorkspace(Entries|FileContent)/ },
  { label: "legacy json state write", pattern: /fs::write\([^)]*(agents\/index\.json|channels\/|conversations\/|attachments\/index\.json|cards\/index\.json|settings\/preferences\.json|saved\/messages\.json)/s },
  { label: "legacy json state persist helper", pattern: /persist(_local)?_(agents|channels|conversations|attachments|cards|saved|preferences)/ },
];

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const stats = statSync(path);
    if (stats.isDirectory()) {
      walk(path);
      continue;
    }
    const rel = relative(root, path);
    if (ignored.some((part) => rel.includes(part))) continue;
    if (!/\.(ts|tsx|rs)$/.test(rel)) continue;
    const text = readFileSync(path, "utf8");
    const legacyJsonAllowed = allowedLegacyJsonContexts.some((marker) => text.includes(marker));
    for (const { label, pattern } of forbiddenPatterns) {
      if (label.startsWith("legacy json") && legacyJsonAllowed) continue;
      if (pattern.test(text)) violations.push(`${rel}: ${label}`);
    }
  }
}

for (const dir of productionRoots) walk(join(root, dir));

if (violations.length) {
  console.error("Architecture guardrail violations:");
  for (const violation of violations) console.error(`- ${violation}`);
  process.exit(1);
}

console.log("Architecture guardrails passed.");
```

- [ ] **Step 2: 确认 root script 已存在**

如果 Task 5 没有加入，补上 `package.json`：

```json
"verify:architecture": "node scripts/verify-architecture-guardrails.mjs"
```

- [ ] **Step 3: 运行 guardrail**

Run: `pnpm verify:architecture`

Expected: PASS。若失败，只修真正 production 违规，不要给 production 文件加 allowlist。

Guardrail 只禁止 production JSON 写入和 persist helper，不禁止 migration import 或 reset cleanup 中出现 legacy JSON 路径字符串。迁移读取旧 JSON 时必须在函数名或附近注释中包含 `legacy import`、`migration import`、`read_legacy` 或 `load_legacy`；reset 清理旧文件时必须在函数名或附近注释中包含 `reset cleanup` 或 `reset_paths`。

- [ ] **Step 4: 运行全量静态检查**

Run:

```bash
pnpm typecheck
pnpm verify:architecture
```

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add scripts/verify-architecture-guardrails.mjs package.json apps/desktop/package.json
git commit -m "test: add architecture guardrails"
```

---

### Task 15: 最终验证和文档收口

**Files:**
- Modify: `docs/superpowers/specs/2026-06-10-slei-sqlite-reset-architecture-design.md` only if implementation discovered a necessary clarification
- Modify: `docs/superpowers/plans/2026-06-10-slei-sqlite-reset-architecture.md` only if plan tracking needs status notes

- [ ] **Step 1: 运行 Rust 全量测试**

Run: `cargo test --workspace`

Expected: PASS。

- [ ] **Step 2: 运行 pnpm 全量检查**

Run:

```bash
pnpm typecheck
pnpm test
pnpm verify:architecture
```

Expected: PASS。

- [ ] **Step 3: 手动 reset 验证**

启动 daemon 后执行：

```bash
SLEI_ENABLE_DEV_RESET=1 pnpm dev:reset
```

Expected:

- 返回 JSON 包含 `"databaseReset":true`。
- data root 下旧 `agents/` workspace 被删除。
- `slei.sqlite` 仍存在。
- `schema_migrations` 仍包含版本 `1` 和 `2`。

- [ ] **Step 4: 空 UI 验证**

Run:

```bash
pnpm --filter @slei/desktop dev
```

在浏览器打开 Vite 地址，确认：

- 没有 Coda/Alice/Cindy。
- 没有 `T-101` 等 demo task。
- 没有 `MacBookPro M4 MAX` fake device。
- daemon offline 时显示离线或空状态。
- daemon 返回空数据时页面结构不崩溃。

- [ ] **Step 5: 搜索旧路径和 mock 标记**

Run:

```bash
rg -n "Coda|Alice|Cindy|T-101|MacBookPro M4 MAX|channels/index\\.json|channels/messages\\.json|agents/index\\.json|attachments/index\\.json|settings/preferences\\.json|cards/index\\.json|saved/messages\\.json|mockAgentWorkspace" apps crates --glob '!**/*.test.*' --glob '!**/tests/**' --glob '!**/e2e/**'
```

Expected: 没有 production 违规输出。内置资源、测试和文档输出可以保留。

- [ ] **Step 6: Commit 文档修正**

如果 Step 3 到 Step 5 需要补文档：

```bash
git add docs/superpowers/specs/2026-06-10-slei-sqlite-reset-architecture-design.md docs/superpowers/plans/2026-06-10-slei-sqlite-reset-architecture.md
git commit -m "docs: update sqlite reset implementation notes"
```

如果没有文档修正，跳过提交。

- [ ] **Step 7: 完成提示**

最终回复必须包含：

- 已运行的验证命令和结果。
- reset 是否可用。
- production mock/JSON guardrail 是否通过。
- 根据 `AGENTS.md` 主动询问是否合并到 `master` 或其他分支。
