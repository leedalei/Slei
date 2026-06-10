# Slei SQLite Reset Architecture Design

## Goal

Remove production mock data and consolidate mutable product state behind the daemon and SQLite.

The user wants Slei to restart from a clean system during development, with business logic living in the daemon and the UI shell only displaying daemon data. The design also records repository-level rules in `AGENTS.md` so future agents do not reintroduce production mock data or JSON-backed app state.

## Confirmed Decisions

- Chosen approach: staged SQLite migration for core production state.
- Reset depth: clear product state and agent workspace, while preserving built-in code resources and schema migrations.
- The default channel may remain as daemon-created empty channel id `all`, displayed as `#all`, if current routing needs it. It must not come from UI fixtures and must not include default members, messages, or tasks.
- Production UI must not seed old members, old tasks, fake local computers, fake guide messages, or demo channels.
- Every Slei task completion must ask whether to merge into `master` or another branch.

## Current Code Context

The repository already has a partial SQLite foundation:

- `crates/slei-storage` contains SQLite connection, migrations, and repositories.
- `crates/slei-storage/migrations/0001_initial.sql` already covers messages, tasks, runtime sessions, event log, idempotent mutations, coordinator decisions/runs, agent inbox events, memory update events, and routing context packages.
- `crates/slei-daemon/src/services/orchestration_store.rs` uses `slei-storage` for coordinator and event-related state.

Several production paths still use in-memory state or JSON files:

- `crates/slei-daemon/src/services/channel_service.rs` reads/writes `channels/index.json`, `channels/members.json`, and `channels/workspaces.json`.
- `crates/slei-daemon/src/services/message_service.rs` writes `channels/messages.json`.
- `crates/slei-daemon/src/services/member_service.rs` reads/writes `agents/index.json` and creates runtime agent workspaces.
- `crates/slei-daemon/src/services/conversation_service.rs` reads/writes conversation JSON files.
- `crates/slei-daemon/src/services/card_service.rs` reads/writes `cards/index.json`.
- `crates/slei-daemon/src/services/settings_service.rs` is in-memory, while the Tauri broker also persists `settings/preferences.json`.
- `crates/slei-daemon/src/services/task_service.rs` is currently in-memory.
- `apps/desktop/src-tauri/src/daemon_broker.rs` still contains local fallback state and JSON persistence.
- `apps/desktop/src/app/fixtures.ts` still provides production-shaped default fixture data, including a fake node and demo tasks.
- `apps/desktop/src/lib/daemon-bridge.ts` contains a broad mock bridge and mock workspace file helpers intended for tests, but production code can still fall back to local mock behavior outside Tauri.

## Architecture Boundary

Daemon is the only business logic and persistence boundary.

Daemon services own:

- agent lifecycle and workspace initialization;
- channel creation, membership, readiness, and workspace mounts;
- channel messages and routing;
- conversations, sessions, attachments metadata, and saved messages;
- tasks, replies, status, assignment, and thread state;
- cards, coordinator decisions, inbox events, runtime sessions, memory events, diagnostics, and settings;
- idempotency and reset.

UI owns:

- displaying daemon DTOs;
- form input before submission;
- route, drawer, modal, toast, loading, error, and empty-state UI state;
- lightweight view-model mapping such as date labels and display names.

UI must not own:

- production seed data;
- task routing or assignment rules;
- agent/channel/member/message persistence rules;
- workspace file simulation;
- fallback product state when daemon is offline.

The Tauri broker should be a bridge to daemon APIs. It can handle native command plumbing and short-lived cached receipts, but it should not maintain a second product database in JSON files.

## SQLite Persistence Scope

SQLite should become the default production store for mutable Slei product state.

Core entities to store in SQLite:

- Agents and members: identity, handle, kind, ownership, runtime kind, model, node, description, avatar seed, timestamps, channel membership, runtime thread metadata.
- Channels: channel records, descriptions, default flag, permissions, members, member readiness, workspace mounts.
- Messages: channel messages, tombstones, task-card references, edits, idempotency, timestamps.
- Conversations: DM records, sessions, active session, conversation messages, attachment metadata, saved messages.
- Tasks: task root, channel, source message, creator, assignee, assignment reason, status, attention flag, replies, root deletion, timestamps.
- Cards: interactive card records, action state, draft payload, completion status.
- Coordinator/orchestration: coordinator configs, decisions, runtime runs, inbox events, memory events, routing packages, event log.
- Settings/nodes: user preferences, local node name, runtime/device metadata that is user-controlled or stateful.
- Idempotency: create/send/update mutation responses.

The schema can evolve from the existing `0001_initial.sql` with follow-up migrations. Existing JSON-backed services should move behind repository methods in `crates/slei-storage`, then daemon services should call those repositories instead of `fs::read_to_string` and `fs::write`.

## Allowed JSON And File Uses

JSON is still valid for serialization and file-shaped resources, but not as the production database.

Allowed cases:

- API request/response/event payload serialization, including `serde_json::Value`.
- Worker protocol messages and JSONL/stdin/stdout payloads.
- Tests, contract fixtures, acceptance fixtures, and explicit test helpers.
- Built-in static resources such as `resources/default-agent-assets/*.json`.
- i18n locale files.
- Generated source artifacts derived from built-in resources, such as `default-agent-assets.generated.ts`.
- Agent workspace files that runtime tools need as files: `MEMORY.md`, notes, `SKILL.md`, overlay settings, and temporary worker overlay files.
- Short-lived migration import from legacy JSON into SQLite.

Any production write to a JSON file for app state should be treated as a regression unless the exception is documented in this spec or `AGENTS.md`.

## Reset Design

Reset is a daemon-owned development capability.

Recommended shape:

- Add a `ResetService` or `DevelopmentResetService` in `crates/slei-daemon`.
- Expose a guarded endpoint or command, such as `POST /v1/dev/reset`.
- Enable it only when an explicit development guard is set, for example `SLEI_ENABLE_DEV_RESET=1`.
- Add a quick repo command, for example `pnpm dev:reset`, that calls the guarded daemon reset endpoint or invokes an equivalent local reset command.

Reset behavior:

1. Stop or cancel active runtime runs and subscriptions where possible.
2. Start a SQLite transaction.
3. Delete mutable business rows from all product tables.
4. Preserve `schema_migrations`.
5. Recreate daemon-required default empty state, such as empty channel id `all` displayed as `#all` if needed by routing.
6. Delete runtime-generated agent workspace files under the data root `agents/`.
7. Delete legacy JSON files and directories that used to hold product state, including `channels/*.json`, `conversations/*.json`, `cards/index.json`, `settings/preferences.json`, and `saved/messages.json`.
8. Recreate necessary empty directories.

Failure semantics:

- Database cleanup should happen inside a SQLite transaction.
- Filesystem cleanup cannot be rolled back by SQLite. Reset should therefore delete runtime files after the database transaction commits, then report any filesystem cleanup failures explicitly.
- If database cleanup fails, reset must not delete agent workspaces.
- If database cleanup succeeds but filesystem cleanup partially fails, reset should return a partial-failure receipt that lists remaining paths so the developer can retry safely.

Reset result:

- No old agents.
- No old channel members.
- No old messages.
- No old tasks.
- No old cards.
- No old conversations or saved messages.
- No old preferences or local node rename state.
- No agent runtime workspace files.
- Built-in default assets and static skill templates remain available as code resources.

## UI Mock Removal

The UI cleanup should remove production mock data without deleting useful test helpers prematurely.

Recommended steps:

- Move production types out of `apps/desktop/src/app/fixtures.ts`, or rename that file to make test-only ownership explicit.
- Keep `createSleiFixtures` and `createDemoMembers` only for `*.test.tsx` and `apps/desktop/e2e/*.spec.*`.
- Initialize `SleiApp` with an empty view model rather than `createSleiFixtures()` defaults.
- Ensure daemon refresh populates nodes, channels, members, messages, tasks, conversations, and settings from daemon DTOs.
- Change non-Tauri or daemon-offline production behavior to explicit offline/empty state rather than broad mock behavior.
- Keep `createDaemonBridgeMock` for tests only.
- Move `mockAgentWorkspaceEntries` and `mockAgentWorkspaceFileContent` behind test-only helpers; production workspace browsing must call daemon APIs and read the real agent workspace.
- Remove demo task seeds such as `T-101`, fake members such as Coda/Alice/Cindy, fake runtime agent members, fake guide welcome messages, and hard-coded fake device identities from production initialization.

## Migration Plan

This design should be implemented in stages to reduce risk.

Stage 1: Guardrails and reset foundation

- Create or update `AGENTS.md` with the daemon-first, SQLite-first, reset, UI, and merge-question guardrails.
- Add static tests or grep-like checks that production source does not call fixture factories or write legacy JSON app-state paths.
- Add reset service shape and tests around emptying SQLite state plus deleting agent workspaces.

Stage 2: SQLite repositories for core entities

- Add migrations and repositories for agents, channels, channel members, workspace mounts, settings, conversations, cards, saved messages, and task replies/status where current schema is incomplete.
- Keep repository APIs narrow and service-oriented, not generic SQL passthroughs.

Stage 3: Daemon service migration

- Move channel, member, message, task, conversation, card, settings, and node state from JSON/in-memory into SQLite-backed repositories.
- Keep legacy JSON import read-only where needed, then write only to SQLite.
- Make idempotent mutations durable through SQLite.

Stage 4: Tauri broker cleanup

- Remove JSON fallback persistence from `daemon_broker.rs`.
- Make fallback behavior explicit: offline status and empty receipts, not an alternate product database.
- Route workspace file browsing to daemon-backed real filesystem reads.

Stage 5: UI cleanup

- Remove production fixture defaults.
- Keep test fixtures in test-owned files.
- Ensure all empty states render cleanly.
- Make task, member, channel, computer, and chat views display daemon data only.

## Testing And Acceptance

Static guardrails:

- Production app code must not call `createSleiFixtures()` or `createDemoMembers()`.
- Production app code must not call mock workspace helpers.
- Production daemon/Tauri code must not write legacy JSON app-state paths except in migration tests or reset cleanup.

Storage tests:

- Each migrated entity has SQLite repository tests for create/list/update/delete or tombstone behavior.
- Idempotency survives daemon restart.
- Foreign keys and uniqueness constraints catch invalid state.

Reset tests:

- Create agents, channel, members, messages, task, conversation, card, saved message, preferences, and agent workspace files.
- Run reset.
- Assert mutable tables are empty or reset to required empty defaults.
- Assert `schema_migrations` remains.
- Assert runtime-generated `agents/` workspace files are gone.
- Assert legacy JSON app-state files are gone.

UI tests:

- Empty daemon state renders empty UI without old names or demo tasks.
- No Coda, Alice, Cindy, runtime agent, `T-101`, `MacBookPro M4 MAX`, or guide welcome message appears unless a test explicitly supplies it.
- Offline daemon state displays offline/empty states, not mock data.

Migration tests:

- If legacy JSON import is implemented, it imports to SQLite once and does not continue writing JSON.

## Non-Goals

- Do not redesign the product UI layout in this pass.
- Do not remove JSON protocol serialization.
- Do not remove agent runtime workspace files that are intentionally file-based.
- Do not build a general-purpose database abstraction. Keep repositories shaped around Slei services.
- Do not make reset available in production builds without an explicit development guard.
