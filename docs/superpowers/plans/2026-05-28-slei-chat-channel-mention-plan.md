# Slei Chat Search, Channel Management, And Mentions Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add fixture-backed conversation search, modal-based channel create/delete with project association, `@` mention autocomplete, Lucide-only control icons, and centered system-button styling for the far-left rail to the desktop Chat MVP.

**Architecture:** Keep this pass inside the current React desktop shell and fixture model. Pure helper functions own filtering and mention selection logic so tests can verify behavior without a browser runtime; `SleiApp` wires those helpers into local React state and passes channel/message handlers down to the screenshot-aligned Chat sidebar and Chat page.

**Tech Stack:** React, TypeScript, `lucide-react`, Vitest SSR rendering, Slei UI CSS variables, local fixture state.

---

## File Structure

- Modify `apps/desktop/src/app/fixtures.ts`
  - Add channel project metadata and message channel ids.
- Modify `apps/desktop/src/app/SleiApp.tsx`
  - Add exported helper functions for search and mention behavior.
  - Add active channel state.
  - Add local channel create/delete handlers.
  - Add screenshot-aligned sidebar Search/Saved entries, dedicated search page, channel management controls, create-channel modal, Chat/Tasks/Files tabs, and full-width mention menu above the composer.
- Modify `apps/desktop/package.json` and `pnpm-lock.yaml`
  - Add `lucide-react`.
- Modify `apps/desktop/src/app/app.css`
  - Add token-driven styling for search panel, channel modal, channel row actions, mention menu, and centered rail buttons.
- Create `apps/desktop/e2e/chat-channel-mentions.spec.tsx`
  - Cover search/channel/mention behavior.

## Task 1: Fixture Model

**Files:**
- Modify: `apps/desktop/src/app/fixtures.ts`
- Test: `apps/desktop/e2e/chat-channel-mentions.spec.tsx`

- [ ] **Step 1: Write failing tests**

Add assertions that a channel can carry `projectName`, messages can carry `channelId`, and channel UI exposes project information.

- [ ] **Step 2: Run focused test**

Run: `pnpm --filter @slei/desktop test -- chat-channel-mentions.spec.tsx`

Expected: FAIL because the test file or fields do not exist yet.

- [ ] **Step 3: Implement fixture fields**

Add optional fields and default `channelId: "all"` on current messages.

- [ ] **Step 4: Run focused test**

Run: `pnpm --filter @slei/desktop test -- chat-channel-mentions.spec.tsx`

Expected: The fixture portion passes; later tests may still fail.

## Task 2: Conversation Search

**Files:**
- Modify: `apps/desktop/src/app/SleiApp.tsx`
- Modify: `apps/desktop/src/app/app.css`
- Test: `apps/desktop/e2e/chat-channel-mentions.spec.tsx`

- [ ] **Step 1: Write failing tests**

Test `filterConversationMessages(messages, filters)` for:

- `user` matching author and handle
- `channel` matching `channelId`
- `time` matching visible time

Also SSR-render Search and assert sidebar labels `Search` and `Saved`, no `Activity`, plus search filter labels `用户`, `渠道`, `时间`.

- [ ] **Step 2: Run focused test**

Run: `pnpm --filter @slei/desktop test -- chat-channel-mentions.spec.tsx`

Expected: FAIL because helper and UI are missing.

- [ ] **Step 3: Implement search helper and UI**

Add a `ChatSearchFilters` type, `filterConversationMessages`, a standalone `SearchPage`, and result buttons that call back with the matched channel/message target.

- [ ] **Step 4: Run focused test**

Run: `pnpm --filter @slei/desktop test -- chat-channel-mentions.spec.tsx`

Expected: Search tests pass.

## Task 3: Channel Management

**Files:**
- Modify: `apps/desktop/src/app/SleiApp.tsx`
- Modify: `apps/desktop/src/app/app.css`
- Test: `apps/desktop/e2e/chat-channel-mentions.spec.tsx`

- [ ] **Step 1: Write failing tests**

SSR-render Chat with default and project-associated channels. Assert:

- `新增频道`
- `关联项目`
- project label appears on channel row/header
- non-default channel has `删除频道`
- `#all` row does not render a delete button
- `CHANNELS` header shows the count and create affordance
- create-channel fields are rendered inside a dialog/modal, not as an inline sidebar form

- [ ] **Step 2: Run focused test**

Run: `pnpm --filter @slei/desktop test -- chat-channel-mentions.spec.tsx`

Expected: FAIL because create/delete controls are missing.

- [ ] **Step 3: Implement local channel handlers**

Add active channel id state, create/delete handlers, selectable channel rows, screenshot-style utility entries, channel group header controls, and modal state in `ChannelList`.

- [ ] **Step 4: Run focused test**

Run: `pnpm --filter @slei/desktop test -- chat-channel-mentions.spec.tsx`

Expected: Channel management tests pass.

## Task 4: Mention Autocomplete

**Files:**
- Modify: `apps/desktop/src/app/SleiApp.tsx`
- Modify: `apps/desktop/src/app/app.css`
- Test: `apps/desktop/e2e/chat-channel-mentions.spec.tsx`

- [ ] **Step 1: Write failing tests**

Test pure helpers:

- `activeMentionQuery("hello @co")` returns the active query.
- suggestions match Coda.
- empty `@` renders exactly the current `data.members` list and does not invent screenshot-only people.
- Arrow navigation wraps through the list.
- inserting Coda yields `hello @Coda `.

SSR-render Chat with `initialChatDraft="请 @co"` and assert the full-width mention panel appears between timeline and composer with selected row, names, and right-aligned handles.

- [ ] **Step 2: Run focused test**

Run: `pnpm --filter @slei/desktop test -- chat-channel-mentions.spec.tsx`

Expected: FAIL because mention UI/helpers are missing.

- [ ] **Step 3: Implement mention helpers and UI**

Add helper functions, state for selected suggestion index, screenshot-like full-width menu rendering, keyboard handling, and insertion behavior.

- [ ] **Step 4: Run focused test**

Run: `pnpm --filter @slei/desktop test -- chat-channel-mentions.spec.tsx`

Expected: Mention tests pass.

## Task 5: Lucide Icon System

**Files:**
- Modify: `apps/desktop/package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `apps/desktop/src/app/SleiApp.tsx`
- Test: `apps/desktop/e2e/chat-channel-mentions.spec.tsx`

- [ ] **Step 1: Write failing test**

Assert SSR markup contains Lucide SVG classes such as `lucide-search`, `lucide-trash-2`, and `lucide-at-sign`, and does not contain raw control glyphs such as `⌕`, `⌘`, `⌫`, `↕`, `▱`, `[]`, `>`, or `*`.

- [ ] **Step 2: Run focused test**

Run: `pnpm --filter @slei/desktop test -- chat-channel-mentions.spec.tsx`

Expected: FAIL because the current shell still uses glyph placeholders.

- [ ] **Step 3: Add dependency and replace glyph icons**

Install `lucide-react` for `@slei/desktop`, import icon components in `SleiApp.tsx`, and use them for navigation, sidebar utilities, channel controls, member graph/add controls, Chat tabs, back-to-bottom, composer actions, and settings/runtime action buttons where icons are present.

- [ ] **Step 4: Run focused test**

Run: `pnpm --filter @slei/desktop test -- chat-channel-mentions.spec.tsx`

Expected: PASS.

## Task 6: Main Rail Button Styling

**Files:**
- Modify: `apps/desktop/src/app/app.css`
- Test: `apps/desktop/e2e/chat-channel-mentions.spec.tsx`

- [ ] **Step 1: Write failing CSS contract test**

Assert `.slei-rail__button` uses centered icon-button styling: `justify-content: center`, stable square height/width, and no `flex-direction: column`.

- [ ] **Step 2: Run focused test**

Run: `pnpm --filter @slei/desktop test -- chat-channel-mentions.spec.tsx`

Expected: FAIL if the rail still uses stacked icon layout.

- [ ] **Step 3: Implement rail style**

Update `.slei-rail__button` to be an icon-only system button with centered Lucide SVG, stable dimensions, existing tokenized border/background/shadow, and no text stacking.

- [ ] **Step 4: Run focused test**

Run: `pnpm --filter @slei/desktop test -- chat-channel-mentions.spec.tsx`

Expected: PASS.

## Task 7: Verification

**Files:**
- All touched files.

- [ ] **Step 1: Run focused test**

Run: `pnpm --filter @slei/desktop test -- chat-channel-mentions.spec.tsx`

Expected: PASS.

- [ ] **Step 2: Run desktop quality gates**

Run:

```bash
pnpm --filter @slei/desktop lint
pnpm --filter @slei/desktop typecheck
pnpm --filter @slei/desktop test
pnpm --filter @slei/desktop build
```

Expected: all commands exit 0.
