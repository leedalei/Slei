# Settings Overlay Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a full-page continuous settings overlay that consolidates account preferences, member management, device management, and about information, while moving Saved into the main workspace sidebar nav.

**Architecture:** Add a local UI overlay state in `SleiAppFrame` instead of routing the main workspace to settings. The overlay owns only presentation state (`open`, active settings item, settings search) and delegates all data and mutations to existing daemon-backed props and existing page components. Members and computers are reused through lightweight layout variants so their full behavior stays intact.

**Tech Stack:** React 19, TypeScript, Vitest/JSDOM, shadcn/Radix UI primitives, Tailwind CSS, existing Slei daemon bridge props.

---

## Reference Documents

- Spec: `docs/superpowers/specs/2026-07-02-settings-overlay-design.md`
- Architecture guardrails: `AGENTS.md`
- Existing settings view: `apps/desktop/src/features/settings/SettingsPageView.tsx`
- Existing member management: `apps/desktop/src/features/members/MembersPageView.tsx`
- Existing device management: `apps/desktop/src/features/computers/ComputersPageView.tsx`
- Existing shell/sidebar: `apps/desktop/src/app/SleiAppFrame.tsx`, `apps/desktop/src/app/WorkspaceSidebar.tsx`

## File Structure

- Create `apps/desktop/src/features/settings/SettingsOverlay.tsx`
  - Full-page continuous settings overlay.
  - Renders left settings navigation and right detail host in one connected page.
  - Provides `data-testid` hooks for overlay, nav, return button, detail region, and detail variants.
  - Owns only settings UI state passed from frame plus local search text if kept inside.

- Create `apps/desktop/src/features/settings/SettingsOverlay.test.tsx`
  - Focused component tests for settings nav grouping, search filtering, detail switching, full-page layout classes, and return behavior.

- Modify `apps/desktop/src/features/settings/SettingsPageView.tsx`
  - Keep current account/language/appearance/notifications/about rendering for legacy direct `activeView="settings"` compatibility.
  - Export helper components or add props only if needed by `SettingsOverlay`.
  - Avoid changing persistence behavior.

- Modify `apps/desktop/src/features/members/MembersPageView.tsx`
  - Add optional `layout?: "workspace" | "settings"` prop.
  - Settings layout keeps all tabs/actions but removes workspace-specific outer header spacing or conflicting full-page shell assumptions.

- Modify `apps/desktop/src/features/computers/ComputersPageView.tsx`
  - Add optional `layout?: "workspace" | "settings"` prop.
  - Settings layout keeps all detail/edit behavior but fits inside the overlay detail area.

- Modify `apps/desktop/src/app/WorkspaceSidebar.tsx`
  - Add Saved as top primary nav item after Tasks.
  - Change bottom menu entries to open settings overlay panels instead of direct `members`/`computers` views.
  - Remove Saved from bottom settings menu.

- Modify `apps/desktop/src/app/SleiAppFrame.tsx`
  - Add overlay open/close state and active overlay settings panel.
  - Pass overlay-open callbacks to `WorkspaceSidebar`.
  - Hide sidebar card and resize handle while overlay is visible.
  - Keep legacy `activeView="settings"` rendering path intact for compatibility tests.

- Modify `apps/desktop/src/app/model.ts`
  - Add a separate `SettingsOverlayPanel` union or extend `SettingsPanel` carefully.
  - Keep compatibility mapping for legacy panels: `"language-region"`, `"appearance"`, and `"notifications"` map to overlay `preferences`.

- Modify `apps/desktop/src/i18n/types.ts`
  - Add messages for overlay labels if existing strings do not cover them: return app, settings search placeholder, groups, member management, device management, preferences, about.

- Modify `apps/desktop/src/i18n/messages/zh-CN/settings.ts` and `apps/desktop/src/i18n/messages/en-US/settings.ts`
  - Add localized overlay labels.

- Modify `apps/desktop/src/app/app.css`
  - Add continuous full-page overlay layout classes if Tailwind utilities alone are not enough.
  - Ensure right detail area uses border-left and a restrained left shadow.

- Modify tests:
  - `apps/desktop/src/app/SleiAppFrame.test.tsx`
  - `apps/desktop/e2e/settings-preferences.spec.tsx`
  - `apps/desktop/e2e/saved-messages.spec.tsx`
  - Add/modify tests as needed for compatibility and DOM interactions.

## Implementation Notes

- The overlay is visually one continuous page: no gap between left nav and right detail, no floating two-panel/card look.
- The right detail region must have a left border and subtle left-side shadow.
- Use deterministic React state only. Do not rely on timestamps or generated IDs in tests.
- Settings search semantics: filter item labels first. If a group label matches the query, keep all items in that group visible. If only child items match, show the group with matching children only.
- Suggested left nav width: `18rem` desktop, `16rem` medium, full-width stacked fallback below the existing mobile sidebar breakpoint if needed.
- Legacy `activeView="settings"` behavior: continue rendering the old in-workspace `SettingsRoute` for existing routes/tests. New sidebar settings menu entries open overlay panels and do not call `onViewChange("settings")`.
- Sidebar settings interaction: the bottom gear remains a menu trigger. It does not directly navigate. Menu entries open the overlay at `members`, `devices`, `account`, or `preferences`.

---

### Task 1: Add Settings Overlay Types And I18n

**Files:**
- Modify: `apps/desktop/src/app/model.ts`
- Modify: `apps/desktop/src/i18n/types.ts`
- Modify: `apps/desktop/src/i18n/messages/zh-CN/settings.ts`
- Modify: `apps/desktop/src/i18n/messages/en-US/settings.ts`
- Test: `apps/desktop/src/app/model.test.ts`

- [ ] **Step 1: Write failing tests for panel mapping**

Add tests to `apps/desktop/src/app/model.test.ts`:

```ts
import { settingsOverlayPanelFromLegacyPanel, type SettingsOverlayPanel } from "./model";

describe("settings overlay panel mapping", () => {
  it("maps legacy preference panels into the preferences overlay panel", () => {
    expect(settingsOverlayPanelFromLegacyPanel("language-region")).toBe("preferences");
    expect(settingsOverlayPanelFromLegacyPanel("appearance")).toBe("preferences");
    expect(settingsOverlayPanelFromLegacyPanel("notifications")).toBe("preferences");
  });

  it("keeps account and about as direct overlay panels", () => {
    expect(settingsOverlayPanelFromLegacyPanel("account")).toBe("account");
    expect(settingsOverlayPanelFromLegacyPanel("about")).toBe("about");
  });

  it("accepts workspace management panels as overlay-only panels", () => {
    const panels: SettingsOverlayPanel[] = ["members", "devices"];
    expect(panels).toEqual(["members", "devices"]);
  });
});
```

- [ ] **Step 2: Run the model test and verify it fails**

Run:

```bash
pnpm --filter @slei/desktop test -- src/app/model.test.ts
```

Expected: FAIL because `SettingsOverlayPanel` and `settingsOverlayPanelFromLegacyPanel` do not exist.

- [ ] **Step 3: Add overlay panel types and mapping**

In `apps/desktop/src/app/model.ts`, add:

```ts
export type SettingsOverlayPanel = "account" | "preferences" | "members" | "devices" | "about";

export function settingsOverlayPanelFromLegacyPanel(panel: SettingsPanel): SettingsOverlayPanel {
  switch (panel) {
    case "language-region":
    case "appearance":
    case "notifications":
      return "preferences";
    case "account":
    case "about":
      return panel;
  }
}
```

- [ ] **Step 4: Add i18n fields**

Add a `settings.overlay` object to both locale files and the type:

```ts
overlay: {
  returnToApp: string;
  searchPlaceholder: string;
  groups: {
    personal: string;
    workspace: string;
    system: string;
  };
  panels: Record<SettingsOverlayPanel, string>;
  panelDescriptions: Record<SettingsOverlayPanel, string>;
};
```

Use Chinese labels: `返回应用`, `搜索设置...`, `个人`, `工作区`, `系统`, `账号资料`, `偏好设置`, `成员管理`, `设备管理`, `关于`.

- [ ] **Step 5: Run model and typecheck**

Run:

```bash
pnpm --filter @slei/desktop test -- src/app/model.test.ts
pnpm --filter @slei/desktop typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/app/model.ts apps/desktop/src/app/model.test.ts apps/desktop/src/i18n/types.ts apps/desktop/src/i18n/messages/zh-CN/settings.ts apps/desktop/src/i18n/messages/en-US/settings.ts
git commit -m "feat: add settings overlay panel labels"
```

---

### Task 2: Build Settings Overlay Shell With Connected Layout

**Files:**
- Create: `apps/desktop/src/features/settings/SettingsOverlay.tsx`
- Create: `apps/desktop/src/features/settings/SettingsOverlay.test.tsx`
- Modify: `apps/desktop/src/app/app.css` if CSS utilities are insufficient

- [ ] **Step 1: Write failing overlay layout tests**

Create `apps/desktop/src/features/settings/SettingsOverlay.test.tsx` with tests like:

```tsx
// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDesktopMessages } from "../../i18n";
import { SettingsOverlay } from "./SettingsOverlay";

const messages = createDesktopMessages("zh-CN");
let root: Root | undefined;
let container: HTMLDivElement | undefined;

async function mountOverlay(overrides: Partial<Parameters<typeof SettingsOverlay>[0]> = {}) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const onClose = vi.fn();
  const onPanelChange = vi.fn();
  await act(async () => {
    root?.render(
      <SettingsOverlay
        activePanel="account"
        messages={messages}
        onClose={onClose}
        onPanelChange={onPanelChange}
        renderDetail={(panel) => <section data-testid={`detail-${panel}`}>{panel}</section>}
        {...overrides}
      />,
    );
  });
  await act(async () => undefined);
  return { container, onClose, onPanelChange };
}

afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
});

it("renders a continuous full-page settings layout with left nav and right detail", async () => {
  const { container } = await mountOverlay();
  expect(container.querySelector('[data-testid="slei-settings-overlay"]')?.getAttribute("data-settings-overlay-layout")).toBe("continuous");
  expect(container.querySelector('[data-testid="slei-settings-overlay-nav"]')).toBeTruthy();
  expect(container.querySelector('[data-testid="slei-settings-overlay-detail"]')?.getAttribute("data-settings-detail-surface")).toBe("border-left-shadow-left");
});

it("groups settings entries and renders account detail by default", async () => {
  const { container } = await mountOverlay();
  expect(container.textContent).toContain("个人");
  expect(container.textContent).toContain("工作区");
  expect(container.textContent).toContain("系统");
  expect(container.querySelector('[data-testid="detail-account"]')).toBeTruthy();
});

it("returns to the app when the return button is clicked", async () => {
  const { container, onClose } = await mountOverlay();
  await act(async () => {
    container.querySelector<HTMLButtonElement>('[data-testid="slei-settings-return"]')?.click();
  });
  expect(onClose).toHaveBeenCalledTimes(1);
});

it("filters children by item labels and keeps all children when the group label matches", async () => {
  const { container } = await mountOverlay();
  const input = container.querySelector<HTMLInputElement>('input[aria-label="搜索设置..."]');
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value")?.set;
    setter?.call(input, "工作区");
    input?.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(container.textContent).toContain("成员管理");
  expect(container.textContent).toContain("设备管理");
  expect(container.textContent).not.toContain("账号资料");
});
```

- [ ] **Step 2: Run the overlay test and verify it fails**

Run:

```bash
pnpm --filter @slei/desktop test -- src/features/settings/SettingsOverlay.test.tsx
```

Expected: FAIL because `SettingsOverlay` does not exist.

- [ ] **Step 3: Implement `SettingsOverlay` shell**

Implement props:

```ts
type SettingsOverlayProps = {
  activePanel: SettingsOverlayPanel;
  messages: DesktopMessages;
  onClose: () => void;
  onPanelChange: (panel: SettingsOverlayPanel) => void;
  renderDetail: (panel: SettingsOverlayPanel) => ReactNode;
};
```

Structure:

```tsx
<section data-testid="slei-settings-overlay" data-settings-overlay-layout="continuous" className="fixed inset-0 z-40 grid grid-cols-[18rem_minmax(0,1fr)] overflow-hidden bg-background">
  <aside data-testid="slei-settings-overlay-nav" className="min-h-0 border-r bg-background">
    <Button aria-label={labels.returnToApp} data-testid="slei-settings-return" onClick={input.onClose} type="button" variant="ghost">
      <SleiIcon name="arrowLeft" size={15} />
      {labels.returnToApp}
    </Button>
    <Input aria-label={labels.searchPlaceholder} onChange={(event) => setQuery(event.currentTarget.value)} role="searchbox" value={query} />
    <SettingsNavigationList activePanel={input.activePanel} groups={filteredGroups} onPanelChange={input.onPanelChange} />
  </aside>
  <main data-testid="slei-settings-overlay-detail" data-settings-detail-surface="border-left-shadow-left" className="min-h-0 overflow-hidden border-l shadow-[-10px_0_24px_-24px_rgba(15,23,42,0.35)]">
    {renderDetail(activePanel)}
  </main>
</section>
```

Use `SleiIcon`/existing `Button`/`Input` primitives.

- [ ] **Step 4: Run overlay tests**

Run:

```bash
pnpm --filter @slei/desktop test -- src/features/settings/SettingsOverlay.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/features/settings/SettingsOverlay.tsx apps/desktop/src/features/settings/SettingsOverlay.test.tsx apps/desktop/src/app/app.css
git commit -m "feat: add full-page settings overlay shell"
```

---

### Task 3: Compose Overlay Details From Existing Settings, Members, And Devices

**Files:**
- Modify: `apps/desktop/src/features/settings/SettingsOverlay.tsx`
- Modify: `apps/desktop/src/features/members/MembersPageView.tsx`
- Modify: `apps/desktop/src/features/computers/ComputersPageView.tsx`
- Test: `apps/desktop/src/features/settings/SettingsOverlay.test.tsx`
- Test: `apps/desktop/e2e/detail-editing.spec.tsx`

- [ ] **Step 1: Write failing tests for detail hosting**

Extend `SettingsOverlay.test.tsx` with a higher-level test that renders:

```tsx
it("can host complete members and devices detail content", () => {
  mountOverlay({
    activePanel: "members",
    renderDetail: (panel) => (
      <section data-testid={`settings-detail-${panel}`}>
        <div data-testid="slei-member-detail-tabs" />
        <button>删除智能体</button>
      </section>
    ),
  });
  expect(screen.getByTestId("settings-detail-members")).toBeInTheDocument();
  expect(screen.getByTestId("slei-member-detail-tabs")).toBeInTheDocument();
});
```

Add or update a render-to-static test in `apps/desktop/e2e/detail-editing.spec.tsx` to ensure:

```tsx
renderToStaticMarkup(<MembersPage activeMemberId="agent_coda" data={data} layout="settings" messages={messages} nodes={nodes} />)
renderToStaticMarkup(<ComputersPage activeNodeId="local-node" layout="settings" members={data.members} messages={messages} nodes={nodes} />)
```

contains existing key DOM and `data-settings-embedded-detail="members"` / `"devices"`.

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
pnpm --filter @slei/desktop test -- src/features/settings/SettingsOverlay.test.tsx e2e/detail-editing.spec.tsx
```

Expected: FAIL because `layout` props and embedded detail markers do not exist.

- [ ] **Step 3: Add members settings layout variant**

In `MembersPageView.tsx`, add prop:

```ts
layout?: "workspace" | "settings";
```

Default to `"workspace"`. When `layout === "settings"`:

- Add `data-settings-embedded-detail="members"` to the root section.
- Keep all tabs and actions.
- Reduce or remove outer workspace-specific top padding/border only if it conflicts with overlay.
- Do not remove delete, message, workspace, activity, or edit behavior.

- [ ] **Step 4: Add devices settings layout variant**

In `ComputersPageView.tsx`, add prop:

```ts
layout?: "workspace" | "settings";
```

Default to `"workspace"`. When `layout === "settings"`:

- Add `data-settings-embedded-detail="devices"` to the root section.
- Keep device rename, system info, runtime list, hosted agents, empty state, and create request.
- Adjust only outer shell spacing if needed.

- [ ] **Step 5: Add detail composition helper**

In `SettingsOverlay.tsx`, either keep `renderDetail` generic or export a `SettingsDetailHost` component if composition would otherwise bloat `SleiAppFrame`.

Recommended:

```tsx
export function SettingsDetailHost(props: {
  panel: SettingsOverlayPanel;
  renderAccount: () => ReactNode;
  renderPreferences: () => ReactNode;
  renderMembers: () => ReactNode;
  renderDevices: () => ReactNode;
  renderAbout: () => ReactNode;
}) {
  switch (props.panel) {
    case "account": return props.renderAccount();
    case "preferences": return props.renderPreferences();
    case "members": return props.renderMembers();
    case "devices": return props.renderDevices();
    case "about": return props.renderAbout();
  }
}
```

- [ ] **Step 6: Run focused tests**

Run:

```bash
pnpm --filter @slei/desktop test -- src/features/settings/SettingsOverlay.test.tsx e2e/detail-editing.spec.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/features/settings/SettingsOverlay.tsx apps/desktop/src/features/settings/SettingsOverlay.test.tsx apps/desktop/src/features/members/MembersPageView.tsx apps/desktop/src/features/computers/ComputersPageView.tsx apps/desktop/e2e/detail-editing.spec.tsx
git commit -m "feat: embed management pages in settings overlay"
```

---

### Task 4: Wire Overlay Into SleiAppFrame Without Replacing Workspace State

**Files:**
- Modify: `apps/desktop/src/app/WorkspaceSidebar.tsx`
- Modify: `apps/desktop/src/app/SleiAppFrame.tsx`
- Modify: `apps/desktop/src/app/SleiAppFrame.test.tsx`

- [ ] **Step 1: Write failing frame tests**

Add tests to `SleiAppFrame.test.tsx`:

```tsx
it("opens settings as an overlay from the account menu entry without changing the active workspace view", async () => {
  const onViewChange = vi.fn();
  const container = await mount(
    <SleiAppFrame
      activeView="chat"
      data={createSleiFixtures()}
      locale="zh-CN"
      onViewChange={onViewChange}
      runtimeSetup={readyRuntime}
    />,
  );

  await clickElement(container.querySelector('[data-testid="slei-sidebar-settings-trigger"]'));
  await clickElement(document.querySelector('[data-testid="slei-sidebar-settings-account"]'));
  expect(onViewChange).not.toHaveBeenCalledWith("settings");
  expect(container.querySelector('[data-testid="slei-settings-overlay"]')).toBeTruthy();
  expect(container.querySelector('[data-slot="sidebar-card"]')).toHaveAttribute("data-settings-overlay-hidden", "true");
  expect(container.querySelector('[data-testid="slei-settings-overlay"]')?.textContent).toContain("账号资料");
});

it("returns from settings overlay to the previously visible workspace", async () => {
  const container = await mount(
    <SleiAppFrame activeView="tasks" data={createSleiFixtures()} locale="zh-CN" runtimeSetup={readyRuntime} />,
  );

  await clickElement(container.querySelector('[data-testid="slei-sidebar-settings-trigger"]'));
  await clickElement(document.querySelector('[data-testid="slei-sidebar-settings-account"]'));
  await clickElement(container.querySelector('[data-testid="slei-settings-return"]'));

  expect(container.querySelector('[data-testid="slei-settings-overlay"]')).toBeNull();
  expect(container.querySelector('[data-active-view="tasks"]')).toBeTruthy();
});

it("keeps legacy activeView settings route available for compatibility", () => {
  const html = renderToStaticMarkup(
    <SleiAppFrame activeView="settings" data={createSleiFixtures()} locale="zh-CN" runtimeSetup={readyRuntime} />,
  );
  expect(html).toContain('data-settings-panel="account"');
});
```

Use existing local test helpers (`clickElement`, `createSleiFixtures`, `readyRuntime`) already present in the file.

- [ ] **Step 2: Run frame tests and verify failure**

Run:

```bash
pnpm --filter @slei/desktop test -- src/app/SleiAppFrame.test.tsx
```

Expected: FAIL because overlay is not wired and settings menu items do not have the expected test ids.

- [ ] **Step 3: Add minimal settings-open callback to `WorkspaceSidebar`**

Add a new optional prop while keeping legacy props:

```ts
onSettingsOpen?: (panel: SettingsOverlayPanel) => void;
```

Add `data-testid="slei-sidebar-settings-trigger"` to the bottom settings icon trigger.

Keep the settings icon as the existing dropdown trigger. Do not make the gear directly navigate. Add `data-testid` values to the existing menu entries and convert the account menu entry to open the overlay account panel:

```tsx
<Button
  aria-label={input.messages.shell.workspaceSidebar.openSettingsMenu}
  className="size-8 [&_svg]:size-3.5"
  data-testid="slei-sidebar-settings-trigger"
  size="icon"
  type="button"
  variant="ghost"
>
  <SleiIcon name="settings" size={15} />
</Button>

<DropdownMenuItem data-testid="slei-sidebar-settings-account" onSelect={() => input.onSettingsOpen?.("account")}>
  <SleiIcon name="user" size={14} />
  {input.messages.shell.workspaceSidebar.accountProfile}
</DropdownMenuItem>
```

Keep the other dropdown menu items untouched until Task 5. The goal here is only to provide a minimal account overlay entrypoint so Task 4 can pass and commit cleanly while preserving the menu interaction model.

- [ ] **Step 4: Add overlay state to `SleiAppFrame`**

Add state:

```ts
const [settingsOverlayOpen, setSettingsOverlayOpen] = useState(false);
const [activeSettingsOverlayPanel, setActiveSettingsOverlayPanel] = useState<SettingsOverlayPanel>(
  settingsOverlayPanelFromLegacyPanel(input.initialSettingsPanel ?? "account"),
);
```

Add helper:

```ts
function openSettingsOverlay(panel: SettingsOverlayPanel = "account") {
  setActiveSettingsOverlayPanel(panel);
  setSettingsOverlayOpen(true);
}
```

Do not mutate `input.activeView`.

- [ ] **Step 5: Pass the minimal callback into `WorkspaceSidebar`**

Pass:

```tsx
onSettingsOpen={openSettingsOverlay}
```

Do not remove `onSettingsPanelSelect={setActiveSettingsPanel}` yet. Task 5 will convert the bottom menu entries from legacy view routing to overlay panel routing.

- [ ] **Step 6: Render overlay above content**

Inside `SleiAppFrame`, render `SettingsOverlay` as a sibling within the shell:

```tsx
{settingsOverlayOpen ? (
  <SettingsOverlay
    activePanel={activeSettingsOverlayPanel}
    messages={messages}
    onClose={() => setSettingsOverlayOpen(false)}
    onPanelChange={setActiveSettingsOverlayPanel}
    renderDetail={(panel) => renderSettingsOverlayDetail(panel, input, data, runtimeSetup, messages, profile, normalizedAppearance, input.notifications ?? defaultNotifications)}
  />
) : null}
```

Add `renderSettingsOverlayDetail` near `renderWorkspace` or as a small helper. It should pass existing props to:

- `SettingsRoute` for account/about where possible.
- a new preferences composition for legacy language/appearance/notifications.
- `MembersRoute layout="settings"`.
- `ComputersRoute layout="settings"`.

Keep `renderWorkspace(activeView === "settings")` unchanged for compatibility.

- [ ] **Step 7: Hide sidebar and resize handle while overlay is open**

In JSX:

```tsx
<div className={cn("slei-workspace-sidebar-card min-h-0 max-[760px]:hidden", settingsOverlayOpen && "hidden")} data-settings-overlay-hidden={settingsOverlayOpen ? "true" : undefined} data-slot="sidebar-card">
```

and conditionally apply `hidden` or `aria-hidden` to sidebar card and resize handle while overlay is open.

The overlay itself is fixed and should visually cover the content, but tests should have an explicit DOM signal.

- [ ] **Step 8: Run frame tests**

Run:

```bash
pnpm --filter @slei/desktop test -- src/app/SleiAppFrame.test.tsx
```

Expected: PASS. Do not commit with known failures from sidebar wiring.

- [ ] **Step 9: Commit**

```bash
git add apps/desktop/src/app/WorkspaceSidebar.tsx apps/desktop/src/app/SleiAppFrame.tsx apps/desktop/src/app/SleiAppFrame.test.tsx
git commit -m "feat: open settings as full-page overlay"
```

---

### Task 5: Move Saved Into Sidebar Top Nav And Convert All Bottom Menu Entries To Overlay Entrypoints

**Files:**
- Modify: `apps/desktop/src/app/WorkspaceSidebar.tsx`
- Modify: `apps/desktop/src/app/SleiAppFrame.tsx`
- Modify: `apps/desktop/src/app/SleiAppFrame.test.tsx`
- Modify: `apps/desktop/e2e/saved-messages.spec.tsx`

- [ ] **Step 1: Write failing sidebar tests**

Add tests:

```tsx
it("renders saved after search and tasks in the workspace sidebar top nav", () => {
  const html = renderToStaticMarkup(
    <SleiAppFrame activeView="chat" data={createSleiFixtures()} locale="zh-CN" runtimeSetup={readyRuntime} />,
  );
  const searchIndex = html.indexOf(">搜索<");
  const tasksIndex = html.indexOf(">任务<");
  const savedIndex = html.indexOf(">已保存<");
  expect(searchIndex).toBeGreaterThan(-1);
  expect(tasksIndex).toBeGreaterThan(searchIndex);
  expect(savedIndex).toBeGreaterThan(tasksIndex);
});

it("opens saved workspace from the sidebar top nav", async () => {
  const onSavedMessagesOpen = vi.fn();
  const container = await mount(
    <SleiAppFrame
      activeView="chat"
      data={createSleiFixtures()}
      locale="zh-CN"
      onSavedMessagesOpen={onSavedMessagesOpen}
      runtimeSetup={readyRuntime}
    />,
  );

  await clickElement(container.querySelector('[data-testid="slei-sidebar-saved"]'));
  expect(onSavedMessagesOpen).toHaveBeenCalledTimes(1);
});

it("removes saved from the bottom settings menu and routes settings entries into overlay panels", async () => {
  const container = await mount(
    <SleiAppFrame activeView="chat" data={createSleiFixtures()} locale="zh-CN" runtimeSetup={readyRuntime} />,
  );

  await clickElement(container.querySelector('[data-testid="slei-sidebar-settings-trigger"]'));
  const menuText = document.querySelector('[data-testid="slei-sidebar-settings-menu"]')?.textContent ?? "";
  expect(menuText).not.toContain("已保存");
  await clickElement(document.querySelector('[data-testid="slei-sidebar-settings-members"]'));
  expect(container.querySelector('[data-testid="slei-settings-overlay"]')?.textContent).toContain("成员管理");
});

it("opens each bottom settings menu entry into the matching overlay panel", async () => {
  const cases = [
    ["slei-sidebar-settings-members", "成员管理"],
    ["slei-sidebar-settings-devices", "设备管理"],
    ["slei-sidebar-settings-account", "账号资料"],
    ["slei-sidebar-settings-preferences", "偏好设置"],
  ] as const;

  for (const [testId, label] of cases) {
    const container = await mount(
      <SleiAppFrame activeView="chat" data={createSleiFixtures()} locale="zh-CN" runtimeSetup={readyRuntime} />,
    );
    await clickElement(container.querySelector('[data-testid="slei-sidebar-settings-trigger"]'));
    await clickElement(document.querySelector(`[data-testid="${testId}"]`));
    expect(container.querySelector('[data-testid="slei-settings-overlay"]')?.textContent).toContain(label);
    await unmountCurrentFrame();
  }
});
```

If the local test file does not already expose `unmountCurrentFrame`, use the existing `afterEach` cleanup or split this into four independent `it` blocks instead of introducing a new helper.

Also add a source or markup assertion proving Saved is gone from the dropdown menu while remaining in the top nav.

```tsx
it("does not render saved in the settings dropdown", async () => {
  const container = await mount(
    <SleiAppFrame activeView="chat" data={createSleiFixtures()} locale="zh-CN" runtimeSetup={readyRuntime} />,
  );

  await clickElement(container.querySelector('[data-testid="slei-sidebar-settings-trigger"]'));
  const dropdownText = document.querySelector('[data-testid="slei-sidebar-settings-menu"]')?.textContent ?? "";
  expect(dropdownText).not.toContain("已保存");
});
```

Adjust selectors to match existing helper patterns.

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
pnpm --filter @slei/desktop test -- src/app/SleiAppFrame.test.tsx e2e/saved-messages.spec.tsx
```

Expected: FAIL because Saved is still in the bottom menu and settings entries do not open overlay panels.

- [ ] **Step 3: Update `WorkspaceSidebarProps`**

Use the `onSettingsOpen` callback added in Task 4:

```ts
onSettingsOpen?: (panel: SettingsOverlayPanel) => void;
```

Keep `onSettingsPanelSelect?: (panel: SettingsPanel) => void` only if legacy tests still need it, but all new bottom menu entries should use `onSettingsOpen`.

- [ ] **Step 4: Add Saved top nav item**

In the primary nav after Tasks:

```tsx
<Button
  aria-current={input.activeChatWorkspace === "saved" ? "page" : undefined}
  className={cn(sidebarPrimaryActionClassName, input.activeChatWorkspace === "saved" && sidebarFlatActiveClassName)}
  data-testid="slei-sidebar-saved"
  onClick={() => input.onSavedMessagesOpen?.()}
  type="button"
  variant="ghost"
>
  <SleiIcon name="bookmark" size={15} />
  {input.messages.shell.workspaceSidebar.savedMessages}
</Button>
```

Do not call `onViewChange("settings")`.

- [ ] **Step 5: Convert bottom menu entries**

Bottom menu should include these `data-testid` markers:

- Members: `data-testid="slei-sidebar-settings-members"` and `input.onSettingsOpen?.("members")`
- Devices: `data-testid="slei-sidebar-settings-devices"` and `input.onSettingsOpen?.("devices")`
- Account: `data-testid="slei-sidebar-settings-account"` and `input.onSettingsOpen?.("account")`
- Preferences: `data-testid="slei-sidebar-settings-preferences"` and `input.onSettingsOpen?.("preferences")`

Remove Saved from this menu.

Add `data-testid="slei-sidebar-settings-menu"` to `DropdownMenuContent` so tests can scope menu assertions.

- [ ] **Step 6: Wire `SleiAppFrame` to sidebar**

Pass:

```tsx
onSettingsOpen={openSettingsOverlay}
onSavedMessagesOpen={input.onSavedMessagesOpen}
```

Keep `onSettingsPanelSelect={setActiveSettingsPanel}` only for legacy activeView settings if required by direct route code paths.

- [ ] **Step 7: Run sidebar/saved tests**

Run:

```bash
pnpm --filter @slei/desktop test -- src/app/SleiAppFrame.test.tsx e2e/saved-messages.spec.tsx
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/desktop/src/app/WorkspaceSidebar.tsx apps/desktop/src/app/SleiAppFrame.tsx apps/desktop/src/app/SleiAppFrame.test.tsx apps/desktop/e2e/saved-messages.spec.tsx
git commit -m "feat: move saved into sidebar navigation"
```

---

### Task 6: Preserve Legacy Settings Route And Preferences Behavior

**Files:**
- Modify: `apps/desktop/src/app/SleiAppFrame.tsx`
- Modify: `apps/desktop/src/features/settings/SettingsPageView.tsx` if needed
- Modify: `apps/desktop/e2e/settings-preferences.spec.tsx`
- Modify: `apps/desktop/e2e/chinese-members.spec.tsx`
- Modify: `apps/desktop/e2e/i18n.spec.tsx`

- [ ] **Step 1: Update failing legacy expectations**

Existing tests such as `settings-preferences.spec.tsx` currently expect settings to render while workspace sidebar stays present. Keep that test for legacy `activeView="settings"` if desired, but add new tests proving overlay is the new sidebar entry path.

Change only expectations contradicted by the new spec. Do not remove coverage for account, language, notifications, appearance, about, avatar upload, or i18n labels.

- [ ] **Step 2: Write compatibility tests for old settings panels**

Add tests:

```tsx
it("still renders legacy settings view for direct activeView settings", () => {
  const html = renderToStaticMarkup(
    <SleiAppFrame activeView="settings" initialSettingsPanel="appearance" data={data} locale="zh-CN" runtimeSetup={readyRuntime} />,
  );
  expect(html).toContain('data-settings-panel="appearance"');
  expect(html).toContain("外观");
});
```

And overlay preference test:

```tsx
it("opens preference overlay from the bottom menu and shows language appearance and notification controls", async () => {
  // click settings trigger, click preferences entry if menu remains, or open via helper
  expect(container.textContent).toContain("语言");
  expect(container.textContent).toContain("外观");
  expect(container.textContent).toContain("通知");
});
```

- [ ] **Step 3: Run settings/i18n tests**

Run:

```bash
pnpm --filter @slei/desktop test -- e2e/settings-preferences.spec.tsx e2e/chinese-members.spec.tsx e2e/i18n.spec.tsx src/features/settings/SettingsPageView.test.tsx
```

Expected: FAIL until expectations are aligned.

- [ ] **Step 4: Fix implementation or tests without reducing behavior**

Ensure:

- Legacy route still renders `SettingsRoute`.
- Overlay preferences includes language, appearance, and notifications.
- Chinese and English labels exist.
- Account avatar upload still reaches provided callback.
- No mock production data appears.

- [ ] **Step 5: Rerun focused tests**

Run:

```bash
pnpm --filter @slei/desktop test -- e2e/settings-preferences.spec.tsx e2e/chinese-members.spec.tsx e2e/i18n.spec.tsx src/features/settings/SettingsPageView.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/app/SleiAppFrame.tsx apps/desktop/src/features/settings/SettingsPageView.tsx apps/desktop/e2e/settings-preferences.spec.tsx apps/desktop/e2e/chinese-members.spec.tsx apps/desktop/e2e/i18n.spec.tsx apps/desktop/src/features/settings/SettingsPageView.test.tsx
git commit -m "test: preserve settings compatibility"
```

---

### Task 7: Final Verification And Polish

**Files:**
- Inspect: all files changed by previous tasks
- Optional modify: `apps/desktop/src/app/app.css`, `apps/desktop/src/features/settings/SettingsOverlay.tsx`, tests with brittle selectors

- [ ] **Step 1: Run full desktop tests**

Run:

```bash
pnpm --filter @slei/desktop test
```

Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run:

```bash
pnpm --filter @slei/desktop typecheck
```

Expected: PASS.

- [ ] **Step 3: Inspect CSS for one-note or separated-panel mistakes**

Run:

```bash
rg -n "settings-overlay|shadow-\\[|border-l|grid-cols|card" apps/desktop/src/features/settings apps/desktop/src/app/app.css
```

Expected:

- Overlay root has a continuous layout marker.
- Detail region has `border-l` and left shadow.
- No outer gap/floating card treatment separates left and right settings areas.

- [ ] **Step 4: Manually render key states in tests or app if practical**

At minimum, render static markup or run targeted tests for:

- Chat -> open settings -> account.
- Tasks -> open settings -> return.
- Settings overlay -> members.
- Settings overlay -> devices.
- Sidebar -> Saved.

If launching the desktop app is needed, use:

```bash
pnpm --filter @slei/desktop desktop
```

Do not start the Vite web dev server for an “启动 App” request.

- [ ] **Step 5: Check git status**

Run:

```bash
git status --short
```

Expected: only intentional changes are present, or clean after final commit.

- [ ] **Step 6: Commit final fixes if any**

```bash
git add <changed-files>
git commit -m "chore: verify settings overlay"
```

- [ ] **Step 7: Completion prompt**

When implementation is complete and verified, report:

- Summary of overlay, settings consolidation, and Saved nav changes.
- Exact tests run.
- Any known limitations.
- Ask whether to merge to `master` or another branch, per Slei project instruction.
