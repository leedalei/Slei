# Composer Layout Commands Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Slei desktop 聊天 composer 升级为统一输入面板，支持自适应高度、拖拽/粘贴附件、统一文件入口、switch 任务开关和合并 slash 命令菜单，同时让任务线程回复框自适应高度。

**Architecture:** 保持 daemon/bridge 作为消息、附件和任务副作用的 source of truth；desktop UI 只管理草稿、附件预览、输入高度、拖拽/粘贴和命令菜单状态。实现集中在现有 `ChatPageView` 与 `TaskThreadDrawer`，抽取少量纯 helper/hook，避免大规模组件重构。

**Tech Stack:** React + TypeScript, shadcn UI primitives, Tailwind v4 classes, Vitest/jsdom, existing Slei daemon bridge DTOs.

---

## Context And Guardrails

- Spec: `docs/superpowers/specs/2026-07-02-composer-layout-commands-design.md`
- ADR guardrails:
  - `docs/architecture/0005-channel-routing-and-multi-agent-flow.md`
  - `docs/architecture/0006-task-source-message-card.md`
- Knowledge note: `docs/knowledge/best-practices/task-thread-stable-ids-and-reply-roles-20260529.md` says task/thread UI should keep stable IDs and role fields. This feature must not introduce timestamp IDs or mutate task reply data models.
- Do not add production mock data.
- Do not add UI-side task creation logic beyond sending existing `asTask`.
- Do not change daemon API or SQLite schema.
- Use @superpowers:test-driven-development while implementing each task.

## File Structure

- Modify `apps/desktop/src/app/model.ts`
  - Add generic composer slash query helpers and command text removal helpers.
  - Add command query matching helper for localized titles plus explicit aliases.
  - Keep existing DM skill token display helpers intact.
- Modify `apps/desktop/src/app/model.test.ts`
  - Unit tests for slash query detection, command removal, and skill insertion at the trigger position.
- Modify `apps/desktop/src/i18n/types.ts`
  - Add typed chat labels for composer commands and placeholder variants.
- Modify `apps/desktop/src/i18n/messages/zh-CN/chat.ts`
  - Add Chinese command labels and placeholder helpers.
- Modify `apps/desktop/src/i18n/messages/en-US/chat.ts`
  - Add English command labels and placeholder helpers.
- Create `apps/desktop/src/components/useAutosizeTextarea.ts`
  - Small React hook responsible only for textarea height synchronization, including dynamic max-height calculation.
- Create `apps/desktop/src/components/useAutosizeTextarea.test.tsx`
  - jsdom tests for max-height and overflow behavior.
- Modify `apps/desktop/src/features/tasks/TaskThreadDrawer.tsx`
  - Apply autosize textarea behavior to reply composer.
- Modify `apps/desktop/src/features/tasks/TasksPageView.test.tsx`
  - DOM tests for task reply textarea autosize and existing Enter behavior.
- Modify `apps/desktop/src/features/chat/SkillSlashPicker.tsx`
  - Replace or generalize into a composer command picker that can render fixed commands plus DM skills. Keep file if easiest to minimize churn, but rename exported component if implementation clarity benefits.
- Modify `apps/desktop/src/features/chat/ChatPageView.tsx`
  - Unified composer surface, switch, unified file input, drag/drop/paste handlers, autosize textarea, merged command menu.
- Modify `apps/desktop/src/features/chat/ChatPageView.test.tsx`
  - DOM and interaction coverage for composer layout, switch, file input, drag/drop/paste, slash menu, sending.
- Modify `apps/desktop/src/app/app.css`
  - Small composer-specific utility styles only if Tailwind classes cannot express focus-within/drag-over polish cleanly.

## Task 1: Slash Helper And i18n Foundation

**Files:**
- Modify: `apps/desktop/src/app/model.ts`
- Modify: `apps/desktop/src/app/model.test.ts`
- Modify: `apps/desktop/src/i18n/types.ts`
- Modify: `apps/desktop/src/i18n/messages/zh-CN/chat.ts`
- Modify: `apps/desktop/src/i18n/messages/en-US/chat.ts`

- [ ] **Step 1: Write failing tests for composer slash query detection**

Add tests in `apps/desktop/src/app/model.test.ts` near the existing skill slash tests:

```ts
describe("composer command slash helpers", () => {
  it("detects a slash query at the start or after a literal space", () => {
    expect(activeComposerSlashQuery("/")).toEqual({ query: "", start: 0, end: 1 });
    expect(activeComposerSlashQuery("/task")).toEqual({ query: "task", start: 0, end: 5 });
    expect(activeComposerSlashQuery("/转为")).toEqual({ query: "转为", start: 0, end: 3 });
    expect(activeComposerSlashQuery("帮我 /")).toEqual({ query: "", start: 3, end: 4 });
    expect(activeComposerSlashQuery("帮我 /file")).toEqual({ query: "file", start: 3, end: 8 });
    expect(activeComposerSlashQuery("帮我 /插入")).toEqual({ query: "插入", start: 3, end: 6 });
  });

  it("does not detect urls, paths, tabs, newlines, or completed slash tokens", () => {
    expect(activeComposerSlashQuery("https://example.com/")).toBeNull();
    expect(activeComposerSlashQuery("path/to/file")).toBeNull();
    expect(activeComposerSlashQuery("帮我\t/")).toBeNull();
    expect(activeComposerSlashQuery("帮我\n/")).toBeNull();
    expect(activeComposerSlashQuery("/task now")).toBeNull();
    expect(activeComposerSlashQuery("帮我 /task now")).toBeNull();
  });

  it("removes a fixed command query while preserving previous text", () => {
    const slash = activeComposerSlashQuery("帮我 /task");
    expect(slash).not.toBeNull();
    expect(removeComposerSlashQuery("帮我 /task", slash!)).toBe("帮我 ");
  });

  it("matches fixed commands by localized title or explicit aliases", () => {
    expect(composerCommandMatchesQuery("fi", ["插入文件", "file", "fi"])).toBe(true);
    expect(composerCommandMatchesQuery("file", ["插入文件", "file", "fi"])).toBe(true);
    expect(composerCommandMatchesQuery("task", ["转为任务", "task", "todo"])).toBe(true);
    expect(composerCommandMatchesQuery("转为", ["转为任务", "task", "todo"])).toBe(true);
    expect(composerCommandMatchesQuery("memory", ["转为任务", "task", "todo"])).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```sh
pnpm --filter @slei/desktop test -- src/app/model.test.ts
```

Expected: FAIL because `activeComposerSlashQuery`, `removeComposerSlashQuery`, and `composerCommandMatchesQuery` are not exported.

- [ ] **Step 3: Implement minimal helper code**

In `apps/desktop/src/app/model.ts`, add:

```ts
export function activeComposerSlashQuery(draft: string): ActiveSkillSlashQuery | null {
  const match = /(^| )\/([^/\s]*)$/u.exec(draft);
  if (!match) return null;
  const prefix = match[1] ?? "";
  const start = match.index + prefix.length;
  return {
    query: match[2] ?? "",
    start,
    end: draft.length,
  };
}

export function removeComposerSlashQuery(draft: string, slash: ActiveSkillSlashQuery): string {
  return `${draft.slice(0, slash.start)}${draft.slice(slash.end)}`;
}

export function composerCommandMatchesQuery(query: string, values: string[]): boolean {
  const normalized = normalizeSearch(query);
  if (!normalized) return true;
  return values.some((value) => normalizeSearch(value).includes(normalized));
}
```

Keep `activeSkillSlashQuery()` for message-skill behavior if it remains useful, or update it to delegate only when `start === 0`.

- [ ] **Step 4: Update skill insertion tests and helper if needed**

Add a test proving `insertSkillSlash()` works at a middle trigger:

```ts
it("inserts a selected slash skill at the active trigger position", () => {
  const slash = activeComposerSlashQuery("请记住 /me");
  expect(slash).not.toBeNull();
  expect(insertSkillSlash("请记住 /me", slash!, skills[0])).toBe("请记住 /memory ");
});
```

Run:

```sh
pnpm --filter @slei/desktop test -- src/app/model.test.ts
```

Expected: PASS after helper compatibility is in place.

- [ ] **Step 5: Add i18n fields**

In `apps/desktop/src/i18n/types.ts`, add chat fields:

```ts
chooseComposerCommand: string;
insertFileCommand: string;
insertFileCommandDescription: string;
convertToTaskCommand: string;
convertToTaskCommandDescription: string;
inputToChannelWithActions: (name: string) => string;
inputToMemberWithActions: (name: string) => string;
```

In `apps/desktop/src/i18n/messages/zh-CN/chat.ts`, add:

```ts
chooseComposerCommand: "选择功能",
insertFileCommand: "插入文件",
insertFileCommandDescription: "添加图片或普通文件",
convertToTaskCommand: "转为任务",
convertToTaskCommandDescription: "发送后创建任务",
inputToChannelWithActions: (name: string) => `输入消息到 #${name}，输入 / 打开功能菜单`,
inputToMemberWithActions: (name: string) => `输入消息给 ${name}，输入 / 打开功能菜单`,
```

In `apps/desktop/src/i18n/messages/en-US/chat.ts`, add:

```ts
chooseComposerCommand: "Choose action",
insertFileCommand: "Insert file",
insertFileCommandDescription: "Add an image or file",
convertToTaskCommand: "Convert to task",
convertToTaskCommandDescription: "Create a task when sending",
inputToChannelWithActions: (name: string) => `Message #${name}, type / for actions`,
inputToMemberWithActions: (name: string) => `Message ${name}, type / for actions`,
```

- [ ] **Step 6: Run focused tests**

Run:

```sh
pnpm --filter @slei/desktop test -- src/app/model.test.ts src/features/search/searchI18n.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```sh
git add apps/desktop/src/app/model.ts apps/desktop/src/app/model.test.ts apps/desktop/src/i18n/types.ts apps/desktop/src/i18n/messages/zh-CN/chat.ts apps/desktop/src/i18n/messages/en-US/chat.ts
git commit -m "feat: add composer command slash helpers"
```

## Task 2: Autosize Textarea Hook And Task Thread Reply

**Files:**
- Create: `apps/desktop/src/components/useAutosizeTextarea.ts`
- Create: `apps/desktop/src/components/useAutosizeTextarea.test.tsx`
- Modify: `apps/desktop/src/features/tasks/TaskThreadDrawer.tsx`
- Modify: `apps/desktop/src/features/tasks/TasksPageView.test.tsx`

- [ ] **Step 1: Write failing hook tests**

Create `apps/desktop/src/components/useAutosizeTextarea.test.tsx`:

```tsx
// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { useAutosizeTextarea } from "./useAutosizeTextarea";

let root: Root | undefined;
let container: HTMLDivElement | undefined;

function Harness({ value, maxHeight }: { value: string; maxHeight: number | (() => number) }) {
  const ref = useAutosizeTextarea(value, { maxHeight });
  return <textarea data-testid="autosize" ref={ref} value={value} readOnly />;
}

afterEach(() => {
  root?.unmount();
  container?.remove();
  root = undefined;
  container = undefined;
});

describe("useAutosizeTextarea", () => {
  it("caps height and enables scrolling after the max height", async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(<Harness value={"a\n".repeat(80)} maxHeight={120} />);
    });
    const textarea = container.querySelector<HTMLTextAreaElement>("[data-testid='autosize']");
    Object.defineProperty(textarea, "scrollHeight", { configurable: true, value: 240 });
    await act(async () => {
      root?.render(<Harness value={"a\n".repeat(81)} maxHeight={120} />);
    });
    expect(textarea?.style.maxHeight).toBe("120px");
    expect(textarea?.style.height).toBe("120px");
    expect(textarea?.style.overflowY).toBe("auto");
  });

  it("supports a dynamic max height for viewport-constrained drawers", async () => {
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 600 });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(<Harness value={"a\n".repeat(80)} maxHeight={() => Math.min(320, window.innerHeight * 0.4)} />);
    });
    const textarea = container.querySelector<HTMLTextAreaElement>("[data-testid='autosize']");
    Object.defineProperty(textarea, "scrollHeight", { configurable: true, value: 500 });
    await act(async () => {
      root?.render(<Harness value={"a\n".repeat(81)} maxHeight={() => Math.min(320, window.innerHeight * 0.4)} />);
    });
    expect(textarea?.style.maxHeight).toBe("240px");
    expect(textarea?.style.height).toBe("240px");
    expect(textarea?.style.overflowY).toBe("auto");
  });
});
```

- [ ] **Step 2: Run hook test to verify it fails**

Run:

```sh
pnpm --filter @slei/desktop test -- src/components/useAutosizeTextarea.test.tsx
```

Expected: FAIL because hook file does not exist.

- [ ] **Step 3: Implement hook**

Create `apps/desktop/src/components/useAutosizeTextarea.ts`:

```ts
import { useLayoutEffect, useRef } from "react";

export function useAutosizeTextarea(value: string, input: { maxHeight: number | (() => number) }) {
  const ref = useRef<HTMLTextAreaElement | null>(null);

  useLayoutEffect(() => {
    const textarea = ref.current;
    if (!textarea) return;
    const maxHeight = typeof input.maxHeight === "function" ? input.maxHeight() : input.maxHeight;
    textarea.style.height = "auto";
    textarea.style.maxHeight = `${maxHeight}px`;
    const nextHeight = Math.min(textarea.scrollHeight, maxHeight);
    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? "auto" : "hidden";
  }, [value, input.maxHeight]);

  return ref;
}
```

- [ ] **Step 4: Run hook test**

Run:

```sh
pnpm --filter @slei/desktop test -- src/components/useAutosizeTextarea.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Write failing task drawer DOM test**

In `apps/desktop/src/features/tasks/TasksPageView.test.tsx`, update the existing reply composer test or add:

```ts
expect(textarea?.className).toContain("max-h-[min(320px,40vh)]");
expect(textarea?.style.overflowY).toBe("hidden");
```

Keep existing assertions for Enter submit.

- [ ] **Step 6: Run task drawer test to verify it fails**

Run:

```sh
pnpm --filter @slei/desktop test -- src/features/tasks/TasksPageView.test.tsx
```

Expected: FAIL because `TaskThreadDrawer` has not applied the hook/style yet.

- [ ] **Step 7: Apply hook in TaskThreadDrawer**

In `apps/desktop/src/features/tasks/TaskThreadDrawer.tsx`:

- Import `useAutosizeTextarea`.
- Add `const replyTextareaRef = useAutosizeTextarea(replyDraft, { maxHeight: () => Math.min(320, window.innerHeight * 0.4) });`
- Pass `ref={replyTextareaRef}` to the reply `Textarea`.
- Add class tokens:

```tsx
className="max-h-[min(320px,40vh)] min-h-20 resize-none border border-slate-300/90 bg-white/55 pr-16 shadow-none"
```

Preserve existing `onKeyDown`, composition, value, placeholder and disabled props.

Because the hook writes inline `maxHeight`, the dynamic callback is required for the task drawer. Do not pass a plain `320` there; otherwise small viewports can exceed the intended `40vh` cap.

- [ ] **Step 8: Run focused task tests**

Run:

```sh
pnpm --filter @slei/desktop test -- src/components/useAutosizeTextarea.test.tsx src/features/tasks/TasksPageView.test.tsx
```

Expected: PASS.

- [ ] **Step 9: Commit**

```sh
git add apps/desktop/src/components/useAutosizeTextarea.ts apps/desktop/src/components/useAutosizeTextarea.test.tsx apps/desktop/src/features/tasks/TaskThreadDrawer.tsx apps/desktop/src/features/tasks/TasksPageView.test.tsx
git commit -m "feat: autosize task thread replies"
```

## Task 3: Unified Composer Surface And Switch

**Files:**
- Modify: `apps/desktop/src/features/chat/ChatPageView.tsx`
- Modify: `apps/desktop/src/features/chat/ChatPageView.test.tsx`
- Modify: `apps/desktop/src/app/app.css`

- [ ] **Step 1: Write failing composer layout tests**

In `apps/desktop/src/features/chat/ChatPageView.test.tsx`, replace checkbox-specific expectations with switch expectations:

```ts
const surface = host.querySelector<HTMLElement>('[data-testid="slei-composer-surface"]');
const textarea = host.querySelector<HTMLTextAreaElement>('[data-testid="slei-composer-input"]');
const toolbar = host.querySelector<HTMLElement>('[data-testid="slei-composer-toolbar"]');
const switchControl = host.querySelector<HTMLElement>('[data-testid="slei-as-task-switch"]');

expect(surface).not.toBeNull();
expect(surface?.contains(textarea!)).toBe(true);
expect(surface?.contains(toolbar!)).toBe(true);
expect(host.querySelector('[data-slot="checkbox"]')).toBeNull();
expect(switchControl?.getAttribute("data-slot")).toBe("switch");
expect(textarea?.className).toContain("max-h-[500px]");
expect(textarea?.className).toContain("resize-none");
```

Also update placeholder assertion:

```ts
expect(textarea?.getAttribute("placeholder")).toBe("输入消息到 #all，输入 / 打开功能菜单");
```

- [ ] **Step 2: Run composer layout test to verify it fails**

Run:

```sh
pnpm --filter @slei/desktop test -- src/features/chat/ChatPageView.test.tsx
```

Expected: FAIL because composer still uses checkbox and old placeholder/layout.

- [ ] **Step 3: Implement layout and switch**

In `apps/desktop/src/features/chat/ChatPageView.tsx`:

- Replace `Checkbox` import with `Switch`.
- Import `useAutosizeTextarea`.
- Add:

```ts
const composerInputRef = useAutosizeTextarea(draft, { maxHeight: 500 });
const composerPlaceholder = dmMember
  ? messages.chat.inputToMemberWithActions(dmMember.name)
  : messages.chat.inputToChannelWithActions(stripChannelHash(activeChannel.name));
```

- Use `composerPlaceholder` for textarea `aria-label` and `placeholder`.
- Move textarea and toolbar inside one unified surface.
- Give toolbar `data-testid="slei-composer-toolbar"`.
- Replace checkbox label with:

```tsx
<label className="inline-flex items-center gap-2 text-sm text-muted-foreground">
  <Switch
    checked={asTask}
    data-testid="slei-as-task-switch"
    onCheckedChange={setAsTask}
  />
  <span>{messages.chat.asTask}</span>
</label>
```

- Pass `ref={composerInputRef}` to `Textarea`.
- Set textarea class to include:

```tsx
"slei-composer-input max-h-[500px] min-h-20 resize-none border-0 bg-transparent px-3 py-3 shadow-none focus-visible:ring-0"
```

Use `cn()` to keep existing style readability.

- [ ] **Step 4: Adjust composer reserve if needed**

If unified surface or autosize causes timeline overlap, keep the current conservative reserve logic for this task:

```ts
const composerReservePx = attachments.length > 0 || (mention && mentionTargets.length > 0) || (skillSlash && skillSlashTargets.length > 0)
  ? COMPOSER_EXPANDED_RESERVE_PX
  : COMPOSER_RESERVE_PX;
```

Task 5 will rename `skillSlash` to the merged command-menu state and should update this expression at that point.

Do not attempt full dynamic measurement in this task unless tests prove overlap.

- [ ] **Step 5: Run focused composer tests**

Run:

```sh
pnpm --filter @slei/desktop test -- src/features/chat/ChatPageView.test.tsx
```

Expected: PASS after updating tests that intentionally asserted the old checkbox or recessed-only input behavior.

- [ ] **Step 6: Commit**

```sh
git add apps/desktop/src/features/chat/ChatPageView.tsx apps/desktop/src/features/chat/ChatPageView.test.tsx apps/desktop/src/app/app.css
git commit -m "feat: unify chat composer surface"
```

## Task 4: Unified File Button, Drag Drop, And Paste Attachments

**Files:**
- Modify: `apps/desktop/src/features/chat/ChatPageView.tsx`
- Modify: `apps/desktop/src/features/chat/ChatPageView.test.tsx`

- [ ] **Step 1: Write failing tests for one file input and button**

In `apps/desktop/src/features/chat/ChatPageView.test.tsx`, add:

```ts
const fileInputs = host.querySelectorAll<HTMLInputElement>('input[type="file"]');
expect(fileInputs).toHaveLength(1);
expect(fileInputs[0]?.getAttribute("accept")).toBeNull();
expect(host.querySelector<HTMLButtonElement>('[data-testid="slei-insert-file-button"]')).not.toBeNull();
```

- [ ] **Step 2: Write failing drop/paste attachment tests**

Use an `onAttachmentUpload` mock:

```ts
const onAttachmentUpload = vi.fn(async (request) => ({
  attachment: {
    id: `att-${request.name}`,
    name: request.name,
    mimeType: request.mimeType,
    size: 12,
    url: request.mimeType.startsWith("image/") ? "data:image/png;base64,aaa" : undefined,
  },
}));
```

Mount `ChatPage`, dispatch a `drop` event on `[data-testid="slei-composer-surface"]` with a `DataTransfer` containing an image and a text file, then assert:

```ts
expect(onAttachmentUpload).toHaveBeenCalledTimes(2);
expect(host.querySelector('img[src="data:image/png;base64,aaa"]')).not.toBeNull();
expect(host.textContent).toContain("notes.txt");
```

Add a paste test with `clipboardData.files` or `clipboardData.items`, depending on jsdom support. If jsdom lacks `DataTransferItem`, define a minimal object with `kind: "file"` and `getAsFile()`.

If jsdom lacks a usable `DataTransfer` constructor for drop tests, define a minimal helper in the test file:

```ts
function fileDropData(files: File[]) {
  return {
    files,
    types: ["Files"],
    items: files.map((file) => ({ kind: "file", getAsFile: () => file })),
  };
}
```

Then create the event with:

```ts
const event = new Event("drop", { bubbles: true, cancelable: true });
Object.defineProperty(event, "dataTransfer", { value: fileDropData([imageFile, textFile]) });
surface?.dispatchEvent(event);
```

- [ ] **Step 3: Run tests to verify they fail**

Run:

```sh
pnpm --filter @slei/desktop test -- src/features/chat/ChatPageView.test.tsx
```

Expected: FAIL because composer still has two file inputs and no drop/paste handlers.

- [ ] **Step 4: Implement unified file input**

In `ChatPageView.tsx`:

- Replace `imageInputRef` and `fileInputRef` with one `fileInputRef`.
- Render one hidden file input:

```tsx
<input
  data-testid="slei-composer-file-input"
  hidden
  onChange={(event) => void addFiles(event.currentTarget.files)}
  ref={fileInputRef}
  type="file"
  multiple
/>
```

- Render one button:

```tsx
<Button
  aria-label={messages.chat.insertFileCommand}
  data-testid="slei-insert-file-button"
  onClick={() => fileInputRef.current?.click()}
  size="icon"
  type="button"
  variant="ghost"
>
  <SleiIcon name="attachment" size={15} />
</Button>
```

- Change `addFiles` to accept `FileList | File[] | null`.
- Use `Promise.allSettled` so partial success works:

```ts
async function addFiles(fileList: FileList | File[] | null) {
  const files = Array.from(fileList ?? []);
  if (files.length === 0) return;
  const results = await Promise.allSettled(files.map((file) => uploadComposerFile(file, onAttachmentUpload)));
  const uploaded = results
    .filter((result): result is PromiseFulfilledResult<ConversationAttachmentView | null> => result.status === "fulfilled")
    .map((result) => result.value)
    .filter((attachment): attachment is ConversationAttachmentView => Boolean(attachment));
  const failed = results.some((result) => result.status === "rejected");
  if (uploaded.length > 0) setAttachments((current) => [...current, ...uploaded]);
  if (failed) showToast(messages.chat.sendFailed, "error");
}
```

If a more precise upload-failed string is introduced, add it to i18n; otherwise use existing failure messaging.

- [ ] **Step 5: Implement drag/drop and paste handlers**

Add local state:

```ts
const [composerDragActive, setComposerDragActive] = useState(false);
```

Add helpers:

```ts
function dragEventHasFiles(event: React.DragEvent<HTMLElement>) {
  return Array.from(event.dataTransfer.types).includes("Files");
}

function clipboardFiles(event: React.ClipboardEvent<HTMLElement>): File[] {
  const files = Array.from(event.clipboardData.files ?? []);
  if (files.length > 0) return files;
  return Array.from(event.clipboardData.items ?? [])
    .filter((item) => item.kind === "file")
    .map((item) => item.getAsFile())
    .filter((file): file is File => Boolean(file));
}
```

Attach to composer surface:

```tsx
onDragEnter={(event) => { if (dragEventHasFiles(event)) { event.preventDefault(); setComposerDragActive(true); } }}
onDragOver={(event) => { if (dragEventHasFiles(event)) event.preventDefault(); }}
onDragLeave={() => setComposerDragActive(false)}
onDrop={(event) => {
  if (!dragEventHasFiles(event)) return;
  event.preventDefault();
  setComposerDragActive(false);
  void addFiles(event.dataTransfer.files);
}}
onPaste={(event) => {
  const files = clipboardFiles(event);
  if (files.length === 0) return;
  event.preventDefault();
  void addFiles(files);
}}
data-drag-active={composerDragActive ? "true" : undefined}
```

- [ ] **Step 6: Add partial upload failure test**

Add a test where one upload resolves and one rejects. Assert the successful attachment renders and a toast appears. This addresses the spec review recommendation.

- [ ] **Step 7: Run focused tests**

Run:

```sh
pnpm --filter @slei/desktop test -- src/features/chat/ChatPageView.test.tsx
```

Expected: PASS.

- [ ] **Step 8: Commit**

```sh
git add apps/desktop/src/features/chat/ChatPageView.tsx apps/desktop/src/features/chat/ChatPageView.test.tsx
git commit -m "feat: add composer file drop and paste"
```

## Task 5: Merged Composer Command Menu

**Files:**
- Modify: `apps/desktop/src/features/chat/SkillSlashPicker.tsx`
- Modify: `apps/desktop/src/features/chat/ChatPageView.tsx`
- Modify: `apps/desktop/src/features/chat/ChatPageView.test.tsx`

- [ ] **Step 1: Write failing tests for command menu rendering**

In `ChatPageView.test.tsx`, add channel test:

```ts
const host = await mountChatPage(
  <ChatPage activeChannel={data.channels[0]} data={data} initialDraft="/" messages={messages} profile={defaultProfile} />,
);
expect(host.querySelector('[data-testid="slei-composer-command-panel"]')).not.toBeNull();
expect(host.textContent).toContain(messages.chat.insertFileCommand);
expect(host.textContent).toContain(messages.chat.convertToTaskCommand);
```

Add middle-trigger test:

```ts
// initialDraft="帮我 /"
expect(host.querySelector('[data-testid="slei-composer-command-panel"]')).not.toBeNull();
```

Add alias filtering tests in Chinese locale so English slash commands work independently of localized labels:

```ts
for (const initialDraft of ["/fi", "/file"]) {
  const host = await mountChatPage(
    <ChatPage activeChannel={data.channels[0]} data={data} initialDraft={initialDraft} messages={messages} profile={defaultProfile} />,
  );
  expect(host.textContent).toContain(messages.chat.insertFileCommand);
}

const taskHost = await mountChatPage(
  <ChatPage activeChannel={data.channels[0]} data={data} initialDraft="/task" messages={messages} profile={defaultProfile} />,
);
expect(taskHost.textContent).toContain(messages.chat.convertToTaskCommand);

const localizedTaskHost = await mountChatPage(
  <ChatPage activeChannel={data.channels[0]} data={data} initialDraft="/转为" messages={messages} profile={defaultProfile} />,
);
expect(localizedTaskHost.textContent).toContain(messages.chat.convertToTaskCommand);
```

Add DM merge test using existing `dmSkillSlashFixture("/")`:

```ts
expect(host.textContent).toContain(messages.chat.insertFileCommand);
expect(host.textContent).toContain(messages.chat.convertToTaskCommand);
expect(host.textContent).toContain("/memory");
```

- [ ] **Step 2: Write failing tests for command execution**

Add tests:

- Clicking “转为任务” removes `/task` from draft and sets switch checked.
- Clicking “插入文件” removes `/file` from draft and calls `fileInput.click()`.
- Selecting `/memory` in DM inserts `/memory ` at the trigger position.
- Pressing `ArrowDown` then `Enter` executes the second menu item, proving keyboard navigation still works for merged command options.

Use selectors:

```ts
'[data-composer-command-id="convert-to-task"]'
'[data-composer-command-id="insert-file"]'
'[data-composer-skill-id="memory"]'
```

- [ ] **Step 3: Run tests to verify they fail**

Run:

```sh
pnpm --filter @slei/desktop test -- src/features/chat/ChatPageView.test.tsx
```

Expected: FAIL because menu is still skill-only and DM-only.

- [ ] **Step 4: Generalize picker component**

In `apps/desktop/src/features/chat/SkillSlashPicker.tsx`, either rename to `ComposerCommandPicker` or add a new export in the same file:

```ts
type ComposerCommandOption =
  | { kind: "command"; id: "insert-file" | "convert-to-task"; title: string; description: string; aliases: string[]; icon: SleiIconName }
  | { kind: "skill"; id: string; name: string; trigger?: string };
```

Render:

- `aria-label={messages.chat.chooseComposerCommand}`
- `data-testid="slei-composer-command-panel"`
- command rows with `data-composer-command-id`
- skill rows with `data-composer-skill-id`

Keep the existing card/scroll area shape and keyboard-friendly button rows.

- [ ] **Step 5: Wire command options in ChatPageView**

In `ChatPageView.tsx`:

- Replace `activeSkillSlashQuery(draft)` with `activeComposerSlashQuery(draft)`.
- Import `composerCommandMatchesQuery` from `../../app/model`.
- Compute fixed command options filtered by query:

```ts
const composerCommands = [
  {
    kind: "command",
    id: "insert-file",
    title: messages.chat.insertFileCommand,
    description: messages.chat.insertFileCommandDescription,
    aliases: ["file", "fi", "insert", "attachment", "附件", "文件", "插入文件"],
    icon: "attachment",
  },
  {
    kind: "command",
    id: "convert-to-task",
    title: messages.chat.convertToTaskCommand,
    description: messages.chat.convertToTaskCommandDescription,
    aliases: ["task", "todo", "convert", "任务", "转为任务"],
    icon: "check",
  },
] satisfies ComposerCommandOption[];
```

- Include skills only when `dmMember` exists:

```ts
const filteredFixedCommands = composerCommands.filter((command) =>
  composerCommandMatchesQuery(composerSlash.query, [command.title, ...command.aliases]),
);
const composerCommandOptions = [
  ...filteredFixedCommands,
  ...(dmMember ? skillSlashSuggestions(composerSlash.query, dmMember.skills ?? []).map(skillToOption) : []),
];
```

Also update the reserve expression from Task 3 so the merged command menu reserves expanded space:

```ts
const composerReservePx = attachments.length > 0 || (mention && mentionTargets.length > 0) || (composerSlash && composerCommandOptions.length > 0)
  ? COMPOSER_EXPANDED_RESERVE_PX
  : COMPOSER_RESERVE_PX;
```

- Use one selected index state for command options.
- On execute:
  - command `insert-file`: `setDraft(removeComposerSlashQuery(draft, composerSlash)); fileInputRef.current?.click();`
  - command `convert-to-task`: `setDraft(removeComposerSlashQuery(draft, composerSlash)); setAsTask(true);`
  - skill: `setDraft(insertSkillSlash(draft, composerSlash, skill));`

- Update keyboard handling so command menu gets priority before mention selection.
- Escape removes the query and resets selected index.

- [ ] **Step 6: Keep message skill highlight behavior**

Verify `leadingSkillSlashToken()` usage still only applies to sent DM messages and only for leading tokens. Do not highlight fixed command names.

- [ ] **Step 7: Run focused tests**

Run:

```sh
pnpm --filter @slei/desktop test -- src/app/model.test.ts src/features/chat/ChatPageView.test.tsx
```

Expected: PASS.

- [ ] **Step 8: Commit**

```sh
git add apps/desktop/src/features/chat/SkillSlashPicker.tsx apps/desktop/src/features/chat/ChatPageView.tsx apps/desktop/src/features/chat/ChatPageView.test.tsx
git commit -m "feat: merge composer command menu"
```

## Task 6: Full Verification And Cleanup

**Files:**
- Modify as needed only if verification exposes small issues in previous files.

- [ ] **Step 1: Run full desktop tests**

Run:

```sh
pnpm --filter @slei/desktop test
```

Expected: PASS.

- [ ] **Step 2: Run desktop lint**

Run:

```sh
pnpm --filter @slei/desktop lint
```

Expected: PASS.

- [ ] **Step 3: Inspect git diff**

Run:

```sh
git status --short
git diff --stat
```

Expected: only files listed in this plan are modified, plus any necessary snapshot-free test updates. No daemon schema/API files should be changed.

- [ ] **Step 4: Optional manual app check**

If a desktop app session is useful, start the Slei desktop app per project instruction:

```sh
pnpm --filter @slei/desktop desktop
```

Manually verify:

- Composer appears as one unified rounded input panel.
- Placeholder includes `/` function hint.
- Long main composer text grows then scrolls.
- Long task thread reply text grows then scrolls.
- Dragging a file onto composer adds attachment.
- Pasting an image adds a thumbnail attachment.
- `/` and `文本 /` open the merged menu.
- “转为任务” switch affects the next send.

- [ ] **Step 5: Final commit if cleanup changed files**

If Step 1 or Step 2 required additional fixes:

```sh
git add <changed-files>
git commit -m "fix: polish composer command behavior"
```

If no files changed after Task 5, skip this commit.

## Post-Implementation Completion

After implementation and verification:

- Summarize changed behavior and tests run.
- Because Slei project instructions require it after code-changing tasks, ask whether to merge the completed branch/worktree into `master` or another branch.
