# Slei Channel Coordinator Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first end-to-end Slei channel Coordinator flow: create channels with selected Agents, sync Agent memory asynchronously, route channel messages through an invisible Coordinator, auto-create command tasks, and persist/debug internal routing state.

**Architecture:** Keep the daemon as the control-plane authority. Add focused services for Coordinator decisions, Agent inbox events, memory update events, and context packages, then wire them into channel creation and message sending. Desktop consumes typed bridge data and remains mostly state/rendering code; worker context assembly only receives scoped records and memory snippets that are safe to inject.

**Tech Stack:** Rust daemon with Tokio/Axum/sqlx/SQLite, TypeScript React desktop with Vite/Vitest SSR tests, Tauri command bridge, existing Claude worker context helpers.

---

## Scope Check

The design touches several layers, but they are not independent products. They form one vertical workflow:

1. Channel creation selects Agents.
2. Joining Agents get memory update events.
3. Ready Agents can receive Coordinator assignments.
4. Messages route through Coordinator decisions.
5. Command messages create tasks and inbox events.
6. Worker context uses scoped safe context and blocks deleted-memory snippets.

Do not try to build a general multi-agent scheduler or a full LLM Coordinator in this pass. The first implementation should use deterministic intent and assignment helpers with extension points for the future `channel-intent` Skill.

## Knowledge Notes

- Existing task-thread knowledge says to avoid `Date.now()` for task/reply identifiers. Use source ids, idempotency keys, UUIDs generated inside services, or injectable id generators for tests.
- Existing `MessageService` still routes no-mention messages to a primary Agent. This plan replaces that behavior with Coordinator decisions.
- Existing product Agents are `ProductAgentRecord` values managed by `MemberService`; use these for channel creation and memory paths. Do not build new behavior on the older `AgentRecord`/primary-agent test scaffolding.

## File Structure

### Daemon Services

- Modify `crates/slei-daemon/src/services/channel_service.rs`
  - Extend channel creation to accept selected Agent ids.
  - Store member readiness on `ChannelMemberRecord`.
  - Persist member readiness in `channels/members.json`.
- Create `crates/slei-daemon/src/services/coordinator_service.rs`
  - Own `CoordinatorDecision`, `CoordinatorAction`, deterministic intent classification, first assignment selection, and decision history.
- Create `crates/slei-daemon/src/services/agent_inbox_service.rs`
  - Own `AgentInboxEvent`, delivery state, explicit mention behavior, and task-scoped inbox creation.
- Create `crates/slei-daemon/src/services/memory_event_service.rs`
  - Own `memory_update_requested`, `memory_updated`, `memory_failed`, `memory_cleanup_requested`, and blocked document-section state.
- Create `crates/slei-daemon/src/services/memory_maintainer_service.rs`
  - Execute pending channel-join memory updates by invoking the Agent's memory-maintainer Skill boundary, updating `MEMORY.md`/`notes/*.md`, and completing readiness.
- Create `crates/slei-daemon/src/services/orchestration_store.rs`
  - Wrap `slei-storage` repository calls so Coordinator decisions, inbox events, memory events, and routing context packages are persisted in one place.
- Create `crates/slei-daemon/src/services/channel_orchestrator_service.rs`
  - Own the end-to-end message orchestration flow: persist message, run Coordinator, create tasks, create inbox events, write routing context packages, and emit visible task-card messages.
- Modify `crates/slei-daemon/src/services/message_service.rs`
  - Keep message persistence/tombstone behavior focused; move channel routing orchestration to `ChannelOrchestratorService`.
  - Preserve explicit mention behavior and readiness-aware delivery state.
- Modify `crates/slei-daemon/src/services/task_service.rs`
  - Add task creation from Coordinator decisions with source message id, initial assignee, assignment reason, and `needs_assignment`.
  - Add task-thread reply handling that detects visible `@agent` handoffs and creates task-scoped inbox events.
- Modify `crates/slei-daemon/src/services/run_orchestrator.rs`
  - Extend `ContextAssembler` to accept memory snippet records and exclude blocked/deleted snippets.
- Modify `crates/slei-daemon/src/services/mod.rs`
  - Export new services.
- Modify `crates/slei-daemon/src/state.rs`
  - Add new services and a storage-backed `OrchestrationStore` to `AppState`.

### Storage

- Modify `crates/slei-storage/src/migrations.rs`
  - Add tables for channel coordinators, coordinator decisions, agent inbox events, memory update events, routing context packages, memory document states, and channel members if persistence moves into SQLite in this slice.
- Modify `crates/slei-storage/migrations/0001_initial.sql`
  - Mirror migration text for review.
- Modify `crates/slei-storage/src/repositories/mod.rs`
  - Add repository methods for internal events and deletion cleanup.

### API And Tauri Bridge

- Modify `crates/slei-daemon/src/api/channels.rs`
  - Accept `agentIds` during channel creation.
  - Return members with readiness.
- Modify `crates/slei-daemon/src/api/tasks.rs`
  - Return assignment fields in task responses.
- Modify `crates/slei-daemon/src/api/messages.rs`
  - Wire channel message send endpoint if the route is enabled in this pass.
- Modify `crates/slei-daemon/src/app.rs`
  - Add routes for channel message send and diagnostics as needed.
- Modify `apps/desktop/src-tauri/src/daemon_broker.rs`
  - Add bridge structs for selected Agent ids, member readiness, Coordinator status, and task assignment.
- Modify `apps/desktop/src-tauri/src/commands.rs`
  - Thread new request/response types through Tauri commands.
- Modify `apps/desktop/src/lib/daemon-bridge.ts`
  - Add `agentIds?: string[]`, readiness types, and fake bridge behavior.

### Desktop

- Modify `apps/desktop/src/app/fixtures.ts`
  - Add member readiness and task assignment fields to fixture types.
- Modify `apps/desktop/src/app/model.ts`
  - Add channel create payload helpers and readiness labels.
- Modify `apps/desktop/src/app/SleiApp.tsx`
  - Send selected Agent ids to `bridge.createChannel`.
  - Refresh channel members/readiness after creation.
- Modify `apps/desktop/src/app/SleiAppFrame.tsx`
  - Add Agent multi-select to the create-channel modal.
- Modify `apps/desktop/src/features/chat/ChatPageView.tsx`
  - Render task cards and assignment reasons from the channel orchestrator/task response path.
- Modify `apps/desktop/src/app/app.css`
  - Add compact styles for Agent multi-select and readiness badges.
- Modify `apps/desktop/src/i18n/messages/zh-CN/chat.ts`
  - Add Chinese labels for selecting Agents and readiness states.
- Modify `apps/desktop/src/i18n/messages/en-US/chat.ts`
  - Add English labels for selecting Agents and readiness states.
- Modify `apps/desktop/src/i18n/types.ts`
  - Add new i18n keys.

### Tests

- Create `crates/slei-daemon/tests/channel_coordinator.rs`
  - Service-level tests for joining, readiness, Coordinator routing, auto task creation, and explicit mentions.
- Create `crates/slei-daemon/tests/memory_cleanup.rs`
  - Deletion cleanup tests for blocked memory snippets.
- Create `crates/slei-daemon/tests/channel_orchestration_flow.rs`
  - End-to-end daemon service test for channel creation, memory readiness, command routing, task creation, inbox event creation, decision persistence, and routing context package persistence.
- Modify `crates/slei-daemon/tests/channel_chat.rs`
  - Replace primary-agent no-mention expectations with Coordinator expectations.
- Modify `crates/slei-daemon/tests/agent_workspace.rs`
  - Cover create-channel selected Agents and memory update events.
- Modify `apps/desktop/e2e/chat-channel-mentions.spec.tsx`
  - Cover Agent multi-select and readiness display in the modal/sidebar.
- Add or modify `workers/claude-agent/src/context.test.ts`
  - Cover blocked memory snippets if context filtering also lives in worker helpers.

## Task 1: Internal Orchestration Persistence

**Files:**
- Modify: `crates/slei-storage/src/migrations.rs`
- Modify: `crates/slei-storage/migrations/0001_initial.sql`
- Modify: `crates/slei-storage/src/repositories/mod.rs`
- Create: `crates/slei-daemon/src/services/orchestration_store.rs`
- Modify: `crates/slei-daemon/src/services/mod.rs`
- Modify: `crates/slei-daemon/src/state.rs`
- Create: `crates/slei-daemon/tests/coordinator_persistence.rs`

- [ ] **Step 1: Write the failing persistence test**

Create `crates/slei-daemon/tests/coordinator_persistence.rs`:

```rust
use slei_storage::db::SleiDb;
use slei_storage::repositories::Repositories;
use uuid::Uuid;

#[tokio::test]
async fn coordinator_internal_events_survive_restart() {
    let db_path = std::env::temp_dir().join(format!("slei-coordinator-{}.sqlite", Uuid::new_v4()));
    let database_url = format!("sqlite://{}", db_path.display());
    let channel_id = Uuid::new_v4();
    let message_id = Uuid::new_v4();
    let decision_id = Uuid::new_v4();

    {
        let db = SleiDb::connect(&database_url).await.unwrap();
        db.migrate().await.unwrap();
        let repos = Repositories::new(db.pool().clone());
        repos
            .insert_channel_coordinator(channel_id, "deterministic_v1", true)
            .await
            .unwrap();
        repos
            .insert_coordinator_decision(
                decision_id,
                channel_id,
                message_id,
                "task_command",
                "create_task_and_assign",
                Some("agent_alice"),
                "needs architecture",
            )
            .await
            .unwrap();
        repos
            .insert_agent_inbox_event(
                Uuid::new_v4(),
                "agent_alice",
                "task_assigned",
                "pending",
                r#"{"taskId":"task_1"}"#,
            )
            .await
            .unwrap();
        repos
            .insert_routing_context_package(
                Uuid::new_v4(),
                decision_id,
                message_id,
                r#"{"currentMessageId":"msg_1"}"#,
                false,
            )
            .await
            .unwrap();
    }

    let restarted = SleiDb::connect(&database_url).await.unwrap();
    let repos = Repositories::new(restarted.pool().clone());
    let coordinator = repos.channel_coordinator(channel_id).await.unwrap().unwrap();
    let decisions = repos.coordinator_decisions_for_message(message_id).await.unwrap();
    let inbox = repos.agent_inbox_events("agent_alice").await.unwrap();
    let packages = repos.routing_context_packages_for_decision(decision_id).await.unwrap();

    assert_eq!(coordinator.strategy, "deterministic_v1");
    assert_eq!(decisions.len(), 1);
    assert_eq!(decisions[0].action, "create_task_and_assign");
    assert_eq!(inbox.len(), 1);
    assert_eq!(inbox[0].event_type, "task_assigned");
    assert_eq!(packages.len(), 1);
    assert_eq!(packages[0].contains_deleted_body, false);
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cargo test -p slei-daemon --test coordinator_persistence coordinator_internal_events_survive_restart`

Expected: FAIL with missing repository methods.

- [ ] **Step 3: Add migration tables**

In `crates/slei-storage/src/migrations.rs`, append tables inside `MIGRATION_0001`:

```sql
CREATE TABLE IF NOT EXISTS channel_coordinators (
    channel_id TEXT PRIMARY KEY,
    strategy TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS coordinator_decisions (
    id TEXT PRIMARY KEY,
    channel_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    intent TEXT NOT NULL,
    action TEXT NOT NULL,
    assignee_agent_id TEXT,
    reason TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_coordinator_decisions_message_id
    ON coordinator_decisions(message_id);

CREATE TABLE IF NOT EXISTS agent_inbox_events (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    delivery_state TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_agent_inbox_events_agent_id
    ON agent_inbox_events(agent_id);

CREATE TABLE IF NOT EXISTS memory_update_events (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    source_message_id TEXT,
    document_path TEXT,
    document_section TEXT,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_memory_update_events_source_message_id
    ON memory_update_events(source_message_id);

CREATE TABLE IF NOT EXISTS memory_document_states (
    agent_id TEXT NOT NULL,
    document_path TEXT NOT NULL,
    document_section TEXT NOT NULL DEFAULT '',
    version_hash TEXT,
    blocked INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(agent_id, document_path, document_section)
);

CREATE TABLE IF NOT EXISTS routing_context_packages (
    id TEXT PRIMARY KEY,
    decision_id TEXT NOT NULL REFERENCES coordinator_decisions(id),
    source_message_id TEXT NOT NULL,
    payload TEXT NOT NULL,
    contains_deleted_body INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_routing_context_packages_decision_id
    ON routing_context_packages(decision_id);

CREATE INDEX IF NOT EXISTS idx_routing_context_packages_source_message_id
    ON routing_context_packages(source_message_id);
```

Mirror the same SQL in `crates/slei-storage/migrations/0001_initial.sql`.

- [ ] **Step 4: Add repository structs and methods**

In `crates/slei-storage/src/repositories/mod.rs`, add records:

```rust
#[derive(Debug, PartialEq, Eq)]
pub struct CoordinatorDecisionRecord {
    pub id: Uuid,
    pub channel_id: Uuid,
    pub message_id: Uuid,
    pub intent: String,
    pub action: String,
    pub assignee_agent_id: Option<String>,
    pub reason: String,
}

#[derive(Debug, PartialEq, Eq)]
pub struct AgentInboxEventRecord {
    pub id: Uuid,
    pub agent_id: String,
    pub event_type: String,
    pub delivery_state: String,
    pub payload: String,
}

#[derive(Debug, PartialEq, Eq)]
pub struct ChannelCoordinatorRecord {
    pub channel_id: Uuid,
    pub strategy: String,
    pub enabled: bool,
}

#[derive(Debug, PartialEq, Eq)]
pub struct RoutingContextPackageRecord {
    pub id: Uuid,
    pub decision_id: Uuid,
    pub source_message_id: Uuid,
    pub payload: String,
    pub contains_deleted_body: bool,
}
```

Add methods named exactly as used by the test: `insert_channel_coordinator`, `channel_coordinator`, `insert_coordinator_decision`, `coordinator_decisions_for_message`, `insert_agent_inbox_event`, `agent_inbox_events`, `insert_routing_context_package`, and `routing_context_packages_for_decision`.

- [ ] **Step 5: Run the persistence test**

Run: `cargo test -p slei-daemon --test coordinator_persistence coordinator_internal_events_survive_restart`

Expected: PASS.

- [ ] **Step 6: Add storage-backed OrchestrationStore**

Create `crates/slei-daemon/src/services/orchestration_store.rs`. It should wrap `Repositories` and expose typed methods used by later services:

```rust
use slei_storage::repositories::Repositories;
use uuid::Uuid;

#[derive(Clone)]
pub struct OrchestrationStore {
    repos: Repositories,
}

impl OrchestrationStore {
    pub fn new(repos: Repositories) -> Self {
        Self { repos }
    }

    pub async fn record_channel_coordinator(&self, channel_id: Uuid, strategy: &str) -> Result<(), sqlx::Error> {
        self.repos.insert_channel_coordinator(channel_id, strategy, true).await
    }

    pub async fn record_decision(
        &self,
        id: Uuid,
        channel_id: Uuid,
        message_id: Uuid,
        intent: &str,
        action: &str,
        assignee_agent_id: Option<&str>,
        reason: &str,
    ) -> Result<(), sqlx::Error> {
        self.repos.insert_coordinator_decision(id, channel_id, message_id, intent, action, assignee_agent_id, reason).await
    }

    pub async fn for_data_root(root: std::path::PathBuf) -> Self {
        std::fs::create_dir_all(&root).expect("create orchestration data root");
        let db_path = root.join("slei.sqlite");
        let database_url = format!("sqlite://{}", db_path.display());
        let db = slei_storage::db::SleiDb::connect(&database_url).await.expect("connect orchestration db");
        db.migrate().await.expect("migrate orchestration db");
        Self::new(Repositories::new(db.pool().clone()))
    }

    pub async fn for_tests() -> Self {
        Self::for_data_root(std::env::temp_dir().join(format!("slei-orchestration-{}", Uuid::new_v4()))).await
    }
}
```

Add the rest of the methods as later tasks need them: `record_inbox_event`, `record_memory_event`, `record_routing_context_package`, `mark_context_packages_deleted`, `blocked_memory_sections`.

In `crates/slei-daemon/src/state.rs`, create a test SQLite database under the test data root:

```rust
let db_path = data_root.join("slei.sqlite");
let database_url = format!("sqlite://{}", db_path.display());
```

Initialize `SleiDb`, run migrations, construct `Repositories`, then construct `OrchestrationStore`. Add `AppState::for_tests_with_agent_root_async` and use it in new integration tests. Keep the existing sync constructor for old tests by creating an isolated store with a small internal Tokio runtime, but prefer the async constructor for every new Coordinator test.

- [ ] **Step 7: Run related storage/deletion tests**

Run: `cargo test -p slei-daemon --test deletion_context --test message_deletion`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add crates/slei-storage/src/migrations.rs crates/slei-storage/migrations/0001_initial.sql crates/slei-storage/src/repositories/mod.rs crates/slei-daemon/src/services/orchestration_store.rs crates/slei-daemon/src/services/mod.rs crates/slei-daemon/src/state.rs crates/slei-daemon/tests/coordinator_persistence.rs
git commit -m "feat: persist coordinator orchestration events"
```

## Task 2: Channel Member Readiness And Memory Events

**Files:**
- Modify: `crates/slei-daemon/src/services/channel_service.rs`
- Modify: `crates/slei-daemon/src/services/message_service.rs`
- Create: `crates/slei-daemon/src/services/memory_event_service.rs`
- Create: `crates/slei-daemon/src/services/memory_maintainer_service.rs`
- Modify: `crates/slei-daemon/src/services/mod.rs`
- Modify: `crates/slei-daemon/src/state.rs`
- Modify: `crates/slei-daemon/src/api/channels.rs`
- Modify: `crates/slei-daemon/tests/agent_workspace.rs`

- [ ] **Step 1: Write the failing API test**

Append to `crates/slei-daemon/tests/agent_workspace.rs`:

```rust
#[tokio::test]
async fn create_channel_with_agents_is_immediately_usable_and_requests_memory_updates() {
    let token = AuthToken::from_static("test-token");
    let root = make_temp_dir("channel-agent-selection");
    let state = AppState::for_tests_with_agent_root_async(token.clone(), root).await;
    let app = build_router(state.clone());

    let alice = post_json(&app, &token, "/v1/agents", Some("create-alice"), json!({
        "name": "Alice",
        "handle": "@alice-win",
        "runtimeKind": "ClaudeCode",
        "model": "Sonnet",
        "nodeId": "local-node",
        "description": "研发团队架构师。"
    })).await;
    let alice_id = response_json(alice).await["agent"]["id"].as_str().unwrap().to_string();

    let created = post_json(&app, &token, "/v1/channels", Some("create-win-dev"), json!({
        "name": "#win-dev",
        "description": "Windows development",
        "agentIds": [alice_id]
    })).await;

    assert_eq!(created.status(), StatusCode::CREATED);
    let body = response_json(created).await;
    assert_eq!(body["channel"]["id"], "win-dev");

    let members = response_json(get_json(&app, &token, "/v1/channels/win-dev/members").await).await;
    assert_eq!(members["members"][0]["readiness"], "joining");

    let memory_events = state.memory_events().events_for_agent(&alice_id).await;
    assert_eq!(memory_events[0].eventType, "memory_update_requested");
}
```

If Rust field access cannot use camelCase in the last assertion, assert on the Rust record field name defined in Step 3.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cargo test -p slei-daemon --test agent_workspace create_channel_with_agents_is_immediately_usable_and_requests_memory_updates`

Expected: FAIL because `agentIds`, member `readiness`, and `memory_events()` are missing.

- [ ] **Step 3: Add member readiness**

In `crates/slei-daemon/src/services/channel_service.rs`, add:

```rust
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ChannelMemberReadiness {
    Joining,
    MemorySyncing,
    Ready,
    MemoryFailed,
    Unavailable,
}
```

Extend `ChannelMemberRecord`:

```rust
pub readiness: ChannelMemberReadiness,
```

Set new members to `ChannelMemberReadiness::Joining`. Add `set_member_readiness(&self, channel_id: &str, agent_id: &str, readiness: ChannelMemberReadiness)` and persist members after changes.

- [ ] **Step 4: Add memory event service**

Create `crates/slei-daemon/src/services/memory_event_service.rs`. This service must persist every event through `OrchestrationStore`; an in-memory vector is allowed only as a read-through cache for tests.

```rust
use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;
use uuid::Uuid;
use std::sync::Arc;
use crate::services::orchestration_store::OrchestrationStore;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MemoryUpdateEvent {
    pub id: String,
    pub agent_id: String,
    pub event_type: String,
    pub channel_id: Option<String>,
    pub status: String,
}

pub struct MemoryEventService {
    store: OrchestrationStore,
    events: Arc<Mutex<Vec<MemoryUpdateEvent>>>,
}

impl MemoryEventService {
    pub fn new(store: OrchestrationStore) -> Self {
        Self { store, events: Arc::new(Mutex::new(Vec::new())) }
    }

    pub async fn request_channel_join_update(&self, agent_id: &str, channel_id: &str) -> MemoryUpdateEvent {
        let event = MemoryUpdateEvent {
            id: format!("memory_event_{}", Uuid::new_v4().simple()),
            agent_id: agent_id.to_string(),
            event_type: "memory_update_requested".to_string(),
            channel_id: Some(channel_id.to_string()),
            status: "pending".to_string(),
        };
        self.store.record_memory_event(&event).await.expect("memory event persists");
        self.events.lock().await.push(event.clone());
        event
    }

    pub async fn start_update(&self, agent_id: &str, channel_id: &str) -> MemoryUpdateEvent {
        self.transition(agent_id, channel_id, "memory_update_started", "syncing").await
    }

    pub async fn complete_update(&self, agent_id: &str, channel_id: &str) -> MemoryUpdateEvent {
        self.transition(agent_id, channel_id, "memory_updated", "ready").await
    }

    pub async fn fail_update(&self, agent_id: &str, channel_id: &str) -> MemoryUpdateEvent {
        self.transition(agent_id, channel_id, "memory_failed", "failed").await
    }

    pub async fn events_for_agent(&self, agent_id: &str) -> Vec<MemoryUpdateEvent> {
        self.events
            .lock()
            .await
            .iter()
            .filter(|event| event.agent_id == agent_id)
            .cloned()
            .collect()
    }

    async fn transition(&self, agent_id: &str, channel_id: &str, event_type: &str, status: &str) -> MemoryUpdateEvent {
        let event = MemoryUpdateEvent {
            id: format!("memory_event_{}", Uuid::new_v4().simple()),
            agent_id: agent_id.to_string(),
            event_type: event_type.to_string(),
            channel_id: Some(channel_id.to_string()),
            status: status.to_string(),
        };
        self.store.record_memory_event(&event).await.expect("memory event persists");
        self.events.lock().await.push(event.clone());
        event
    }
}
```

- [ ] **Step 5: Add lifecycle test for memory readiness and ready messages**

Append to `crates/slei-daemon/tests/agent_workspace.rs`:

```rust
#[tokio::test]
async fn memory_update_completion_marks_member_ready_and_posts_ready_message() {
    let token = AuthToken::from_static("test-token");
    let root = make_temp_dir("channel-memory-ready");
    let state = AppState::for_tests_with_agent_root_async(token.clone(), root).await;
    let app = build_router(state.clone());

    let agent = post_json(&app, &token, "/v1/agents", Some("create-ready-agent"), json!({
        "name": "Alice",
        "handle": "@alice-win",
        "runtimeKind": "ClaudeCode",
        "model": "Sonnet",
        "nodeId": "local-node",
        "description": "研发团队架构师。"
    })).await;
    let agent_id = response_json(agent).await["agent"]["id"].as_str().unwrap().to_string();

    post_json(&app, &token, "/v1/channels", Some("create-ready-channel"), json!({
        "name": "ready-channel",
        "agentIds": [agent_id]
    })).await;

    state.run_channel_join_memory_updates("ready-channel").await.unwrap();

    let members = response_json(get_json(&app, &token, "/v1/channels/ready-channel/members").await).await;
    assert_eq!(members["members"][0]["readiness"], "ready");
    assert!(state
        .channel_messages_for_tests("ready-channel")
        .await
        .iter()
        .any(|message| message.body.as_deref().unwrap_or("").contains("就位")));
    let agent = state.members().get_product_agent(&agent_id).await.unwrap();
    let channels_note = std::fs::read_to_string(std::path::Path::new(&agent.workspace_path).join("notes/channels.md")).unwrap();
    assert!(channels_note.contains("ready-channel"));
}
```

If `channel_messages_for_tests` does not exist yet, implement it on the service that owns visible channel messages in this task. The ready message must be a visible Agent message, not a Coordinator message.

- [ ] **Step 6: Wire service into state**

Export from `crates/slei-daemon/src/services/mod.rs`. Add `memory_event_service: MemoryEventService` and `message_service: MessageService` to `AppState`, initialize them in `for_tests_with_agent_root_async`, and expose:

```rust
pub fn memory_events(&self) -> &MemoryEventService {
    &self.memory_event_service
}

pub fn messages(&self) -> &MessageService {
    &self.message_service
}
```

- [ ] **Step 7: Implement memory-maintainer execution service**

Create `crates/slei-daemon/src/services/memory_maintainer_service.rs`. This is the first concrete implementation of the memory-maintainer Skill boundary. It may use deterministic markdown updates for now, but it must execute automatically from pending memory events and update real Agent document files.

```rust
#[derive(Clone)]
pub struct MemoryMaintainerService {
    members: MemberService,
    channels: ChannelService,
    memory_events: MemoryEventService,
}

impl MemoryMaintainerService {
    pub async fn run_pending_channel_join_updates(&self, channel_id: &str) -> Result<Vec<String>, MemoryMaintainerError> {
        let members = self.channels.channel_members(channel_id).await?;
        let mut completed = Vec::new();
        for member in members.iter().filter(|member| member.readiness == ChannelMemberReadiness::Joining) {
            self.memory_events.start_update(&member.agent_id, channel_id).await;
            self.channels.set_member_readiness(channel_id, &member.agent_id, ChannelMemberReadiness::MemorySyncing).await?;
            self.update_agent_channel_notes(&member.agent_id, channel_id).await?;
            self.memory_events.complete_update(&member.agent_id, channel_id).await;
            self.channels.set_member_readiness(channel_id, &member.agent_id, ChannelMemberReadiness::Ready).await?;
            completed.push(member.agent_id.clone());
        }
        Ok(completed)
    }
}
```

`update_agent_channel_notes` must:

- read the Agent's `ProductAgentRecord`
- ensure `MEMORY.md` links to `notes/channels.md` and `notes/relationships.md`
- write or update `notes/channels.md` with channel roster and roles
- write or update `notes/relationships.md` with relationship hints
- record touched document paths/sections through `MemoryEventService`

Do not call a general-purpose shell script to rewrite memory. This service represents the Skill invocation boundary; later runtime work can replace the deterministic markdown updater with an Agent-run Skill.

- [ ] **Step 8: Implement memory lifecycle state transitions and ready messages**

Add an `AppState` method:

```rust
pub async fn run_channel_join_memory_updates(&self, channel_id: &str) -> Result<(), MemoryMaintainerError> {
    let ready_agent_ids = self.memory_maintainer().run_pending_channel_join_updates(channel_id).await?;
    for agent_id in ready_agent_ids {
        self.messages().create_agent_channel_message(channel_id, &agent_id, "已就位").await?;
    }
    Ok(())
}
```

Also add `fail_agent_channel_memory_update` for failed runs. Tests must prove that `ready` and visible ready messages happen only after the memory-maintainer service updates docs and emits `memory_updated`.

- [ ] **Step 9: Extend channel create request**

In `crates/slei-daemon/src/api/channels.rs`, add:

```rust
agent_ids: Option<Vec<String>>,
```

After creating the channel, iterate selected ids:

```rust
for agent_id in payload.agent_ids.unwrap_or_default() {
    state.channels().add_agent_to_channel(&channel.id, &agent_id).await?;
    state.memory_events().request_channel_join_update(&agent_id, &channel.id).await;
}
```

Map `ChannelError` with existing `channel_error_response`.

- [ ] **Step 10: Run the channel creation and memory lifecycle tests**

Run: `cargo test -p slei-daemon --test agent_workspace create_channel_with_agents_is_immediately_usable_and_requests_memory_updates memory_update_completion_marks_member_ready_and_posts_ready_message`

Expected: PASS.

- [ ] **Step 11: Run member/channel regression tests**

Run: `cargo test -p slei-daemon --test agent_workspace --test member_policy`

Expected: PASS.

- [ ] **Step 12: Commit**

```bash
git add crates/slei-daemon/src/services/channel_service.rs crates/slei-daemon/src/services/message_service.rs crates/slei-daemon/src/services/memory_event_service.rs crates/slei-daemon/src/services/memory_maintainer_service.rs crates/slei-daemon/src/services/mod.rs crates/slei-daemon/src/state.rs crates/slei-daemon/src/api/channels.rs crates/slei-daemon/tests/agent_workspace.rs
git commit -m "feat: request agent memory updates on channel join"
```

## Task 3: Agent Inbox And Mention Delivery States

**Files:**
- Create: `crates/slei-daemon/src/services/agent_inbox_service.rs`
- Modify: `crates/slei-daemon/src/services/mod.rs`
- Modify: `crates/slei-daemon/src/state.rs`
- Create: `crates/slei-daemon/tests/channel_coordinator.rs`

- [ ] **Step 1: Write the failing inbox test**

Create `crates/slei-daemon/tests/channel_coordinator.rs`:

```rust
use slei_daemon::services::agent_inbox_service::{AgentInboxService, DeliveryState};
use slei_daemon::services::channel_service::ChannelMemberReadiness;
use slei_daemon::services::orchestration_store::OrchestrationStore;

#[tokio::test]
async fn human_mentions_preserve_target_and_reflect_readiness() {
    let inbox = AgentInboxService::new(OrchestrationStore::for_tests().await);

    let pending = inbox
        .create_human_mention(
            "agent_alice",
            "channel_dev",
            "msg_1",
            ChannelMemberReadiness::MemorySyncing,
        )
        .await;
    let blocked = inbox
        .create_human_mention(
            "agent_coda",
            "channel_dev",
            "msg_2",
            ChannelMemberReadiness::Unavailable,
        )
        .await;

    assert_eq!(pending.delivery_state, DeliveryState::PendingMemoryReady);
    assert_eq!(blocked.delivery_state, DeliveryState::BlockedRuntimeUnavailable);
    assert_eq!(inbox.events_for_agent("agent_alice").await.len(), 1);
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cargo test -p slei-daemon --test channel_coordinator human_mentions_preserve_target_and_reflect_readiness`

Expected: FAIL because `AgentInboxService` does not exist.

- [ ] **Step 3: Implement inbox service**

Create `crates/slei-daemon/src/services/agent_inbox_service.rs`:

```rust
use std::sync::Arc;
use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;
use uuid::Uuid;
use crate::services::channel_service::ChannelMemberReadiness;
use crate::services::orchestration_store::OrchestrationStore;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DeliveryState {
    Pending,
    PendingMemoryReady,
    BlockedMemoryFailed,
    BlockedRuntimeUnavailable,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentInboxEvent {
    pub id: String,
    pub agent_id: String,
    pub channel_id: String,
    pub task_id: Option<String>,
    pub message_id: String,
    pub event_type: String,
    pub delivery_state: DeliveryState,
}

pub struct AgentInboxService {
    store: OrchestrationStore,
    events: Arc<Mutex<Vec<AgentInboxEvent>>>,
}

impl AgentInboxService {
    pub fn new(store: OrchestrationStore) -> Self {
        Self { store, events: Arc::new(Mutex::new(Vec::new())) }
    }

    pub async fn create_human_mention(
        &self,
        agent_id: &str,
        channel_id: &str,
        message_id: &str,
        readiness: ChannelMemberReadiness,
    ) -> AgentInboxEvent {
        self.push(agent_id, channel_id, None, message_id, "human_mention", delivery_state_for_readiness(readiness)).await
    }

    pub async fn create_task_assignment(
        &self,
        agent_id: &str,
        channel_id: &str,
        task_id: &str,
        message_id: &str,
    ) -> AgentInboxEvent {
        self.push(agent_id, channel_id, Some(task_id.to_string()), message_id, "task_assigned", DeliveryState::Pending).await
    }

    pub async fn events_for_agent(&self, agent_id: &str) -> Vec<AgentInboxEvent> {
        self.events.lock().await.iter().filter(|event| event.agent_id == agent_id).cloned().collect()
    }

    async fn push(
        &self,
        agent_id: &str,
        channel_id: &str,
        task_id: Option<String>,
        message_id: &str,
        event_type: &str,
        delivery_state: DeliveryState,
    ) -> AgentInboxEvent {
        let event = AgentInboxEvent {
            id: format!("inbox_{}", Uuid::new_v4().simple()),
            agent_id: agent_id.to_string(),
            channel_id: channel_id.to_string(),
            task_id,
            message_id: message_id.to_string(),
            event_type: event_type.to_string(),
            delivery_state,
        };
        self.store.record_inbox_event(&event).await.expect("inbox event persists");
        self.events.lock().await.push(event.clone());
        event
    }
}

fn delivery_state_for_readiness(readiness: ChannelMemberReadiness) -> DeliveryState {
    match readiness {
        ChannelMemberReadiness::Joining | ChannelMemberReadiness::MemorySyncing => DeliveryState::PendingMemoryReady,
        ChannelMemberReadiness::Ready => DeliveryState::Pending,
        ChannelMemberReadiness::MemoryFailed => DeliveryState::BlockedMemoryFailed,
        ChannelMemberReadiness::Unavailable => DeliveryState::BlockedRuntimeUnavailable,
    }
}
```

- [ ] **Step 4: Wire service into state**

Export from `services/mod.rs`. Add `agent_inbox_service: AgentInboxService` to `AppState` and expose:

```rust
pub fn agent_inbox(&self) -> &AgentInboxService {
    &self.agent_inbox_service
}
```

Initialize `AgentInboxService::new(orchestration_store.clone())`. Do not use a service-level in-memory store for production state; the in-memory list is only a cache for easy test reads.

- [ ] **Step 5: Run the inbox test**

Run: `cargo test -p slei-daemon --test channel_coordinator human_mentions_preserve_target_and_reflect_readiness`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add crates/slei-daemon/src/services/agent_inbox_service.rs crates/slei-daemon/src/services/mod.rs crates/slei-daemon/src/state.rs crates/slei-daemon/tests/channel_coordinator.rs
git commit -m "feat: add agent inbox delivery states"
```

## Task 4: Coordinator Intent And Initial Assignment

**Files:**
- Create: `crates/slei-daemon/src/services/coordinator_service.rs`
- Modify: `crates/slei-daemon/src/services/mod.rs`
- Modify: `crates/slei-daemon/src/state.rs`
- Modify: `crates/slei-daemon/tests/channel_coordinator.rs`

- [ ] **Step 1: Write failing Coordinator tests**

Append to `crates/slei-daemon/tests/channel_coordinator.rs`:

```rust
use slei_daemon::services::coordinator_service::{CoordinatorAction, CoordinatorInput, CoordinatorService, IntentKind};
use slei_daemon::services::orchestration_store::OrchestrationStore;

#[tokio::test]
async fn coordinator_classifies_consultation_without_task_creation() {
    let coordinator = CoordinatorService::new(OrchestrationStore::for_tests().await);
    let decision = coordinator
        .decide(CoordinatorInput {
            channel_id: "channel_dev".to_string(),
            message_id: "msg_consult".to_string(),
            body: "这个架构方案你怎么看？".to_string(),
            explicit_agent_ids: vec![],
            ready_agent_ids: vec!["agent_alice".to_string()],
        })
        .await;

    assert_eq!(decision.intent, IntentKind::Consultation);
    assert_eq!(decision.action, CoordinatorAction::RequestAgentReply);
    assert_eq!(decision.assignee_agent_id.as_deref(), Some("agent_alice"));
}

#[tokio::test]
async fn coordinator_creates_task_for_command_intent_and_needs_assignment_without_ready_agents() {
    let coordinator = CoordinatorService::new(OrchestrationStore::for_tests().await);
    let task = coordinator
        .decide(CoordinatorInput {
            channel_id: "channel_dev".to_string(),
            message_id: "msg_task".to_string(),
            body: "实现频道创建时选择 Agent 的功能".to_string(),
            explicit_agent_ids: vec![],
            ready_agent_ids: vec!["agent_alice".to_string()],
        })
        .await;
    let unassigned = coordinator
        .decide(CoordinatorInput {
            channel_id: "channel_dev".to_string(),
            message_id: "msg_no_ready".to_string(),
            body: "实现一个导出功能".to_string(),
            explicit_agent_ids: vec![],
            ready_agent_ids: vec![],
        })
        .await;

    assert_eq!(task.intent, IntentKind::TaskCommand);
    assert_eq!(task.action, CoordinatorAction::CreateTaskAndAssign);
    assert_eq!(task.assignee_agent_id.as_deref(), Some("agent_alice"));
    assert_eq!(unassigned.action, CoordinatorAction::NeedsManualAssignment);
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test -p slei-daemon --test channel_coordinator coordinator_`

Expected: FAIL because `CoordinatorService` does not exist.

- [ ] **Step 3: Implement deterministic Coordinator service**

Create `crates/slei-daemon/src/services/coordinator_service.rs`:

```rust
use std::sync::Arc;
use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;
use uuid::Uuid;
use crate::services::orchestration_store::OrchestrationStore;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum IntentKind {
    Consultation,
    TaskCommand,
    StatusUpdate,
    Noise,
    Ambiguous,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CoordinatorAction {
    ArchiveOnly,
    RequestAgentReply,
    CreateTaskAndAssign,
    NeedsManualAssignment,
}

#[derive(Clone, Debug)]
pub struct CoordinatorInput {
    pub channel_id: String,
    pub message_id: String,
    pub body: String,
    pub explicit_agent_ids: Vec<String>,
    pub ready_agent_ids: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CoordinatorDecision {
    pub id: String,
    pub channel_id: String,
    pub message_id: String,
    pub intent: IntentKind,
    pub action: CoordinatorAction,
    pub assignee_agent_id: Option<String>,
    pub reason: String,
}

pub struct CoordinatorService {
    store: OrchestrationStore,
    decisions: Arc<Mutex<Vec<CoordinatorDecision>>>,
}

impl CoordinatorService {
    pub fn new(store: OrchestrationStore) -> Self {
        Self { store, decisions: Arc::new(Mutex::new(Vec::new())) }
    }

    pub async fn decide(&self, input: CoordinatorInput) -> CoordinatorDecision {
        let intent = classify_intent(&input.body);
        let assignee = input.ready_agent_ids.first().cloned();
        let action = if !input.explicit_agent_ids.is_empty() {
            CoordinatorAction::RequestAgentReply
        } else {
            match (&intent, assignee.as_ref()) {
                (IntentKind::TaskCommand, Some(_)) => CoordinatorAction::CreateTaskAndAssign,
                (IntentKind::TaskCommand, None) => CoordinatorAction::NeedsManualAssignment,
                (IntentKind::Consultation, Some(_)) => CoordinatorAction::RequestAgentReply,
                _ => CoordinatorAction::ArchiveOnly,
            }
        };
        let decision = CoordinatorDecision {
            id: format!("decision_{}", Uuid::new_v4().simple()),
            channel_id: input.channel_id,
            message_id: input.message_id,
            intent,
            action,
            assignee_agent_id: assignee,
            reason: "deterministic channel-intent rule".to_string(),
        };
        self.store.record_decision_from_record(&decision).await.expect("coordinator decision persists");
        self.decisions.lock().await.push(decision.clone());
        decision
    }
}

fn classify_intent(body: &str) -> IntentKind {
    let text = body.trim();
    let task_markers = ["实现", "修复", "检查", "整理", "创建", "改一下", "写一个", "生成", "调查", "验证"];
    if task_markers.iter().any(|marker| text.contains(marker)) {
        return IntentKind::TaskCommand;
    }
    if text.ends_with('？') || text.ends_with('?') || text.contains("怎么看") || text.contains("为什么") {
        return IntentKind::Consultation;
    }
    if text.is_empty() {
        return IntentKind::Noise;
    }
    IntentKind::Ambiguous
}
```

This deterministic classifier is the first implementation of the future channel-intent Skill boundary. Do not call an LLM from tests.

- [ ] **Step 4: Wire service into state**

Export in `services/mod.rs`, add `coordinator_service: CoordinatorService` to `AppState`, and expose:

```rust
pub fn coordinator(&self) -> &CoordinatorService {
    &self.coordinator_service
}
```

Initialize `CoordinatorService::new(orchestration_store.clone())` so every decision is persisted through `coordinator_decisions`.

- [ ] **Step 5: Run Coordinator tests**

Run: `cargo test -p slei-daemon --test channel_coordinator coordinator_`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add crates/slei-daemon/src/services/coordinator_service.rs crates/slei-daemon/src/services/mod.rs crates/slei-daemon/src/state.rs crates/slei-daemon/tests/channel_coordinator.rs
git commit -m "feat: add channel coordinator decisions"
```

## Task 5: Message Routing Through Coordinator And Auto Task Creation

**Files:**
- Modify: `crates/slei-daemon/src/services/message_service.rs`
- Create: `crates/slei-daemon/src/services/channel_orchestrator_service.rs`
- Modify: `crates/slei-daemon/src/services/task_service.rs`
- Modify: `crates/slei-daemon/src/services/mod.rs`
- Modify: `crates/slei-daemon/src/state.rs`
- Modify: `crates/slei-daemon/tests/channel_chat.rs`
- Modify: `crates/slei-daemon/tests/channel_coordinator.rs`
- Create: `crates/slei-daemon/tests/channel_orchestration_flow.rs`

- [ ] **Step 1: Write the failing end-to-end orchestration test**

Create `crates/slei-daemon/tests/channel_orchestration_flow.rs`:

```rust
#[tokio::test]
async fn command_message_creates_task_assignment_inbox_decision_and_task_card() {
    let token = AuthToken::from_static("test-token");
    let root = make_temp_dir("channel-orchestration-flow");
    let state = AppState::for_tests_with_agent_root_async(token.clone(), root).await;

    state.channels().create_channel(ChannelDraft {
        name: "dev".to_string(),
        description: None,
        permission: PermissionPreset::Controlled,
    }, "create-dev").await.unwrap();
    state.channels().add_agent_to_channel("dev", "agent_alice").await.unwrap();
    state
        .channels()
        .set_member_readiness("dev", "agent_alice", ChannelMemberReadiness::Ready)
        .await
        .unwrap();

    let outcome = state
        .channel_orchestrator()
        .send_channel_message(
            SendChannelMessageInput {
                channel_id: "dev".to_string(),
                author_id: "human_lei".to_string(),
                body: "实现频道创建时选择 Agent 的功能".to_string(),
                idempotency_key: "send-command".to_string(),
            },
        )
        .await
        .unwrap();

    assert_eq!(outcome.action, "create_task_and_assign");
    let task = state.tasks().task(&outcome.task_id.unwrap()).await.unwrap();
    assert_eq!(task.assignee_id.as_deref(), Some("agent_alice"));
    assert_eq!(task.source_message_id.as_deref(), Some(outcome.message_id.as_str()));
    assert!(task.assignment_reason.unwrap().contains("deterministic"));

    let inbox = state.agent_inbox().events_for_agent("agent_alice").await;
    assert!(inbox.iter().any(|event| event.event_type == "task_assigned"));

    let messages = state.channel_messages_for_tests("dev").await;
    assert!(messages.iter().any(|message| message.kind == MessageKind::TaskCard));

    let persisted = state
        .orchestration_store()
        .decisions_for_message_for_tests(&outcome.message_id)
        .await
        .unwrap();
    assert_eq!(persisted[0].action, "create_task_and_assign");

    let packages = state
        .orchestration_store()
        .routing_context_packages_for_message_for_tests(&outcome.message_id)
        .await
        .unwrap();
    assert_eq!(packages.len(), 1);
    let payload: serde_json::Value = serde_json::from_str(&packages[0].payload).unwrap();
    assert_eq!(payload["currentMessageId"], outcome.message_id);
    assert_eq!(payload["taskId"], outcome.task_id.clone().unwrap());
    assert!(payload["assignmentReason"].as_str().unwrap().contains("deterministic"));
    assert!(payload["relatedMessageIds"].as_array().unwrap().contains(&serde_json::Value::String(outcome.message_id.clone())));
    assert!(payload["safeMemoryRefs"].as_array().is_some());
}
```

- [ ] **Step 2: Run the orchestration test to verify it fails**

Run: `cargo test -p slei-daemon --test channel_orchestration_flow command_message_creates_task_assignment_inbox_decision_and_task_card`

Expected: FAIL because `ChannelOrchestratorService`, task card messages, and store helper reads do not exist.

- [ ] **Step 3: Keep MessageService focused on message storage**

In `crates/slei-daemon/src/services/message_service.rs`, remove no-mention primary-agent routing from the service path used by channel orchestration. Keep:

```rust
pub async fn create_human_channel_message(&self, channel_id: &str, author_id: &str, body: &str, idempotency_key: &str) -> Result<MessageRecord, MessageError>
pub async fn create_agent_channel_message(&self, channel_id: &str, author_id: &str, body: &str) -> Result<MessageRecord, MessageError>
pub async fn create_task_card_message(&self, channel_id: &str, task_id: &str, source_message_id: &str) -> Result<MessageRecord, MessageError>
```

Add `MessageKind::TaskCard`. Existing `send_message` tests can remain for legacy behavior until API routing moves, but the new orchestrator must not call primary-agent fallback.

- [ ] **Step 4: Add task service assignment reason**

Update `TaskRecord` in `crates/slei-daemon/src/services/task_service.rs`:

```rust
pub source_message_id: Option<String>,
pub assignment_reason: Option<String>,
pub needs_assignment: bool,
```

Add a method:

```rust
pub async fn create_from_coordinator(
    &self,
    channel_id: &str,
    creator_id: &str,
    source_message_id: &str,
    title: &str,
    assignee_id: Option<String>,
    assignment_reason: &str,
    idempotency_key: &str,
) -> Result<TaskRecord, TaskError>
```

Set `needs_assignment` to `assignee_id.is_none()`.

- [ ] **Step 5: Implement ChannelOrchestratorService**

Create `crates/slei-daemon/src/services/channel_orchestrator_service.rs`:

```rust
#[derive(Clone, Debug)]
pub struct SendChannelMessageInput {
    pub channel_id: String,
    pub author_id: String,
    pub body: String,
    pub idempotency_key: String,
}

#[derive(Clone, Debug)]
pub struct SendChannelMessageOutcome {
    pub message_id: String,
    pub action: String,
    pub task_id: Option<String>,
    pub assignee_agent_id: Option<String>,
}
```

The service dependencies are:

- `MessageService`
- `ChannelService`
- `CoordinatorService`
- `TaskService`
- `AgentInboxService`
- `OrchestrationStore`

`send_channel_message` must:

1. Persist the human message with `MessageService`.
2. Resolve explicit `@agent` mentions.
3. Read ready channel members from `ChannelService`.
4. Call `CoordinatorService::decide`.
5. Persist a routing context package through `OrchestrationStore`.
6. For explicit mentions, create readiness-aware inbox events and return `request_agent_reply`.
7. For `CreateTaskAndAssign`, call `TaskService::create_from_coordinator`.
8. Create a visible task-card message with `MessageService::create_task_card_message`.
9. Create `AgentInboxService::create_task_assignment`.
10. For `NeedsManualAssignment`, create the task with no assignee and a task-card message.

The routing context package payload must contain, at minimum:

```json
{
  "currentMessageId": "msg_...",
  "taskId": "task_...",
  "assignmentReason": "why this Agent was selected",
  "relatedMessageIds": ["msg_..."],
  "channelSummaryRef": null,
  "taskThreadRef": "task_...",
  "safeMemoryRefs": [
    { "agentId": "agent_alice", "path": "MEMORY.md" },
    { "agentId": "agent_alice", "path": "notes/channels.md" },
    { "agentId": "agent_alice", "path": "notes/relationships.md" }
  ]
}
```

If there are no summaries yet, use `null` or an empty array. Do not copy deleted message body text into this payload.

- [ ] **Step 6: Integrate explicit mention delivery**

Add a test to `crates/slei-daemon/tests/channel_orchestration_flow.rs`:

```rust
#[tokio::test]
async fn explicit_mention_creates_readiness_aware_inbox_without_overriding_target() {
    let token = AuthToken::from_static("test-token");
    let root = make_temp_dir("channel-explicit-mention");
    let state = AppState::for_tests_with_agent_root_async(token.clone(), root).await;
    state.channels().create_channel(ChannelDraft {
        name: "dev".to_string(),
        description: None,
        permission: PermissionPreset::Controlled,
    }, "create-dev-explicit").await.unwrap();
    state.channels().add_agent_to_channel("dev", "agent_alice").await.unwrap();

    let outcome = state.channel_orchestrator().send_channel_message(SendChannelMessageInput {
        channel_id: "dev".to_string(),
        author_id: "human_lei".to_string(),
        body: "@alice-win 帮我看下".to_string(),
        idempotency_key: "send-explicit".to_string(),
    }).await.unwrap();

    assert_eq!(outcome.action, "request_agent_reply");
    let inbox = state.agent_inbox().events_for_agent("agent_alice").await;
    assert_eq!(inbox[0].delivery_state, DeliveryState::PendingMemoryReady);
    assert!(state.tasks().list_tasks(Default::default()).await.is_empty());
}
```

The test assumes mention resolution can map `@alice-win` to `agent_alice`. If that mapping currently lives in `MemberService`, inject `MemberService` into `ChannelOrchestratorService`; do not hardcode handles.

- [ ] **Step 7: Add task service test**

Append to `crates/slei-daemon/tests/task_service.rs`:

```rust
#[tokio::test]
async fn task_created_from_coordinator_keeps_source_and_assignment_reason() {
    let service = TaskService::for_tests();
    let task = service
        .create_from_coordinator(
            "channel_dev",
            "human_lei",
            "msg_1",
            "实现频道 Coordinator",
            Some("agent_alice".to_string()),
            "command intent requires architecture",
            "task-from-coordinator",
        )
        .await
        .unwrap();

    assert_eq!(task.source_message_id.as_deref(), Some("msg_1"));
    assert_eq!(task.assignee_id.as_deref(), Some("agent_alice"));
    assert_eq!(task.needs_assignment, false);
    assert!(task.assignment_reason.unwrap().contains("command intent"));
}
```

- [ ] **Step 8: Wire service into AppState**

Export `channel_orchestrator_service` from `services/mod.rs`. Add it to `AppState` with:

```rust
pub fn channel_orchestrator(&self) -> &ChannelOrchestratorService {
    &self.channel_orchestrator_service
}
```

Construct it after all dependency services are available.

- [ ] **Step 9: Run orchestration and task tests**

Run:

```bash
cargo test -p slei-daemon --test channel_orchestration_flow
cargo test -p slei-daemon --test task_service --test task_api
```

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add crates/slei-daemon/src/services/message_service.rs crates/slei-daemon/src/services/channel_orchestrator_service.rs crates/slei-daemon/src/services/task_service.rs crates/slei-daemon/src/services/mod.rs crates/slei-daemon/src/state.rs crates/slei-daemon/tests/channel_chat.rs crates/slei-daemon/tests/channel_coordinator.rs crates/slei-daemon/tests/channel_orchestration_flow.rs crates/slei-daemon/tests/task_service.rs
git commit -m "feat: route channel messages through coordinator"
```

## Task 6: Task Thread Visible Handoff Inbox Events

**Files:**
- Modify: `crates/slei-daemon/src/services/task_service.rs`
- Modify: `crates/slei-daemon/src/services/channel_orchestrator_service.rs`
- Modify: `crates/slei-daemon/tests/channel_orchestration_flow.rs`
- Modify: `crates/slei-daemon/tests/task_service.rs`

- [ ] **Step 1: Write failing task-thread handoff test**

Append to `crates/slei-daemon/tests/channel_orchestration_flow.rs`:

```rust
#[tokio::test]
async fn task_thread_visible_agent_mention_creates_task_scoped_inbox_event() {
    let token = AuthToken::from_static("test-token");
    let root = make_temp_dir("task-thread-handoff");
    let state = AppState::for_tests_with_agent_root_async(token.clone(), root).await;
    state.channels().create_channel(ChannelDraft {
        name: "dev".to_string(),
        description: None,
        permission: PermissionPreset::Controlled,
    }, "create-dev-handoff").await.unwrap();
    state.channels().add_agent_to_channel("dev", "agent_coda").await.unwrap();
    state.run_channel_join_memory_updates("dev").await.unwrap();

    let task = state.tasks().create_from_coordinator(
        "dev",
        "agent_alice",
        "msg_root",
        "实现频道 Coordinator",
        Some("agent_alice".to_string()),
        "initial architecture assignment",
        "task-handoff-root",
    ).await.unwrap();

    state
        .channel_orchestrator()
        .add_task_reply(
            &task.id,
            "agent_alice",
            "架构方案完成。@coda-win 请根据方案实现。",
            "task-handoff-reply",
        )
        .await
        .unwrap();

    let inbox = state.agent_inbox().events_for_agent("agent_coda").await;
    assert!(inbox.iter().any(|event| {
        event.event_type == "task_handoff" && event.task_id.as_deref() == Some(task.id.as_str())
    }));
}
```

- [ ] **Step 2: Run the handoff test to verify it fails**

Run: `cargo test -p slei-daemon --test channel_orchestration_flow task_thread_visible_agent_mention_creates_task_scoped_inbox_event`

Expected: FAIL because task replies do not create task-scoped inbox events.

- [ ] **Step 3: Add task reply role/source fields if missing**

In `crates/slei-daemon/src/services/task_service.rs`, ensure `TaskReply` keeps:

```rust
pub sender_id: String,
pub role: Option<String>,
pub body: String,
```

Keep stable reply ids based on task id and reply count, or UUIDs generated by the service. Do not use timestamps for reply ids.

- [ ] **Step 4: Add orchestrated task reply method**

In `ChannelOrchestratorService`, add:

```rust
pub async fn add_task_reply(
    &self,
    task_id: &str,
    sender_id: &str,
    body: &str,
    idempotency_key: &str,
) -> Result<TaskReply, ChannelOrchestratorError>
```

This method must:

1. Add the reply through `TaskService`.
2. Detect visible `@agent` handles in `body`.
3. Resolve handles through `MemberService`.
4. Create `AgentInboxService::create_task_handoff` for each mentioned Agent.
5. Include `task_id`, reply id, sender id, and handoff text in the inbox payload.

It must not ask `CoordinatorService` to choose downstream Agents.

- [ ] **Step 5: Add inbox task handoff helper**

In `AgentInboxService`, add:

```rust
pub async fn create_task_handoff(
    &self,
    agent_id: &str,
    channel_id: &str,
    task_id: &str,
    reply_id: &str,
    readiness: ChannelMemberReadiness,
) -> AgentInboxEvent
```

Use the same readiness mapping as human mentions, but set `event_type` to `task_handoff`.

- [ ] **Step 6: Run task handoff tests**

Run: `cargo test -p slei-daemon --test channel_orchestration_flow task_thread_visible_agent_mention_creates_task_scoped_inbox_event`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add crates/slei-daemon/src/services/task_service.rs crates/slei-daemon/src/services/channel_orchestrator_service.rs crates/slei-daemon/src/services/agent_inbox_service.rs crates/slei-daemon/tests/channel_orchestration_flow.rs crates/slei-daemon/tests/task_service.rs
git commit -m "feat: create inbox events from task handoffs"
```

## Task 7: API, Tauri, And TypeScript Bridge Contracts

**Files:**
- Modify: `crates/slei-daemon/src/api/channels.rs`
- Modify: `crates/slei-daemon/src/api/messages.rs`
- Modify: `crates/slei-daemon/src/api/tasks.rs`
- Modify: `crates/slei-daemon/src/app.rs`
- Modify: `apps/desktop/src-tauri/src/daemon_broker.rs`
- Modify: `apps/desktop/src-tauri/src/commands.rs`
- Modify: `apps/desktop/src/lib/daemon-bridge.ts`
- Modify: `crates/slei-daemon/tests/channel_orchestration_flow.rs`
- Modify: `packages/protocol-client/src/contracts.ts`
- Modify: `packages/protocol-client/src/contracts.test.ts`
- Modify: `tests/contract/events.json`

- [ ] **Step 1: Write frontend contract test for create channel request**

In `packages/protocol-client/src/contracts.test.ts`, add a type-level runtime companion test using exported contract types:

```ts
import type { ChannelCreateRequest, ChannelMemberView } from "./contracts";

it("serializes channel create requests with selected agent ids", () => {
  const request: ChannelCreateRequest = {
    name: "#win-dev",
    description: "Windows team",
    agentIds: ["agent_alice", "agent_coda"],
  };
  const member: ChannelMemberView = {
    channelId: "win-dev",
    agentId: "agent_alice",
    joinedAt: "1",
    readiness: "joining",
  };

  expect(JSON.stringify(request)).toContain("agentIds");
  expect(request.agentIds).toEqual(["agent_alice", "agent_coda"]);
  expect(member.readiness).toBe("joining");
});
```

- [ ] **Step 2: Run the contract test**

Run: `pnpm --filter @slei/protocol-client test -- contracts.test.ts`

Expected: FAIL until exported protocol types include `agentIds` and member `readiness`.

- [ ] **Step 3: Extend daemon bridge TypeScript types**

In `apps/desktop/src/lib/daemon-bridge.ts`:

```ts
export type ChannelMemberReadiness = "joining" | "memory_syncing" | "ready" | "memory_failed" | "unavailable";

export type ChannelMemberView = {
  channelId: string;
  agentId: string;
  joinedAt: string;
  readiness: ChannelMemberReadiness;
};

export type ChannelCreateRequest = {
  name: string;
  description?: string;
  agentIds?: string[];
};
```

Update the fake bridge `createChannel` implementation to:

```ts
const selectedAgentIds = request.agentIds ?? [];
for (const agentId of selectedAgentIds) {
  channelMembers.push({ channelId: channel.id, agentId, joinedAt: String(Date.now()), readiness: "joining" });
}
```

Using `Date.now()` for visible `joinedAt` is acceptable; do not use it for task ids.

- [ ] **Step 4: Extend Tauri Rust bridge structs**

In `apps/desktop/src-tauri/src/daemon_broker.rs`, update:

```rust
pub struct ChannelCreateRequest {
    pub name: String,
    pub description: Option<String>,
    #[serde(default, alias = "agentIds")]
    pub agent_ids: Vec<String>,
}
```

Extend `ChannelMemberView` with `readiness: String`, defaulting existing fake/default members to `"ready"` or `"joining"` according to source.

- [ ] **Step 5: Thread request through commands**

Confirm `apps/desktop/src-tauri/src/commands.rs` already passes the whole `ChannelCreateRequest` to `broker.create_channel(request)`. Update broker `create_channel` to preserve selected members in fake state.

- [ ] **Step 6: Add public channel message API**

In `crates/slei-daemon/src/api/messages.rs`, replace `not_implemented` or add a channel-specific handler:

```rust
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendChannelMessageRequest {
    pub author_id: String,
    pub body: String,
}

pub async fn send_channel_message(
    State(state): State<AppState>,
    Path(channel_id): Path<String>,
    headers: HeaderMap,
    Json(payload): Json<SendChannelMessageRequest>,
) -> Response {
    if !state.auth_token.is_authorized(&headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let idempotency_key = headers.get("idempotency-key").and_then(|value| value.to_str().ok()).unwrap_or("");
    match state.channel_orchestrator().send_channel_message(SendChannelMessageInput {
        channel_id,
        author_id: payload.author_id,
        body: payload.body,
        idempotency_key: idempotency_key.to_string(),
    }).await {
        Ok(outcome) => Json(json!({ "outcome": outcome })).into_response(),
        Err(error) => (StatusCode::BAD_REQUEST, Json(json!({ "error": error.to_string() }))).into_response(),
    }
}
```

In `crates/slei-daemon/src/app.rs`, add:

```rust
.route("/v1/channels/{id}/messages", post(api::messages::send_channel_message))
```

- [ ] **Step 7: Add public API integration test**

Append to `crates/slei-daemon/tests/channel_orchestration_flow.rs`:

```rust
#[tokio::test]
async fn public_channel_message_api_uses_channel_orchestrator() {
    let token = AuthToken::from_static("test-token");
    let root = make_temp_dir("public-channel-message");
    let state = AppState::for_tests_with_agent_root_async(token.clone(), root).await;
    let app = build_router(state.clone());

    // Arrange channel + ready Agent using the same helpers from earlier tests.
    state.channels().create_channel(ChannelDraft {
        name: "api-dev".to_string(),
        description: None,
        permission: PermissionPreset::Controlled,
    }, "create-api-dev").await.unwrap();
    state.channels().add_agent_to_channel("api-dev", "agent_alice").await.unwrap();
    state.run_channel_join_memory_updates("api-dev").await.unwrap();

    let response = post_json(&app, &token, "/v1/channels/api-dev/messages", Some("send-api-command"), json!({
        "authorId": "human_lei",
        "body": "实现一个 API 路由"
    })).await;

    assert_eq!(response.status(), StatusCode::OK);
    let body = response_json(response).await;
    assert_eq!(body["outcome"]["action"], "create_task_and_assign");
    assert!(body["outcome"]["taskId"].as_str().is_some());
    assert!(!state.agent_inbox().events_for_agent("agent_alice").await.is_empty());
}
```

- [ ] **Step 8: Add Tauri/desktop bridge channel send method**

In `apps/desktop/src/lib/daemon-bridge.ts`, add:

```ts
export type SendChannelMessageRequest = {
  authorId: string;
  body: string;
};

export type SendChannelMessageOutcome = {
  messageId: string;
  action: string;
  taskId?: string;
  assigneeAgentId?: string;
};
```

Add `sendChannelMessage(channelId: string, request: SendChannelMessageRequest): Promise<{ outcome: SendChannelMessageOutcome }>` to `DaemonBridge`, the fake bridge, and the Tauri bridge. In `apps/desktop/src-tauri/src/commands.rs`, add a command that calls the daemon broker and ultimately the new daemon route.

- [ ] **Step 9: Run bridge, API, and TypeScript tests**

Run:

```bash
cargo test -p slei-daemon --test channel_orchestration_flow public_channel_message_api_uses_channel_orchestrator
pnpm --filter @slei/desktop test -- e2e/chat-channel-mentions.spec.tsx
cargo test -p slei-desktop
```

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add crates/slei-daemon/src/api/channels.rs crates/slei-daemon/src/api/messages.rs crates/slei-daemon/src/api/tasks.rs crates/slei-daemon/src/app.rs crates/slei-daemon/tests/channel_orchestration_flow.rs apps/desktop/src-tauri/src/daemon_broker.rs apps/desktop/src-tauri/src/commands.rs apps/desktop/src/lib/daemon-bridge.ts packages/protocol-client/src/contracts.ts packages/protocol-client/src/contracts.test.ts tests/contract/events.json
git commit -m "feat: expose channel agent membership contracts"
```

## Task 8: Desktop Channel Creation UI

**Files:**
- Modify: `apps/desktop/src/app/fixtures.ts`
- Modify: `apps/desktop/src/app/model.ts`
- Modify: `apps/desktop/src/app/SleiApp.tsx`
- Modify: `apps/desktop/src/app/SleiAppFrame.tsx`
- Modify: `apps/desktop/src/app/app.css`
- Modify: `apps/desktop/src/i18n/types.ts`
- Modify: `apps/desktop/src/i18n/messages/zh-CN/chat.ts`
- Modify: `apps/desktop/src/i18n/messages/en-US/chat.ts`
- Modify: `apps/desktop/e2e/chat-channel-mentions.spec.tsx`

- [ ] **Step 1: Write failing SSR test for Agent multi-select**

In `apps/desktop/e2e/chat-channel-mentions.spec.tsx`, add:

```tsx
it("lets users select agents when creating a channel and shows readiness copy", () => {
  const html = renderToStaticMarkup(
    <SleiAppFrame
      activeView="chat"
      data={createSleiFixtures({ members: createDemoMembers() })}
      initialCreateChannelModalOpen
      locale="zh-CN"
      runtimeSetup={readyRuntime}
    />,
  );

  expect(html).toContain("选择 Agent");
  expect(html).toContain("@Coda");
  expect(html).toContain("@alice");
  expect(html).toContain("记忆同步中");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @slei/desktop test -- e2e/chat-channel-mentions.spec.tsx -t "select agents"`

Expected: FAIL because the modal has no Agent selector.

- [ ] **Step 3: Extend fixture types**

In `apps/desktop/src/app/fixtures.ts`, add:

```ts
export type SleiChannelMemberReadiness = "joining" | "memory_syncing" | "ready" | "memory_failed" | "unavailable";
```

Add optional readiness to `SleiMember`:

```ts
channelReadiness?: Record<string, SleiChannelMemberReadiness>;
```

- [ ] **Step 4: Add model helper**

In `apps/desktop/src/app/model.ts`, add:

```ts
export function channelReadinessLabel(readiness: string | undefined, messages: DesktopMessages): string {
  switch (readiness) {
    case "joining": return messages.chat.memberJoining;
    case "memory_syncing": return messages.chat.memorySyncing;
    case "memory_failed": return messages.chat.memoryFailed;
    case "unavailable": return messages.chat.memberUnavailable;
    default: return messages.chat.memberReady;
  }
}
```

- [ ] **Step 5: Add i18n keys**

Add to `apps/desktop/src/i18n/types.ts` chat messages:

```ts
selectAgents: string;
memberJoining: string;
memorySyncing: string;
memoryFailed: string;
memberUnavailable: string;
memberReady: string;
```

Add zh-CN:

```ts
selectAgents: "选择 Agent",
memberJoining: "入群中",
memorySyncing: "记忆同步中",
memoryFailed: "记忆失败",
memberUnavailable: "不可用",
memberReady: "已就位",
```

Add en-US equivalents.

- [ ] **Step 6: Update create-channel callback types**

In `apps/desktop/src/app/SleiAppFrame.tsx`, change:

```ts
onChannelCreate?: (input: { name: string; projectName?: string; agentIds?: string[] }) => Promise<void> | void;
```

Update all call sites and local submit handlers to include selected `agentIds`.

- [ ] **Step 7: Render Agent checkboxes in modal**

Inside the create-channel modal in `SleiAppFrame.tsx`, render:

```tsx
<fieldset className="slei-channel-agent-select">
  <legend>{input.messages.chat.selectAgents}</legend>
  {input.data.members.filter((member) => member.type === "agent").map((member) => (
    <label key={member.id}>
      <input
        checked={selectedAgentIds.includes(member.id)}
        onChange={() => toggleSelectedAgent(member.id)}
        type="checkbox"
      />
      <MemberAvatar identity={member} />
      <span>{member.name}</span>
      <small>{member.handle} · {member.role}</small>
      <em>{input.messages.chat.memorySyncing}</em>
    </label>
  ))}
</fieldset>
```

Use local `selectedAgentIds` state. Keep the modal compact; no nested cards.

- [ ] **Step 8: Send selected ids through SleiApp**

In `apps/desktop/src/app/SleiApp.tsx`, update `handleCreateChannel`:

```ts
async function handleCreateChannel(input: { name: string; projectName?: string; agentIds?: string[] }) {
  const receipt = await bridge.createChannel({
    name: input.name,
    description: input.projectName,
    agentIds: input.agentIds ?? [],
  });
  // existing local channel state update
}
```

- [ ] **Step 9: Route channel composer sends through channel orchestrator bridge**

In `apps/desktop/src/app/SleiApp.tsx`, update the channel branch of `handleSendMessage` so ordinary channel messages call:

```ts
const receipt = await bridge.sendChannelMessage(activeChannelId, {
  authorId: `human:${profile.handle.replace(/^@/, "")}`,
  body,
});
```

After the response:

- append or refresh the visible human message
- if `receipt.outcome.taskId` is present, refresh tasks or add a local task card placeholder using the returned task id
- do not call the old primary-Agent or DM conversation send path for channel messages
- keep the existing conversation send path for Agent DMs

Add a focused test in `apps/desktop/e2e/composer-submit.spec.ts` using a fake bridge spy. It must assert that channel sends call `sendChannelMessage`, while Agent DM sends still call the existing conversation send path.

- [ ] **Step 10: Add styles**

In `apps/desktop/src/app/app.css`, add stable layout:

```css
.slei-channel-agent-select {
  display: grid;
  gap: 8px;
  border: 2px solid var(--slei-border);
  padding: 10px;
}

.slei-channel-agent-select label {
  display: grid;
  grid-template-columns: 20px 32px minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
}
```

- [ ] **Step 11: Run desktop tests**

Run: `pnpm --filter @slei/desktop test -- e2e/chat-channel-mentions.spec.tsx`

Expected: PASS.

- [ ] **Step 12: Commit**

```bash
git add apps/desktop/src/app/fixtures.ts apps/desktop/src/app/model.ts apps/desktop/src/app/SleiApp.tsx apps/desktop/src/app/SleiAppFrame.tsx apps/desktop/src/app/app.css apps/desktop/src/i18n/types.ts apps/desktop/src/i18n/messages/zh-CN/chat.ts apps/desktop/src/i18n/messages/en-US/chat.ts apps/desktop/e2e/chat-channel-mentions.spec.tsx
git commit -m "feat: select agents during channel creation"
```

## Task 9: Memory Cleanup And Runtime Context Blocking

**Files:**
- Modify: `crates/slei-daemon/src/services/memory_event_service.rs`
- Modify: `crates/slei-daemon/src/services/run_orchestrator.rs`
- Create: `crates/slei-daemon/tests/memory_cleanup.rs`
- Modify: `workers/claude-agent/src/context.ts`
- Modify: `workers/claude-agent/src/context.test.ts`

- [ ] **Step 1: Write failing daemon memory cleanup test**

Create `crates/slei-daemon/tests/memory_cleanup.rs`:

```rust
use slei_daemon::services::memory_event_service::MemoryEventService;
use slei_daemon::services::orchestration_store::OrchestrationStore;
use slei_daemon::services::run_orchestrator::{ContextAssembler, ContextMessageRecord, MemorySnippetRecord};

#[tokio::test]
async fn deleted_source_blocks_affected_memory_snippet_until_cleanup_completes() {
    let memory = MemoryEventService::new(OrchestrationStore::for_tests().await);
    memory
        .record_memory_document_source("agent_alice", "notes/channels.md", "win-dev", "msg_deleted")
        .await;
    memory.request_cleanup_for_source_message("msg_deleted").await;

    let blocked = memory.blocked_memory_sections("agent_alice").await;
    let context = ContextAssembler::assemble_with_memory(
        vec![ContextMessageRecord {
            channel_id: "channel_dev".to_string(),
            task_id: None,
            agent_id: "agent_alice".to_string(),
            role: "user".to_string(),
            content: Some("safe task".to_string()),
            deleted: false,
        }],
        vec![MemorySnippetRecord {
            agent_id: "agent_alice".to_string(),
            document_path: "notes/channels.md".to_string(),
            document_section: "win-dev".to_string(),
            content: "SENTINEL_DELETED_MEMORY".to_string(),
        }],
        blocked,
    );

    let serialized = serde_json::to_string(&context).unwrap();
    assert!(serialized.contains("safe task"));
    assert!(!serialized.contains("SENTINEL_DELETED_MEMORY"));
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cargo test -p slei-daemon --test memory_cleanup`

Expected: FAIL because cleanup and memory snippet filtering APIs are missing.

- [ ] **Step 3: Extend memory event service**

Add records and methods:

```rust
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct MemorySectionRef {
    pub agent_id: String,
    pub document_path: String,
    pub document_section: String,
}

pub async fn record_memory_document_source(&self, agent_id: &str, document_path: &str, document_section: &str, source_message_id: &str)
pub async fn request_cleanup_for_source_message(&self, source_message_id: &str)
pub async fn complete_cleanup(&self, agent_id: &str, document_path: &str, document_section: &str)
pub async fn blocked_memory_sections(&self, agent_id: &str) -> Vec<MemorySectionRef>
```

These methods must update `memory_update_events` and `memory_document_states` through `OrchestrationStore`. Do not keep cleanup state only in memory; the blocked state must survive restart because runtime context assembly can happen after the deletion request.

- [ ] **Step 4: Add persisted cleanup restart assertion**

Extend the daemon memory cleanup test or add a second test:

```rust
#[tokio::test]
async fn blocked_memory_sections_survive_restart() {
    let root = make_temp_dir("memory-cleanup-restart");
    let store = OrchestrationStore::for_data_root(root.clone()).await;
    let memory = MemoryEventService::new(store.clone());
    memory.record_memory_document_source("agent_alice", "notes/channels.md", "win-dev", "msg_deleted").await;
    memory.request_cleanup_for_source_message("msg_deleted").await;

    let restarted = MemoryEventService::new(OrchestrationStore::for_data_root(root).await);
    assert_eq!(restarted.blocked_memory_sections("agent_alice").await.len(), 1);
}
```

- [ ] **Step 5: Extend daemon context assembler**

In `crates/slei-daemon/src/services/run_orchestrator.rs`, add:

```rust
#[derive(Clone, Debug)]
pub struct MemorySnippetRecord {
    pub agent_id: String,
    pub document_path: String,
    pub document_section: String,
    pub content: String,
}
```

Add `ContextAssembler::assemble_with_memory(messages, memory_snippets, blocked_sections)`.

Filter out memory snippets whose `(agent_id, document_path, document_section)` is blocked.

- [ ] **Step 6: Run daemon cleanup test**

Run: `cargo test -p slei-daemon --test memory_cleanup`

Expected: PASS.

- [ ] **Step 7: Write failing worker context test**

In `workers/claude-agent/src/context.test.ts`, add:

```ts
it("excludes memory snippets blocked by deletion cleanup", () => {
  const context = assembleContext(
    { channelId: "channel_dev", agentId: "agent_coda" },
    records,
    {
      memorySnippets: [
        {
          agent_id: "agent_coda",
          document_path: "notes/channels.md",
          document_section: "win-dev",
          content: "SENTINEL_DELETED_MEMORY",
        },
      ],
      blockedMemorySections: [
        {
          agent_id: "agent_coda",
          document_path: "notes/channels.md",
          document_section: "win-dev",
        },
      ],
    },
  );

  expect(JSON.stringify(context)).not.toContain("SENTINEL_DELETED_MEMORY");
});
```

- [ ] **Step 8: Run worker test to verify it fails**

Run: `pnpm --filter @slei/claude-agent test -- context.test.ts -t "blocked by deletion cleanup"`

Expected: FAIL because `assembleContext` accepts only two arguments.

- [ ] **Step 9: Extend worker context helper**

In `workers/claude-agent/src/context.ts`, add optional third argument:

```ts
export type MemorySnippetRecord = {
  agent_id: string;
  document_path: string;
  document_section: string;
  content: string;
};

export type BlockedMemorySection = Omit<MemorySnippetRecord, "content">;
```

Append eligible memory snippets as system messages after normal records:

```ts
const blocked = new Set(input.blockedMemorySections.map(sectionKey));
const memoryMessages = input.memorySnippets
  .filter((snippet) => snippet.agent_id === scope.agentId)
  .filter((snippet) => !blocked.has(sectionKey(snippet)))
  .map((snippet) => ({ role: "system" as const, content: snippet.content }));
```

- [ ] **Step 10: Run worker context tests**

Run: `pnpm --filter @slei/claude-agent test -- context.test.ts`

Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add crates/slei-daemon/src/services/memory_event_service.rs crates/slei-daemon/src/services/run_orchestrator.rs crates/slei-daemon/tests/memory_cleanup.rs workers/claude-agent/src/context.ts workers/claude-agent/src/context.test.ts
git commit -m "feat: block deleted memory snippets from runtime context"
```

## Task 10: Diagnostics And Final Verification

**Files:**
- Modify: `crates/slei-daemon/src/api/diagnostics.rs`
- Modify: `crates/slei-daemon/src/app.rs`
- Modify: `apps/desktop/src/features/diagnostics/DiagnosticsPage.ts`
- Modify: `apps/desktop/e2e/diagnostics.spec.ts`

- [ ] **Step 1: Write failing diagnostics test**

In `apps/desktop/e2e/diagnostics.spec.ts`, add an SSR or helper-level assertion that diagnostics copy includes Coordinator decisions and inbox events:

```ts
it("mentions coordinator routing internals in diagnostics", () => {
  const html = renderToStaticMarkup(
    <SleiAppFrame activeView="diagnostics" data={createSleiFixtures()} locale="zh-CN" runtimeSetup={readyRuntime} />,
  );

  expect(html).toContain("Coordinator");
  expect(html).toContain("Inbox");
});
```

If `diagnostics` is not an `AppView`, write the test against `DiagnosticsPage` directly using its current props.

- [ ] **Step 2: Run diagnostics test to verify it fails**

Run: `pnpm --filter @slei/desktop test -- e2e/diagnostics.spec.ts`

Expected: FAIL because diagnostics do not mention Coordinator internals.

- [ ] **Step 3: Add diagnostics surfaces**

Expose a daemon diagnostics endpoint or existing diagnostics payload fields for:

```json
{
  "coordinatorDecisionCount": 0,
  "agentInboxEventCount": 0,
  "memoryUpdateEventCount": 0
}
```

Render these counts in the desktop diagnostics page. Keep details out of the main chat timeline.

- [ ] **Step 4: Run diagnostics test**

Run: `pnpm --filter @slei/desktop test -- e2e/diagnostics.spec.ts`

Expected: PASS.

- [ ] **Step 5: Full verification**

Run:

```bash
cargo test --workspace
pnpm --filter @slei/desktop test
pnpm --filter @slei/desktop typecheck
pnpm --filter @slei/desktop lint
pnpm --filter @slei/claude-agent test
pnpm --filter @slei/protocol-client test
git diff --check
```

Expected: all commands PASS.

- [ ] **Step 6: Commit**

```bash
git add crates/slei-daemon/src/api/diagnostics.rs crates/slei-daemon/src/app.rs apps/desktop/src/features/diagnostics/DiagnosticsPage.ts apps/desktop/e2e/diagnostics.spec.ts
git commit -m "feat: expose coordinator diagnostics"
```

## Implementation Handoff Notes

- Use @superpowers:subagent-driven-development for execution because subagents are available in this harness.
- Keep each task in a fresh worker where possible. The highest-conflict files are `AppState`, `services/mod.rs`, `daemon-bridge.ts`, `SleiAppFrame.tsx`, and i18n files; avoid parallel edits to those files.
- Do not implement a real LLM-backed Coordinator until deterministic service tests are green.
- Do not let Coordinator assign downstream task Agents. Only visible task-thread `@agent` mentions create downstream inbox events.
- Do not show Coordinator prose in the chat timeline.
- Make deletion cleanup tests explicit; they protect the privacy constraint found during spec review.
