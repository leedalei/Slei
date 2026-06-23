# Global Font Size Preference Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Settings font size preference apply globally across the desktop app.

**Architecture:** Keep daemon / SQLite preferences as the source of truth. `SleiApp` continues to read and mutate preferences; `SleiAppFrame` maps the current `appearance.fontSize` into global root typography variables on `document.documentElement`, including `font-size`, `--slei-font-size`, and the `--text-*` tokens used by legacy CSS and Tailwind/shadcn surfaces. `SettingsPageView` remains a presentation component that only emits appearance changes.

**Tech Stack:** React 19, TypeScript, Tailwind CSS v4, shadcn UI, Vitest + jsdom, existing Tauri daemon bridge.

---

## Knowledge Retrieval Results

**Search Context:** 全局字体大小偏好实现计划。  
**Keywords Used:** settings, preferences, font, Tailwind, UI, frontend, state.  
**Files Scanned:** 1 matching knowledge file.  
**Relevant Matches:** 0.

### Critical Patterns

No `docs/knowledge/patterns/critical-patterns.md` file exists.

### Relevant Knowledge

No relevant knowledge found for this topic. The only candidate was `docs/knowledge/best-practices/task-thread-stable-ids-and-reply-roles-20260529.md`, which is scoped to task thread IDs and reply roles.

## File Structure

- Modify: `apps/desktop/src/app/SleiAppFrame.tsx`
  - Owns mapping `AppearancePreferences` to shell presentation.
  - Add a small `useEffect` that writes the chosen font size and derived text tokens to `document.documentElement`, then restores previous values on cleanup.
  - Add `data-font-size` on the shell root for DOM assertions.
- Modify: `apps/desktop/src/features/settings/SettingsPageView.tsx`
  - Remove the local `text-[var(--slei-font-size)]` class from the settings page root so it inherits the global shell/root font size.
  - Add `data-settings-font-size-option="sm|md|lg"` to the font size buttons for stable interaction tests.
- Modify: `apps/desktop/src/app/SleiAppFrame.test.tsx`
  - Add jsdom tests proving `SleiAppFrame` synchronizes the document root font size and restores it on unmount.
  - Verify a representative `text-sm` node is backed by updated root text-size tokens when the preference is large.
- Modify: `apps/desktop/src/features/settings/SettingsPageView.test.tsx`
  - Extend existing interaction coverage to click a font size option and assert the full appearance payload.
- Modify: `apps/desktop/e2e/settings-preferences.spec.tsx`
  - Update SSR assertions that currently expect the settings page to carry a local font-size class.
  - Assert shell-level `data-font-size` and `--slei-font-size` are rendered for appearance preferences.

## Task 0: Dependency Preflight

**Files:**
- Verify only.

- [ ] **Step 1: Check whether workspace dependencies are installed**

Run from repo root:

```bash
test -x apps/desktop/node_modules/.bin/vitest || test -x node_modules/.bin/vitest
```

Expected: exit code 0. If it fails, continue to Step 2.

- [ ] **Step 2: Install dependencies if missing**

Run from repo root only if Step 1 fails:

```bash
pnpm install
```

Expected: completes successfully and creates the needed `node_modules/.bin/vitest` or `apps/desktop/node_modules/.bin/vitest` binary. Do not commit `node_modules`.

## Task 1: Add Failing Shell Tests

**Files:**
- Modify: `apps/desktop/src/app/SleiAppFrame.test.tsx`

- [ ] **Step 1: Add jsdom test for global root typography synchronization**

Append this test in `describe("SleiAppFrame global search navigation", () => { ... })` or create a nearby `describe("SleiAppFrame appearance preferences", ...)` block in `apps/desktop/src/app/SleiAppFrame.test.tsx`:

```tsx
it("syncs the font size preference to the document root and restores it on unmount", async () => {
  document.documentElement.style.fontSize = "13px";
  document.documentElement.style.setProperty("--slei-font-size", "13px");
  document.documentElement.style.setProperty("--text-sm", "12px");

  const container = await mount(
    <SleiAppFrame
      activeView="settings"
      appearance={{ theme: "light", fontSize: "lg" }}
      data={createSleiFixtures()}
      initialSettingsPanel="appearance"
      locale="zh-CN"
      runtimeSetup={runtimeSetup}
    />,
  );

  expect(container.querySelector("[data-font-size='lg']")).not.toBeNull();
  expect(document.documentElement.style.fontSize).toBe("16px");
  expect(document.documentElement.style.getPropertyValue("--slei-font-size")).toBe("16px");
  expect(document.documentElement.style.getPropertyValue("--text-sm")).toBe("14px");
  expect(document.documentElement.style.getPropertyValue("--text-base")).toBe("16px");

  await act(async () => {
    mountedRoot?.render(
      <SleiAppFrame
        activeView="settings"
        appearance={{ theme: "light", fontSize: "sm" }}
        data={createSleiFixtures()}
        initialSettingsPanel="appearance"
        locale="zh-CN"
        runtimeSetup={runtimeSetup}
      />,
    );
  });
  await act(async () => undefined);

  expect(document.documentElement.style.fontSize).toBe("14px");
  expect(document.documentElement.style.getPropertyValue("--slei-font-size")).toBe("14px");
  expect(document.documentElement.style.getPropertyValue("--text-sm")).toBe("12px");
  expect(document.documentElement.style.getPropertyValue("--text-base")).toBe("14px");

  await act(async () => {
    mountedRoot?.unmount();
  });
  mountedRoot = undefined;

  expect(document.documentElement.style.fontSize).toBe("13px");
  expect(document.documentElement.style.getPropertyValue("--slei-font-size")).toBe("13px");
  expect(document.documentElement.style.getPropertyValue("--text-sm")).toBe("12px");
});
```

- [ ] **Step 2: Add representative `text-sm` token-based test**

Add a second test in the same file:

```tsx
it("updates tokens used by explicit text utility nodes", async () => {
  const container = await mount(
    <SleiAppFrame
      activeView="settings"
      appearance={{ theme: "light", fontSize: "lg" }}
      data={createSleiFixtures()}
      initialSettingsPanel="appearance"
      locale="zh-CN"
      runtimeSetup={runtimeSetup}
    />,
  );

  const description = container.querySelector<HTMLElement>("[data-testid='slei-settings-panel-header'] p");

  expect(description).not.toBeNull();
  expect(description?.className).toContain("text-sm");
  expect(document.documentElement.style.getPropertyValue("--text-sm")).toBe("14px");
});
```

Rationale: `SleiAppFrame` should update both the document root `font-size` and the text-size CSS tokens. The test verifies a representative settings header description still uses an explicit `text-sm` utility and that the token backing small text changed to the large preference value. This avoids depending on compiled Tailwind CSS being loaded in jsdom.

- [ ] **Step 3: Run the shell tests and verify they fail**

Run from `apps/desktop`:

```bash
pnpm test -- src/app/SleiAppFrame.test.tsx
```

Expected: FAIL. The first test should show `document.documentElement.style.fontSize` and `--text-sm` are not updated; the root should also lack `data-font-size`.

## Task 2: Implement Global Font Size Synchronization

**Files:**
- Modify: `apps/desktop/src/app/SleiAppFrame.tsx`

- [ ] **Step 1: Add derived typography constants**

In `apps/desktop/src/app/SleiAppFrame.tsx`, update the React import to include `useMemo`:

```tsx
import { type CSSProperties, type FormEvent, type PointerEvent as ReactPointerEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
```

Then replace repeated `fontSizeValue(appearance.fontSize)` usage with named constants:

```tsx
const fontSize = fontSizeValue(appearance.fontSize);
const textTokenValues = useMemo(() => fontSizeTextTokenValues(appearance.fontSize), [appearance.fontSize]);
const shellStyle = {
  "--slei-sidebar-width": `${input.sidebarWidth ?? 240}px`,
  "--slei-font-size": fontSize,
  gridTemplateColumns: hasContextSidebar ? `${primaryRailWidth} var(--slei-sidebar-width, 15rem) 0.5rem minmax(0, 1fr)` : `${primaryRailWidth} minmax(0, 1fr)`,
} as CSSProperties;
```

Add this helper near `fontSizeValue`:

```tsx
function fontSizeTextTokenValues(size: AppearancePreferences["fontSize"]) {
  const offset = { sm: -1, md: 0, lg: 1 }[size];
  const px = (value: number) => `${value + offset}px`;
  return {
    "--text-xs": px(11),
    "--text-sm": px(13),
    "--text-base": px(14),
    "--text-md": px(15),
    "--text-lg": px(16),
    "--text-xl": px(18),
    "--text-2xl": px(24),
    "--text-display": px(30),
  } as const;
}
```

These base values match the current `app.css` typography tokens. The preference shifts the whole scale by one pixel per step while keeping relative hierarchy.

- [ ] **Step 2: Add the document root synchronization effect**

Add this `useEffect` after `shellStyle` and before existing effects:

```tsx
useEffect(() => {
  if (typeof document === "undefined") return undefined;

  const root = document.documentElement;
  const previousFontSize = root.style.fontSize;
  const previousSleiFontSize = root.style.getPropertyValue("--slei-font-size");
  const previousTextTokenValues = Object.fromEntries(
    Object.keys(textTokenValues).map((key) => [key, root.style.getPropertyValue(key)]),
  );

  root.style.fontSize = fontSize;
  root.style.setProperty("--slei-font-size", fontSize);
  for (const [key, value] of Object.entries(textTokenValues)) {
    root.style.setProperty(key, value);
  }

  return () => {
    root.style.fontSize = previousFontSize;
    if (previousSleiFontSize) {
      root.style.setProperty("--slei-font-size", previousSleiFontSize);
    } else {
      root.style.removeProperty("--slei-font-size");
    }
    for (const key of Object.keys(textTokenValues)) {
      const previousValue = previousTextTokenValues[key];
      if (previousValue) {
        root.style.setProperty(key, previousValue);
      } else {
        root.style.removeProperty(key);
      }
    }
  };
}, [fontSize, textTokenValues]);
```


- [ ] **Step 3: Add root DOM metadata**

On the shell root `<div>`, add:

```tsx
data-font-size={appearance.fontSize}
```

Keep existing `data-active-view`, `data-theme`, `style`, and `className`.

- [ ] **Step 4: Run shell tests**

Run from `apps/desktop`:

```bash
pnpm test -- src/app/SleiAppFrame.test.tsx
```

Expected: PASS for the new tests and existing shell tests.

## Task 3: Update Settings Page Rendering and Interaction Tests

**Files:**
- Modify: `apps/desktop/src/features/settings/SettingsPageView.tsx`
- Modify: `apps/desktop/src/features/settings/SettingsPageView.test.tsx`
- Modify: `apps/desktop/e2e/settings-preferences.spec.tsx`

- [ ] **Step 1: Write/update failing settings interaction test**

In `apps/desktop/src/features/settings/SettingsPageView.test.tsx`, extend the existing `"submits immediate setting changes from rendered controls"` test after the theme click assertion:

```tsx
await act(async () => {
  appearanceContainer.querySelector<HTMLButtonElement>("[data-settings-font-size-option='lg']")?.click();
});
await act(async () => undefined);

expect(onAppearanceChange).toHaveBeenCalledWith({ theme: "light", fontSize: "lg" });
```

- [ ] **Step 2: Run settings view test and verify it fails**

Run from `apps/desktop`:

```bash
pnpm test -- src/features/settings/SettingsPageView.test.tsx
```

Expected: FAIL because font size buttons do not yet expose `data-settings-font-size-option`.

- [ ] **Step 3: Update `SettingsPageView` markup**

In `apps/desktop/src/features/settings/SettingsPageView.tsx`, change the page root class:

```tsx
<section className="h-full min-h-0 overflow-hidden bg-background" data-settings-panel={input.activePanel}>
```

Then add the data attribute to each font size button:

```tsx
data-settings-font-size-option={size}
```

- [ ] **Step 4: Update SSR/e2e assertions**

In `apps/desktop/e2e/settings-preferences.spec.tsx`:

Replace the assertion that expects:

```tsx
expect(html).toContain('class="h-full min-h-0 overflow-hidden bg-background text-[var(--slei-font-size)]"');
```

with assertions that the shell root carries global font metadata, for example:

```tsx
expect(html).toContain('data-font-size="md"');
expect(html).toContain("--slei-font-size:15px");
```

In the appearance test, replace:

```tsx
expect(appearanceHtml).toContain('text-[var(--slei-font-size)]');
```

with:

```tsx
expect(appearanceHtml).toContain('data-font-size="lg"');
expect(appearanceHtml).toContain("--slei-font-size:16px");
expect(appearanceHtml).toContain('data-settings-font-size-option="lg"');
```

- [ ] **Step 5: Run settings tests**

Run from `apps/desktop`:

```bash
pnpm test -- src/features/settings/SettingsPageView.test.tsx e2e/settings-preferences.spec.tsx
```

Expected: PASS.

## Task 4: Verify Preference Flow and Full Frontend Checks

**Files:**
- Verify only unless failures require scoped fixes in the files above.

- [ ] **Step 1: Run focused frontend tests**

Run from `apps/desktop`:

```bash
pnpm test -- src/app/SleiAppFrame.test.tsx src/features/settings/SettingsPageView.test.tsx e2e/settings-preferences.spec.tsx
```

Expected: PASS.

- [ ] **Step 2: Run desktop typecheck**

Run from `apps/desktop`:

```bash
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 3: Run all desktop tests if focused checks pass quickly**

Run from `apps/desktop`:

```bash
pnpm test
```

Expected: PASS. If this is too slow or fails outside the touched area, record the failing command and failure summary before final handoff.

- [ ] **Step 4: Check git diff**

Run from repo root:

```bash
git diff -- apps/desktop/src/app/SleiAppFrame.tsx apps/desktop/src/features/settings/SettingsPageView.tsx apps/desktop/src/app/SleiAppFrame.test.tsx apps/desktop/src/features/settings/SettingsPageView.test.tsx apps/desktop/e2e/settings-preferences.spec.tsx
```

Expected: Diff only includes global font-size synchronization, settings font-size button test hooks, and related tests.

- [ ] **Step 5: Commit implementation**

Run from repo root:

```bash
git add apps/desktop/src/app/SleiAppFrame.tsx apps/desktop/src/features/settings/SettingsPageView.tsx apps/desktop/src/app/SleiAppFrame.test.tsx apps/desktop/src/features/settings/SettingsPageView.test.tsx apps/desktop/e2e/settings-preferences.spec.tsx
git commit -m "fix: apply font size preference globally"
```

Expected: Commit succeeds.
