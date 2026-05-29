# Slei Chinese Members MVP Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the desktop MVP Chinese-first by default, show only the `#all` default channel, and rebuild Members as a screenshot-aligned agent role management screen.

**Architecture:** Keep the current React desktop shell in `apps/desktop/src/app/SleiApp.tsx` and fixture source in `apps/desktop/src/app/fixtures.ts`. Add focused SSR tests under `apps/desktop/e2e` so the requirements are verifiable without browser automation. The Members view uses the existing shell context sidebar as the screenshot-like members navigator, while the workspace renders the selected member profile header, tabs, sections, and actions. Keep styles in `apps/desktop/src/app/app.css` and use semantic CSS variables only.

**Tech Stack:** React, TypeScript, Vitest SSR via `react-dom/server`, Vite, shared `@slei/ui` tokens.

---

### Task 1: Add Failing Acceptance Tests

**Files:**
- Create: `apps/desktop/e2e/chinese-members.spec.tsx`
- Modify: `apps/desktop/e2e/react-shell.spec.tsx`
- Modify: `apps/desktop/e2e/desktop-interactions.spec.tsx`

- [ ] **Step 1: Write tests for Chinese-first shell and single channel**

Add assertions that `SleiAppFrame` default fixture renders `# all`, Chinese channel description, Chinese composer labels, and does not render `# runtime` or `# mvp`.

- [ ] **Step 2: Write tests for Members management layout**

Add assertions for `slei-members-navigator`, `slei-member-detail`, selected `Coda`, `图谱`, `AGENTS`, `HUMANS`, `资料`, `权限`, `Agent 私信`, `提醒`, `工作区`, `应用`, `活动`, `显示名称`, `描述`, `信息`, `Runtime 配置`, `环境变量`, `创建的 Agent`, `正在加载技能`, `停止 Agent`, `重新启动 / 重置`, `复制诊断信息`.

- [ ] **Step 3: Run focused tests to verify red**

Run: `pnpm --filter @slei/desktop test -- chinese-members.spec.tsx react-shell.spec.tsx desktop-interactions.spec.tsx`

Expected: FAIL because UI is currently English, default fixtures include extra channels, and Members is card-grid based.

### Task 2: Update Fixture Model

**Files:**
- Modify: `apps/desktop/src/app/fixtures.ts`

- [ ] **Step 1: Keep only `#all` by default**

Remove `runtime` and `mvp` default channels. Set description to `所有成员的默认频道`.

- [ ] **Step 2: Extend member fixtures**

Add screenshot-backed members: `Coda` as selected agent, several additional agents, and human `lei lee`. Include `handle`, `avatar`, `description`, `computer`, `created`, `creator`, `runtime`, `model`, `instructions`, `permissions`, `environmentVariables`, `createdAgents`, and Chinese role/activity/capability labels.

- [ ] **Step 3: Run focused tests**

Run: `pnpm --filter @slei/desktop test -- chinese-members.spec.tsx`

Expected: Some tests may still fail until UI consumes the new fields.

### Task 3: Localize React Shell

**Files:**
- Modify: `apps/desktop/src/app/SleiApp.tsx`

- [ ] **Step 1: Localize nav/context/page strings**

Change visible/default labels to Chinese: `聊天`, `任务`, `成员`, `电脑`, `设置`, `频道`, `偏好设置`, etc.

- [ ] **Step 2: Localize Chat and Settings controls**

Change composer placeholder to `输入消息到 #all`, `发送`, `转为任务`; profile labels to `显示名称`, `@`, `头像`.

- [ ] **Step 3: Run focused tests**

Run: `pnpm --filter @slei/desktop test -- chinese-members.spec.tsx react-shell.spec.tsx desktop-interactions.spec.tsx`

Expected: Chinese/single-channel tests pass; Members layout may still fail until Task 4.

### Task 4: Rebuild Members Page To Screenshot Structure

**Files:**
- Modify: `apps/desktop/src/app/SleiApp.tsx`
- Modify: `apps/desktop/src/app/app.css`

- [ ] **Step 1: Replace generic context panel with members navigator**

Render `slei-members-navigator` in the shell sidebar when `activeView === "members"`. Include `图谱`, `AGENTS`, `HUMANS`, add buttons, selected row, status dots, and member summaries.

- [ ] **Step 2: Render selected member detail header and tabs**

Use fixture agent `Coda` as selected. Render identity header, action buttons, and tab strip: 资料, 权限, Agent 私信, 提醒, 工作区, 应用, 活动.

- [ ] **Step 3: Render screenshot-level Profile sections**

Render 显示名称, 描述, 信息, Runtime 配置, 环境变量, 创建的 Agent, 正在加载技能, 操作 sections. Include action buttons 停止 Agent, 重新启动 / 重置, 复制诊断信息.

- [ ] **Step 4: Style layout with semantic tokens**

Add CSS for member management layout using `var(--color-*)`, `var(--border-*)`, `var(--shadow-*)`, spacing tokens.

- [ ] **Step 5: Run focused tests**

Run: `pnpm --filter @slei/desktop test -- chinese-members.spec.tsx react-shell.spec.tsx desktop-interactions.spec.tsx`

Expected: PASS.

### Task 5: Full Verification

**Files:**
- No new files.

- [ ] **Step 1: Run type/lint**

Run: `pnpm --filter @slei/desktop lint && pnpm --filter @slei/desktop typecheck`

Expected: PASS.

- [ ] **Step 2: Run desktop tests and build**

Run: `pnpm --filter @slei/desktop test && pnpm --filter @slei/desktop build`

Expected: PASS.

- [ ] **Step 3: Run design-system test**

Run: `pnpm --filter @slei/ui test -- design-system.test.ts`

Expected: PASS.
