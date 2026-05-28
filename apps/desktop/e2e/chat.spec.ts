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
    expect(html).toContain("Message #dev-team");
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
});
