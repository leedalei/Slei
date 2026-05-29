# Slei Complete Agent DM Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build complete Agent direct messaging: user-created DMs invoke the local Agent runtime, render Markdown responses with app-native styling and GitHub-like code highlighting, support interactive runtime questions in chat, and allow file/image uploads with configurable cache cleanup.

**Architecture:** Keep `ConversationService` as the durable conversation/message store, add an Agent DM runtime orchestration layer in the daemon that creates/resumes local Claude worker sessions and appends assistant/output/tool/question events back into the conversation timeline. In the desktop app, treat conversation messages as Markdown-first UI data, render interactive event cards inline, and store attachments under `~/.slei/cache/attachments` with cleanup preferences managed through settings.

**Tech Stack:** Rust daemon services/API tests, Tauri broker commands, React 19 desktop UI, Vitest server-render tests, CSS modules in `app.css`, worker protocol JSON events, `pnpm --filter @slei/desktop test`, `cargo test -p slei-daemon`.

---

## Current State

- DM creation now exists and is intentionally user-triggered from member detail, but `send_message` only persists the human message. Except for the local Yeal guide card shortcut, no daemon code starts the Agent runtime.
- `ClaudeWorkerAdapter` can create sessions and send `start_run`, but conversation sends do not call it, and worker events are not yet mapped back to DM messages.
- Desktop chat currently renders `message.body` as a plain paragraph. Existing `sanitizeMarkdown` only blocks dangerous links; it does not parse Markdown, render tables/lists/code blocks, or highlight code.
- Composer has icon buttons for images/files, but there is no file picker bridge, attachment persistence, or cache cleanup preference.
- Settings support locale, timezone, appearance, and notifications only. Cache cleanup policy is not represented in daemon settings or desktop UI.

## File Structure

- Modify `crates/slei-daemon/src/services/conversation_service.rs`: extend message records with optional metadata for author kind, run id, attachments, and interactive cards/questions while preserving existing JSON compatibility.
- Create `crates/slei-daemon/src/services/agent_dm_service.rs`: orchestrate DM sends, runtime session creation, worker `start_run`, event-to-message mapping, and interactive question state.
- Modify `crates/slei-daemon/src/api/conversations.rs`: call `AgentDmService` for human messages to Agent DMs and expose endpoints for interactive replies.
- Modify `crates/slei-daemon/src/adapters/claude_worker.rs` and `workers/claude-agent/src/protocol.ts`: ensure worker events needed by DM are serializable, testable, and include `human_question_requested` / product tool payloads.
- Modify `apps/desktop/src-tauri/src/daemon_broker.rs` and `apps/desktop/src/lib/daemon-bridge.ts`: expose attachment upload, cache cleanup, and interactive reply commands.
- Create `apps/desktop/src/features/chat/MarkdownMessage.tsx`: app-native Markdown renderer for paragraphs, `ol`, `ul`, `table`, `pre`, `code`, `blockquote`, links, and fenced code highlighting.
- Modify `apps/desktop/src/app/SleiApp.tsx`: replace plain message `<p>` with `MarkdownMessage`, render interactive runtime questions inline, include upload controls, and refresh conversation messages after daemon responses/events.
- Modify `apps/desktop/src/app/app.css`: add message Markdown, GitHub-like code theme, attachment chips, upload queue, and inline interactive question styles that match existing Slei surfaces.
- Modify `crates/slei-daemon/src/services/settings_service.rs`, `crates/slei-daemon/src/api/settings.rs`, desktop i18n/settings UI: add cache cleanup policy (`off`, `1w`, `2w`, `1m`) and manual cleanup.
- Create `crates/slei-daemon/src/services/attachment_service.rs`: copy uploads into `~/.slei/cache/attachments`, store manifest metadata, delete expired files based on policy, and sanitize paths.

## Task 1: Prove DM Send Invokes Agent Runtime

**Files:**
- Modify: `crates/slei-daemon/src/api/conversations.rs`
- Modify: `crates/slei-daemon/src/services/conversation_service.rs`
- Create: `crates/slei-daemon/src/services/agent_dm_service.rs`
- Test: `crates/slei-daemon/tests/agent_workspace.rs`

- [ ] **Step 1: Write the failing daemon test**

Add a test that creates an Agent, creates its DM, sends a human message, and asserts a `start_run` command is emitted with the conversation prompt and agent workspace cwd.

- [ ] **Step 2: Run the focused test**

Run: `cargo test -p slei-daemon --test agent_workspace dm_send_starts_agent_runtime`

Expected: FAIL because `send_message` only appends the human message.

- [ ] **Step 3: Implement `AgentDmService` minimally**

Route human messages in Agent DMs through a service that creates a runtime session for the target Agent and calls `ClaudeWorkerAdapter::start_run`.

- [ ] **Step 4: Run the focused test**

Run: `cargo test -p slei-daemon --test agent_workspace dm_send_starts_agent_runtime`

Expected: PASS.

## Task 2: Persist Runtime Output Back Into DM Timeline

**Files:**
- Modify: `crates/slei-daemon/src/services/agent_dm_service.rs`
- Modify: `crates/slei-daemon/src/services/conversation_service.rs`
- Test: `crates/slei-daemon/tests/agent_workspace.rs`

- [ ] **Step 1: Write failing event mapping tests**

Cover `output_delta`, `tool_started`, `tool_completed`, `product_tool_requested`, `human_question_requested`, `completed`, and `failed`.

- [ ] **Step 2: Implement event-to-message mapping**

Append assistant Markdown messages for output, tool status messages/cards for tools, inline question records for human questions, and final status metadata for completion/failure.

- [ ] **Step 3: Verify daemon tests**

Run: `cargo test -p slei-daemon --test agent_workspace dm_runtime_events_append_to_conversation`

Expected: PASS.

## Task 3: Markdown Message Rendering

**Files:**
- Create: `apps/desktop/src/features/chat/MarkdownMessage.tsx`
- Modify: `apps/desktop/src/app/SleiApp.tsx`
- Modify: `apps/desktop/src/app/app.css`
- Test: `apps/desktop/e2e/chat-markdown.spec.tsx`

- [ ] **Step 1: Write failing render tests**

Assert that Markdown bodies render app-styled headings, paragraphs, ordered/unordered lists, blockquotes, tables, inline code, fenced code blocks, and sanitized links.

- [ ] **Step 2: Implement renderer**

Use a small internal renderer or a vetted Markdown library with custom component mapping. Always sanitize dangerous `javascript:`, `file:`, and absolute local-path links.

- [ ] **Step 3: Add GitHub-like highlighting**

Integrate a deterministic highlighter for fenced code blocks and style tokens with a quiet GitHub-light palette adapted to Slei.

- [ ] **Step 4: Verify**

Run: `pnpm --filter @slei/desktop test -- e2e/chat-markdown.spec.tsx`

Expected: PASS.

## Task 4: Interactive Runtime Questions In Chat

**Files:**
- Modify: `crates/slei-daemon/src/services/agent_dm_service.rs`
- Modify: `crates/slei-daemon/src/api/conversations.rs`
- Modify: `apps/desktop/src/lib/daemon-bridge.ts`
- Modify: `apps/desktop/src/app/SleiApp.tsx`
- Test: `apps/desktop/e2e/real-agents-dm.spec.tsx`
- Test: `crates/slei-daemon/tests/agent_workspace.rs`

- [ ] **Step 1: Write failing tests for question cards**

Assert `human_question_requested` creates an inline question card, desktop renders it in the DM timeline, and submitting an answer calls the daemon endpoint.

- [ ] **Step 2: Implement storage and reply endpoint**

Store question state with request id, run id, agent id, body, and answer status. Add `POST /v1/conversations/:id/questions/:request_id/reply`.

- [ ] **Step 3: Render and submit in desktop**

Show the question as an inline interactive block with textarea/actions, disable after answer, and refresh timeline.

## Task 5: File/Image Uploads And Attachment Cache

**Files:**
- Create: `crates/slei-daemon/src/services/attachment_service.rs`
- Modify: `crates/slei-daemon/src/api/conversations.rs`
- Modify: `apps/desktop/src-tauri/src/daemon_broker.rs`
- Modify: `apps/desktop/src/lib/daemon-bridge.ts`
- Modify: `apps/desktop/src/app/SleiApp.tsx`
- Modify: `apps/desktop/src/app/app.css`
- Test: `crates/slei-daemon/tests/attachments.rs`
- Test: `apps/desktop/e2e/chat-attachments.spec.tsx`

- [ ] **Step 1: Write failing daemon attachment tests**

Assert upload copies files under `~/.slei/cache/attachments`, rejects traversal/unsafe paths, stores metadata, and returns attachment ids without exposing raw source paths.

- [ ] **Step 2: Implement attachment service and endpoints**

Add upload, list, resolve-for-runtime-context, and manual cleanup APIs.

- [ ] **Step 3: Wire desktop upload controls**

Use Tauri file dialog in desktop, show selected image/file chips, send attachment ids with DM messages, and render attachments in timeline.

## Task 6: Cache Cleanup Settings

**Files:**
- Modify: `crates/slei-daemon/src/services/settings_service.rs`
- Modify: `crates/slei-daemon/src/api/settings.rs`
- Modify: `apps/desktop/src/i18n/types.ts`
- Modify: `apps/desktop/src/i18n/messages/zh-CN/settings.ts`
- Modify: `apps/desktop/src/i18n/messages/en-US/settings.ts`
- Modify: `apps/desktop/src/app/SleiApp.tsx`
- Test: `crates/slei-daemon/tests/settings_identity.rs`
- Test: `apps/desktop/e2e/settings-preferences.spec.tsx`

- [ ] **Step 1: Write failing settings tests**

Assert cleanup policy accepts `off`, `1w`, `2w`, `1m`; manual cleanup removes expired cache files and reports count/bytes.

- [ ] **Step 2: Implement daemon preferences**

Persist cleanup policy with preferences and expose manual cleanup.

- [ ] **Step 3: Implement desktop settings UI**

Add segmented control/dropdown for cleanup interval and a manual cleanup button in settings, using localized copy.

## Final Verification

- [ ] Run `pnpm --filter @slei/desktop test`
- [ ] Run `pnpm --filter @slei/desktop typecheck`
- [ ] Run `cargo test -p slei-daemon`
- [ ] Run affected worker tests: `pnpm --filter @slei/claude-agent test`
- [ ] In the Tauri desktop app, manually create an Agent DM, send Markdown with code/table/list, answer an inline runtime question, upload a file/image, and run manual cache cleanup.
