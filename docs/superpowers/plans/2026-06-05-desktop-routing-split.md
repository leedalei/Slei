# Desktop Routing Split Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the old `codex/desktop-routing-split` feature on top of current `master` without merging the stale branch.

**Architecture:** Keep `SleiApp.tsx` as the daemon/state owner and use React Router only for top-level browser paths. Keep `SleiAppFrame.tsx` as the shell/sidebar owner, while moving top-level workspace pages behind small route components under `apps/desktop/src/app/routes`.

**Tech Stack:** React 19, React Router, Vitest, Tauri desktop frontend.

---

### Task 1: Preserve The Old Routing Intent

**Files:**
- Delete branch: `codex/desktop-routing-split`
- Reference only: commit `393aed5`

- [x] Delete the stale branch with `git branch -D codex/desktop-routing-split`.
- [x] Use the old commit as a reference instead of merging it.
- [x] Preserve the intended behavior: browser paths for `chat`, `search`, `tasks`, `members`, `computers`, and `settings`.

### Task 2: Add Route Coverage First

**Files:**
- Create: `apps/desktop/e2e/routing.spec.tsx`

- [x] Add a failing route test for `routeItems`, `routePathForView`, and `routeViewFromPath`.
- [x] Add a failing SSR test using `MemoryRouter` and `SleiAppFrameRoutes`.
- [x] Add a structure test requiring top-level route component files outside `SleiAppFrame.tsx`.
- [x] Run `pnpm --filter @slei/desktop test -- e2e/routing.spec.tsx` and confirm it fails before implementation.

### Task 3: Add Browser Routing

**Files:**
- Modify: `apps/desktop/package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `apps/desktop/src/web.ts`
- Modify: `apps/desktop/src/app/router.ts`
- Modify: `apps/desktop/src/app/SleiApp.tsx`

- [x] Add `react-router` to the desktop app.
- [x] Wrap the desktop entry in `BrowserRouter`.
- [x] Replace manual history handling in `SleiApp.tsx` with `useLocation` and `useNavigate`.
- [x] Canonicalize unknown paths back to `/chat`.
- [x] Export `SleiAppFrameRoutes` for route-level SSR tests.

### Task 4: Split Top-Level Route Components

**Files:**
- Create: `apps/desktop/src/app/routes/ChatRoute.tsx`
- Create: `apps/desktop/src/app/routes/SearchRoute.tsx`
- Create: `apps/desktop/src/app/routes/TasksRoute.tsx`
- Create: `apps/desktop/src/app/routes/MembersRoute.tsx`
- Create: `apps/desktop/src/app/routes/ComputersRoute.tsx`
- Create: `apps/desktop/src/app/routes/SettingsRoute.tsx`
- Modify: `apps/desktop/src/app/SleiAppFrame.tsx`

- [x] Add route wrappers around the existing feature page components.
- [x] Keep the existing props and business behavior unchanged.
- [x] Update `SleiAppFrame.tsx` so workspace rendering returns route wrappers, not feature pages directly.

### Task 5: Verify

**Commands:**
- `pnpm --filter @slei/desktop test -- e2e/routing.spec.tsx`
- `pnpm --filter @slei/desktop typecheck`
- `pnpm --filter @slei/desktop test`
- `pnpm test`

- [x] Verify the new routing test passes.
- [x] Verify desktop typecheck passes.
- [x] Verify desktop tests pass.
- [x] Verify workspace tests pass.
