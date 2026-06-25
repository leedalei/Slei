import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { SleiAppFrame } from "../src/app/SleiApp";
import { createSleiFixtures } from "../src/test/fixtures";
import { createDesktopMessages } from "../src/i18n";
import { TaskRootEntry } from "../src/features/chat/TaskRootEntry";

const readyRuntime = {
  loading: false,
  error: undefined,
  hasClaudeRuntimeReady: true,
  nodes: createSleiFixtures().nodes,
};

function findTaskReplyButton(node: unknown): any {
  if (!node || typeof node !== "object") return undefined;
  if (Array.isArray(node)) {
    return node.map(findTaskReplyButton).find(Boolean);
  }
  const props = (node as { props?: Record<string, unknown> }).props;
  if (!props) return undefined;
  if (props["data-task-root-entry-replies"]) return node;
  return findTaskReplyButton(props.children);
}

function extractHtmlElementByAttribute(html: string, attribute: string) {
  const attributeIndex = html.indexOf(attribute);
  expect(attributeIndex).toBeGreaterThanOrEqual(0);
  const tagStart = html.lastIndexOf("<", attributeIndex);
  const openTagEnd = html.indexOf(">", tagStart);
  const openTag = html.slice(tagStart, openTagEnd + 1);
  const tagName = /^<([a-z][a-z0-9-]*)\b/i.exec(openTag)?.[1];
  expect(tagName).toBeTruthy();

  const tagPattern = new RegExp(`</?${tagName}\\b[^>]*>`, "gi");
  tagPattern.lastIndex = openTagEnd + 1;
  let depth = 1;
  let match: RegExpExecArray | null;
  while ((match = tagPattern.exec(html))) {
    depth += match[0].startsWith("</") ? -1 : 1;
    if (depth === 0) {
      return {
        html: html.slice(tagStart, tagPattern.lastIndex),
        openTag,
      };
    }
  }
  throw new Error(`Could not extract element for ${attribute}`);
}

describe("task branch sessions", () => {
  it("keeps drawer reply persistence wiring connected at the source level", () => {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    const chatPageSource = readFileSync(resolve(root, "src/features/chat/ChatPageView.tsx"), "utf8");
    const appSource = readFileSync(resolve(root, "src/app/SleiApp.tsx"), "utf8");

    expect(chatPageSource).toContain("onTaskReply");
    expect(chatPageSource).toContain("TaskThreadDrawer");
    expect(appSource).toContain("handleTaskReply");
    expect(appSource).toContain("replyToTask");
  });

  it("keeps task agent execution delegated to the daemon", () => {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    const appSource = readFileSync(resolve(root, "src/app/SleiApp.tsx"), "utf8");

    expect(appSource).not.toContain("runTaskAgentReply");
    expect(appSource).not.toContain("runChannelAgentReply");
    expect(appSource).not.toContain("taskAgentReplyPrompt");
    expect(appSource).not.toContain("createChannelTaskPlaceholder");
    expect(appSource).not.toContain("waitForChannelAgentReply");
    expect(appSource).not.toContain("createChannelAgentReplyMessage(result.receipt.outcome");
    expect(appSource).toContain("createChannelAgentActivityMessages(result.receipt.outcome");
    expect(appSource).toContain("const threadReceipt = await bridge.getTaskThread(taskId)");
    expect(appSource).toContain("applyTaskThreadReceiptToState(threadReceipt)");
    expect(appSource).toContain('"task-agent-reply", "delegated-to-daemon"');
    expect(appSource).toContain('"channel-agent-reply", "delegated-to-daemon"');
  });

  it("renders a task-linked source message as the task root entry", () => {
    const html = renderToStaticMarkup(
      <SleiAppFrame
        activeView="chat"
        data={createSleiFixtures({
          messages: [
            {
              id: "msg_root",
              author: "Lei",
              handle: "@lei",
              role: "human",
              time: "10:00",
              body: "请实现任务分支，并保持频道简洁。",
              channelId: "all",
              task: {
                id: "task_1",
                title: "实现任务分支",
                owner: "Lei",
                creatorId: "human:local",
                status: "pending_assignment",
                channelId: "all",
                sourceMessageId: "msg_root",
                replyCount: 0,
                attentionRequired: true,
              },
            },
          ],
          tasks: [
            {
              id: "task_1",
              title: "实现任务分支",
              owner: "Lei",
              creatorId: "human:local",
              status: "pending_assignment",
              channelId: "all",
              sourceMessageId: "msg_root",
              replyCount: 0,
              attentionRequired: true,
              replies: [{ id: "root-msg_root", sender: "Lei", role: "human", body: "请实现任务分支，并保持频道简洁。" }],
            },
          ],
        })}
        locale="zh-CN"
        runtimeSetup={readyRuntime}
      />,
    );
    expect(html).toContain("实现任务分支");
    expect(html).toContain("请实现任务分支，并保持频道简洁。");
    expect(html).toContain("0 条回复");
    expect(html).toContain('aria-label="打开任务讨论: 实现任务分支, 0 条回复"');
    expect(html).toContain("待指派");
    expect(html).toContain("data-task-root-entry");
    expect(html).toContain('data-source-message-id="msg_root"');
    expect(html).toContain("@lei");
    expect(html).not.toContain("data-task-root-entry-corner-icon");
    expect(html).toContain("data-task-root-entry-status");
    expect(html).toContain("data-task-root-entry-status-dot");
    expect(html).toContain("data-task-root-entry-actions");
    expect(html).toContain("data-task-root-entry-replies");
    expect(html).toContain("data-avatar-size");
    expect(html).toContain("用户");
    expect(html).toContain('data-slot="card"');
    expect(html).toContain("10:00");
    const taskEntry = extractHtmlElementByAttribute(html, 'data-task-root-entry="task_1"');
    const taskEntryHtml = taskEntry.html;
    const taskEntryOpenTag = taskEntry.openTag;
    expect(taskEntryOpenTag).toContain("bg-transparent");
    expect(taskEntryOpenTag).toContain("hover:border-border/50");
    expect(taskEntryOpenTag).toContain("shadow-none");
    expect(taskEntryOpenTag).toContain("after:hidden");
    expect(taskEntryOpenTag).not.toContain("hover:shadow");
    expect(taskEntryHtml).toContain('aria-label="复制"');
    expect(taskEntryHtml).toContain('aria-label="收藏"');
    expect(taskEntryHtml).toContain('aria-label="打开任务讨论: 实现任务分支, 0 条回复"');
    expect(taskEntryHtml.indexOf("data-task-root-entry-replies")).toBeLessThan(taskEntryHtml.indexOf("data-task-root-entry-status"));
    expect(html).not.toContain('data-message-id="msg_root"');
  });

  it("renders a task-linked source message body only once without a separate visible task title", () => {
    const sourceBody = "帮我把大盘数据页的alert文案改成 2026/06/16";
    const taskTitle = "修改大盘数据页 alert 文案";
    const html = renderToStaticMarkup(
      <SleiAppFrame
        activeView="chat"
        data={createSleiFixtures({
          messages: [
            {
              id: "msg_task_source",
              author: "Lei",
              handle: "@lei",
              role: "human",
              time: "10:00",
              body: sourceBody,
              channelId: "all",
              task: {
                id: "task_source",
                title: taskTitle,
                owner: "Lei",
                creatorId: "human:local",
                status: "in_progress",
                channelId: "all",
                sourceMessageId: "msg_task_source",
                replyCount: 0,
              },
            },
          ],
          tasks: [
            {
              id: "task_source",
              title: taskTitle,
              owner: "Lei",
              creatorId: "human:local",
              status: "in_progress",
              channelId: "all",
              sourceMessageId: "msg_task_source",
              replyCount: 0,
              replies: [{ id: "root-msg_task_source", sender: "Lei", role: "human", body: sourceBody }],
            },
          ],
        })}
        locale="zh-CN"
        runtimeSetup={readyRuntime}
      />,
    );
    const taskEntryHtml = html.slice(html.indexOf('data-task-root-entry="task_source"'));
    const articleHtml = taskEntryHtml.slice(0, taskEntryHtml.indexOf("</article>"));
    const visibleText = articleHtml
      .replace(/<button\b[^>]*>[\s\S]*?<\/button>/g, "")
      .replace(/<[^>]+>/g, "");

    expect(visibleText.match(new RegExp(sourceBody, "g"))?.length).toBe(1);
    expect(visibleText).not.toContain(taskTitle);
    expect(articleHtml).toContain(`aria-label="打开任务讨论: ${taskTitle}, 0 条回复"`);
  });

  it("renders a task source message as a task card when the task arrives from the task list", () => {
    const sourceBody = "帮我把大盘数据页的alert文案改成 2026/06/16";
    const html = renderToStaticMarkup(
      <SleiAppFrame
        activeView="chat"
        data={createSleiFixtures({
          messages: [
            {
              id: "msg_task_source",
              author: "Lei",
              handle: "@lei",
              role: "human",
              time: "10:00",
              body: sourceBody,
              channelId: "all",
            },
          ],
          tasks: [
            {
              id: "task_source",
              title: sourceBody,
              owner: "Coda",
              creatorId: "human:local",
              assigneeId: "agent_coda",
              status: "in_progress",
              channelId: "all",
              sourceMessageId: "msg_task_source",
              replyCount: 0,
            },
          ],
        })}
        locale="zh-CN"
        runtimeSetup={readyRuntime}
      />,
    );
    const taskEntryHtml = html.slice(html.indexOf('data-task-root-entry="task_source"'));

    expect(taskEntryHtml).toContain(sourceBody);
    expect(taskEntryHtml).toContain("进行中");
    expect(html).toContain('data-source-message-id="msg_task_source"');
    expect(html).not.toContain('data-message-id="msg_task_source"');
  });

  it("keeps the source channel message visible when task-card data is missing", () => {
    const html = renderToStaticMarkup(
      <SleiAppFrame
        activeView="chat"
        data={createSleiFixtures({
          messages: [
            { id: "msg_root", author: "Lei", role: "human", time: "10:00", body: "实现任务分支", channelId: "all" },
            {
              id: "task_card_1",
              author: "channel_coordinator",
              role: "system",
              time: "10:00",
              body: "task_card:task_1:source:msg_root",
              channelId: "all",
            },
          ],
          tasks: [],
        })}
        locale="zh-CN"
        runtimeSetup={readyRuntime}
      />,
    );
    expect(html).toContain("实现任务分支");
    expect(html).toContain('data-message-id="msg_root"');
    expect(html).not.toContain("data-task-root-entry");
  });

  it("keeps the source channel message visible when task-card source metadata is stale", () => {
    const html = renderToStaticMarkup(
      <SleiAppFrame
        activeView="chat"
        data={createSleiFixtures({
          messages: [
            { id: "msg_root", author: "Lei", role: "human", time: "10:00", body: "实现任务分支", channelId: "all" },
            {
              id: "task_card_1",
              author: "channel_coordinator",
              role: "system",
              time: "10:00",
              body: "task_card:task_1:source:msg_root",
              channelId: "all",
            },
          ],
          tasks: [
            {
              id: "task_1",
              title: "实现任务分支",
              owner: "Lei",
              status: "pending_assignment",
              channelId: "all",
              sourceMessageId: "different_msg",
              replyCount: 0,
            },
          ],
        })}
        locale="zh-CN"
        runtimeSetup={readyRuntime}
      />,
    );
    expect(html).toContain("实现任务分支");
    expect(html).toContain('data-message-id="msg_root"');
    expect(html).not.toContain("data-task-root-entry");
  });

  it("hides completed and failed task-related agent replies from the outer channel", () => {
    const html = renderToStaticMarkup(
      <SleiAppFrame
        activeView="chat"
        data={createSleiFixtures({
          messages: [
            {
              id: "msg_root",
              author: "Lei",
              role: "human",
              time: "10:00",
              body: "实现任务分支",
              channelId: "all",
              task: {
                id: "task_1",
                title: "实现任务分支",
                owner: "Lei",
                status: "in_progress",
                channelId: "all",
                sourceMessageId: "msg_root",
                replyCount: 1,
              },
            },
            { id: "agent-activity-msg_root", author: "Coda", role: "agent", time: "10:01", body: "任务已经完成。", channelId: "all", status: "done" },
            { id: "agent-reply-msg_root", author: "Coda", role: "agent", time: "10:02", body: "任务执行失败。", channelId: "all", status: "failed" },
            { id: "agent-activity-unrelated", author: "Coda", role: "agent", time: "10:03", body: "普通频道回复。", channelId: "all", status: "done" },
          ],
          tasks: [
            {
              id: "task_1",
              title: "实现任务分支",
              owner: "Lei",
              status: "in_progress",
              channelId: "all",
              sourceMessageId: "msg_root",
              replyCount: 1,
              replies: [{ id: "root-msg_root", sender: "Lei", role: "human", body: "实现任务分支" }],
            },
          ],
        })}
        locale="zh-CN"
        runtimeSetup={readyRuntime}
      />,
    );
    expect(html).toContain("data-task-root-entry");
    expect(html).not.toContain("任务已经完成。");
    expect(html).not.toContain("任务执行失败。");
    expect(html).toContain("普通频道回复。");
  });

  it("does not render a task root when task-card source metadata is absent", () => {
    const html = renderToStaticMarkup(
      <SleiAppFrame
        activeView="chat"
        data={createSleiFixtures({
          messages: [
            {
              id: "task_card_1",
              author: "channel_coordinator",
              role: "system",
              time: "10:00",
              body: "task_card:task_1",
              channelId: "all",
            },
          ],
          tasks: [
            {
              id: "task_1",
              title: "实现任务分支",
              owner: "Lei",
              status: "pending_assignment",
              channelId: "all",
              replyCount: 0,
            },
          ],
        })}
        locale="zh-CN"
        runtimeSetup={readyRuntime}
      />,
    );
    expect(html).not.toContain("data-task-root-entry");
    expect(html).not.toContain("task_card:task_1");
  });

  it("does not render invalid task-card control messages as system messages", () => {
    const html = renderToStaticMarkup(
      <SleiAppFrame
        activeView="chat"
        data={createSleiFixtures({
          messages: [
            {
              id: "task_card_invalid",
              author: "channel_coordinator",
              role: "system",
              time: "10:00",
              body: "task_card:",
              channelId: "all",
            },
          ],
          tasks: [],
        })}
        locale="zh-CN"
        runtimeSetup={readyRuntime}
      />,
    );
    expect(html).not.toContain('data-message-id="task_card_invalid"');
    expect(html).not.toContain("task_card:");
  });

  it("binds the task root card to open the drawer without nesting buttons", () => {
    let opened = false;
    const entry = TaskRootEntry({
      messages: createDesktopMessages("zh-CN"),
      onOpen: () => {
        opened = true;
      },
      task: {
        id: "task_1",
        title: "实现任务分支",
        owner: "Lei",
        status: "pending_assignment",
        channelId: "all",
        sourceMessageId: "msg_root",
        replyCount: 0,
        replies: [{ id: "root-msg_root", sender: "Lei", role: "human", body: "请实现任务分支，并保持频道简洁。" }],
      },
      sourceMessage: { id: "msg_root", author: "Lei", role: "human", time: "10:00", body: "请实现任务分支，并保持频道简洁。", channelId: "all" },
    });

    const html = renderToStaticMarkup(entry);
    expect(html).toContain("请实现任务分支，并保持频道简洁。");
    expect(html).toContain("data-task-root-entry-replies");
    expect(html).not.toContain("data-task-root-entry-corner-icon");
    expect(html).not.toContain("data-task-root-entry-trigger=\"body\"");
    const replyButton = findTaskReplyButton(entry);
    expect(replyButton.props["data-task-root-entry-replies"]).toBe(true);
    replyButton.props.onClick();
    expect(opened).toBe(true);
  });
});
