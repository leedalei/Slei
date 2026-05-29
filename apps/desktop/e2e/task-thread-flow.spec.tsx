import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { createTaskFromChatMessage, SleiAppFrame } from "../src/app/SleiApp";
import { createSleiFixtures, type SleiMessage } from "../src/app/fixtures";

const readyRuntime = {
  loading: false,
  error: undefined,
  hasClaudeRuntimeReady: true,
  nodes: createSleiFixtures().nodes,
};

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

    expect(task.title).toBe("帮我把私聊任务线程做完");
    expect(task.status).toBe("todo");
    expect(task.owner).toBe("Lei");
    expect(task.channelId).toBe("all");
    expect(task.sourceMessageId).toBe("message_1");
    expect(task.replies).toEqual([{ id: "root-message_1", sender: "Lei", body: "帮我把私聊任务线程做完" }]);
  });

  it("renders a comment button and a 680px task thread drawer with replies", () => {
    const data = createSleiFixtures({
      tasks: [
        {
          id: "T-900",
          title: "帮我把私聊任务线程做完",
          owner: "Lei",
          status: "todo",
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
    expect(html).toContain("slei-task-thread-drawer");
    expect(html).toContain("--task-thread-width:680px");
    expect(html).toContain("帮我把私聊任务线程做完");
    expect(html).toContain("这是任务上下文");
    expect(html).toContain("我会继续处理");
    expect(html).toContain("回复任务线程");
  });
});
