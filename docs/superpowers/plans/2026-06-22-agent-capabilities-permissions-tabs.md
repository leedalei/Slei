# Agent Capabilities Permissions Tabs Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让成员详情页的 `能力` 页签展示 Agent 工作区 skills 的名称和描述，并新增 `权限` 页签承接只读和权限信息。

**Architecture:** 复用现有 daemon/bridge 的 `listAgentSkills` 数据流，React 成员页只消费 `SleiMember.skills`、`SleiMember.capabilities` 和 `SleiMember.permissions`。本计划只调整 desktop 前端展示、i18n 类型与单元测试，不新增前端文件扫描、不改 daemon 和 SQLite。

**Tech Stack:** TypeScript、React、Vitest/jsdom、shadcn Tabs/Card/Badge、lucide-react、Slei desktop i18n。

---

## Scope And References

- Spec: `docs/superpowers/specs/2026-06-22-agent-capabilities-permissions-tabs-design.md`
- UI: `apps/desktop/src/features/members/MembersPageView.tsx`
- UI tests: `apps/desktop/src/features/members/MembersPageView.test.tsx`
- Helper: `apps/desktop/src/features/members/CapabilitiesPanel.ts`
- Helper tests: `apps/desktop/src/features/members/CapabilitiesPanel.test.ts`
- i18n types: `apps/desktop/src/i18n/types.ts`
- Chinese messages: `apps/desktop/src/i18n/messages/zh-CN/members.ts`
- English messages: `apps/desktop/src/i18n/messages/en-US/members.ts`

This is one focused UI semantics change. It must not introduce production mock data, local skill parsing, or additional daemon APIs.

## File Structure

### i18n

- Modify: `apps/desktop/src/i18n/types.ts`
  - Add `permissions: string`.
  - Add `noWorkspacePermissions: string`.
- Modify: `apps/desktop/src/i18n/messages/zh-CN/members.ts`
  - Add `permissions: "权限"`.
  - Add `noWorkspacePermissions: "当前成员没有工作区权限条目。"`
- Modify: `apps/desktop/src/i18n/messages/en-US/members.ts`
  - Add `permissions: "Permissions"`.
  - Add `noWorkspacePermissions: "This member has no workspace permission entries."`

### Member Detail UI

- Modify: `apps/desktop/src/features/members/MembersPageView.tsx`
  - Extend `MemberTab` with `"permissions"`.
  - Add a `TabsTrigger` between `capabilities` and `activity`.
  - Change `capabilities` content to render `selectedMember.skills ?? []`.
  - Add `permissions` content for read-only description, runtime capabilities, and workspace permission badges.

### Helper

- Modify: `apps/desktop/src/features/members/CapabilitiesPanel.ts`
  - Rename local view type from capability-oriented to skill-oriented.
  - Render skill `name`, optional `source`, and `description`.
  - Use `members.noSkills` for empty state.
  - Stop rendering `members.readOnly`.

### Tests

- Modify: `apps/desktop/src/features/members/MembersPageView.test.tsx`
  - Add DOM tests for the new tab and moved content.
  - Update existing expectation that capabilities tab contains runtime capability.
- Modify: `apps/desktop/src/features/members/CapabilitiesPanel.test.ts`
  - Update helper test to assert skill name/description semantics.

## Task 1: Add i18n Keys For Permissions Empty State

**Files:**
- Modify: `apps/desktop/src/i18n/types.ts`
- Modify: `apps/desktop/src/i18n/messages/zh-CN/members.ts`
- Modify: `apps/desktop/src/i18n/messages/en-US/members.ts`

- [ ] **Step 1: Write the failing type expectation**

Open `apps/desktop/src/i18n/types.ts` and add the expected keys under `members`:

```ts
permissions: string;
noWorkspacePermissions: string;
```

Run typecheck before adding message values:

```bash
pnpm --filter @slei/desktop typecheck
```

Expected: FAIL because `members` message objects in zh-CN and en-US do not yet define the new keys.

- [ ] **Step 2: Add Chinese messages**

In `apps/desktop/src/i18n/messages/zh-CN/members.ts`, add:

```ts
noWorkspacePermissions: "当前成员没有工作区权限条目。",
permissions: "权限",
```

Place `noWorkspacePermissions` near other `no*` member empty-state labels and `permissions` near `permissionLabels`.

- [ ] **Step 3: Add English messages**

In `apps/desktop/src/i18n/messages/en-US/members.ts`, add:

```ts
noWorkspacePermissions: "This member has no workspace permission entries.",
permissions: "Permissions",
```

Place them in the same relative positions as the Chinese file.

- [ ] **Step 4: Verify i18n typecheck passes**

Run:

```bash
pnpm --filter @slei/desktop typecheck
```

Expected: PASS.

## Task 2: Update MembersPage DOM Behavior With Failing Tests First

**Files:**
- Modify: `apps/desktop/src/features/members/MembersPageView.test.tsx`
- Modify: `apps/desktop/src/features/members/MembersPageView.tsx`

- [ ] **Step 1: Add a test for the new permissions tab label**

In `MembersPageView.test.tsx`, add this test near the existing tab bar test:

```tsx
it("shows a dedicated permissions tab in member details", () => {
  const messages = createDesktopMessages("zh-CN");
  const html = renderToStaticMarkup(renderMembersPage({ messages }));

  expect(html).toContain(`>${messages.members.capabilities}<`);
  expect(html).toContain(`>${messages.members.permissions}<`);
  expect(html).toContain(`>${messages.members.activity}<`);
});
```

Run:

```bash
pnpm --filter @slei/desktop test -- MembersPageView.test.tsx
```

Expected: FAIL because `messages.members.permissions` and the tab do not exist yet unless Task 1 has already completed.

- [ ] **Step 2: Add a DOM interaction test for skills on the capabilities tab**

Add this test in `MembersPageView.test.tsx`:

```tsx
it("renders workspace skill names and descriptions on the capabilities tab", async () => {
  const messages = createDesktopMessages("zh-CN");
  const host = await mount(
    renderMembersPage({
      messages,
      data: createSleiFixtures({
        members: [
          {
            ...agentMember("agent_coda"),
            permissions: ["文件读取"],
            skills: [
              {
                id: "memory",
                name: "memory",
                trigger: "记住用户提到的重要事实",
                path: "~/.slei/agents/agent_coda/.claude/skills/memory/SKILL.md",
              },
            ],
            capabilities: ["ClaudeCode"],
          },
        ],
      }),
    }),
  );
  const capabilitiesTab = Array.from(host.querySelectorAll("button")).find((button) =>
    button.textContent?.includes(messages.members.capabilities),
  );

  await act(async () => {
    capabilitiesTab?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });

  const activePanel = host.querySelector('[role="tabpanel"][data-state="active"]');
  expect(activePanel?.textContent).toContain("memory");
  expect(activePanel?.textContent).toContain("记住用户提到的重要事实");
  expect(activePanel?.textContent).not.toContain("ClaudeCode");
  expect(activePanel?.textContent).not.toContain("文件读取");
});
```

Run:

```bash
pnpm --filter @slei/desktop test -- MembersPageView.test.tsx
```

Expected: FAIL because the capabilities tab still renders `selectedMember.capabilities` and permissions.

- [ ] **Step 3: Add a DOM interaction test for permissions tab content**

Add:

```tsx
it("moves runtime capabilities and workspace permissions to the permissions tab", async () => {
  const messages = createDesktopMessages("zh-CN");
  const host = await mount(
    renderMembersPage({
      messages,
      data: createSleiFixtures({
        members: [
          {
            ...agentMember("agent_coda"),
            permissions: ["文件读取"],
            skills: [{ id: "memory", name: "memory", trigger: "remember facts", path: "~/.slei/agents/agent_coda/.claude/skills/memory/SKILL.md" }],
            capabilities: ["ClaudeCode"],
          },
        ],
      }),
    }),
  );
  const permissionsTab = Array.from(host.querySelectorAll("button")).find((button) =>
    button.textContent?.includes(messages.members.permissions),
  );

  await act(async () => {
    permissionsTab?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });

  const activePanel = host.querySelector('[role="tabpanel"][data-state="active"]');
  expect(activePanel?.textContent).toContain(messages.members.readOnly);
  expect(activePanel?.textContent).toContain("ClaudeCode");
  expect(activePanel?.textContent).toContain("文件读取");
});
```

Run:

```bash
pnpm --filter @slei/desktop test -- MembersPageView.test.tsx
```

Expected: FAIL because there is no permissions tab yet.

- [ ] **Step 4: Add an empty skills test**

Add:

```tsx
it("shows an empty skills state on the capabilities tab", async () => {
  const messages = createDesktopMessages("zh-CN");
  const host = await mount(
    renderMembersPage({
      messages,
      data: createSleiFixtures({
        members: [{ ...agentMember("agent_empty", "Empty"), skills: [], capabilities: ["ClaudeCode"] }],
      }),
    }),
  );
  const capabilitiesTab = Array.from(host.querySelectorAll("button")).find((button) =>
    button.textContent?.includes(messages.members.capabilities),
  );

  await act(async () => {
    capabilitiesTab?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });

  const activePanel = host.querySelector('[role="tabpanel"][data-state="active"]');
  expect(activePanel?.textContent).toContain(messages.members.noSkills);
  expect(activePanel?.textContent).toContain(messages.members.noSkillsDescription);
  expect(activePanel?.textContent).not.toContain("ClaudeCode");
});
```

Run:

```bash
pnpm --filter @slei/desktop test -- MembersPageView.test.tsx
```

Expected: FAIL until the capabilities panel uses `skills`.

- [ ] **Step 5: Implement tab type and trigger**

In `MembersPageView.tsx`, change:

```ts
type MemberTab = "profile" | "workspace" | "capabilities" | "activity";
```

to:

```ts
type MemberTab = "profile" | "workspace" | "capabilities" | "permissions" | "activity";
```

Add the new trigger:

```tsx
<TabsTrigger value="permissions">{input.messages.members.permissions}</TabsTrigger>
```

Place it after `capabilities` and before `activity`.

- [ ] **Step 6: Implement capabilities tab as skills list**

Replace the current `capabilities` tab body with:

```tsx
<TabsContent forceMount value="capabilities" className="grid gap-4 data-[state=inactive]:hidden">
  <Card>
    <CardHeader>
      <CardTitle>{input.messages.members.capabilities}</CardTitle>
      <CardDescription>{input.messages.members.skills}</CardDescription>
    </CardHeader>
    <CardContent>
      {selectedMember.skills?.length ? (
        <div className="grid gap-2" role="list">
          {selectedMember.skills.map((skill) => (
            <div className="grid gap-1 rounded-md border bg-muted/20 p-3" key={skill.id} role="listitem">
              <div className="flex min-w-0 items-center gap-2">
                <Sparkles aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                <span className="truncate text-sm font-medium">{skill.name}</span>
              </div>
              {skill.trigger ? (
                <p className="text-sm leading-6 text-muted-foreground">{skill.trigger}</p>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <InlineEmpty
          description={input.messages.members.noSkillsDescription}
          title={input.messages.members.noSkills}
        />
      )}
    </CardContent>
  </Card>
</TabsContent>
```

Do not read workspace files or derive skills from `workspaceEntries`.

- [ ] **Step 7: Implement permissions tab**

Add a new `TabsContent` immediately after capabilities:

```tsx
<TabsContent forceMount value="permissions" className="grid gap-4 data-[state=inactive]:hidden">
  <Card>
    <CardHeader>
      <CardTitle>{input.messages.members.permissions}</CardTitle>
      <CardDescription>{input.messages.members.readOnly}</CardDescription>
    </CardHeader>
    <CardContent className="grid gap-4">
      <section className="grid gap-2" aria-label={input.messages.members.capabilities}>
        <h2 className="text-sm font-semibold">{input.messages.members.capabilities}</h2>
        {selectedMember.capabilities.length ? (
          <div className="flex flex-wrap gap-2">
            {selectedMember.capabilities.map((capability) => (
              <Badge className="gap-1" key={capability} variant="secondary">
                <Sparkles aria-hidden="true" />
                {capability}
              </Badge>
            ))}
          </div>
        ) : (
          <InlineEmpty
            description={input.messages.members.capabilityScanUnavailable}
            title={input.messages.members.noCapabilities}
          />
        )}
      </section>

      <section className="grid gap-2" aria-label={input.messages.members.workspacePermission}>
        <h2 className="text-sm font-semibold">{input.messages.members.workspacePermission}</h2>
        {selectedMember.permissions.length ? (
          <div className="flex flex-wrap gap-2">
            {selectedMember.permissions.map((permission) => (
              <Badge className="gap-1" key={permission} variant="outline">
                <ShieldCheck aria-hidden="true" />
                {permission}
              </Badge>
            ))}
          </div>
        ) : (
          <InlineEmpty
            description={input.messages.members.noWorkspacePermissions}
            title={input.messages.members.workspacePermission}
          />
        )}
      </section>
    </CardContent>
  </Card>
</TabsContent>
```

- [ ] **Step 8: Update or remove obsolete expectations**

In `MembersPageView.test.tsx`, find tests that expect the old capabilities tab to show runtime capabilities or noCapabilities. Update them to the new semantics:

- Runtime capability assertions should move to permissions tab tests.
- Empty ability assertions should use `noSkills` on capabilities tab.
- Keep existing header/runtime configuration assertions untouched.

- [ ] **Step 9: Verify MembersPageView tests pass**

Run:

```bash
pnpm --filter @slei/desktop test -- MembersPageView.test.tsx
```

Expected: PASS.

## Task 3: Update CapabilitiesPanel Helper Semantics

**Files:**
- Modify: `apps/desktop/src/features/members/CapabilitiesPanel.test.ts`
- Modify: `apps/desktop/src/features/members/CapabilitiesPanel.ts`

- [ ] **Step 1: Rewrite the helper test to describe skills**

Replace the existing capabilities helper test with:

```ts
it("renders workspace skill names and descriptions without read-only permission copy", () => {
  const html = renderCapabilitiesPanel({
    locale: "zh-CN",
    skills: [
      {
        name: "youdao-lobster-pr",
        source: "Agent workspace",
        description: "有道龙虾项目 PR 提交流程",
        available: true,
      },
      {
        name: "memory",
        source: "Agent workspace",
        description: "更新 MEMORY.md",
        available: true,
      },
    ],
  });

  expect(html).toContain("能力");
  expect(html).toContain("youdao-lobster-pr");
  expect(html).toContain("有道龙虾项目 PR 提交流程");
  expect(html).toContain("memory");
  expect(html).not.toContain("只读");
  expect(html).not.toContain("安装");
});
```

Run:

```bash
pnpm --filter @slei/desktop test -- CapabilitiesPanel.test.ts
```

Expected: FAIL because the helper currently accepts `capabilities` and includes `readOnly`.

- [ ] **Step 2: Update helper types and empty state**

In `CapabilitiesPanel.ts`, change `CapabilityView` to:

```ts
export type SkillCapabilityView = {
  name: string;
  source?: string;
  description: string;
  available?: boolean;
  error?: string;
};
```

Change input to:

```ts
skills: SkillCapabilityView[];
```

Use `messages.noSkills` for empty output:

```ts
if (input.skills.length === 0) {
  return `${title} ${messages.noSkills} ${messages.noSkillsDescription}`;
}
```

- [ ] **Step 3: Render skill rows without read-only copy**

Update the return body:

```ts
return [
  title,
  ...input.skills.map((skill) =>
    [
      skill.available === false ? "unavailable" : "available",
      skill.name,
      skill.source ?? "",
      skill.description,
      skill.error ?? "",
    ]
      .filter(Boolean)
      .join(" "),
  ),
].join("\n");
```

- [ ] **Step 4: Verify helper tests pass**

Run:

```bash
pnpm --filter @slei/desktop test -- CapabilitiesPanel.test.ts
```

Expected: PASS.

## Task 4: Full Verification And Commit

**Files:**
- Verify: all files changed in Tasks 1-3.

- [ ] **Step 1: Run focused member tests**

Run:

```bash
pnpm --filter @slei/desktop test -- MembersPageView.test.tsx CapabilitiesPanel.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run:

```bash
pnpm --filter @slei/desktop typecheck
```

Expected: PASS.

- [ ] **Step 3: Inspect git diff**

Run:

```bash
git diff -- apps/desktop/src/features/members/MembersPageView.tsx apps/desktop/src/features/members/MembersPageView.test.tsx apps/desktop/src/features/members/CapabilitiesPanel.ts apps/desktop/src/features/members/CapabilitiesPanel.test.ts apps/desktop/src/i18n/types.ts apps/desktop/src/i18n/messages/zh-CN/members.ts apps/desktop/src/i18n/messages/en-US/members.ts
```

Expected:

- No daemon, storage, bridge, or fixture changes.
- Capabilities tab renders skills only.
- Permissions tab renders read-only, runtime capabilities, and workspace permissions.
- No production mock data.

- [ ] **Step 4: Commit the implementation**

Run:

```bash
git add apps/desktop/src/features/members/MembersPageView.tsx apps/desktop/src/features/members/MembersPageView.test.tsx apps/desktop/src/features/members/CapabilitiesPanel.ts apps/desktop/src/features/members/CapabilitiesPanel.test.ts apps/desktop/src/i18n/types.ts apps/desktop/src/i18n/messages/zh-CN/members.ts apps/desktop/src/i18n/messages/en-US/members.ts
git commit -m "feat: split agent capabilities and permissions tabs"
```

Expected: commit succeeds after tests pass.

- [ ] **Step 5: Ask about merging**

After the implementation is complete and verified, ask whether to merge the finished task to `master` or another branch, as required by `AGENTS.md`.

## Implementation Handoff

When executing this plan, first use @superpowers:subagent-driven-development if subagents are available in the harness; otherwise use @superpowers:executing-plans. Keep commits focused and do not revert unrelated user changes.
