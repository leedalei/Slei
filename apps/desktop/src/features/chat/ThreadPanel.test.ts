import { describe, expect, it } from "vitest";

import { renderTaskRootCard } from "./TaskRootCard";
import { renderThreadPanel } from "./ThreadPanel";

describe("task thread panel", () => {
  it("renders task root card with reply count and unread state", () => {
    const card = renderTaskRootCard({
      title: "帮我调研",
      status: "In Progress",
      replyCount: 10,
      unread: true,
      assignee: "@Alice",
    });

    expect(card).toContain("帮我调研");
    expect(card).toContain("10 replies");
    expect(card).toContain("unread");
    expect(card).toContain("@Alice");
  });

  it("keeps replies attached to the selected task thread", () => {
    const panel = renderThreadPanel({
      channelName: "dev-team",
      taskTitle: "帮我调研",
      replies: [
        { sender: "Coda", body: "收到" },
        { sender: "lei lee", body: "补充一下" },
      ],
    });

    expect(panel).toContain("Thread — #dev-team");
    expect(panel).toContain("帮我调研");
    expect(panel).toContain("Coda 收到");
    expect(panel).toContain("lei lee 补充一下");
  });
});
