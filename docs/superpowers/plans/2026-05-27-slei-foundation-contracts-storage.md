# Slei Foundation, Contracts, And Storage Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create the buildable Slei monorepo baseline with runtime-neutral contracts, domain state machines, bilingual resources and durable SQLite schema.

**Architecture:** This plan establishes boundaries before any UI or runtime integration: Rust domain/protocol/storage crates are authoritative, TypeScript consumes protocol fixtures, and storage captures Slei entities without embedding provider logic. It fixes deletion as an end-to-end privacy contract: Claude MVP later reconstructs context only from undeleted Slei records and stores no provider resume token or transcript. It covers M00, the foundation portion of M09 and M14, and the executable/distribution boundary from M15.

**Tech Stack:** pnpm, TypeScript, Vitest, Cargo workspace, Rust, serde, uuid, thiserror, sqlx/SQLite, tokio, i18next.

---

## Files Introduced By This Plan

```text
Cargo.toml
package.json
pnpm-workspace.yaml
.gitignore
rust-toolchain.toml
crates/adapter-api/Cargo.toml
crates/adapter-api/src/lib.rs
crates/slei-domain/Cargo.toml
crates/slei-domain/src/{lib.rs,entities.rs,task.rs,run.rs,permissions.rs,mentions.rs}
crates/slei-protocol/Cargo.toml
crates/slei-protocol/src/{lib.rs,version.rs,error.rs,dto.rs,event.rs}
crates/slei-storage/Cargo.toml
crates/slei-storage/src/{lib.rs,db.rs,migrations.rs,repositories/mod.rs}
crates/slei-storage/migrations/0001_initial.sql
packages/protocol-client/package.json
packages/protocol-client/src/{index.ts,contracts.ts,errors.ts,events.ts}
packages/protocol-client/src/contracts.test.ts
packages/i18n/package.json
packages/i18n/src/{index.ts,locales/zh-CN.json,locales/en-US.json,keys.test.ts}
tests/contract/{protocol-version.json,error-codes.json,events.json}
docs/architecture/0001-runtime-adapter-and-process-boundaries.md
```

## Task 1: Scaffold Workspaces And Quality Commands

**Files:**
- Create: `Cargo.toml`
- Create: `rust-toolchain.toml`
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `.gitignore`
- Create: `crates/adapter-api/Cargo.toml`
- Create: `crates/adapter-api/src/lib.rs`
- Create: `crates/slei-domain/Cargo.toml`
- Create: `crates/slei-domain/src/lib.rs`
- Create: `crates/slei-protocol/Cargo.toml`
- Create: `crates/slei-protocol/src/lib.rs`
- Create: `crates/slei-storage/Cargo.toml`
- Create: `crates/slei-storage/src/lib.rs`
- Create: `packages/protocol-client/package.json`
- Create: `packages/i18n/package.json`

- [ ] **Step 1: Write the expected workspace commands before code exists**

Add root scripts:

```json
{
  "scripts": {
    "test": "pnpm -r test",
    "typecheck": "pnpm -r typecheck",
    "lint": "pnpm -r lint"
  }
}
```

Create Rust workspace membership for the four crates and shared dependency
versions for `serde`, `uuid`, `thiserror`, `tokio`, `sqlx` and `futures`.

- [ ] **Step 2: Run the empty baseline and observe missing manifests/source failures**

Run: `pnpm install && pnpm test && cargo test --workspace`

Expected: FAIL until package scripts and minimal Rust library roots are present.

- [ ] **Step 3: Add minimal manifests and empty library modules**

Keep the four Rust crates dependency-light. `adapter-api` may depend only on
serializable shared/runtime types and streams; it must not depend on storage or
daemon crates.

- [ ] **Step 4: Verify the blank monorepo builds**

Run: `pnpm test && pnpm typecheck && cargo test --workspace`

Expected: PASS with no tests yet, proving all workspace commands resolve.

- [ ] **Step 5: Commit**

```bash
git add Cargo.toml rust-toolchain.toml package.json pnpm-workspace.yaml .gitignore crates packages
git commit -m "chore: scaffold Slei workspaces"
```

## Task 2: Define Runtime-Neutral And Protocol Contracts

**Files:**
- Create: `crates/adapter-api/src/lib.rs`
- Create: `crates/slei-protocol/src/version.rs`
- Create: `crates/slei-protocol/src/error.rs`
- Create: `crates/slei-protocol/src/dto.rs`
- Create: `crates/slei-protocol/src/event.rs`
- Create: `tests/contract/protocol-version.json`
- Create: `tests/contract/error-codes.json`
- Create: `tests/contract/events.json`
- Create: `packages/protocol-client/src/contracts.ts`
- Create: `packages/protocol-client/src/errors.ts`
- Create: `packages/protocol-client/src/events.ts`
- Test: `packages/protocol-client/src/contracts.test.ts`

- [ ] **Step 1: Write failing TypeScript fixture validation tests**

Test that fixture data exposes:

```ts
expect(protocolVersion.version).toBe("v1");
expect(errorCodes).toContainEqual({ code: "E403", key: "error.permission_violation" });
expect(events).toContainEqual(expect.objectContaining({ type: "approval.created" }));
```

Run: `pnpm --filter @slei/protocol-client test`

Expected: FAIL because contracts and fixtures do not exist.

- [ ] **Step 2: Write failing Rust serialization tests**

In `slei-protocol`, test round trips for `ApiError`, `EventEnvelope` and
`ProtocolHandshake`. In `adapter-api`, test serialization for:

```rust
RuntimeKind::{ClaudeCode, OpenCode, Codex}
RuntimeCapabilities
RuntimeSession
RunInput
RunEvent::PermissionRequest
RunEvent::HumanQuestionRequested
RunEvent::ProductToolRequested
PermissionDecision::{Allow, Block}
```

Run: `cargo test -p adapter-api -p slei-protocol`

Expected: FAIL until the public types exist.

- [ ] **Step 3: Implement the smallest typed contracts**

Use UUID identifiers, a monotonically increasing `sequence: u64` for events,
mutation `idempotency_key` support, and localized error keys instead of
rendered UI strings. `PermissionRequest` includes `request_id`, `run_id`,
`tool_use_id` and `agent_id`; human-question and typed Slei product-tool
requests are separately correlated. Keep optional adapter-owned session tokens opaque to all public
Desktop DTOs and set them absent for Claude MVP.

- [ ] **Step 4: Verify both language boundaries consume the fixtures**

Run: `cargo test -p adapter-api -p slei-protocol && pnpm --filter @slei/protocol-client test`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add crates/adapter-api crates/slei-protocol packages/protocol-client tests/contract
git commit -m "feat: define Slei protocol and runtime contracts"
```

## Task 3: Implement Domain State Machines And Policy Primitives

**Files:**
- Create: `crates/slei-domain/src/entities.rs`
- Create: `crates/slei-domain/src/task.rs`
- Create: `crates/slei-domain/src/run.rs`
- Create: `crates/slei-domain/src/permissions.rs`
- Create: `crates/slei-domain/src/mentions.rs`
- Modify: `crates/slei-domain/src/lib.rs`

- [ ] **Step 1: Write failing state-machine tests**

Cover:

- Task transitions: `Todo -> InProgress -> InReview -> Done -> Closed` and cancellation paths.
- Run transitions: `Queued -> Running -> WaitingApproval -> Running/Rejected -> terminal`.
- Message deletion: human content becomes tombstone with no recoverable body.
- Runtime context selection: tombstoned messages are excluded from any
  subsequent prompt/context projection.
- Workspace effective permissions: agent restriction can only reduce channel permission.
- Mention parsing: stable human/agent handles resolve without display-name ambiguity.

Run: `cargo test -p slei-domain`

Expected: FAIL because domain modules are absent.

- [ ] **Step 2: Implement entities without persistence concerns**

Create typed IDs and entities for `UserProfile`, `Node`, `Workspace`,
`Channel`, `Member`, `AgentProfile`, `Message`, `Task`, `ThreadReply`, `Run`,
`RuntimeSession`, `Delegation`, `Approval`, `Artifact` and
`InteractiveCard`.

- [ ] **Step 3: Implement transition and effective-access functions**

Functions must reject invalid transitions via domain errors; never silently
coerce state. Message deletion returns a tombstone record stripped of body.

- [ ] **Step 4: Verify state-machine behavior**

Run: `cargo test -p slei-domain`

Expected: PASS for all policy and transition tests.

- [ ] **Step 5: Commit**

```bash
git add crates/slei-domain
git commit -m "feat: add Slei domain state machines"
```

## Task 4: Create SQLite Persistence And Recovery Schema

**Files:**
- Create: `crates/slei-storage/src/db.rs`
- Create: `crates/slei-storage/src/migrations.rs`
- Create: `crates/slei-storage/src/repositories/mod.rs`
- Create: `crates/slei-storage/migrations/0001_initial.sql`
- Modify: `crates/slei-storage/src/lib.rs`

- [ ] **Step 1: Write failing migration and repository tests**

Use a temporary SQLite database and assert:

- migration produces all core tables and indexes;
- deleting a human message clears stored content and writes tombstone fields;
- `RuntimeSession.runtime_token` is nullable; Claude MVP writes `NULL`, while
  any future adapter value is ciphertext, cannot be found in raw SQLite bytes,
  and is not included in public timeline queries;
- deletion clears any message-derived prompt/context cache and persisted event
  payload; raw SQLite bytes no longer contain the deleted body;
- repeated mutations with one idempotency key return one entity/event result;
- event sequences persist and replay in increasing order;
- task/thread/message references survive reconnect-style reload.

Run: `cargo test -p slei-storage`

Expected: FAIL before migrations/repositories exist.

- [ ] **Step 2: Implement migration baseline**

Include tables for product entities plus `event_log`, `idempotent_mutations`,
`schema_migrations` and nullable encrypted runtime token metadata reserved for
future adapters. Claude MVP never fills the token column. Define a
`SecretCipher` interface in storage tests; the daemon later supplies a
per-install encryption key retrieved from system credential storage. Event
payloads must reference deleted messages by tombstone ID rather than copy
their body. Store artifact metadata only; file bytes will be handled in the
daemon plan.

- [ ] **Step 3: Implement narrow repositories**

Repository modules expose domain-focused operations, including
`delete_human_message_to_tombstone`, `append_event`, `events_after_sequence`,
`claim_idempotency_key`, `upsert_runtime_session` and `find_task_thread`.

- [ ] **Step 4: Verify persistence and recovery**

Run: `cargo test -p slei-storage`

Expected: PASS, including proof that deleted original message text is absent
from entity and event/context persistence and retries do not duplicate rows.

- [ ] **Step 5: Commit**

```bash
git add crates/slei-storage
git commit -m "feat: add local persistence baseline"
```

## Task 5: Establish Locale Resources And Boundary ADR

**Files:**
- Create: `packages/i18n/src/index.ts`
- Create: `packages/i18n/src/locales/zh-CN.json`
- Create: `packages/i18n/src/locales/en-US.json`
- Test: `packages/i18n/src/keys.test.ts`
- Create: `docs/architecture/0001-runtime-adapter-and-process-boundaries.md`

- [ ] **Step 1: Write failing locale parity test**

Test identical flattened key sets, `zh-CN` as default, and baseline keys for
navigation, task states, approvals, onboarding, error taxonomy and deleted
message tombstones.

Run: `pnpm --filter @slei/i18n test`

Expected: FAIL until resources exist.

- [ ] **Step 2: Add initial complete baseline resources**

Use Chinese UI vocabulary fixed by the spec (`频道`, `任务`, `执行记录`,
`运行节点`, `审批`, `消息已删除`), with matching English keys.

- [ ] **Step 3: Record the process boundary ADR**

Document:

- Rust daemon remains authoritative and independently launchable.
- Claude SDK runs in a daemon-managed TypeScript Worker.
- Desktop cannot call runtime workers directly.
- The Tauri Rust broker, not Webview JavaScript, owns daemon credentials and
  HTTP/WebSocket transport.
- Claude MVP uses Slei-owned reconstructed context with SDK transcript
  persistence/resume disabled to meet deletion semantics.
- OpenCode follows as the first expansion adapter; Codex requires app-server
  approval spike.
- MVP packaging must validate Worker launch without a developer Node install.

- [ ] **Step 4: Run full foundation verification**

Run:

```bash
pnpm test
pnpm typecheck
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/i18n docs/architecture/0001-runtime-adapter-and-process-boundaries.md
git commit -m "docs: establish runtime boundary and locale baseline"
```

## Completion Gate

- [ ] All five task commits exist and contain only foundation scope.
- [ ] Rust and TypeScript verification commands pass fresh.
- [ ] The schema represents all MVP entities without SDK-specific fields in public DTOs.
- [ ] Deleted human message content cannot be read back from messages, event
  payloads or runtime-context projections after deletion.
- [ ] Protocol/domain contracts include idempotency, correlated permission and
  active human-question request fields before daemon implementation begins.
- [ ] Proceed to `2026-05-27-slei-daemon-runtime-security.md`.
