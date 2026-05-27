# Slei MVP Roadmap Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the local-first Slei MVP as a bilingual Tauri desktop product backed by a Rust daemon and a Claude Agent SDK runtime worker.

**Architecture:** `slei-daemon` owns domain state, policy, persistence and local API authority. A Tauri Rust broker authenticates to daemon HTTP/WebSocket and exposes only typed commands/sanitized events to React; Webview code never receives control-plane credentials. A daemon-managed TypeScript Claude worker implements the runtime-neutral `RuntimeAdapter` boundary with SDK transcript persistence disabled and context reconstructed from Slei records.

**Tech Stack:** pnpm workspace, TypeScript, React, Vite, Tauri v2, Tailwind CSS, shadcn/ui, Zustand, TanStack Query, i18next, Rust/Cargo, Tokio, Axum, sqlx/SQLite, WebSocket, `@anthropic-ai/claude-agent-sdk`, Vitest, Playwright, cargo-nextest.

---

## Sources Of Truth

- Product architecture: `docs/superpowers/specs/2026-05-27-slei-product-architecture-design.md`
- UI/tokens: `docs/superpowers/specs/2026-05-27-slei-design-system.md`
- Runtime decision: Claude SDK Worker for MVP; OpenCode first expansion; Codex after approval-control spike.

## Plan Set

| Execution order | Plan | Covered modules | Demonstrable result |
| --- | --- | --- | --- |
| 1 | `2026-05-27-slei-foundation-contracts-storage.md` | M00, M09 foundation, M14 foundation, M15 boundary | Monorepo builds; protocol/domain/storage/i18n contracts exist; schema migrates |
| 2 | `2026-05-27-slei-daemon-runtime-security.md` | M04 node core, M05, M06, M08 engine, M15 runtime packaging | Broker-authenticated daemon works; isolated Claude Worker streams; headless approval/workspace/deletion gates are proven |
| 3 | `2026-05-27-slei-desktop-onboarding.md` | M01, M04 UI/bootstrap, M14, M16, design-system implementation | Desktop connects; bilingual setup/profile/computers onboarding works |
| 4 | `2026-05-27-slei-conversations-members.md` | M02, M03, Interactive Cards portion | Channels, agents, timeline, task thread and card confirmation work |
| 5 | `2026-05-27-slei-teamwork-task-ops.md` | M07, M08 UI closure, M10, M11 | Visible delegation, approvals in task context, board, files and skills view work |
| 6 | `2026-05-27-slei-quality-remote-boundary.md` | M12, M13, release acceptance | Diagnostics, security verification, packaging and future node boundary are documented/tested |

Do not start a later plan before the preceding plan's gate is green. An
exception is visual component work in Plan 3 after Plan 1 has established the
frontend toolchain; it must still consume protocol mocks until Plan 2 is green.

## Locked Repository Map

```text
Slei/
  apps/
    desktop/
      src/
        app/                    # router, providers, shell, query wiring
        features/               # onboarding, chat, tasks, members, computers, settings
        components/             # app-composed components only
        lib/                    # daemon client bindings, sanitization, notifications
        styles/                 # tokens and global CSS
        test/                   # render/e2e fixtures
      src-tauri/                # desktop capabilities and daemon launcher
  crates/
    adapter-api/                # provider-neutral runtime contract
    slei-domain/                # entities, policies and state machines
    slei-storage/               # SQLite repositories, migrations, asset storage
    slei-protocol/              # REST/WS DTOs, version and error contracts
    slei-daemon/                # Axum executable and application services
  packages/
    protocol-client/            # validated TypeScript client and event types
    i18n/                       # zh-CN/en-US bundles and key validation
    ui/                         # shared Neo-Brutalist primitives/tokens
  workers/
    claude-agent/               # official SDK process and private worker RPC
  tests/
    contract/                   # cross-language fixtures
    acceptance/                 # local MVP scenario tests
  docs/
    architecture/               # runtime packaging and remote-boundary ADRs
    superpowers/
      specs/
      plans/
```

Rules:

- `apps/desktop` Webview never talks directly to daemon/runtime workers, receives credentials, or opens arbitrary local paths; its Rust broker owns authenticated daemon transport.
- `workers/claude-agent` never persists domain entities or decides policy.
- Only `crates/slei-daemon` composes storage, policy, protocol and adapters.
- Protocol DTO changes require fixtures in `tests/contract/` and matching TS/Rust validation.
- All user-visible text originates in `packages/i18n`.

## Cross-Cutting Contracts To Establish First

| Contract | Owner | Mandatory fields/behavior |
| --- | --- | --- |
| `RuntimeAdapter` | `crates/adapter-api` | capabilities, Slei context scope, streamed events, cancel, correlated permission resolution and human-question resolution |
| `RuntimeSession` | domain/storage | `(channel_id or task_id, agent_id, runtime_kind, optional protected opaque_token)`; Claude MVP stores no native transcript/token and advertises no native resume |
| Local API envelope | `crates/slei-protocol` | protocol version, error code, localized key, request ID, idempotency key for mutations and event sequence |
| Local transport | Tauri Rust broker/daemon | protected runtime descriptor, native-only bearer/WS handshake, Webview receives IPC DTOs only |
| Permission decision | daemon | `request_id`/`run_id`/`tool_use_id`/`agent_id` correlation, effective workspace set, risk classification and authenticated human decision |
| Runtime confinement | Claude Worker | `persistSession: false`, `settingSources: []`, no native subagent/arbitrary plugin/external MCP; registered Slei MCP product tools only |
| Message deletion | domain/storage/worker | tombstone retained; deleted human body irreversibly absent from DB, event payloads, reconstructed context and worker/session files |
| Interactive Card | worker/daemon | only typed `slei_propose_interactive_card` MCP event can create a pending card; generated text never becomes an action |
| Artifact open | daemon/desktop | only daemon-issued artifact ID can become an OS open action; Markdown `file:` rejected |
| Locales | `packages/i18n` | complete `zh-CN` default and `en-US`; key parity test |

## Implementation Sequence

### Task 1: Establish the engineering baseline

**Plan:** `2026-05-27-slei-foundation-contracts-storage.md`

- [ ] Scaffold the pnpm/Cargo workspace and test harnesses.
- [ ] Write protocol, state-machine and schema tests before implementations.
- [ ] Implement domain entities, migration baseline, protected metadata and i18n key validation.
- [ ] Commit only after Rust and TypeScript baseline validation succeeds.

**Gate:** `pnpm test`, `pnpm typecheck`, `cargo test --workspace`, and
`cargo clippy --workspace --all-targets -- -D warnings` pass.

### Task 2: Make local execution trustworthy

**Plan:** `2026-05-27-slei-daemon-runtime-security.md`

- [ ] Implement native-broker-only authenticated local HTTP/WS surface and mutation idempotency.
- [ ] Implement runtime-neutral adapter service and daemon-managed Claude SDK Worker.
- [ ] Implement isolated SDK profile, typed Slei MCP tools, workspace/approval policy and prove prohibited operations or hidden delegation do not bypass it.
- [ ] Prove deletion cannot survive in reconstructed runtime context or worker persistence.
- [ ] Produce a clean-install macOS Worker-launch spike result.

**Gate:** local contract tests prove native transport isolation, run streaming,
cancellation, correlated approval allow/deny, zero-workspace restrictions,
external-path denial, no unregistered Claude capabilities and deletion
propagation. A failure blocks Desktop runtime-backed functionality.

### Task 3: Build the visible desktop foundation

**Plan:** `2026-05-27-slei-desktop-onboarding.md`

- [ ] Implement tokens/components, app shell, Tauri broker connection and locale switch.
- [ ] Implement user identity, Computers view and first-run onboarding.
- [ ] Bootstrap Guide Agent state only when runtime readiness is reported.

**Gate:** Playwright validates first launch in Chinese, English switch,
profile persistence, daemon disconnected state and ready-node onboarding.

### Task 4: Deliver conversation and setup workflows

**Plan:** `2026-05-27-slei-conversations-members.md`

- [ ] Implement channels/workspaces, Members editor and primary agent assignment.
- [ ] Implement streaming timeline, composer, Task root/thread and attachments.
- [ ] Consume daemon-validated Interactive Cards proposed only through the typed Slei MCP tool.

**Gate:** a user can create a no-workspace/read-only channel, chat, create a
Task, reply in its thread and confirm a typed Guide card without policy bypass;
controlled engineering operations are still disabled until Task 5 approval UI passes.

### Task 5: Deliver controlled team operations

**Plan:** `2026-05-27-slei-teamwork-task-ops.md`

- [ ] Implement visible delegation and human questions/mentions from typed Slei MCP events; native hidden subagents remain unavailable.
- [ ] Implement approval/attention presentation inside thread context.
- [ ] Implement Task Board/List, Files/Artifacts and Skills/Commands read views.

**Gate:** task delegation chains remain visible, cyclic delegation is rejected
by ancestor `agent_id`, approval UI resolves correlated requests, and only then
controlled workspace operations are enabled.

### Task 6: Harden and close the MVP

**Plan:** `2026-05-27-slei-quality-remote-boundary.md`

- [ ] Implement diagnostics, error localization and security regression suite.
- [ ] Validate packaging, local data recovery, accessibility and full bilingual flows.
- [ ] Write ADRs preserving the npm launcher / cloud node and future adapter boundaries.

**Gate:** all acceptance scenarios in the product spec pass locally
and no post-MVP behavior is accidentally shipped as active control surface.

## Required Execution Discipline

- Use `superpowers:test-driven-development` for each implementation task.
- Use `superpowers:systematic-debugging` for any failing test or unexpected runtime behavior.
- Use `superpowers:verification-before-completion` before every plan gate and commit.
- Keep commits at the task boundary named in each plan; never bundle user-authored spec edits into implementation commits without review.
- Preserve the user's currently uncommitted specification and design-system work until they approve its commit scope.

## Completion Gate

- [ ] Every subordinate plan gate passes in sequence; no documented failure is
  treated as a successful runtime or security gate.
- [ ] The privacy, native-transport, isolated-Worker, typed-product-tool,
  visible-delegation and mutation-idempotency contracts remain represented in
  the final acceptance suite.
- [ ] Only after the full local bilingual acceptance suite passes is the MVP
  eligible for release packaging or post-MVP adapter work.
