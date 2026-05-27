# Slei Channels, Members, And Conversations Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver channels, agent configuration, flat streamed chat, task threads and confirmation-based Interactive Cards.

**Architecture:** Channel and member mutations are idempotent daemon commands reflected through broker-delivered React views. Messages and thread replies render one flat timeline, while runtime streams append through stable Run-linked entries reconstructed only from undeleted Slei context. Interactive Cards enter the product only as typed `slei_propose_interactive_card` Worker MCP events whose confirmation invokes validated daemon commands; generated text never grants or creates an action. This plan covers M02 and M03 plus the MVP Interactive Card surface.

**Tech Stack:** Rust/Axum/sqlx services, React, TanStack Query, Zustand, i18next, TipTap-free textarea composer, Markdown sanitizer, Testing Library, Playwright.

---

## Files Introduced By This Plan

```text
crates/slei-daemon/src/api/{channels.rs,members.rs,messages.rs,tasks.rs,cards.rs}
crates/slei-daemon/src/services/{channel_service.rs,member_service.rs,message_service.rs,task_service.rs,card_service.rs}
crates/slei-daemon/tests/{channel_chat.rs,member_policy.rs,interactive_cards.rs,message_deletion.rs}
apps/desktop/src/features/chat/{ChatPage.tsx,ChannelSidebar.tsx,ChannelHeader.tsx,Timeline.tsx,MessageEntry.tsx,Composer.tsx,TaskRootCard.tsx,ThreadPanel.tsx}
apps/desktop/src/features/chat/{ToolCallBlock.tsx,ArtifactChip.tsx,InteractiveCard.tsx,InteractiveCardDialog.tsx}
apps/desktop/src/features/members/{MembersPage.tsx,MembersSidebar.tsx,AgentProfile.tsx,AgentForm.tsx,PermissionsPanel.tsx}
apps/desktop/src/lib/{markdown.ts,mentions.ts,uploads.ts}
apps/desktop/src/features/chat/*.test.tsx
apps/desktop/src/features/members/*.test.tsx
apps/desktop/e2e/{chat.spec.ts,members.spec.ts,cards.spec.ts}
packages/i18n/src/locales/{zh-CN.json,en-US.json}
```

## Task 1: Implement Channel, Workspace Mount And Member Commands

**Files:**
- Create: `crates/slei-daemon/src/api/channels.rs`
- Create: `crates/slei-daemon/src/api/members.rs`
- Create: `crates/slei-daemon/src/services/channel_service.rs`
- Create: `crates/slei-daemon/src/services/member_service.rs`
- Test: `crates/slei-daemon/tests/member_policy.rs`

- [ ] **Step 1: Write failing command/service tests**

Test create/update/list Channel, zero-workspace Channel, multi-workspace mount,
Agent assignment, primary Agent uniqueness, runtime configuration reference,
mutation retry idempotency and the rule that per-Agent workspace permissions
only narrow Channel access.

Run: `cargo test -p slei-daemon --test member_policy`

Expected: FAIL.

- [ ] **Step 2: Implement REST commands and event publication**

Endpoints:

```text
POST/PATCH/GET /v1/channels
POST/DELETE     /v1/channels/:id/workspaces
POST/GET/PATCH  /v1/agents
POST/DELETE     /v1/channels/:id/members
PUT             /v1/channels/:id/primary-agent
```

- [ ] **Step 3: Verify policy behavior**

Run: `cargo test -p slei-daemon --test member_policy`

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add crates/slei-daemon/src/api/channels.rs crates/slei-daemon/src/api/members.rs crates/slei-daemon/src/services/channel_service.rs crates/slei-daemon/src/services/member_service.rs crates/slei-daemon/tests/member_policy.rs
git commit -m "feat: add channel and member management"
```

## Task 2: Build Members Management UI

**Files:**
- Create: `apps/desktop/src/features/members/MembersPage.tsx`
- Create: `apps/desktop/src/features/members/MembersSidebar.tsx`
- Create: `apps/desktop/src/features/members/AgentProfile.tsx`
- Create: `apps/desktop/src/features/members/AgentForm.tsx`
- Create: `apps/desktop/src/features/members/PermissionsPanel.tsx`
- Test: `apps/desktop/e2e/members.spec.ts`
- Modify: `packages/i18n/src/locales/zh-CN.json`
- Modify: `packages/i18n/src/locales/en-US.json`

- [ ] **Step 1: Write failing Members tests**

Assert Agent/Human grouping, presence derived from active Runs, agent runtime
selection, primary assignment, restricted workspace overrides and read-only
capability placeholder states.

Run: `pnpm --filter @slei/desktop test:e2e -- members.spec.ts`

Expected: FAIL.

- [ ] **Step 2: Implement queries/forms/profile panels**

Do not expose runtime-specific SDK controls as general Slei fields; store
supported `runtime_kind`, model and permission preset values only.

- [ ] **Step 3: Verify members flow and locale parity**

Run: `pnpm --filter @slei/desktop test:e2e -- members.spec.ts && pnpm --filter @slei/i18n test`

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/features/members packages/i18n
git commit -m "feat: add members and agent configuration views"
```

## Task 3: Implement Channel Chat And Streamed Timeline

**Files:**
- Create: `crates/slei-daemon/src/api/messages.rs`
- Create: `crates/slei-daemon/src/services/message_service.rs`
- Test: `crates/slei-daemon/tests/channel_chat.rs`
- Test: `crates/slei-daemon/tests/message_deletion.rs`
- Create: `apps/desktop/src/features/chat/ChatPage.tsx`
- Create: `apps/desktop/src/features/chat/ChannelSidebar.tsx`
- Create: `apps/desktop/src/features/chat/ChannelHeader.tsx`
- Create: `apps/desktop/src/features/chat/Timeline.tsx`
- Create: `apps/desktop/src/features/chat/MessageEntry.tsx`
- Create: `apps/desktop/src/features/chat/Composer.tsx`
- Create: `apps/desktop/src/features/chat/ToolCallBlock.tsx`
- Create: `apps/desktop/src/lib/mentions.ts`
- Create: `apps/desktop/src/lib/markdown.ts`
- Test: `apps/desktop/e2e/chat.spec.ts`

- [ ] **Step 1: Write failing daemon chat tests**

Assert a message without mention invokes the primary agent, explicit `@agent`
selects the target, `@human` is persisted/notify-only, no-workspace chat sends
the restricted runtime input, edit labels persist and delete removes original
body while showing a tombstone. With a sentinel message, assert delete followed
by restart/new run never includes the sentinel in reconstructed Claude input or
event payloads, and retrying send with one idempotency key creates one message/run.

Run: `cargo test -p slei-daemon --test channel_chat`

Expected: FAIL.

- [ ] **Step 2: Implement message commands and run linkage**

Provide send/edit/delete/list operations and connect sent messages to
`RunOrchestrator`. Agent messages are immutable. Human deletion uses only the
tombstone representation from domain/storage and invalidates any pending
context projection before a subsequent run begins.

- [ ] **Step 3: Write failing timeline/component E2E tests**

Assert flat document-style rows, in-place stream append, collapsed tool calls,
composer mention autocomplete, safe Markdown, arbitrary `file:`/`javascript:`
links stripped and reconnect restores content.

Run: `pnpm --filter @slei/desktop test:e2e -- chat.spec.ts`

Expected: FAIL.

- [ ] **Step 4: Implement Chat UI and safe renderer**

Render artifacts via daemon-issued actions only. Never call Tauri shell-open
from an arbitrary Markdown URL.

- [ ] **Step 5: Verify chat behavior**

Run:

```bash
cargo test -p slei-daemon --test channel_chat
pnpm --filter @slei/desktop test:e2e -- chat.spec.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add crates/slei-daemon/src/api/messages.rs crates/slei-daemon/src/services/message_service.rs crates/slei-daemon/tests/channel_chat.rs apps/desktop/src/features/chat apps/desktop/src/lib
git commit -m "feat: add streamed channel chat"
```

## Task 4: Implement Task Creation And Dedicated Thread Replies

**Files:**
- Create: `crates/slei-daemon/src/api/tasks.rs`
- Create: `crates/slei-daemon/src/services/task_service.rs`
- Modify: `apps/desktop/src/features/chat/Composer.tsx`
- Create: `apps/desktop/src/features/chat/TaskRootCard.tsx`
- Create: `apps/desktop/src/features/chat/ThreadPanel.tsx`
- Test: `apps/desktop/src/features/chat/ThreadPanel.test.tsx`
- Test: `apps/desktop/e2e/chat.spec.ts`

- [ ] **Step 1: Write failing task/thread tests**

Assert `As Task` creates a task root card instead of a plain message, thread
replies stay attached to the Task, reply count/unread state update, a Task root
cannot be deleted while active and a later reply rebuilds its task/agent
context from undeleted thread records.

Run: `cargo test -p slei-daemon task_service && pnpm --filter @slei/desktop test -- ThreadPanel`

Expected: FAIL.

- [ ] **Step 2: Implement task/thread commands and UI side panel**

Expose Task root in Channel timeline and open all detailed Q&A in the right
Thread panel. Maintain URL/selection state so task links are navigable.

- [ ] **Step 3: Verify task-thread behavior**

Run: `cargo test -p slei-daemon task_service && pnpm --filter @slei/desktop test:e2e -- chat.spec.ts`

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add crates/slei-daemon/src/api/tasks.rs crates/slei-daemon/src/services/task_service.rs apps/desktop/src/features/chat
git commit -m "feat: add task threads to chat"
```

## Task 5: Implement Confirmation-Based Interactive Cards

**Files:**
- Create: `crates/slei-daemon/src/api/cards.rs`
- Create: `crates/slei-daemon/src/services/card_service.rs`
- Test: `crates/slei-daemon/tests/interactive_cards.rs`
- Modify: `workers/claude-agent/src/slei-tools.ts`
- Test: `workers/claude-agent/src/slei-tools.test.ts`
- Create: `apps/desktop/src/features/chat/InteractiveCard.tsx`
- Create: `apps/desktop/src/features/chat/InteractiveCardDialog.tsx`
- Test: `apps/desktop/e2e/cards.spec.ts`

- [ ] **Step 1: Write failing validation tests**

Cover typed Worker MCP card proposals for create Channel and create Agent,
user edit/confirm, dismissal, no action before confirmation, no workspace
mount via card, no new Agent preset/workspace privilege above the proposing
Agent, duplicate tool/mutation retry idempotency and rejection of cards
inferred from free-form assistant text.

Run: `cargo test -p slei-daemon --test interactive_cards && pnpm --filter @slei/desktop test:e2e -- cards.spec.ts`

Expected: FAIL.

- [ ] **Step 2: Implement structured card schema and daemon command handlers**

The Worker forwards `slei_propose_interactive_card` as a correlated typed
product-tool event. The daemon validates its action schema and creates a
pending card exactly once; card state transitions are
`pending -> confirmed | dismissed | rejected`. Validation runs again on
confirmation; the displayed default values are not authorization.

- [ ] **Step 3: Render cards in Guide Agent/chat/thread context**

The initial Guide Agent may propose first Channel and Agent setup; user sees
the editable Modal and resulting entity links after confirmation.

- [ ] **Step 4: Verify plan gate**

Run:

```bash
cargo test -p slei-daemon --test interactive_cards --test channel_chat --test message_deletion
pnpm --filter @slei/desktop test:e2e -- chat.spec.ts members.spec.ts cards.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add crates/slei-daemon/src/api/cards.rs crates/slei-daemon/src/services/card_service.rs crates/slei-daemon/tests/interactive_cards.rs apps/desktop/src/features/chat
git commit -m "feat: add interactive setup cards"
```

## Completion Gate

- [ ] Channel and Members flows honor workspace/preset restrictions.
- [ ] No-workspace chat, streamed responses, idempotent retry, edit/delete
  tombstone, deletion-safe reconstructed context and safe links pass tests.
- [ ] Task replies remain inside thread context with Slei-reconstructed runtime context.
- [ ] Interactive Cards are useful for Guide Agent setup, originate only from
  typed Slei MCP proposals and cannot change resources without human confirmation.
- [ ] Proceed to `2026-05-27-slei-teamwork-task-ops.md`.
