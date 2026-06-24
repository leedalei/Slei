# Slei Soft UI Tabler Icons Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Slei 桌面端完整迁移到 shadcn + 中拟物 Soft UI + wellness 色系，并用 `@tabler/icons-react` 全量替换 `lucide-react`。

**Architecture:** 先建立 token、图标和 shadcn primitive 基座，再把重复视觉模式沉入 Slei 复用组件，最后逐页面迁移 Shell、结构化页面、Tasks/Search/Empty 和 Chat。React 仍只负责展示、轻量 view-model 和 daemon command/API 触发；daemon/SQLite/路由/任务源消息语义不变。

**Tech Stack:** React 19, Tauri v2, Vite, Tailwind v4, shadcn/ui, Radix UI, `@tabler/icons-react`, Vitest/jsdom.

---

## Source Documents

- Spec: `docs/superpowers/specs/2026-06-24-slei-soft-ui-tabler-icons-design.md`
- Existing shadcn rebuild spec: `docs/superpowers/specs/2026-06-04-slei-shadcn-ui-rebuild-design.md`
- Architecture guardrails: `docs/architecture/0005-channel-routing-and-multi-agent-flow.md`
- Task source/card guardrails: `docs/architecture/0006-task-source-message-card.md`
- Project instructions: `AGENTS.md`

## Guardrails

- Do not revert user changes. Start each work session with `git status --short`.
- Do not change daemon contracts, SQLite persistence, routing semantics, task-card/source-message behavior, or coordinator routing logic.
- Do not introduce production mock/demo/sample data.
- Do not add JSON production persistence.
- Keep `apps/desktop/src/components/ui/*` business-free shadcn primitives.
- Use shared Slei components or variants when a visual pattern appears in 2+ places.
- Final delivery is not complete until all scoped surfaces are migrated and `lucide-react` is gone.
- After implementation completes, ask whether to merge to `master` or another branch.

## File Structure Map

### Create

- `apps/desktop/src/components/icons.tsx`: semantic Tabler icon registry and reusable icon types.
- `apps/desktop/src/components/SleiIcon.tsx`: unified icon renderer, size/stroke/fill/aria policy.
- `apps/desktop/src/components/SleiIcon.test.tsx`: icon rendering and aria tests.
- `apps/desktop/src/components/SoftPanel.tsx`: shared soft panel/card/list item primitives for Slei composition.
- `apps/desktop/src/components/SoftPanel.test.tsx`: panel/list item DOM and variant tests.
- `apps/desktop/src/components/StatusBadge.tsx`: unified status badge with filled Tabler glyphs.
- `apps/desktop/src/components/StatusBadge.test.tsx`: run/task/member/node status rendering tests.
- `apps/desktop/src/components/PageHeader.tsx`: shared page header with icon tile and actions.
- `apps/desktop/src/components/PageHeader.test.tsx`: header structure/accessibility tests.
- `apps/desktop/src/components/PreferenceRow.tsx`: reusable settings/preference row.
- `apps/desktop/src/components/PreferenceRow.test.tsx`: preference row interaction tests.

### Modify

- `apps/desktop/package.json`: add `@tabler/icons-react` early, then remove `lucide-react` only after all imports are migrated.
- `pnpm-lock.yaml`: dependency lock update.
- `apps/desktop/src/app/app.css`: wellness token system, soft shadows, reduced legacy visual CSS.
- `apps/desktop/src/components/index.ts`: export new shared components.
- `apps/desktop/src/components/ui/button.tsx`: soft button variants.
- `apps/desktop/src/components/ui/card.tsx`: soft card variants.
- `apps/desktop/src/components/ui/input.tsx`: inset input styling.
- `apps/desktop/src/components/ui/textarea.tsx`: inset textarea styling.
- `apps/desktop/src/components/ui/select.tsx`: Tabler icons and soft select styles.
- `apps/desktop/src/components/ui/dropdown-menu.tsx`: Tabler icons and soft menu styles.
- `apps/desktop/src/components/ui/checkbox.tsx`: Tabler check icon and soft checkbox.
- `apps/desktop/src/components/ui/dialog.tsx`: Tabler close icon and soft dialog.
- `apps/desktop/src/components/ui/alert-dialog.tsx`: soft confirmation dialog.
- `apps/desktop/src/components/ui/sheet.tsx`: Tabler close icon and soft sheet.
- `apps/desktop/src/components/ui/popover.tsx`: soft popover surface.
- `apps/desktop/src/components/ui/accordion.tsx`: Tabler chevron and soft accordion.
- `apps/desktop/src/components/ui/badge.tsx`: soft/filled badge variants.
- `apps/desktop/src/components/ui/tabs.tsx`: soft segmented tabs.
- `apps/desktop/src/components/ui/tooltip.tsx`: soft tooltip surface.
- `apps/desktop/src/components/Toast.tsx`: soft toast.
- `apps/desktop/src/components/Empty.tsx`: soft empty state frame.
- `apps/desktop/src/components/TooltipButton.tsx`: icon policy compatibility.
- `apps/desktop/src/components/DetailBlock.tsx`: Tabler icon type and soft surface.
- `apps/desktop/src/components/EditableDetailField.tsx`: Tabler pencil and inset editor.
- `apps/desktop/src/components/StatusIndicators.tsx`: delegate status dots/badges to shared tokens.
- `apps/desktop/src/app/SleiAppFrame.tsx`: shell/nav/sidebar/dialog icon and soft surface migration.
- `apps/desktop/src/features/chat/ChatPageView.tsx`: chat dense surfaces and Tabler icons.
- `apps/desktop/src/features/chat/TaskRootEntry.tsx`: Tabler icons and soft task entry.
- `apps/desktop/src/features/tasks/TasksPageView.tsx`: task page, filters, board/list tabs.
- `apps/desktop/src/features/tasks/TaskThreadDrawer.tsx`: drawer and composer.
- `apps/desktop/src/features/members/MembersPageView.tsx`: member profile/detail soft cards.
- `apps/desktop/src/features/computers/ComputersPageView.tsx`: node list/detail soft cards.
- `apps/desktop/src/features/search/SearchPageView.tsx`: search input/filter/result soft list.
- `apps/desktop/src/features/settings/SettingsPageView.tsx`: preference rows/cards.

### Tests To Update

- `apps/desktop/src/components/ui/card.test.tsx`
- `apps/desktop/src/components/ui/tabs.test.tsx`
- `apps/desktop/src/components/ui-primitive-audit.test.tsx`
- `apps/desktop/src/components/Toast.test.tsx`
- `apps/desktop/src/components/EditableDetailField.test.tsx`
- `apps/desktop/src/app/SleiAppFrame.test.tsx`
- `apps/desktop/src/features/chat/ChatPageView.test.tsx`
- `apps/desktop/src/features/tasks/TasksPageView.test.tsx`
- `apps/desktop/src/features/members/MembersPageView.test.tsx`
- `apps/desktop/src/features/computers/ComputersPageView.test.tsx`
- `apps/desktop/src/features/search/SearchPageView.test.tsx`
- `apps/desktop/src/features/settings/SettingsPageView.test.tsx`

### E2E / Integration Tests To Run

Use exact file filters through the desktop package test script:

```bash
pnpm --filter @slei/desktop test -- e2e/accessibility.spec.ts e2e/design-system.spec.ts e2e/chat.spec.ts e2e/tasks.spec.ts e2e/members.spec.ts e2e/settings.spec.ts e2e/computers-management.spec.tsx e2e/empty-state.spec.tsx e2e/saved-messages.spec.tsx e2e/onboarding.spec.ts e2e/diagnostics.spec.ts
```

The full desktop test suite is mandatory before final delivery:

```bash
pnpm --filter @slei/desktop test
```

## Task 1: Baseline And Dependency Swap

**Files:**
- Modify: `apps/desktop/package.json`
- Modify: `pnpm-lock.yaml`
- Test: `apps/desktop/src/components/SleiIcon.test.tsx`

- [ ] **Step 1: Check worktree state**

Run:

```bash
git status --short
```

Expected: note any user changes and do not revert them.

- [ ] **Step 2: Run baseline typecheck**

Run:

```bash
pnpm --filter @slei/desktop typecheck
```

Expected: PASS or record existing failures before touching code.

- [ ] **Step 3: Write the first failing icon test**

Create `apps/desktop/src/components/SleiIcon.test.tsx`:

```tsx
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SleiIcon } from "./SleiIcon";

describe("SleiIcon", () => {
  it("renders decorative product icons as hidden svg elements", () => {
    const html = renderToStaticMarkup(<SleiIcon name="chat" />);

    expect(html).toContain("aria-hidden=\"true\"");
    expect(html).toContain("data-slei-icon=\"chat\"");
    expect(html).toContain("<svg");
  });

  it("allows labelled icons when the icon is the accessible content", () => {
    const html = renderToStaticMarkup(<SleiIcon decorative={false} label="搜索" name="search" />);

    expect(html).toContain("aria-label=\"搜索\"");
    expect(html).not.toContain("aria-hidden=\"true\"");
  });
});
```

- [ ] **Step 4: Run the failing test**

Run:

```bash
pnpm --filter @slei/desktop test -- src/components/SleiIcon.test.tsx
```

Expected: FAIL because `SleiIcon` does not exist.

- [ ] **Step 5: Add Tabler dependency while keeping Lucide during migration**

Run:

```bash
pnpm --filter @slei/desktop add @tabler/icons-react
```

Expected: `apps/desktop/package.json` contains both `@tabler/icons-react` and the existing `lucide-react`. Keeping Lucide temporarily preserves buildability until all imports are migrated.

- [ ] **Step 6: Commit Tabler dependency and failing test**

Run:

```bash
git add apps/desktop/package.json pnpm-lock.yaml apps/desktop/src/components/SleiIcon.test.tsx
git commit -m "test: define tabler icon contract"
```

Expected: commit succeeds with only these files.

## Task 2: Icon Infrastructure And Primitive Icon Migration

**Files:**
- Create: `apps/desktop/src/components/icons.tsx`
- Create: `apps/desktop/src/components/SleiIcon.tsx`
- Modify: `apps/desktop/src/components/index.ts`
- Modify: `apps/desktop/src/components/ui/select.tsx`
- Modify: `apps/desktop/src/components/ui/dropdown-menu.tsx`
- Modify: `apps/desktop/src/components/ui/checkbox.tsx`
- Modify: `apps/desktop/src/components/ui/dialog.tsx`
- Modify: `apps/desktop/src/components/ui/sheet.tsx`
- Modify: `apps/desktop/src/components/ui/accordion.tsx`
- Modify: `apps/desktop/src/components/ui/card.test.tsx`
- Test: `apps/desktop/src/components/SleiIcon.test.tsx`
- Test: `apps/desktop/src/components/ui-primitive-audit.test.tsx`

- [ ] **Step 1: Implement semantic icon registry**

Create `apps/desktop/src/components/icons.tsx` with this shape:

```tsx
import type { Icon, IconProps } from "@tabler/icons-react";
import {
  IconAlertCircleFilled,
  IconBellFilled,
  IconBookmarkFilled,
  IconCheck,
  IconCheckbox,
  IconChevronDown,
  IconChevronRight,
  IconChevronUp,
  IconCircleFilled,
  IconCopy,
  IconDeviceDesktopFilled,
  IconFolderPlus,
  IconHash,
  IconMessageCircleFilled,
  IconPencil,
  IconSearch,
  IconSend,
  IconSettingsFilled,
  IconSquareCheckFilled,
  IconTrash,
  IconUsersGroup,
  IconUserCircle,
  IconX,
} from "@tabler/icons-react";

export type SleiIconName =
  | "approval"
  | "bell"
  | "bookmark"
  | "check"
  | "chat"
  | "chevronDown"
  | "chevronRight"
  | "chevronUp"
  | "copy"
  | "delete"
  | "folderPlus"
  | "hash"
  | "members"
  | "pencil"
  | "search"
  | "send"
  | "settings"
  | "status"
  | "tasks"
  | "user"
  | "computer"
  | "x";

export type SleiTablerIcon = Icon;
export type SleiTablerIconProps = IconProps;

export const sleiIcons: Record<SleiIconName, SleiTablerIcon> = {
  approval: IconAlertCircleFilled,
  bell: IconBellFilled,
  bookmark: IconBookmarkFilled,
  check: IconCheck,
  chat: IconMessageCircleFilled,
  chevronDown: IconChevronDown,
  chevronRight: IconChevronRight,
  chevronUp: IconChevronUp,
  copy: IconCopy,
  delete: IconTrash,
  folderPlus: IconFolderPlus,
  hash: IconHash,
  members: IconUsersGroup,
  pencil: IconPencil,
  search: IconSearch,
  send: IconSend,
  settings: IconSettingsFilled,
  status: IconCircleFilled,
  tasks: IconSquareCheckFilled,
  user: IconUserCircle,
  computer: IconDeviceDesktopFilled,
  x: IconX,
};
```

- [ ] **Step 2: Implement SleiIcon**

Create `apps/desktop/src/components/SleiIcon.tsx`:

```tsx
import { cn } from "@/lib/utils";

import { sleiIcons, type SleiIconName, type SleiTablerIconProps } from "./icons";

export type SleiIconProps = Omit<SleiTablerIconProps, "name"> & {
  name: SleiIconName;
  decorative?: boolean;
  label?: string;
};

export function SleiIcon({
  name,
  decorative = true,
  label,
  className,
  size = 16,
  stroke = 1.9,
  ...props
}: SleiIconProps) {
  const Icon = sleiIcons[name];

  return (
    <Icon
      aria-hidden={decorative ? "true" : undefined}
      aria-label={!decorative ? label : undefined}
      className={cn("shrink-0", className)}
      data-slei-icon={name}
      size={size}
      stroke={stroke}
      {...props}
    />
  );
}
```

- [ ] **Step 3: Export icon utilities**

Modify `apps/desktop/src/components/index.ts`:

```ts
export { SleiIcon, type SleiIconProps } from "./SleiIcon";
export { sleiIcons, type SleiIconName, type SleiTablerIcon, type SleiTablerIconProps } from "./icons";
```

- [ ] **Step 4: Run icon test**

Run:

```bash
pnpm --filter @slei/desktop test -- src/components/SleiIcon.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Replace lucide imports in shadcn primitives**

Modify the primitive files:

- `apps/desktop/src/components/ui/select.tsx`: replace `ChevronDownIcon`, `ChevronUpIcon`, `CheckIcon` with `IconChevronDown`, `IconChevronUp`, `IconCheck`.
- `apps/desktop/src/components/ui/dropdown-menu.tsx`: replace check, chevron right, circle with Tabler equivalents.
- `apps/desktop/src/components/ui/checkbox.tsx`: replace check icon with `IconCheck`.
- `apps/desktop/src/components/ui/dialog.tsx`: replace `XIcon` with `IconX`.
- `apps/desktop/src/components/ui/sheet.tsx`: replace `XIcon` with `IconX`.
- `apps/desktop/src/components/ui/accordion.tsx`: replace `ChevronDown` with `IconChevronDown`.

Keep existing `aria-hidden`, sizes, and class names unless a class references Lucide-specific names.

- [ ] **Step 6: Update primitive tests that import lucide**

Modify `apps/desktop/src/components/ui/card.test.tsx` to import equivalent Tabler icons:

```tsx
import { IconDeviceDesktop, IconPencil } from "@tabler/icons-react";
```

Update local JSX references accordingly.

- [ ] **Step 7: Verify no primitive lucide imports remain**

Run:

```bash
rg "lucide-react" apps/desktop/src/components/ui apps/desktop/src/components/ui-primitive-audit.test.tsx apps/desktop/src/components/ui/card.test.tsx
```

Expected: no output.

- [ ] **Step 8: Run primitive tests**

Run:

```bash
pnpm --filter @slei/desktop test -- src/components/SleiIcon.test.tsx src/components/ui/card.test.tsx src/components/ui/tabs.test.tsx src/components/ui-primitive-audit.test.tsx
```

Expected: PASS.

- [ ] **Step 9: Commit icon infrastructure**

Run:

```bash
git add apps/desktop/src/components/icons.tsx apps/desktop/src/components/SleiIcon.tsx apps/desktop/src/components/index.ts apps/desktop/src/components/ui apps/desktop/src/components/ui/card.test.tsx apps/desktop/src/components/SleiIcon.test.tsx
git commit -m "feat: add tabler icon system"
```

Expected: commit succeeds.

## Task 3: Wellness Soft Tokens And Shadcn Primitive Variants

**Files:**
- Modify: `apps/desktop/src/app/app.css`
- Modify: `apps/desktop/src/components/ui/button.tsx`
- Modify: `apps/desktop/src/components/ui/card.tsx`
- Modify: `apps/desktop/src/components/ui/input.tsx`
- Modify: `apps/desktop/src/components/ui/textarea.tsx`
- Modify: `apps/desktop/src/components/ui/badge.tsx`
- Modify: `apps/desktop/src/components/ui/tabs.tsx`
- Modify: `apps/desktop/src/components/ui/select.tsx`
- Modify: `apps/desktop/src/components/ui/dialog.tsx`
- Modify: `apps/desktop/src/components/ui/alert-dialog.tsx`
- Modify: `apps/desktop/src/components/ui/sheet.tsx`
- Modify: `apps/desktop/src/components/ui/popover.tsx`
- Modify: `apps/desktop/src/components/ui/tooltip.tsx`
- Test: `apps/desktop/src/components/ui/card.test.tsx`
- Test: `apps/desktop/src/components/ui/tabs.test.tsx`
- Test: `apps/desktop/src/components/ui-primitive-audit.test.tsx`

- [ ] **Step 1: Add primitive tests for soft variants**

Extend `apps/desktop/src/components/ui/card.test.tsx`:

```tsx
it("renders raised and inset card variants", () => {
  const raised = renderToStaticMarkup(<Card variant="raised">Raised</Card>);
  const inset = renderToStaticMarkup(<Card variant="inset">Inset</Card>);

  expect(raised).toContain('data-variant="raised"');
  expect(inset).toContain('data-variant="inset"');
});
```

Extend `apps/desktop/src/components/ui/tabs.test.tsx`:

```tsx
it("supports the soft segmented tabs variant", () => {
  const html = renderToStaticMarkup(
    <Tabs defaultValue="chat">
      <TabsList variant="soft">
        <TabsTrigger value="chat">Chat</TabsTrigger>
      </TabsList>
    </Tabs>,
  );

  expect(html).toContain('data-variant="soft"');
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
pnpm --filter @slei/desktop test -- src/components/ui/card.test.tsx src/components/ui/tabs.test.tsx
```

Expected: FAIL because `variant="raised"`, `variant="inset"`, or `variant="soft"` is not implemented.

- [ ] **Step 3: Replace theme tokens in app.css**

Modify `apps/desktop/src/app/app.css` `:root` and `.dark` to use wellness roles:

```css
:root {
  --background: oklch(0.982 0.012 196);
  --foreground: oklch(0.255 0.044 210);
  --card: oklch(0.965 0.014 185);
  --card-foreground: oklch(0.245 0.04 210);
  --primary: oklch(0.54 0.11 195);
  --primary-foreground: oklch(0.99 0.005 190);
  --secondary: oklch(0.91 0.045 165);
  --secondary-foreground: oklch(0.29 0.052 174);
  --muted: oklch(0.93 0.018 195);
  --muted-foreground: oklch(0.46 0.035 210);
  --accent: oklch(0.88 0.055 168);
  --accent-foreground: oklch(0.25 0.045 175);
  --ring: oklch(0.58 0.105 190);
  --slei-shadow-highlight: oklch(1 0 0 / 0.86);
  --slei-shadow-lowlight: oklch(0.48 0.05 210 / 0.16);
  --slei-shadow-raised: -6px -6px 14px var(--slei-shadow-highlight), 8px 8px 18px var(--slei-shadow-lowlight);
  --slei-shadow-inset: inset 3px 3px 8px var(--slei-shadow-lowlight), inset -3px -3px 8px var(--slei-shadow-highlight);
}
```

Keep existing compatibility aliases such as `--color-bg`, `--color-surface`, and text size variables, but remap them to the new shadcn tokens.

- [ ] **Step 4: Add soft variants to Card**

Modify `apps/desktop/src/components/ui/card.tsx` so `Card` accepts `variant?: "surface" | "raised" | "inset" | "interactive"` and writes `data-variant`.

Use variant classes like:

```tsx
variant === "raised" && "border-transparent bg-card shadow-[var(--slei-shadow-raised)]"
variant === "inset" && "border-border/60 bg-muted/40 shadow-[var(--slei-shadow-inset)]"
variant === "interactive" && "cursor-pointer border-border/70 bg-card shadow-sm transition-[background-color,box-shadow,color] hover:shadow-[var(--slei-shadow-raised)]"
```

- [ ] **Step 5: Add soft variants to Tabs**

Modify `apps/desktop/src/components/ui/tabs.tsx` to add `soft` in `tabsListVariants`:

```tsx
soft: "bg-muted/70 p-1 shadow-[var(--slei-shadow-inset)] group-data-[orientation=horizontal]/tabs:h-9",
```

Ensure active triggers remain keyboard accessible and show focus ring.

- [ ] **Step 6: Update Button/Input/Textarea/Badge/Dialog/AlertDialog/Sheet/Popover/Tooltip**

Apply the same token rules:

- Buttons: default uses raised primary, outline uses soft surface, ghost uses hover surface, destructive remains high contrast.
- Inputs/Textareas/Select: use `bg-muted/40 shadow-[var(--slei-shadow-inset)] focus-visible:ring-3`.
- Badge: add `soft` and `filled` variants.
- Dialog/AlertDialog/Sheet/Popover/Tooltip: use `bg-popover`, `ring-border/80`, and `shadow-[var(--slei-shadow-raised)]`.

- [ ] **Step 7: Run primitive tests**

Run:

```bash
pnpm --filter @slei/desktop test -- src/components/ui/card.test.tsx src/components/ui/tabs.test.tsx src/components/ui-primitive-audit.test.tsx
```

Expected: PASS.

- [ ] **Step 8: Typecheck**

Run:

```bash
pnpm --filter @slei/desktop typecheck
```

Expected: PASS.

- [ ] **Step 9: Commit soft primitives**

Run:

```bash
git add apps/desktop/src/app/app.css apps/desktop/src/components/ui apps/desktop/src/components/ui/card.test.tsx apps/desktop/src/components/ui/tabs.test.tsx
git commit -m "feat: add wellness soft ui primitives"
```

Expected: commit succeeds.

## Task 4: Shared Slei Composition Components

**Files:**
- Create: `apps/desktop/src/components/SoftPanel.tsx`
- Create: `apps/desktop/src/components/SoftPanel.test.tsx`
- Create: `apps/desktop/src/components/StatusBadge.tsx`
- Create: `apps/desktop/src/components/StatusBadge.test.tsx`
- Create: `apps/desktop/src/components/PageHeader.tsx`
- Create: `apps/desktop/src/components/PageHeader.test.tsx`
- Create: `apps/desktop/src/components/PreferenceRow.tsx`
- Create: `apps/desktop/src/components/PreferenceRow.test.tsx`
- Modify: `apps/desktop/src/components/index.ts`
- Modify: `apps/desktop/src/components/Toast.tsx`
- Modify: `apps/desktop/src/components/Empty.tsx`
- Modify: `apps/desktop/src/components/TooltipButton.tsx`
- Modify: `apps/desktop/src/components/DetailBlock.tsx`
- Modify: `apps/desktop/src/components/EditableDetailField.tsx`
- Modify: `apps/desktop/src/components/StatusIndicators.tsx`
- Test: `apps/desktop/src/components/Toast.test.tsx`
- Test: `apps/desktop/src/components/EditableDetailField.test.tsx`

- [ ] **Step 1: Write failing shared component tests**

Create tests that assert stable DOM contracts:

```tsx
// apps/desktop/src/components/StatusBadge.test.tsx
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { StatusBadge } from "./StatusBadge";

describe("StatusBadge", () => {
  it("renders a filled task status badge with a semantic data attribute", () => {
    const html = renderToStaticMarkup(<StatusBadge label="运行中" status="running" />);

    expect(html).toContain('data-slei-status="running"');
    expect(html).toContain("运行中");
    expect(html).toContain("<svg");
  });
});
```

Use equivalent tests for:

- `SoftPanel`: `data-slei-panel`, `data-variant`.
- `PageHeader`: `data-slei-page-header`, title text, action slot.
- `PreferenceRow`: label, description, control slot.

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
pnpm --filter @slei/desktop test -- src/components/SoftPanel.test.tsx src/components/StatusBadge.test.tsx src/components/PageHeader.test.tsx src/components/PreferenceRow.test.tsx
```

Expected: FAIL because components do not exist.

- [ ] **Step 3: Implement shared components minimally**

Implement:

- `SoftPanel`: wrapper around `Card` or `section`, supports `variant="surface" | "raised" | "inset" | "listItem"`.
- `StatusBadge`: wrapper around `Badge variant="filled"` with `status` tone mapping and `SleiIcon name="status"`.
- `PageHeader`: title/subtitle/icon/actions layout.
- `PreferenceRow`: label/description/control layout with optional error text.

Keep these files UI-only; no daemon data rules.

- [ ] **Step 4: Export shared components**

Modify `apps/desktop/src/components/index.ts`:

```ts
export { PageHeader } from "./PageHeader";
export { PreferenceRow } from "./PreferenceRow";
export { SoftPanel } from "./SoftPanel";
export { StatusBadge } from "./StatusBadge";
```

- [ ] **Step 5: Migrate existing shared components**

Modify:

- `Toast.tsx`: use soft surface and existing toast timing.
- `Empty.tsx`: use `EmptyStateFrame`/`SoftPanel` structure if added, otherwise `SoftPanel`.
- `TooltipButton.tsx`: continue using `Button`; no icon library import.
- `DetailBlock.tsx`: replace `LucideIcon` type with `SleiTablerIcon` type.
- `EditableDetailField.tsx`: replace `Pencil` with `SleiIcon name="pencil"` or Tabler mapping.
- `StatusIndicators.tsx`: use shared status token classes; preserve exported `MessageStatusSquare` and `StatusDot`.

- [ ] **Step 6: Run shared tests**

Run:

```bash
pnpm --filter @slei/desktop test -- src/components/SoftPanel.test.tsx src/components/StatusBadge.test.tsx src/components/PageHeader.test.tsx src/components/PreferenceRow.test.tsx src/components/Toast.test.tsx src/components/EditableDetailField.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Verify no lucide in shared components**

Run:

```bash
rg "lucide-react" apps/desktop/src/components
```

Expected: no output.

- [ ] **Step 8: Commit shared components**

Run:

```bash
git add apps/desktop/src/components
git commit -m "feat: add soft shared desktop components"
```

Expected: commit succeeds.

## Task 5: Shell, Navigation, Sidebar, And App Frame

**Files:**
- Modify: `apps/desktop/src/app/SleiAppFrame.tsx`
- Modify: `apps/desktop/src/app/SleiAppFrame.test.tsx`
- Modify: `apps/desktop/src/app/app.css`
- Test: `apps/desktop/e2e/shell.spec.ts`
- Test: `apps/desktop/e2e/react-shell.spec.tsx`
- Test: `apps/desktop/e2e/design-system.spec.ts`

- [ ] **Step 1: Add shell tests for Tabler and soft nav contract**

Extend `apps/desktop/src/app/SleiAppFrame.test.tsx`:

```tsx
it("renders the primary navigation with soft icon buttons", async () => {
  const container = await mount(
    <SleiAppFrame
      activeView="chat"
      data={createSleiFixtures()}
      locale="zh-CN"
      runtimeSetup={runtimeSetup}
    />,
  );
  const navButtons = container.querySelectorAll("[data-nav-icon]");

  expect(navButtons.length).toBeGreaterThan(0);
  expect(container.querySelector("[data-slei-icon]")).not.toBeNull();
  expect(container.querySelector("[data-nav-icon=\"chat\"]")?.getAttribute("aria-current")).toBe("page");
});
```

Use the existing `mount`, `createSleiFixtures`, and `runtimeSetup` helpers already defined near the top of `SleiAppFrame.test.tsx`.

- [ ] **Step 2: Run shell test to verify failure**

Run:

```bash
pnpm --filter @slei/desktop test -- src/app/SleiAppFrame.test.tsx
```

Expected: FAIL until `SleiAppFrame` uses `SleiIcon`.

- [ ] **Step 3: Replace SleiAppFrame lucide imports**

Modify `apps/desktop/src/app/SleiAppFrame.tsx`:

- Remove all imports from `lucide-react`.
- Replace `LucideIcon` with `SleiIconName` or `SleiTablerIcon`.
- Define `navItems` with semantic icon names:

```tsx
const navItems: Array<{ id: AppView; icon: SleiIconName }> = [
  { id: "search", icon: "search" },
  { id: "chat", icon: "chat" },
  { id: "tasks", icon: "tasks" },
  { id: "members", icon: "members" },
  { id: "computers", icon: "computer" },
  { id: "settings", icon: "settings" },
];
```

Render icons with:

```tsx
<SleiIcon aria-hidden="true" className="size-5" name={item.icon} size={22} />
```

- [ ] **Step 4: Apply soft shell surfaces**

Update shell JSX classes:

- nav rail: `bg-sidebar/80`, soft border, subtle raised/inset active buttons.
- context sidebar: `bg-sidebar/75`, soft panel header.
- resize handle: focus visible, no layout shift.
- guide overlay and runtime modal: new soft dialog surface.

Keep all existing event handlers and callback props unchanged.

- [ ] **Step 5: Run shell tests**

Run:

```bash
pnpm --filter @slei/desktop test -- src/app/SleiAppFrame.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Run shell e2e slice**

Run:

```bash
pnpm --filter @slei/desktop test -- e2e/shell.spec.ts e2e/react-shell.spec.tsx e2e/design-system.spec.ts
```

Expected: PASS.

- [ ] **Step 7: Commit shell migration**

Run:

```bash
git add apps/desktop/src/app/SleiAppFrame.tsx apps/desktop/src/app/SleiAppFrame.test.tsx apps/desktop/src/app/app.css
git commit -m "feat: refresh shell with soft tabler navigation"
```

Expected: commit succeeds.

## Task 6: Structured Pages - Settings, Members, Computers

**Files:**
- Modify: `apps/desktop/src/features/settings/SettingsPageView.tsx`
- Modify: `apps/desktop/src/features/settings/SettingsPageView.test.tsx`
- Modify: `apps/desktop/src/features/members/MembersPageView.tsx`
- Modify: `apps/desktop/src/features/members/MembersPageView.test.tsx`
- Modify: `apps/desktop/src/features/computers/ComputersPageView.tsx`
- Modify: `apps/desktop/src/features/computers/ComputersPageView.test.tsx`
- Test: `apps/desktop/e2e/settings.spec.ts`
- Test: `apps/desktop/e2e/settings-preferences.spec.tsx`
- Test: `apps/desktop/e2e/members.spec.ts`
- Test: `apps/desktop/e2e/computers-management.spec.tsx`

- [ ] **Step 1: Add/adjust tests for soft page contracts**

Update page tests to assert:

- Page header exists with `data-slei-page-header`.
- Cards or panels use `data-slei-panel`.
- Status badges use `data-slei-status`.
- Existing buttons and form labels remain accessible by current i18n text.

Example for Settings:

```tsx
expect(container.querySelector("[data-slei-page-header]")).not.toBeNull();
expect(container.querySelector("[data-slei-preference-row]")).not.toBeNull();
```

- [ ] **Step 2: Run structured page tests to verify failure**

Run:

```bash
pnpm --filter @slei/desktop test -- src/features/settings/SettingsPageView.test.tsx src/features/members/MembersPageView.test.tsx src/features/computers/ComputersPageView.test.tsx
```

Expected: FAIL until pages use shared soft components.

- [ ] **Step 3: Migrate Settings**

Modify `SettingsPageView.tsx`:

- Replace duplicated preference/card class recipes with `PageHeader`, `SoftPanel`, `PreferenceRow`.
- Keep existing `onProfileChange`, `onLocaleChange`, `onTimeZoneChange`, `onAppearanceChange`, `onNotificationsChange` calls.
- Preserve light/dark normalization behavior; do not add a third theme.
- Use `SleiIcon`/semantic Tabler icons for panel labels.

- [ ] **Step 4: Migrate Members**

Modify `MembersPageView.tsx`:

- Remove `lucide-react` import.
- Use `PageHeader` for member detail header.
- Use `SoftPanel` for profile, runtime, skills, capabilities, permissions, workspace.
- Use `StatusBadge` for runtime/permission/status surfaces.
- Preserve member selection, message, delete, edit/update, open path, list activity/workspace callbacks.

- [ ] **Step 5: Migrate Computers**

Modify `ComputersPageView.tsx`:

- Remove `lucide-react` import and `LucideIcon` type.
- Use `SleiIcon` for node, bot, calendar, CPU/server-like icons from registry; add registry names if needed.
- Use `SoftPanel` and `StatusBadge` for node list/detail/runtime status.
- Preserve create, delete, rename, refresh behavior.

- [ ] **Step 6: Run structured page tests**

Run:

```bash
pnpm --filter @slei/desktop test -- src/features/settings/SettingsPageView.test.tsx src/features/members/MembersPageView.test.tsx src/features/computers/ComputersPageView.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Run structured e2e slice**

Run:

```bash
pnpm --filter @slei/desktop test -- e2e/settings.spec.ts e2e/settings-preferences.spec.tsx e2e/members.spec.ts e2e/computers-management.spec.tsx
```

Expected: PASS.

- [ ] **Step 8: Verify no lucide in structured pages**

Run:

```bash
rg "lucide-react" apps/desktop/src/features/settings apps/desktop/src/features/members apps/desktop/src/features/computers
```

Expected: no output.

- [ ] **Step 9: Commit structured pages**

Run:

```bash
git add apps/desktop/src/features/settings apps/desktop/src/features/members apps/desktop/src/features/computers
git commit -m "feat: refresh structured pages with soft ui"
```

Expected: commit succeeds.

## Task 7: Tasks, Search, Saved, Empty, Diagnostics, Onboarding

**Files:**
- Modify: `apps/desktop/src/features/tasks/TasksPageView.tsx`
- Modify: `apps/desktop/src/features/tasks/TaskThreadDrawer.tsx`
- Modify: `apps/desktop/src/features/tasks/TasksPageView.test.tsx`
- Modify: `apps/desktop/src/features/search/SearchPageView.tsx`
- Modify: `apps/desktop/src/features/search/SearchPageView.test.tsx`
- Modify: `apps/desktop/src/app/SleiAppFrame.tsx`
- Modify: `apps/desktop/src/app/SleiAppFrame.test.tsx`
- Modify: `apps/desktop/src/components/Empty.tsx`
- Modify: `apps/desktop/src/components/Toast.tsx`
- Modify: `apps/desktop/src/features/diagnostics/DiagnosticsPage.ts`
- Modify: `apps/desktop/src/features/diagnostics/ErrorPanel.ts`
- Modify: `apps/desktop/src/features/diagnostics/LogExportDialog.ts`
- Modify: `apps/desktop/src/features/onboarding/OnboardingPage.ts`
- Modify: `apps/desktop/src/features/onboarding/ProfileStep.ts`
- Modify: `apps/desktop/src/features/onboarding/ConnectionStep.ts`
- Modify: `apps/desktop/src/features/onboarding/RuntimeStep.ts`
- Test: `apps/desktop/e2e/tasks.spec.ts`
- Test: `apps/desktop/e2e/saved-messages.spec.tsx`
- Test: `apps/desktop/e2e/empty-state.spec.tsx`
- Test: `apps/desktop/e2e/onboarding.spec.ts`
- Test: `apps/desktop/e2e/diagnostics.spec.ts`

- [ ] **Step 1: Add tests for task/search soft contracts**

Update:

- `TasksPageView.test.tsx`: assert task board/list controls use soft tabs and task status badges expose `data-slei-status`.
- `SearchPageView.test.tsx`: assert search input surface renders and result rows use shared list item/panel data attributes.
- `SleiAppFrame.test.tsx`: assert `SavedMessagesWorkspace` rows render a soft list item/panel data attribute while preserving unavailable states and click behavior.

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
pnpm --filter @slei/desktop test -- src/features/tasks/TasksPageView.test.tsx src/features/search/SearchPageView.test.tsx
```

Expected: FAIL until migrated.

- [ ] **Step 3: Migrate Tasks**

Modify `TasksPageView.tsx` and `TaskThreadDrawer.tsx`:

- Replace `lucide-react` imports with `SleiIcon` or Tabler registry.
- Use `TabsList variant="soft"` for board/list switching.
- Use `StatusBadge` for task statuses and attention markers.
- Use `SoftPanel` for board columns and list cards.
- Preserve `onTaskReply`, `onTaskStatusChange`, `onTaskThreadOpen`.

- [ ] **Step 4: Migrate Search**

Modify `SearchPageView.tsx`:

- Replace `lucide-react` imports.
- Use inset search input styling from primitive `Input`.
- Use `SoftPanel`/soft list item for result rows.
- Preserve global search filters, loading/error/empty states, and result callbacks.

- [ ] **Step 5: Migrate Saved messages workspace**

Modify the `SavedMessagesWorkspace` function inside `apps/desktop/src/app/SleiAppFrame.tsx`:

- Use `PageHeader` or compact local header styling for the saved workspace header.
- Replace saved message row class recipes with `SoftPanel variant="listItem"` or the shared soft list item pattern.
- Use `SleiIcon name="bookmark"` for saved state iconography.
- Preserve `onSelect`, unavailable-state opacity/disabled semantics, and `data-testid="slei-saved-workspace"`.
- Keep this as UI rendering only; do not change saved-message daemon data or callbacks.

- [ ] **Step 6: Migrate Empty, Diagnostics, Onboarding**

Modify empty/diagnostics/onboarding files:

- For React/TSX files such as `Empty.tsx` and `Toast.tsx`, use `SleiIcon`, `SoftPanel`, `PageHeader`, or primitive `Alert`/`Dialog` surfaces.
- For string-render `.ts` files under `features/diagnostics` and `features/onboarding`, do not import React components. Instead, update the returned markup/class names/data attributes to use the new global soft token classes and keep the existing string-render API.
- Preserve existing visible i18n text and existing empty/offline/error behavior.
- Do not introduce fake data to avoid empty states.

- [ ] **Step 7: Run unit/page tests**

Run:

```bash
pnpm --filter @slei/desktop test -- src/features/tasks/TasksPageView.test.tsx src/features/search/SearchPageView.test.tsx src/app/SleiAppFrame.test.tsx src/components/Toast.test.tsx
```

Expected: PASS.

- [ ] **Step 8: Run e2e slice**

Run:

```bash
pnpm --filter @slei/desktop test -- e2e/tasks.spec.ts e2e/saved-messages.spec.tsx e2e/empty-state.spec.tsx e2e/onboarding.spec.ts e2e/diagnostics.spec.ts
```

Expected: PASS.

- [ ] **Step 9: Verify no lucide in migrated surfaces**

Run:

```bash
rg "lucide-react" apps/desktop/src/features/tasks apps/desktop/src/features/search apps/desktop/src/features/diagnostics apps/desktop/src/features/onboarding apps/desktop/src/app/SleiAppFrame.tsx apps/desktop/src/components/Empty.tsx apps/desktop/src/components/Toast.tsx
```

Expected: no output.

- [ ] **Step 10: Commit task/search/saved/supporting surfaces**

Run:

```bash
git add apps/desktop/src/features/tasks apps/desktop/src/features/search apps/desktop/src/features/diagnostics apps/desktop/src/features/onboarding apps/desktop/src/app/SleiAppFrame.tsx apps/desktop/src/app/SleiAppFrame.test.tsx apps/desktop/src/components/Empty.tsx apps/desktop/src/components/Toast.tsx
git commit -m "feat: refresh task search saved and support surfaces"
```

Expected: commit succeeds.

## Task 8: Chat Dense Interaction Surfaces

**Files:**
- Modify: `apps/desktop/src/features/chat/ChatPageView.tsx`
- Modify: `apps/desktop/src/features/chat/TaskRootEntry.tsx`
- Modify: `apps/desktop/src/features/chat/ChatPageView.test.tsx`
- Modify: `apps/desktop/src/features/chat/ThreadPanel.test.ts`
- Test: `apps/desktop/e2e/chat.spec.ts`
- Test: `apps/desktop/e2e/chat-attachments.spec.tsx`
- Test: `apps/desktop/e2e/chat-channel-mentions.spec.tsx`
- Test: `apps/desktop/e2e/chat-markdown.spec.tsx`
- Test: `apps/desktop/e2e/composer-submit.spec.ts`
- Test: `apps/desktop/e2e/task-thread-flow.spec.tsx`

- [ ] **Step 1: Add/adjust chat tests for soft contracts without changing behavior**

Update `ChatPageView.test.tsx` to assert:

- Embedded chat/tasks tabs render `data-variant="soft"`.
- Message rows still expose existing test selectors and actions.
- Task root entries still expose task status and source message behavior.
- Composer submit behavior remains unchanged.

Do not rewrite task source-card expectations.

- [ ] **Step 2: Run chat tests to verify failure**

Run:

```bash
pnpm --filter @slei/desktop test -- src/features/chat/ChatPageView.test.tsx src/features/chat/ThreadPanel.test.ts
```

Expected: FAIL until chat surfaces migrate.

- [ ] **Step 3: Replace chat lucide imports**

Modify `ChatPageView.tsx` and `TaskRootEntry.tsx`:

- Remove imports from `lucide-react`.
- Use `SleiIcon` for semantic common actions.
- Extend `icons.tsx` if chat needs additional semantic names such as `attachment`, `image`, `panelOpen`, `panelClose`, `users`, `messageSquare`.

- [ ] **Step 4: Apply soft UI to chat while preserving density**

Modify chat surfaces:

- Channel header: `PageHeader` or local compact header with icon tile.
- Embedded tabs: `TabsList variant="soft"`.
- Timeline/message rows: `SoftPanel variant="listItem"` only for selection/hover, not oversized bubbles.
- Composer: inset textarea/upload/submit controls.
- Attachment chips: soft badge/card styling.
- Mention/slash pickers: soft popover/list item styling.
- Permission/interactive cards: raised soft panels with clear actions.
- Thread/session drawer: soft sheet/panel surfaces.

- [ ] **Step 5: Run chat tests**

Run:

```bash
pnpm --filter @slei/desktop test -- src/features/chat/ChatPageView.test.tsx src/features/chat/ThreadPanel.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run chat e2e slice**

Run:

```bash
pnpm --filter @slei/desktop test -- e2e/chat.spec.ts e2e/chat-attachments.spec.tsx e2e/chat-channel-mentions.spec.tsx e2e/chat-markdown.spec.tsx e2e/composer-submit.spec.ts e2e/task-thread-flow.spec.tsx
```

Expected: PASS.

- [ ] **Step 7: Verify no lucide in chat**

Run:

```bash
rg "lucide-react" apps/desktop/src/features/chat
```

Expected: no output.

- [ ] **Step 8: Commit chat migration**

Run:

```bash
git add apps/desktop/src/features/chat apps/desktop/src/components/icons.tsx
git commit -m "feat: refresh chat with soft tabler surfaces"
```

Expected: commit succeeds.

## Task 9: CSS Legacy Cleanup And Lucide Removal Audit

**Files:**
- Modify: `apps/desktop/src/app/app.css`
- Modify: `apps/desktop/package.json`
- Modify: `pnpm-lock.yaml`
- Modify: any remaining source files reported by `rg "lucide-react"`
- Test: `apps/desktop/src/components/ui-primitive-audit.test.tsx`
- Test: `apps/desktop/e2e/design-system.spec.ts`
- Test: `apps/desktop/e2e/accessibility.spec.ts`

- [ ] **Step 1: Audit remaining lucide source imports**

Run:

```bash
rg "lucide-react" apps/desktop/src
```

Expected: no output. If output exists, replace the remaining source import before removing the dependency.

- [ ] **Step 2: Remove lucide-react dependency**

Run:

```bash
pnpm --filter @slei/desktop remove lucide-react
```

Expected: `apps/desktop/package.json` and `pnpm-lock.yaml` no longer contain `lucide-react`; `@tabler/icons-react` remains.

- [ ] **Step 3: Confirm global lucide removal**

Run:

```bash
rg "lucide-react" apps/desktop/src apps/desktop/package.json pnpm-lock.yaml
```

Expected: no output.

- [ ] **Step 4: Audit old visual CSS recipes**

Run:

```bash
rg -n "slei-.*(button|card|badge|tab|dialog|panel|surface)|color-warning|color-rail-bg|shadow-soft" apps/desktop/src/app/app.css
```

Expected: only compatibility variables or truly global styles remain. Move page/component visual recipes to shadcn variants or shared components.

- [ ] **Step 5: Remove stale visual CSS**

Modify `apps/desktop/src/app/app.css`:

- Keep global token/base/scrollbar/focus/reduced-motion/markdown/sizing.
- Remove old `.slei-*` rules that duplicate button/card/badge/tab/dialog/list styling now owned by components.
- Keep class rules only when they are structural, markdown-related, or hard to express safely in Tailwind.

- [ ] **Step 6: Run audit tests**

Run:

```bash
pnpm --filter @slei/desktop test -- src/components/ui-primitive-audit.test.tsx e2e/design-system.spec.ts e2e/accessibility.spec.ts
```

Expected: PASS.

- [ ] **Step 7: Typecheck**

Run:

```bash
pnpm --filter @slei/desktop typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit cleanup**

Run:

```bash
git add apps/desktop/src/app/app.css apps/desktop/src apps/desktop/package.json pnpm-lock.yaml
git commit -m "chore: remove legacy lucide and visual css remnants"
```

Expected: commit succeeds.

## Task 10: Final Verification And Delivery

**Files:**
- Modify only files needed to fix verification failures.

- [ ] **Step 1: Run scoped UI e2e suite**

Run:

```bash
pnpm --filter @slei/desktop test -- e2e/accessibility.spec.ts e2e/design-system.spec.ts e2e/chat.spec.ts e2e/tasks.spec.ts e2e/members.spec.ts e2e/settings.spec.ts e2e/computers-management.spec.tsx e2e/empty-state.spec.tsx e2e/saved-messages.spec.tsx e2e/onboarding.spec.ts e2e/diagnostics.spec.ts
```

Expected: PASS.

- [ ] **Step 2: Run full desktop test suite**

Run:

```bash
pnpm --filter @slei/desktop test
```

Expected: PASS. This is mandatory before final delivery.

- [ ] **Step 3: Run typecheck**

Run:

```bash
pnpm --filter @slei/desktop typecheck
```

Expected: PASS.

- [ ] **Step 4: Run architecture guardrails**

Run:

```bash
pnpm test -- scripts/verify-architecture-guardrails.test.mjs
```

Expected: PASS. If the root test script does not accept this file filter, run the repository's documented architecture guardrail command and record the exact command used.

- [ ] **Step 5: Confirm dependency audit**

Run:

```bash
rg "lucide-react" apps/desktop/src apps/desktop/package.json pnpm-lock.yaml
rg "@tabler/icons-react" apps/desktop/package.json pnpm-lock.yaml apps/desktop/src
```

Expected: first command has no output; second command has package/lock/source matches.

- [ ] **Step 6: Confirm no production mock/persistence drift**

Run:

```bash
rg -n "(mock|demo|sample|fake|fixture)" apps/desktop/src --glob '!**/*.test.*' --glob '!**/test/**'
rg -n "localStorage|JSON\\.stringify|JSON\\.parse|\\.json" apps/desktop/src crates --glob '!**/*.test.*'
```

Expected: review any output manually. Existing lightweight UI preferences such as sort/cache are acceptable; new production business-state mock or JSON persistence is not.

- [ ] **Step 7: Fix any failures with focused commits**

For each failure:

```bash
git add apps/desktop/src apps/desktop/package.json pnpm-lock.yaml
git commit -m "fix: address soft ui verification issue"
```

Expected: every fix is scoped and verified with the failing command.

- [ ] **Step 8: Final status**

Run:

```bash
git status --short
```

Expected: clean worktree except for intentional uncommitted user changes that predated the implementation.

- [ ] **Step 9: Delivery message**

Final response must include:

- Summary of migrated surfaces.
- Verification commands and outcomes.
- Any tests not run and why.
- Explicit question: 是否合并到 `master` 或其他分支？
