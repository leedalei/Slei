# Channel Members Global Coordinator Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build lightweight channel member management with a collapsed-by-default right member list, one shared `agent_global_coordinator`, live roster context, membership memory updates, and Agent-authored join reports.

**Architecture:** Keep channel membership in the existing file-backed `ChannelService`; do not add a membership snapshot table. Add shared coordinator filtering on daemon and desktop, route all coordinator worker sessions through `agent_global_coordinator`, expose channel member add/remove APIs, and render a right-side Chat member list that calls those APIs and refreshes channel data.

**Tech Stack:** Rust/Axum/Tauri, Tokio services, existing Claude worker adapter, React 19, TypeScript, Vitest, shadcn-style local UI components, lucide-react icons.

---

## Spec And Context

- Spec: `docs/superpowers/specs/2026-06-09-channel-members-global-coordinator-design.md`
- Knowledge note: `docs/knowledge/best-practices/task-thread-stable-ids-and-reply-roles-20260529.md`
- Relevant prior specs:
  - `docs/superpowers/specs/2026-06-03-slei-channel-coordinator-design.md`
  - `docs/superpowers/specs/2026-06-09-channel-coordinator-multi-target-routing.md`
  - `docs/superpowers/specs/2026-05-28-slei-chat-channel-mention-spec.md`

Important constraints:

- Use the lightweight approach. Do not add a member snapshot table or migrate channel state to SQLite.
- "Ordinary Agent" means a non-coordinator Agent eligible for channel membership and user-directed collaboration.
- Treat both `agent_global_coordinator` and legacy `agent_coordinator_*` as internal coordinator Agents.
- Do not rely on `ProductAgentRecord.channel_ids` as the source of truth for current channel membership; use `ChannelService.channel_members(channel_id)`.
- Avoid business IDs based only on `Date.now()` in new testable behavior. Use deterministic strings from source ids or existing idempotency keys where possible.
- Do not make deleted members or remaining members post visible removal reports.
- After implementation is complete, per repository instruction, ask whether to merge into `master` or another branch.

## File Structure

Daemon coordinator identity and filtering:

- Create `crates/slei-daemon/src/services/coordinator_identity.rs`
  - Owns `GLOBAL_COORDINATOR_AGENT_ID`, `is_coordinator_agent_id`, `is_coordinator_kind`, and `is_internal_coordinator`.
- Modify `crates/slei-daemon/src/services/mod.rs`
  - Export the new module.
- Modify `crates/slei-daemon/src/services/member_service.rs`
  - Add `ensure_global_channel_coordinator_agent`.
  - Keep legacy helper compatibility, but make new call sites use the global helper.
- Modify `crates/slei-daemon/src/services/coordinator_service.rs`
  - Use global coordinator id for worker sessions.
  - Reject global coordinator targets in validation.
  - Include member description/role summary in prompt members.
- Modify `crates/slei-daemon/src/services/channel_orchestrator_service.rs`
  - Stop ensuring per-channel coordinators.
  - Build prompt members from current membership and filter coordinators.
- Modify `crates/slei-daemon/src/api/members.rs`
  - Ensure only global coordinator exists when listing Agents.
- Modify `crates/slei-daemon/src/api/channels.rs`
  - Stop adding per-channel coordinator during channel setup.
  - Add add/remove member endpoint handlers.
- Modify `crates/slei-daemon/src/app.rs`
  - Register channel member POST/DELETE routes.

Daemon member memory and join reports:

- Create `crates/slei-daemon/src/services/channel_join_report_service.rs`
  - Starts Agent-authored join report runs.
  - Tracks pending run output and writes idempotent visible channel messages when runs complete.
- Modify `crates/slei-daemon/src/services/channel_service.rs`
  - Add `remove_agent_from_channel`.
- Modify `crates/slei-daemon/src/services/memory_maintainer_service.rs`
  - Add targeted update methods for added members and removed members.
  - Ensure removed Agent memory is updated even after membership removal.
- Modify `crates/slei-daemon/src/services/mod.rs`
  - Export the join-report service.
- Modify `crates/slei-daemon/src/state.rs`
  - Add orchestration helpers for channel member add/remove flows.
  - Add the join-report service field and worker-event dispatch.
- Modify `crates/slei-daemon/src/services/message_service.rs`
  - Add idempotent Agent join-report message creation keyed by `channel_id` and `agent_id`.

Daemon tests:

- Modify `crates/slei-daemon/tests/channel_coordinator.rs`
- Modify `crates/slei-daemon/tests/channel_orchestration_flow.rs`
- Modify `crates/slei-daemon/tests/agent_workspace.rs`
- Add `crates/slei-daemon/tests/channel_members.rs` if the new endpoint tests become too large for existing files.

Desktop bridge and protocol:

- Modify `packages/protocol-client/src/contracts.ts`
  - Add `ChannelMemberAddRequest`, `ChannelMemberAddReceipt`, `ChannelMemberRemoveReceipt`.
- Modify `packages/protocol-client/src/contracts.test.ts`
  - Assert new contract types compile if the existing style supports it.
- Modify `apps/desktop/src/lib/daemon-bridge.ts`
  - Add bridge methods and mock behavior for add/remove channel member.
- Modify `apps/desktop/src-tauri/src/daemon_broker.rs`
  - Add Rust request/receipt structs.
  - Add daemon HTTP calls for POST/DELETE channel member routes.
- Modify `apps/desktop/src-tauri/src/commands.rs`
  - Add Tauri commands for add/remove channel member.
- Modify `apps/desktop/src-tauri/src/lib.rs`
  - Register new commands.

Desktop model and UI:

- Modify `apps/desktop/src/app/model.ts`
  - Add shared `isCoordinatorMember` / `isOrdinaryAgentMember` helpers.
  - Update mention suggestions to use the helper.
- Modify `apps/desktop/src/app/SleiApp.tsx`
  - Add handlers for add/remove channel member.
  - Refresh channel members and messages after membership changes.
  - Map channel membership readiness into `SleiMember.channelReadiness`.
- Modify `apps/desktop/src/app/SleiAppFrame.tsx`
  - Pass member handlers into `ChatRoute`.
  - Fix channel sidebar delete button hover/focus layout and confirmation popover.
- Modify `apps/desktop/src/features/members/MembersPageView.tsx`
  - Hide global and legacy coordinator Agents from the desktop Members page and detail view.
- Modify `apps/desktop/src/features/chat/ChatPageView.tsx`
  - Add right-side member list, collapsed by default.
  - Add add-member picker.
  - Add remove-member confirmation popover.
- Modify `apps/desktop/src/i18n/types.ts`
- Modify `apps/desktop/src/i18n/messages/zh-CN/chat.ts`
- Modify `apps/desktop/src/i18n/messages/en-US/chat.ts`
  - Add UI strings for member list, add/remove, confirmation, statuses.

Desktop tests:

- Modify `apps/desktop/e2e/chat-channel-mentions.spec.tsx`
  - Existing channel/mention tests are closest to the new UI.
- Modify `apps/desktop/e2e/chinese-members.spec.tsx`
  - Assert the Members page hides internal coordinator Agents.
- Add `apps/desktop/e2e/channel-members.spec.tsx` if the new tests make the existing file unwieldy.
- Modify `apps/desktop/src/app/SleiApp.test.ts` if state handlers need focused component tests.
- Modify `apps/desktop/src/lib/default-agent-assets.test.ts` only if global coordinator default memory content changes.

## Task 1: Add Shared Coordinator Identity Helpers

**Files:**
- Create: `crates/slei-daemon/src/services/coordinator_identity.rs`
- Modify: `crates/slei-daemon/src/services/mod.rs`
- Modify: `crates/slei-daemon/src/services/coordinator_service.rs`
- Test: `crates/slei-daemon/tests/channel_coordinator.rs`

- [ ] **Step 1: Write failing daemon tests for global coordinator target rejection**

Add to `crates/slei-daemon/tests/channel_coordinator.rs`:

```rust
#[test]
fn coordinator_json_validation_rejects_global_coordinator_target() {
    let members = vec![
        CoordinatorPromptMember {
            agent_id: "agent_global_coordinator".to_string(),
            name: "Global Coordinator".to_string(),
            handle: "@coordinator".to_string(),
            agent_kind: "coordinator".to_string(),
            readiness: "ready".to_string(),
            description: "Internal router".to_string(),
        },
        CoordinatorPromptMember {
            agent_id: "agent_alice".to_string(),
            name: "Alice".to_string(),
            handle: "@alice".to_string(),
            agent_kind: "agent".to_string(),
            readiness: "ready".to_string(),
            description: "Architecture Agent".to_string(),
        },
    ];
    let raw = r#"{
      "intent": "consultation",
      "action": "request_agent_reply",
      "routeMode": "explicit",
      "primaryAssigneeAgentId": "agent_global_coordinator",
      "targetAgentIds": ["agent_global_coordinator"],
      "task": null,
      "reason": "invalid target",
      "confidence": 0.8
    }"#;

    let error = parse_and_validate_coordinator_json(raw, &members).unwrap_err();

    assert_eq!(
        error,
        CoordinatorDecisionError::InvalidTarget("agent_global_coordinator".to_string())
    );
}
```

Also update existing `CoordinatorPromptMember` literals in this file to include the new `description` field. This test should fail before implementation because the field and global-id rejection are not wired consistently.

- [ ] **Step 2: Run the focused failing test**

Run:

```bash
cargo test -p slei-daemon coordinator_json_validation_rejects_global_coordinator_target
```

Expected: FAIL or compile error due to missing `description` field and/or missing global coordinator target rejection.

- [ ] **Step 3: Implement daemon coordinator identity helper**

Create `crates/slei-daemon/src/services/coordinator_identity.rs`:

```rust
pub const GLOBAL_COORDINATOR_AGENT_ID: &str = "agent_global_coordinator";

pub fn is_coordinator_agent_id(agent_id: &str) -> bool {
    agent_id == GLOBAL_COORDINATOR_AGENT_ID || agent_id.starts_with("agent_coordinator_")
}

pub fn is_coordinator_kind(agent_kind: &str) -> bool {
    agent_kind == "coordinator"
}

pub fn is_internal_coordinator(agent_id: &str, agent_kind: &str) -> bool {
    is_coordinator_agent_id(agent_id) || is_coordinator_kind(agent_kind)
}
```

Export it in `crates/slei-daemon/src/services/mod.rs`:

```rust
pub mod coordinator_identity;
```

- [ ] **Step 4: Update coordinator service validation and prompt member shape**

In `crates/slei-daemon/src/services/coordinator_service.rs`:

1. Import the helper:

```rust
use crate::services::coordinator_identity::{is_coordinator_agent_id, is_internal_coordinator, GLOBAL_COORDINATOR_AGENT_ID};
```

2. Add `description` to `CoordinatorPromptMember`:

```rust
pub struct CoordinatorPromptMember {
    pub agent_id: String,
    pub name: String,
    pub handle: String,
    pub agent_kind: String,
    pub readiness: String,
    pub description: String,
}
```

3. In `build_coordinator_prompt`, include `description` in each roster item:

```rust
"- agentId: {}\n  name: {}\n  handle: {}\n  agentKind: {}\n  readiness: {}\n  description: {}"
```

4. In `validate_member_target`, replace local coordinator checks with:

```rust
if is_internal_coordinator(&member.agent_id, &member.agent_kind) {
    return Err(CoordinatorDecisionError::InvalidTarget(agent_id.to_string()));
}
```

5. Remove or stop using the local `is_channel_coordinator_agent` helper where the shared helper now applies.

Also update any existing `MemberService::is_coordinator_agent` helper to delegate to `is_coordinator_agent_id` / `is_internal_coordinator`, so legacy `agent_coordinator_*` ids are treated as internal even if their stored `agent_kind` is missing or stale.

- [ ] **Step 5: Verify focused daemon test passes**

Run:

```bash
cargo test -p slei-daemon coordinator_json_validation_rejects_global_coordinator_target
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add crates/slei-daemon/src/services/coordinator_identity.rs \
  crates/slei-daemon/src/services/mod.rs \
  crates/slei-daemon/src/services/coordinator_service.rs \
  crates/slei-daemon/tests/channel_coordinator.rs
git commit -m "feat: add global coordinator identity helper"
```

## Task 2: Ensure One Global Coordinator And Live Roster Prompt Context

**Files:**
- Modify: `crates/slei-daemon/src/services/member_service.rs`
- Modify: `crates/slei-daemon/src/api/members.rs`
- Modify: `crates/slei-daemon/src/api/channels.rs`
- Modify: `crates/slei-daemon/src/services/channel_orchestrator_service.rs`
- Modify: `crates/slei-daemon/src/services/coordinator_service.rs`
- Test: `crates/slei-daemon/tests/channel_orchestration_flow.rs`
- Test: `crates/slei-daemon/tests/channel_coordinator.rs`

- [ ] **Step 1: Write failing test that channel creation does not create per-channel coordinators**

Add to `crates/slei-daemon/tests/channel_orchestration_flow.rs`:

```rust
#[tokio::test]
async fn creating_channel_ensures_global_coordinator_without_channel_coordinator_member() {
    let token = AuthToken::from_static("test-token");
    let state = AppState::for_tests(token.clone());
    let router = build_router(state.clone());

    let response = router
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/v1/channels")
                .header("authorization", token.authorization_header())
                .header("idempotency-key", "create-global-coord-channel")
                .header("content-type", "application/json")
                .body(Body::from(r#"{"name":"global-coord-dev","agentIds":[]}"#))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::CREATED);
    sleep(Duration::from_millis(100)).await;

    let agents = state.members().list_product_agents().await;
    assert!(agents.iter().any(|agent| agent.id == "agent_global_coordinator"));
    assert!(!agents.iter().any(|agent| agent.id == "agent_coordinator_global-coord-dev"));

    let members = state.channels().channel_members("global-coord-dev").await.unwrap();
    assert!(!members.iter().any(|member| member.agent_id == "agent_global_coordinator"));
    assert!(!members.iter().any(|member| member.agent_id.starts_with("agent_coordinator_")));
}
```

Use the auth request helpers already present in nearby daemon API tests. If this new file needs local helpers, define them in the test file like this:

```rust
fn authorized_json_request(
    token: &AuthToken,
    method: &str,
    uri: &str,
    idempotency_key: &str,
    payload: Value,
) -> Request<Body> {
    Request::builder()
        .method(method)
        .uri(uri)
        .header("authorization", token.authorization_header())
        .header("idempotency-key", idempotency_key)
        .header("content-type", "application/json")
        .body(Body::from(payload.to_string()))
        .unwrap()
}

fn authorized_empty_request(
    token: &AuthToken,
    method: &str,
    uri: &str,
    idempotency_key: &str,
) -> Request<Body> {
    Request::builder()
        .method(method)
        .uri(uri)
        .header("authorization", token.authorization_header())
        .header("idempotency-key", idempotency_key)
        .body(Body::empty())
        .unwrap()
}

async fn response_json(response: axum::response::Response) -> Value {
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    serde_json::from_slice(&bytes).unwrap()
}
```

- [ ] **Step 2: Run failing test**

Run:

```bash
cargo test -p slei-daemon creating_channel_ensures_global_coordinator_without_channel_coordinator_member
```

Expected: FAIL because `run_channel_setup` currently creates and joins a per-channel coordinator.

- [ ] **Step 3: Add global coordinator creation to MemberService**

In `crates/slei-daemon/src/services/member_service.rs`:

1. Import `GLOBAL_COORDINATOR_AGENT_ID`.
2. Add:

```rust
pub async fn ensure_global_channel_coordinator_agent(
    &self,
    node_id: &str,
) -> Result<ProductAgentRecord, MemberError> {
    if node_id.trim().is_empty() {
        return Err(MemberError::InvalidAgent);
    }

    let existing_agent = {
        self.inner
            .lock()
            .await
            .product_agents
            .get(GLOBAL_COORDINATOR_AGENT_ID)
            .cloned()
    };
    if let Some(agent) = existing_agent {
        return self.normalize_existing_global_channel_coordinator(agent).await;
    }

    let draft = ProductAgentDraft {
        name: "Global Coordinator".to_string(),
        handle: "@coordinator".to_string(),
        runtime_kind: "ClaudeCode".to_string(),
        model: "Sonnet".to_string(),
        node_id: node_id.trim().to_string(),
        description: "全局频道协调员，负责根据当前频道成员上下文路由消息，不直接回答用户。".to_string(),
    };

    self.create_product_agent_record_with_channels(
        draft,
        GLOBAL_COORDINATOR_AGENT_ID.to_string(),
        "coordinator",
        true,
        "coordinator:global",
        Vec::new(),
    )
    .await
}
```

3. Add `normalize_existing_global_channel_coordinator` mirroring `normalize_existing_channel_coordinator`, but without channel-specific name/description.

4. Leave `ensure_channel_coordinator_agent` in place for legacy callers during the transition, but do not use it in new channel setup/orchestration code.

- [ ] **Step 4: Stop per-channel coordinator setup**

In `crates/slei-daemon/src/api/channels.rs`, update `run_channel_setup`:

```rust
match state.members().ensure_global_channel_coordinator_agent("local-node").await {
    Ok(coordinator) => channel_create_log(
        &idempotency_key,
        "global-coordinator-ready",
        &format!("coordinator_id={}", coordinator.id),
    ),
    Err(error) => channel_create_log(
        &idempotency_key,
        "global-coordinator-failed",
        &format!("channel_id={} error={error}", channel.id),
    ),
}
```

Remove the call that adds the coordinator to the channel.

In `crates/slei-daemon/src/api/members.rs`, change `ensure_channel_coordinators` so it only calls `ensure_global_channel_coordinator_agent("local-node")` once and does not iterate channels or add coordinator members.

In `crates/slei-daemon/src/services/channel_orchestrator_service.rs`, remove the special `input.channel_id == "all"` block that ensures and joins the `all` coordinator. Instead call:

```rust
self.members.ensure_global_channel_coordinator_agent("local-node").await?;
```

Do not add it to channel membership.

- [ ] **Step 5: Use global coordinator id for runtime sessions**

In `crates/slei-daemon/src/services/coordinator_service.rs`, update `start_runtime_run`:

```rust
agent_id: GLOBAL_COORDINATOR_AGENT_ID.to_string(),
```

Expected worker `session_id` can remain `session_{run_id}`.

- [ ] **Step 6: Filter prompt roster and include descriptions**

In `ChannelOrchestratorService::prompt_members`:

```rust
channel_members
    .iter()
    .filter_map(|member| {
        let agent = product_agents.get(&member.agent_id)?;
        if is_internal_coordinator(&agent.id, &agent.agent_kind) {
            return None;
        }
        Some(CoordinatorPromptMember {
            agent_id: agent.id.clone(),
            name: agent.name.clone(),
            handle: agent.handle.clone(),
            agent_kind: agent.agent_kind.clone(),
            readiness: readiness_label(&member.readiness).to_string(),
            description: agent.description.clone(),
        })
    })
    .collect()
```

If a member has no product Agent record, keep the existing fallback only for non-coordinator ids and set `description: "channel member".to_string()`.

- [ ] **Step 7: Update existing tests for new prompt member shape**

Update all `CoordinatorPromptMember` literals in daemon tests to include `description`.

- [ ] **Step 8: Verify daemon coordinator tests**

Run:

```bash
cargo test -p slei-daemon channel_coordinator
cargo test -p slei-daemon creating_channel_ensures_global_coordinator_without_channel_coordinator_member
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add crates/slei-daemon/src/services/member_service.rs \
  crates/slei-daemon/src/api/members.rs \
  crates/slei-daemon/src/api/channels.rs \
  crates/slei-daemon/src/services/channel_orchestrator_service.rs \
  crates/slei-daemon/src/services/coordinator_service.rs \
  crates/slei-daemon/tests/channel_orchestration_flow.rs \
  crates/slei-daemon/tests/channel_coordinator.rs
git commit -m "feat: use one global channel coordinator"
```

## Task 3: Add Channel Member Add/Remove Service And API

**Files:**
- Modify: `crates/slei-daemon/src/services/channel_service.rs`
- Modify: `crates/slei-daemon/src/api/channels.rs`
- Modify: `crates/slei-daemon/src/app.rs`
- Test: `crates/slei-daemon/tests/channel_members.rs`

- [ ] **Step 1: Write failing API tests for add/remove member**

Create `crates/slei-daemon/tests/channel_members.rs`:

```rust
use axum::body::{to_bytes, Body};
use axum::http::{Request, StatusCode};
use serde_json::{json, Value};
use slei_daemon::app::build_router;
use slei_daemon::auth::AuthToken;
use slei_daemon::services::channel_service::{ChannelDraft, PermissionPreset};
use slei_daemon::services::member_service::{ProductAgentDraft, ProductAgentRecord};
use slei_daemon::state::AppState;
use tower::ServiceExt;

#[tokio::test]
async fn channel_member_add_and_remove_manage_existing_agents_only() {
    let token = AuthToken::from_static("test-token");
    let state = AppState::for_tests(token.clone());
    state
        .channels()
        .create_channel(
            ChannelDraft {
                name: "members-dev".to_string(),
                description: None,
                permission: PermissionPreset::Controlled,
            },
            "create-members-dev",
        )
        .await
        .unwrap();
    let alice = state
        .members()
        .create_product_agent(
            ProductAgentDraft {
                name: "Alice".to_string(),
                handle: "@alice".to_string(),
                runtime_kind: "ClaudeCode".to_string(),
                model: "Sonnet".to_string(),
                node_id: "local-node".to_string(),
                description: "Architecture Agent".to_string(),
            },
            "agent-alice",
        )
        .await
        .unwrap();

    let router = build_router(state.clone());
    let add_response = router
        .clone()
        .oneshot(authorized_json_request(
            &token,
            "POST",
            "/v1/channels/members-dev/members",
            "add-alice-to-members-dev",
            json!({ "agentId": alice.id }),
        ))
        .await
        .unwrap();

    assert_eq!(add_response.status(), StatusCode::OK);
    let add_body = response_json(add_response).await;
    assert_eq!(add_body["member"]["agentId"], alice.id);
    assert_eq!(add_body["member"]["readiness"], "joining");

    let remove_response = router
        .oneshot(authorized_empty_request(
            &token,
            "DELETE",
            &format!("/v1/channels/members-dev/members/{}", alice.id),
            "remove-alice-from-members-dev",
        ))
        .await
        .unwrap();

    assert_eq!(remove_response.status(), StatusCode::OK);
    let members = state.channels().channel_members("members-dev").await.unwrap();
    assert!(!members.iter().any(|member| member.agent_id == alice.id));
}

#[tokio::test]
async fn channel_member_add_rejects_global_coordinator() {
    let token = AuthToken::from_static("test-token");
    let state = AppState::for_tests(token.clone());
    state
        .channels()
        .create_channel(
            ChannelDraft {
                name: "reject-coordinator".to_string(),
                description: None,
                permission: PermissionPreset::Controlled,
            },
            "create-reject-coordinator",
        )
        .await
        .unwrap();
    state
        .members()
        .ensure_global_channel_coordinator_agent("local-node")
        .await
        .unwrap();

    let response = build_router(state)
        .oneshot(authorized_json_request(
            &token,
            "POST",
            "/v1/channels/reject-coordinator/members",
            "add-global-coordinator",
            json!({ "agentId": "agent_global_coordinator" }),
        ))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
}
```

Add local helpers `authorized_json_request`, `authorized_empty_request`, and `response_json` by copying the style from nearby daemon API tests. Create one `AuthToken::from_static("test-token")`, pass `token.clone()` into `AppState::for_tests(token.clone())`, and use `token.authorization_header()` for every request helper call in that test.

- [ ] **Step 2: Run failing tests**

Run:

```bash
cargo test -p slei-daemon --test channel_members
```

Expected: FAIL because routes and service removal do not exist yet.

- [ ] **Step 3: Add remove method to ChannelService**

In `crates/slei-daemon/src/services/channel_service.rs`, implement:

```rust
pub async fn remove_agent_from_channel(
    &self,
    channel_id: &str,
    agent_id: &str,
) -> Result<ChannelMemberRecord, ChannelError> {
    let mut state = self.inner.lock().await;
    if !state.channels.contains_key(channel_id) {
        return Err(ChannelError::MissingChannel);
    }
    let members = state
        .members
        .get_mut(channel_id)
        .ok_or(ChannelError::MissingMember)?;
    let index = members
        .iter()
        .position(|member| member.agent_id == agent_id)
        .ok_or(ChannelError::MissingMember)?;
    let removed = members.remove(index);
    persist_members(&self.root, &state.members)?;
    Ok(removed)
}
```

Keep `remove_agent_from_all_channels` unchanged.

- [ ] **Step 4: Add API request/response handlers**

In `crates/slei-daemon/src/api/channels.rs`:

```rust
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddChannelMemberRequest {
    agent_id: String,
}
```

Add:

```rust
pub async fn add_member(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
    Json(payload): Json<AddChannelMemberRequest>,
) -> Response {
    if !state.auth_token.is_authorized(&headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let Some(idempotency_key) = headers
        .get("idempotency-key")
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "idempotency-key is required" })),
        ).into_response();
    };
    let agent = match state.members().get_product_agent(&payload.agent_id).await {
        Ok(agent) => agent,
        Err(error) => return error_response(StatusCode::BAD_REQUEST, &error.to_string()),
    };
    if is_internal_coordinator(&agent.id, &agent.agent_kind) {
        return error_response(StatusCode::BAD_REQUEST, "coordinator agents cannot join channels");
    }
    match state.channels().add_agent_to_channel_with_outcome(&id, &agent.id).await {
        Ok(outcome) => {
            if outcome.created {
                state.memory_events().request_channel_join_update(&agent.id, &id).await;
            }
            Json(json!({ "member": outcome.member })).into_response()
        }
        Err(error) => channel_error_response(error),
    }
}

pub async fn remove_member(
    State(state): State<AppState>,
    Path((id, agent_id)): Path<(String, String)>,
    headers: HeaderMap,
) -> Response {
    if !state.auth_token.is_authorized(&headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let agent = match state.members().get_product_agent(&agent_id).await {
        Ok(agent) => agent,
        Err(error) => return error_response(StatusCode::BAD_REQUEST, &error.to_string()),
    };
    if is_internal_coordinator(&agent.id, &agent.agent_kind) {
        return error_response(StatusCode::BAD_REQUEST, "coordinator agents cannot be removed from channels");
    }
    match state.channels().remove_agent_from_channel(&id, &agent_id).await {
        Ok(_) => match state.channels().channel_members(&id).await {
            Ok(members) => Json(json!({ "removedAgentId": agent_id, "members": members })).into_response(),
            Err(error) => channel_error_response(error),
        },
        Err(error) => channel_error_response(error),
    }
}
```

Behavior:

- Require auth.
- For add, require non-empty idempotency key like channel create.
- Validate `state.members().get_product_agent(&payload.agent_id).await`.
- Reject coordinator Agents with the shared daemon helper.
- Add member through `add_agent_to_channel_with_outcome`.
- If `outcome.created`, request a memory update event for that member. The full memory/report orchestration replaces this direct path in Task 4.
- Return `Json(json!({ "member": outcome.member }))`.
- For remove, validate target Agent exists and is ordinary.
- Remove through `remove_agent_from_channel`.
- Return `Json(json!({ "removedAgentId": agent_id, "members": state.channels().channel_members(&id).await? }))`.

- [ ] **Step 5: Register routes**

In `crates/slei-daemon/src/app.rs`, change:

```rust
.route("/v1/channels/{id}/members", get(api::channels::members))
```

to:

```rust
.route(
    "/v1/channels/{id}/members",
    get(api::channels::members).post(api::channels::add_member),
)
.route(
    "/v1/channels/{id}/members/{agent_id}",
    axum::routing::delete(api::channels::remove_member),
)
```

Import `delete` from `axum::routing`.

- [ ] **Step 6: Run channel member API tests**

Run:

```bash
cargo test -p slei-daemon --test channel_members
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add crates/slei-daemon/src/services/channel_service.rs \
  crates/slei-daemon/src/api/channels.rs \
  crates/slei-daemon/src/app.rs \
  crates/slei-daemon/tests/channel_members.rs
git commit -m "feat: add channel member management API"
```

## Task 4: Run Membership Memory Updates And Agent-Authored Join Reports

**Files:**
- Create: `crates/slei-daemon/src/services/channel_join_report_service.rs`
- Modify: `crates/slei-daemon/src/services/memory_maintainer_service.rs`
- Modify: `crates/slei-daemon/src/services/message_service.rs`
- Modify: `crates/slei-daemon/src/services/mod.rs`
- Modify: `crates/slei-daemon/src/api/channels.rs`
- Modify: `crates/slei-daemon/src/state.rs`
- Test: `crates/slei-daemon/tests/channel_members.rs`
- Test: `crates/slei-daemon/tests/agent_workspace.rs`

- [ ] **Step 1: Write failing service test for add-member memory and Agent run**

Add to `crates/slei-daemon/tests/channel_members.rs`:

```rust
#[tokio::test]
async fn added_member_memory_update_starts_agent_authored_join_report_run() {
    let state = app_state_with_ready_agent("agent_alice", "@alice").await;
    state
        .channels()
        .create_channel(
            ChannelDraft {
                name: "join-report".to_string(),
                description: None,
                permission: PermissionPreset::Controlled,
            },
            "create-join-report",
        )
        .await
        .unwrap();

    state
        .add_channel_member_and_sync("join-report", "agent_alice", "add-alice-join-report")
        .await
        .unwrap();

    let members = state.channels().channel_members("join-report").await.unwrap();
    assert_eq!(members[0].readiness, ChannelMemberReadiness::Ready);

    let commands = state.worker_commands();
    let start_run = commands
        .iter()
        .find(|command| command["type"] == "start_run" && command["session"]["agent_id"] == "agent_alice")
        .expect("join report should start an Agent worker run");
    assert!(start_run["input"]["prompt"]
        .as_str()
        .unwrap()
        .contains("请在频道 #join-report 发一条简短报道"));

    let run_id = start_run["run_id"].as_str().unwrap();
    state
        .handle_worker_event(json!({
            "type": "output_delta",
            "run_id": run_id,
            "delta": "大家好，我是 Alice，负责架构判断。"
        }))
        .await
        .unwrap();
    state
        .handle_worker_event(json!({
            "type": "completed",
            "run_id": run_id
        }))
        .await
        .unwrap();

    let messages = state.channel_messages_for_tests("join-report").await;
    assert!(messages.iter().any(|message| {
        message.kind == MessageKind::Agent
            && message.author_id == "agent_alice"
            && message.body.as_deref() == Some("大家好，我是 Alice，负责架构判断。")
    }));
}
```

Use helper naming that matches the final state method. This should fail before the method and join-report service exist.

- [ ] **Step 2: Write failing tests for remove-member memory, failure state, and idempotency**

Add remove-member coverage:

```rust
#[tokio::test]
async fn removed_member_and_remaining_members_memory_update_without_visible_report() {
    let state = app_state_with_agent_handles(&[
        ("agent_alice", "@alice"),
        ("agent_coda", "@coda"),
    ]).await;
    state
        .channels()
        .create_channel(
            ChannelDraft {
                name: "remove-memory".to_string(),
                description: None,
                permission: PermissionPreset::Controlled,
            },
            "create-remove-memory",
        )
        .await
        .unwrap();
    for agent_id in ["agent_alice", "agent_coda"] {
        state
            .channels()
            .add_agent_to_channel("remove-memory", agent_id)
            .await
            .unwrap();
        state
            .channels()
            .set_member_readiness("remove-memory", agent_id, ChannelMemberReadiness::Ready)
            .await
            .unwrap();
    }

    state
        .remove_channel_member_and_sync("remove-memory", "agent_coda")
        .await
        .unwrap();

    let members = state.channels().channel_members("remove-memory").await.unwrap();
    assert!(!members.iter().any(|member| member.agent_id == "agent_coda"));

    let messages = state.channel_messages_for_tests("remove-memory").await;
    assert!(messages.is_empty());

    let coda_events = state.memory_events().events_for_agent("agent_coda").await;
    assert!(coda_events.iter().any(|event| event.event_type == "memory_updated"));
    let alice_events = state.memory_events().events_for_agent("agent_alice").await;
    assert!(alice_events.iter().any(|event| event.event_type == "memory_updated"));
}
```

Add best-effort removal memory-failure coverage:

```rust
#[tokio::test]
async fn removed_member_memory_failure_keeps_membership_removed_and_records_diagnostic() {
    let state = app_state_with_agent_handles(&[
        ("agent_alice", "@alice"),
        ("agent_coda", "@coda"),
    ]).await;
    state
        .channels()
        .create_channel(
            ChannelDraft {
                name: "remove-memory-fails".to_string(),
                description: None,
                permission: PermissionPreset::Controlled,
            },
            "create-remove-memory-fails",
        )
        .await
        .unwrap();
    for agent_id in ["agent_alice", "agent_coda"] {
        state
            .channels()
            .add_agent_to_channel("remove-memory-fails", agent_id)
            .await
            .unwrap();
    }

    let coda = state.members().get_product_agent("agent_coda").await.unwrap();
    let memory_path = std::path::PathBuf::from(&coda.memory_path);
    let original_permissions = std::fs::metadata(&memory_path).unwrap().permissions();
    let mut readonly_permissions = original_permissions.clone();
    readonly_permissions.set_readonly(true);
    std::fs::set_permissions(&memory_path, readonly_permissions).unwrap();

    state
        .remove_channel_member_and_sync("remove-memory-fails", "agent_coda")
        .await
        .unwrap();
    std::fs::set_permissions(&memory_path, original_permissions).unwrap();

    let members = state.channels().channel_members("remove-memory-fails").await.unwrap();
    assert!(!members.iter().any(|member| member.agent_id == "agent_coda"));

    let diagnostics = state.orchestration().recent_diagnostic_events(20).await.unwrap();
    assert!(diagnostics.iter().any(|event| {
        event.event_type == "channel_member_removed_memory_update_failed"
            && event.payload.contains("agent_id=agent_coda")
            && event.payload.contains("channel_id=remove-memory-fails")
    }));
}
```

Add memory-failure coverage:

```rust
#[tokio::test]
async fn added_member_memory_failure_marks_member_failed_and_suppresses_join_report() {
    let state = app_state_with_ready_agent("agent_alice", "@alice").await;
    let agent = state.members().get_product_agent("agent_alice").await.unwrap();
    let memory_path = std::path::PathBuf::from(&agent.memory_path);
    let original_permissions = std::fs::metadata(&memory_path).unwrap().permissions();
    let mut readonly_permissions = original_permissions.clone();
    readonly_permissions.set_readonly(true);
    std::fs::set_permissions(&memory_path, readonly_permissions).unwrap();

    state
        .channels()
        .create_channel(
            ChannelDraft {
                name: "memory-fails".to_string(),
                description: None,
                permission: PermissionPreset::Controlled,
            },
            "create-memory-fails",
        )
        .await
        .unwrap();

    let result = state
        .add_channel_member_and_sync("memory-fails", "agent_alice", "add-alice-memory-fails")
        .await;
    std::fs::set_permissions(&memory_path, original_permissions).unwrap();

    assert!(matches!(result, Err(ChannelMemberSyncError::Memory(_))));

    let members = state.channels().channel_members("memory-fails").await.unwrap();
    assert_eq!(members[0].readiness, ChannelMemberReadiness::MemoryFailed);
    assert!(state.worker_commands().iter().all(|command| command["type"] != "start_run"));
}
```

Add join-report idempotency coverage:

```rust
#[tokio::test]
async fn join_report_completion_is_idempotent_for_channel_and_agent() {
    let state = app_state_with_ready_agent("agent_alice", "@alice").await;
    state
        .channels()
        .create_channel(
            ChannelDraft {
                name: "join-idempotent".to_string(),
                description: None,
                permission: PermissionPreset::Controlled,
            },
            "create-join-idempotent",
        )
        .await
        .unwrap();
    state
        .add_channel_member_and_sync("join-idempotent", "agent_alice", "add-alice-idempotent")
        .await
        .unwrap();

    let run_id = state.worker_commands()[0]["run_id"].as_str().unwrap().to_string();
    let event = json!({
        "type": "output_delta",
        "run_id": run_id,
        "delta": "我已加入频道。"
    });
    state.handle_worker_event(event.clone()).await.unwrap();
    state
        .handle_worker_event(json!({ "type": "completed", "run_id": run_id }))
        .await
        .unwrap();
    state
        .handle_worker_event(json!({ "type": "completed", "run_id": run_id }))
        .await
        .unwrap();

    let reports = state
        .channel_messages_for_tests("join-idempotent")
        .await
        .into_iter()
        .filter(|message| message.author_id == "agent_alice" && message.kind == MessageKind::Agent)
        .collect::<Vec<_>>();
    assert_eq!(reports.len(), 1);
}
```

Add join-report runtime failure diagnostic coverage:

```rust
#[tokio::test]
async fn join_report_failed_worker_event_records_diagnostic_without_changing_readiness() {
    let state = app_state_with_ready_agent("agent_alice", "@alice").await;
    state
        .channels()
        .create_channel(
            ChannelDraft {
                name: "join-failed".to_string(),
                description: None,
                permission: PermissionPreset::Controlled,
            },
            "create-join-failed",
        )
        .await
        .unwrap();
    state
        .add_channel_member_and_sync("join-failed", "agent_alice", "add-alice-join-failed")
        .await
        .unwrap();

    let run_id = state.worker_commands()[0]["run_id"].as_str().unwrap().to_string();
    state
        .handle_worker_event(json!({
            "type": "failed",
            "run_id": run_id,
            "message": "runtime unavailable"
        }))
        .await
        .unwrap();

    let members = state.channels().channel_members("join-failed").await.unwrap();
    assert_eq!(members[0].readiness, ChannelMemberReadiness::Ready);

    let diagnostics = state.orchestration().recent_diagnostic_events(20).await.unwrap();
    assert!(diagnostics.iter().any(|event| {
        event.event_type == "channel_join_report_failed"
            && event.payload.contains("agent_id=agent_alice")
            && event.payload.contains("channel_id=join-failed")
    }));
}
```

- [ ] **Step 3: Run failing tests**

Run:

```bash
cargo test -p slei-daemon --test channel_members added_member_memory_update_starts_agent_authored_join_report_run
cargo test -p slei-daemon --test channel_members removed_member_and_remaining_members_memory_update_without_visible_report
cargo test -p slei-daemon --test channel_members removed_member_memory_failure_keeps_membership_removed_and_records_diagnostic
cargo test -p slei-daemon --test channel_members added_member_memory_failure_marks_member_failed_and_suppresses_join_report
cargo test -p slei-daemon --test channel_members join_report_completion_is_idempotent_for_channel_and_agent
cargo test -p slei-daemon --test channel_members join_report_failed_worker_event_records_diagnostic_without_changing_readiness
```

Expected: FAIL because orchestration helpers do not exist.

- [ ] **Step 4: Add targeted memory-maintainer methods**

In `crates/slei-daemon/src/services/memory_maintainer_service.rs`:

1. Add a public method for one current member:

```rust
pub async fn run_channel_member_update(
    &self,
    channel_id: &str,
    agent_id: &str,
) -> Result<(), MemoryMaintainerError> {
    self.memory_events.start_update(agent_id, channel_id).await;
    self.channels
        .set_member_readiness(channel_id, agent_id, ChannelMemberReadiness::MemorySyncing)
        .await?;
    if let Err(error) = self.update_agent_channel_notes(agent_id, channel_id).await {
        self.memory_events.fail_update(agent_id, channel_id).await;
        self.channels
            .set_member_readiness(channel_id, agent_id, ChannelMemberReadiness::MemoryFailed)
            .await?;
        return Err(error);
    }
    self.memory_events.complete_update(agent_id, channel_id).await;
    self.channels
        .set_member_readiness(channel_id, agent_id, ChannelMemberReadiness::Ready)
        .await?;
    Ok(())
}
```

2. Add a method for removed member memory that does not call `set_member_readiness` because the Agent is no longer in the channel:

```rust
pub async fn run_removed_channel_member_update(
    &self,
    channel_id: &str,
    agent_id: &str,
) -> Result<(), MemoryMaintainerError> {
    self.memory_events.start_update(agent_id, channel_id).await;
    match self.update_agent_channel_notes(agent_id, channel_id).await {
        Ok(()) => {
            self.memory_events.complete_update(agent_id, channel_id).await;
            Ok(())
        }
        Err(error) => {
            self.memory_events.fail_update(agent_id, channel_id).await;
            Err(error)
        }
    }
}
```

3. Ensure `write_channel_notes` writes the current roster from `ChannelService`, so after removal the removed Agent sees a roster without itself. Also add a clear note if the Agent is no longer a member:

```rust
let membership_state = if members.iter().any(|member| member.agent_id == agent_id) {
    "active"
} else {
    "removed"
};
```

Change `write_channel_notes(&path, channel_id)` to `write_channel_notes(&path, agent_id, channel_id)` so it can write the membership state explicitly.

- [ ] **Step 5: Add concrete idempotent join-report message creation**

In `crates/slei-daemon/src/services/message_service.rs`, extend `MessageState`:

```rust
join_report_idempotency: HashMap<String, String>,
```

Then add:

```rust
pub async fn create_join_report_message(
    &self,
    channel_id: &str,
    agent_id: &str,
    idempotency_key: &str,
    body: &str,
) -> Result<MessageRecord, MessageError> {
    if channel_id.trim().is_empty()
        || agent_id.trim().is_empty()
        || idempotency_key.trim().is_empty()
        || body.trim().is_empty()
    {
        return Err(MessageError::InvalidMessage);
    }
    let mut state = self.inner.lock().expect("message state lock");
    if let Some(message_id) = state.join_report_idempotency.get(idempotency_key) {
        return state
            .messages
            .get(message_id)
            .cloned()
            .ok_or(MessageError::MessageNotFound);
    }
    let message = build_message(channel_id, agent_id, Some(body.trim()), MessageKind::Agent);
    state
        .join_report_idempotency
        .insert(idempotency_key.to_string(), message.id.clone());
    state.messages.insert(message.id.clone(), message.clone());
    state.event_payloads.push(format!("message.created:{}", message.id));
    self.persist_messages(&state);
    Ok(message)
}
```

Use the existing private `build_message` helper if available; otherwise use the same message construction pattern as `insert_channel_message`. Do not prefix the visible body with an idempotency marker.

- [ ] **Step 6: Create ChannelJoinReportService**

Create `crates/slei-daemon/src/services/channel_join_report_service.rs`:

```rust
use std::collections::HashMap;
use std::sync::Arc;

use serde_json::{json, Value};
use tokio::sync::Mutex;
use uuid::Uuid;

use crate::adapters::claude_worker::{ClaudeWorkerAdapter, CreateSessionRequest};
use crate::services::member_service::{MemberError, MemberService};
use crate::services::message_service::{MessageError, MessageService};
use crate::services::orchestration_store::OrchestrationStore;

#[derive(Clone, Debug)]
pub struct ChannelJoinReportService {
    members: MemberService,
    messages: MessageService,
    orchestration: OrchestrationStore,
    worker: ClaudeWorkerAdapter,
    runs: Arc<Mutex<HashMap<String, JoinReportRun>>>,
}

#[derive(Clone, Debug)]
struct JoinReportRun {
    channel_id: String,
    agent_id: String,
    idempotency_key: String,
    output: String,
}

impl ChannelJoinReportService {
    pub fn new(
        members: MemberService,
        messages: MessageService,
        orchestration: OrchestrationStore,
        worker: ClaudeWorkerAdapter,
    ) -> Self {
        Self {
            members,
            messages,
            orchestration,
            worker,
            runs: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub async fn start_join_report(
        &self,
        channel_id: &str,
        agent_id: &str,
        idempotency_key: &str,
    ) -> Result<String, ChannelJoinReportError> {
        let agent = self.members.get_product_agent(agent_id).await?;
        let run_id = format!("join_report_{}", Uuid::new_v4().simple());
        let session = self.worker.create_session(CreateSessionRequest {
            agent_id: agent.id.clone(),
            cwd: agent.workspace_path.clone(),
            session_id: format!("session_{run_id}"),
            resume_session: false,
        })?;
        let prompt = format!(
            "请在频道 #{channel_id} 发一条简短报道。介绍你是谁、负责什么、什么时候适合 @ 你。不要承诺开始任何未被要求的任务。只输出要发送到频道的一条消息。"
        );
        self.worker.start_run(&run_id, &session, &prompt, vec![json!({
            "type": "channel_join_report",
            "channelId": channel_id,
            "agentId": agent_id,
        })])?;
        self.runs.lock().await.insert(run_id.clone(), JoinReportRun {
            channel_id: channel_id.to_string(),
            agent_id: agent_id.to_string(),
            idempotency_key: idempotency_key.to_string(),
            output: String::new(),
        });
        Ok(run_id)
    }

    pub async fn handle_worker_event(&self, event: Value) -> Result<bool, ChannelJoinReportError> {
        let Some(run_id) = event.get("run_id").and_then(Value::as_str) else {
            return Ok(false);
        };
        let mut runs = self.runs.lock().await;
        let Some(record) = runs.get_mut(run_id) else {
            return Ok(false);
        };
        match event.get("type").and_then(Value::as_str) {
            Some("output_delta") => {
                record.output.push_str(event.get("delta").and_then(Value::as_str).unwrap_or_default());
                Ok(true)
            }
            Some("completed") => {
                let record = runs.remove(run_id).expect("run exists");
                let body = record.output.trim();
                if !body.is_empty() {
                    self.messages
                        .create_join_report_message(
                            &record.channel_id,
                            &record.agent_id,
                            &record.idempotency_key,
                            body,
                        )
                        .await?;
                }
                Ok(true)
            }
            Some("failed") => {
                let record = runs.remove(run_id).expect("run exists");
                let reason = event
                    .get("message")
                    .or_else(|| event.get("error"))
                    .and_then(Value::as_str)
                    .unwrap_or("Agent join report run failed");
                let _ = self
                    .orchestration
                    .record_diagnostic_event(
                        "channel_join_report_failed",
                        &format!(
                            "run_id={} channel_id={} agent_id={} reason={}",
                            run_id, record.channel_id, record.agent_id, reason
                        ),
                    )
                    .await;
                Ok(true)
            }
            _ => Ok(true),
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum ChannelJoinReportError {
    #[error(transparent)]
    Member(#[from] MemberError),
    #[error(transparent)]
    Message(#[from] MessageError),
    #[error(transparent)]
    Worker(#[from] crate::adapters::claude_worker::ClaudeWorkerError),
    #[error(transparent)]
    Diagnostic(#[from] sqlx::Error),
}
```

Export it in `crates/slei-daemon/src/services/mod.rs`:

```rust
pub mod channel_join_report_service;
```

- [ ] **Step 7: Add AppState orchestration helpers**

In `crates/slei-daemon/src/state.rs`, add:

```rust
#[derive(Debug, thiserror::Error)]
pub enum ChannelMemberSyncError {
    #[error(transparent)]
    Channel(#[from] crate::services::channel_service::ChannelError),
    #[error(transparent)]
    Memory(#[from] MemoryMaintainerError),
}

pub async fn add_channel_member_and_sync(
    &self,
    channel_id: &str,
    agent_id: &str,
    idempotency_key: &str,
) -> Result<crate::services::channel_service::ChannelMemberRecord, ChannelMemberSyncError> {
    let outcome = self
        .channels()
        .add_agent_to_channel_with_outcome(channel_id, agent_id)
        .await?;
    if outcome.created {
        self.memory_events()
            .request_channel_join_update(agent_id, channel_id)
            .await;
        self.memory_maintainer()
            .run_channel_member_update(channel_id, agent_id)
            .await?;
        if let Err(error) = self.channel_join_reports()
            .start_join_report(
                channel_id,
                agent_id,
                &format!("channel-join-report:{channel_id}:{agent_id}:{idempotency_key}"),
            )
            .await
        {
            tracing::warn!(
                channel_id,
                agent_id,
                error = %error,
                "failed to start channel join report after member memory sync"
            );
            let _ = self
                .orchestration()
                .record_diagnostic_event(
                    "channel_join_report_failed",
                    &format!(
                        "channel_id={} agent_id={} phase=start error={}",
                        channel_id, agent_id, error
                    ),
                )
                .await;
        }
    }
    Ok(outcome.member)
}
```

Do not include `ChannelJoinReportError` in `ChannelMemberSyncError`: a join report failure happens after the add and memory update have succeeded, so the API should still return success and leave readiness as `Ready`.

Also add:

```rust
pub async fn remove_channel_member_and_sync(
    &self,
    channel_id: &str,
    agent_id: &str,
) -> Result<(), ChannelMemberSyncError> {
    self.channels().remove_agent_from_channel(channel_id, agent_id).await?;
    if let Err(error) = self.memory_maintainer()
        .run_removed_channel_member_update(channel_id, agent_id)
        .await
    {
        let _ = self
            .orchestration()
            .record_diagnostic_event(
                "channel_member_removed_memory_update_failed",
                &format!("channel_id={} agent_id={} error={}", channel_id, agent_id, error),
            )
            .await;
    }
    let remaining = self.channels().channel_members(channel_id).await?;
    for member in remaining {
        if !self.members().is_coordinator_agent(&member.agent_id).await {
            if let Err(error) = self
                .memory_maintainer()
                .run_channel_member_update(channel_id, &member.agent_id)
                .await
            {
                let _ = self
                    .orchestration()
                    .record_diagnostic_event(
                        "channel_member_remaining_memory_update_failed",
                        &format!(
                            "channel_id={} agent_id={} error={}",
                            channel_id, member.agent_id, error
                        ),
                    )
                    .await;
            }
        }
    }
    Ok(())
}
```

Both removed-member and remaining-member memory updates are best-effort after membership deletion. Do not return an API error once `remove_agent_from_channel` succeeds; record diagnostics and keep the membership removal committed.

Also:

```rust
pub fn channel_join_reports(&self) -> &ChannelJoinReportService {
    &self.channel_join_report_service
}
```

Initialize the service in `AppState::with_agent_root_and_store` with cloned `MemberService`, `MessageService`, `OrchestrationStore`, and `ClaudeWorkerAdapter::new(self.worker_transport.clone())` following the existing `CoordinatorService` and `AgentDmService` patterns.

- [ ] **Step 8: Dispatch join-report worker events**

In `AppState::handle_worker_event`, dispatch in this order:

```rust
if self
    .channel_orchestrator()
    .handle_coordinator_worker_event(event.clone())
    .await
    .map_err(|error| error.to_string())?
{
    return Ok(());
}
if self
    .channel_join_reports()
    .handle_worker_event(event.clone())
    .await
    .map_err(|error| error.to_string())?
{
    return Ok(());
}
self.agent_dm()
    .handle_worker_event(event)
    .await
    .map_err(|error| error.to_string())
```

- [ ] **Step 9: Wire API handlers to orchestration helpers**

In `crates/slei-daemon/src/api/channels.rs`:

- In `add_member`, replace direct channel add with `state.add_channel_member_and_sync(&id, &payload.agent_id, idempotency_key).await`.
- In `remove_member`, replace direct channel remove with `state.remove_channel_member_and_sync(&id, &agent_id).await`.
- Map `ChannelMemberSyncError` to response status. Use 400 for invalid/coordinator/member errors, 404 for missing channel/member, 500 for IO/worker errors.
- Do not expose `ChannelJoinReportError` from the add route. `add_channel_member_and_sync` logs and records diagnostic events for join-report startup failures, then still returns the added member once memory sync succeeds.
- Do not expose removed-member or remaining-member memory update failures from the remove route. `remove_channel_member_and_sync` records diagnostics and returns success after the channel membership is removed.

- [ ] **Step 10: Verify membership memory tests**

Run:

```bash
cargo test -p slei-daemon --test channel_members
```

Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add crates/slei-daemon/src/services/channel_join_report_service.rs \
  crates/slei-daemon/src/services/mod.rs \
  crates/slei-daemon/src/services/memory_maintainer_service.rs \
  crates/slei-daemon/src/services/message_service.rs \
  crates/slei-daemon/src/api/channels.rs \
  crates/slei-daemon/src/state.rs \
  crates/slei-daemon/tests/channel_members.rs \
  crates/slei-daemon/tests/agent_workspace.rs
git commit -m "feat: sync channel member memory updates"
```

## Task 5: Add Protocol, Tauri, And Desktop Bridge Methods

**Files:**
- Modify: `packages/protocol-client/src/contracts.ts`
- Modify: `apps/desktop/src/lib/daemon-bridge.ts`
- Modify: `apps/desktop/src-tauri/src/daemon_broker.rs`
- Modify: `apps/desktop/src-tauri/src/commands.rs`
- Modify: `apps/desktop/src-tauri/src/lib.rs`
- Test: `apps/desktop/src-tauri/src/lib.rs`
- Test: `apps/desktop/e2e/channel-members.spec.tsx`

- [ ] **Step 1: Write failing Tauri broker test for add member route**

In `apps/desktop/src-tauri/src/lib.rs` test module, add a test like the existing `channel_create_command_uses_daemon_route_with_idempotency_key`:

```rust
#[test]
fn channel_member_add_command_uses_daemon_route_with_idempotency_key() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    let handle = thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        let request = read_http_request(&mut stream);
        let response = serde_json::json!({
            "member": {
                "channelId": "dev",
                "agentId": "agent_alice",
                "joinedAt": "2026-06-09T12:00:00Z",
                "readiness": "joining"
            }
        })
        .to_string();
        write_http_json_response(&mut stream, 200, &response);
        request
    });
    let broker = DaemonBroker::for_tests(RuntimeDescriptor {
        endpoint: format!("http://127.0.0.1:{port}"),
        event_socket: "ws://127.0.0.1:4319/v1/events/ws".to_string(),
        token: "secret-token".to_string(),
        daemon_version: "0.1.0".to_string(),
        protocol_version: "v1".to_string(),
    });

    let receipt = add_channel_member(
        &broker,
        "dev",
        ChannelMemberAddRequest {
            agent_id: "agent_alice".to_string(),
        },
    )
    .unwrap();
    let request = handle.join().unwrap();

    assert_eq!(receipt.member.agent_id, "agent_alice");
    assert!(request.contains("POST /v1/channels/dev/members HTTP/1.1"));
    assert!(request.contains("Authorization: Bearer secret-token"));
    assert!(request.contains("Idempotency-Key: desktop-channel-member-add-"));
    assert!(request.contains(r#""agentId":"agent_alice""#));
}
```

If `read_http_request` / `write_http_json_response` helpers do not exist, extract them from existing repeated test code in this same test module as part of this task.

- [ ] **Step 2: Write failing Tauri broker test for remove member route**

Add:

```rust
#[test]
fn channel_member_remove_command_uses_daemon_route() {
    // Same local listener pattern.
    // Assert request contains:
    // DELETE /v1/channels/dev/members/agent_alice HTTP/1.1
    // Authorization: Bearer secret-token
}
```

- [ ] **Step 3: Run failing Tauri tests**

Run:

```bash
pnpm --filter @slei/desktop test -- src-tauri
```

If this repo does not run Rust tests through pnpm for Tauri, run:

```bash
cargo test -p slei-desktop channel_member
```

Expected: FAIL because commands and broker methods do not exist.

- [ ] **Step 4: Add protocol TypeScript types**

In `packages/protocol-client/src/contracts.ts`:

```ts
export interface ChannelMemberAddRequest {
  agentId: string;
}

export interface ChannelMemberAddReceipt {
  member: ChannelMemberView;
}

export interface ChannelMemberRemoveReceipt {
  removedAgentId: string;
  members: ChannelMemberView[];
}
```

- [ ] **Step 5: Add desktop bridge methods and mock behavior**

In `apps/desktop/src/lib/daemon-bridge.ts`:

1. Import new protocol types.
2. Add to `DaemonBridge`:

```ts
addChannelMember(channelId: string, request: ChannelMemberAddRequest): Promise<ChannelMemberAddReceipt>;
removeChannelMember(channelId: string, agentId: string): Promise<ChannelMemberRemoveReceipt>;
```

3. In `createDaemonBridgeMock`, implement:

```ts
async addChannelMember(channelId, request) {
  const channel = channels.find((candidate) => candidate.id === channelId);
  if (!channel) throw new Error("channel not found");
  const agent = agents.find((candidate) => candidate.id === request.agentId && !isBridgeCoordinatorAgent(candidate));
  if (!agent) throw new Error("agent not found");
  const existing = channelMembers.find((member) => member.channelId === channelId && member.agentId === request.agentId);
  if (existing) return { member: existing };
  const member = {
    channelId,
    agentId: request.agentId,
    joinedAt: new Date().toISOString(),
    readiness: "joining" as const,
  };
  channelMembers = [...channelMembers, member];
  channelMessages = [
    ...channelMessages,
    {
      id: `join-report-${channelId}-${request.agentId}`,
      channelId,
      authorId: request.agentId,
      body: `大家好，我是 ${agent.name}，已加入 #${channel.name}。`,
      kind: "agent",
      deleted: false,
      edited: false,
    },
  ];
  return { member };
}
```

Use a deterministic `join-report-${channelId}-${agentId}` id in the mock. Do not use `Date.now()` for the message id.

4. Add `removeChannelMember` mock that removes membership only and does not delete `agents`.

5. Add Tauri invoke methods:

```ts
addChannelMember: (channelId, request) => invoke("add_channel_member_command", { channelId, request }),
removeChannelMember: (channelId, agentId) => invoke("remove_channel_member_command", { channelId, agentId }),
```

- [ ] **Step 6: Add Tauri Rust request/receipt structs and broker methods**

In `apps/desktop/src-tauri/src/daemon_broker.rs`:

```rust
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelMemberAddRequest {
    pub agent_id: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelMemberAddReceipt {
    pub member: ChannelMemberView,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelMemberRemoveReceipt {
    pub removed_agent_id: String,
    pub members: Vec<ChannelMemberView>,
}
```

Add public broker methods:

```rust
pub fn add_channel_member(
    &self,
    channel_id: &str,
    request: ChannelMemberAddRequest,
) -> Result<ChannelMemberAddReceipt, ChannelError> {
    let payload = serde_json::to_string(&request)
        .map_err(|error| ChannelError::DaemonRequest(format!("serialize channel member add request failed: {error}")))?;
    let idempotency_key = format!("desktop-channel-member-add-{}-{}", channel_id, request.agent_id);
    let response = self
        .send_daemon_request_checked(
            "POST",
            &format!("/v1/channels/{channel_id}/members"),
            Some(&payload),
            &[("Idempotency-Key", idempotency_key.as_str())],
        )
        .map_err(ChannelError::DaemonRequest)?;
    serde_json::from_str(&response)
        .map_err(|error| ChannelError::DaemonRequest(format!("daemon response invalid: {error}")))
}

pub fn remove_channel_member(
    &self,
    channel_id: &str,
    agent_id: &str,
) -> Result<ChannelMemberRemoveReceipt, ChannelError> {
    let response = self
        .send_daemon_request_checked(
            "DELETE",
            &format!("/v1/channels/{channel_id}/members/{agent_id}"),
            None,
            &[],
        )
        .map_err(ChannelError::DaemonRequest)?;
    serde_json::from_str(&response)
        .map_err(|error| ChannelError::DaemonRequest(format!("daemon response invalid: {error}")))
}
```

Use `send_daemon_request_checked`. For add, send `Idempotency-Key: desktop-channel-member-add-{channel_id}-{agent_id}`. For remove, use `DELETE` and no body.

- [ ] **Step 7: Add Tauri commands and registration**

In `apps/desktop/src-tauri/src/commands.rs`:

```rust
pub fn add_channel_member_command(
    state: tauri::State<'_, DaemonBroker>,
    channel_id: String,
    request: ChannelMemberAddRequest,
) -> Result<ChannelMemberAddReceipt, String> {
    add_channel_member(state.inner(), &channel_id, request).map_err(|error| error.to_string())
}

pub fn remove_channel_member_command(
    state: tauri::State<'_, DaemonBroker>,
    channel_id: String,
    agent_id: String,
) -> Result<ChannelMemberRemoveReceipt, String> {
    remove_channel_member(state.inner(), &channel_id, &agent_id).map_err(|error| error.to_string())
}
```

In `apps/desktop/src-tauri/src/lib.rs`, add both commands to `generate_handler!`.

- [ ] **Step 8: Verify bridge tests**

Run:

```bash
cargo test -p slei-desktop channel_member
pnpm --filter @slei/desktop typecheck
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/protocol-client/src/contracts.ts \
  apps/desktop/src/lib/daemon-bridge.ts \
  apps/desktop/src-tauri/src/daemon_broker.rs \
  apps/desktop/src-tauri/src/commands.rs \
  apps/desktop/src-tauri/src/lib.rs
git commit -m "feat: bridge channel member API"
```

## Task 6: Add Desktop Coordinator Filtering Helpers

**Files:**
- Modify: `apps/desktop/src/app/model.ts`
- Modify: `apps/desktop/src/app/SleiApp.tsx`
- Modify: `apps/desktop/src/app/SleiAppFrame.tsx`
- Modify: `apps/desktop/src/features/members/MembersPageView.tsx`
- Modify: `apps/desktop/src/lib/daemon-bridge.ts`
- Test: `apps/desktop/e2e/chat-channel-mentions.spec.tsx`
- Test: `apps/desktop/e2e/chinese-members.spec.tsx`

- [ ] **Step 1: Write failing tests for global coordinator filtering in chat and members**

Add to `apps/desktop/e2e/chat-channel-mentions.spec.tsx`:

```tsx
it("excludes the global coordinator from mention suggestions", () => {
  const data = createSleiFixtures({
    members: [
      ...createDemoMembers(),
      {
        ...createDemoMembers()[0],
        id: "agent_global_coordinator",
        name: "Global Coordinator",
        handle: "@coordinator",
        role: "频道协调员",
        type: "agent",
        directMessageEnabled: false,
        systemOwned: true,
      },
    ],
  });

  const html = renderToStaticMarkup(
    <SleiAppFrame activeView="chat" data={data} initialChatDraft="@" locale="zh-CN" runtimeSetup={readyRuntime} />,
  );

  expect(html).not.toContain("@coordinator");
});
```

Add a helper-level test if `mentionSuggestions` is already tested directly:

```ts
expect(mentionSuggestions("", members).map((member) => member.id)).not.toContain("agent_global_coordinator");
```

Add to `apps/desktop/e2e/chinese-members.spec.tsx`:

```tsx
it("hides internal coordinators from the members page", () => {
  const members = [
    ...createDemoMembers(),
    {
      ...createDemoMembers()[0],
      id: "agent_global_coordinator",
      name: "Global Coordinator",
      handle: "@coordinator",
      role: "频道协调员",
      type: "agent",
      directMessageEnabled: false,
      systemOwned: true,
    },
    {
      ...createDemoMembers()[1],
      id: "agent_coordinator_all",
      name: "All Coordinator",
      handle: "@all-coordinator",
      role: "频道协调员",
      type: "agent",
      directMessageEnabled: false,
      systemOwned: true,
    },
  ];

  const html = renderToStaticMarkup(
    <SleiAppFrame
      activeView="members"
      data={createSleiFixtures({ members })}
      locale="zh-CN"
      runtimeSetup={readyRuntime}
    />,
  );

  expect(html).not.toContain("@coordinator");
  expect(html).not.toContain("@all-coordinator");
  expect(html).not.toContain("Global Coordinator");
  expect(html).not.toContain("All Coordinator");
});
```

- [ ] **Step 2: Run failing test**

Run:

```bash
pnpm --filter @slei/desktop test -- chat-channel-mentions.spec.tsx
pnpm --filter @slei/desktop test -- chinese-members.spec.tsx
```

Expected: FAIL because only `agent_coordinator_` prefix is filtered today.

- [ ] **Step 3: Add desktop filtering helpers**

In `apps/desktop/src/app/model.ts`:

```ts
export function isCoordinatorMember(member: Pick<SleiMember, "id" | "role" | "directMessageEnabled" | "systemOwned"> & { agentKind?: string }): boolean {
  return member.id === "agent_global_coordinator"
    || member.id.startsWith("agent_coordinator_")
    || member.agentKind === "coordinator"
    || (member.systemOwned === true && member.directMessageEnabled === false && /协调员|coordinator/i.test(member.role));
}

export function isOrdinaryAgentMember(member: SleiMember): boolean {
  return member.type === "agent" && !isCoordinatorMember(member);
}
```

If `SleiMember` does not expose `agentKind`, either add it in `fixtures.ts` or rely on `id/systemOwned/directMessageEnabled/role` for now. Prefer adding `agentKind?: string` to `SleiMember` to match `DesktopAgentView`.

- [ ] **Step 4: Replace scattered coordinator checks in desktop code**

Update:

- `mentionSuggestions` in `apps/desktop/src/app/model.ts`
- direct-message filters in `apps/desktop/src/app/SleiAppFrame.tsx`
- create-channel agent selector in `SleiAppFrame.tsx`
- agent activity filters in `SleiAppFrame.tsx`
- agent mapping in `apps/desktop/src/app/SleiApp.tsx` where `directMessageEnabled` is assigned
- member list/detail filtering in `apps/desktop/src/features/members/MembersPageView.tsx`; import `isCoordinatorMember`, compute `const visibleMembers = input.data.members.filter((member) => !isCoordinatorMember(member))`, select from `visibleMembers`, and render the navigator from `visibleMembers`. If `input.activeMemberId` points to a hidden coordinator, fall back to the first visible member so the detail pane never renders an internal coordinator.
- any mock Agent/member data in `apps/desktop/src/lib/daemon-bridge.ts` that includes coordinator Agents

Use `isOrdinaryAgentMember` where a user-selectable Agent is needed.

- [ ] **Step 5: Verify filtering tests**

Run:

```bash
pnpm --filter @slei/desktop test -- chat-channel-mentions.spec.tsx
pnpm --filter @slei/desktop test -- chinese-members.spec.tsx
pnpm --filter @slei/desktop typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/app/model.ts \
  apps/desktop/src/app/fixtures.ts \
  apps/desktop/src/app/SleiApp.tsx \
  apps/desktop/src/app/SleiAppFrame.tsx \
  apps/desktop/src/features/members/MembersPageView.tsx \
  apps/desktop/src/lib/daemon-bridge.ts \
  apps/desktop/e2e/chat-channel-mentions.spec.tsx \
  apps/desktop/e2e/chinese-members.spec.tsx
git commit -m "feat: filter global coordinator from desktop member surfaces"
```

## Task 7: Wire Desktop State Handlers For Channel Members

**Files:**
- Modify: `apps/desktop/src/app/SleiApp.tsx`
- Modify: `apps/desktop/src/app/SleiAppFrame.tsx`
- Modify: `apps/desktop/src/features/chat/ChatPageView.tsx`
- Test: `apps/desktop/src/app/SleiApp.test.ts`
- Test: `apps/desktop/e2e/channel-members.spec.tsx`

- [ ] **Step 1: Write failing state test for add/remove handler shape**

If `SleiApp.test.ts` can exercise handlers through rendered output, add tests there. Otherwise create `apps/desktop/e2e/channel-members.spec.tsx` and render `SleiAppFrame` with mock handlers.

Start with a presentational test:

```tsx
it("renders channel member list collapsed by default and toggles from the header", () => {
  const data = createSleiFixtures({
    channels: [{ id: "dev", name: "dev", description: "Dev", unread: 0 }],
    members: createDemoMembers().map((member) => ({
      ...member,
      channelReadiness: { dev: "ready" },
    })),
  });

  const html = renderToStaticMarkup(
    <SleiAppFrame activeChannelId="dev" activeView="chat" data={data} locale="zh-CN" runtimeSetup={readyRuntime} />,
  );

  expect(html).toContain("data-slot=\"channel-member-toggle\"");
  expect(html).toContain("data-channel-members-collapsed=\"true\"");
});
```

This will fail until UI props/markup exist.

- [ ] **Step 2: Run failing desktop test**

Run:

```bash
pnpm --filter @slei/desktop test -- channel-members.spec.tsx
```

Expected: FAIL.

- [ ] **Step 3: Add handler props through frame and route**

In `apps/desktop/src/features/chat/ChatPageView.tsx`, extend `ChatPage` props:

```ts
onChannelMemberAdd?: (channelId: string, agentId: string) => Promise<void> | void;
onChannelMemberRemove?: (channelId: string, agentId: string) => Promise<void> | void;
```

In `apps/desktop/src/app/SleiAppFrame.tsx`, thread these props through `renderWorkspace` and `ChatRoute`.

- [ ] **Step 4: Implement SleiApp handlers**

In `apps/desktop/src/app/SleiApp.tsx`, add:

```ts
async function handleChannelMemberAdd(channelId: string, agentId: string) {
  await bridge.addChannelMember(channelId, { agentId });
  await refreshChannelMembers(channelId);
  await refreshChannelMessages(channelId);
}

async function handleChannelMemberRemove(channelId: string, agentId: string) {
  await bridge.removeChannelMember(channelId, agentId);
  await refreshChannelMembers(channelId);
  await refreshChannelMessages(channelId);
}
```

If `refreshChannelMembers` does not exist as a standalone helper yet, extract it from existing member/channel refresh logic. It should update `data.members[*].channelReadiness[channelId]` from `bridge.listChannelMembers(channelId)`.

Important: when mapping `ChannelMemberView` to `SleiMember.channelReadiness`, do not add a coordinator as a visible member.

- [ ] **Step 5: Pass handlers into frame**

In the `SleiAppFrame` call inside `SleiApp.tsx`, pass:

```tsx
onChannelMemberAdd={handleChannelMemberAdd}
onChannelMemberRemove={handleChannelMemberRemove}
```

- [ ] **Step 6: Verify tests**

Run:

```bash
pnpm --filter @slei/desktop test -- channel-members.spec.tsx
pnpm --filter @slei/desktop typecheck
```

Expected: PASS or remaining failures only for UI not implemented yet. If failures are for missing UI elements, continue to Task 8 before committing.

- [ ] **Step 7: Commit if handlers are independently passing**

```bash
git add apps/desktop/src/app/SleiApp.tsx \
  apps/desktop/src/app/SleiAppFrame.tsx \
  apps/desktop/src/features/chat/ChatPageView.tsx \
  apps/desktop/e2e/channel-members.spec.tsx
git commit -m "feat: wire channel member state handlers"
```

If the tests are intentionally completed in Task 8, delay this commit and include these files in Task 8's commit.

## Task 8: Build Right-Side Channel Member List

**Files:**
- Modify: `apps/desktop/src/features/chat/ChatPageView.tsx`
- Modify: `apps/desktop/src/i18n/types.ts`
- Modify: `apps/desktop/src/i18n/messages/zh-CN/chat.ts`
- Modify: `apps/desktop/src/i18n/messages/en-US/chat.ts`
- Test: `apps/desktop/e2e/channel-members.spec.tsx`

- [ ] **Step 1: Write failing UI tests for member panel behavior**

In `apps/desktop/e2e/channel-members.spec.tsx`, add:

```tsx
it("right channel member list excludes coordinators and lists current channel members", () => {
  const members = [
    { ...createDemoMembers()[0], id: "agent_alice", handle: "@alice", channelReadiness: { dev: "ready" } },
    {
      ...createDemoMembers()[1],
      id: "agent_global_coordinator",
      name: "Global Coordinator",
      handle: "@coordinator",
      role: "频道协调员",
      systemOwned: true,
      directMessageEnabled: false,
      channelReadiness: { dev: "ready" },
    },
  ];
  const html = renderToStaticMarkup(
    <SleiAppFrame
      activeChannelId="dev"
      activeView="chat"
      data={createSleiFixtures({
        channels: [{ id: "dev", name: "dev", description: "Dev", unread: 0 }],
        members,
      })}
      initialChannelMembersOpen
      locale="zh-CN"
      runtimeSetup={readyRuntime}
    />,
  );

  expect(html).toContain("data-slot=\"channel-member-list\"");
  expect(html).toContain("@alice");
  expect(html).not.toContain("@coordinator");
});
```

Add a test for add picker:

```tsx
expect(html).toContain("添加成员");
expect(html).toContain("data-slot=\"channel-member-add-picker\"");
```

Use actual message strings from i18n once added. Because the member panel is collapsed by default, make this assertion in the SSR case that passes `initialChannelMembersOpen`, or in a focused rendered interaction test after clicking the header member toggle; do not expect the add picker markup in the default collapsed HTML.

- [ ] **Step 2: Run failing UI tests**

Run:

```bash
pnpm --filter @slei/desktop test -- channel-members.spec.tsx
```

Expected: FAIL.

- [ ] **Step 3: Add i18n strings**

In `apps/desktop/src/i18n/types.ts`, extend `chat` messages with:

```ts
members: string;
showMembers: string;
hideMembers: string;
addMember: string;
removeMember: (name: string) => string;
removeMemberDescription: (name: string) => string;
confirmRemoveMember: string;
noChannelMembers: string;
availableMembers: string;
noAvailableMembers: string;
```

Add Chinese and English translations in:

- `apps/desktop/src/i18n/messages/zh-CN/chat.ts`
- `apps/desktop/src/i18n/messages/en-US/chat.ts`

- [ ] **Step 4: Add member panel state and layout**

In `ChatPageView.tsx`:

1. Import icons:

```ts
import { Users, UserPlus, Trash2 } from "lucide-react";
```

2. Add state:

```ts
const [membersOpen, setMembersOpen] = useState(initialChannelMembersOpen ?? false);
```

Add `initialChannelMembersOpen?: boolean` to props for SSR/e2e tests.
Also add `initialChannelMembersOpen?: boolean` to the `SleiAppFrame` and `ChatRoute` props and pass it through to `ChatPageView`; the `SleiAppFrame` SSR tests use this prop to render the member panel open without simulating a click.

3. Compute active channel ordinary members:

```ts
const channelMembers = data.members.filter(
  (member) => isOrdinaryAgentMember(member) && member.channelReadiness?.[activeChannel.id],
);
const availableMembers = data.members.filter(
  (member) => isOrdinaryAgentMember(member) && !member.channelReadiness?.[activeChannel.id],
);
```

4. Change root layout for channel chat:

```tsx
<section
  className="grid h-full min-h-0 bg-background"
  data-channel-members-collapsed={membersOpen ? "false" : "true"}
  data-slot="chat-page"
>
  <div className={cn("grid min-h-0", membersOpen && !dmMember ? "grid-cols-[minmax(0,1fr)_18rem]" : "grid-cols-1")}>
    <div className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)_auto]">
      existing header/timeline/composer
    </div>
    {membersOpen && !dmMember ? (
      <ChannelMemberPanel
        activeChannel={activeChannel}
        availableMembers={availableMembers}
        members={channelMembers}
        messages={messages}
        onAdd={onChannelMemberAdd}
        onRemove={onChannelMemberRemove}
      />
    ) : null}
  </div>
</section>
```

Keep stable dimensions and avoid nested cards. Use a bordered aside, not a card inside a card.

- [ ] **Step 5: Add header toggle button**

In the channel header action area, next to tabs:

```tsx
<Button
  aria-label={membersOpen ? messages.chat.hideMembers : messages.chat.showMembers}
  aria-pressed={membersOpen ? "true" : "false"}
  data-slot="channel-member-toggle"
  onClick={() => setMembersOpen((open) => !open)}
  size="icon-sm"
  type="button"
  variant={membersOpen ? "secondary" : "ghost"}
>
  <Users aria-hidden="true" size={16} />
</Button>
```

Do not show this button in DM conversations.

- [ ] **Step 6: Implement ChannelMemberPanel**

Add a local component in `ChatPageView.tsx`:

```tsx
function ChannelMemberPanel(input: {
  activeChannel: SleiFixtures["channels"][number];
  availableMembers: SleiMember[];
  members: SleiMember[];
  messages: DesktopMessages;
  onAdd?: (channelId: string, agentId: string) => Promise<void> | void;
  onRemove?: (channelId: string, agentId: string) => Promise<void> | void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pendingAgentId, setPendingAgentId] = useState<string | undefined>();

  return (
    <aside className="grid min-h-0 grid-rows-[auto_auto_minmax(0,1fr)] border-l bg-sidebar/50" data-slot="channel-member-list">
      <header className="flex items-center justify-between border-b px-3 py-2">
        <strong className="text-sm">{input.messages.chat.members}</strong>
        <Button aria-label={input.messages.chat.addMember} onClick={() => setPickerOpen((open) => !open)} size="icon-xs" type="button" variant="ghost">
          <UserPlus aria-hidden="true" size={14} />
        </Button>
      </header>
      {pickerOpen ? (
        <div className="border-b p-2" data-slot="channel-member-add-picker">
          {input.availableMembers.length === 0 ? (
            <p className="rounded-md border border-dashed p-2 text-xs text-muted-foreground">{input.messages.chat.noAvailableMembers}</p>
          ) : input.availableMembers.map((member) => (
            <Button className="h-auto w-full justify-start px-2 py-2 text-left" key={member.id} onClick={() => input.onAdd?.(input.activeChannel.id, member.id)} type="button" variant="ghost">
              <MemberAvatar identity={member} />
              <span className="grid min-w-0">
                <strong className="truncate text-sm">{member.name}</strong>
                <small className="truncate text-xs text-muted-foreground">{member.handle}</small>
              </span>
            </Button>
          ))}
        </div>
      ) : null}
      <ScrollArea className="min-h-0">
        <div className="grid gap-1 p-2">
          {input.members.length === 0 ? (
            <p className="rounded-md border border-dashed p-2 text-xs text-muted-foreground">{input.messages.chat.noChannelMembers}</p>
          ) : input.members.map((member) => (
            <ChannelMemberRow
              channelId={input.activeChannel.id}
              key={member.id}
              member={member}
              messages={input.messages}
              onRemove={input.onRemove}
            />
          ))}
        </div>
      </ScrollArea>
    </aside>
  );
}
```

Keep controls compact:

- Header: title and add button.
- Add picker: a small bordered list under the header when open.
- Member list: `ScrollArea`.
- Each member row: `group relative flex items-center gap-2 pr-9`.
- Delete button: `absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 text-destructive`.

Use `Badge` for readiness. Use `MemberAvatar`.

- [ ] **Step 7: Add remove confirmation popover**

Use the repo's existing UI primitives. If no popover component exists, use `AlertDialog` for member removal rather than adding a new dependency. The spec asked for a popover; if implementing a small local confirmation popover is straightforward, create a focused component in `ChatPageView.tsx` using absolute positioning and a `button` trigger. Avoid a new global UI component unless needed elsewhere.

The delete button should not call remove directly. The confirm action calls:

```ts
await input.onRemove?.(input.activeChannel.id, member.id);
```

Confirmation copy must say the Agent itself will not be deleted and memory will be updated.

- [ ] **Step 8: Verify channel member UI tests**

Run:

```bash
pnpm --filter @slei/desktop test -- channel-members.spec.tsx
pnpm --filter @slei/desktop test -- chat-channel-mentions.spec.tsx
pnpm --filter @slei/desktop typecheck
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/desktop/src/features/chat/ChatPageView.tsx \
  apps/desktop/src/i18n/types.ts \
  apps/desktop/src/i18n/messages/zh-CN/chat.ts \
  apps/desktop/src/i18n/messages/en-US/chat.ts \
  apps/desktop/e2e/channel-members.spec.tsx
git commit -m "feat: add channel member sidebar"
```

## Task 9: Fix Channel Sidebar Delete Hover And Confirmation

**Files:**
- Modify: `apps/desktop/src/app/SleiAppFrame.tsx`
- Test: `apps/desktop/e2e/chat-channel-mentions.spec.tsx`

- [ ] **Step 1: Write failing test for sidebar delete affordance**

In `apps/desktop/e2e/chat-channel-mentions.spec.tsx`, add:

```tsx
it("renders channel delete as hidden red row action with confirmation", () => {
  const html = renderToStaticMarkup(
    <SleiAppFrame
      activeChannelId="dev-team"
      activeView="chat"
      data={createSleiFixtures({
        channels: [
          { id: "all", name: "all", description: "默认频道", unread: 0 },
          { id: "dev-team", name: "dev-team", description: "研发频道", unread: 0, projectName: "kol-content" },
        ],
        members: createDemoMembers(),
      })}
      locale="zh-CN"
      runtimeSetup={readyRuntime}
    />,
  );

  expect(html).toContain("data-slot=\"channel-delete-action\"");
  expect(html).toContain("text-destructive");
  expect(html).toContain("data-slot=\"channel-delete-confirm\"");
});
```

- [ ] **Step 2: Run failing test**

Run:

```bash
pnpm --filter @slei/desktop test -- chat-channel-mentions.spec.tsx
```

Expected: FAIL because the current delete button is always present beside the row and has no confirmation.

- [ ] **Step 3: Update channel row layout**

In `ChannelList` inside `apps/desktop/src/app/SleiAppFrame.tsx`:

1. Change row wrapper to:

```tsx
<div className="group relative flex items-stretch" key={channel.id}>
```

2. Make the channel button reserve right padding for the delete action:

```tsx
className={cn(
  "h-auto min-h-12 w-full justify-start whitespace-normal px-2 py-2 pr-10 text-left",
  input.activeChannelId === channel.id && "bg-accent text-accent-foreground",
)}
```

3. Move delete action inside the row and align it:

```tsx
<Button
  aria-label={input.messages.chat.deleteChannel(stripChannelHash(channel.name))}
  className="absolute right-2 top-1/2 -translate-y-1/2 text-destructive opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
  data-slot="channel-delete-action"
  size="icon-xs"
  type="button"
  variant="ghost"
>
  <Trash2 aria-hidden="true" size={14} />
</Button>
```

- [ ] **Step 4: Add confirmation interaction**

Use `AlertDialog` if already imported in `SleiAppFrame.tsx`, or import it from local UI:

```tsx
<AlertDialog>
  <AlertDialogTrigger asChild>{deleteButton}</AlertDialogTrigger>
  <AlertDialogContent data-slot="channel-delete-confirm">
    <AlertDialogHeader>
      <AlertDialogTitle>{input.messages.chat.deleteChannel(stripChannelHash(channel.name))}</AlertDialogTitle>
      <AlertDialogDescription>
        {input.messages.chat.deleteChannelDescription?.(stripChannelHash(channel.name))
          ?? input.messages.chat.deleteChannel(stripChannelHash(channel.name))}
      </AlertDialogDescription>
    </AlertDialogHeader>
    <AlertDialogFooter>
      <AlertDialogCancel>{input.messages.common.cancel}</AlertDialogCancel>
      <AlertDialogAction onClick={() => input.onChannelDelete?.(channel.id)} variant="destructive">
        {input.messages.common.delete}
      </AlertDialogAction>
    </AlertDialogFooter>
  </AlertDialogContent>
</AlertDialog>
```

If the codebase has a popover primitive by implementation time, prefer a confirmation popover. Do not delete on first click.

- [ ] **Step 5: Verify sidebar tests**

Run:

```bash
pnpm --filter @slei/desktop test -- chat-channel-mentions.spec.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/app/SleiAppFrame.tsx \
  apps/desktop/e2e/chat-channel-mentions.spec.tsx
git commit -m "fix: confirm destructive channel row actions"
```

## Task 10: End-To-End Verification And Cleanup

**Files:**
- Review all changed files.
- No new files unless tests reveal a missing focused helper.

- [ ] **Step 1: Run daemon targeted tests**

Run:

```bash
cargo test -p slei-daemon channel
cargo test -p slei-daemon coordinator
cargo test -p slei-daemon --test channel_members
```

Expected: PASS.

- [ ] **Step 2: Run desktop targeted tests**

Run:

```bash
pnpm --filter @slei/desktop test -- channel-members.spec.tsx
pnpm --filter @slei/desktop test -- chat-channel-mentions.spec.tsx
```

Expected: PASS.

- [ ] **Step 3: Run type checks and lint**

Run:

```bash
pnpm --filter @slei/desktop typecheck
pnpm --filter @slei/desktop lint
pnpm --filter @slei/desktop test
```

Expected: PASS.

- [ ] **Step 4: Run broader Rust tests if time allows**

Run:

```bash
cargo test -p slei-daemon
cargo test -p slei-desktop
```

Expected: PASS.

- [ ] **Step 5: Manual UI smoke test**

Start the app:

```bash
pnpm --filter @slei/desktop desktop
```

Verify:

- Chat member list is collapsed by default.
- Header member button expands/collapses the right member list.
- Global and legacy coordinators are absent from member list, add picker, mentions, and DM list.
- Add member updates the member list and shows a join report once refreshed.
- Remove member asks for confirmation and does not delete the Agent.
- Channel row delete action appears only on hover/focus, is red, vertically centered, far right, and asks for confirmation.

- [ ] **Step 6: Final git check**

Run:

```bash
git status --short
git log --oneline -10
```

Expected: working tree clean except intentional uncommitted files if the implementer is stopping mid-task.

- [ ] **Step 7: Ask merge question**

After implementation and verification, ask the user whether to merge into `master` or another branch, per `/Users/leelei/Documents/Slei` instructions.
