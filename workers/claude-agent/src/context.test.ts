import { describe, expect, it } from "vitest";

import { assembleContext, buildClaudeQuery } from "./context.js";

const records = [
  {
    channel_id: "channel_dev",
    task_id: null,
    agent_id: "agent_coda",
    role: "user",
    content: "channel message",
    deleted: false,
  },
  {
    channel_id: "channel_dev",
    task_id: "task_1",
    agent_id: "agent_coda",
    role: "assistant",
    content: "task reply",
    deleted: false,
  },
  {
    channel_id: "channel_dev",
    task_id: "task_1",
    agent_id: "agent_alice",
    role: "assistant",
    content: "delegated reply",
    deleted: false,
  },
  {
    channel_id: "channel_dev",
    task_id: "task_1",
    agent_id: "agent_coda",
    role: "user",
    content: "SENTINEL_DELETED_MESSAGE",
    deleted: true,
  },
] as const;

describe("Claude context reconstruction", () => {
  it("scopes channel context by channel and agent", () => {
    const context = assembleContext(
      { channelId: "channel_dev", agentId: "agent_coda" },
      records,
    );

    expect(context.map((message) => message.content)).toEqual([
      "channel message",
    ]);
  });

  it("scopes task reply context by task and agent", () => {
    const context = assembleContext(
      { taskId: "task_1", agentId: "agent_coda" },
      records,
    );

    expect(context.map((message) => message.content)).toEqual(["task reply"]);
  });

  it("assembles delegated agent context independently", () => {
    const context = assembleContext(
      { taskId: "task_1", agentId: "agent_alice" },
      records,
    );

    expect(context.map((message) => message.content)).toEqual([
      "delegated reply",
    ]);
  });

  it("always disables Claude persistence and emits no resume token", () => {
    const query = buildClaudeQuery({
      prompt: "Continue",
      cwd: "/workspace/app",
      additionalDirectories: ["/workspace/shared"],
      context: [{ role: "user", content: "safe context" }],
    });

    expect(query.options.persistSession).toBe(false);
    expect(query.options.cwd).toBe("/workspace/app");
    expect(query.options.additionalDirectories).toEqual(["/workspace/shared"]);
    expect(JSON.stringify(query)).not.toContain("resume");
  });
});
