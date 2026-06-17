# Agent Activity Log Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在成员详情页新增可展开的 Agent 活动日志 tab，并由 daemon/SQLite 记录最近 200 条可诊断的 run、input、output、tool、status、failure 事件。

**Architecture:** 复用现有 `agent_activity_logs` 和 `/v1/agents/{agent_id}/activity`，通过 migration 扩展字段，由 daemon service 写入、截断、脱敏并执行保留策略。Tauri broker 新增只读 activity command，React 成员页只展示 daemon DTO，不在 UI 推导 Agent 行为。

**Tech Stack:** Rust workspace、SQLite/sqlx、Axum daemon API、Tauri command broker、TypeScript/React/Vitest、shadcn tabs/card/button primitives。

---

## Scope And References

- Spec: `docs/superpowers/specs/2026-06-17-agent-activity-log-design.md`
- Architecture guardrail: `docs/architecture/0005-channel-routing-and-multi-agent-flow.md`
- Existing activity API: `crates/slei-daemon/src/api/claims.rs`
- Existing activity repository: `crates/slei-storage/src/repositories/mod.rs`
- Existing member UI: `apps/desktop/src/features/members/MembersPageView.tsx`

This plan is one cohesive feature. It touches storage, daemon logging, desktop bridge, React UI, and ADR documentation, but each task is independently testable and follows the same source-of-truth boundary.

## File Structure

### Storage And Repository

- Modify: `crates/slei-storage/migrations/0005_agent_activity_event_fields.sql`
  - Add activity event fields to `agent_activity_logs`.
- Modify: `crates/slei-storage/src/migrations.rs`
  - Register `MIGRATION_0005` and add `(5, MIGRATION_0005)` to `MIGRATIONS`.
- Modify: `crates/slei-storage/src/repositories/mod.rs`
  - Extend `AgentActivityLogRow`.
  - Add `NewAgentActivityEventRow`.
  - Add `record_agent_activity_event`.
  - Keep the existing SQLite `state TEXT NOT NULL` column compatible by storing `state.unwrap_or(event_kind)`.
  - Clamp activity limit and retention to 200.
  - Sanitize and truncate every `payload_preview` inside `record_agent_activity_event` before insertion.
- Modify: `crates/slei-storage/src/lib.rs`
  - Update migration version tests.
  - Add tests for new fields, retention, clamp, truncation, and redaction.

### Daemon API And Services

- Modify: `crates/slei-daemon/src/services/claim_service.rs`
  - Write `status.updated` activity events.
  - Preserve status idempotency.
- Modify: `crates/slei-daemon/src/api/claims.rs`
  - Return new DTO fields from `/activity`.
  - Default and clamp limit to 200.
- Modify: `crates/slei-daemon/src/services/channel_orchestrator_service.rs`
  - Record channel run/input/output/tool/completed/failed activity events.
- Modify: `crates/slei-daemon/src/services/agent_dm_service.rs`
  - Record DM run/input/output/tool/completed/failed activity events.
- Test: `crates/slei-daemon/tests/broadcast_claim_api.rs`
  - Update existing activity tests from 100 to 200.
  - Add API DTO coverage.
  - Add channel run worker-event activity coverage.
- Test: `crates/slei-daemon/tests/claude_worker.rs` or `crates/slei-daemon/tests/channel_orchestration_flow.rs`
  - Add focused runtime event logging coverage if existing worker-event helpers fit better there.

### Desktop Broker

- Modify: `apps/desktop/src-tauri/src/daemon_broker.rs`
  - Add `AgentActivityLogView` and `AgentActivityListReceipt`.
  - Add `list_agent_activity`.
  - Offline behavior: return `Ok(AgentActivityListReceipt { logs: vec![] })` when `OfflineFallback::MemoryOnly`; return `Err(AgentError::DaemonUnavailable)` when `OfflineFallback::Empty`.
- Modify: `apps/desktop/src-tauri/src/commands.rs`
  - Add `list_agent_activity_command`.
- Modify: `apps/desktop/src-tauri/src/lib.rs`
  - Register command and add command tests.

### Frontend Bridge And UI

- Modify: `apps/desktop/src/lib/daemon-bridge.ts`
  - Add `AgentActivityLogView`, `AgentActivityListReceipt`.
  - Add `listAgentActivity(agentId, limit?)`.
  - Offline bridge returns `{ logs: [] }`.
- Modify: `apps/desktop/src/test/daemon-bridge-mock.ts`
  - Add mock activity log state and `listAgentActivity`.
- Modify: `apps/desktop/src/app/types.ts`
  - Add optional activity log type only if needed by fixtures; prefer passing logs through `MembersPage` props instead of embedding production state into `SleiMember`.
- Modify: `apps/desktop/src/features/members/MembersPageView.tsx`
  - Add `activity` tab.
  - Fetch logs via `onListAgentActivity`.
  - Render loading/empty/error states and expandable payload rows.
- Modify: `apps/desktop/src/app/SleiAppFrame.tsx` or `apps/desktop/src/app/SleiApp.tsx`
  - Pass bridge callback into `MembersPage`.
- Modify: `apps/desktop/src/i18n/types.ts`
  - Add activity loading/error/expand/collapse labels.
- Modify: `apps/desktop/src/i18n/messages/zh-CN/members.ts`
  - Add Chinese labels.
- Modify: `apps/desktop/src/i18n/messages/en-US/members.ts`
  - Add English labels.
- Test: `apps/desktop/src/features/members/MembersPageView.test.tsx`
  - Activity tab render, empty, error, rows, expandable payload.
- Test: `apps/desktop/src/lib/daemon-bridge.test.ts`
  - Bridge method shape if existing tests cover invoke bindings.

### Documentation

- Modify: `docs/architecture/0005-channel-routing-and-multi-agent-flow.md`
  - Update retention from 100 to 200.
  - Document run/input/output/tool/completion/failure logs.
  - Reaffirm logs are diagnostic only.

## Task 1: Storage Schema And Repository Event Model

**Files:**
- Create: `crates/slei-storage/migrations/0005_agent_activity_event_fields.sql`
- Modify: `crates/slei-storage/src/migrations.rs`
- Modify: `crates/slei-storage/src/repositories/mod.rs`
- Modify: `crates/slei-storage/src/lib.rs`

- [ ] **Step 1: Write failing storage tests**

Add tests in `crates/slei-storage/src/lib.rs`:

```rust
#[tokio::test]
async fn agent_activity_events_store_summary_payload_and_result() {
    let (url, _path) = sqlite_file_url("activity-event-fields");
    let db = SleiDb::connect(&url).await.unwrap();
    db.migrate().await.unwrap();
    let repos = Repositories::new(db.pool().clone());

    repos
        .record_agent_activity_event(NewAgentActivityEventRow {
            agent_id: "agent_a".to_string(),
            run_id: Some("run_1".to_string()),
            channel_id: Some("all".to_string()),
            message_id: Some("msg_1".to_string()),
            task_id: None,
            event_kind: "tool.completed".to_string(),
            severity: "info".to_string(),
            summary: "工具完成：Bash ok=true".to_string(),
            payload_preview: Some(r#"{"tool":"Bash","ok":true}"#.to_string()),
            tool_name: Some("Bash".to_string()),
            ok: Some(true),
            state: None,
            phase: None,
            reason: None,
        })
        .await
        .unwrap();

    let logs = repos.agent_activity_logs("agent_a", 200).await.unwrap();
    assert_eq!(logs[0].event_kind, "tool.completed");
    assert_eq!(logs[0].severity, "info");
    assert_eq!(logs[0].summary, "工具完成：Bash ok=true");
    assert_eq!(logs[0].tool_name.as_deref(), Some("Bash"));
    assert_eq!(logs[0].ok, Some(true));
}

#[tokio::test]
async fn agent_activity_event_payload_preview_is_sanitized_before_storage() {
    let (url, _path) = sqlite_file_url("activity-event-sanitize");
    let db = SleiDb::connect(&url).await.unwrap();
    db.migrate().await.unwrap();
    let repos = Repositories::new(db.pool().clone());

    repos
        .record_agent_activity_event(NewAgentActivityEventRow {
            agent_id: "agent_a".to_string(),
            run_id: Some("run_1".to_string()),
            channel_id: None,
            message_id: None,
            task_id: None,
            event_kind: "run.failed".to_string(),
            severity: "error".to_string(),
            summary: "运行失败".to_string(),
            payload_preview: Some(format!(
                "Authorization: Bearer secret-token password=abc {}",
                "x".repeat(5000)
            )),
            tool_name: None,
            ok: Some(false),
            state: None,
            phase: None,
            reason: None,
        })
        .await
        .unwrap();

    let logs = repos.agent_activity_logs("agent_a", 200).await.unwrap();
    let preview = logs[0].payload_preview.as_deref().unwrap();
    assert!(!preview.contains("secret-token"));
    assert!(!preview.contains("abc"));
    assert!(preview.contains("[redacted]"));
    assert!(preview.contains("[truncated]"));
}

#[tokio::test]
async fn agent_activity_logs_keep_latest_200_per_agent() {
    let (url, _path) = sqlite_file_url("activity-log-retention-200");
    let db = SleiDb::connect(&url).await.unwrap();
    db.migrate().await.unwrap();
    let repos = Repositories::new(db.pool().clone());

    for index in 0..205 {
        repos
            .record_agent_activity_event(NewAgentActivityEventRow {
                agent_id: "agent_a".to_string(),
                run_id: Some(format!("run_{index}")),
                channel_id: None,
                message_id: None,
                task_id: None,
                event_kind: "run.started".to_string(),
                severity: "info".to_string(),
                summary: format!("run started {index}"),
                payload_preview: None,
                tool_name: None,
                ok: None,
                state: None,
                phase: None,
                reason: None,
            })
            .await
            .unwrap();
    }

    let logs = repos.agent_activity_logs("agent_a", 500).await.unwrap();
    assert_eq!(logs.len(), 200);
    assert_eq!(logs.first().unwrap().run_id.as_deref(), Some("run_204"));
    assert_eq!(logs.last().unwrap().run_id.as_deref(), Some("run_5"));
}

#[test]
fn activity_payload_preview_redacts_and_truncates_sensitive_text() {
    let preview = sanitize_activity_payload_preview(
        r#"Authorization: Bearer secret-token password="abc" xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"#,
        48,
    );
    assert!(!preview.contains("secret-token"));
    assert!(!preview.contains("abc"));
    assert!(preview.contains("[redacted]"));
    assert!(preview.contains("[truncated]"));
}
```

Also update existing migration version assertions in `migration_records_every_known_version` and `migration_records_broadcast_claim_version` from `vec![1, 2, 3, 4]` to `vec![1, 2, 3, 4, 5]`.

- [ ] **Step 2: Run storage tests and confirm failure**

Run:

```bash
cargo test -p slei-storage agent_activity -- --nocapture
```

Expected: FAIL because migration version 5, `NewAgentActivityEventRow`, new row fields, retention 200, forced preview sanitization, or sanitizer do not exist yet.

- [ ] **Step 3: Add migration**

Create `crates/slei-storage/migrations/0005_agent_activity_event_fields.sql`:

```sql
ALTER TABLE agent_activity_logs
    ADD COLUMN event_kind TEXT NOT NULL DEFAULT 'status.updated';

ALTER TABLE agent_activity_logs
    ADD COLUMN severity TEXT NOT NULL DEFAULT 'info';

ALTER TABLE agent_activity_logs
    ADD COLUMN summary TEXT NOT NULL DEFAULT '';

ALTER TABLE agent_activity_logs
    ADD COLUMN payload_preview TEXT;

ALTER TABLE agent_activity_logs
    ADD COLUMN tool_name TEXT;

ALTER TABLE agent_activity_logs
    ADD COLUMN ok INTEGER;

INSERT OR IGNORE INTO schema_migrations(version) VALUES (5);
```

Check migration numbering against `crates/slei-storage/migrations/`; if a `0005` file already exists by implementation time, use the next sequence number and update this plan's path references during execution.

Update `crates/slei-storage/src/migrations.rs`:

```rust
pub const MIGRATION_0005: &str = include_str!("../migrations/0005_agent_activity_event_fields.sql");

pub const MIGRATIONS: &[(i64, &str)] = &[
    (1, MIGRATION_0001),
    (2, MIGRATION_0002),
    (3, MIGRATION_0003),
    (4, MIGRATION_0004),
    (5, MIGRATION_0005),
];
```

- [ ] **Step 4: Extend repository row types**

In `crates/slei-storage/src/repositories/mod.rs`, extend `AgentActivityLogRow`:

```rust
pub struct AgentActivityLogRow {
    pub id: String,
    pub agent_id: String,
    pub run_id: Option<String>,
    pub channel_id: Option<String>,
    pub message_id: Option<String>,
    pub task_id: Option<String>,
    pub state: Option<String>,
    pub phase: Option<String>,
    pub reason: Option<String>,
    pub event_kind: String,
    pub severity: String,
    pub summary: String,
    pub payload_preview: Option<String>,
    pub tool_name: Option<String>,
    pub ok: Option<bool>,
    pub created_at: String,
}
```

Add:

```rust
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct NewAgentActivityEventRow {
    pub agent_id: String,
    pub run_id: Option<String>,
    pub channel_id: Option<String>,
    pub message_id: Option<String>,
    pub task_id: Option<String>,
    pub event_kind: String,
    pub severity: String,
    pub summary: String,
    pub payload_preview: Option<String>,
    pub tool_name: Option<String>,
    pub ok: Option<bool>,
    /// Optional semantic status. For non-status events this can be None;
    /// repository insertion must store event_kind into the legacy NOT NULL
    /// state column so older schema assumptions keep working.
    pub state: Option<String>,
    pub phase: Option<String>,
    pub reason: Option<String>,
}
```

- [ ] **Step 5: Implement repository insert, retention, read mapping**

Add `record_agent_activity_event`:

```rust
pub async fn record_agent_activity_event(
    &self,
    row: NewAgentActivityEventRow,
) -> Result<(), sqlx::Error> {
    let mut tx = self.pool.begin().await?;
    let legacy_state = row
        .state
        .clone()
        .unwrap_or_else(|| row.event_kind.clone());
    let payload_preview = row
        .payload_preview
        .as_deref()
        .map(|payload| sanitize_activity_payload_preview(payload, 4096));
    sqlx::query(
        "INSERT INTO agent_activity_logs(
            id, agent_id, run_id, channel_id, message_id, task_id,
            state, phase, reason, event_kind, severity, summary,
            payload_preview, tool_name, ok
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(Uuid::new_v4().to_string())
    .bind(&row.agent_id)
    .bind(&row.run_id)
    .bind(&row.channel_id)
    .bind(&row.message_id)
    .bind(&row.task_id)
    .bind(&legacy_state)
    .bind(&row.phase)
    .bind(&row.reason)
    .bind(&row.event_kind)
    .bind(&row.severity)
    .bind(&row.summary)
    .bind(&payload_preview)
    .bind(&row.tool_name)
    .bind(row.ok.map(|value| if value { 1 } else { 0 }))
    .execute(&mut *tx)
    .await?;

    sqlx::query(
        "DELETE FROM agent_activity_logs
         WHERE agent_id = ?
           AND sequence NOT IN (
             SELECT sequence FROM agent_activity_logs
             WHERE agent_id = ?
             ORDER BY sequence DESC
             LIMIT 200
           )",
    )
    .bind(&row.agent_id)
    .bind(&row.agent_id)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;
    Ok(())
}
```

Update `record_agent_activity` and `record_agent_status_idempotent` to write `status.updated` fields and retain 200.

Important: no caller should pre-sanitize and then bypass `record_agent_activity_event`. All new runtime events, status events, and tests must insert through `record_agent_activity_event` or through `record_agent_status_idempotent`, which should call the same internal insert helper. This keeps truncation and redaction centralized before SQLite persistence.

Update `agent_activity_logs` query to select new fields and clamp max 200:

```rust
let limit = normalize_repository_limit(Some(limit)).min(200);
```

Update `agent_activity_log_row_from_sql` to map nullable legacy fields:

```rust
state: row.try_get("state")?,
event_kind: row.try_get("event_kind")?,
ok: row.try_get::<Option<i64>, _>("ok")?.map(|value| value != 0),
```

- [ ] **Step 6: Implement sanitizer**

Add a small public helper in `crates/slei-storage/src/repositories/mod.rs` and call it from `record_agent_activity_event` before binding `payload_preview`:

```rust
pub fn sanitize_activity_payload_preview(input: &str, max_chars: usize) -> String {
    let redacted = redact_sensitive_activity_text(input);
    let mut output: String = redacted.chars().take(max_chars).collect();
    if redacted.chars().count() > max_chars {
        output.push_str("...[truncated]");
    }
    output
}
```

Implement `redact_sensitive_activity_text` for case-insensitive markers: `authorization`, `bearer`, `token`, `api_key`, `apikey`, `secret`, `password`, `private_key`.

Do not expose any alternate insert path for payload-bearing activity rows. If `record_agent_status_idempotent` keeps custom transactional SQL for idempotency, factor out an internal `insert_agent_activity_event_tx` helper and call the sanitizer there.

- [ ] **Step 7: Run storage tests**

Run:

```bash
cargo test -p slei-storage agent_activity -- --nocapture
```

Expected: PASS.

- [ ] **Step 8: Commit storage changes**

```bash
git add crates/slei-storage/migrations crates/slei-storage/src
git commit -m "feat: extend agent activity storage"
```

## Task 2: Daemon Activity API DTO And Status Logging

**Files:**
- Modify: `crates/slei-daemon/src/api/claims.rs`
- Modify: `crates/slei-daemon/src/services/claim_service.rs`
- Modify: `crates/slei-daemon/tests/broadcast_claim_api.rs`

- [ ] **Step 1: Write failing daemon API tests**

In `crates/slei-daemon/tests/broadcast_claim_api.rs`, update existing status activity assertions:

```rust
assert_eq!(logs[0]["eventKind"], "status.updated");
assert_eq!(logs[0]["severity"], "info");
assert!(logs[0]["summary"].as_str().unwrap().contains("working"));
assert_eq!(logs[0]["payloadPreview"], serde_json::Value::Null);
```

Update retention test name and assertions from 100 to 200:

```rust
async fn agent_activity_api_returns_latest_200_logs() {
    for index in 0..205 { /* existing POST status loop */ }
    let logs = activity_json["logs"].as_array().unwrap();
    assert_eq!(logs.len(), 200);
    assert_eq!(logs.first().unwrap()["runId"], "run_204");
    assert_eq!(logs.last().unwrap()["runId"], "run_5");
}
```

Add limit clamp test:

```rust
#[tokio::test]
async fn agent_activity_api_clamps_limit_to_200() {
    let token = AuthToken::from_static("test-token");
    let app = build_router(AppState::for_tests(token.clone()));
    for index in 0..205 {
        post_agent_status(&app, &token, "agent_cindy", index).await;
    }

    let activity = app
        .oneshot(authed_empty_request(
            &token,
            "/v1/agents/agent_cindy/activity?limit=999",
        ))
        .await
        .unwrap();
    let logs = response_json(activity).await["logs"].as_array().unwrap().clone();
    assert_eq!(logs.len(), 200);
}
```

Use existing test helper style instead of introducing `post_agent_status` if no helper exists.

- [ ] **Step 2: Run failing daemon tests**

Run:

```bash
cargo test -p slei-daemon --test broadcast_claim_api agent_activity -- --nocapture
```

Expected: FAIL because DTO fields and retention are not implemented.

- [ ] **Step 3: Extend API DTO**

In `crates/slei-daemon/src/api/claims.rs`, update `AgentActivityLogView`:

```rust
struct AgentActivityLogView {
    id: String,
    agent_id: String,
    run_id: Option<String>,
    channel_id: Option<String>,
    message_id: Option<String>,
    task_id: Option<String>,
    state: Option<String>,
    phase: Option<String>,
    reason: Option<String>,
    event_kind: String,
    severity: String,
    summary: String,
    payload_preview: Option<String>,
    tool_name: Option<String>,
    ok: Option<bool>,
    created_at: String,
}
```

Set default limit to 200:

```rust
.activity_logs(&agent_id, query.limit.unwrap_or(200))
```

- [ ] **Step 4: Update ClaimService status logging**

In `crates/slei-daemon/src/services/claim_service.rs`, ensure `record_agent_status_idempotent` writes:

```rust
event_kind: "status.updated",
severity: severity_for_status(&row.state),
summary: status_activity_summary(&row.state, row.phase.as_deref(), row.reason.as_deref()),
```

Add helpers:

```rust
fn severity_for_status(state: &str) -> String {
    match state {
        "failed" => "error".to_string(),
        "blocked" => "warning".to_string(),
        _ => "info".to_string(),
    }
}

fn status_activity_summary(state: &str, phase: Option<&str>, reason: Option<&str>) -> String {
    let mut summary = format!("状态更新：{state}");
    if let Some(phase) = phase.filter(|value| !value.trim().is_empty()) {
        summary.push_str(&format!(" / {phase}"));
    }
    if let Some(reason) = reason.filter(|value| !value.trim().is_empty()) {
        summary.push_str(&format!("：{reason}"));
    }
    summary
}
```

- [ ] **Step 5: Run daemon API tests**

Run:

```bash
cargo test -p slei-daemon --test broadcast_claim_api agent_activity -- --nocapture
```

Expected: PASS.

- [ ] **Step 6: Commit API/status changes**

```bash
git add crates/slei-daemon/src/api/claims.rs crates/slei-daemon/src/services/claim_service.rs crates/slei-daemon/tests/broadcast_claim_api.rs
git commit -m "feat: expose agent activity events"
```

## Task 3: Daemon Runtime Event Recording For Channel And DM Runs

**Files:**
- Modify: `crates/slei-daemon/src/services/channel_orchestrator_service.rs`
- Modify: `crates/slei-daemon/src/services/agent_dm_service.rs`
- Modify: `crates/slei-daemon/tests/broadcast_claim_api.rs`
- Modify: `crates/slei-daemon/tests/claude_worker.rs` or `crates/slei-daemon/tests/channel_orchestration_flow.rs`

- [ ] **Step 1: Write failing channel runtime activity test**

Add a test that starts a channel agent run or uses existing worker-event helpers, then asserts activity logs include:

```rust
let kinds: Vec<_> = logs
    .iter()
    .map(|log| log["eventKind"].as_str().unwrap())
    .collect();
assert!(kinds.contains(&"run.started"));
assert!(kinds.contains(&"input.received"));
assert!(kinds.contains(&"tool.started"));
assert!(kinds.contains(&"tool.completed"));
assert!(kinds.contains(&"run.failed"));
```

In the same test, send a failed worker event or tool payload containing sensitive text and assert the stored activity log is sanitized:

```rust
state
    .handle_worker_event(json!({
        "type": "failed",
        "run_id": run_id,
        "message": "Authorization: Bearer secret-token password=abc ".to_string() + &"x".repeat(5000)
    }))
    .await
    .unwrap();

let activity = app
    .oneshot(authed_empty_request(
        &token,
        "/v1/agents/agent_coda/activity?limit=200",
    ))
    .await
    .unwrap();
let activity_json = response_json(activity).await;
let failed = activity_json["logs"]
    .as_array()
    .unwrap()
    .iter()
    .find(|log| log["eventKind"] == "run.failed")
    .unwrap();
let preview = failed["payloadPreview"].as_str().unwrap();
assert!(!preview.contains("secret-token"));
assert!(!preview.contains("abc"));
assert!(preview.contains("[redacted]"));
assert!(preview.contains("[truncated]"));
```

If existing tests already simulate `handle_worker_event`, prefer adding assertions there instead of creating a large new fixture.

- [ ] **Step 2: Write failing DM runtime activity test**

In a DM runtime test, simulate `output_delta` and `completed`, then assert:

```rust
assert!(logs.iter().any(|log| log["eventKind"] == "output.delta"));
assert!(logs.iter().any(|log| log["eventKind"] == "run.completed"));
```

- [ ] **Step 3: Run failing daemon runtime tests**

Run targeted tests chosen in steps 1 and 2, for example:

```bash
cargo test -p slei-daemon --test broadcast_claim_api channel_agent -- --nocapture
cargo test -p slei-daemon --test claude_worker dm -- --nocapture
```

Expected: FAIL because runtime event recording is missing.

- [ ] **Step 4: Add activity recording helpers**

In `channel_orchestrator_service.rs`, add private helpers near worker-event handling:

```rust
async fn record_agent_activity_event(
    &self,
    agent_id: &str,
    run_id: Option<&str>,
    channel_id: Option<&str>,
    message_id: Option<&str>,
    event_kind: &str,
    severity: &str,
    summary: String,
    payload_preview: Option<String>,
    tool_name: Option<&str>,
    ok: Option<bool>,
) {
    let _ = self.repos.record_agent_activity_event(NewAgentActivityEventRow {
        agent_id: agent_id.to_string(),
        run_id: run_id.map(str::to_string),
        channel_id: channel_id.map(str::to_string),
        message_id: message_id.map(str::to_string),
        task_id: None,
        event_kind: event_kind.to_string(),
        severity: severity.to_string(),
        summary,
        payload_preview,
        tool_name: tool_name.map(str::to_string),
        ok,
        state: None,
        phase: None,
        reason: None,
    }).await;
}
```

Adapt to the actual service fields. If `ChannelOrchestratorService` does not expose `repos`, record via `ClaimService` or add a small `AgentActivityService` wrapper rather than threading raw DB pool through UI or worker code.

- [ ] **Step 5: Record channel events at existing handling points**

Add calls:

- When delivery/run starts: `run.started`
- When prompt/input is built: `input.received`
- On `output_delta`: `output.delta`
- On `tool_started` and `product_tool_requested`: `tool.started`
- On `tool_completed`: `tool.completed`
- On `completed`: `run.completed`
- On `failed`: `run.failed`

Summaries should be concise:

```rust
format!("运行开始：run={run_id}")
format!("收到频道 #{channel_id} 消息 {message_id}")
format!("输出片段：{} 字符", delta.chars().count())
format!("开始执行工具：{tool_name}")
format!("工具完成：{tool_name} ok={ok}")
format!("运行失败：{message}")
```

Payload previews can pass raw event details to `record_agent_activity_event`; repository insertion is responsible for sanitizing and truncating before SQLite persistence.

- [ ] **Step 6: Record DM events using same model**

In `agent_dm_service.rs`, add analogous calls for DM run lifecycle. Use conversation/message identifiers in `payload_preview` if no `channel_id/message_id` exists.

- [ ] **Step 7: Run runtime activity tests**

Run:

```bash
cargo test -p slei-daemon --test broadcast_claim_api channel_agent -- --nocapture
cargo test -p slei-daemon --test claude_worker dm -- --nocapture
```

Expected: PASS.

- [ ] **Step 8: Commit runtime logging changes**

```bash
git add crates/slei-daemon/src/services crates/slei-daemon/tests
git commit -m "feat: record agent runtime activity"
```

## Task 4: Tauri Broker Activity Command

**Files:**
- Modify: `apps/desktop/src-tauri/src/daemon_broker.rs`
- Modify: `apps/desktop/src-tauri/src/commands.rs`
- Modify: `apps/desktop/src-tauri/src/lib.rs`

- [ ] **Step 1: Write failing broker tests**

In `apps/desktop/src-tauri/src/lib.rs` test module, add:

```rust
#[test]
fn broker_fetches_agent_activity_with_token() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    let handle = thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        let mut bytes = Vec::new();
        let mut buffer = [0_u8; 512];
        loop {
            let count = stream.read(&mut buffer).unwrap();
            if count == 0 { break; }
            bytes.extend_from_slice(&buffer[..count]);
            if String::from_utf8_lossy(&bytes).contains("\r\n\r\n") { break; }
        }
        let response = r#"{"logs":[{"id":"log_1","agentId":"agent_coda","eventKind":"run.started","severity":"info","summary":"运行开始","createdAt":"2026-06-17 10:00:00"}]}"#;
        write!(
            stream,
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            response.len(),
            response
        ).unwrap();
        String::from_utf8(bytes).unwrap()
    });
    let broker = DaemonBroker::for_tests(RuntimeDescriptor {
        endpoint: format!("http://127.0.0.1:{port}"),
        event_socket: "ws://127.0.0.1:4319/v1/events/ws".to_string(),
        token: "secret-token".to_string(),
        daemon_version: "0.1.0".to_string(),
        protocol_version: "v1".to_string(),
    });

    let receipt = list_agent_activity(&broker, "agent_coda", Some(200)).unwrap();
    let request = handle.join().unwrap();

    assert!(request.contains("GET /v1/agents/agent_coda/activity?limit=200 HTTP/1.1"));
    assert!(request.contains("Authorization: Bearer secret-token"));
    assert_eq!(receipt.logs[0].event_kind, "run.started");
    assert!(!serde_json::to_string(&receipt).unwrap().contains("secret-token"));
}

#[test]
fn broker_agent_activity_offline_memory_fallback_returns_empty_logs() {
    let broker = DaemonBroker::for_tests(RuntimeDescriptor {
        endpoint: "http://127.0.0.1:1".to_string(),
        event_socket: "ws://127.0.0.1:1/v1/events/ws".to_string(),
        token: "secret-token".to_string(),
        daemon_version: "0.1.0".to_string(),
        protocol_version: "v1".to_string(),
    });

    let receipt = list_agent_activity(&broker, "agent_coda", Some(200)).unwrap();
    assert!(receipt.logs.is_empty());
}
```

Add daemon error propagation coverage:

```rust
#[test]
fn broker_agent_activity_daemon_error_is_returned() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    let handle = thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        let mut bytes = Vec::new();
        let mut buffer = [0_u8; 512];
        loop {
            let count = stream.read(&mut buffer).unwrap();
            if count == 0 { break; }
            bytes.extend_from_slice(&buffer[..count]);
            if String::from_utf8_lossy(&bytes).contains("\r\n\r\n") { break; }
        }
        let response = r#"{"error":"storage unavailable"}"#;
        write!(
            stream,
            "HTTP/1.1 500 Internal Server Error\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            response.len(),
            response
        ).unwrap();
    });
    let broker = DaemonBroker::for_tests(RuntimeDescriptor {
        endpoint: format!("http://127.0.0.1:{port}"),
        event_socket: "ws://127.0.0.1:4319/v1/events/ws".to_string(),
        token: "secret-token".to_string(),
        daemon_version: "0.1.0".to_string(),
        protocol_version: "v1".to_string(),
    });

    let result = list_agent_activity(&broker, "agent_coda", Some(200));
    handle.join().unwrap();
    assert!(result.is_err());
}
```

- [ ] **Step 2: Run failing Tauri tests**

Run:

```bash
cargo test -p slei-desktop broker_fetches_agent_activity broker_agent_activity -- --nocapture
```

Expected: FAIL because command/types do not exist.

- [ ] **Step 3: Add broker DTOs and method**

In `daemon_broker.rs`, add:

```rust
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentActivityLogView {
    pub id: String,
    pub agent_id: String,
    pub run_id: Option<String>,
    pub channel_id: Option<String>,
    pub message_id: Option<String>,
    pub task_id: Option<String>,
    pub state: Option<String>,
    pub phase: Option<String>,
    pub reason: Option<String>,
    pub event_kind: String,
    pub severity: String,
    pub summary: String,
    pub payload_preview: Option<String>,
    pub tool_name: Option<String>,
    pub ok: Option<bool>,
    pub created_at: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentActivityListReceipt {
    pub logs: Vec<AgentActivityLogView>,
}
```

Add:

```rust
pub fn list_agent_activity(
    &self,
    agent_id: &str,
    limit: Option<u16>,
) -> Result<AgentActivityListReceipt, AgentError> {
    let limit = limit.unwrap_or(200).min(200);
    let path = format!("/v1/agents/{agent_id}/activity?limit={limit}");
    if let Some(response) = self.send_daemon_request("GET", &path, None, &[]) {
        return serde_json::from_str(&response).map_err(|_| AgentError::DaemonUnavailable);
    }
    if self.offline_fallback == OfflineFallback::Empty {
        return Err(AgentError::DaemonUnavailable);
    }
    Ok(AgentActivityListReceipt { logs: Vec::new() })
}
```

- [ ] **Step 4: Add command and registration**

In `commands.rs`:

```rust
pub fn list_agent_activity(
    broker: &DaemonBroker,
    agent_id: &str,
    limit: Option<u16>,
) -> Result<AgentActivityListReceipt, AgentError> {
    broker.list_agent_activity(agent_id, limit)
}

#[tauri::command]
pub fn list_agent_activity_command(
    state: tauri::State<'_, DaemonBroker>,
    agent_id: String,
    limit: Option<u16>,
) -> Result<AgentActivityListReceipt, String> {
    list_agent_activity(state.inner(), &agent_id, limit).map_err(|error| error.to_string())
}
```

Register in `lib.rs` invoke handler.

- [ ] **Step 5: Run Tauri tests**

Run:

```bash
cargo test -p slei-desktop agent_activity -- --nocapture
```

Expected: PASS.

- [ ] **Step 6: Commit broker changes**

```bash
git add apps/desktop/src-tauri/src
git commit -m "feat: bridge agent activity logs"
```

## Task 5: Frontend Bridge Types And Members Activity UI

**Files:**
- Modify: `apps/desktop/src/lib/daemon-bridge.ts`
- Modify: `apps/desktop/src/test/daemon-bridge-mock.ts`
- Modify: `apps/desktop/src/features/members/MembersPageView.tsx`
- Modify: `apps/desktop/src/app/SleiApp.tsx`
- Modify: `apps/desktop/src/app/SleiAppFrame.tsx` if needed by prop threading
- Modify: `apps/desktop/src/i18n/types.ts`
- Modify: `apps/desktop/src/i18n/messages/zh-CN/members.ts`
- Modify: `apps/desktop/src/i18n/messages/en-US/members.ts`
- Modify: `apps/desktop/src/features/members/MembersPageView.test.tsx`

- [ ] **Step 1: Write failing React tests**

In `MembersPageView.test.tsx`, add tests using `renderToStaticMarkup` for static states. For expand/collapse interaction, use existing dependencies only: `react-dom/client`, `react-dom/test-utils` `act` if available from React, and DOM `click()`. Do not add `@testing-library/react`.

Static render test:

```tsx
it("renders an activity tab with daemon activity rows", () => {
  const messages = createDesktopMessages("zh-CN");
  const html = renderToStaticMarkup(
    <MembersPage
      activeMemberId="agent_coda"
      data={createSleiFixtures({ members: [agentFixture("agent_coda")] })}
      messages={messages}
      nodes={[nodeFixture()]}
      activityLogs={[
        {
          id: "log_1",
          agentId: "agent_coda",
          runId: "run_1",
          eventKind: "run.started",
          severity: "info",
          summary: "运行开始",
          payloadPreview: "{\"run\":\"run_1\"}",
          createdAt: "2026-06-17 10:00:00",
        },
      ]}
      onListAgentActivity={() => ({ logs: [] })}
    />,
  );

  expect(html).toContain("活动日志");
  expect(html).toContain("运行开始");
  expect(html).toContain("run.started");
  expect(html).toContain("run_1");
});
```

Add empty/error render tests:

```tsx
expect(html).toContain(messages.members.noActivity);
expect(html).toContain(messages.members.activityLoadFailed);
```

Add selected-member reload coverage with a real DOM mount:

```tsx
it("reloads activity logs when selected member changes", async () => {
  const calls: string[] = [];
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const messages = createDesktopMessages("en-US");

  await act(async () => {
    root.render(
      <MembersPage
        activeMemberId="agent_a"
        data={createSleiFixtures({ members: [agentFixture("agent_a"), agentFixture("agent_b")] })}
        messages={messages}
        nodes={[nodeFixture()]}
        onListAgentActivity={(agentId) => {
          calls.push(agentId);
          return { logs: [] };
        }}
      />,
    );
  });

  await act(async () => {
    root.render(
      <MembersPage
        activeMemberId="agent_b"
        data={createSleiFixtures({ members: [agentFixture("agent_a"), agentFixture("agent_b")] })}
        messages={messages}
        nodes={[nodeFixture()]}
        onListAgentActivity={(agentId) => {
          calls.push(agentId);
          return { logs: [] };
        }}
      />,
    );
  });

  expect(calls).toContain("agent_b");
  root.unmount();
  container.remove();
});
```

Add an interaction test that mounts the component into a real DOM container:

```tsx
import { act } from "react";
import { createRoot } from "react-dom/client";

it("expands and collapses activity payload details", async () => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const messages = createDesktopMessages("en-US");

  await act(async () => {
    root.render(
      <MembersPage
        activeMemberId="agent_coda"
        data={createSleiFixtures({ members: [agentFixture("agent_coda")] })}
        messages={messages}
        nodes={[nodeFixture()]}
        activityLogs={[{
          id: "log_1",
          agentId: "agent_coda",
          eventKind: "run.failed",
          severity: "error",
          summary: "Runtime failed",
          payloadPreview: "{\"error\":\"boom\"}",
          createdAt: "2026-06-17 10:00:00",
        }]}
      />,
    );
  });

  const button = Array.from(container.querySelectorAll("button"))
    .find((node) => node.textContent?.includes(messages.members.expandActivityPayload));
  expect(button).toBeTruthy();
  expect(container.textContent).not.toContain("\"boom\"");

  await act(async () => {
    button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  expect(container.textContent).toContain("\"boom\"");
  expect(container.textContent).toContain(messages.members.collapseActivityPayload);

  await act(async () => {
    button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  expect(container.textContent).not.toContain("\"boom\"");

  root.unmount();
  container.remove();
});
```

If helper fixtures such as `agentFixture` or `nodeFixture` do not exist, define small local helpers in the test file matching the existing member fixture shape.

- [ ] **Step 2: Run failing frontend tests**

Run:

```bash
pnpm --filter @slei/desktop test -- MembersPageView
```

Expected: FAIL because activity props/types/UI do not exist.

- [ ] **Step 3: Add bridge types and method**

In `daemon-bridge.ts`, add:

```ts
export type AgentActivityLogView = {
  id: string;
  agentId: string;
  runId?: string;
  channelId?: string;
  messageId?: string;
  taskId?: string;
  state?: string;
  phase?: string;
  reason?: string;
  eventKind: string;
  severity: "info" | "warning" | "error" | string;
  summary: string;
  payloadPreview?: string;
  toolName?: string;
  ok?: boolean;
  createdAt: string;
};

export type AgentActivityListReceipt = {
  logs: AgentActivityLogView[];
};
```

Add to `DaemonBridge`:

```ts
listAgentActivity(agentId: string, limit?: number): Promise<AgentActivityListReceipt>;
```

Offline bridge:

```ts
async listAgentActivity() {
  return { logs: [] };
}
```

Tauri bridge:

```ts
listAgentActivity: (agentId: string, limit = 200) =>
  invoke<AgentActivityListReceipt>("list_agent_activity_command", { agentId, limit }),
```

Update `apps/desktop/src/test/daemon-bridge-mock.ts`:

```ts
import type { AgentActivityLogView } from "../lib/daemon-bridge";

export function createDaemonBridgeMock(input: {
  connected: boolean;
  activityLogs?: AgentActivityLogView[];
  // existing fields...
}): DaemonBridgeMock {
  let activityLogs = input.activityLogs ?? [];
  return {
    // existing methods...
    async listAgentActivity(agentId: string, limit = 200) {
      return {
        logs: activityLogs
          .filter((log) => log.agentId === agentId)
          .slice(0, limit),
      };
    },
  };
}
```

- [ ] **Step 4: Add i18n labels**

In `types.ts` members block:

```ts
activityLog: string;
activityLoadFailed: string;
activityLoading: string;
activityPayload: string;
collapseActivityPayload: string;
expandActivityPayload: string;
```

Chinese:

```ts
activityLog: "活动日志",
activityLoadFailed: "无法加载活动日志",
activityLoading: "正在加载活动日志",
activityPayload: "活动详情",
collapseActivityPayload: "收起详情",
expandActivityPayload: "展开详情",
```

English:

```ts
activityLog: "Activity log",
activityLoadFailed: "Unable to load activity log",
activityLoading: "Loading activity log",
activityPayload: "Activity details",
collapseActivityPayload: "Collapse details",
expandActivityPayload: "Expand details",
```

- [ ] **Step 5: Implement MembersPage activity state and tab**

In `MembersPageView.tsx`:

```ts
type MemberTab = "profile" | "workspace" | "capabilities" | "activity";
```

Extend props:

```ts
activityLogs?: AgentActivityLogView[];
activityError?: string;
onListAgentActivity?: (agentId: string, limit?: number) => Promise<AgentActivityListReceipt> | AgentActivityListReceipt;
```

State:

```ts
const [activityLogs, setActivityLogs] = useState<AgentActivityLogView[]>(input.activityLogs ?? []);
const [activityLoading, setActivityLoading] = useState(false);
const [activityError, setActivityError] = useState<string | undefined>(input.activityError);
const [expandedActivityIds, setExpandedActivityIds] = useState<Set<string>>(() => new Set());
```

Load when selected member changes or activity tab opens:

```ts
useEffect(() => {
  setActivityLogs(input.activityLogs ?? []);
  setActivityError(input.activityError);
  setExpandedActivityIds(new Set());
}, [selectedMember?.id, input.activityLogs, input.activityError]);

useEffect(() => {
  if (activeTab !== "activity" || !selectedMember || selectedMember.type !== "agent" || !input.onListAgentActivity) return;
  let cancelled = false;
  setActivityLoading(true);
  setActivityError(undefined);
  void Promise.resolve(input.onListAgentActivity(selectedMember.id, 200))
    .then((receipt) => {
      if (!cancelled) setActivityLogs(receipt.logs);
    })
    .catch(() => {
      if (!cancelled) setActivityError(input.messages.members.activityLoadFailed);
    })
    .finally(() => {
      if (!cancelled) setActivityLoading(false);
    });
  return () => {
    cancelled = true;
  };
}, [activeTab, selectedMember?.id]);
```

Render tab trigger after capabilities:

```tsx
<TabsTrigger value="activity">{input.messages.members.activityLog}</TabsTrigger>
```

Render content:

```tsx
<TabsContent forceMount value="activity" className="grid gap-4 data-[state=inactive]:hidden">
  <ActivityLogPanel
    error={activityError}
    expandedIds={expandedActivityIds}
    loading={activityLoading}
    logs={activityLogs}
    messages={input.messages}
    onToggle={(id) => setExpandedActivityIds((current) => toggleSetValue(current, id))}
  />
</TabsContent>
```

Add small focused `ActivityLogPanel`, `ActivityLogRow`, and `toggleSetValue` helpers at bottom of file.

- [ ] **Step 6: Thread bridge callback from app**

In `SleiApp.tsx` or `SleiAppFrame.tsx`, pass:

```tsx
onListAgentActivity={(agentId, limit) => bridge.listAgentActivity(agentId, limit)}
```

Keep logs out of `SleiFixtures` unless existing architecture requires preloaded data.

- [ ] **Step 7: Run frontend tests**

Run:

```bash
pnpm --filter @slei/desktop test -- MembersPageView
pnpm --filter @slei/desktop typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit frontend changes**

```bash
git add apps/desktop/src/lib/daemon-bridge.ts apps/desktop/src/features/members apps/desktop/src/app apps/desktop/src/i18n
git add apps/desktop/src/test/daemon-bridge-mock.ts
git commit -m "feat: show agent activity logs"
```

## Task 6: Architecture Documentation And Guardrails

**Files:**
- Modify: `docs/architecture/0005-channel-routing-and-multi-agent-flow.md`

- [ ] **Step 1: Update ADR text**

Update the existing “Agent 状态与操作日志” section:

```md
daemon 必须持久化最新状态，并把状态上报追加到 `agent_activity_logs`。
同一张活动日志还记录 daemon 观察到的 run/input/output/tool/completed/failed 诊断事件。
该日志用于 debug 和最近活动展示，不参与路由决策、claim 判断或任务调度。
每个 Agent 只保留最近 200 条，超过后删除最旧记录。
```

Update earlier bullet that currently says 100 to 200 and mention expanded event sources.

- [ ] **Step 2: Run architecture guardrail tests**

Run:

```bash
pnpm test:guardrails
```

Expected: PASS.

- [ ] **Step 3: Commit docs**

```bash
git add docs/architecture/0005-channel-routing-and-multi-agent-flow.md
git commit -m "docs: update agent activity guardrails"
```

## Task 7: Final Verification

**Files:**
- No new source files expected; this task validates the full stack.

- [ ] **Step 1: Run Rust storage and daemon tests**

Run:

```bash
cargo test -p slei-storage agent_activity -- --nocapture
cargo test -p slei-daemon agent_activity -- --nocapture
cargo test -p slei-desktop agent_activity -- --nocapture
```

Expected: PASS.

- [ ] **Step 2: Run frontend tests and typecheck**

Run:

```bash
pnpm --filter @slei/desktop test -- MembersPageView
pnpm --filter @slei/desktop typecheck
```

Expected: PASS.

- [ ] **Step 3: Run architecture guardrails**

Run:

```bash
pnpm test:guardrails
```

Expected: PASS.

- [ ] **Step 4: Run full targeted verification if time allows**

Run:

```bash
cargo test -p slei-storage
cargo test -p slei-daemon
cargo test -p slei-desktop
pnpm --filter @slei/desktop test
```

Expected: PASS. If too slow, capture which targeted commands passed and which full commands were skipped.

- [ ] **Step 5: Inspect final diff**

Run:

```bash
git status --short
git diff --stat HEAD
```

Expected: Only intentional feature files changed.

## Implementation Notes

- Keep production state in SQLite. Do not add JSON file persistence for activity logs.
- Keep activity logs diagnostic only. Do not use them for routing, claim, task state, or retry decisions.
- Do not record full prompts, daemon tokens, Authorization headers, or full unbounded output.
- For non-status runtime events, the SQLite legacy `state` column should store `event_kind` for NOT NULL compatibility. The public DTO may expose that compatibility value in `state`; consumers must use `eventKind` as the semantic event type.
- Prefer a small helper for activity event creation instead of duplicating SQL payload assembly in multiple daemon services.
- If the current `ChannelOrchestratorService` does not have direct repository access, introduce a focused service wrapper rather than passing UI-level data into daemon internals.
- UI cards should not be nested inside cards. The Activity tab can use one top-level panel and repeated rows, following existing member page density.
- After implementation is complete, use `superpowers:verification-before-completion` before claiming success.
