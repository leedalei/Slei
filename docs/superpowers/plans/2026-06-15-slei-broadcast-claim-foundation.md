# Slei 广播 Claim 基础 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 Slei 落地广播投递、原子 claim、Agent CLI、细粒度状态日志、MEMORY 活动上下文和架构文档更新的第一阶段基础能力。

**Architecture:** daemon 继续作为产品状态、路由事实、持久化、幂等、reset 和诊断的唯一控制面；Agent 只通过 `slei` CLI 调用 daemon API 自主 claim、读历史、发言、处理任务和上报状态。本计划只实现可测试的基础协议和 daemon 流转，Claude SDK 改为 spawn Claude CLI 的 runtime 替换放到后续计划，避免同时改控制面和执行面。

**Tech Stack:** Rust 2021, Axum, Tokio, sqlx/SQLite, serde/serde_json, uuid, clap/reqwest, pnpm/Vitest/Playwright, Markdown ADR。

---

## 范围边界

本计划覆盖第一阶段可独立验证的基础能力：

- 新增 SQLite 表：消息投递、消息 claim、任务 claim、Agent 最新状态、Agent 最近 100 条操作日志。
- 新增仓储、daemon service、HTTP API 和 `slei` CLI。
- 所有新增 daemon HTTP route 必须挂在现有 `/v1/...` API 前缀下，不引入平行的 `/api/...` 公共面。
- 所有会产生副作用的 CLI 写命令必须发送 `idempotency-key` header，并复用现有 namespaced idempotency 机制。
- 新频道消息不再启动 coordinator runtime，改为给频道内普通 Agent 创建投递记录并唤醒。
- Agent 可以通过 CLI claim 消息、读取历史、搜索消息、发频道消息、创建/claim/reply/update/list/read 任务、上报状态。
- `MEMORY.md` 和 memory skill 更新为多频道 `Active Context`，最多 3 个频道事项。
- 更新长期架构文档，明确 coordinator 不再作为新流转 guardrail。

后续计划单独处理：

- `workers/claude-agent` 从 `@anthropic-ai/claude-agent-sdk` 的 `query()` 改为直接 spawn Claude CLI。
- 完整 system prompt 拼装，包括角色、CLI 帮助、消息格式、行为约定、运行时上下文。
- 清理旧 coordinator 兼容路径和 UI 上更完整的操作日志浏览体验。

## 规格和知识检索

设计规格：`docs/superpowers/specs/2026-06-15-slei-broadcast-claim-agent-architecture-design.md`

知识检索命中：

- `docs/knowledge/best-practices/task-thread-stable-ids-and-reply-roles-20260529.md`
- 影响：任务线程和回复必须使用稳定 ID，不能用 `Date.now()`；任务回复必须保留 `role`，保证 user/Agent 回复可区分。

## 文件结构

### Storage

- Modify: `crates/slei-storage/src/migrations.rs`  
  注册 `0003_broadcast_claim.sql`。
- Create: `crates/slei-storage/migrations/0003_broadcast_claim.sql`  
  新增 claim/status/log 表。
- Modify: `crates/slei-storage/src/repositories/mod.rs`  
  新增 claim、delivery、status、log、message read/search 仓储方法；reset 表清单包含新表。
- Modify: `crates/slei-storage/src/lib.rs`  
  新增 migration、原子 claim、日志保留测试。

### Daemon

- Create: `crates/slei-daemon/src/services/claim_service.rs`  
  封装 message/task claim、delivery、status、activity log 语义。
- Modify: `crates/slei-daemon/src/services/mod.rs`  
  导出 `claim_service`。
- Modify: `crates/slei-daemon/src/state.rs`  
  初始化并暴露 `claims()`。
- Create: `crates/slei-daemon/src/api/claims.rs`  
  提供 message claim、task claim、agent status、activity log API。
- Modify: `crates/slei-daemon/src/api/messages.rs`  
  增加 Agent CLI 使用的 message read/search/send API。
- Modify: `crates/slei-daemon/src/api/tasks.rs`  
  增加 task create-from-source、claim、reply、thread、update API。
- Modify: `crates/slei-daemon/src/api/mod.rs`  
  导出 `claims`。
- Modify: `crates/slei-daemon/src/app.rs`  
  挂载新路由。
- Modify: `crates/slei-daemon/src/services/channel_orchestrator_service.rs`  
  新消息流转从 coordinator runtime 改为广播投递。
- Modify: `crates/slei-daemon/src/services/task_service.rs`  
  支持 CLI 任务语义，保留 source-message task card 规则。
- Modify: `crates/slei-daemon/src/services/message_service.rs`  
  复用现有 `messages` 表，增加 header 格式化和历史读取能力。

### CLI

- Modify: `Cargo.toml`  
  新增 workspace member `crates/slei-cli`。
- Create: `crates/slei-cli/Cargo.toml`  
  定义 `slei` binary。
- Create: `crates/slei-cli/src/main.rs`  
  clap 命令结构和 stdout/stderr 约定。
- Create: `crates/slei-cli/src/client.rs`  
  daemon HTTP client、token/base-url/idempotency-key 读取、JSON helper。
- Create: `crates/slei-cli/tests/cli_args.rs`  
  参数解析测试。

### Agent Assets And Docs

- Modify: `resources/default-agent-assets/MEMORY.md.template`  
  `Active Context` 改为最多 3 个频道事项。
- Modify: `resources/default-agent-assets/skills/memory/SKILL.md.template`  
  补充什么时候更新、如何淘汰、同 Agent 多频道规则。
- Modify: `crates/slei-default-agent-assets/src/lib.rs`  
  更新模板测试。
- Modify: `docs/architecture/0005-channel-routing-and-multi-agent-flow.md`  
  改写为广播 claim 架构。
- Modify: `docs/architecture/0006-task-source-message-card.md`  
  改写 task source-message 与 CLI 任务流转。

### Tests

- Create: `crates/slei-daemon/tests/broadcast_claim_api.rs`
- Modify: `crates/slei-daemon/tests/channel_orchestration_flow.rs`
- Modify: `crates/slei-daemon/tests/task_service.rs`
- Modify: `apps/desktop/e2e/task-thread-flow.spec.tsx`（仅当 DTO 改动影响 E2E）

## Task 1: 新增 Broadcast Claim Storage Schema

**Files:**
- Create: `crates/slei-storage/migrations/0003_broadcast_claim.sql`
- Modify: `crates/slei-storage/src/migrations.rs`
- Modify: `crates/slei-storage/src/repositories/mod.rs`
- Modify: `crates/slei-storage/src/lib.rs`

- [ ] **Step 1: 写 migration 失败测试**

在 `crates/slei-storage/src/lib.rs` 的 migration 测试中加入新表断言：

```rust
for table in [
    "message_deliveries",
    "message_claims",
    "task_claims",
    "agent_statuses",
    "agent_activity_logs",
] {
    assert!(db.table_exists(table).await.unwrap(), "missing {table}");
}
```

新增版本测试：

```rust
#[tokio::test]
async fn migration_records_broadcast_claim_version() {
    let (url, _path) = sqlite_file_url("broadcast-claim-version");
    let db = SleiDb::connect(&url).await.unwrap();

    db.migrate().await.unwrap();

    let versions = sqlx::query_scalar::<_, i64>(
        "SELECT version FROM schema_migrations ORDER BY version ASC",
    )
    .fetch_all(db.pool())
    .await
    .unwrap();

    assert_eq!(versions, vec![1, 2, 3]);
}
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cargo test -p slei-storage migration_creates_core_tables_and_indexes migration_records_broadcast_claim_version
```

Expected: FAIL，新表和 version 3 还不存在。

- [ ] **Step 3: 创建 migration**

创建 `crates/slei-storage/migrations/0003_broadcast_claim.sql`：

```sql
CREATE TABLE IF NOT EXISTS message_deliveries (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL UNIQUE,
    message_id TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    delivery_state TEXT NOT NULL DEFAULT 'pending',
    run_id TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(message_id, agent_id)
);

CREATE INDEX IF NOT EXISTS idx_message_deliveries_agent_state
    ON message_deliveries(agent_id, delivery_state, sequence);

CREATE INDEX IF NOT EXISTS idx_message_deliveries_message_id
    ON message_deliveries(message_id);

CREATE TABLE IF NOT EXISTS message_claims (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL UNIQUE,
    message_id TEXT NOT NULL,
    claim_scope TEXT NOT NULL DEFAULT 'reply',
    agent_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'claimed',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(message_id, claim_scope)
);

CREATE INDEX IF NOT EXISTS idx_message_claims_agent_id
    ON message_claims(agent_id, sequence);

CREATE TABLE IF NOT EXISTS task_claims (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL UNIQUE,
    task_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'claimed',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(task_id)
);

CREATE INDEX IF NOT EXISTS idx_task_claims_agent_id
    ON task_claims(agent_id, sequence);

CREATE TABLE IF NOT EXISTS agent_statuses (
    agent_id TEXT PRIMARY KEY,
    state TEXT NOT NULL,
    phase TEXT,
    reason TEXT,
    run_id TEXT,
    channel_id TEXT,
    message_id TEXT,
    task_id TEXT,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS agent_activity_logs (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL UNIQUE,
    agent_id TEXT NOT NULL,
    run_id TEXT,
    channel_id TEXT,
    message_id TEXT,
    task_id TEXT,
    state TEXT NOT NULL,
    phase TEXT,
    reason TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_agent_activity_logs_agent_sequence
    ON agent_activity_logs(agent_id, sequence DESC);

INSERT OR IGNORE INTO schema_migrations(version) VALUES (3);
```

- [ ] **Step 4: 注册 migration**

在 `crates/slei-storage/src/migrations.rs` 中加入：

```rust
pub const MIGRATION_0003: &str = include_str!("../migrations/0003_broadcast_claim.sql");

pub const MIGRATIONS: &[(i64, &str)] = &[
    (1, MIGRATION_0001),
    (2, MIGRATION_0002),
    (3, MIGRATION_0003),
];
```

- [ ] **Step 5: 更新 reset 表清单**

在 `crates/slei-storage/src/repositories/mod.rs` 的 `RESET_MUTABLE_TABLES` 前部加入：

```rust
"agent_activity_logs",
"agent_statuses",
"task_claims",
"message_claims",
"message_deliveries",
```

在 `RESET_MUTABLE_SEQUENCE_TABLES` 加入：

```rust
"message_deliveries",
"message_claims",
"task_claims",
"agent_activity_logs",
```

- [ ] **Step 6: 运行 storage 测试**

```bash
cargo test -p slei-storage
```

Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add crates/slei-storage/src/migrations.rs crates/slei-storage/migrations/0003_broadcast_claim.sql crates/slei-storage/src/repositories/mod.rs crates/slei-storage/src/lib.rs
git commit -m "feat: add broadcast claim storage tables"
```

## Task 2: 新增 Claim/Status/Log 仓储方法

**Files:**
- Modify: `crates/slei-storage/src/repositories/mod.rs`
- Modify: `crates/slei-storage/src/lib.rs`

- [ ] **Step 1: 写原子 claim 和日志保留失败测试**

在 `crates/slei-storage/src/lib.rs` 增加：

```rust
#[tokio::test]
async fn message_claim_is_atomic_per_message_scope() {
    let (url, _path) = sqlite_file_url("message-claim");
    let db = SleiDb::connect(&url).await.unwrap();
    db.migrate().await.unwrap();
    let repos = Repositories::new(db.pool().clone());

    let first = repos
        .try_claim_message("msg_1", "reply", "agent_a")
        .await
        .unwrap();
    let second = repos
        .try_claim_message("msg_1", "reply", "agent_b")
        .await
        .unwrap();

    assert!(first.claimed);
    assert!(!second.claimed);
    assert_eq!(second.agent_id.as_deref(), Some("agent_a"));
}

#[tokio::test]
async fn agent_activity_logs_keep_latest_100_per_agent() {
    let (url, _path) = sqlite_file_url("activity-log-retention");
    let db = SleiDb::connect(&url).await.unwrap();
    db.migrate().await.unwrap();
    let repos = Repositories::new(db.pool().clone());

    for index in 0..105 {
        repos
            .record_agent_activity(
                "agent_a",
                Some(&format!("run_{index}")),
                Some("all"),
                Some(&format!("msg_{index}")),
                None,
                "working",
                Some("reading_history"),
                None,
            )
            .await
            .unwrap();
    }

    let logs = repos.agent_activity_logs("agent_a", 200).await.unwrap();
    assert_eq!(logs.len(), 100);
    assert_eq!(logs.first().unwrap().run_id.as_deref(), Some("run_104"));
    assert_eq!(logs.last().unwrap().run_id.as_deref(), Some("run_5"));
}
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cargo test -p slei-storage message_claim_is_atomic_per_message_scope agent_activity_logs_keep_latest_100_per_agent
```

Expected: FAIL，仓储类型和方法还不存在。

- [ ] **Step 3: 增加仓储 row 类型**

在 `crates/slei-storage/src/repositories/mod.rs` 现有 row struct 附近加入：

```rust
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ClaimAttemptRecord {
    pub claimed: bool,
    pub agent_id: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AgentStatusRow {
    pub agent_id: String,
    pub state: String,
    pub phase: Option<String>,
    pub reason: Option<String>,
    pub run_id: Option<String>,
    pub channel_id: Option<String>,
    pub message_id: Option<String>,
    pub task_id: Option<String>,
    pub updated_at: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AgentActivityLogRow {
    pub id: String,
    pub agent_id: String,
    pub run_id: Option<String>,
    pub channel_id: Option<String>,
    pub message_id: Option<String>,
    pub task_id: Option<String>,
    pub state: String,
    pub phase: Option<String>,
    pub reason: Option<String>,
    pub created_at: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MessageReadQueryRow {
    pub channel_id: String,
    pub limit: Option<i64>,
    pub after_sequence: Option<i64>,
    pub before_sequence: Option<i64>,
    pub around_message_id: Option<String>,
}
```

- [ ] **Step 4: 实现原子 message/task claim**

使用 `INSERT OR IGNORE` + `UNIQUE(message_id, claim_scope)` / `UNIQUE(task_id)` 实现。方法签名：

```rust
pub async fn try_claim_message(
    &self,
    message_id: &str,
    claim_scope: &str,
    agent_id: &str,
) -> Result<ClaimAttemptRecord, sqlx::Error>;

pub async fn try_claim_task(
    &self,
    task_id: &str,
    agent_id: &str,
) -> Result<ClaimAttemptRecord, sqlx::Error>;
```

失败返回 `claimed: false` 和已持有 claim 的 `agent_id`，不要返回 SQL conflict error。

- [ ] **Step 5: 实现 delivery 方法**

加入：

```rust
pub async fn create_message_delivery(
    &self,
    message_id: &str,
    channel_id: &str,
    agent_id: &str,
) -> Result<(), sqlx::Error>;

pub async fn pending_message_deliveries(
    &self,
    agent_id: &str,
    limit: i64,
) -> Result<Vec<MessageDeliveryRow>, sqlx::Error>;

pub async fn mark_message_delivery_running(
    &self,
    message_id: &str,
    agent_id: &str,
    run_id: &str,
) -> Result<(), sqlx::Error>;
```

`MessageDeliveryRow` 至少包含 `sequence/id/message_id/channel_id/agent_id/delivery_state/run_id/created_at/updated_at`。

- [ ] **Step 6: 实现 status 和 activity log 方法**

加入：

```rust
pub async fn upsert_agent_status(&self, row: AgentStatusRow) -> Result<(), sqlx::Error>;

pub async fn record_agent_activity(
    &self,
    agent_id: &str,
    run_id: Option<&str>,
    channel_id: Option<&str>,
    message_id: Option<&str>,
    task_id: Option<&str>,
    state: &str,
    phase: Option<&str>,
    reason: Option<&str>,
) -> Result<(), sqlx::Error>;

pub async fn agent_activity_logs(
    &self,
    agent_id: &str,
    limit: i64,
) -> Result<Vec<AgentActivityLogRow>, sqlx::Error>;
```

`record_agent_activity` 每次 insert 后执行删除：

```sql
DELETE FROM agent_activity_logs
WHERE agent_id = ?
  AND sequence NOT IN (
    SELECT sequence FROM agent_activity_logs
    WHERE agent_id = ?
    ORDER BY sequence DESC
    LIMIT 100
  )
```

- [ ] **Step 7: 实现 message read/search 仓储方法**

复用现有 `messages` 表和 `ChannelMessageRow`，不要创建第二套消息表。新增方法：

```rust
pub async fn read_channel_messages(
    &self,
    query: MessageReadQueryRow,
) -> Result<Vec<ChannelMessageRow>, sqlx::Error>;

pub async fn search_channel_messages(
    &self,
    query: &str,
    limit: i64,
) -> Result<Vec<ChannelMessageRow>, sqlx::Error>;
```

实现要求：

- `limit` 默认由 service/API 层限制到 20，仓储层只接受已经规范化的 limit。
- `after_sequence`、`before_sequence` 基于 SQLite `rowid` 或后续显式 `sequence` 查询，保持返回顺序为旧到新。
- `around_message_id` 先查该消息 `rowid`，再返回前后窗口。
- `search` 用 `content LIKE ? ESCAPE '\\'`，实现一个小的 escape helper 处理 `%`、`_`、`\`。

- [ ] **Step 8: 运行 storage 测试**

```bash
cargo test -p slei-storage message_claim_is_atomic_per_message_scope agent_activity_logs_keep_latest_100_per_agent
cargo test -p slei-storage
```

Expected: PASS。

- [ ] **Step 9: 提交**

```bash
git add crates/slei-storage/src/repositories/mod.rs crates/slei-storage/src/lib.rs
git commit -m "feat: add broadcast claim repositories"
```

## Task 3: 新增 Claim Service 和 Daemon API

**Files:**
- Create: `crates/slei-daemon/src/services/claim_service.rs`
- Modify: `crates/slei-daemon/src/services/mod.rs`
- Modify: `crates/slei-daemon/src/state.rs`
- Create: `crates/slei-daemon/src/api/claims.rs`
- Modify: `crates/slei-daemon/src/api/mod.rs`
- Modify: `crates/slei-daemon/src/app.rs`
- Create: `crates/slei-daemon/tests/broadcast_claim_api.rs`

- [ ] **Step 1: 写 API 失败测试**

在 `crates/slei-daemon/tests/broadcast_claim_api.rs` 覆盖：

- `POST /v1/claims/messages/{message_id}` 第一次返回 `claimed=true`。
- 第二个 Agent claim 同一消息返回 `claimed=false` 和 owner。
- `POST /v1/claims/tasks/{task_id}` 同样原子。
- `POST /v1/agents/{agent_id}/status` 会更新 `agent_statuses` 并追加日志。
- 重复使用同一个 `idempotency-key` 调用 `POST /v1/agents/{agent_id}/status` 不会追加重复日志。
- 连续 105 次 status 后 `GET /v1/agents/{agent_id}/activity?limit=200` 只返回 100 条。

- [ ] **Step 2: 运行测试确认失败**

```bash
cargo test -p slei-daemon --test broadcast_claim_api
```

Expected: FAIL，service/API 还不存在。

- [ ] **Step 3: 创建 service DTO**

在 `crates/slei-daemon/src/services/claim_service.rs` 定义：

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClaimResponse {
    pub claimed: bool,
    pub agent_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentStatusUpdate {
    pub state: String,
    pub phase: Option<String>,
    pub reason: Option<String>,
    pub run_id: Option<String>,
    pub channel_id: Option<String>,
    pub message_id: Option<String>,
    pub task_id: Option<String>,
}
```

`ClaimService` 持有 `Repositories`，方法：

```rust
pub async fn claim_message(&self, message_id: &str, agent_id: &str) -> Result<ClaimResponse, ClaimError>;
pub async fn claim_task(&self, task_id: &str, agent_id: &str) -> Result<ClaimResponse, ClaimError>;
pub async fn update_agent_status(&self, agent_id: &str, update: AgentStatusUpdate) -> Result<(), ClaimError>;
pub async fn activity_logs(&self, agent_id: &str, limit: i64) -> Result<Vec<AgentActivityLogRow>, ClaimError>;
```

`update_agent_status` 必须同时调用 `upsert_agent_status` 和 `record_agent_activity`。

- [ ] **Step 4: 接入 AppState**

在 `crates/slei-daemon/src/state.rs` 初始化 `ClaimService` 并提供：

```rust
pub fn claims(&self) -> &ClaimService {
    &self.claims
}
```

- [ ] **Step 5: 创建 API handler**

`crates/slei-daemon/src/api/claims.rs` 提供：

```rust
POST /v1/claims/messages/:message_id
POST /v1/claims/tasks/:task_id
POST /v1/agents/:agent_id/status
GET  /v1/agents/:agent_id/activity
```

请求体使用 JSON：

```json
{ "agentId": "agent_cindy" }
```

status 请求体：

```json
{
  "state": "working",
  "phase": "reading_history",
  "reason": null,
  "runId": "run_123",
  "channelId": "all",
  "messageId": "msg_123",
  "taskId": null
}
```

`POST /v1/agents/:agent_id/status` 必须要求 `idempotency-key` header。service 层可以在 `ClaimService` 内通过 `idempotent_mutations` 记录 status response，确保 CLI retry 不重复追加 activity log。

- [ ] **Step 6: 挂载 route**

在 `crates/slei-daemon/src/api/mod.rs` 导出 `claims`，在 `crates/slei-daemon/src/app.rs` 按现有风格逐条挂载 `/v1/...` route。不要新增 `/api/...` route。

- [ ] **Step 7: 运行 daemon API 测试**

```bash
cargo test -p slei-daemon --test broadcast_claim_api
```

Expected: PASS。

- [ ] **Step 8: 提交**

```bash
git add crates/slei-daemon/src/services/claim_service.rs crates/slei-daemon/src/services/mod.rs crates/slei-daemon/src/state.rs crates/slei-daemon/src/api/claims.rs crates/slei-daemon/src/api/mod.rs crates/slei-daemon/src/app.rs crates/slei-daemon/tests/broadcast_claim_api.rs
git commit -m "feat: expose broadcast claim APIs"
```

## Task 4: 新增 Message Read/Search/Send API

**Files:**
- Modify: `crates/slei-daemon/src/api/messages.rs`
- Modify: `crates/slei-daemon/src/services/message_service.rs`
- Modify: `crates/slei-daemon/tests/broadcast_claim_api.rs`

- [ ] **Step 1: 写 API 失败测试**

覆盖：

- `GET /v1/messages/read?channel=all&limit=20` 返回最近消息，正文带统一 header。
- `GET /v1/messages/read?channel=all&after=10` 和 `before=10` 能按锚点读取。
- `GET /v1/messages/read?channel=all&around=msg_123` 返回围绕消息上下文。
- `GET /v1/messages/search?query=关键词` 返回命中消息。
- `POST /v1/messages/send` 以 Agent 身份写入频道消息并返回新 message id。
- 重复使用同一个 `idempotency-key` 调用 `POST /v1/messages/send` 返回同一 message id，不新增消息。

- [ ] **Step 2: 运行测试确认失败**

```bash
cargo test -p slei-daemon --test broadcast_claim_api message_read search agent_send
```

Expected: FAIL。

- [ ] **Step 3: 实现 header formatter**

在 `message_service` 增加纯函数，单测覆盖：

```rust
pub fn format_agent_visible_message(
    target: &str,
    msg_id: &str,
    time: &str,
    message_type: &str,
    sender_handle: &str,
    body: &str,
) -> String {
    format!("[target={target} msg={msg_id} time={time} type={message_type}] {sender_handle}: {body}")
}
```

`sender_handle` 来自 author id/handle 映射；第一阶段如果已有 API 无法直接取 handle，先返回稳定 author id，但 service 层 TODO 必须写成测试驱动的 follow-up，不影响 claim 语义。

- [ ] **Step 4: 实现 read/search/send service**

`read` 支持：

```text
channel
limit
after
before
around
```

target/channel 解析规则：

- CLI 输入 `#all` 时，HTTP query/body 传给 daemon 的 channel id 为 `all`。
- CLI 输入 `#channel-name` 时，先按 channel name 查 daemon channel；如果当前系统只支持 id，计划实现时要在 API 中明确返回 404，不做本地猜测。
- CLI 输入 `#channel:msgId` 只用于读取特定线程或 around context；存储层仍使用 `channel_id` 和 `message_id` 两个字段，不把 `#channel:msgId` 作为真实 channel id。
- API 返回给 Agent 的可见 header 可以继续使用 `target=#all` 或 `target=#all:msgId`，但 daemon DTO 内部保持结构化字段。

`send` 请求体：

```json
{
  "target": "#all",
  "agentId": "agent_cindy",
  "body": "@lei-lee 已完成"
}
```

写入时复用现有 idempotent message 写入路径，`author_id=agentId`，`kind="agent"`，`as_task=false`。HTTP handler 必须要求 `idempotency-key` header；service 层用 `namespaced_key("message:send", key)` 或现有 message service namespace，确保 retry 不重复创建消息。写入成功后调用 channel/broadcast 路径触发下一轮投递。

- [ ] **Step 5: 运行测试**

```bash
cargo test -p slei-daemon --test broadcast_claim_api
```

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add crates/slei-daemon/src/api/messages.rs crates/slei-daemon/src/services/message_service.rs crates/slei-daemon/tests/broadcast_claim_api.rs
git commit -m "feat: add agent message history APIs"
```

## Task 5: 新增 Task CLI 语义 API

**Files:**
- Modify: `crates/slei-daemon/src/api/tasks.rs`
- Modify: `crates/slei-daemon/src/services/task_service.rs`
- Modify: `crates/slei-daemon/tests/task_service.rs`
- Modify: `crates/slei-daemon/tests/broadcast_claim_api.rs`

- [ ] **Step 1: 写任务流失败测试**

覆盖：

- `POST /v1/tasks/from-source-message` 用现有 message 创建 task，task root 绑定 `source_message_id`。
- 对同一 source message 重复创建返回同一 task，不新增第二个 task。
- `POST /v1/claims/tasks/{task_id}` 第一个 Agent 成功，第二个失败。
- `POST /v1/tasks/{task_id}/replies` 保留 `role` 和稳定 reply id。
- `PATCH /v1/tasks/{task_id}` 更新 `status`。
- `GET /v1/tasks/{task_id}/thread` 返回 root + replies。
- 重复使用同一个 `idempotency-key` 调用 task create/reply 不新增 task/reply。

- [ ] **Step 2: 运行测试确认失败**

```bash
cargo test -p slei-daemon --test task_service
cargo test -p slei-daemon --test broadcast_claim_api task
```

Expected: FAIL。

- [ ] **Step 3: 实现 task create-from-source**

`TaskService` 新增：

```rust
pub async fn create_from_source_message(
    &self,
    source_message_id: &str,
    creator_id: &str,
) -> Result<TaskRecord, TaskError>;
```

规则：

- 先查 `task_by_source_message`，存在则直接返回。
- 不存在时读取 source message 的 `channel_id/body/author_id`。
- task id 使用 `Uuid::new_v4()` 或已有稳定 idempotency helper；禁止 `Date.now()`。
- root body 使用源消息 body，任务卡片仍是源消息展示状态，不新增卡片消息。

- [ ] **Step 4: 实现 reply/update/thread API**

API 对应 CLI：

```text
POST  /v1/tasks/from-source-message
POST  /v1/tasks/:task_id/replies
PATCH /v1/tasks/:task_id
GET   /v1/tasks/:task_id/thread
GET   /v1/tasks?channel=all
```

`POST /v1/tasks/from-source-message`、`POST /v1/tasks/:task_id/replies` 和 `PATCH /v1/tasks/:task_id` 都必须要求 `idempotency-key` header，并复用 `TaskService` 的 namespaced idempotency 机制。重复请求返回同一个 task/reply/status response，不新增副作用、activity log 或额外消息。

reply 请求体：

```json
{
  "agentId": "agent_cindy",
  "role": "agent",
  "body": "已处理到第一步"
}
```

- [ ] **Step 5: 运行任务测试**

```bash
cargo test -p slei-daemon --test task_service
cargo test -p slei-daemon --test broadcast_claim_api
```

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add crates/slei-daemon/src/api/tasks.rs crates/slei-daemon/src/services/task_service.rs crates/slei-daemon/tests/task_service.rs crates/slei-daemon/tests/broadcast_claim_api.rs
git commit -m "feat: add task claim cli semantics"
```

## Task 6: 新增 `slei` CLI Crate

**Files:**
- Modify: `Cargo.toml`
- Create: `crates/slei-cli/Cargo.toml`
- Create: `crates/slei-cli/src/main.rs`
- Create: `crates/slei-cli/src/client.rs`
- Create: `crates/slei-cli/tests/cli_args.rs`

- [ ] **Step 1: 写 CLI 参数失败测试**

测试命令树包含：

```text
slei message claim <msg-id> --agent <agent-id>
slei message send --target "#all" --agent <agent-id>
slei message read --channel "#all" --limit 20
slei message read --channel "#all" --after 10
slei message read --channel "#all" --before 10
slei message read --channel "#all" --around msg_123
slei message search --query "关键词"
slei task create --source-message <msg-id> --agent <agent-id>
slei task claim <task-id> --agent <agent-id>
slei task reply <task-id> --agent <agent-id>
slei task update <task-id> --status in_progress
slei task list --channel "#all"
slei task thread <task-id>
slei agent status --agent <agent-id> --state working --phase reading_history
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cargo test -p slei-cli
```

Expected: FAIL，crate 还不存在。

- [ ] **Step 3: 创建 crate**

`crates/slei-cli/Cargo.toml`：

```toml
[package]
name = "slei-cli"
version = "0.1.0"
edition = "2021"

[[bin]]
name = "slei"
path = "src/main.rs"

[dependencies]
anyhow = { workspace = true }
clap = { version = "4", features = ["derive"] }
reqwest = { version = "0.12", features = ["json", "rustls-tls"] }
serde = { workspace = true, features = ["derive"] }
serde_json = { workspace = true }
tokio = { workspace = true, features = ["macros", "rt-multi-thread", "io-std", "io-util"] }
```

在 root `Cargo.toml` workspace members 加入 `crates/slei-cli`。

- [ ] **Step 4: 实现 client**

`client.rs` 读取：

- `SLEI_DAEMON_URL`，默认 `http://127.0.0.1:41273`。
- `SLEI_DAEMON_TOKEN`，存在时加 `Authorization: Bearer ...`。
- 每个写命令可选 `--idempotency-key <key>`；未提供时 CLI 生成稳定于本次进程调用的 UUID key。
- 对 `message send`、`task create`、`task reply`、`task update`、`agent status` 等副作用命令，HTTP request 必须带 `idempotency-key` header。claim 命令本身由唯一约束保证原子，可以不要求 header。
- CLI 负责把 `#all` 转成 API channel id `all`；把 `#all:msg_123` 拆成 `channel=all` 和 `around/thread message_id=msg_123`；不要把带 `#` 的 target 原样写进 SQLite `channel_id`。

提供：

```rust
pub async fn get_json<T: DeserializeOwned>(&self, path: &str) -> anyhow::Result<T>;
pub async fn post_json<B: Serialize, T: DeserializeOwned>(&self, path: &str, body: &B) -> anyhow::Result<T>;
pub async fn patch_json<B: Serialize, T: DeserializeOwned>(&self, path: &str, body: &B) -> anyhow::Result<T>;
pub async fn post_json_idempotent<B: Serialize, T: DeserializeOwned>(
    &self,
    path: &str,
    body: &B,
    idempotency_key: &str,
) -> anyhow::Result<T>;
```

所有 `path` 使用 `/v1/...`，例如 `/v1/claims/messages/{msg_id}`、`/v1/messages/read`、`/v1/tasks/{task_id}/replies`。

- [ ] **Step 5: 实现 main 命令**

`message send` 和 `task reply` 从 stdin 读取 body：

```rust
let mut body = String::new();
tokio::io::stdin().read_to_string(&mut body).await?;
```

输出约定：

- 成功 JSON 打到 stdout。
- claim 失败仍输出 JSON，但进程 exit code 为 2，方便 Agent 区分“别人已认领”。
- daemon/network/参数错误 exit code 为 1。
- CLI 自动生成的 idempotency key 写入 stderr 的 debug 行，方便日志排查；stdout 只输出 daemon JSON，便于 Agent 解析。

- [ ] **Step 6: 运行 CLI 测试**

```bash
cargo test -p slei-cli
```

Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add Cargo.toml crates/slei-cli
git commit -m "feat: add slei agent cli"
```

## Task 7: 将频道新消息流转改为广播投递

**Files:**
- Modify: `crates/slei-daemon/src/services/channel_orchestrator_service.rs`
- Modify: `crates/slei-daemon/tests/channel_orchestration_flow.rs`

- [ ] **Step 1: 写广播流失败测试**

覆盖：

- 用户在频道发消息后，daemon 为频道内每个普通 Agent 创建 `message_deliveries`。
- 不为 coordinator/system-owned agent 创建新流转投递。
- 无明确 mention 的消息不会启动 `coordinator_runtime_runs`。
- 有 `@agent` 的消息也走同一广播投递，实际处理由 Agent prompt + claim 决定。
- Agent 通过 `message send` 发出的消息也触发下一轮广播。
- 旧 channel Agent worker 的普通 stdout/output delta 不会被 daemon 自动转成可见频道消息；可见发言只能来自 `slei message send` 或任务相关 CLI/API。

- [ ] **Step 2: 运行测试确认失败**

```bash
cargo test -p slei-daemon --test channel_orchestration_flow
```

Expected: FAIL，当前实现仍会创建 coordinator runtime。

- [ ] **Step 3: 替换 orchestrator 分支**

在 `channel_orchestrator_service.rs` 中，将新 channel message 的 coordinator 决策分支替换为：

1. 读取 `channel_members(channel_id)`。
2. 过滤普通 Agent：排除 `agent_kind == "coordinator"` 或 `system_owned=true` 的记录。
3. 对每个 Agent 调用 `claims.create_delivery(message_id, channel_id, agent_id)`。
4. 对每个投递启动单条消息处理 run，但本阶段必须关闭或忽略“worker stdout 自动生成可见消息”的旧桥接。
5. runtime prompt 只注入本次触发消息和必要运行时元数据；历史由 Agent 用 CLI 自取。
6. 可见频道发言、任务回复和任务状态更新只能由 Agent 在进程内调用 `slei` CLI 完成。

如果 `ChannelOrchestratorService` 当前没有 `ClaimService`，调整 constructor，由 `AppState` 注入。不要在 UI 或 worker 里补路由逻辑。

- [ ] **Step 4: 保留旧表但不再作为新路径依赖**

本阶段不删除 `coordinator_decisions`、`coordinator_runtime_runs` 等旧表，避免大范围迁移风险；但新消息流转测试必须证明不再写入新的 coordinator runtime。

- [ ] **Step 5: 运行 orchestrator 测试**

```bash
cargo test -p slei-daemon --test channel_orchestration_flow
```

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add crates/slei-daemon/src/services/channel_orchestrator_service.rs crates/slei-daemon/tests/channel_orchestration_flow.rs
git commit -m "feat: broadcast channel messages to agents"
```

## Task 8: 更新 MEMORY Active Context 和 Memory Skill

**Files:**
- Modify: `resources/default-agent-assets/MEMORY.md.template`
- Modify: `resources/default-agent-assets/skills/memory/SKILL.md.template`
- Modify: `crates/slei-default-agent-assets/src/lib.rs`

- [ ] **Step 1: 写模板失败测试**

在 `crates/slei-default-agent-assets/src/lib.rs` 中断言模板包含：

- `## Active Context`
- `最多 3 个频道`
- `频道`
- `时间`
- `当前处理事项`
- `进展`
- `淘汰最旧`

- [ ] **Step 2: 运行测试确认失败**

```bash
cargo test -p slei-default-agent-assets
```

Expected: FAIL，模板还没有多频道规则。

- [ ] **Step 3: 更新 `MEMORY.md.template`**

将 `Active Context` 改为：

```markdown
## Active Context

> 只记录恢复当前工作所需的最小上下文。最多保留 3 个频道事项；当新的频道或事项进入且超过 3 个时，删除最旧的一项。

| Channel | Time | Current Item | Progress |
|---------|------|--------------|----------|
| | | | |
```

- [ ] **Step 4: 更新 memory skill**

补充规则：

- 被唤醒处理新消息前，先看是否已有同频道 Active Context。
- 开始长任务、等待用户确认、交接给其他 Agent、完成阶段性工作、遇到 blocker、即将退出前，判断是否更新。
- 每项必须包含频道、时间、当前处理事项和进展。
- 最多 3 项，超过时删除最旧项。
- Active Context 只存恢复工作所需内容，不复制完整历史；历史用 `slei message read/search` 获取。

- [ ] **Step 5: 运行测试**

```bash
cargo test -p slei-default-agent-assets
```

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add resources/default-agent-assets/MEMORY.md.template resources/default-agent-assets/skills/memory/SKILL.md.template crates/slei-default-agent-assets/src/lib.rs
git commit -m "docs: define multi-channel active context"
```

## Task 9: 更新架构文档

**Files:**
- Modify: `docs/architecture/0005-channel-routing-and-multi-agent-flow.md`
- Modify: `docs/architecture/0006-task-source-message-card.md`

- [ ] **Step 1: 更新 0005**

内容必须覆盖：

- 新流转为频道广播 + Agent 自主 claim。
- daemon 负责落库、投递、原子锁、状态日志、reset、诊断。
- Agent 判断规则来自 system prompt，不由 coordinator 输出 JSON。
- human/Agent 发言都写入频道消息并触发同一广播机制。
- 通过可见 `@mention` 接力，不依赖隐藏路由。
- `slei message claim` 是唯一消息独占入口。
- `slei agent status` 每次上报写最新状态并追加最近 100 条操作日志。

- [ ] **Step 2: 更新 0006**

内容必须覆盖：

- 任务卡片仍是 source message 的展示状态，不新增 task-card 消息。
- `slei task create --source-message` 创建或返回同一任务。
- `slei task claim` 是 task 维度原子锁。
- `slei task reply` 保留 `role` 和稳定 reply id。
- `slei task update` 只通过 daemon API 改 SQLite。

- [ ] **Step 3: 搜索并修正旧命名**

```bash
rg -n "raft|coordinator|Coordinator|routing JSON|coordinator runtime" docs/architecture docs/superpowers/specs docs/superpowers/plans resources/default-agent-assets
```

Expected:

- 不应出现 `raft` 作为新命令名。
- `coordinator` 只能出现在历史/被替换说明里，不能作为新架构 guardrail。

- [ ] **Step 4: 提交**

```bash
git add docs/architecture/0005-channel-routing-and-multi-agent-flow.md docs/architecture/0006-task-source-message-card.md
git commit -m "docs: document broadcast claim architecture"
```

## Task 10: 最终验证

**Files:**
- No code changes expected.

- [ ] **Step 1: 运行 Rust 测试**

```bash
cargo test -p slei-storage
cargo test -p slei-daemon --test broadcast_claim_api
cargo test -p slei-daemon --test channel_orchestration_flow
cargo test -p slei-daemon --test task_service
cargo test -p slei-cli
cargo test -p slei-default-agent-assets
```

Expected: PASS。

- [ ] **Step 2: 运行格式和静态检查**

```bash
cargo fmt --check
cargo clippy --workspace --all-targets -- -D warnings
```

Expected: PASS。

- [ ] **Step 3: 如 DTO 影响 desktop，运行前端检查**

```bash
pnpm test
pnpm exec playwright test apps/desktop/e2e/task-thread-flow.spec.tsx
```

Expected: PASS，或记录不适用原因。

- [ ] **Step 4: 做手工 CLI smoke test**

启动 daemon 后执行：

```bash
slei agent status --agent agent_cindy --state working --phase reading_history
slei message read --channel "#all" --limit 5
printf "收到，我来处理。" | slei message send --target "#all" --agent agent_cindy
```

Expected:

- status 更新成功。
- activity logs 新增记录。
- message read 输出统一 header。
- message send 产生新消息并触发广播投递。

- [ ] **Step 5: 检查 git diff**

```bash
git status --short
git diff --check
```

Expected: 无 whitespace error；只包含本计划相关文件。

- [ ] **Step 6: 最终提交**

```bash
git status --short
```

如果前面每个 Task 已经独立提交，此处不需要额外提交；否则按未提交文件做最后一次 scoped commit。
