# 侧边栏头像与职业标签 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将侧边栏私信头像调整为 34px，在名称右侧展示职业标签，并让全局头像使用 1px 中灰色实线边框。

**Architecture:** 继续以现有 `Avatar`/`MemberAvatar` 组件为唯一头像渲染入口。新增仅供私信列表使用的 `sidebar` 尺寸，私信行单独扩高到 40px；职业标签从 `SleiMember` 的 `profession` 回退到 `role`，只做展示层映射，不修改 daemon 或持久化 DTO。

**Tech Stack:** React, TypeScript, Tailwind utility classes, Vitest/React DOM static markup tests。

---

### Task 1: 扩展 Avatar 尺寸与全局边框

**Files:**
- Modify: `apps/desktop/src/components/MemberAvatar.tsx:8-56`
- Modify: `apps/desktop/src/components/ui/avatar.tsx:15-22`
- Test: `apps/desktop/src/components/MemberAvatar.test.tsx:114-136,305-330`
- Test: `apps/desktop/src/components/ui/avatar.test.tsx:6-88`

- [ ] **Step 1: Write the failing tests**

在 `MemberAvatar.test.tsx` 增加 `size="sidebar"` 的 DOM 断言：`data-avatar-size` 为 `sidebar`，class 含 `size-[2.125rem]`，且不使用 `size-7`；同步将默认和 small 头像的旧 `border-border` 断言改为 `border-muted-foreground/30`。在头像 primitive 测试中按 `[data-slot="avatar"]` 根节点断言全局边框为 1px `border` + `border-muted-foreground/30`。

`AvatarGroupCount` 是显示数量的圆形计数器，不属于头像根节点；保持它现有 `border-border` 样式，并在测试中明确只检查 `[data-slot="avatar"]`，避免把计数器误判为头像。

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @slei/desktop test -- src/components/MemberAvatar.test.tsx src/components/ui/avatar.test.tsx`

Expected: FAIL because `sidebar` 尺寸尚未被 `MemberAvatar` 接受，且头像 primitive 仍使用 `border-border`。

- [ ] **Step 3: Write the minimal implementation**

在 `MemberAvatarSize` 中加入 `sidebar`，映射到 `size-[2.125rem]`；primitive size 使用 default badge 规格。将 `AvatarPrimitive.Root` 的基础 class 从 `border border-border` 改为 `border border-muted-foreground/30`，保留 1px `border` 工具类。

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @slei/desktop test -- src/components/MemberAvatar.test.tsx src/components/ui/avatar.test.tsx`

Expected: PASS，既有 small 28px 与 large 尺寸断言保持通过。

### Task 2: 私信列表增加 34px 头像与职业标签

**Files:**
- Modify: `apps/desktop/src/app/WorkspaceSidebar.tsx:92-95,670-699`
- Test: `apps/desktop/src/app/SleiAppFrame.test.tsx:2080-2120` (同步更新旧的 `border-border` 与 `small` 断言)

- [ ] **Step 1: Write the failing DOM tests**

扩展私信列表测试，验证：私信行 class 含 `h-10` 与 `min-h-10`；触发器含 `h-full`；频道行仍含 `h-[32px]` 与 `min-h-[32px]`；头像为 `data-avatar-size="sidebar"` 且 class 含 `size-[2.125rem]`；头像根节点含 `border` 与 `border-muted-foreground/30`；名称和职业放在新增的 flex 容器中，不再假设名称是触发器的第二个直接子节点；职业标签使用 Badge 的 `data-slot="badge"` 和 `data-variant="secondary"`，优先显示 `profession`；当 profession 缺失时显示 role；两者缺失时不渲染 Badge；长职业文本所在容器含 `min-w-0`、最大宽度和 `truncate`。

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @slei/desktop test -- src/app/SleiAppFrame.test.tsx`

Expected: FAIL because the row remains 32px, uses the small avatar, and has no profession badge.

- [ ] **Step 3: Write the minimal implementation**

在私信 `SelectableCard` 上使用 `cn(sidebarListRowClassName, "h-10 min-h-10")`，将 `MemberAvatar` 改为 `size="sidebar"`。在名称后增加 `Badge variant="secondary"`，文本使用 `member.profession?.trim() || member.role?.trim()`，空值时不渲染；名称和 Badge 放入 `flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden whitespace-nowrap` 容器，Badge 使用 `min-w-0 max-w-[55%] shrink truncate`。

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @slei/desktop test -- src/app/SleiAppFrame.test.tsx`

Expected: PASS，频道行的 32px 布局测试和现有私信菜单交互测试不受影响。

### Task 3: 全量相关验证

**Files:**
- Verify: `apps/desktop/src/components/MemberAvatar.tsx`
- Verify: `apps/desktop/src/components/ui/avatar.tsx`
- Verify: `apps/desktop/src/app/WorkspaceSidebar.tsx`
- Verify: `apps/desktop/src/components/MemberAvatar.test.tsx`
- Verify: `apps/desktop/src/components/ui/avatar.test.tsx`
- Verify: `apps/desktop/src/app/SleiAppFrame.test.tsx`

- [ ] **Step 1: Run the focused desktop test suite**

Run: `pnpm --filter @slei/desktop test -- src/components/MemberAvatar.test.tsx src/components/ui/avatar.test.tsx src/app/SleiAppFrame.test.tsx`

Expected: PASS with zero failed tests.

- [ ] **Step 2: Run the desktop type check/build validation**

Run: `pnpm --filter @slei/desktop typecheck`

Expected: exit code 0 with no TypeScript errors. If this package exposes a different script name, inspect `apps/desktop/package.json` and run the closest existing type-check command.

- [ ] **Step 3: Review the diff**

Run: `git diff --check && git diff -- apps/desktop/src/components/MemberAvatar.tsx apps/desktop/src/components/ui/avatar.tsx apps/desktop/src/app/WorkspaceSidebar.tsx apps/desktop/src/components/MemberAvatar.test.tsx apps/desktop/src/components/ui/avatar.test.tsx apps/desktop/src/app/SleiAppFrame.test.tsx`

Expected: no whitespace errors; diff contains only the requested avatar, border, profession badge, and tests plus the Chinese design/plan documents.
