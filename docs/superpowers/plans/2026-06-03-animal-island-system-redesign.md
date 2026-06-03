# Animal Island System Redesign Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild Slei Desktop's visual system around the npm `animal-island-ui` package while preserving existing product behavior.

**Architecture:** Add `animal-island-ui` as the visual dependency and import its stylesheet once in the desktop web entry. Keep Slei's semantic token and `.slei-*` component API as the product-facing design layer, rewriting token values, global component styles, theme handling, and product CSS to match Animal Island light and dark themes. Normalize legacy theme values to a two-theme product surface without changing daemon bridge contracts unnecessarily.

**Tech Stack:** pnpm workspace, React 19, Vite 7, Tauri 2, TypeScript, Vitest, CSS custom properties, `animal-island-ui`.

---

## File Structure

### Dependency and Entry

- Modify `apps/desktop/package.json`: add `animal-island-ui` dependency.
- Modify `pnpm-lock.yaml`: update through `pnpm --filter @slei/desktop add animal-island-ui`.
- Modify `apps/desktop/src/web.ts`: import `animal-island-ui/style` before Slei style overrides.

### Theme Model and Settings

- Modify `apps/desktop/src/app/model.ts`: set `defaultAppearance.theme` to `light`, add a small normalization helper if implementation needs one.
- Modify `apps/desktop/src/app/SleiAppFrame.tsx`: apply normalized theme to `data-theme`.
- Modify `apps/desktop/src/app/SleiApp.tsx`: normalize preferences loaded from bridge and outgoing appearance updates if needed.
- Modify `apps/desktop/src/features/settings/SettingsPageView.tsx`: expose only light and dark theme options.
- Modify `apps/desktop/src/i18n/types.ts`, `apps/desktop/src/i18n/messages/en-US/settings.ts`, `apps/desktop/src/i18n/messages/zh-CN/settings.ts`: remove visible `themeSystem` and `themeHighContrast` requirements only if TypeScript allows clean removal; otherwise leave translations unused for bridge compatibility.
- Modify `apps/desktop/src/lib/daemon-bridge.ts`: keep legacy union if daemon contract still emits it, but ensure mocks/defaults can support the new product default.

### Shared Design System

- Modify `packages/ui/src/styles/tokens.css`: replace neo-brutalist token values with Animal Island light and dark token values while preserving semantic variable names.
- Modify `packages/ui/src/styles/globals.css`: restyle shared `.slei-*` components to rounded Animal Island controls, cards, panels, dialogs, badges, avatars, inputs, selects, and checkboxes.
- Modify `packages/ui/src/styles/design-system.test.ts`: update assertions away from square radii and hard black shadows.

### Desktop Product Styles

- Modify `apps/desktop/src/app/app.css`: restyle shell, rail, context sidebar, workspace headers, chat timeline, composer, tabs, task board, drawers, members, computers, settings, search, attachments, empty state, crash state, scrollbars, and theme overrides.
- Modify selected React components only if class structure is insufficient for styling. Prefer CSS-first changes and preserve ARIA/testable content.
- Preserve `apps/desktop/src/components/Empty.tsx` pixel face markup; restyle it in CSS only unless a tiny class hook is required.

### Tests

- Modify `apps/desktop/e2e/design-system.spec.ts`: assert Animal Island dependency/style import and token wiring.
- Modify `apps/desktop/e2e/settings-preferences.spec.tsx`: assert only light/dark options render and legacy theme normalization behavior if exposed through render tests.
- Modify `apps/desktop/e2e/react-shell.spec.tsx`: rename neo-brutalist wording and relax style-specific assertions that conflict with the new system.
- Run focused desktop e2e/vitest files and typechecks.

---

## Task 1: Add `animal-island-ui` and Import Its Styles

**Files:**
- Modify: `apps/desktop/package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `apps/desktop/src/web.ts`
- Test: `apps/desktop/e2e/design-system.spec.ts`

- [ ] **Step 1: Update the design-system wiring test first**

In `apps/desktop/e2e/design-system.spec.ts`, change the first test name and import assertions:

```ts
it("loads Animal Island styles before Slei semantic overrides", () => {
  const webEntry = readFileSync("src/web.ts", "utf8");
  const appCss = readFileSync("src/app/app.css", "utf8");
  const formControlsTsx = readFileSync("src/components/FormControls.tsx", "utf8");
  const tokensCss = readFileSync("../../packages/ui/src/styles/tokens.css", "utf8");

  expect(webEntry).toContain("animal-island-ui/style");
  expect(webEntry.indexOf("animal-island-ui/style")).toBeLessThan(webEntry.indexOf("@slei/ui/styles/tokens.css"));
  expect(webEntry).toContain("@slei/ui/styles/tokens.css");
  expect(webEntry).toContain("@slei/ui/styles/globals.css");
  expect(webEntry).not.toContain("./web.css");
  expect(appCss).toContain("var(--color-accent)");
  expect(appCss).toContain("var(--border-panel)");
  expect(appCss).toContain("var(--shadow-lg)");
  expect(appCss).not.toMatch(/#[0-9a-fA-F]{3,8}/);
  expect(formControlsTsx.match(/<select/g)).toHaveLength(1);
  expect(formControlsTsx).toContain("function SelectControl");
  expect(formControlsTsx.match(/type=\"checkbox\"/g)).toHaveLength(1);
  expect(formControlsTsx).toContain("function CheckboxControl");
  expect(tokensCss).toContain("--rail-width: 80px;");
  expect(tokensCss).toContain("--sidebar-width: 240px;");
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
pnpm --filter @slei/desktop test -- e2e/design-system.spec.ts
```

Expected: FAIL because `animal-island-ui/style` is not imported yet.

- [ ] **Step 3: Install the npm dependency**

Run:

```bash
pnpm --filter @slei/desktop add animal-island-ui
```

Expected: `apps/desktop/package.json` and `pnpm-lock.yaml` change.

- [ ] **Step 4: Import the package stylesheet**

In `apps/desktop/src/web.ts`, import Animal Island styles before Slei overrides:

```ts
import "animal-island-ui/style";
import "@slei/ui/styles/tokens.css";
import "@slei/ui/styles/globals.css";
```

- [ ] **Step 5: Run the focused test**

Run:

```bash
pnpm --filter @slei/desktop test -- e2e/design-system.spec.ts
```

Expected: PASS.

- [ ] **Step 6: Commit dependency and import**

```bash
git add apps/desktop/package.json pnpm-lock.yaml apps/desktop/src/web.ts apps/desktop/e2e/design-system.spec.ts
git commit -m "feat: add animal island ui dependency"
```

---

## Task 2: Normalize Theme Choices to Light and Dark

**Files:**
- Modify: `apps/desktop/src/app/model.ts`
- Modify: `apps/desktop/src/app/SleiApp.tsx`
- Modify: `apps/desktop/src/app/SleiAppFrame.tsx`
- Modify: `apps/desktop/src/features/settings/SettingsPageView.tsx`
- Modify: `apps/desktop/src/lib/daemon-bridge.ts` if mock defaults still use `system`
- Test: `apps/desktop/e2e/settings-preferences.spec.tsx`

- [ ] **Step 1: Write failing settings assertions**

In `apps/desktop/e2e/settings-preferences.spec.tsx`, extend `renders appearance controls and about metadata`:

```ts
expect(appearanceHtml).toContain('option value="light"');
expect(appearanceHtml).toContain('option value="dark"');
expect(appearanceHtml).not.toContain('option value="system"');
expect(appearanceHtml).not.toContain('option value="highContrast"');
```

Add a new test for legacy fallback:

```ts
it("normalizes legacy appearance themes to light", () => {
  const html = renderToStaticMarkup(
    <SleiAppFrame
      activeView="settings"
      appearance={{ theme: "highContrast", fontSize: "md" }}
      data={data}
      initialSettingsPanel="appearance"
      locale="zh-CN"
      runtimeSetup={readyRuntime}
    />,
  );

  expect(html).toContain('data-theme="light"');
  expect(html).toContain('option value="light" selected=""');
});
```

If React static markup does not serialize `selected=""` for the `SelectControl`, assert the absence of `value="highContrast"` and the shell `data-theme="light"` instead.

- [ ] **Step 2: Run the settings test and verify it fails**

Run:

```bash
pnpm --filter @slei/desktop test -- e2e/settings-preferences.spec.tsx
```

Expected: FAIL because settings still render `system` and `highContrast`, and shell uses the raw theme value.

- [ ] **Step 3: Add a theme normalization helper**

In `apps/desktop/src/app/model.ts`, keep the daemon-facing type but normalize visible themes:

```ts
export type SleiTheme = "light" | "dark";

export function normalizeAppearanceTheme(theme: AppearancePreferences["theme"] | undefined): SleiTheme {
  return theme === "dark" ? "dark" : "light";
}

export function normalizeAppearance(appearance: AppearancePreferences): AppearancePreferences {
  return {
    ...appearance,
    theme: normalizeAppearanceTheme(appearance.theme),
  };
}
```

Update `defaultAppearance`:

```ts
export const defaultAppearance: AppearancePreferences = {
  theme: "light",
  fontSize: "md",
};
```

- [ ] **Step 4: Apply normalized theme in the shell**

In `apps/desktop/src/app/SleiAppFrame.tsx`, import `normalizeAppearanceTheme`, then use it for `data-theme` and setting values:

```ts
const normalizedTheme = normalizeAppearanceTheme(appearance.theme);
```

Use:

```tsx
<div className="slei-shell" data-active-view={input.activeView} data-theme={normalizedTheme} style={shellStyle}>
```

Pass the original `appearance` to pages only if needed for bridge state; otherwise pass `{ ...appearance, theme: normalizedTheme }`.

- [ ] **Step 5: Remove visible system/high contrast options**

In `apps/desktop/src/features/settings/SettingsPageView.tsx`, update theme options:

```tsx
options={[
  { label: labels.themeLight, value: "light" },
  { label: labels.themeDark, value: "dark" },
]}
value={appearance.theme === "dark" ? "dark" : "light"}
```

Keep update calls as `updateAppearance({ theme: value })`.

- [ ] **Step 6: Normalize loaded and updated preferences if needed**

In `apps/desktop/src/app/SleiApp.tsx`, apply `normalizeAppearance` when setting appearance from bridge responses and before saving appearance changes. Keep changes narrow.

If `createDaemonBridgeMock` in `apps/desktop/src/lib/daemon-bridge.ts` defaults to `system`, update the mock default to `light` so tests reflect the new product default.

- [ ] **Step 7: Run focused tests**

Run:

```bash
pnpm --filter @slei/desktop test -- e2e/settings-preferences.spec.tsx
```

Expected: PASS.

- [ ] **Step 8: Commit theme normalization**

```bash
git add apps/desktop/src/app/model.ts apps/desktop/src/app/SleiApp.tsx apps/desktop/src/app/SleiAppFrame.tsx apps/desktop/src/features/settings/SettingsPageView.tsx apps/desktop/src/lib/daemon-bridge.ts apps/desktop/e2e/settings-preferences.spec.tsx
git commit -m "feat: limit themes to light and dark"
```

---

## Task 3: Rewrite Shared Tokens for Animal Island

**Files:**
- Modify: `packages/ui/src/styles/tokens.css`
- Modify: `packages/ui/src/styles/design-system.test.ts`
- Test: `packages/ui/src/styles/design-system.test.ts`
- Test: `apps/desktop/e2e/design-system.spec.ts`

- [ ] **Step 1: Update package UI token tests**

In `packages/ui/src/styles/design-system.test.ts`, rename the suite:

```ts
describe("Slei Animal Island design tokens", () => {
```

Replace the square-radius test with:

```ts
it("uses rounded Animal Island component geometry", () => {
  expect(tokensCss).toContain("--radius-control: 999px;");
  expect(tokensCss).toContain("--radius-modal: var(--primitive-radius-24);");
  expect(tokensCss).toContain("--radius-badge: 999px;");
  expect(tokensCss).toContain("--radius-avatar: 50%;");
});
```

Update semantic token assertions to include:

```ts
"--color-accent-strong",
"--color-surface-pattern",
"--color-theme-dark-accent",
"--shadow-soft",
```

Keep the test that `globals.css` uses semantic tokens rather than primitive tokens.

- [ ] **Step 2: Run package tests and verify failure**

Run:

```bash
pnpm --filter @slei/ui test
```

Expected: FAIL because tokens are still neo-brutalist.

- [ ] **Step 3: Rewrite primitive and semantic token values**

In `packages/ui/src/styles/tokens.css`, preserve existing token names where product CSS consumes them, but replace values with Animal Island palette and geometry.

Use this direction:

```css
:root {
  --primitive-island-cream-50: #fffdf3;
  --primitive-island-cream-100: #f8f8f0;
  --primitive-island-paper: #f7f3df;
  --primitive-island-sand: #f0e8d8;
  --primitive-island-tan: #c4b89e;
  --primitive-island-brown: #794f27;
  --primitive-island-brown-soft: #9f927d;
  --primitive-island-teal: #19c8b9;
  --primitive-island-teal-hover: #3dd4c6;
  --primitive-island-teal-active: #50b9ab;
  --primitive-island-yellow: #f5c31c;
  --primitive-island-green: #6fba2c;
  --primitive-island-red: #e05a5a;
  --primitive-island-night-900: #132d2f;
  --primitive-island-night-800: #1f3f3d;
  --primitive-island-night-700: #2c4f49;
  --primitive-radius-12: 12px;
  --primitive-radius-16: 16px;
  --primitive-radius-18: 18px;
  --primitive-radius-24: 24px;
  --primitive-shadow-soft-1: 0 2px 4px 0 rgb(61 52 40 / 8%);
  --primitive-shadow-soft-2: 0 3px 10px 0 rgb(61 52 40 / 12%);
  --primitive-shadow-soft-3: 0 8px 24px 0 rgb(61 52 40 / 16%);
}
```

Set semantic tokens:

```css
--color-bg: var(--primitive-island-cream-100);
--color-surface: var(--primitive-island-cream-50);
--color-surface-alt: var(--primitive-island-sand);
--color-surface-hover: var(--primitive-island-paper);
--color-text-primary: var(--primitive-island-brown);
--color-text-secondary: var(--primitive-island-brown-soft);
--color-text-muted: #a99d86;
--color-text-inverse: #fff9e3;
--color-border: var(--primitive-island-tan);
--color-border-subtle: #e8e2d6;
--color-border-strong: #827157;
--color-accent: var(--primitive-island-teal);
--color-accent-hover: var(--primitive-island-teal-hover);
--color-accent-strong: var(--primitive-island-teal-active);
--color-accent-subtle: #e6f9f6;
--color-focus-ring: var(--primitive-island-yellow);
--color-warning: var(--primitive-island-yellow);
--color-success: var(--primitive-island-green);
--color-error: var(--primitive-island-red);
--color-danger: var(--primitive-island-red);
--color-danger-bg: #ffe8e4;
--color-info: var(--primitive-island-teal-active);
--color-info-bg: #e6f9f6;
--radius-control: 999px;
--radius-modal: var(--primitive-radius-24);
--radius-badge: 999px;
--radius-avatar: 50%;
--radius-card: var(--primitive-radius-18);
--radius-panel: var(--primitive-radius-24);
--shadow-xs: var(--primitive-shadow-soft-1);
--shadow-sm: var(--primitive-shadow-soft-1);
--shadow-md: var(--primitive-shadow-soft-2);
--shadow-lg: var(--primitive-shadow-soft-3);
--shadow-xl: var(--primitive-shadow-soft-3);
--shadow-soft: var(--primitive-shadow-soft-2);
```

Keep sizing tokens stable unless a specific page needs moderate density changes:

```css
--rail-width: 80px;
--sidebar-width: 240px;
--composer-height: 104px;
```

- [ ] **Step 4: Add dark theme tokens**

In `tokens.css`, add semantic dark token values that `app.css` can reference:

```css
--color-theme-dark-bg: var(--primitive-island-night-900);
--color-theme-dark-surface: var(--primitive-island-night-800);
--color-theme-dark-surface-alt: var(--primitive-island-night-700);
--color-theme-dark-text: #fff4cf;
--color-theme-dark-text-secondary: #d9caa8;
--color-theme-dark-border: #6d806f;
--color-theme-dark-accent: var(--primitive-island-teal-hover);
--color-theme-dark-accent-subtle: rgb(25 200 185 / 16%);
```

Remove or stop exposing high-contrast theme semantic tokens unless other code still requires them temporarily.

- [ ] **Step 5: Run token tests**

Run:

```bash
pnpm --filter @slei/ui test
pnpm --filter @slei/desktop test -- e2e/design-system.spec.ts
```

Expected: PASS or fail only on product CSS assertions that will be fixed in Task 5.

- [ ] **Step 6: Commit token rewrite**

```bash
git add packages/ui/src/styles/tokens.css packages/ui/src/styles/design-system.test.ts apps/desktop/e2e/design-system.spec.ts
git commit -m "style: rewrite tokens for animal island"
```

---

## Task 4: Rewrite Shared Global Components

**Files:**
- Modify: `packages/ui/src/styles/globals.css`
- Modify: `packages/ui/src/styles/design-system.test.ts`
- Test: `packages/ui/src/styles/design-system.test.ts`

- [ ] **Step 1: Add global component assertions**

In `packages/ui/src/styles/design-system.test.ts`, assert key Animal Island global styles:

```ts
it("styles shared controls with Animal Island soft geometry", () => {
  expect(globalsCss).toMatch(/\.slei-button\s*\{[^}]*border-radius:\s*var\(--radius-control\);/s);
  expect(globalsCss).toMatch(/\.slei-button:hover\s*\{[^}]*transform:\s*translateY\(-1px\);/s);
  expect(globalsCss).toMatch(/\.slei-card\s*\{[^}]*border-radius:\s*var\(--radius-card\);/s);
  expect(globalsCss).toMatch(/\.slei-avatar\s*\{[^}]*border-radius:\s*var\(--radius-avatar\);/s);
});
```

- [ ] **Step 2: Run test and verify failure**

Run:

```bash
pnpm --filter @slei/ui test
```

Expected: FAIL until globals are rewritten.

- [ ] **Step 3: Restyle buttons**

In `packages/ui/src/styles/globals.css`, update `.slei-button`:

```css
.slei-button {
  align-items: center;
  background: var(--color-surface);
  border: var(--border-card) solid var(--color-border);
  border-radius: var(--radius-control);
  box-shadow: 0 3px 0 0 rgb(121 79 39 / 22%);
  color: var(--color-text-primary);
  display: inline-flex;
  font-size: var(--text-base);
  font-weight: var(--weight-bold);
  gap: var(--gap-sm);
  justify-content: center;
  line-height: var(--leading-ui);
  min-height: 40px;
  padding: var(--padding-button-md);
  text-decoration: none;
  transition:
    transform var(--duration-interaction) var(--ease-ui),
    box-shadow var(--duration-interaction) var(--ease-ui),
    background var(--duration-interaction) var(--ease-ui),
    border-color var(--duration-interaction) var(--ease-ui);
}
```

Hover:

```css
.slei-button:hover {
  border-color: var(--color-accent);
  box-shadow: 0 4px 0 0 rgb(121 79 39 / 24%);
  transform: translateY(-1px);
}

.slei-button:active {
  box-shadow: 0 1px 0 0 rgb(121 79 39 / 20%);
  transform: translateY(2px);
}
```

- [ ] **Step 4: Restyle inputs, selects, textarea, checkboxes**

Keep existing markup; update CSS to use rounded Animal Island fields:

```css
.slei-input,
.slei-select,
.slei-textarea {
  background: var(--color-surface);
  border: var(--border-card) solid var(--color-border);
  border-radius: var(--radius-control);
  box-shadow: 0 3px 0 0 rgb(121 79 39 / 12%);
  color: var(--color-text-primary);
}

.slei-textarea {
  border-radius: var(--radius-card);
}
```

Use teal/yellow focus states:

```css
.slei-input:focus-visible,
.slei-textarea:focus-visible,
.slei-select:focus-within,
.slei-checkbox__control:focus-visible + .slei-checkbox__box {
  border-color: var(--color-accent);
  box-shadow: 0 0 0 3px var(--color-accent-subtle);
}
```

- [ ] **Step 5: Restyle card, panel, badge, avatar, dialog, tabs**

Update shared classes with rounded surfaces and soft shadows. Use semantic tokens only; do not hard-code hex colors in `globals.css`.

- [ ] **Step 6: Respect reduced motion**

Ensure existing `@media (prefers-reduced-motion: reduce)` still disables transitions or add it if it was removed during rewrite:

```css
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 1ms !important;
    scroll-behavior: auto !important;
    transition-duration: 1ms !important;
  }
}
```

- [ ] **Step 7: Run package tests**

Run:

```bash
pnpm --filter @slei/ui test
pnpm --filter @slei/ui typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit globals rewrite**

```bash
git add packages/ui/src/styles/globals.css packages/ui/src/styles/design-system.test.ts
git commit -m "style: restyle shared controls for animal island"
```

---

## Task 5: Restyle Desktop Shell and Product Surfaces

**Files:**
- Modify: `apps/desktop/src/app/app.css`
- Modify: `apps/desktop/e2e/design-system.spec.ts`
- Modify: `apps/desktop/e2e/react-shell.spec.tsx`
- Test: `apps/desktop/e2e/design-system.spec.ts`
- Test: `apps/desktop/e2e/react-shell.spec.tsx`

- [ ] **Step 1: Update shell test language**

In `apps/desktop/e2e/react-shell.spec.tsx`, rename:

```ts
it("defaults to the Chat home page with Animal Island desktop structure", () => {
```

Keep behavioral assertions: shell exists, route labels render, drag regions remain correct, native window controls are not duplicated.

- [ ] **Step 2: Update style-specific assertions**

In `apps/desktop/e2e/design-system.spec.ts`, update rail assertions from hard shadow expectations to semantic soft style expectations:

```ts
expect(railRule).toContain("align-items: center");
expect(railRule).toContain("background: var(--color-rail-bg)");
expect(railRule).not.toContain("border-right");
expect(railRule).toContain("padding: var(--titlebar-height) var(--gap-sm) var(--gap-sm)");
expect(railButtonRule).toContain("border-radius: var(--radius-control)");
expect(railButtonRule).toContain("width: 64px");
```

If no `--color-rail-bg` token is introduced, assert the actual semantic token used.

- [ ] **Step 3: Run shell/design tests and verify failure**

Run:

```bash
pnpm --filter @slei/desktop test -- e2e/design-system.spec.ts e2e/react-shell.spec.tsx
```

Expected: FAIL until `app.css` is rewritten.

- [ ] **Step 4: Add app-level semantic aliases**

At the top of `apps/desktop/src/app/app.css`, add app-specific semantic variables under `:root` rather than hex literals:

```css
:root {
  --scrollbar-size: 8px;
  --scrollbar-radius: 999px;
  --scrollbar-thumb: color-mix(in srgb, var(--color-border) 62%, transparent);
  --scrollbar-thumb-hover: color-mix(in srgb, var(--color-border-strong) 72%, transparent);
  --color-rail-bg: var(--color-text-primary);
  --color-rail-text: var(--color-text-inverse);
  --color-shell-divider: var(--color-border);
}
```

Use only CSS variables and color functions in `app.css`; keep the existing `appCss` test expectation that no hex colors appear.

- [ ] **Step 5: Restyle shell and navigation**

Rewrite these sections in `apps/desktop/src/app/app.css`:

- `.slei-shell`
- `.slei-rail`
- `.slei-brand`
- `.slei-brand__mark`
- `.slei-rail__button`
- `.slei-rail__button[aria-current="page"]`
- `.slei-context-sidebar`
- `.slei-resize-handle`
- `.slei-sidebar__header`
- `.slei-channel`, `.slei-mini-card`, `.slei-channel-delete`
- `.slei-nav-member`, `.slei-session-item`

Expected treatment:

- rail reads like a dark wood/night-island tool rail
- buttons are rounded and raised
- active nav uses yellow or teal
- sidebars are warm paper panels
- channel/member rows are rounded mini cards

- [ ] **Step 6: Restyle workspace, chat, and composer**

Rewrite CSS for:

- `.slei-workspace-header`
- `.slei-chat-tabs`
- `.slei-timeline`
- `.slei-message`
- `.slei-message:hover`, `.slei-message--focused`
- `.slei-message-status-square` and failed/running/approval/pending variants
- `.slei-interactive-card`
- `.slei-interactive-card--permissionApproval`
- `.slei-permission-actions`
- `.slei-tool-call`
- `.slei-composer`
- `.slei-mention-panel`
- `.slei-attachment-chip`
- `.slei-back-bottom`
- `.slei-session-drawer`

Keep chat compact. Do not create oversized bubbles.

- [ ] **Step 7: Restyle task, members, computers, settings, search**

Rewrite CSS for:

- `.slei-board`, `.slei-column`, `.slei-task-card`, `.slei-task-thread-drawer`
- `.slei-member-grid`, `.slei-member-detail`, `.slei-member-topbar`
- `.slei-node-grid`, `.slei-node-card`
- `.slei-settings-stack`, `.slei-settings-section`, `.slei-segmented-control`
- `.slei-search-panel`, `.slei-search-result`
- common card-like rows and chips
- `.slei-crash-screen`, `.slei-inline-error`, `.slei-toast`, `.slei-button--danger`
- `.slei-runtime-modal`, `.slei-runtime-list`, `.slei-runtime-row`, `.slei-runtime-pill` and ready/error/unavailable variants

Use shared component tokens first. Add local class rules only for product layout.
Error, crash, runtime, permission, failed, and destructive states must stay high-legibility in both light and dark themes. Animal Island softness should not mute these states enough to hide risk.

- [ ] **Step 8: Replace dark/high-contrast overrides**

At the end of `app.css`, keep only light default and dark override:

```css
.slei-shell[data-theme="dark"] {
  --color-bg: var(--color-theme-dark-bg);
  --color-surface: var(--color-theme-dark-surface);
  --color-surface-alt: var(--color-theme-dark-surface-alt);
  --color-surface-hover: color-mix(in srgb, var(--color-theme-dark-surface) 82%, var(--color-theme-dark-accent) 18%);
  --color-text-primary: var(--color-theme-dark-text);
  --color-text-secondary: var(--color-theme-dark-text-secondary);
  --color-text-muted: color-mix(in srgb, var(--color-theme-dark-text-secondary) 72%, transparent);
  --color-border: var(--color-theme-dark-border);
  --color-border-subtle: color-mix(in srgb, var(--color-theme-dark-border) 52%, transparent);
  --color-accent: var(--color-theme-dark-accent);
  --color-accent-subtle: var(--color-theme-dark-accent-subtle);
  --color-rail-bg: color-mix(in srgb, var(--color-theme-dark-bg) 72%, black);
}
```

Remove `.slei-shell[data-theme="highContrast"]`.

- [ ] **Step 9: Run shell/design tests**

Run:

```bash
pnpm --filter @slei/desktop test -- e2e/design-system.spec.ts e2e/react-shell.spec.tsx
```

Expected: PASS.

- [ ] **Step 10: Commit product CSS rewrite**

```bash
git add apps/desktop/src/app/app.css apps/desktop/e2e/design-system.spec.ts apps/desktop/e2e/react-shell.spec.tsx
git commit -m "style: restyle desktop shell for animal island"
```

---

## Task 6: Preserve and Integrate the Pixel Face Empty State

**Files:**
- Modify: `apps/desktop/src/app/app.css`
- Modify: `apps/desktop/e2e/empty-state.spec.tsx` if existing assertions need updating
- Test: `apps/desktop/e2e/empty-state.spec.tsx`

- [ ] **Step 1: Inspect empty state tests**

Run:

```bash
sed -n '1,220p' apps/desktop/e2e/empty-state.spec.tsx
```

Identify assertions for `.slei-empty__pixel-face` and variants.

- [ ] **Step 2: Add or preserve pixel face assertions**

If not already present, add assertions that the pixel face remains:

```ts
expect(html).toContain("slei-empty__pixel-face");
expect(html).toContain("slei-empty__pixel--eye");
expect(html).toContain("slei-empty__pixel--mouth");
```

- [ ] **Step 3: Run empty state test and verify baseline**

Run:

```bash
pnpm --filter @slei/desktop test -- e2e/empty-state.spec.tsx
```

Expected: PASS before CSS-only styling changes unless the test was just added.

- [ ] **Step 4: Restyle empty state CSS only**

In `apps/desktop/src/app/app.css`, update:

- `.slei-empty`
- `.slei-empty-detail`
- `.slei-empty__pixel-face`
- `.slei-empty__pixel`
- size and variant modifiers

Requirements:

- keep existing JSX and class names
- place pixel face on an Animal Island paper-card surface
- use semantic tokens only
- ensure small/medium/large sizes still fit

- [ ] **Step 5: Run empty state tests**

Run:

```bash
pnpm --filter @slei/desktop test -- e2e/empty-state.spec.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit empty state styling**

```bash
git add apps/desktop/src/app/app.css apps/desktop/e2e/empty-state.spec.tsx
git commit -m "style: integrate pixel empty state with animal island"
```

---

## Task 7: Run Broad Automated Verification

**Files:**
- Modify only files needed for test fixes caused by intentional design changes.

- [ ] **Step 1: Run typechecks**

Run:

```bash
pnpm --filter @slei/ui typecheck
pnpm --filter @slei/desktop typecheck
```

Expected: PASS.

- [ ] **Step 2: Run focused test set**

Run:

```bash
pnpm --filter @slei/ui test
pnpm --filter @slei/desktop test -- \
  e2e/design-system.spec.ts \
  e2e/react-shell.spec.tsx \
  e2e/settings-preferences.spec.tsx \
  e2e/empty-state.spec.tsx \
  e2e/chat.spec.ts \
  e2e/tasks.spec.ts \
  e2e/members.spec.ts \
  e2e/computers-management.spec.tsx \
  e2e/router.spec.ts \
  e2e/saved-messages.spec.tsx \
  e2e/accessibility.spec.ts
```

Expected: PASS.

- [ ] **Step 3: Fix intentional test drift**

If tests fail because they assert old Neo-Brutalism copy or exact style rules, update assertions to match Animal Island behavior. Do not relax tests that cover routing, data flow, ARIA labels, keyboard behavior, or persistence.

- [ ] **Step 4: Run all desktop tests if focused tests pass**

Run:

```bash
pnpm --filter @slei/desktop test
```

Expected: PASS or a clearly documented pre-existing unrelated failure.

- [ ] **Step 5: Commit verification fixes**

If any test-only fixes were made:

```bash
git add apps/desktop/e2e packages/ui/src/styles/design-system.test.ts
git commit -m "test: update animal island design coverage"
```

If no fixes were made, skip this commit.

---

## Task 8: Browser Visual Verification

**Files:**
- No planned source edits unless visual QA reveals issues.

- [ ] **Step 1: Start the desktop dev server**

Run:

```bash
pnpm --filter @slei/desktop dev
```

Expected: Vite serves the desktop app at `http://127.0.0.1:1420` or another available port.

- [ ] **Step 2: Open the app in Browser**

Use the in-app Browser plugin to open:

```text
http://127.0.0.1:1420
```

Verify initial shell renders and is not blank.

- [ ] **Step 3: Inspect light theme pages**

Use app navigation or routes to inspect at least:

- chat home with composer
- channel embedded tasks tab
- channel embedded files tab if fixture data allows it
- tasks board and task drawer
- members page and member detail
- computers page and node detail
- settings appearance panel
- search page
- an empty state
- crash/error-like surfaces where practical: inline error text, toast, permission approval card, failed/pending status indicator, runtime modal, runtime error/unavailable pill, destructive button

Expected: Animal Island visual language is consistent; no text overlap; controls remain usable.

- [ ] **Step 4: Inspect dark theme**

Change the theme to dark through Settings or by rendering a fixture route with dark appearance if the app supports it.

Expected: night-island palette applies; text is readable; borders and chips remain visible; no high-contrast theme option is shown.

- [ ] **Step 5: Check responsive/narrow viewport**

Use Browser viewport controls or Playwright if available to inspect a narrow width around 390px and a desktop width around 1280px.

Expected: no major overlap; long text truncates or wraps intentionally; composer and sidebars remain usable for existing supported viewports.

- [ ] **Step 6: Stop dev server**

Stop the running dev server cleanly. Do not leave terminal sessions running.

- [ ] **Step 7: Commit visual QA fixes**

If CSS fixes were needed:

```bash
git add apps/desktop/src/app/app.css packages/ui/src/styles/globals.css packages/ui/src/styles/tokens.css
git commit -m "style: polish animal island visual qa"
```

If no fixes were needed, skip this commit.

---

## Final Verification

- [ ] **Step 1: Check git status**

Run:

```bash
git status --short
```

Expected: only intentional changes remain, with no `.superpowers/` or cloned reference repository staged.

- [ ] **Step 2: Run final typecheck**

Run:

```bash
pnpm --filter @slei/ui typecheck
pnpm --filter @slei/desktop typecheck
```

Expected: PASS.

- [ ] **Step 3: Run final tests**

Run:

```bash
pnpm --filter @slei/ui test
pnpm --filter @slei/desktop test
```

Expected: PASS, or document exact failing tests and whether they are unrelated/pre-existing.

- [ ] **Step 4: Review final diff**

Run:

```bash
git diff --stat HEAD
git diff HEAD -- apps/desktop/package.json pnpm-lock.yaml apps/desktop/src/web.ts packages/ui/src/styles/tokens.css packages/ui/src/styles/globals.css apps/desktop/src/app/app.css
```

Expected: dependency, design-system, theme, and product CSS changes match the approved spec.

- [ ] **Step 5: Final commit if needed**

If there are uncommitted implementation changes after prior task commits:

```bash
git add apps/desktop packages/ui package.json pnpm-lock.yaml
git commit -m "style: complete animal island system redesign"
```

Expected: all implementation changes committed in focused commits.
