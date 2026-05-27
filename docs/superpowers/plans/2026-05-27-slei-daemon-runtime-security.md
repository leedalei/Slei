# Slei Daemon, Runtime Worker, And Security Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provide a separately running local daemon that safely executes Claude-backed runs with streamed events, Slei-reconstructed context and Slei-controlled approvals.

**Architecture:** Axum exposes an authenticated localhost REST/WebSocket control plane to the native Tauri broker only; a protected runtime descriptor contains endpoint identity without credentials. A daemon-supervised TypeScript Worker uses an explicit isolated `@anthropic-ai/claude-agent-sdk` profile (`persistSession: false`, no loaded settings/subagents/external MCP/plugins) and communicates through newline-delimited JSON RPC on child-process stdin/stdout. It emits runtime-neutral events and Slei MCP proposals while leaving `canUseTool` pending for daemon policy and human approval. This plan covers M04, M05, M06, M08 and the runtime portion of M15.

**Tech Stack:** Rust, Tokio, Axum, tower-http, sqlx, tokio-tungstenite, secrecy/keyring, TypeScript, Node-compatible packaged worker, `@anthropic-ai/claude-agent-sdk`, Vitest.

---

## Files Introduced By This Plan

```text
crates/slei-daemon/Cargo.toml
crates/slei-daemon/src/{main.rs,app.rs,config.rs,auth.rs,local_connection.rs,state.rs,error.rs}
crates/slei-daemon/src/api/{mod.rs,health.rs,nodes.rs,runs.rs,approvals.rs,workspaces.rs,events.rs}
crates/slei-daemon/src/services/{mod.rs,node_service.rs,workspace_service.rs,run_orchestrator.rs,approval_service.rs,artifact_service.rs}
crates/slei-daemon/src/adapters/{mod.rs,claude_worker.rs,worker_rpc.rs}
crates/slei-daemon/tests/{api_auth.rs,event_replay.rs,approval_flow.rs,workspace_boundary.rs,deletion_context.rs}
workers/claude-agent/package.json
workers/claude-agent/tsconfig.json
workers/claude-agent/src/{index.ts,protocol.ts,worker.ts,permissions.ts,context.ts,events.ts,slei-tools.ts}
workers/claude-agent/src/{permissions.test.ts,context.test.ts,events.test.ts,slei-tools.test.ts}
tests/contract/worker-rpc.json
docs/architecture/0002-claude-worker-packaging-spike.md
```

## Task 1: Expose An Authenticated Local Daemon Skeleton

**Files:**
- Create: `crates/slei-daemon/Cargo.toml`
- Create: `crates/slei-daemon/src/main.rs`
- Create: `crates/slei-daemon/src/app.rs`
- Create: `crates/slei-daemon/src/config.rs`
- Create: `crates/slei-daemon/src/auth.rs`
- Create: `crates/slei-daemon/src/local_connection.rs`
- Create: `crates/slei-daemon/src/state.rs`
- Create: `crates/slei-daemon/src/api/health.rs`
- Test: `crates/slei-daemon/tests/api_auth.rs`

- [ ] **Step 1: Write failing HTTP authentication tests**

Assert that `/health` reports daemon/protocol version without sensitive
configuration, while `/v1/nodes` rejects no token and accepts the native
broker's per-install bearer token. Assert the runtime descriptor contains
ephemeral port/instance/protocol metadata only and never contains the token.

Run: `cargo test -p slei-daemon --test api_auth`

Expected: FAIL because the daemon crate and router do not exist.

- [ ] **Step 2: Implement configuration, protected token and Axum router**

Bind only to an OS-selected ephemeral `127.0.0.1` port for MVP and atomically
publish an owner-only runtime descriptor. Create the daemon data directory
with owner-only permissions and store/read its token through a native
credential/token-store abstraction. No token may be placed in the descriptor,
URL, WebSocket protocol, logs or DTOs delivered to Webview code.

- [ ] **Step 3: Add single-instance and graceful shutdown behavior**

Reject a second daemon claiming the same data directory with a localized error
code; require an authenticated instance handshake before a broker trusts an
existing endpoint; shutdown completes active response flushing and database
close.

- [ ] **Step 4: Verify daemon skeleton**

Run: `cargo test -p slei-daemon --test api_auth`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add crates/slei-daemon
git commit -m "feat: add authenticated local daemon skeleton"
```

## Task 2: Implement Nodes, Workspaces, Events, And Reconnect

**Files:**
- Create: `crates/slei-daemon/src/api/nodes.rs`
- Create: `crates/slei-daemon/src/api/workspaces.rs`
- Create: `crates/slei-daemon/src/api/events.rs`
- Create: `crates/slei-daemon/src/services/node_service.rs`
- Create: `crates/slei-daemon/src/services/workspace_service.rs`
- Test: `crates/slei-daemon/tests/event_replay.rs`
- Test: `crates/slei-daemon/tests/workspace_boundary.rs`

- [ ] **Step 1: Write failing node/event/workspace tests**

Cover runtime readiness placeholders, explicit workspace registration,
canonicalized mount rejection for outside paths, authenticated native-broker
WebSocket sequence replay, the 24-hour replay cutoff and idempotent mutation
retry returning one entity/event.

Run: `cargo test -p slei-daemon --test event_replay --test workspace_boundary`

Expected: FAIL before endpoints/services exist.

- [ ] **Step 2: Implement service methods and versioned DTO endpoints**

Endpoints:

```text
GET  /v1/nodes
GET  /v1/nodes/:id
POST /v1/workspaces
GET  /v1/workspaces
GET  /v1/events/ws?after=<sequence>    # native broker connection only
```

Every persisted mutation requires a client idempotency key and appends one
event envelope with a stable sequence; retrying the same key returns its
recorded outcome without a second event.

- [ ] **Step 3: Implement path validation for daemon-owned operations**

Resolve paths and symlinks before accepting a registration/mount or artifact
request. Do not claim runtime mutation protection yet; that is proven in Task
5 through the SDK permission bridge.

- [ ] **Step 4: Verify API/replay behavior**

Run: `cargo test -p slei-daemon --test event_replay --test workspace_boundary`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add crates/slei-daemon/src/api crates/slei-daemon/src/services crates/slei-daemon/tests
git commit -m "feat: expose node workspace and event services"
```

## Task 3: Define Private Worker RPC And Claude SDK Event Mapping

**Files:**
- Create: `tests/contract/worker-rpc.json`
- Create: `workers/claude-agent/package.json`
- Create: `workers/claude-agent/tsconfig.json`
- Create: `workers/claude-agent/src/protocol.ts`
- Create: `workers/claude-agent/src/events.ts`
- Create: `workers/claude-agent/src/worker.ts`
- Create: `workers/claude-agent/src/index.ts`
- Test: `workers/claude-agent/src/events.test.ts`
- Create: `crates/slei-daemon/src/adapters/worker_rpc.rs`
- Create: `crates/slei-daemon/src/adapters/claude_worker.rs`

- [ ] **Step 1: Write failing Worker protocol/event tests**

Fixtures must cover `hello`, `start_run`, `output_delta`, `tool_started`,
`permission_requested`, `human_question_requested`, `product_tool_requested`,
`tool_completed`, `completed`, `failed`, `cancel`, `resolve_permission` and
`resolve_human_question`. Permission fixtures carry `request_id`, `run_id`,
`tool_use_id` and `agent_id`. Test that provider SDK event shapes are mapped
before crossing into daemon code.

Run: `pnpm --filter @slei/claude-agent test`

Expected: FAIL before Worker sources exist.

- [ ] **Step 2: Implement versioned private messages and Worker harness**

The daemon spawns the worker as a child process. Commands travel over stdin and
events over stdout as one JSON object per line; stderr is diagnostic-only and
must be scrubbed before daemon logs. The first command carries a per-launch
secret and protocol version. The worker receives a `RuntimeSession` and
authorized input and emits only Slei-neutral events. SDK imports stay within
`workers/claude-agent`.

- [ ] **Step 3: Write failing Rust adapter mapping tests**

Use a fake Worker transport to verify `start_run`, `cancel_run`,
`create_session`, optional `resume_session` capability rejection for Claude
MVP, correlation and event mapping. No test launches the real SDK yet.

Run: `cargo test -p slei-daemon claude_worker`

Expected: FAIL until `ClaudeWorkerAdapter` is implemented.

- [ ] **Step 4: Implement adapter transport and verify mapping**

Run:

```bash
pnpm --filter @slei/claude-agent test
cargo test -p slei-daemon claude_worker
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add workers/claude-agent tests/contract/worker-rpc.json crates/slei-daemon/src/adapters
git commit -m "feat: add Claude runtime worker protocol"
```

## Task 4: Implement Reconstructed Context, Streaming, Cancellation And Scrubbing

**Files:**
- Create: `workers/claude-agent/src/context.ts`
- Create: `workers/claude-agent/src/permissions.ts`
- Test: `workers/claude-agent/src/context.test.ts`
- Modify: `workers/claude-agent/src/worker.ts`
- Create: `crates/slei-daemon/src/services/run_orchestrator.rs`
- Create: `crates/slei-daemon/src/api/runs.rs`
- Test: `crates/slei-daemon/tests/deletion_context.rs`

- [ ] **Step 1: Write failing context, deletion and scrubber tests**

Test:

- context assembly scopes `(channel_id, agent_id)` and `(task_id, agent_id)`;
- separate newly assembled context for a delegated agent;
- `persistSession: false` is sent on every Claude query and no runtime
  transcript/resume token is emitted or stored;
- after deleting a sentinel human message, restart and a subsequent run do not
  expose that sentinel in raw SQLite bytes, event payloads, worker directories
  or reconstructed request context;
- secret text split across two output deltas is redacted before fan-out;
- cancel produces exactly one terminal `Cancelled` event.

Run: `pnpm --filter @slei/claude-agent test && cargo test -p slei-daemon run_orchestrator && cargo test -p slei-daemon --test deletion_context`

Expected: FAIL.

- [ ] **Step 2: Implement SDK query lifecycle**

Pass authorized `cwd` and `additionalDirectories`, use a daemon-managed empty
conversation directory for no-workspace channels, map stream events, and build
each request from undeleted Slei context records. Set `persistSession: false`;
Claude MVP writes no SDK transcript or opaque resume token to
SQLite/files/logs. Any interrupted run after restart becomes a terminal
failure/cancellation with a localized restart explanation.

- [ ] **Step 3: Implement rolling redaction and cancellation**

Perform redaction before WebSocket/storage fan-out with an overlap buffer.
Abort active SDK execution on cancellation and ignore duplicate late terminal
events.

- [ ] **Step 4: Verify session and run behavior**

Run: `pnpm --filter @slei/claude-agent test && cargo test -p slei-daemon run_orchestrator && cargo test -p slei-daemon --test deletion_context`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add workers/claude-agent crates/slei-daemon/src/services/run_orchestrator.rs crates/slei-daemon/src/api/runs.rs
git commit -m "feat: orchestrate private Claude run context"
```

## Task 5: Prove Workspace Policy And Human Approval Bridge

**Files:**
- Create: `crates/slei-daemon/src/services/approval_service.rs`
- Create: `crates/slei-daemon/src/api/approvals.rs`
- Test: `crates/slei-daemon/tests/approval_flow.rs`
- Modify: `workers/claude-agent/src/permissions.ts`
- Test: `workers/claude-agent/src/permissions.test.ts`
- Create: `workers/claude-agent/src/slei-tools.ts`
- Test: `workers/claude-agent/src/slei-tools.test.ts`

- [ ] **Step 1: Write failing permission matrix tests**

For `ReadOnly`, `Edit` and `Controlled`, simulate SDK `canUseTool` calls for
read, write, delete, Bash/network and outside-workspace paths. Assert:

- denied actions never invoke an allow response;
- controlled high-risk actions create `Approval` and remain pending;
- authenticated allow/deny resumes the exact pending run;
- an outside-workspace mutation is denied without prompting the user.
- a decision with mismatched `request_id`, `run_id`, `tool_use_id` or
  `agent_id` is denied and never resumes an active callback.

Run: `pnpm --filter @slei/claude-agent test && cargo test -p slei-daemon --test approval_flow`

Expected: FAIL.

- [ ] **Step 2: Implement the isolated SDK configuration profile**

Use explicit SDK options for every run: `persistSession: false`,
`settingSources: []`, no registered native subagents, no unapproved plugins or
external MCP servers, and fixed `allowedTools`/`disallowedTools`,
`permissionMode` and sandbox configuration per Slei preset. Register only
in-process Slei MCP tools: `slei_propose_interactive_card`,
`slei_request_visible_delegation` and `slei_request_human_reply`. Each creates
a typed pending daemon event; none directly mutates product state.

- [ ] **Step 3: Implement pending-callback and policy mapping**

Store daemon-side pending permission and human-question correlation by
`request_id`, `run_id`, `tool_use_id` and `agent_id`. The Worker forwards,
never decides, Slei policy. The Desktop-facing API exposes approval/question
descriptions without secrets.

- [ ] **Step 4: Add negative bypass and hidden-capability tests**

Attempt each prohibited tool under all configured SDK permission/policy
settings used by MVP. If any action can execute without callback interception,
or if native subagent/unregistered MCP/plugin/filesystem settings can be
loaded, fail this plan's gate. Also prove generated free-form text cannot
produce an Interactive Card or delegated run.

- [ ] **Step 5: Verify approval gate**

Run:

```bash
pnpm --filter @slei/claude-agent test
cargo test -p slei-daemon --test approval_flow --test workspace_boundary
```

Expected: PASS with strict capability enabled. Any unsupported guarantee is a
blocking result; no later runtime-backed plan may proceed.

- [ ] **Step 6: Commit**

```bash
git add crates/slei-daemon/src/services/approval_service.rs crates/slei-daemon/src/api/approvals.rs crates/slei-daemon/tests workers/claude-agent/src
git commit -m "feat: enforce runtime approval policy"
```

## Task 6: Validate Packaged Worker Launch

**Files:**
- Create: `docs/architecture/0002-claude-worker-packaging-spike.md`
- Modify: `workers/claude-agent/package.json`
- Modify: `crates/slei-daemon/src/config.rs`
- Test: `crates/slei-daemon/tests/worker_launch.rs`

- [ ] **Step 1: Write a failing clean-launch integration test**

Launch daemon with a temporary HOME/PATH that does not expose a developer Node
installation; request Worker readiness and capture failure if its packaged
runtime cannot launch.

Run: `cargo test -p slei-daemon --test worker_launch`

Expected: FAIL until a packaging strategy is configured.

- [ ] **Step 2: Spike and record the supported distribution strategy**

Choose only after verifying SDK compatibility:

- bundle a supported JavaScript runtime plus built Worker artifact; or
- use a validated standalone compiled Worker artifact.

The ADR records artifact layout, licensing/update implications, macOS signing
scope and why rejected options failed.

- [ ] **Step 3: Implement launch configuration and health detection**

Daemon must report Worker version/readiness and distinguish missing Worker,
failed SDK startup and missing Claude authentication.

- [ ] **Step 4: Verify this plan's gate**

Run:

```bash
pnpm --filter @slei/claude-agent test
cargo test -p slei-daemon
cargo clippy -p slei-daemon --all-targets -- -D warnings
```

Expected: PASS, including clean Worker launch. An inability to launch the
packaged Worker is a blocking result, not an accepted completion outcome.

- [ ] **Step 5: Commit**

```bash
git add docs/architecture/0002-claude-worker-packaging-spike.md workers/claude-agent crates/slei-daemon
git commit -m "build: validate Claude worker distribution"
```

## Completion Gate

- [ ] Native-broker-authenticated daemon API and WS events pass integration
  tests; descriptor/token never enters Webview DTOs.
- [ ] Claude Worker maps reconstructed context, typed product tools, streams,
  questions and cancellation without provider data leaking into Desktop contracts.
- [ ] Claude SDK transcript persistence is disabled and deletion regression
  proves deleted user text is absent after restart/subsequent run.
- [ ] `canUseTool` approval and denial are demonstrated for every MVP permission preset.
- [ ] Strict workspace confinement and absence of hidden subagent/MCP/plugin/settings paths are proven; otherwise MVP remains blocked.
- [ ] Clean-install Worker launch passes.
- [ ] Proceed to `2026-05-27-slei-desktop-onboarding.md`.
