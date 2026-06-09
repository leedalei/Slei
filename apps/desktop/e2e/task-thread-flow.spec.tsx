import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { createTaskFromChatMessage, SleiAppFrame } from "../src/app/SleiApp";
import { createSleiFixtures, type SleiMessage } from "../src/app/fixtures";
import { appendTaskReply, parseTaskCardBody, taskReplyRequiresWork } from "../src/app/model";

const readyRuntime = {
  loading: false,
  error: undefined,
  hasClaudeRuntimeReady: true,
  nodes: createSleiFixtures().nodes,
};
const tasksPageSource = () => readFileSync(new URL("../src/features/tasks/TasksPageView.tsx", import.meta.url), "utf8");
const taskThreadDrawerSource = () => readFileSync(new URL("../src/features/tasks/TaskThreadDrawer.tsx", import.meta.url), "utf8");
const chatPageSource = () => readFileSync(new URL("../src/features/chat/ChatPageView.tsx", import.meta.url), "utf8");
const sleiAppSource = () => readFileSync(new URL("../src/app/SleiApp.tsx", import.meta.url), "utf8");

describe("chat to task thread flow", () => {
  it("creates a task root from a checked chat composer message", () => {
    const message: SleiMessage = {
      id: "message_1",
      author: "Lei",
      role: "human",
      time: "10:24",
      body: "帮我把私聊任务线程做完",
      channelId: "all",
    };

    const task = createTaskFromChatMessage(message, "all");

    expect(task.id).toBe("task-message_1");
    expect(task.title).toBe("帮我把私聊任务线程做完");
    expect(task.status).toBe("pending_assignment");
    expect(task.owner).toBe("Lei");
    expect(task.creatorId).toBe("human:local");
    expect(task.replyCount).toBe(0);
    expect(task.attentionRequired).toBe(true);
    expect(task.channelId).toBe("all");
    expect(task.sourceMessageId).toBe("message_1");
    expect(task.replies).toEqual([{ id: "root-message_1", sender: "Lei", role: "human", body: "帮我把私聊任务线程做完" }]);
  });

  it("appends trimmed human and agent replies with stable per-task ids", () => {
    const tasks = [
      {
        id: "task-message_1",
        title: "帮我把私聊任务线程做完",
        owner: "Lei",
        status: "pending_assignment" as const,
        replies: [{ id: "root-message_1", sender: "Lei", role: "human" as const, body: "帮我把私聊任务线程做完" }],
      },
    ];

    const withHumanReply = appendTaskReply(tasks, "task-message_1", { sender: "Lei", role: "human", body: "  我补充一个约束  " });
    const withAgentReply = appendTaskReply(withHumanReply, "task-message_1", { sender: "Coda", role: "agent", body: "我会继续处理" });

    expect(withHumanReply[0].replyCount).toBe(2);
    expect(withAgentReply[0].replyCount).toBe(3);
    expect(withAgentReply[0].replies).toEqual([
      { id: "root-message_1", sender: "Lei", role: "human", body: "帮我把私聊任务线程做完" },
      { id: "reply-task-message_1-2", sender: "Lei", role: "human", body: "我补充一个约束" },
      { id: "reply-task-message_1-3", sender: "Coda", role: "agent", body: "我会继续处理" },
    ]);
  });

  it("parses task card messages and detects work-request replies", () => {
    expect(parseTaskCardBody("task_card:task_1:source:msg_1")).toEqual({ taskId: "task_1", sourceMessageId: "msg_1" });
    expect(parseTaskCardBody("plain comment")).toBeNull();
    expect(taskReplyRequiresWork("请继续验证")).toBe(true);
    expect(taskReplyRequiresWork("收到，先看看")).toBe(false);
  });

  it("renders a comment button and real shadcn task thread sheet trigger state", () => {
    const data = createSleiFixtures({
      tasks: [
        {
          id: "T-900",
          title: "帮我把私聊任务线程做完",
          owner: "Lei",
          status: "pending_assignment",
          channelId: "all",
          replies: [
            { id: "r1", sender: "Lei", body: "这是任务上下文" },
            { id: "r2", sender: "Coda", body: "我会继续处理" },
          ],
        },
      ],
    });

    const html = renderToStaticMarkup(
      <SleiAppFrame
        activeTaskId="T-900"
        activeView="tasks"
        data={data}
        locale="zh-CN"
        runtimeSetup={readyRuntime}
      />,
    );

    expect(html).toContain('aria-label="打开任务讨论"');
    expect(html).toContain("帮我把私聊任务线程做完");
    expect(tasksPageSource()).toContain("TaskThreadDrawer");
    expect(taskThreadDrawerSource()).toContain("@/components/ui/sheet");
    expect(taskThreadDrawerSource()).toContain("SheetContent");
    expect(tasksPageSource()).not.toContain('role="dialog"');
    expect(tasksPageSource()).toContain("lastActiveTaskId");
    expect(tasksPageSource()).toContain("activeTaskId !== lastActiveTaskId.current");
  });

  it("renders four-state task drawer controls", () => {
    const data = createSleiFixtures({
      tasks: [{
        id: "T-900",
        title: "任务分支",
        owner: "Lei",
        status: "in_review",
        channelId: "all",
        replyCount: 2,
        replies: [
          { id: "root", sender: "Lei", role: "human", body: "根消息" },
          { id: "reply", sender: "Coda", role: "agent", body: "结果" },
        ],
      }],
    });
    const html = renderToStaticMarkup(<SleiAppFrame activeTaskId="T-900" activeView="tasks" data={data} locale="zh-CN" runtimeSetup={readyRuntime} />);
    expect(html).toContain("待评审");
    expect(html).toContain("标记已完成");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>标记已完成/);
    expect(html).toContain("2 条回复");
  });

  it("keeps task drawer async errors and thread-open rejections handled in source", () => {
    const drawerSource = taskThreadDrawerSource();

    expect(drawerSource).toContain("replySubmitting");
    expect(drawerSource).toContain("statusSubmitting");
    expect(drawerSource).toContain("replyError");
    expect(drawerSource).toContain("statusError");
    expect(drawerSource).toContain("catch (error)");
    expect(drawerSource).toContain("setReplyDraft(\"\")");
    expect(drawerSource).toContain("disabled={replySubmitting");
    expect(drawerSource).toContain("disabled={statusActionDisabled}");
    expect(drawerSource).toContain("useEffect");
    expect(drawerSource).toContain("[input.open, task?.id]");
    expect(drawerSource).toContain("replySubmitting || statusSubmitting");
    expect(drawerSource).toContain("isDrawerOperationCurrent");
    const chatSource = chatPageSource();
    expect(chatSource).toContain(".catch(() => undefined)");
    expect(chatSource).toContain("loadedTaskThreadIdRef");
    expect(chatSource).toContain("[selectedTask?.id, onTaskThreadOpen]");
    expect(tasksPageSource()).toContain(".catch(() => undefined)");
    const appSource = sleiAppSource();
    expect(appSource).not.toMatch(/import\s*\{[^}]*appendTaskReply/);
    expect(appSource).toContain("const threadReceipt = await bridge.getTaskThread(taskId)");
    expect(appSource).toContain("task-agent-handoff-root-fallback");
    expect(appSource).toContain("refreshTasks(activeChannelId).catch");
  });
});
