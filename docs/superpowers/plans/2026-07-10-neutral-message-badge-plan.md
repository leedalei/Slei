# Neutral Message Badge Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make role/profession badges in channel messages, DM messages, task source cards, and task thread replies use one restrained neutral-gray style that remains readable on light and dark surfaces.

**Architecture:** Keep the global `Badge` primitive and its semantic variants unchanged. Add one shared message-metadata class constant in `MessageBubbleChrome.tsx`, apply it only at the three message-header render sites, and add a stable `data-slot="message-role-badge"` marker for DOM regression tests.

**Tech Stack:** React, TypeScript, Tailwind utility classes, Vitest, JSDOM, local Electron renderer.

---

## File Map

- Modify `apps/desktop/src/features/chat/MessageBubbleChrome.tsx`: define the shared neutral message-role Badge class constant.
- Modify `apps/desktop/src/features/chat/ChatPageView.tsx`: apply the shared class and DOM marker to normal channel/DM message role badges.
- Modify `apps/desktop/src/features/chat/TaskRootEntry.tsx`: apply the shared class and DOM marker to task source-card role badges.
- Modify `apps/desktop/src/features/tasks/TaskThreadDrawer.tsx`: apply the shared class and DOM marker to task-thread reply role badges.
- Modify `apps/desktop/src/features/chat/ChatPageView.test.tsx`: add DOM assertions for all target surfaces and protect excluded Badge surfaces from accidental scope expansion where practical.
- Reference `docs/superpowers/specs/2026-07-10-neutral-message-badge-design.md`: approved design and scope.

## Task 1: Add failing DOM coverage for the unified message-role Badge contract

**Files:**
- Test: `apps/desktop/src/features/chat/ChatPageView.test.tsx`

- [ ] **Step 1: Add a test for normal message role badges in channel and DM rendering.**

Create an agent member with a profession and an incoming agent message whose `authorId`/`handle` resolve to that member. Render the channel case and repeat through the existing DM fixture path because normal message rendering is shared by both contexts. Assert the role badge has `data-slot="message-role-badge"`, `bg-muted/60`, `text-muted-foreground`, and `border-border/60`.

- [ ] **Step 2: Add tests for task source-card and task-thread reply role badges.**

Add an agent/incoming task source message with a matching `sourceMessage`/member so `TaskRootEntry` renders its role badge; do not reuse the existing human/outgoing task fixture. For `TaskThreadDrawer`, add an agent/incoming reply with `memberId` or a matching handle, open the drawer through the existing task-thread action path, and assert the rendered reply badge. Each target node must have the same data slot and class contract.

- [ ] **Step 3: Run the focused tests and verify they fail for the missing contract.**

Run:

```bash
pnpm --filter @slei/desktop test -- src/features/chat/ChatPageView.test.tsx -t "message role badge|task.*badge|thread.*badge"
```

Expected: FAIL because the current render sites still use `variant="secondary"` without the shared neutral class/data slot.

## Task 2: Implement the shared neutral-gray message-role Badge style

**Files:**
- Modify: `apps/desktop/src/features/chat/MessageBubbleChrome.tsx`
- Modify: `apps/desktop/src/features/chat/ChatPageView.tsx`
- Modify: `apps/desktop/src/features/chat/TaskRootEntry.tsx`
- Modify: `apps/desktop/src/features/tasks/TaskThreadDrawer.tsx`

- [ ] **Step 1: Define the shared class constant.**

Add an exported constant in `MessageBubbleChrome.tsx`:

```ts
export const MESSAGE_ROLE_BADGE_CLASS = "border-border/60 bg-muted/60 text-muted-foreground";
```

Do not alter `apps/desktop/src/components/ui/badge.tsx` or global `secondary` styling.

- [ ] **Step 2: Apply the constant to normal channel/DM message role badges.**

Import the constant into `ChatPageView.tsx`, combine it with the existing `max-w-full truncate` class, keep `variant="secondary"` only for semantic compatibility if needed, and add `data-slot="message-role-badge"`.

- [ ] **Step 3: Apply the same contract to task source cards and task-thread replies.**

Update `TaskRootEntry.tsx` and `TaskThreadDrawer.tsx` with the same constant, data slot, truncation behavior, and semantic Badge variant. Do not change AgentProfilePopover, sidebar, member-list, count, status, or permission badges.

- [ ] **Step 4: Run the focused tests and verify they pass.**

Run:

```bash
pnpm --filter @slei/desktop test -- src/features/chat/ChatPageView.test.tsx -t "message role badge|task.*badge|thread.*badge"
```

Expected: PASS for all new DOM assertions.

## Task 3: Verify regression safety and local Electron appearance

**Files:**
- Verify: `apps/desktop/src/features/chat/ChatPageView.tsx`
- Verify: `apps/desktop/src/features/chat/TaskRootEntry.tsx`
- Verify: `apps/desktop/src/features/tasks/TaskThreadDrawer.tsx`
- Verify: `apps/desktop/src/features/chat/ChatPageView.test.tsx`

- [ ] **Step 1: Run the complete desktop test suite.**

Run `pnpm --filter @slei/desktop test`; expected all test files and tests pass.

- [ ] **Step 2: Run typecheck and production build.**

Run `pnpm --filter @slei/desktop typecheck` and `pnpm --filter @slei/desktop build`; expected both exit successfully.

- [ ] **Step 3: Start or reuse the local Electron App and inspect the four target surfaces.**

Use the desktop command `pnpm --filter @slei/desktop desktop` if the App is not already running. Verify the Badge is a subdued gray on both light page surfaces and dark message bubbles, with readable text and no change to excluded badges. Do not use a browser renderer.

- [ ] **Step 4: Run final workspace checks.**

Run `git diff --check` and confirm only the intended code/test files are modified in addition to the already committed design document. Do not commit or merge the implementation until the user chooses the integration target.
