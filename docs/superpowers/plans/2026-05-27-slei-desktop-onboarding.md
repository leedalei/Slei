# Slei Desktop Shell, Identity, And Onboarding Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the bilingual Neo-Brutalist desktop shell, local daemon connectivity, user identity settings, Computers view and first-run Guide Agent setup.

**Architecture:** React is a non-authoritative view over a narrow Tauri Rust broker. The broker discovers/authenticates the daemon, owns HTTP/WebSocket transport and emits sanitized typed events; the Webview never receives daemon secrets or general shell/network capability. Shared UI tokens implement the supplied visual design while feature folders own product screens. Onboarding creates user identity and observes daemon/runtime readiness; Guide Agent bootstrap remains a daemon command/result rather than a UI-side fiction. This plan covers M01, M14 and M16 plus the UI-facing portion of M04.

**Tech Stack:** Tauri v2, Vite, React, TypeScript, Tailwind CSS, shadcn/ui, Zustand, TanStack Query, i18next, Vitest, Testing Library, Playwright.

---

## Files Introduced By This Plan

```text
apps/desktop/package.json
apps/desktop/vite.config.ts
apps/desktop/src/{main.tsx,app/App.tsx,app/router.tsx,app/providers.tsx}
apps/desktop/src-tauri/{Cargo.toml,tauri.conf.json,src/lib.rs,src/daemon_broker.rs,src/commands.rs,capabilities/default.json}
apps/desktop/src/lib/{daemon-bridge.ts,event-bridge.ts,query-client.ts,notifications.ts}
apps/desktop/src/features/shell/{AppShell.tsx,PrimaryNav.tsx,PanelLayout.tsx}
apps/desktop/src/features/onboarding/{OnboardingPage.tsx,ProfileStep.tsx,ConnectionStep.tsx,RuntimeStep.tsx}
apps/desktop/src/features/settings/{SettingsPage.tsx,ProfileForm.tsx,LanguageSettings.tsx,NotificationSettings.tsx}
apps/desktop/src/features/computers/{ComputersPage.tsx,NodeList.tsx,NodeProfile.tsx}
packages/ui/src/{index.ts,styles/tokens.css,styles/globals.css,components/*.tsx}
packages/ui/src/components/*.test.tsx
packages/i18n/src/locales/{zh-CN.json,en-US.json}
apps/desktop/e2e/{shell.spec.ts,onboarding.spec.ts,settings.spec.ts}
```

## Task 1: Scaffold Desktop, Tauri Capabilities And Daemon Client

**Files:**
- Create: `apps/desktop/package.json`
- Create: `apps/desktop/vite.config.ts`
- Create: `apps/desktop/src/main.tsx`
- Create: `apps/desktop/src/app/App.tsx`
- Create: `apps/desktop/src/app/providers.tsx`
- Create: `apps/desktop/src/lib/daemon-bridge.ts`
- Create: `apps/desktop/src/lib/event-bridge.ts`
- Create: `apps/desktop/src-tauri/src/daemon_broker.rs`
- Create: `apps/desktop/src-tauri/src/commands.rs`
- Create: `apps/desktop/src-tauri/tauri.conf.json`
- Create: `apps/desktop/src-tauri/capabilities/default.json`
- Test: `apps/desktop/e2e/shell.spec.ts`

- [ ] **Step 1: Write failing desktop connectivity test**

With a mocked Rust broker, test that the shell renders Chinese by default,
shows connected/offline states and reconnects event delivery from the last
sequence. Add native tests proving the broker alone reads the descriptor/token,
authenticates daemon HTTP/WS and never returns token/socket/endpoint secrets in
an invoke response or Webview event.

Run: `pnpm --filter @slei/desktop test:e2e -- shell.spec.ts`

Expected: FAIL because the desktop app does not exist.

- [ ] **Step 2: Scaffold app providers and validated daemon client**

Create Query/i18n/router providers and consume only `@slei/protocol-client`
types through typed Tauri invokes/events. Rust implements daemon lifecycle,
handshake, HTTP/WS reconnect and sanitized DTO forwarding. Tauri CSP allows
only bundled assets plus `ipc:`; it does not allow Webview daemon or external
network connectivity.

- [ ] **Step 3: Restrict Tauri capabilities**

Expose narrow application commands for broker query/mutation, validated
artifact open and notification display. Generic sidecar/shell, HTTP, process
and filesystem permissions are not exposed to Webview code; daemon launch and
OS open happen inside validating Rust handlers.

- [ ] **Step 4: Verify connectivity shell**

Run: `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml && pnpm --filter @slei/desktop test:e2e -- shell.spec.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop packages/protocol-client
git commit -m "feat: scaffold desktop daemon connection"
```

## Task 2: Implement Tokens And Accessible UI Primitives

**Files:**
- Create: `packages/ui/src/styles/tokens.css`
- Create: `packages/ui/src/styles/globals.css`
- Modify: `docs/superpowers/specs/2026-05-27-slei-design-system.md`
- Create: `packages/ui/src/index.ts`
- Create: `packages/ui/src/components/Button.tsx`
- Create: `packages/ui/src/components/Input.tsx`
- Create: `packages/ui/src/components/Dialog.tsx`
- Create: `packages/ui/src/components/Badge.tsx`
- Create: `packages/ui/src/components/Avatar.tsx`
- Create: `packages/ui/src/components/Tabs.tsx`
- Test: `packages/ui/src/components/primitives.test.tsx`

- [ ] **Step 1: Resolve design-system implementation blockers before styling**

Normalize the design-system specification to semantic tokens only, replacing
primitive token references currently used by component recipes; define visible
focus rings, keyboard behavior, contrast checks and
`prefers-reduced-motion` behavior. This documentation correction is a blocking
review checkpoint before UI primitive implementation is accepted and must be
committed separately from component code.

```bash
git add docs/superpowers/specs/2026-05-27-slei-design-system.md
git commit -m "docs: normalize Slei semantic token contract"
```

- [ ] **Step 2: Write failing accessibility/component tests**

Test keyboard focus, dialog focus trap/escape, button disabled state, semantic
token class usage and reduced-motion CSS behavior.

Run: `pnpm --filter @slei/ui test`

Expected: FAIL until primitives exist.

- [ ] **Step 3: Implement UI primitives and token CSS**

Use the supplied Neo-Brutalist hierarchy: high contrast, solid borders, hard
shadows and semantic tokens. Do not embed product language inside primitives.

- [ ] **Step 4: Verify component behavior and basic accessibility**

Run: `pnpm --filter @slei/ui test`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ui
git commit -m "feat: add accessible Slei UI foundations"
```

## Task 3: Build Navigation Shell And Computers View

**Files:**
- Create: `apps/desktop/src/features/shell/AppShell.tsx`
- Create: `apps/desktop/src/features/shell/PrimaryNav.tsx`
- Create: `apps/desktop/src/features/shell/PanelLayout.tsx`
- Create: `apps/desktop/src/features/computers/ComputersPage.tsx`
- Create: `apps/desktop/src/features/computers/NodeList.tsx`
- Create: `apps/desktop/src/features/computers/NodeProfile.tsx`
- Modify: `apps/desktop/src/app/router.tsx`
- Test: `apps/desktop/src/features/computers/ComputersPage.test.tsx`

- [ ] **Step 1: Write failing screen tests**

Render node fixtures for disconnected, daemon-ready and Claude-adapter-ready
states. Assert localized labels, runtime capability display, workspace
registration action and hosted-agent list placeholders.

Run: `pnpm --filter @slei/desktop test -- ComputersPage`

Expected: FAIL.

- [ ] **Step 2: Implement shell and Computers queries/events**

Primary navigation exposes Chat, Tasks, Members, Computers and Settings;
selection state survives routing. Computers reads readiness from daemon rather
than guessing from local UI state.

- [ ] **Step 3: Verify UI and event-driven refresh**

Run: `pnpm --filter @slei/desktop test -- ComputersPage`

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/features/shell apps/desktop/src/features/computers apps/desktop/src/app
git commit -m "feat: add desktop shell and computers view"
```

## Task 4: Implement Settings, User Identity And I18n Switching

**Files:**
- Create: `crates/slei-daemon/src/api/settings.rs`
- Create: `crates/slei-daemon/src/services/settings_service.rs`
- Test: `crates/slei-daemon/tests/settings_identity.rs`
- Create: `apps/desktop/src/features/settings/SettingsPage.tsx`
- Create: `apps/desktop/src/features/settings/ProfileForm.tsx`
- Create: `apps/desktop/src/features/settings/LanguageSettings.tsx`
- Create: `apps/desktop/src/features/settings/NotificationSettings.tsx`
- Modify: `packages/i18n/src/locales/zh-CN.json`
- Modify: `packages/i18n/src/locales/en-US.json`
- Test: `apps/desktop/e2e/settings.spec.ts`

- [ ] **Step 1: Write failing identity/i18n E2E tests**

Assert nickname, avatar/basic info and immutable unique `@handle` save through
the daemon; switching locale updates every visible settings/shell string and
persists across reload.

Also assert at the daemon boundary that a single local profile is created,
handle mutation is rejected after onboarding, and locale/notification
preferences round trip through authenticated API calls.

Run:

```bash
cargo test -p slei-daemon --test settings_identity
pnpm --filter @slei/desktop test:e2e -- settings.spec.ts
```

Expected: FAIL.

- [ ] **Step 2: Implement daemon profile/preference API and forms**

Validate handle syntax and display a clear immutability confirmation during
creation. Notification toggles cover mention, human reply and approval.
Endpoints are `GET/PUT /v1/settings/profile` and
`GET/PUT /v1/settings/preferences`; daemon validation is authoritative.

- [ ] **Step 3: Verify settings behavior**

Run: `cargo test -p slei-daemon --test settings_identity && pnpm --filter @slei/desktop test:e2e -- settings.spec.ts && pnpm --filter @slei/i18n test`

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add crates/slei-daemon/src/api/settings.rs crates/slei-daemon/src/services/settings_service.rs crates/slei-daemon/tests/settings_identity.rs apps/desktop/src/features/settings packages/i18n
git commit -m "feat: add identity and localization settings"
```

## Task 5: Implement First-Run Onboarding And Guide Agent Bootstrap

**Files:**
- Create: `apps/desktop/src/features/onboarding/OnboardingPage.tsx`
- Create: `apps/desktop/src/features/onboarding/ProfileStep.tsx`
- Create: `apps/desktop/src/features/onboarding/ConnectionStep.tsx`
- Create: `apps/desktop/src/features/onboarding/RuntimeStep.tsx`
- Modify: `apps/desktop/src/app/router.tsx`
- Modify: `crates/slei-daemon/src/services/node_service.rs`
- Test: `apps/desktop/e2e/onboarding.spec.ts`
- Test: `crates/slei-daemon/tests/guide_bootstrap.rs`

- [ ] **Step 1: Write failing first-run tests**

Cover:

- no profile redirects to onboarding in Chinese;
- user can switch English before saving identity;
- daemon offline prevents completion with actionable status;
- runtime unavailable does not create Guide Agent;
- first Claude-adapter-ready node creates exactly one Guide Agent and default
  channel;
- later reconnect does not duplicate bootstrap entities.

Run:

```bash
pnpm --filter @slei/desktop test:e2e -- onboarding.spec.ts
cargo test -p slei-daemon --test guide_bootstrap
```

Expected: FAIL.

- [ ] **Step 2: Implement onboarding state and daemon bootstrap command**

The daemon owns idempotent entity creation. The Desktop presents setup status
and navigates to the default channel after receiving the bootstrap event.
Interactive Card content is added in the conversation plan, not fabricated here.

- [ ] **Step 3: Verify onboarding and full desktop plan gate**

Run:

```bash
pnpm --filter @slei/desktop test
pnpm --filter @slei/desktop test:e2e
pnpm --filter @slei/ui test
pnpm --filter @slei/i18n test
cargo test -p slei-daemon --test guide_bootstrap
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/features/onboarding apps/desktop/src/app crates/slei-daemon/tests/guide_bootstrap.rs crates/slei-daemon/src/services/node_service.rs
git commit -m "feat: add first-run onboarding"
```

## Completion Gate

- [ ] Desktop loads while daemon is unavailable and clearly guides recovery.
- [ ] Design primitives meet keyboard/focus/reduced-motion checks.
- [ ] Chinese is default and English has complete visible coverage.
- [ ] User identity and mention handle persist; handle cannot silently mutate.
- [ ] Native broker owns daemon authentication/event transport; Webview
  capabilities and CSP cannot reach daemon, arbitrary shell or filesystem APIs.
- [ ] Guide Agent/default channel bootstrap is idempotent and runtime-readiness driven.
- [ ] Proceed to `2026-05-27-slei-conversations-members.md`.
