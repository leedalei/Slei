# Channel Members Global Coordinator Reconciled Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace legacy per-channel coordinator behavior with one hidden global coordinator, then add API-backed channel member add/remove flows and the desktop channel member panel.

**Architecture:** Treat the current code as a partial legacy implementation: channel membership, readiness, memory events, coordinator JSON routing, and task writeback already exist. This plan first reconciles conflicting coordinator identity behavior, then adds missing member mutation APIs, bridge methods, state wiring, and UI. Every task keeps compatibility with existing on-disk legacy `agent_coordinator_*` records while excluding all coordinators from user-facing and routable member lists.

**Tech Stack:** Rust daemon and Tauri broker, Axum routes, TypeScript protocol client, React desktop app, Vitest/SSR tests, Rust integration tests.

---

## Reality Check

The unchecked items in `docs/superpowers/plans/2026-06-09-channel-members-global-coordinator.md` are mostly not implemented. Some underlying capabilities exist from earlier work, but several new requirements conflict with the current implementation and must be migrated intentionally.

| Area | Current implementation | Status | Conflict / reuse note |
| --- | --- | --- | --- |
| Coordinator identity | `MemberService::ensure_channel_coordinator_agent(channel_id, ...)` creates `agent_coordinator_<channel>`; channel creation calls it in `run_channel_setup`. | Conflict | New spec requires one `agent_global_coordinator`; keep legacy records compatible but stop creating/depending on them. |
| Coordinator worker session | `CoordinatorService::start_runtime_run` uses `agent_coordinator_{channel_id}` as worker `agent_id`. | Conflict | Must use `agent_global_coordinator` while still including channel id/name in prompt context. |
| Coordinator target validation | Validator rejects `agentKind == "coordinator"` and ids matching `agent_coordinator_*`. | Partial reuse | Extend through a shared helper that also rejects `agent_global_coordinator`. |
| Channel member listing | Daemon exposes only `GET /v1/channels/{id}/members`. | Partial reuse | Existing list endpoint can stay; add POST/DELETE mutation endpoints. |
| Add member service | `ChannelService::add_agent_to_channel_with_outcome` exists and sets new members to `joining`. | Partial reuse | Add API orchestration, coordinator rejection, memory update, and join report behavior. |
| Remove member service | Only `remove_agent_from_all_channels(agent_id)` exists for agent deletion. | Not done | Add single-channel remove without deleting Agent. |
| Memory update | Channel creation requests memory update for initial members; `MemoryMaintainerService` can process joining members. | Partial reuse | Add targeted add/remove memory flows and idempotency/failure tests. |
| Join report | No channel-member join report service exists. | Not done | Add Agent-authored report run/message after memory success. |
| Tauri/desktop bridge | Bridge has `listChannelMembers` only. | Not done | Add add/remove request and receipt structs, Tauri commands, mock behavior, and TypeScript methods. |
| Desktop coordinator filtering | `memberFromAgentView` disables DMs for `agentKind === "coordinator"` only. | Partial/conflict | Add shared helper; exclude coordinators from members page, mentions, channel panel, and DM lists. |
| Right channel member panel | No `ChannelMemberPanel` or add/remove UI. | Not done | Build collapsed-by-default panel in Chat route/view. |
| Channel sidebar delete | Button calls delete immediately, uses opacity, no confirmation popover. | Conflict | Replace with hover/focus red icon plus confirmation popover. |

## Files

### Daemon

- Modify: `crates/slei-daemon/src/services/member_service.rs`
- Modify: `crates/slei-daemon/src/services/channel_service.rs`
- Modify: `crates/slei-daemon/src/services/coordinator_service.rs`
- Modify: `crates/slei-daemon/src/services/channel_orchestrator_service.rs`
- Modify: `crates/slei-daemon/src/services/memory_maintainer_service.rs`
- Create: `crates/slei-daemon/src/services/channel_join_report_service.rs`
- Modify: `crates/slei-daemon/src/services/mod.rs`
- Modify: `crates/slei-daemon/src/state.rs`
- Modify: `crates/slei-daemon/src/api/channels.rs`
- Modify: `crates/slei-daemon/src/app.rs`
- Test: `crates/slei-daemon/tests/channel_members_global_coordinator.rs`
- Test: `crates/slei-daemon/tests/channel_orchestration_flow.rs`

### Tauri And Protocol

- Modify: `packages/protocol-client/src/contracts.ts`
- Modify: `packages/protocol-client/src/contracts.test.ts`
- Modify: `apps/desktop/src-tauri/src/daemon_broker.rs`
- Modify: `apps/desktop/src-tauri/src/commands.rs`
- Modify: `apps/desktop/src-tauri/src/lib.rs`
- Modify: `apps/desktop/src/lib/daemon-bridge.ts`

### Desktop

- Modify: `apps/desktop/src/app/model.ts`
- Modify: `apps/desktop/src/app/SleiApp.tsx`
- Modify: `apps/desktop/src/app/SleiAppFrame.tsx`
- Modify: `apps/desktop/src/app/routes/ChatRoute.tsx`
- Modify: `apps/desktop/src/features/chat/ChatPageView.tsx`
- Create: `apps/desktop/src/features/chat/ChannelMemberPanel.tsx`
- Modify: `apps/desktop/src/i18n/types.ts`
- Modify: `apps/desktop/src/i18n/messages/en-US/chat.ts`
- Modify: `apps/desktop/src/i18n/messages/zh-CN/chat.ts`
- Test: `apps/desktop/e2e/channel-members-global-coordinator.spec.tsx`
- Test: `apps/desktop/src/app/model.test.ts`
- Test: `apps/desktop/src/features/chat/ChatPageView.test.tsx`

---

## Task 1: Reconcile Coordinator Identity And Filtering

- [ ] **Step 1: Write failing daemon tests**

Add tests in `crates/slei-daemon/tests/channel_members_global_coordinator.rs` proving:

- channel creation does not create a new `agent_coordinator_<channel>` member,
- `agent_global_coordinator` exists or is created once,
- legacy `agent_coordinator_*` and `agent_global_coordinator` are rejected as downstream targets,
- coordinator prompt members include ordinary channel members only.

Run:

```bash
cargo test -p slei-daemon --test channel_members_global_coordinator global_coordinator
```

Expected before implementation: FAIL because current code creates per-channel coordinator agents.

- [ ] **Step 2: Add shared coordinator helper**

Modify `crates/slei-daemon/src/services/member_service.rs`:

- add constant `GLOBAL_COORDINATOR_AGENT_ID: &str = "agent_global_coordinator"`,
- add `pub fn is_internal_coordinator_id(agent_id: &str) -> bool`,
- add `ensure_global_coordinator_agent(node_id)` that creates a system-owned `agentKind: "coordinator"` record once,
- keep `ensure_channel_coordinator_agent` only for legacy compatibility, not new channel setup.

- [ ] **Step 3: Use global coordinator in runtime sessions**

Modify `crates/slei-daemon/src/services/coordinator_service.rs` so `start_runtime_run` uses `agent_global_coordinator` as `CreateSessionRequest.agent_id`.

- [ ] **Step 4: Stop channel setup from creating per-channel coordinators**

Modify `crates/slei-daemon/src/api/channels.rs`:

- remove the `ensure_channel_coordinator_agent` call from `run_channel_setup`,
- ensure app/bootstrap path creates the global coordinator once.

Modify `apps/desktop/src-tauri/src/daemon_broker.rs` similarly:

- replace `ensure_local_channel_coordinators` per-channel behavior with a single local global coordinator,
- do not add the coordinator as a visible channel member.

- [ ] **Step 5: Verify**

Run:

```bash
cargo test -p slei-daemon --test channel_members_global_coordinator
cargo test -p slei-daemon --test channel_orchestration_flow
```

- [ ] **Step 6: Commit**

```bash
git add crates/slei-daemon apps/desktop/src-tauri
git commit -m "feat: use global channel coordinator"
```

## Task 2: Add Channel Member Add/Remove Daemon APIs

- [ ] **Step 1: Write failing API tests**

In `crates/slei-daemon/tests/channel_members_global_coordinator.rs`, add API tests for:

- `POST /v1/channels/{id}/members` adds an ordinary Agent,
- duplicate add is idempotent and returns existing membership,
- adding any coordinator returns `400`,
- `DELETE /v1/channels/{id}/members/{agent_id}` removes from that channel only,
- removing an ordinary Agent does not delete the Agent record.

Run:

```bash
cargo test -p slei-daemon --test channel_members_global_coordinator channel_member_api
```

Expected before implementation: FAIL because routes do not exist.

- [ ] **Step 2: Add single-channel remove service**

Modify `crates/slei-daemon/src/services/channel_service.rs`:

- add `remove_agent_from_channel(channel_id, agent_id) -> Result<Option<ChannelMemberRecord>, ChannelError>`,
- persist `channels/members.json`,
- keep missing member idempotent or return `MissingMember` according to test expectation; prefer idempotent no-op for UI retry safety.

- [ ] **Step 3: Add API request/response handlers**

Modify `crates/slei-daemon/src/api/channels.rs`:

- add `AddChannelMemberRequest { agentId: String }`,
- add `add_member`,
- add `remove_member`,
- validate `state.members().get_product_agent(agent_id)`,
- reject internal coordinators with shared helper,
- return `{ "member": ... }` or `{ "removedMember": ... }`.

Modify `crates/slei-daemon/src/app.rs`:

```rust
.route("/v1/channels/{id}/members", get(api::channels::members).post(api::channels::add_member))
.route("/v1/channels/{id}/members/{agent_id}", delete(api::channels::remove_member))
```

- [ ] **Step 4: Verify**

Run:

```bash
cargo test -p slei-daemon --test channel_members_global_coordinator channel_member_api
```

- [ ] **Step 5: Commit**

```bash
git add crates/slei-daemon/src/api/channels.rs crates/slei-daemon/src/app.rs crates/slei-daemon/src/services/channel_service.rs crates/slei-daemon/tests/channel_members_global_coordinator.rs
git commit -m "feat: add channel member mutation api"
```

## Task 3: Add Memory Updates And Agent Join Reports

- [ ] **Step 1: Write failing service tests**

Add tests proving:

- adding a member requests targeted memory update and moves readiness to `ready` on success,
- memory failure moves readiness to `memory_failed` and does not create a report,
- successful add starts a join-report worker run/message authored by the added Agent,
- removing a member updates removed and remaining member memories without visible report.

Run:

```bash
cargo test -p slei-daemon --test channel_members_global_coordinator membership_memory
```

- [ ] **Step 2: Add targeted memory methods**

Modify `crates/slei-daemon/src/services/memory_maintainer_service.rs`:

- add `sync_added_channel_member(channel_id, agent_id)`,
- add `sync_removed_channel_member(channel_id, removed_agent_id)`,
- reuse existing memory rendering where possible.

- [ ] **Step 3: Add join report service**

Create `crates/slei-daemon/src/services/channel_join_report_service.rs`:

- build a short prompt for the newly added Agent,
- start worker run using that Agent id,
- persist visible Agent message on completion,
- record diagnostic/failure state without rolling back readiness.

- [ ] **Step 4: Wire API handlers**

Modify `crates/slei-daemon/src/api/channels.rs` or `AppState` helpers so add/remove endpoints call the memory/report orchestration after membership mutation.

- [ ] **Step 5: Verify and commit**

Run:

```bash
cargo test -p slei-daemon --test channel_members_global_coordinator membership_memory
cargo test -p slei-daemon --test channel_orchestration_flow
```

Commit:

```bash
git add crates/slei-daemon
git commit -m "feat: sync channel membership memory"
```

## Task 4: Add Protocol, Tauri, And Desktop Bridge Methods

- [ ] **Step 1: Write failing contract and broker tests**

Update:

- `packages/protocol-client/src/contracts.test.ts`
- `apps/desktop/src-tauri/src/daemon_broker.rs` tests

Assert add/remove request and receipt shapes are exported and routed.

- [ ] **Step 2: Add TypeScript contracts**

Modify `packages/protocol-client/src/contracts.ts` and `apps/desktop/src/lib/daemon-bridge.ts`:

- `ChannelMemberAddRequest`,
- `ChannelMemberReceipt`,
- `ChannelMemberRemoveReceipt`,
- bridge methods `addChannelMember(channelId, request)` and `removeChannelMember(channelId, agentId)`.

- [ ] **Step 3: Add Tauri broker and commands**

Modify:

- `apps/desktop/src-tauri/src/daemon_broker.rs`,
- `apps/desktop/src-tauri/src/commands.rs`,
- `apps/desktop/src-tauri/src/lib.rs`.

Include mock/fallback behavior that updates local channel member state and rejects coordinators.

- [ ] **Step 4: Verify and commit**

Run:

```bash
pnpm --filter @slei/protocol-client test
cargo test -p slei-desktop channel_member
pnpm --filter @slei/desktop typecheck
```

Commit:

```bash
git add packages/protocol-client apps/desktop/src-tauri apps/desktop/src/lib/daemon-bridge.ts
git commit -m "feat: bridge channel member mutations"
```

## Task 5: Add Desktop Coordinator Filtering And State Wiring

- [ ] **Step 1: Write failing desktop tests**

Add tests in:

- `apps/desktop/src/app/model.test.ts`,
- `apps/desktop/e2e/channel-members-global-coordinator.spec.tsx`.

Assert coordinators are excluded from member page, DM candidates, mention suggestions, channel member panel, and add-member picker.

- [ ] **Step 2: Add shared desktop helper**

Modify `apps/desktop/src/app/model.ts`:

- add `isInternalCoordinatorMember(memberOrAgent)`,
- treat `agentKind === "coordinator"`, `agent_global_coordinator`, and `agent_coordinator_*` as internal.

- [ ] **Step 3: Replace scattered filters**

Modify:

- `apps/desktop/src/app/SleiApp.tsx`,
- `apps/desktop/src/app/SleiAppFrame.tsx`,
- `apps/desktop/src/features/chat/ChatPageView.tsx`,
- members route inputs if needed.

Keep coordinator records in raw state if received, but exclude from all user-facing member selection and mention surfaces.

- [ ] **Step 4: Add SleiApp handlers**

Modify `apps/desktop/src/app/SleiApp.tsx`:

- load active channel members through `bridge.listChannelMembers`,
- add `handleAddChannelMember`,
- add `handleRemoveChannelMember`,
- refresh member readiness and channel messages after mutation.

- [ ] **Step 5: Verify and commit**

Run:

```bash
pnpm --filter @slei/desktop test -- src/app/model.test.ts e2e/channel-members-global-coordinator.spec.tsx
pnpm --filter @slei/desktop typecheck
```

Commit:

```bash
git add apps/desktop/src/app apps/desktop/e2e/channel-members-global-coordinator.spec.tsx
git commit -m "feat: wire channel member state"
```

## Task 6: Build Channel Member Panel UI

- [ ] **Step 1: Write failing UI tests**

In `apps/desktop/e2e/channel-members-global-coordinator.spec.tsx`, assert:

- chat header has a member-list toggle,
- panel is collapsed by default,
- expanded panel lists ordinary active channel members,
- add picker excludes current members and coordinators,
- remove action asks confirmation and does not delete the Agent itself.

- [ ] **Step 2: Create `ChannelMemberPanel.tsx`**

Create `apps/desktop/src/features/chat/ChannelMemberPanel.tsx`:

- compact right-side panel,
- readiness badges,
- add-member popover/picker,
- remove confirmation popover,
- accessible labels from i18n,
- no nested card layout.

- [ ] **Step 3: Wire into Chat view**

Modify:

- `apps/desktop/src/features/chat/ChatPageView.tsx`,
- `apps/desktop/src/app/routes/ChatRoute.tsx`,
- `apps/desktop/src/app/SleiAppFrame.tsx`.

- [ ] **Step 4: Verify and commit**

Run:

```bash
pnpm --filter @slei/desktop test -- e2e/channel-members-global-coordinator.spec.tsx
pnpm --filter @slei/desktop typecheck
```

Commit:

```bash
git add apps/desktop/src/features/chat apps/desktop/src/app apps/desktop/e2e/channel-members-global-coordinator.spec.tsx apps/desktop/src/i18n
git commit -m "feat: add channel member panel"
```

## Task 7: Fix Channel Sidebar Delete Confirmation

- [ ] **Step 1: Write failing test**

Extend `apps/desktop/e2e/channel-members-global-coordinator.spec.tsx`:

- delete icon is hidden until hover/focus,
- icon is red and aligned to the row right edge,
- clicking opens confirmation,
- channel is deleted only after confirm.

- [ ] **Step 2: Update sidebar row**

Modify `apps/desktop/src/app/SleiAppFrame.tsx`:

- use hover/focus reveal,
- use `Trash2` red destructive styling,
- wrap action in confirmation popover/dialog,
- preserve keyboard access.

- [ ] **Step 3: Verify and commit**

Run:

```bash
pnpm --filter @slei/desktop test -- e2e/channel-members-global-coordinator.spec.tsx
pnpm --filter @slei/desktop typecheck
```

Commit:

```bash
git add apps/desktop/src/app/SleiAppFrame.tsx apps/desktop/e2e/channel-members-global-coordinator.spec.tsx apps/desktop/src/i18n
git commit -m "fix: confirm channel deletion"
```

## Task 8: Final Verification

- [ ] **Step 1: Run focused daemon tests**

```bash
cargo test -p slei-daemon --test channel_members_global_coordinator
cargo test -p slei-daemon --test channel_orchestration_flow
```

- [ ] **Step 2: Run bridge/protocol tests**

```bash
pnpm --filter @slei/protocol-client test
cargo test -p slei-desktop channel_member
```

- [ ] **Step 3: Run desktop tests and typecheck**

```bash
pnpm --filter @slei/desktop test -- e2e/channel-members-global-coordinator.spec.tsx
pnpm --filter @slei/desktop test
pnpm --filter @slei/desktop typecheck
```

- [ ] **Step 4: Check diff hygiene**

```bash
git diff --check
git status --short
```

- [ ] **Step 5: Commit final cleanup if needed**

```bash
git add <changed-files>
git commit -m "test: verify channel members global coordinator"
```

- [ ] **Step 6: Ask merge question**

Per Slei workspace rule, after completion ask whether to merge this work into `master` or another branch.
