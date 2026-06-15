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

  it("renders a collapsed task root entry and hides the source channel message", () => {
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
    expect(html).toContain("lucide-scroll-text");
    expect(html).toContain("border-primary/20");
    expect(html).toContain("hover:bg-muted/20");
    expect(html).toContain("data-task-root-entry-icon");
    const taskEntryHtml = html.slice(html.indexOf("data-task-root-entry"));
    const taskEntryClose = taskEntryHtml.indexOf("</article>");
    expect(taskEntryHtml.slice(0, taskEntryClose)).toContain('data-task-root-entry-trigger="replies"');
    expect(html).not.toContain('data-message-id="msg_root"');
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
            { id: "msg_root", author: "Lei", role: "human", time: "10:00", body: "实现任务分支", channelId: "all" },
            {
              id: "task_card_1",
              author: "channel_coordinator",
              role: "system",
              time: "10:00",
              body: "task_card:task_1:source:msg_root",
              channelId: "all",
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

  it("binds the task root body trigger to open the drawer without nesting buttons", () => {
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
    });

    const bodyTrigger = entry.props.children[0];
    expect(bodyTrigger.type).toBe("button");
    expect(bodyTrigger.props["data-task-root-entry-trigger"]).toBe("body");
    bodyTrigger.props.onClick();
    expect(opened).toBe(true);

    const html = renderToStaticMarkup(entry);
    expect(html).toContain("请实现任务分支，并保持频道简洁。");
    expect(html).toContain("data-task-root-entry-trigger=\"body\"");
    const firstButtonOpen = html.indexOf("<button");
    const firstButtonClose = html.indexOf("</button>");
    const secondButtonOpen = html.indexOf("<button", firstButtonOpen + 1);
    expect(secondButtonOpen).toBeGreaterThan(firstButtonClose);
  });
});
