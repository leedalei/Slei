# Agent Role Presets Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build daemon-backed Agent role presets for the manual member creation modal, with a wider split layout, preset description cards, hidden handle generation from name, and refreshable pixel avatar seeds.

**Architecture:** `agent_role_presets` lives in SQLite and is read through daemon API, Tauri command, and desktop bridge. The modal only renders daemon data and submits the final `createAgent` request with generated `handle`, selected/custom `description`, and optional `avatarSeed`. Agent creation validation and persistence stay in daemon/storage; UI performs only immediate view-level validation.

**Tech Stack:** Rust, Axum, sqlx SQLite migrations/repositories, Tauri commands, TypeScript, React, Radix/shadcn UI primitives, Dicebear pixelArt avatars, Vitest/jsdom, Rust integration tests.

---

## Context And Guardrails

- Spec: `docs/superpowers/specs/2026-06-30-agent-create-role-presets-design.md`
- Current worktree has unrelated unstaged code changes. Execute this plan in a clean branch/worktree before editing code.
- Knowledge retrieval:
  - `docs/knowledge/runtime-errors/createchannel-product-tool-card-rejected-20260624.md`: product feature chains must be wired end-to-end, not just in UI.
  - `docs/knowledge/best-practices/task-thread-stable-ids-and-reply-roles-20260529.md`: avoid uncontrolled `Date.now()` in testable identifiers; make avatar seed generation deterministic or injectable in tests.
- Do not add frontend production mock preset data. Test fixtures may include preset data.
- Do not update ADR `0005` or `0006` unless implementation changes channel routing, task cards, or preset/Agent persistence semantics beyond this plan.
- Default seed behavior: use insert-only idempotency (`INSERT OR IGNORE`) for first pass. Built-in presets are not included in `RESET_MUTABLE_TABLES`; dev reset preserves or re-seeds them rather than treating them as user-created product state.

## File Structure

- Create `crates/slei-storage/migrations/0011_agent_role_presets.sql`: table and indexes.
- Modify `crates/slei-storage/src/migrations.rs`: register migration 11.
- Modify `crates/slei-storage/src/repositories/mod.rs`: `AgentRolePresetRow`, default seed constants, seed/list repository methods.
- Add or modify storage tests, preferably `crates/slei-storage/tests/agent_role_presets.rs`: migration, seed idempotency, enabled filtering, sort order.
- Create `crates/slei-daemon/src/api/agent_role_presets.rs`: authenticated read API.
- Modify `crates/slei-daemon/src/api/mod.rs`: export new API module.
- Modify `crates/slei-daemon/src/app.rs`: route `GET /v1/agent-role-presets`.
- Modify `crates/slei-daemon/src/state.rs`: seed presets after repository initialization and expose no new app service unless needed.
- Modify `crates/slei-daemon/src/services/member_service.rs`: optional `avatar_seed` in `ProductAgentDraft`, relaxed handle validation, duplicate name validation, persistence of submitted avatar seed.
- Modify daemon tests, likely `crates/slei-daemon/tests/agent_workspace.rs` or a new `crates/slei-daemon/tests/agent_role_presets_api.rs`: API and create-agent validation/persistence.
- Modify `apps/desktop/src-tauri/src/daemon_broker.rs`: preset DTO/receipt, command plumbing, daemon fetch with explicit errors, optional `avatar_seed`, relaxed local handle validation, local fallback avatar seed persistence.
- Modify `apps/desktop/src-tauri/src/commands.rs`: command wrapper and imports.
- Modify `apps/desktop/src-tauri/src/lib.rs`: add command to `generate_handler`.
- Modify `apps/desktop/src/lib/daemon-bridge.ts`: TypeScript DTOs and `listAgentRolePresets`.
- Modify `apps/desktop/src/lib/daemon-bridge.test.ts`: command shape and offline behavior.
- Modify `apps/desktop/src/test/daemon-bridge-mock.ts`: mock method and createAgent avatarSeed handling.
- Modify `apps/desktop/src/app/model.ts`: `AgentDraftInput` gains optional `avatarSeed`; add pure helpers for `agentHandleFromName`, name validation, avatar seed generation if useful.
- Modify `apps/desktop/src/app/SleiAppFrame.tsx`: modal state, preset loading, split layout, avatar/name UI, radio/card behavior.
- Modify `apps/desktop/src/i18n/types.ts`, `apps/desktop/src/i18n/messages/zh-CN/agentCreate.ts`, `apps/desktop/src/i18n/messages/en-US/agentCreate.ts`: new labels/errors.
- Modify `apps/desktop/src/app/SleiAppFrame.test.tsx`: modal DOM and interactions.
- Optionally modify `apps/desktop/src/app/SleiApp.test.ts`: source assertions for create-agent error/success still valid after request shape changes.

---

### Task 0: Prepare Clean Execution Branch

**Files:**
- No source edits in this task.

- [ ] **Step 1: Record current dirty state**

Run:

```bash
git status --short --branch
```

Expected: current branch is ahead by the docs commit and has unrelated unstaged task files. Do not stage or revert those files.

- [ ] **Step 2: Create an isolated branch or worktree**

Recommended command from repo root:

```bash
git switch -c codex/agent-role-presets
```

If the existing dirty files must be kept out of this branch, create a separate worktree from current `HEAD` instead:

```bash
git worktree add ../Slei-agent-role-presets -b codex/agent-role-presets HEAD
```

Expected: implementation happens on `codex/agent-role-presets` with only intentional files changed.

---

### Task 1: Add SQLite Preset Table And Repository

**Files:**
- Create: `crates/slei-storage/migrations/0011_agent_role_presets.sql`
- Modify: `crates/slei-storage/src/migrations.rs`
- Modify: `crates/slei-storage/src/repositories/mod.rs`
- Test: `crates/slei-storage/tests/agent_role_presets.rs`

- [ ] **Step 1: Write failing storage tests**

Create `crates/slei-storage/tests/agent_role_presets.rs` with tests equivalent to:

```rust
use slei_storage::db::SleiDb;
use slei_storage::repositories::Repositories;

async fn test_repos(name: &str) -> Repositories {
    let root = std::env::temp_dir().join(format!("{name}-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&root).unwrap();
    let url = format!("sqlite://{}", root.join("slei.sqlite").display());
    let db = SleiDb::connect(&url).await.unwrap();
    db.migrate().await.unwrap();
    Repositories::new(db.pool().clone())
}

#[tokio::test]
async fn agent_role_presets_seed_idempotently_and_list_enabled_sorted() {
    let repos = test_repos("slei-role-presets").await;

    repos.seed_default_agent_role_presets().await.unwrap();
    repos.seed_default_agent_role_presets().await.unwrap();

    let presets = repos.agent_role_presets().await.unwrap();

    assert_eq!(presets.len(), 10);
    assert_eq!(presets[0].id, "xiaohongshu-researcher");
    assert_eq!(presets[0].title, "小红书调研员");
    assert_eq!(presets[0].sort_order, 10);
    assert!(presets.iter().all(|preset| preset.enabled));
    assert_eq!(presets.last().unwrap().id, "operations-planner");
}

#[tokio::test]
async fn agent_role_presets_omit_disabled_rows() {
    let repos = test_repos("slei-role-presets-disabled").await;

    repos.seed_default_agent_role_presets().await.unwrap();
    repos.set_agent_role_preset_enabled_for_test("qa-reviewer", false).await.unwrap();

    let presets = repos.agent_role_presets().await.unwrap();

    assert!(!presets.iter().any(|preset| preset.id == "qa-reviewer"));
}
```

Because these are integration tests, avoid `#[cfg(test)]` helpers that are invisible to downstream test crates. Add a narrowly named public helper such as `set_agent_role_preset_enabled_for_test` with a doc comment stating it exists only for repository tests.

- [ ] **Step 2: Run storage tests and verify failure**

Run:

```bash
cargo test -p slei-storage --test agent_role_presets
```

Expected: FAIL because migration/repository methods do not exist.

- [ ] **Step 3: Add migration**

Create `crates/slei-storage/migrations/0011_agent_role_presets.sql`:

```sql
CREATE TABLE IF NOT EXISTS agent_role_presets (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_agent_role_presets_enabled_sort
    ON agent_role_presets(enabled, sort_order, title);

INSERT OR IGNORE INTO schema_migrations(version) VALUES (11);
```

Update `crates/slei-storage/src/migrations.rs`:

```rust
pub const MIGRATION_0011: &str = include_str!("../migrations/0011_agent_role_presets.sql");

pub const MIGRATIONS: &[(i64, &str)] = &[
    // existing entries...
    (11, MIGRATION_0011),
];
```

- [ ] **Step 4: Add repository row and default seed**

In `crates/slei-storage/src/repositories/mod.rs`, add:

```rust
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AgentRolePresetRow {
    pub id: String,
    pub title: String,
    pub description: String,
    pub sort_order: i64,
    pub enabled: bool,
}

const DEFAULT_AGENT_ROLE_PRESETS: &[(&str, &str, &str, i64)] = &[
    ("xiaohongshu-researcher", "小红书调研员", "负责从小红书调研检索信息，整理笔记、提炼趋势、对比竞品，并输出可执行的分析结论。", 10),
    ("research-analyst", "资料调研员", "负责围绕指定主题收集资料、核对来源、归纳关键事实，并形成结构化调研摘要。", 20),
    ("product-planner", "产品策划员", "负责拆解用户需求、梳理使用场景、设计功能边界，并输出清晰的产品方案。", 30),
    ("engineering-implementer", "研发执行员", "负责根据明确需求实现代码、修复缺陷、运行验证，并及时反馈风险和阻塞。", 40),
    ("system-architect", "系统架构师", "负责设计系统架构、拆分模块边界、识别技术风险，并给出可落地的演进方案。", 50),
    ("qa-reviewer", "质量审查员", "负责检查交付物的正确性、边界条件、回归风险和体验问题，并给出可复现的改进建议。", 60),
    ("teaching-assistant", "教学助理", "负责把复杂知识拆成循序渐进的讲解、练习和反馈，帮助学习者理解概念并完成训练。", 70),
    ("legal-researcher", "法律研究员", "负责整理法律、合同和合规相关资料，提炼风险点与待确认问题，并提醒用户寻求专业律师确认。", 80),
    ("finance-analyst", "财务分析员", "负责整理预算、成本、收入和指标数据，做基础测算、趋势分析和风险提示。", 90),
    ("operations-planner", "运营策划员", "负责设计活动方案、用户触达节奏、内容排期和效果指标，并持续复盘优化。", 100),
];
```

Then add repository methods:

```rust
pub async fn seed_default_agent_role_presets(&self) -> Result<(), sqlx::Error> {
    for (id, title, description, sort_order) in DEFAULT_AGENT_ROLE_PRESETS {
        sqlx::query(
            "INSERT OR IGNORE INTO agent_role_presets(id, title, description, sort_order, enabled)
             VALUES (?, ?, ?, ?, 1)",
        )
        .bind(id)
        .bind(title)
        .bind(description)
        .bind(sort_order)
        .execute(&self.pool)
        .await?;
    }
    Ok(())
}

pub async fn agent_role_presets(&self) -> Result<Vec<AgentRolePresetRow>, sqlx::Error> {
    let rows = sqlx::query(
        "SELECT id, title, description, sort_order, enabled
         FROM agent_role_presets
         WHERE enabled = 1
         ORDER BY sort_order ASC, title ASC",
    )
    .fetch_all(&self.pool)
    .await?;

    rows.into_iter()
        .map(|row| Ok(AgentRolePresetRow {
            id: row.try_get("id")?,
            title: row.try_get("title")?,
            description: row.try_get("description")?,
            sort_order: row.try_get("sort_order")?,
            enabled: row.try_get::<i64, _>("enabled")? != 0,
        }))
        .collect()
}

/// Test support for repository integration tests.
pub async fn set_agent_role_preset_enabled_for_test(
    &self,
    id: &str,
    enabled: bool,
) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE agent_role_presets SET enabled = ? WHERE id = ?")
        .bind(if enabled { 1 } else { 0 })
        .bind(id)
        .execute(&self.pool)
        .await?;
    Ok(())
}
```

- [ ] **Step 5: Seed during daemon repository initialization**

In `crates/slei-daemon/src/state.rs`, after `let repos = Repositories::new(db.pool().clone());`:

```rust
repos
    .seed_default_agent_role_presets()
    .await
    .expect("seed default agent role presets");
```

Also add the same seed call in the test-only helper in `crates/slei-daemon/src/services/member_service.rs` if those service tests create repositories without going through `AppState`.

- [ ] **Step 6: Run storage tests**

Run:

```bash
cargo test -p slei-storage --test agent_role_presets
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add crates/slei-storage/migrations/0011_agent_role_presets.sql crates/slei-storage/src/migrations.rs crates/slei-storage/src/repositories/mod.rs crates/slei-storage/tests/agent_role_presets.rs crates/slei-daemon/src/state.rs crates/slei-daemon/src/services/member_service.rs
git commit -m "feat: seed agent role presets"
```

---

### Task 2: Add Daemon Preset API And Agent Creation Rules

**Files:**
- Create: `crates/slei-daemon/src/api/agent_role_presets.rs`
- Modify: `crates/slei-daemon/src/api/mod.rs`
- Modify: `crates/slei-daemon/src/app.rs`
- Modify: `crates/slei-daemon/src/services/member_service.rs`
- Test: `crates/slei-daemon/tests/agent_role_presets_api.rs`
- Test: `crates/slei-daemon/tests/agent_workspace.rs` if reusing existing create-agent tests is simpler.

- [ ] **Step 1: Write failing daemon API tests**

Create `crates/slei-daemon/tests/agent_role_presets_api.rs` using the style of existing daemon API tests. Cover:

```rust
#[tokio::test]
async fn lists_enabled_agent_role_presets_from_sqlite_sorted() {
    // Arrange AppState::for_tests_with_agent_root_async(...)
    // GET /v1/agent-role-presets with auth header
    // Assert 200, 10 presets, first xiaohongshu-researcher, no disabled rows.
}

#[tokio::test]
async fn agent_create_accepts_chinese_handle_and_persists_avatar_seed() {
    // POST /v1/agents with:
    // name: "小红书调研员"
    // handle: "@小红书调研员"
    // avatarSeed: "avatar-custom-seed"
    // Assert 201, returned agent.handle == "@小红书调研员", avatarSeed == "avatar-custom-seed".
}

#[tokio::test]
async fn agent_create_rejects_name_with_space_or_hyphen_and_duplicate_name() {
    // Assert "系统 架构师" rejected.
    // Assert "legal-researcher" rejected.
    // Create "架构师"; retry same trimmed name with different handle; assert rejected.
}
```

- [ ] **Step 2: Run daemon tests and verify failure**

Run:

```bash
cargo test -p slei-daemon --test agent_role_presets_api
```

Expected: FAIL because route/API/validation do not exist.

- [ ] **Step 3: Add API module**

Create `crates/slei-daemon/src/api/agent_role_presets.rs`:

```rust
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::Serialize;

use crate::state::AppState;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentRolePresetView {
    id: String,
    title: String,
    description: String,
    sort_order: i64,
}

pub async fn list(State(state): State<AppState>, headers: HeaderMap) -> Response {
    if !state.auth_token.is_authorized(&headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let _activity_guard = match crate::api::begin_resettable_read(&state).await {
        Ok(guard) => guard,
        Err(response) => return response,
    };

    match state.orchestration().repos().agent_role_presets().await {
        Ok(presets) => Json(serde_json::json!({
            "presets": presets.into_iter().map(|preset| AgentRolePresetView {
                id: preset.id,
                title: preset.title,
                description: preset.description,
                sort_order: preset.sort_order,
            }).collect::<Vec<_>>()
        })).into_response(),
        Err(error) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": error.to_string() })),
        ).into_response(),
    }
}
```

If `state.orchestration().repos()` is not the clearest path, add a small `AppState::repos()` accessor instead.

- [ ] **Step 4: Wire module and route**

In `crates/slei-daemon/src/api/mod.rs`:

```rust
pub mod agent_role_presets;
```

In `crates/slei-daemon/src/app.rs`:

```rust
.route("/v1/agent-role-presets", get(api::agent_role_presets::list))
```

- [ ] **Step 5: Extend `ProductAgentDraft`**

In `crates/slei-daemon/src/services/member_service.rs`:

```rust
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductAgentDraft {
    pub name: String,
    pub handle: String,
    pub runtime_kind: String,
    pub model: String,
    pub node_id: String,
    pub description: String,
    pub avatar_seed: Option<String>,
}
```

Update all existing test literals and guide creation code with `avatar_seed: None` where required.

- [ ] **Step 6: Relax handle validation**

Replace daemon `normalize_handle` with:

```rust
fn normalize_handle(handle: &str) -> Result<String, MemberError> {
    let trimmed = handle.trim().trim_start_matches('@');
    let valid = !trimmed.is_empty()
        && trimmed.chars().count() <= 32
        && !trimmed.chars().any(char::is_whitespace)
        && !trimmed.contains('-');
    if valid {
        Ok(format!("@{trimmed}"))
    } else {
        Err(MemberError::InvalidHandle)
    }
}
```

Use the same format rule in Tauri broker later. Do not lowercase; handle now intentionally mirrors display name.

- [ ] **Step 7: Add name validation and duplicate name check**

Add helpers:

```rust
fn validate_agent_name(name: &str) -> Result<String, MemberError> {
    let trimmed = name.trim();
    let valid = !trimmed.is_empty()
        && !trimmed.chars().any(char::is_whitespace)
        && !trimmed.contains('-');
    if valid {
        Ok(trimmed.to_string())
    } else {
        Err(MemberError::InvalidAgent)
    }
}
```

In `create_product_agent`, validate name before duplicate checks and reject duplicate trimmed names:

```rust
let normalized_name = validate_agent_name(&draft.name)?;
// existing normalized_handle...
if state/product agents already contain normalized_name exactly after trim {
    return Err(MemberError::DuplicateHandle); // or add DuplicateName if error mapping supports it.
}
if repos.agents().await?.iter().any(|agent| agent.name.trim() == normalized_name) {
    return Err(MemberError::DuplicateHandle);
}
```

Prefer adding `MemberError::DuplicateName` only if API tests can assert a clear error without broad error-mapping churn. Otherwise reuse existing 409 duplicate path and name it clearly in tests by behavior/status.

- [ ] **Step 8: Persist optional avatar seed**

In `create_product_agent_record_with_channels`, choose:

```rust
let avatar_seed = draft
    .avatar_seed
    .as_deref()
    .map(str::trim)
    .filter(|seed| !seed.is_empty())
    .map(str::to_string)
    .unwrap_or_else(|| if agent_kind == "guide" { "yeal".to_string() } else { id.clone() });
```

Then set `avatar_seed`.

- [ ] **Step 9: Run daemon tests**

Run:

```bash
cargo test -p slei-daemon --test agent_role_presets_api
cargo test -p slei-daemon --test agent_workspace
```

Expected: PASS. If `agent_workspace` has many create-agent struct literals, update all required `avatarSeed`/handle expectations.

- [ ] **Step 10: Commit**

```bash
git add crates/slei-daemon/src/api/agent_role_presets.rs crates/slei-daemon/src/api/mod.rs crates/slei-daemon/src/app.rs crates/slei-daemon/src/services/member_service.rs crates/slei-daemon/tests/agent_role_presets_api.rs crates/slei-daemon/tests/agent_workspace.rs
git commit -m "feat: expose agent role presets"
```

---

### Task 3: Wire Tauri Broker And Desktop Bridge

**Files:**
- Modify: `apps/desktop/src-tauri/src/daemon_broker.rs`
- Modify: `apps/desktop/src-tauri/src/commands.rs`
- Modify: `apps/desktop/src-tauri/src/lib.rs`
- Modify: `apps/desktop/src/lib/daemon-bridge.ts`
- Modify: `apps/desktop/src/lib/daemon-bridge.test.ts`
- Modify: `apps/desktop/src/test/daemon-bridge-mock.ts`

- [ ] **Step 1: Write failing bridge tests**

In `apps/desktop/src/lib/daemon-bridge.test.ts`, add:

```ts
it("returns empty role presets while offline", async () => {
  const bridge = createDaemonBridge();
  await expect(bridge.listAgentRolePresets()).resolves.toEqual({ presets: [] });
});

it("invokes list agent role presets command", async () => {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { __TAURI_INTERNALS__: {} },
  });
  invokeMock.mockResolvedValueOnce({ presets: [] });

  const bridge = createDaemonBridge();
  await expect(bridge.listAgentRolePresets()).resolves.toEqual({ presets: [] });

  expect(invokeMock).toHaveBeenCalledWith("list_agent_role_presets_command");
});

it("surfaces role preset command failures", async () => {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { __TAURI_INTERNALS__: {} },
  });
  invokeMock.mockRejectedValueOnce(new Error("daemon exploded"));

  const bridge = createDaemonBridge();
  await expect(bridge.listAgentRolePresets()).rejects.toThrow("daemon exploded");
});

it("passes avatarSeed through createAgent", async () => {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { __TAURI_INTERNALS__: {} },
  });
  invokeMock.mockResolvedValueOnce({ agent: testAgent("agent_1", "架构师", "@架构师") });

  const bridge = createDaemonBridge();
  await bridge.createAgent({
    name: "架构师",
    handle: "@架构师",
    runtimeKind: "ClaudeCode",
    model: "Sonnet",
    nodeId: "local-node",
    description: "系统架构师",
    avatarSeed: "avatar-refresh-1",
  });

  expect(invokeMock).toHaveBeenCalledWith("create_agent_command", {
    request: expect.objectContaining({ avatarSeed: "avatar-refresh-1" }),
  });
});
```

- [ ] **Step 2: Run bridge tests and verify failure**

Run:

```bash
pnpm --filter @slei/desktop test -- src/lib/daemon-bridge.test.ts
```

Expected: FAIL because methods/types do not exist.

- [ ] **Step 3: Add TypeScript DTOs and bridge method**

In `apps/desktop/src/lib/daemon-bridge.ts`:

```ts
export type AgentRolePresetView = {
  id: string;
  title: string;
  description: string;
  sortOrder: number;
};

export type AgentRolePresetReceipt = {
  presets: AgentRolePresetView[];
};

export type AgentCreateRequest = {
  // existing fields...
  avatarSeed?: string;
};
```

Add to `DaemonBridge`:

```ts
listAgentRolePresets(): Promise<AgentRolePresetReceipt>;
```

Tauri implementation:

```ts
listAgentRolePresets: () => invoke<AgentRolePresetReceipt>("list_agent_role_presets_command"),
```

Offline fallback:

```ts
listAgentRolePresets: async () => ({ presets: [] }),
```

- [ ] **Step 4: Add Tauri DTOs and command**

In `apps/desktop/src-tauri/src/daemon_broker.rs`:

```rust
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRolePresetView {
    pub id: String,
    pub title: String,
    pub description: String,
    pub sort_order: i64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRolePresetReceipt {
    pub presets: Vec<AgentRolePresetView>,
}
```

Add `avatar_seed: Option<String>` to `AgentCreateRequest`.

Add broker method:

```rust
pub fn list_agent_role_presets(&self) -> Result<AgentRolePresetReceipt, AgentError> {
    self.fetch_agent_role_presets_from_daemon()
}

fn fetch_agent_role_presets_from_daemon(&self) -> Result<AgentRolePresetReceipt, AgentError> {
    let response = self
        .send_daemon_request_checked("GET", "/v1/agent-role-presets", None, &[])
        .map_err(AgentError::DaemonRequest)?;
    serde_json::from_str::<AgentRolePresetReceipt>(&response)
        .map_err(|error| AgentError::DaemonResponse(error.to_string()))
}
```

This method must not collapse daemon request or parse failures into `{ presets: [] }`. Empty preset lists are valid only when the daemon successfully returns an empty list, or in the non-Tauri browser fallback in `daemon-bridge.ts`.

Update local fallback `create_agent`:

```rust
avatar_seed: request.avatar_seed
    .as_deref()
    .map(str::trim)
    .filter(|seed| !seed.is_empty())
    .map(str::to_string)
    .unwrap_or_else(|| id.clone()),
```

Update `normalize_handle` to match daemon: trim `@`, no whitespace, no `-`, char count <= 32, no lowercase transform.

In `apps/desktop/src-tauri/src/commands.rs`, import `AgentRolePresetReceipt`, add wrapper and command:

```rust
pub fn list_agent_role_presets(
    broker: &DaemonBroker,
) -> Result<AgentRolePresetReceipt, AgentError> {
    broker.list_agent_role_presets()
}

#[tauri::command]
pub fn list_agent_role_presets_command(
    state: tauri::State<'_, DaemonBroker>,
) -> Result<AgentRolePresetReceipt, String> {
    list_agent_role_presets(state.inner()).map_err(|error| error.to_string())
}
```

In `apps/desktop/src-tauri/src/lib.rs`, add `commands::list_agent_role_presets_command` to `generate_handler`.

- [ ] **Step 5: Update mock bridge**

In `apps/desktop/src/test/daemon-bridge-mock.ts`:

- Add optional `agentRolePresets` fixture input if the mock factory has a config type.
- Implement `listAgentRolePresets`.
- Preserve `request.avatarSeed` in created agents:

```ts
avatarSeed: request.avatarSeed ?? id,
```

- [ ] **Step 6: Run bridge and Tauri tests**

Run:

```bash
pnpm --filter @slei/desktop test -- src/lib/daemon-bridge.test.ts
cargo test -p slei --lib
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src-tauri/src/daemon_broker.rs apps/desktop/src-tauri/src/commands.rs apps/desktop/src-tauri/src/lib.rs apps/desktop/src/lib/daemon-bridge.ts apps/desktop/src/lib/daemon-bridge.test.ts apps/desktop/src/test/daemon-bridge-mock.ts
git commit -m "feat: bridge agent role presets"
```

---

### Task 4: Build Modal UI And View-Model Helpers

**Files:**
- Modify: `apps/desktop/src/app/model.ts`
- Modify: `apps/desktop/src/app/SleiAppFrame.tsx`
- Modify: `apps/desktop/src/i18n/types.ts`
- Modify: `apps/desktop/src/i18n/messages/zh-CN/agentCreate.ts`
- Modify: `apps/desktop/src/i18n/messages/en-US/agentCreate.ts`
- Test: `apps/desktop/src/app/SleiAppFrame.test.tsx`
- Test: `apps/desktop/src/app/model.test.ts`

- [ ] **Step 1: Write failing model helper tests**

In `apps/desktop/src/app/model.test.ts`, add:

```ts
import { agentHandleFromName, validateAgentDisplayName } from "./model";

it("generates handle directly from trimmed non-English names", () => {
  expect(agentHandleFromName(" 小红书调研员 ")).toBe("@小红书调研员");
  expect(agentHandleFromName("Architect")).toBe("@Architect");
});

it("validates agent display names without requiring pure English", () => {
  expect(validateAgentDisplayName("小红书调研员", [])).toBeNull();
  expect(validateAgentDisplayName("系统 架构师", [])).toBe("format");
  expect(validateAgentDisplayName("legal-researcher", [])).toBe("format");
  expect(validateAgentDisplayName("架构师", [{ id: "agent_1", name: "架构师" } as never])).toBe("duplicate");
});
```

- [ ] **Step 2: Write failing modal tests**

In `apps/desktop/src/app/SleiAppFrame.test.tsx`, add jsdom tests that mount `SleiAppFrame` with `initialAgentCreateModalOpen`, ready runtime nodes, and an `onAgentCreate` spy:

```tsx
it("renders the wider agent creation modal with avatar and no handle input", async () => {
  const container = await mount(
    <SleiAppFrame
      activeView="chat"
      data={createSleiFixtures()}
      initialAgentCreateModalOpen
      locale="zh-CN"
      runtimeSetup={{ loading: false, hasClaudeRuntimeReady: true, nodes: readyNodes }}
      onAgentRolePresets={async () => ({ presets: [] })} // adapt to actual prop name
    />,
  );

  expect(container.textContent).toContain("运行环境");
  expect(container.textContent).toContain("成员信息");
  expect(container.querySelector('[data-agent-create-avatar]')).not.toBeNull();
  expect(container.querySelector("#slei-agent-handle")).toBeNull();
});
```

Also add tests for:

- Default custom mode shows textarea.
- Switching to preset mode shows cards and hides textarea.
- Preset card container has a bounded max height and vertical overflow, for example by asserting a `data-agent-preset-list` node with classes containing `max-h-` and `overflow-y-auto`.
- Preset loading state is visible while the load promise is pending.
- Preset empty state is visible when daemon returns `{ presets: [] }`.
- Preset failed state is visible when loading rejects.
- Retry button calls the preset loader again after a failed load.
- Selecting a preset submits its description.
- Name containing whitespace or `-` disables create.
- Duplicate name disables create.
- Avatar refresh changes preview seed and submitted `avatarSeed`.

If the modal loads presets through bridge instead of a prop, pass a bridge mock through existing app wiring rather than inventing production data in the component.

- [ ] **Step 3: Run frontend tests and verify failure**

Run:

```bash
pnpm --filter @slei/desktop test -- src/app/model.test.ts src/app/SleiAppFrame.test.tsx
```

Expected: FAIL because helpers/UI do not exist.

- [ ] **Step 4: Add model helpers**

In `apps/desktop/src/app/model.ts`:

```ts
export type AgentDisplayNameValidation = "required" | "format" | "duplicate";

export function agentHandleFromName(name: string): string {
  return `@${name.trim()}`;
}

export function validateAgentDisplayName(
  name: string,
  members: Array<{ name: string }>,
): AgentDisplayNameValidation | null {
  const trimmed = name.trim();
  if (!trimmed) return "required";
  if (/\s/.test(trimmed) || trimmed.includes("-")) return "format";
  if (members.some((member) => member.name.trim() === trimmed)) return "duplicate";
  return null;
}

export function agentAvatarSeedFromName(name: string): string {
  const trimmed = name.trim();
  return trimmed ? `agent-avatar-${trimmed}` : "agent-avatar-new";
}

export function refreshedAgentAvatarSeed(name: string, refreshIndex: number): string {
  return `${agentAvatarSeedFromName(name)}-${refreshIndex}`;
}
```

Use deterministic refresh index in component state so tests can assert the seed without relying on `Date.now()`.

Add `avatarSeed?: string` to `AgentDraftInput`.

- [ ] **Step 5: Add i18n keys**

Add `agentCreate` keys:

```ts
runtimeSection: string;
memberSection: string;
descriptionMode: string;
customDescription: string;
presetDescription: string;
rolePresetsLoading: string;
rolePresetsEmpty: string;
rolePresetsFailed: string;
retryRolePresets: string;
refreshAvatar: string;
nameRequired: string;
nameInvalid: string;
nameDuplicate: string;
```

Chinese examples:

```ts
runtimeSection: "运行环境",
memberSection: "成员信息",
customDescription: "自定义",
presetDescription: "选择预设",
nameInvalid: "名称不能包含空格或 -",
nameDuplicate: "已有同名成员",
refreshAvatar: "重新生成头像",
```

- [ ] **Step 6: Pass preset data into `AgentCreateModal`**

Preferred wiring in `SleiAppFrame`:

- Add props:

```ts
agentRolePresets?: AgentRolePresetView[];
agentRolePresetsLoading?: boolean;
agentRolePresetsError?: string;
onAgentRolePresetsRetry?: () => Promise<void> | void;
```

- Load presets in `SleiApp.tsx` when modal opens if bridge ownership already lives there, or in `SleiAppFrame` via a passed `onAgentRolePresetsLoad` callback. Keep daemon/bridge as source of truth; do not add local static presets.

Given existing modal open state is inside `SleiAppFrame`, the least invasive implementation is:

```ts
// SleiAppFrame props
onAgentRolePresetsLoad?: () => Promise<AgentRolePresetReceipt>;

// useEffect when agentCreateOpen
// set loading/error/presets state
```

This keeps data source at bridge callback while avoiding lifting modal open state.

- [ ] **Step 7: Implement split layout and behavior**

In `AgentCreateModal`:

- Remove `handle` state and `#slei-agent-handle` input.
- Add state:

```ts
const [descriptionMode, setDescriptionMode] = useState<"custom" | "preset">("custom");
const [selectedPresetId, setSelectedPresetId] = useState<string | undefined>();
const [avatarRefreshIndex, setAvatarRefreshIndex] = useState(0);
const [avatarManuallyRefreshed, setAvatarManuallyRefreshed] = useState(false);
```

- Derive:

```ts
const nameError = validateAgentDisplayName(name, input.members);
const avatarSeed = avatarManuallyRefreshed
  ? refreshedAgentAvatarSeed(name, avatarRefreshIndex)
  : agentAvatarSeedFromName(name);
const selectedPreset = input.rolePresets.find((preset) => preset.id === selectedPresetId);
const createDisabled = Boolean(nameError) || (descriptionMode === "preset" && !selectedPreset);
```

- Submit:

```ts
input.onCreate?.({
  name: trimmedName,
  handle: agentHandleFromName(trimmedName),
  runtimeKind,
  model,
  nodeId,
  description: descriptionMode === "preset"
    ? selectedPreset!.description
    : description.trim() || input.messages.agentCreate.defaultDescription(trimmedName),
  avatarSeed,
});
```

- Use `RadioGroup` / `RadioGroupItem` from `@/components/ui/radio`.
- Use `MemberAvatar` for preview:

```tsx
<button
  aria-label={input.messages.agentCreate.refreshAvatar}
  className="group relative"
  data-agent-create-avatar
  onClick={() => {
    setAvatarRefreshIndex((current) => current + 1);
    setAvatarManuallyRefreshed(true);
  }}
  type="button"
>
  <MemberAvatar
    large
    identity={{
      id: "agent-create-preview",
      name: name.trim() || input.messages.agentCreate.fallbackAgent,
      handle: agentHandleFromName(name.trim() || "agent"),
      avatar: (name.trim() || "AG").slice(0, 2).toUpperCase(),
      avatarSeed,
    }}
  />
  <span className="absolute inset-0 hidden place-items-center rounded-full bg-background/70 group-hover:grid">
    <SleiIcon name="refreshCw" size={16} />
  </span>
</button>
```

Use whichever refresh icon exists in `SleiIcon`; if no refresh icon exists, add it through the existing icon map using lucide.

- [ ] **Step 8: Run frontend tests**

Run:

```bash
pnpm --filter @slei/desktop test -- src/app/model.test.ts src/app/SleiAppFrame.test.tsx
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/desktop/src/app/model.ts apps/desktop/src/app/SleiAppFrame.tsx apps/desktop/src/i18n/types.ts apps/desktop/src/i18n/messages/zh-CN/agentCreate.ts apps/desktop/src/i18n/messages/en-US/agentCreate.ts apps/desktop/src/app/model.test.ts apps/desktop/src/app/SleiAppFrame.test.tsx
git commit -m "feat: add role preset member modal"
```

---

### Task 5: Integrate App Loading And End-To-End Create Flow

**Files:**
- Modify: `apps/desktop/src/app/SleiApp.tsx`
- Modify: `apps/desktop/src/app/SleiAppFrame.tsx` if props were added in Task 4.
- Test: `apps/desktop/src/app/SleiApp.test.ts`
- Test: `apps/desktop/src-tauri/src/lib.rs` if command-level tests exist for create agent.

- [ ] **Step 1: Write failing integration tests**

In `apps/desktop/src/app/SleiApp.test.ts`, add or update tests to assert:

- `SleiApp` passes `bridge.listAgentRolePresets` into frame/modal loading path.
- `handleCreateAgent` forwards `avatarSeed` to `bridge.createAgent`.
- Existing source assertion still confirms member creation does not navigate away from chat.

Example source-level assertion if full mount is too heavy:

```ts
it("wires agent role presets through the desktop bridge", () => {
  const source = readFileSync(new URL("./SleiApp.tsx", import.meta.url), "utf8");
  expect(source).toContain("listAgentRolePresets");
});
```

Prefer behavioral tests with `createDaemonBridgeMock` if practical.

- [ ] **Step 2: Run integration tests and verify failure**

Run:

```bash
pnpm --filter @slei/desktop test -- src/app/SleiApp.test.ts
```

Expected: FAIL if wiring is incomplete.

- [ ] **Step 3: Wire bridge loading**

In `SleiApp.tsx`, pass a callback to `SleiAppFrame`:

```tsx
onAgentRolePresetsLoad={() => bridge.listAgentRolePresets()}
```

Keep errors in `SleiAppFrame` local modal state unless app-level toast is desired. Do not replace daemon errors with static data.

- [ ] **Step 4: Ensure create flow carries avatar seed**

`handleCreateAgent(request: AgentDraftInput)` can remain mostly unchanged if `AgentDraftInput` extends `AgentCreateRequest` with optional `avatarSeed`; verify no destructuring drops it:

```ts
const receipt = await bridge.createAgent(request);
```

Ensure `memberFromAgentView` continues using returned `agent.avatarSeed`.

- [ ] **Step 5: Run integration tests**

Run:

```bash
pnpm --filter @slei/desktop test -- src/app/SleiApp.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/app/SleiApp.tsx apps/desktop/src/app/SleiAppFrame.tsx apps/desktop/src/app/SleiApp.test.ts
git commit -m "feat: load role presets in app frame"
```

---

### Task 6: Full Verification

**Files:**
- No new source files unless verification reveals failures.

- [ ] **Step 1: Run targeted Rust checks**

Run:

```bash
cargo test -p slei-storage --test agent_role_presets
cargo test -p slei-daemon --test agent_role_presets_api
cargo test -p slei-daemon --test agent_workspace
cargo test -p slei --lib
```

Expected: PASS.

- [ ] **Step 2: Run targeted desktop tests**

Run:

```bash
pnpm --filter @slei/desktop test -- src/lib/daemon-bridge.test.ts src/app/model.test.ts src/app/SleiAppFrame.test.tsx src/app/SleiApp.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run required project checks**

Run:

```bash
pnpm --filter @slei/desktop typecheck
pnpm --filter @slei/desktop lint
cargo test -p slei-storage
cargo test -p slei-daemon
```

Expected: PASS. If time permits, run full repo verification:

```bash
pnpm test
cargo test
```

- [ ] **Step 4: Optional manual smoke test**

Start the desktop app:

```bash
pnpm --filter @slei/desktop desktop
```

Verify:

- Create Agent modal is wider.
- Runtime environment and member information are split.
- Avatar appears left of name.
- Hover avatar shows refresh icon; click changes avatar.
- `@handle` input is absent.
- Chinese name without spaces/hyphen can create a member.
- Name with space or `-` is rejected.
- Preset mode loads cards from daemon, scrolls after two and a half rows, and submits selected description.

- [ ] **Step 5: Final commit or amend**

If verification fixes changed files:

```bash
git add <changed-files>
git commit -m "test: verify agent role presets"
```

If no files changed, no commit is needed.

---

## Completion Notes

After implementation is complete and tests pass, follow Slei project instruction: ask whether to merge the finished branch into `master` or another branch.
