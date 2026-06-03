# Channel Embedded Views Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the channel header Chat, Tasks, and Files tabs switch the current channel between chat, channel-scoped task list, and channel-scoped attachment list while removing the runtime detected badge.

**Architecture:** Keep the feature local to the desktop chat page. `ChatPage` owns an embedded channel view state, derives channel tasks from `data.tasks`, derives channel files from visible channel messages, and renders small list components for tasks and files. `SleiAppFrame` only forwards an optional initial channel view for SSR tests.

**Tech Stack:** React 19, TypeScript, lucide-react, Vitest SSR tests with `renderToStaticMarkup`, existing desktop CSS in `apps/desktop/src/app/app.css`.

---

## Relevant Context

- Worktree: `/Users/leelei/Documents/Slei/.worktrees/channel-embedded-views`
- Spec: `docs/superpowers/specs/2026-06-03-channel-embedded-views-design.md`
- Existing chat component: `apps/desktop/src/features/chat/ChatPageView.tsx`
- Existing frame/test entry: `apps/desktop/src/app/SleiAppFrame.tsx`
- Existing style file: `apps/desktop/src/app/app.css`
- Existing chat i18n keys: `apps/desktop/src/i18n/messages/zh-CN/chat.ts`, `apps/desktop/src/i18n/messages/en-US/chat.ts`, `apps/desktop/src/i18n/types.ts`
- Historical note: `docs/knowledge/best-practices/task-thread-stable-ids-and-reply-roles-20260529.md` says task/thread UI should use stable IDs. Use existing task ids, message ids, and attachment ids for keys; do not introduce timestamp-derived ids for this feature.

## File Structure

- Modify `apps/desktop/src/features/chat/ChatPageView.tsx`
  - Add `ChannelEmbeddedView = "chat" | "tasks" | "files"`.
  - Add `initialChannelView?: ChannelEmbeddedView`.
  - Render real tab buttons with `onClick`.
  - Remove runtime detected badge.
  - Add channel-scoped task and file list components in this file to keep the feature local.
  - Hide mention panel and composer outside the chat view.
- Modify `apps/desktop/src/app/SleiAppFrame.tsx`
  - Add optional `initialChannelView?: ChannelEmbeddedView` prop.
  - Forward it to `ChatPage` through `renderWorkspace`.
- Modify `apps/desktop/src/app/app.css`
  - Add compact list styles for channel tasks and channel files.
  - Keep styling aligned with existing card/list surfaces and avoid nested cards.
- Modify `apps/desktop/src/i18n/types.ts`
  - Add small chat strings for channel task/file empty states and metadata labels.
- Modify `apps/desktop/src/i18n/messages/zh-CN/chat.ts`
  - Add Chinese strings.
- Modify `apps/desktop/src/i18n/messages/en-US/chat.ts`
  - Add English strings.
- Create `apps/desktop/e2e/channel-embedded-views.spec.tsx`
  - SSR tests for runtime badge removal, channel task view, channel files view, channel scoping, composer hiding, and DM header behavior.

---

### Task 1: Add Failing SSR Tests

**Files:**
- Create: `apps/desktop/e2e/channel-embedded-views.spec.tsx`

- [ ] **Step 1: Create the channel embedded views test file**

Add this test file:

```tsx
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SleiAppFrame } from "../src/app/SleiApp";
import { createSleiFixtures, type SleiMember } from "../src/app/fixtures";

const nodes = createSleiFixtures().nodes;
const readyRuntime = {
  loading: false,
  error: undefined,
  hasClaudeRuntimeReady: true,
  nodes,
};

const agent: SleiMember = {
  id: "agent_coda",
  name: "Coda",
  handle: "@coda",
  avatar: "CO",
  avatarSeed: "agent_coda",
  type: "agent",
  runtimeStatus: "idle",
  role: "研发团队开发工程师",
  description: "真实创建的开发 Agent。",
  computer: nodes[0].name,
  nodeId: nodes[0].id,
  created: "2026-06-03T10:00:00Z",
  creator: "lei lee @lei-lee",
  runtime: "ClaudeCode",
  model: "Sonnet",
  instructions: "实现编码。",
  permissions: [],
  environmentVariables: [],
  createdAgents: [],
  activity: "待命",
  capabilities: ["代码实现"],
};

const dm = {
  id: "dm:agent_coda",
  kind: "dm",
  agentId: "agent_coda",
  activeSessionId: "session-current",
  createdAt: "2026-06-03T10:00:00Z",
  updatedAt: "2026-06-03T10:00:00Z",
} as const;

const session = {
  id: "session-current",
  conversationId: "dm:agent_coda",
  title: "频道视图设计",
  status: "ready",
  createdAt: "2026-06-03T10:00:00Z",
  updatedAt: "2026-06-03T10:00:00Z",
} as const;

describe("channel embedded views", () => {
  it("removes the runtime detected badge from channel headers", () => {
    const html = renderToStaticMarkup(
      <SleiAppFrame activeView="chat" data={createSleiFixtures()} locale="zh-CN" runtimeSetup={readyRuntime} />,
    );

    expect(html).toContain("slei-chat-tabs");
    expect(html).not.toContain("Runtime 已检测");
    expect(html).not.toContain("Runtime detected");
  });

  it("renders only current channel tasks and hides the composer in tasks view", () => {
    const html = renderToStaticMarkup(
      <SleiAppFrame
        activeChannelId="dev-team"
        activeView="chat"
        data={createSleiFixtures({
          channels: [
            { id: "dev-team", name: "dev-team", description: "研发频道", unread: 0 },
            { id: "ops", name: "ops", description: "运维频道", unread: 0 },
          ],
          tasks: [
            {
              id: "T-dev",
              title: "实现频道任务列表",
              owner: "Lei",
              status: "todo",
              channelId: "dev-team",
              attention: "等待确认",
              replies: [{ id: "r1", sender: "Lei", role: "human", body: "任务根消息" }],
            },
            { id: "T-ops", title: "不要展示其他频道任务", owner: "Ops", status: "todo", channelId: "ops" },
          ],
        })}
        initialChannelView="tasks"
        locale="zh-CN"
        runtimeSetup={readyRuntime}
      />,
    );

    expect(html).toContain("slei-channel-task-list");
    expect(html).toContain("实现频道任务列表");
    expect(html).toContain("等待确认");
    expect(html).toContain("1 条回复");
    expect(html).not.toContain("不要展示其他频道任务");
    expect(html).not.toContain("slei-composer");
    expect(html).toContain('aria-current="page"');
  });

  it("renders only current channel attachments and hides the composer in files view", () => {
    const html = renderToStaticMarkup(
      <SleiAppFrame
        activeChannelId="dev-team"
        activeView="chat"
        data={createSleiFixtures({
          channels: [
            { id: "dev-team", name: "dev-team", description: "研发频道", unread: 0 },
            { id: "ops", name: "ops", description: "运维频道", unread: 0 },
          ],
          messages: [
            {
              id: "m-dev",
              author: "Lei",
              role: "human",
              time: "10:10",
              body: "看附件",
              channelId: "dev-team",
              attachments: [
                { id: "att-dev-image", name: "screen.png", mimeType: "image/png", size: 1200, url: "data:image/png;base64,AAA=" },
                { id: "att-dev-file", name: "notes.md", mimeType: "text/markdown", size: 2048 },
              ],
            },
            {
              id: "m-ops",
              author: "Ops",
              role: "human",
              time: "10:20",
              body: "其他频道附件",
              channelId: "ops",
              attachments: [{ id: "att-ops", name: "ops.log", mimeType: "text/plain", size: 100 }],
            },
          ],
        })}
        initialChannelView="files"
        locale="zh-CN"
        runtimeSetup={readyRuntime}
      />,
    );

    expect(html).toContain("slei-channel-file-list");
    expect(html).toContain("screen.png");
    expect(html).toContain("notes.md");
    expect(html).toContain("Lei · 10:10");
    expect(html).toContain("slei-channel-file-thumbnail");
    expect(html).not.toContain("ops.log");
    expect(html).not.toContain("slei-composer");
  });

  it("keeps direct message session actions instead of channel tabs", () => {
    const html = renderToStaticMarkup(
      <SleiAppFrame
        activeConversationId="dm:agent_coda"
        activeSessionId="session-current"
        activeView="chat"
        data={createSleiFixtures({ conversations: [dm], conversationSessions: [session], members: [agent] })}
        locale="zh-CN"
        runtimeSetup={readyRuntime}
      />,
    );

    expect(html).toContain("新会话");
    expect(html).toContain("历史对话");
    expect(html).not.toContain("slei-chat-tabs");
  });
});
```

- [ ] **Step 2: Run the new tests and verify they fail**

Run:

```bash
pnpm --filter @slei/desktop test -- e2e/channel-embedded-views.spec.tsx
```

Expected: FAIL because `initialChannelView` is not a known prop yet, runtime badge still renders, and task/file list classes do not exist.

---

### Task 2: Wire Channel View State And Header Tabs

**Files:**
- Modify: `apps/desktop/src/features/chat/ChatPageView.tsx`
- Modify: `apps/desktop/src/app/SleiAppFrame.tsx`

- [ ] **Step 1: Add the embedded view type and prop in `ChatPageView.tsx`**

Near imports/types add:

```tsx
export type ChannelEmbeddedView = "chat" | "tasks" | "files";
```

Extend `ChatPage` props with:

```tsx
initialChannelView?: ChannelEmbeddedView;
```

Inside `ChatPage`, add:

```tsx
const [channelView, setChannelView] = useState<ChannelEmbeddedView>(initialChannelView ?? "chat");

useEffect(() => {
  setChannelView(initialChannelView ?? "chat");
}, [activeChannel.id, activeConversation?.id, initialChannelView]);

const effectiveChannelView: ChannelEmbeddedView = dmMember ? "chat" : channelView;
```

- [ ] **Step 2: Replace static channel tab buttons with clickable buttons**

In the non-DM header, replace hardcoded buttons with:

```tsx
<nav aria-label={messages.chat.channelView} className="slei-chat-tabs">
  <button aria-current={effectiveChannelView === "chat" ? "page" : undefined} onClick={() => setChannelView("chat")} type="button">
    <MessageCircle aria-hidden="true" size={14} />{messages.shell.nav.chat}
  </button>
  <button aria-current={effectiveChannelView === "tasks" ? "page" : undefined} onClick={() => setChannelView("tasks")} type="button">
    <CheckSquare aria-hidden="true" size={14} />{messages.chat.tasks}
  </button>
  <button aria-current={effectiveChannelView === "files" ? "page" : undefined} onClick={() => setChannelView("files")} type="button">
    <FileText aria-hidden="true" size={14} />{messages.chat.files}
  </button>
</nav>
```

Remove:

```tsx
<span className="slei-badge slei-badge--ready">{messages.chat.runtimeDetected}</span>
```

- [ ] **Step 3: Forward `initialChannelView` through `SleiAppFrame.tsx`**

Import the type:

```tsx
import { ChatPage, type ChannelEmbeddedView } from "../features/chat/ChatPageView";
```

Add `initialChannelView?: ChannelEmbeddedView;` to `SleiAppFrame` input.

Add `initialChannelView?: ChannelEmbeddedView` to the `renderWorkspace` signature near `initialChatDraft`.

Pass `input.initialChannelView` into `renderWorkspace`, then pass `initialChannelView={initialChannelView}` into `ChatPage`.

- [ ] **Step 4: Run the new test**

Run:

```bash
pnpm --filter @slei/desktop test -- e2e/channel-embedded-views.spec.tsx
```

Expected: runtime badge and DM tests pass; task/file list tests still fail because the views have not been implemented.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/features/chat/ChatPageView.tsx apps/desktop/src/app/SleiAppFrame.tsx apps/desktop/e2e/channel-embedded-views.spec.tsx
git commit -m "test: cover channel embedded view tabs"
```

---

### Task 3: Add Channel Task List View

**Files:**
- Modify: `apps/desktop/src/features/chat/ChatPageView.tsx`
- Modify: `apps/desktop/src/i18n/types.ts`
- Modify: `apps/desktop/src/i18n/messages/zh-CN/chat.ts`
- Modify: `apps/desktop/src/i18n/messages/en-US/chat.ts`

- [ ] **Step 1: Add chat i18n strings**

Add these fields to `DesktopMessages["chat"]`:

```ts
channelTaskEmpty: string;
channelFileEmpty: string;
openAttachment: (name: string) => string;
replyCount: (count: number) => string;
rootMessage: string;
```

Add Chinese messages:

```ts
channelTaskEmpty: "当前频道暂无任务",
channelFileEmpty: "当前频道暂无附件",
openAttachment: (name: string) => `打开附件 ${name}`,
replyCount: (count: number) => `${count} 条回复`,
rootMessage: "根消息",
```

Add English messages:

```ts
channelTaskEmpty: "No tasks in this channel",
channelFileEmpty: "No files in this channel",
openAttachment: (name: string) => `Open attachment ${name}`,
replyCount: (count: number) => `${count} replies`,
rootMessage: "Root message",
```

- [ ] **Step 2: Add `ChannelTaskList` in `ChatPageView.tsx`**

Add a focused component above `ChatPage`:

```tsx
function ChannelTaskList({ messages, tasks }: { messages: DesktopMessages; tasks: SleiFixtures["tasks"] }) {
  const [selectedTaskId, setSelectedTaskId] = useState(tasks[0]?.id);
  const selectedTask = tasks.find((task) => task.id === selectedTaskId) ?? tasks[0];
  if (tasks.length === 0) {
    return <section className="slei-channel-empty">{messages.chat.channelTaskEmpty}</section>;
  }

  return (
    <section className="slei-channel-task-list" aria-label={messages.chat.tasks}>
      <div className="slei-channel-task-list__items">
        {tasks.map((task) => (
          <button
            aria-current={selectedTask?.id === task.id ? "true" : undefined}
            className="slei-channel-task-row"
            key={task.id}
            onClick={() => setSelectedTaskId(task.id)}
            type="button"
          >
            <span className={`slei-task-status-chip slei-task-status-chip--${task.status}`}>{taskStatusLabel(task.status, messages)}</span>
            <strong>{task.title}</strong>
            <small>{task.owner} · {messages.chat.replyCount(task.replies?.length ?? 0)}</small>
            {task.attention ? <b className="slei-badge slei-badge--attention">{task.attention}</b> : null}
          </button>
        ))}
      </div>
      {selectedTask ? (
        <aside className="slei-channel-task-detail">
          <span className={`slei-task-status-chip slei-task-status-chip--${selectedTask.status}`}>{taskStatusLabel(selectedTask.status, messages)}</span>
          <h2>{selectedTask.title}</h2>
          <p>{selectedTask.owner} · {messages.chat.replyCount(selectedTask.replies?.length ?? 0)}</p>
          <div className="slei-channel-task-detail__replies">
            {(selectedTask.replies ?? []).map((reply, index) => (
              <article className="slei-channel-task-reply" key={reply.id}>
                <strong>{index === 0 ? messages.chat.rootMessage : reply.sender}</strong>
                <p>{reply.body}</p>
              </article>
            ))}
          </div>
        </aside>
      ) : null}
    </section>
  );
}
```

If `taskStatusLabel` is not currently in this file, add a local helper:

```tsx
function taskStatusLabel(status: SleiFixtures["tasks"][number]["status"], messages: DesktopMessages) {
  return messages.tasks.status[status];
}
```

- [ ] **Step 3: Derive current channel tasks and render the view**

Inside `ChatPage`, after `visibleMessages`:

```tsx
const channelTasks = data.tasks.filter((task) => task.channelId === activeChannel.id);
```

Move the existing timeline `<div className="slei-timeline">` block into a conditional branch rendered when `effectiveChannelView === "chat"`. Render `<ChannelTaskList messages={messages} tasks={channelTasks} />` when `effectiveChannelView === "tasks"`. Render `<ChannelFileList files={channelFiles} messages={messages} />` for the files branch. Do not rewrite the message article markup; only move the existing block under the chat condition.

At this step `ChannelFileList` can be a temporary placeholder returning the empty files state if needed; Task 4 replaces it.

- [ ] **Step 4: Hide mention panel and composer outside chat view**

Change the existing mention panel condition from `mention && mentionTargets.length > 0` to:

```tsx
effectiveChannelView === "chat" && mention && mentionTargets.length > 0
```

Wrap the existing composer form so it renders only when `effectiveChannelView === "chat"`. Do not rewrite the form body; keep the current attachment, textarea, tool, and send button markup inside the conditional.

- [ ] **Step 5: Run focused tests**

Run:

```bash
pnpm --filter @slei/desktop test -- e2e/channel-embedded-views.spec.tsx
```

Expected: task view assertions pass; files view may still fail until Task 4.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/features/chat/ChatPageView.tsx apps/desktop/src/i18n/types.ts apps/desktop/src/i18n/messages/zh-CN/chat.ts apps/desktop/src/i18n/messages/en-US/chat.ts
git commit -m "feat: add channel task embedded view"
```

---

### Task 4: Add Channel Files View

**Files:**
- Modify: `apps/desktop/src/features/chat/ChatPageView.tsx`

- [ ] **Step 1: Add a derived file entry type**

Near `ChannelEmbeddedView`, add:

```tsx
type ChannelFileEntry = {
  attachment: ConversationAttachmentView;
  author: string;
  messageId: string;
  time: string;
};
```

- [ ] **Step 2: Derive files from visible messages**

Inside `ChatPage`, after `visibleMessages`:

```tsx
const channelFiles: ChannelFileEntry[] = visibleMessages
  .flatMap((message) =>
    (message.attachments ?? []).map((attachment) => ({
      attachment,
      author: message.author,
      messageId: message.id,
      time: message.time,
    })),
  )
  .reverse();
```

This keeps newest visible message attachments first without adding unstable ids.

- [ ] **Step 3: Add `ChannelFileList`**

Add this component above `ChatPage`:

```tsx
function ChannelFileList({ files, messages }: { files: ChannelFileEntry[]; messages: DesktopMessages }) {
  if (files.length === 0) {
    return <section className="slei-channel-empty">{messages.chat.channelFileEmpty}</section>;
  }

  function openAttachment(attachment: ConversationAttachmentView) {
    if (!attachment.url || typeof window === "undefined") return;
    window.open(attachment.url, "_blank", "noopener,noreferrer");
  }

  return (
    <section className="slei-channel-file-list" aria-label={messages.chat.files}>
      {files.map(({ attachment, author, messageId, time }) => {
        const isImage = attachment.mimeType.startsWith("image/");
        const canOpen = Boolean(attachment.url);
        return (
          <button
            aria-label={messages.chat.openAttachment(attachment.name)}
            className="slei-channel-file-row"
            disabled={!canOpen}
            key={`${messageId}-${attachment.id}`}
            onClick={() => openAttachment(attachment)}
            type="button"
          >
            {isImage && attachment.url ? (
              <img alt="" className="slei-channel-file-thumbnail" src={attachment.url} />
            ) : (
              <span className="slei-channel-file-icon"><FileText aria-hidden="true" size={16} /></span>
            )}
            <span className="slei-channel-file-row__copy">
              <strong>{attachment.name}</strong>
              <small>{author} · {time}</small>
            </span>
            <small>{formatAttachmentSize(attachment.size)}</small>
          </button>
        );
      })}
    </section>
  );
}
```

- [ ] **Step 4: Render files view from `ChatPage`**

Ensure the view switch from Task 3 renders:

```tsx
<ChannelFileList files={channelFiles} messages={messages} />
```

- [ ] **Step 5: Run focused tests**

Run:

```bash
pnpm --filter @slei/desktop test -- e2e/channel-embedded-views.spec.tsx
```

Expected: all tests in the new spec pass.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/features/chat/ChatPageView.tsx
git commit -m "feat: add channel file embedded view"
```

---

### Task 5: Style Embedded Task And File Lists

**Files:**
- Modify: `apps/desktop/src/app/app.css`

- [ ] **Step 1: Add channel embedded view layout styles**

Add styles near existing chat/timeline/composer styles:

```css
.slei-channel-empty {
  align-items: center;
  color: var(--color-text-secondary);
  display: flex;
  flex: 1 1 auto;
  font-weight: var(--weight-bold);
  justify-content: center;
  padding: var(--padding-panel);
}

.slei-channel-task-list {
  display: grid;
  flex: 1 1 auto;
  gap: var(--gap-md);
  grid-template-columns: minmax(260px, 360px) minmax(0, 1fr);
  min-height: 0;
  overflow: hidden;
  padding: var(--padding-panel);
}

.slei-channel-task-list__items,
.slei-channel-file-list,
.slei-channel-task-detail__replies {
  display: flex;
  flex-direction: column;
  gap: var(--gap-sm);
  min-height: 0;
  overflow: auto;
}

.slei-channel-task-row,
.slei-channel-file-row {
  align-items: center;
  background: var(--color-surface);
  border: var(--border-card) solid var(--color-border);
  box-shadow: var(--shadow-xs);
  color: var(--color-text-primary);
  display: grid;
  gap: var(--gap-sm);
  min-height: 48px;
  padding: var(--gap-sm);
  text-align: left;
}

.slei-channel-task-row {
  grid-template-columns: auto minmax(0, 1fr);
}

.slei-channel-task-row strong,
.slei-channel-file-row strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.slei-channel-task-row small,
.slei-channel-file-row small,
.slei-channel-task-detail p {
  color: var(--color-text-secondary);
}

.slei-channel-task-row[aria-current="true"] {
  background: var(--color-accent);
}

.slei-channel-task-detail {
  background: var(--color-surface-alt);
  border: var(--border-card) solid var(--color-border);
  display: grid;
  gap: var(--gap-md);
  grid-template-rows: auto auto auto minmax(0, 1fr);
  min-height: 0;
  padding: var(--padding-panel);
}

.slei-channel-task-detail h2 {
  font-size: var(--text-lg);
  margin: 0;
}

.slei-channel-task-reply {
  background: var(--color-surface);
  border: var(--border-subtle) solid var(--color-border-subtle);
  display: grid;
  gap: var(--gap-xs);
  padding: var(--gap-sm);
}

.slei-channel-task-reply p {
  margin: 0;
}

.slei-task-status-chip {
  background: var(--color-surface-alt);
  border: var(--border-subtle) solid var(--color-border);
  font-size: var(--text-xs);
  font-weight: var(--weight-bold);
  padding: 2px var(--gap-xs);
}

.slei-channel-file-list {
  flex: 1 1 auto;
  padding: var(--padding-panel);
}

.slei-channel-file-row {
  grid-template-columns: auto minmax(0, 1fr) auto;
}

.slei-channel-file-row:disabled {
  cursor: default;
}

.slei-channel-file-thumbnail,
.slei-channel-file-icon {
  height: 36px;
  width: 36px;
}

.slei-channel-file-thumbnail {
  border: var(--border-subtle) solid var(--color-border);
  object-fit: cover;
}

.slei-channel-file-icon {
  align-items: center;
  background: var(--color-surface-alt);
  border: var(--border-subtle) solid var(--color-border);
  display: inline-flex;
  justify-content: center;
}

.slei-channel-file-row__copy {
  display: grid;
  gap: 2px;
  min-width: 0;
}
```

- [ ] **Step 2: Add responsive fallback**

Near existing media queries, add:

```css
@media (max-width: 900px) {
  .slei-channel-task-list {
    grid-template-columns: 1fr;
  }
}
```

- [ ] **Step 3: Run tests**

Run:

```bash
pnpm --filter @slei/desktop test -- e2e/channel-embedded-views.spec.tsx
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/app/app.css
git commit -m "style: polish channel embedded views"
```

---

### Task 6: Final Verification

**Files:**
- No new files unless fixes are needed.

- [ ] **Step 1: Run focused tests**

Run:

```bash
pnpm --filter @slei/desktop test -- e2e/channel-embedded-views.spec.tsx
```

Expected: PASS.

- [ ] **Step 2: Run full desktop tests**

Run:

```bash
pnpm --filter @slei/desktop test
```

Expected: PASS, 147+ tests.

- [ ] **Step 3: Run typecheck**

Run:

```bash
pnpm --filter @slei/desktop typecheck
```

Expected: PASS.

- [ ] **Step 4: Inspect git status**

Run:

```bash
git status --short
```

Expected: clean working tree after commits, or only intentional uncommitted fixes before the final commit.

- [ ] **Step 5: Manual desktop check if a dev server is already running or easy to start**

Run if needed:

```bash
pnpm --filter @slei/desktop desktop
```

Expected:

- Channel header shows Chat, Tasks, Files tabs.
- Runtime detected badge is gone.
- Tasks tab shows current channel tasks and no composer.
- Files tab shows current channel attachments and no composer.
- Switching to another channel resets the embedded view to Chat.
- Direct messages still show New session and History actions.

- [ ] **Step 6: Final commit if verification required small fixes**

If any final fix was needed:

```bash
git add apps/desktop/src/features/chat/ChatPageView.tsx apps/desktop/src/app/SleiAppFrame.tsx apps/desktop/src/app/app.css apps/desktop/src/i18n/types.ts apps/desktop/src/i18n/messages/zh-CN/chat.ts apps/desktop/src/i18n/messages/en-US/chat.ts apps/desktop/e2e/channel-embedded-views.spec.tsx
git commit -m "fix: verify channel embedded views"
```

Otherwise, do not create an empty commit.
