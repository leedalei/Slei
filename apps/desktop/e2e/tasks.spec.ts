import { describe, expect, it } from "vitest";

import { renderTaskRootCard } from "../src/features/chat/TaskRootCard";
import { renderThreadPanel } from "../src/features/chat/ThreadPanel";
import { renderTasksPage } from "../src/features/tasks/TasksPage";

describe("global task board and list", () => {
  const tasks = [
    {
      id: "task_1",
      sequence: 3,
      channelName: "dev-team",
      creator: "lei lee",
      assignee: "Alice",
      title: "帮我调研下怎么实现这个功能？",
      status: "in_progress" as const,
      attentionRequired: true,
    },
    {
      id: "task_2",
      sequence: 2,
      channelName: "AI咨询",
      creator: "lei lee",
      assignee: "Coda",
      title: "关于 harness 工程，最近有什么比较好的实践",
      status: "in_review" as const,
      attentionRequired: false,
    },
    {
      id: "task_3",
      sequence: 1,
      channelName: "AI咨询",
      creator: "Nancy",
      assignee: "Nancy",
      title: "整理一下这周 AI 领域的重要动态",
      status: "done" as const,
      attentionRequired: false,
    },
  ];

  it("renders board columns, filters, list rows and accessible status actions", () => {
    const html = renderTasksPage({
      locale: "zh-CN",
      view: "board",
      filters: { channel: "CHANNEL", creator: "CREATOR", assignee: "ASSIGNEE" },
      tasks,
    });

    expect(html).toContain("任务");
    expect(html).toContain("CHANNEL");
    expect(html).toContain("CREATOR");
    expect(html).toContain("ASSIGNEE");
    expect(html).toContain("PENDING ASSIGNMENT 0");
    expect(html).toContain("IN PROGRESS 1");
    expect(html).toContain("IN REVIEW 1");
    expect(html).toContain("DONE 1");
    expect(html).toContain("#dev-team #3");
    expect(html).toContain("需要用户关注");
    expect(html).toContain("Set status: In review");

    const list = renderTasksPage({
      locale: "zh-CN",
      view: "list",
      filters: { channel: "AI咨询" },
      tasks,
    });
    expect(list).toContain("列表");
    expect(list).toContain("关于 harness 工程");
    expect(list).toContain("整理一下这周 AI 领域的重要动态");
  });

  it("keeps task status visible in chat cards and thread context", () => {
    const card = renderTaskRootCard({
      title: "帮我调研下怎么实现这个功能？",
      status: "In Review",
      replyCount: 10,
      unread: true,
      assignee: "Alice",
    });
    const thread = renderThreadPanel({
      channelName: "dev-team",
      taskTitle: "帮我调研下怎么实现这个功能？",
      status: "In Review",
      replies: [{ sender: "Alice", body: "已经扫了实现路径" }],
    });

    expect(card).toContain("In Review");
    expect(thread).toContain("In Review");
  });
});
