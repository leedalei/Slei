import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SleiAppFrame } from "../src/app/SleiApp";
import { createSleiFixtures } from "../src/app/fixtures";

const readyRuntime = {
  loading: false,
  error: undefined,
  hasClaudeRuntimeReady: true,
  nodes: createSleiFixtures().nodes,
};

describe("task branch sessions", () => {
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
            },
          ],
        })}
        locale="zh-CN"
        runtimeSetup={readyRuntime}
      />,
    );
    expect(html).toContain("实现任务分支");
    expect(html).toContain("0 条回复");
    expect(html).toContain("待指派");
    expect(html).toContain("data-task-root-entry");
    expect(html).not.toContain('data-message-id="msg_root"');
  });
});
