import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { createTaskFromChatMessage, SleiAppFrame } from "../src/app/SleiApp";
import { createSleiFixtures, type SleiMessage } from "../src/test/fixtures";
import { appendTaskReply, parseTaskCardBody, taskReplyRequiresWork } from "../src/app/model";
import { TaskThreadDrawer } from "../src/features/tasks/TaskThreadDrawer";
import { createDesktopMessages } from "../src/i18n";

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
    expect(html).toContain('aria-label="变更任务状态"');
    expect(html).toContain("已完成");
    expect(html).not.toContain("标记已完成");
    expect(html).toContain('data-slot="task-status-divider"');
    expect(html).not.toContain("Lei - 2 条回复");
  });

  it("renders task reply mention suggestions without coordinator targets", () => {
    const data = createSleiFixtures({
      members: [
        {
          id: "agent_coda",
          name: "Coda",
          handle: "@coda",
          avatar: "CO",
          type: "agent",
          runtimeStatus: "idle",
          role: "开发 Agent",
          description: "负责实现。",
          computer: "Local",
          created: "2026-06-11",
          creator: "Lei",
          runtime: "ClaudeCode",
          model: "Sonnet",
          instructions: "",
          permissions: [],
          environmentVariables: [],
          createdAgents: [],
          activity: "Idle",
          capabilities: [],
        },
        {
          id: "agent_reviewer",
          name: "Reviewer",
          handle: "@reviewer",
          avatar: "RE",
          agentKind: "agent",
          type: "agent",
          runtimeStatus: "idle",
          role: "Reviewer",
          description: "Reviews task handoffs.",
          computer: "Local",
          created: "2026-06-11",
          creator: "System",
          runtime: "ClaudeCode",
          model: "Sonnet",
          instructions: "",
          permissions: [],
          environmentVariables: [],
          createdAgents: [],
          activity: "Idle",
          capabilities: [],
        },
      ],
      tasks: [{
        id: "T-mention",
        title: "任务 mention",
        owner: "Lei",
        status: "in_progress",
        channelId: "all",
        replies: [{ id: "root", sender: "Lei", role: "human", body: "根消息" }],
      }],
    });

    const html = renderToStaticMarkup(
      <TaskThreadDrawer
        initialReplyDraft="@"
        mentionMembers={data.members}
        messages={createDesktopMessages("zh-CN")}
        onClose={() => undefined}
        onReply={() => undefined}
        open
        task={data.tasks[0]}
      />,
    );

    expect(html).toContain('data-testid="slei-mention-panel"');
    expect(html).toContain("Coda");
    expect(html).toContain("@coda");
    expect(html).not.toContain("@all-coordinator");
    expect(html).not.toContain("标记待评审");
  });

  it("renders the task drawer root content as message-sized markdown", () => {
    const data = createSleiFixtures({
      tasks: [{
        id: "T-title",
        title: "## 感谢欢迎\n\n- agent_guide\n- `inlineCode`",
        owner: "Theo",
        status: "in_progress",
        channelId: "all",
        replyCount: 0,
        replies: [{ id: "root", sender: "Theo", role: "agent", body: "根消息" }],
      }],
    });

    const html = renderToStaticMarkup(
      <TaskThreadDrawer
        messages={createDesktopMessages("zh-CN")}
        onClose={() => undefined}
        open
        task={data.tasks[0]}
      />,
    );

    const titleMatch = html.match(/<h2[^>]*data-slot="sheet-title"[^>]*class="([^"]*)"[^>]*>/);
    const rootMatch = html.match(/<div[^>]*(?:data-slot="task-thread-root-body"[^>]*class="([^"]*)"|class="([^"]*)"[^>]*data-slot="task-thread-root-body")[^>]*>/);
    const rootClasses = rootMatch?.[1] ?? rootMatch?.[2] ?? "";
    const scrollContentMatch = html.match(/<div[^>]*(?:data-slot="task-thread-scroll-content"[^>]*class="([^"]*)"|class="([^"]*)"[^>]*data-slot="task-thread-scroll-content")[^>]*>/);
    const scrollContentClasses = scrollContentMatch?.[1] ?? scrollContentMatch?.[2];
    const headerStart = html.indexOf('data-slot="sheet-header"');
    const scrollStart = html.indexOf('data-slot="scroll-area"');
    const rootStart = html.indexOf('data-slot="task-thread-root-body"');
    const footerStart = html.indexOf('data-slot="sheet-footer"');
    const firstReplyStart = html.indexOf("data-reply-role", rootStart);
    const rootEnd = firstReplyStart > -1 ? firstReplyStart : footerStart;
    const rootHtml = html.slice(rootStart, rootEnd);

    expect(titleMatch?.[1]).toContain("sr-only");
    expect(rootClasses).not.toContain("mb-32");
    expect(scrollContentClasses).toContain("pb-36");
    expect(headerStart).toBeGreaterThanOrEqual(0);
    expect(scrollStart).toBeGreaterThan(headerStart);
    expect(rootStart).toBeGreaterThanOrEqual(0);
    expect(rootStart).toBeGreaterThan(scrollStart);
    expect(rootStart).toBeLessThan(footerStart);
    expect(rootEnd).toBeGreaterThan(rootStart);
    expect(rootHtml).toContain("slei-markdown-message");
    expect(rootHtml).toContain("text-sm");
    expect(rootHtml).toContain("slei-task-title-markdown");
    expect(rootHtml).toContain("leading-snug");
    expect(rootHtml).toContain("<h2>感谢欢迎</h2>");
    expect(rootHtml).toContain("<li>agent_guide</li>");
    expect(rootHtml).toContain("<code");
    expect(rootHtml).toContain("inlineCode");
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
    expect(drawerSource).toContain("[input.open, input.initialReplyDraft, task?.id]");
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
    expect(appSource).toContain("appendTaskReplyReceiptToState(taskId, receipt.reply)");
    expect(appSource).toContain("thread-refresh-failed-after-reply");
    expect(appSource).toContain('"task-agent-reply", "delegated-to-daemon"');
    expect(appSource).toContain("refreshTasks(activeChannelId).catch");
  });
});
