# Slei Task Thread Flow Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make chat messages convertible into tasks and give every task a right-side 680px Thread drawer where users and Agents can continue task-scoped conversation.

**Architecture:** Start with the existing desktop `SleiTask` model and task board UI, adding root-message metadata and replies so the product flow is usable immediately. Keep the surface shaped like the existing daemon `TaskService` (`create_task_root`, `add_reply`, `thread_context`) so the next step can move persistence/runtime session orchestration behind the bridge without redesigning the UI.

**Tech Stack:** React 19 desktop shell, Vitest SSR interaction-oriented tests, lucide-react icons, existing Slei design tokens in `app.css`, existing Rust `TaskService` as the target persistence model.

---

## Current State

- Chat composer already has a `转为任务` checkbox, but submit ignores `asTask`.
- Tasks page renders fixture tasks in columns but has no task root action button, no Thread drawer, and no reply composer.
- `crates/slei-daemon/src/services/task_service.rs` already supports task roots and replies, but `crates/slei-daemon/src/api/tasks.rs` is not wired yet.
- Existing `ThreadPanel`/`TaskRootCard` files are string render helpers for older acceptance tests, not the actual app UI.

## File Structure

- Modify `apps/desktop/src/app/fixtures.ts`: extend `SleiTask` with optional `channelId`, `sourceMessageId`, and `replies`.
- Modify `apps/desktop/src/app/SleiApp.tsx`: export task creation/reply helpers, pass `asTask` from composer submit, update local task state, render task comment buttons, and render a right drawer.
- Modify `apps/desktop/src/app/app.css`: add task card toolbar, icon button placement, 680px drawer, reply list, and reply composer styles using tokens.
- Modify `apps/desktop/src/i18n/types.ts`, `apps/desktop/src/i18n/messages/zh-CN/tasks.ts`, `apps/desktop/src/i18n/messages/en-US/tasks.ts`: add Thread labels and accessible button copy.
- Add `apps/desktop/e2e/task-thread-flow.spec.tsx`: cover chat-to-task root creation and drawer rendering.

## Task 1: Chat Message Creates Task Root

- [x] **Step 1: Write failing test**

Run: `pnpm --filter @slei/desktop test -- e2e/task-thread-flow.spec.tsx`

Expected: FAIL because `createTaskFromChatMessage` does not exist.

- [x] **Step 2: Implement task root helper**

Create a deterministic helper that maps a valid chat message to an `SleiTask` with `status: "todo"`, source metadata, and the original message as the first reply.

- [x] **Step 3: Wire composer `asTask`**

Pass `{ asTask }` into `onSendMessage`, append the local chat message, and append the task root when checked.

## Task 2: Task Thread Drawer

- [x] **Step 1: Write failing drawer test**

Expected: FAIL because task cards do not render a comment button or drawer.

- [x] **Step 2: Add task card comment action**

Each task card gets an icon-only comment button with accessible label, reply count, and stable dimensions.

- [x] **Step 3: Add 680px drawer**

Render a right-side drawer with width `680px`, task title/status, root context, reply list, and reply composer.

- [x] **Step 4: Add replies**

Submitting a drawer reply appends it to the task. Agent/runtime replies will later use the same `replies` shape when daemon task sessions are wired.

## Verification

- [x] Run `pnpm --filter @slei/desktop test -- e2e/task-thread-flow.spec.tsx`
- [x] Run `pnpm --filter @slei/desktop test`
- [x] Run `pnpm --filter @slei/desktop typecheck`
- [x] Run `git diff --check`

## Follow-Up

- Wire `crates/slei-daemon/src/api/tasks.rs` to `TaskService` and add Tauri bridge commands.
- Start a task-scoped Agent runtime session when the drawer reply targets an Agent.
- Persist task roots and replies across desktop reloads.
