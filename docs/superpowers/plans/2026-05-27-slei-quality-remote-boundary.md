# Slei Quality, Packaging, And Remote Boundary Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the local MVP with diagnostics, security/accessibility verification, distributable packaging and explicit future remote-node/adapter boundaries.

**Architecture:** This plan adds no cloud operation. It makes local behavior observable and verifies the system promised by the spec, then records forward-compatible contracts for an npm-launched daemon and future OpenCode/Codex adapters. It covers M12 and M13 and final M15 acceptance.

**Tech Stack:** Rust diagnostics, React/Tauri, Playwright, axe-core, cargo audit/clippy/nextest, pnpm build/test, macOS application packaging, Markdown ADRs.

---

## Files Introduced By This Plan

```text
crates/slei-daemon/src/api/diagnostics.rs
crates/slei-daemon/src/services/diagnostics_service.rs
crates/slei-daemon/tests/{diagnostics.rs,security_regression.rs,recovery.rs}
apps/desktop/src/features/diagnostics/{DiagnosticsPage.tsx,ErrorPanel.tsx,LogExportDialog.tsx}
apps/desktop/src/features/search/BasicTimelineBrowse.tsx
apps/desktop/e2e/{diagnostics.spec.ts,accessibility.spec.ts,mvp-acceptance.spec.ts}
tests/acceptance/fixtures/*
docs/architecture/{0003-remote-node-boundary.md,0004-future-runtime-adapters.md,security-mvp-checklist.md}
scripts/{verify-locales.mjs,verify-contracts.mjs,verify-macos-package.sh}
.github/workflows/ci.yml
```

## Task 1: Implement Diagnostics And Localized Error Recovery

**Files:**
- Create: `crates/slei-daemon/src/api/diagnostics.rs`
- Create: `crates/slei-daemon/src/services/diagnostics_service.rs`
- Test: `crates/slei-daemon/tests/diagnostics.rs`
- Create: `apps/desktop/src/features/diagnostics/DiagnosticsPage.tsx`
- Create: `apps/desktop/src/features/diagnostics/ErrorPanel.tsx`
- Create: `apps/desktop/src/features/diagnostics/LogExportDialog.tsx`
- Create: `apps/desktop/src/features/search/BasicTimelineBrowse.tsx`
- Test: `apps/desktop/e2e/diagnostics.spec.ts`

- [ ] **Step 1: Write failing diagnostics/security-of-logs tests**

Assert daemon exposes node/runtime/worker/protocol/schema status and sanitized
failure summaries; logs never expose token, absolute workspace path, request
body or output delta content. Assert errors `E1xx-E4xx` render actionable
bilingual UI.

Run: `cargo test -p slei-daemon --test diagnostics && pnpm --filter @slei/desktop test:e2e -- diagnostics.spec.ts`

Expected: FAIL.

- [ ] **Step 2: Implement diagnostics endpoint and Desktop panels**

Add paginated timeline browsing only; do not introduce full-text search beyond
MVP scope. Exports must be sanitized before writing user-accessible files.

- [ ] **Step 3: Verify and commit**

Run: `cargo test -p slei-daemon --test diagnostics && pnpm --filter @slei/desktop test:e2e -- diagnostics.spec.ts`

Expected: PASS.

```bash
git add crates/slei-daemon/src/api/diagnostics.rs crates/slei-daemon/src/services/diagnostics_service.rs crates/slei-daemon/tests/diagnostics.rs apps/desktop/src/features/diagnostics apps/desktop/src/features/search
git commit -m "feat: add diagnostics and recovery views"
```

## Task 2: Implement Security And Recovery Regression Suite

**Files:**
- Create: `crates/slei-daemon/tests/security_regression.rs`
- Create: `crates/slei-daemon/tests/recovery.rs`
- Create: `apps/desktop/e2e/accessibility.spec.ts`
- Create: `docs/architecture/security-mvp-checklist.md`

- [ ] **Step 1: Write security regression cases**

Cover:

- symlink/path traversal rejection;
- outside-workspace tool denial before execution;
- secret split across stream chunks never appears in WS/storage;
- deleted message body absent from database, event payloads, reconstructed
  context and Worker/session files after restart and a subsequent run;
- SDK profile cannot load native subagents, unregistered MCP/plugins or
  filesystem settings; product cards/delegation require typed Slei MCP events;
- native broker transport never exposes daemon token/endpoint/socket to the
  Webview and CSP/capabilities forbid direct network/shell/filesystem access;
- mutation reconnect retries cannot duplicate messages/tasks/cards/approvals/runs;
- approval decision authenticated and correlated by request/run/tool/agent;
- arbitrary Markdown `file:`/`javascript:` stripped;
- notification content excludes sensitive command/path detail;
- token/data/log permissions are owner-only.

Run: `cargo test -p slei-daemon --test security_regression --test recovery`

Expected: FAIL for any missing enforcement/test harness.

- [ ] **Step 2: Add accessibility E2E test matrix**

Use axe checks and keyboard flows for shell, onboarding, Chat/Thread, Tasks,
Members, Computers, Settings and Approval Modal in `zh-CN` and `en-US`;
verify reduced motion behavior.

Run: `pnpm --filter @slei/desktop test:e2e -- accessibility.spec.ts`

Expected: FAIL until covered screens comply.

- [ ] **Step 3: Fix only failures required by the regression matrix**

Do not broaden feature scope; patch security, semantics, focus management,
translations or recovery paths revealed by failing tests.

- [ ] **Step 4: Verify and document checklist evidence**

Run:

```bash
cargo test -p slei-daemon --test security_regression --test recovery
pnpm --filter @slei/desktop test:e2e -- accessibility.spec.ts
```

Expected: PASS. Record command/evidence headings in
`docs/architecture/security-mvp-checklist.md`, without embedding secrets.

- [ ] **Step 5: Commit**

```bash
git add crates/slei-daemon/tests apps/desktop/e2e/accessibility.spec.ts docs/architecture/security-mvp-checklist.md
git commit -m "test: add MVP security and accessibility gates"
```

## Task 3: Preserve Future Remote Node And Runtime Adapter Boundaries

**Files:**
- Create: `docs/architecture/0003-remote-node-boundary.md`
- Create: `docs/architecture/0004-future-runtime-adapters.md`
- Modify: `crates/adapter-api/src/lib.rs`
- Test: `crates/adapter-api/src/lib.rs`

- [ ] **Step 1: Write failing capability/serialization contract tests**

Test that `OpenCode` and `Codex` runtime kinds and capability flags serialize
without active implementation; no UI/daemon route treats them as ready unless
an installed adapter reports readiness.

Run: `cargo test -p adapter-api`

Expected: FAIL if future discriminants/capability guards are missing.

- [ ] **Step 2: Document remote boundary without implementing it**

ADR 0003 specifies later:

```bash
npx @slei-ai/daemon@latest --server-url <url> --api-key <secret>
```

It must define outbound secure node transport, credential storage, pairing or
revocation migration and sync-eligible data, while explicitly marking all
cloud routes out of MVP.

- [ ] **Step 3: Document adapter expansion order**

ADR 0004 specifies:

- OpenCode first after MVP through `@opencode-ai/sdk` server/client and
  permission endpoints;
- native Codex only after testing `codex app-server` command/file approvals
  against Slei UI requirements, with `@openai/codex-sdk` considered for basic
  thread execution;
- CLI text/JSON parsing only when an official programmatic interface is absent.

- [ ] **Step 4: Verify and commit**

Run: `cargo test -p adapter-api`

Expected: PASS; documentation contains no shipped cloud endpoint assumption.

```bash
git add crates/adapter-api docs/architecture/0003-remote-node-boundary.md docs/architecture/0004-future-runtime-adapters.md
git commit -m "docs: preserve future node and runtime boundaries"
```

## Task 4: Add CI And Clean macOS Packaging Verification

**Files:**
- Create: `.github/workflows/ci.yml`
- Create: `scripts/verify-locales.mjs`
- Create: `scripts/verify-contracts.mjs`
- Create: `scripts/verify-macos-package.sh`
- Modify: `apps/desktop/package.json`
- Modify: `apps/desktop/src-tauri/tauri.conf.json`
- Test: `apps/desktop/e2e/mvp-acceptance.spec.ts`

- [ ] **Step 1: Write final acceptance E2E scenarios**

Cover all product acceptance scenarios: onboarding, Guide Agent,
workspace/channel/agent setup, casual chat, multi-workspace Task thread,
visible delegation, human mention, Approval, Board/List, artifacts, restart
recovery, bilingual flow, local-only daemon boundary, deletion non-recovery,
isolated Worker/product-tool path and idempotent reconnect retry.

Run: `pnpm --filter @slei/desktop test:e2e -- mvp-acceptance.spec.ts`

Expected: FAIL until fixtures/setup and remaining issues are handled.

- [ ] **Step 2: Configure CI checks**

CI runs:

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo nextest run --workspace
pnpm --filter @slei/desktop build
```

Install `cargo-nextest` in CI before that command, or use `cargo test
--workspace` until the install step is added. Run macOS-specific Tauri
packaging/acceptance on a macOS runner only.

- [ ] **Step 3: Verify clean package layout**

`verify-macos-package.sh` confirms the app can start daemon and packaged Claude
Worker on a clean environment without a developer Node path, that configuration
directories/runtime descriptor use required permissions, that Webview
capabilities expose no general sidecar/shell/network path, and that no cloud
control behavior is enabled.

- [ ] **Step 4: Run full local verification**

Run:

```bash
pnpm lint
pnpm typecheck
pnpm test
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo nextest run --workspace
pnpm --filter @slei/desktop test:e2e -- mvp-acceptance.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/ci.yml scripts apps/desktop
git commit -m "build: add MVP quality and packaging gates"
```

## Completion Gate

- [ ] Diagnostics are actionable and sanitize sensitive data.
- [ ] Security, recovery, accessibility and bilingual regression suites pass.
- [ ] Deletion non-recovery, isolated Claude configuration, broker credential
  isolation and mutation-idempotency gates pass before release.
- [ ] npm launcher/cloud node and OpenCode/Codex plans are preserved as inactive documented boundaries only.
- [ ] Clean macOS package demonstrates Desktop, daemon and Claude Worker lifecycle.
- [ ] Every acceptance scenario from the product spec has passing fresh evidence before declaring MVP complete.
