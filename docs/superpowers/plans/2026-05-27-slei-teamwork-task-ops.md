# Slei Visible Teamwork And Task Operations Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn conversations into controllable agent teamwork through visible delegation, attention, task oversight, artifacts and capability inspection.

**Architecture:** The daemon recognizes user `@agent` commands and correlated `slei_request_visible_delegation` Worker MCP events, persisting a visible record before a child run can begin; native Claude subagent delegation remains disabled by the runtime gate. UI presents those records instead of synthesizing hidden workflows. Task Board and Files views project the same persisted task/run/artifact data used in threads. Skills/Commands are read-only adapter metadata. This plan covers M07, the user-visible completion of M08, M10 and M11.

**Tech Stack:** Rust services/tests, React, TanStack Query, Zustand, i18next, Vitest, Playwright, Tauri validated open action.

---

## Files Introduced By This Plan

```text
crates/slei-daemon/src/api/{delegations.rs,artifacts.rs,capabilities.rs,notifications.rs}
crates/slei-daemon/src/services/{delegation_service.rs,artifact_service.rs,capability_service.rs,notification_service.rs}
crates/slei-daemon/tests/{delegation_chain.rs,task_board.rs,artifacts.rs,capabilities.rs}
apps/desktop/src/features/tasks/{TasksPage.tsx,BoardView.tsx,ListView.tsx,TaskCard.tsx,TaskFilters.tsx,AttentionBadge.tsx}
apps/desktop/src/features/chat/{DelegationEntry.tsx,ApprovalEntry.tsx,ArtifactChip.tsx,FilesTab.tsx}
apps/desktop/src/features/members/{CapabilitiesPanel.tsx,ActivityPanel.tsx}
apps/desktop/src/features/notifications/{NotificationCenter.tsx}
apps/desktop/e2e/{delegation.spec.ts,tasks.spec.ts,artifacts.spec.ts}
packages/i18n/src/locales/{zh-CN.json,en-US.json}
```

## Task 1: Implement Visible Delegation And Human Attention

**Files:**
- Create: `crates/slei-daemon/src/api/delegations.rs`
- Create: `crates/slei-daemon/src/api/notifications.rs`
- Create: `crates/slei-daemon/src/services/delegation_service.rs`
- Create: `crates/slei-daemon/src/services/notification_service.rs`
- Test: `crates/slei-daemon/tests/delegation_chain.rs`
- Create: `apps/desktop/src/features/chat/DelegationEntry.tsx`
- Create: `apps/desktop/src/features/notifications/NotificationCenter.tsx`
- Test: `apps/desktop/e2e/delegation.spec.ts`

- [ ] **Step 1: Write failing delegation policy tests**

Assert only explicit public user `@agent` or a typed
`slei_request_visible_delegation` event that first publishes an `@agent`
handoff in the Task thread may create child Run and Delegation; ordinary text,
native Claude subagent tools or unregistered MCP cannot run a hidden child.
Reject depth > 5 and reject A -> B -> A by ancestor `agent_id`. Assert typed
human-question/`@human` attention creates notification and no agent Run.

Run: `cargo test -p slei-daemon --test delegation_chain`

Expected: FAIL.

- [ ] **Step 2: Implement delegation/attention services**

Persist parent/child run chain and visible timeline event before executing a
delegated run. Resolve the correlated runtime request only after that visible
record exists. Notification payloads omit command/file-path sensitive detail.
Expose authenticated notification list/read-state commands to support the
Desktop notification center and settings preferences.

- [ ] **Step 3: Write failing UI tests and implement visible entries**

Display handoff chain, user mention badge, pending reply state, and stop action
that cancels active descendant runs.

Run: `pnpm --filter @slei/desktop test:e2e -- delegation.spec.ts`

Expected: FAIL before components; PASS after minimal implementation.

- [ ] **Step 4: Commit**

```bash
git add crates/slei-daemon/src/api/delegations.rs crates/slei-daemon/src/api/notifications.rs crates/slei-daemon/src/services/delegation_service.rs crates/slei-daemon/src/services/notification_service.rs crates/slei-daemon/tests/delegation_chain.rs apps/desktop/src/features/chat apps/desktop/src/features/notifications
git commit -m "feat: add visible delegation and attention"
```

## Task 2: Present Approvals In The Task Workflow

**Files:**
- Modify: `apps/desktop/src/features/chat/ThreadPanel.tsx`
- Create: `apps/desktop/src/features/chat/ApprovalEntry.tsx`
- Modify: `crates/slei-daemon/src/api/approvals.rs`
- Test: `apps/desktop/e2e/delegation.spec.ts`
- Test: `crates/slei-daemon/tests/approval_flow.rs`

- [ ] **Step 1: Write failing approval-context tests**

Assert pending Approval appears in the correct Task thread, includes safe
action context, resolves only by the authenticated human, updates run status
and shows a non-sensitive OS notification. Verify `request_id`, `run_id`,
`tool_use_id` and `agent_id` correlation, decision retry idempotency, and that
controlled workspace execution is disabled before this presentation exists.

Run: `cargo test -p slei-daemon --test approval_flow && pnpm --filter @slei/desktop test:e2e -- delegation.spec.ts`

Expected: FAIL for missing thread presentation.

- [ ] **Step 2: Implement approval entries and attention synchronization**

Use the existing daemon approval state; UI must not infer approval resolution
from agent text. Deny/allow produces persisted outcome and updated task
attention. Passing this UI test switches the feature gate that permits
controlled operations; earlier conversation surfaces support only no-workspace
or read-only runs.

- [ ] **Step 3: Verify and commit**

Run: `cargo test -p slei-daemon --test approval_flow && pnpm --filter @slei/desktop test:e2e -- delegation.spec.ts`

Expected: PASS.

```bash
git add apps/desktop/src/features/chat crates/slei-daemon/src/api/approvals.rs crates/slei-daemon/tests/approval_flow.rs
git commit -m "feat: surface task approval workflow"
```

## Task 3: Implement Global Task Board And List

**Files:**
- Create: `apps/desktop/src/features/tasks/TasksPage.tsx`
- Create: `apps/desktop/src/features/tasks/BoardView.tsx`
- Create: `apps/desktop/src/features/tasks/ListView.tsx`
- Create: `apps/desktop/src/features/tasks/TaskCard.tsx`
- Create: `apps/desktop/src/features/tasks/TaskFilters.tsx`
- Create: `apps/desktop/src/features/tasks/AttentionBadge.tsx`
- Test: `crates/slei-daemon/tests/task_board.rs`
- Test: `apps/desktop/e2e/tasks.spec.ts`

- [ ] **Step 1: Write failing task query and UI tests**

Assert cross-channel query filters by Channel/creator/assignee; Board contains
`Todo`, `In Progress`, `In Review`, `Done`, `Closed`; List renders same
records; status update is reflected in Chat card and Thread; attention is
separate from status.

Run: `cargo test -p slei-daemon --test task_board && pnpm --filter @slei/desktop test:e2e -- tasks.spec.ts`

Expected: FAIL.

- [ ] **Step 2: Implement daemon queries/status commands and board UI**

Board drag/drop is optional for MVP; status action buttons are sufficient if
fully accessible and persisted.

- [ ] **Step 3: Verify and commit**

Run: `cargo test -p slei-daemon --test task_board && pnpm --filter @slei/desktop test:e2e -- tasks.spec.ts`

Expected: PASS.

```bash
git add apps/desktop/src/features/tasks crates/slei-daemon/tests/task_board.rs crates/slei-daemon/src
git commit -m "feat: add task board and list"
```

## Task 4: Implement Artifact Files Views And Safe Open

**Files:**
- Create: `crates/slei-daemon/src/api/artifacts.rs`
- Modify: `crates/slei-daemon/src/services/artifact_service.rs`
- Test: `crates/slei-daemon/tests/artifacts.rs`
- Create: `apps/desktop/src/features/chat/ArtifactChip.tsx`
- Create: `apps/desktop/src/features/chat/FilesTab.tsx`
- Modify: `apps/desktop/src-tauri/src/lib.rs`
- Test: `apps/desktop/e2e/artifacts.spec.ts`

- [ ] **Step 1: Write failing artifact access tests**

Assert metadata links Task/Run/Channel, artifact retrieval validates authorized
paths/hashes, open action accepts daemon artifact IDs only, and message
Markdown cannot invoke arbitrary local file open.

Run: `cargo test -p slei-daemon --test artifacts && pnpm --filter @slei/desktop test:e2e -- artifacts.spec.ts`

Expected: FAIL.

- [ ] **Step 2: Implement artifact endpoints and validated desktop command**

Render chips/thread/File tab from metadata. A Tauri command requests a daemon
validation/open token before shell open; never accept raw content-provided
paths.

- [ ] **Step 3: Verify and commit**

Run: `cargo test -p slei-daemon --test artifacts && pnpm --filter @slei/desktop test:e2e -- artifacts.spec.ts`

Expected: PASS.

```bash
git add crates/slei-daemon/src/api/artifacts.rs crates/slei-daemon/src/services/artifact_service.rs crates/slei-daemon/tests/artifacts.rs apps/desktop/src/features/chat apps/desktop/src-tauri
git commit -m "feat: add guarded artifact views"
```

## Task 5: Implement Read-Only Capabilities And Member Activity

**Files:**
- Create: `crates/slei-daemon/src/api/capabilities.rs`
- Create: `crates/slei-daemon/src/services/capability_service.rs`
- Test: `crates/slei-daemon/tests/capabilities.rs`
- Create: `apps/desktop/src/features/members/CapabilitiesPanel.tsx`
- Create: `apps/desktop/src/features/members/ActivityPanel.tsx`

- [ ] **Step 1: Write failing capability tests**

Assert adapter metadata can be shown for approved workspace-local Claude
configuration/skills, unavailable scanning is non-blocking, and no install or
permission mutation endpoint exists.

Run: `cargo test -p slei-daemon --test capabilities && pnpm --filter @slei/desktop test -- CapabilitiesPanel`

Expected: FAIL.

- [ ] **Step 2: Implement read-only endpoint and view**

Display source, description and unavailable/error state. Activity composes
existing Run/Approval/Delegation entries without duplicating persistence.

- [ ] **Step 3: Verify this plan gate and commit**

Run:

```bash
cargo test -p slei-daemon --test delegation_chain --test approval_flow --test task_board --test artifacts --test capabilities
pnpm --filter @slei/desktop test:e2e -- delegation.spec.ts tasks.spec.ts artifacts.spec.ts
```

Expected: PASS.

```bash
git add crates/slei-daemon/src/api/capabilities.rs crates/slei-daemon/src/services/capability_service.rs crates/slei-daemon/tests/capabilities.rs apps/desktop/src/features/members
git commit -m "feat: display agent capabilities and activity"
```

## Completion Gate

- [ ] Agent-to-agent transfer always has a visible task-thread record.
- [ ] Native/runtime hidden delegation paths remain unavailable and typed
  delegation resolves only after its visible record is persisted.
- [ ] User mentions and Approval attention navigate to correct context.
- [ ] Controlled workspace operations are enabled only after correlated
  Approval UI tests pass.
- [ ] Board/List/status consistency and artifact origin navigation pass tests.
- [ ] Files cannot bypass validated artifact open policy.
- [ ] Capabilities are read-only and failure tolerant.
- [ ] Proceed to `2026-05-27-slei-quality-remote-boundary.md`.
