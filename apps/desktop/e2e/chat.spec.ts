import { readFileSync } from "node:fs";
import { join } from "node:path";
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

  it("styles chat messages as flat rows until hover or focus", () => {
    const css = readFileSync(join(process.cwd(), "src/app/app.css"), "utf8");
    const messageRule = css.match(/\.slei-message\s*\{(?<body>[^}]+)\}/)?.groups?.body ?? "";

    expect(messageRule).toContain("border: var(--border-subtle) solid transparent");
    expect(messageRule).not.toMatch(/(^|\n)\s*box-shadow:/);
    expect(css).toContain(".slei-message:hover");
    expect(css).toContain(".slei-message:focus-within");
  });

  it("keeps chat scrolling inside the timeline instead of the whole workspace", () => {
    const css = readFileSync(join(process.cwd(), "src/app/app.css"), "utf8");
    const rootRule = css.match(/html,\s*\nbody,\s*\n#app\s*\{(?<body>[^}]+)\}/)?.groups?.body ?? "";
    const shellRule = css.match(/\.slei-shell\s*\{(?<body>[^}]+)\}/)?.groups?.body ?? "";
    const workspaceRule = css.match(/\.slei-workspace\s*\{(?<body>[^}]+)\}/)?.groups?.body ?? "";
    const chatPageRule = css.match(/\.slei-chat-page\s*\{(?<body>[^}]+)\}/)?.groups?.body ?? "";
    const timelineRule = css.match(/\.slei-timeline\s*\{(?<body>[^}]+)\}/)?.groups?.body ?? "";
    const composerRule = css.match(/\.slei-composer\s*\{(?<body>[^}]+)\}/)?.groups?.body ?? "";
    const modalBackdropRule = css.match(/\.slei-modal-backdrop\s*\{(?<body>[^}]+)\}/)?.groups?.body ?? "";
    const drawerRule = css.match(/\.slei-task-thread-drawer\s*\{(?<body>[^}]+)\}/)?.groups?.body ?? "";

    expect(rootRule).toContain("height: 100%");
    expect(rootRule).toContain("overflow: hidden");
    expect(rootRule).toContain("background: transparent");
    expect(shellRule).toContain("--app-window-radius: 14px");
    expect(shellRule).toContain("border-radius: var(--app-window-radius)");
    expect(shellRule).toContain("min-height: 0");
    expect(shellRule).toContain("overflow: hidden");
    expect(workspaceRule).toContain("min-height: 0");
    expect(workspaceRule).toContain("overflow: hidden");
    expect(chatPageRule).toContain("display: flex");
    expect(chatPageRule).toContain("flex-direction: column");
    expect(chatPageRule).toContain("height: 100%");
    expect(chatPageRule).toContain("min-height: 0");
    expect(chatPageRule).toContain("overflow: hidden");
    expect(timelineRule).toContain("flex: 1 1 auto");
    expect(timelineRule).toContain("min-height: 0");
    expect(timelineRule).toContain("overflow-y: auto");
    expect(timelineRule).toContain("padding: var(--gap-xl) var(--padding-panel)");
    expect(composerRule).toContain("flex: 0 0 auto");
    expect(composerRule).toContain("padding: var(--padding-panel)");
    expect(modalBackdropRule).toContain("border-radius: var(--app-window-radius)");
    expect(modalBackdropRule).toContain("overflow: hidden");
    expect(drawerRule).toContain("border-radius: 0 var(--app-window-radius) var(--app-window-radius) 0");
  });
});
