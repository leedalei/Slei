import { describe, expect, it } from "vitest";

import { renderChatPage } from "../src/features/chat/ChatPage";
import { sanitizeMarkdown } from "../src/lib/markdown";
import { mentionSuggestions } from "../src/lib/mentions";

describe("channel chat timeline", () => {
  it("renders flat timeline rows, streaming text, collapsed tools and composer mentions", () => {
    const html = renderChatPage({
      locale: "zh-CN",
      channel: { name: "dev-team" },
      messages: [
        { sender: "lei lee", body: "请看这个", streaming: false, toolCalls: [] },
        {
          sender: "Coda",
          body: "收到，正在处理",
          streaming: true,
          toolCalls: [{ name: "Read", status: "collapsed" }],
        },
      ],
      composer: { asTask: false },
      lastSequence: 7,
    });

    expect(html).toContain("#dev-team");
    expect(html).toContain("lei lee");
    expect(html).toContain("Coda");
    expect(html).toContain("正在输入");
    expect(html).toContain("Tool: Read collapsed");
    expect(html).toContain("输入消息到 #dev-team");
    expect(html).toContain("reconnect after 7");
  });

  it("sanitizes markdown links and suggests mention targets", () => {
    expect(sanitizeMarkdown("[bad](javascript:alert(1)) [file](file:///etc/passwd) [ok](https://slei.ai)")).toBe(
      "[bad](#blocked) [file](#blocked) [ok](https://slei.ai)",
    );
    expect(
      mentionSuggestions("@al", [
        { displayName: "Alice", handle: "alice", kind: "agent" },
        { displayName: "Lei Lee", handle: "lei-lee", kind: "human" },
      ]),
    ).toEqual([{ displayName: "Alice", handle: "alice", kind: "agent" }]);
  });

  it("renders task composer state from chat input data", () => {
    const html = renderChatPage({
      locale: "zh-CN",
      channel: { name: "dev-team" },
      messages: [],
      composer: { asTask: true },
      lastSequence: 8,
    });

    expect(html).toContain("输入消息到 #dev-team");
    expect(html).toContain("转为任务 checked");
    expect(html).toContain("reconnect after 8");
  });

  it("renders active channel chat semantics from input data", () => {
    const html = renderChatPage({
      locale: "zh-CN",
      channel: { name: "ops" },
      messages: [{ sender: "Coda", body: "值班频道消息", streaming: false, toolCalls: [] }],
      composer: { asTask: false },
      lastSequence: 9,
    });

    expect(html).toContain("#ops");
    expect(html).toContain("值班频道消息");
    expect(html).toContain("输入消息到 #ops");
    expect(html).toContain("转为任务");
    expect(html).toContain("reconnect after 9");
  });
});
