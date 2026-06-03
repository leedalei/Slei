import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  activeMentionQuery,
  filterConversationMessages,
  insertMention,
  moveMentionSelection,
  SleiAppFrame,
} from "../src/app/SleiApp";
import { createDemoMembers, createSleiFixtures } from "../src/app/fixtures";

const readyRuntime = {
  loading: false,
  error: undefined,
  hasClaudeRuntimeReady: true,
  nodes: createSleiFixtures().nodes,
};

describe("chat search, channel management, and mentions", () => {
  it("filters conversation messages by user, channel, and time", () => {
    const data = createSleiFixtures({
      messages: [
        { id: "m1", author: "Lei", handle: "@lei", role: "human", time: "09:42", body: "all channel", channelId: "all" },
        { id: "m2", author: "Coda", handle: "@Coda", role: "agent", time: "10:15", body: "dev channel", channelId: "dev-team" },
      ],
    });

    expect(filterConversationMessages(data.messages, { user: "coda" }).map((message) => message.id)).toEqual(["m2"]);
    expect(filterConversationMessages(data.messages, { channel: "all" }).map((message) => message.id)).toEqual(["m1"]);
    expect(filterConversationMessages(data.messages, { time: "10:15" }).map((message) => message.id)).toEqual(["m2"]);
  });

  it("keeps search stable when runtime messages have missing text fields", () => {
    const messages = [
      { id: "m1", author: "Lei", handle: "@lei", role: "human", time: "09:42", body: "all channel", channelId: "all" },
      { id: "m2", author: { name: "Coda" }, handle: undefined, role: "agent", time: 1717040400000, body: { text: "runtime payload" }, channelId: { id: "dm:agent_coda" } },
    ] as unknown as ReturnType<typeof createSleiFixtures>["messages"];

    expect(() => filterConversationMessages(messages, { query: "all" })).not.toThrow();
    expect(filterConversationMessages(messages, { query: "all" }).map((message) => message.id)).toEqual(["m1"]);
    expect(() =>
      renderToStaticMarkup(
        <SleiAppFrame
          activeView="search"
          data={createSleiFixtures({ messages })}
          initialSearchFilters={{ query: "all" }}
          locale="zh-CN"
          runtimeSetup={readyRuntime}
        />,
      ),
    ).not.toThrow();
    expect(() =>
      renderToStaticMarkup(
        <SleiAppFrame
          activeView="search"
          data={createSleiFixtures({ messages })}
          locale="zh-CN"
          runtimeSetup={readyRuntime}
        />,
      ),
    ).not.toThrow();
    expect(() =>
      renderToStaticMarkup(
        <SleiAppFrame
          activeView="search"
          data={createSleiFixtures({ messages })}
          initialSearchFilters={{ query: "object" }}
          locale="zh-CN"
          runtimeSetup={readyRuntime}
        />,
      ),
    ).not.toThrow();
  });

  it("renders screenshot-aligned sidebar search and channel management controls", () => {
    const data = createSleiFixtures({
      channels: [
        { id: "all", name: "all", description: "General channel for all members", unread: 0 },
        { id: "dev-team", name: "dev-team", description: "研发频道", unread: 0, projectName: "Slei Desktop" },
      ],
    });

    const html = renderToStaticMarkup(
      <SleiAppFrame
        activeView="chat"
        activeChannelId="dev-team"
        data={data}
        locale="zh-CN"
        runtimeSetup={readyRuntime}
      />,
    );

    expect(html).toContain("搜索");
    expect(html).toContain("已保存");
    expect(html).not.toContain("Activity");
    expect(html).toContain("频道 2");
    expect(html).toContain("创建频道");
    expect(html).toContain("Slei Desktop");
    expect(html).toContain("删除频道 dev-team");
    expect(html).not.toContain("删除频道 all");
  });

  it("renders a dedicated search page with filters and result links back to conversations", () => {
    const data = createSleiFixtures({
      channels: [
        { id: "all", name: "all", description: "所有成员的默认频道", unread: 0 },
        { id: "dev-team", name: "dev-team", description: "研发频道", unread: 0, projectName: "Slei Desktop" },
      ],
      messages: [
        { id: "m1", author: "Lei", handle: "@lei", role: "human", time: "09:42", body: "默认频道消息", channelId: "all" },
        { id: "m2", author: "Coda", handle: "@Coda", role: "agent", time: "10:15", body: "dev channel result", channelId: "dev-team" },
      ],
    });

    const html = renderToStaticMarkup(
      <SleiAppFrame
        activeView="search"
        data={data}
        initialSearchFilters={{ user: "coda", channel: "dev-team", time: "10:15" }}
        locale="zh-CN"
        runtimeSetup={readyRuntime}
      />,
    );

    expect(html).toContain("slei-search-page");
    expect(html).toContain("搜索会话");
    expect(html).toContain("用户");
    expect(html).toContain("频道");
    expect(html).toContain("时间");
    expect(html).toContain("dev channel result");
    expect(html).toContain("打开会话 m2");
    expect(html).toContain("# dev-team");
    expect(html).not.toContain("默认频道消息");
  });

  it("renders channel creation as a modal dialog instead of an inline form", () => {
    const html = renderToStaticMarkup(
      <SleiAppFrame
        activeView="chat"
        data={createSleiFixtures({ members: createDemoMembers() })}
        initialCreateChannelModalOpen
        locale="zh-CN"
        runtimeSetup={readyRuntime}
      />,
    );

    expect(html).toContain("slei-channel-modal");
    expect(html).toContain('role="dialog"');
    expect(html).toContain("创建频道");
    expect(html).toContain("频道名称");
    expect(html).toContain("关联项目");
    expect(html).toContain("取消");
    expect(html).not.toContain("slei-channel-form");
  });

  it("detects, navigates, and inserts composer mention selections", () => {
    expect(activeMentionQuery("帮我问 @co")).toEqual({ query: "co", start: 4, end: 7 });
    expect(activeMentionQuery("email a@b.com")).toBeNull();
    expect(moveMentionSelection(0, 1, 3)).toBe(1);
    expect(moveMentionSelection(0, -1, 3)).toBe(2);
    expect(insertMention("帮我问 @co", { query: "co", start: 4, end: 7 }, "@Coda")).toBe("帮我问 @Coda ");
  });

  it("renders a full-width member picker above the composer when @ is active", () => {
    const html = renderToStaticMarkup(
      <SleiAppFrame
        activeView="chat"
        data={createSleiFixtures({ members: createDemoMembers() })}
        initialChatDraft="请 @co"
        locale="zh-CN"
        runtimeSetup={readyRuntime}
      />,
    );

    expect(html).toContain("slei-mention-panel");
    expect(html).toContain("Coda");
    expect(html).toContain("@Coda");
    expect(html).toContain("回到底部");
    expect(html).toContain("转为任务");
  });

  it("lists only current real members for an empty @ mention query", () => {
    const data = createSleiFixtures({ members: createDemoMembers() });
    const html = renderToStaticMarkup(
      <SleiAppFrame
        activeView="chat"
        data={data}
        initialChatDraft="@"
        locale="zh-CN"
        runtimeSetup={readyRuntime}
      />,
    );

    for (const member of data.members) {
      expect(html).toContain(member.name);
      expect(html).toContain(member.handle);
    }
    expect(html).not.toContain("Nancy");
    expect(html).not.toContain("Jack");
  });

  it("uses lucide-react icons instead of raw glyph placeholders for controls", () => {
    const html = renderToStaticMarkup(
      <SleiAppFrame
        activeView="chat"
        data={createSleiFixtures({
          members: createDemoMembers(),
          channels: [
            { id: "all", name: "all", description: "所有成员的默认频道", unread: 0 },
            { id: "dev-team", name: "dev-team", description: "研发频道", unread: 0 },
          ],
        })}
        initialChatDraft="请 @co"
        locale="zh-CN"
        runtimeSetup={readyRuntime}
      />,
    );

    expect(html).toContain("lucide-search");
    expect(html).toContain("lucide-trash-2");
    expect(html).toContain("lucide-at-sign");
    expect(html).not.toContain("⌕");
    expect(html).not.toContain("⌘");
    expect(html).not.toContain("⌫");
    expect(html).not.toContain("↕");
    expect(html).not.toContain("▱");
    expect(html).not.toContain("[]");
  });

  it("centers far-left rail lucide icons in system-style buttons", () => {
    const css = readFileSync(join(process.cwd(), "src/app/app.css"), "utf8");
    const buttonRule = css.match(/\.slei-rail__button\s*\{(?<body>[^}]+)\}/)?.groups?.body ?? "";

    expect(buttonRule).toContain("align-items: center");
    expect(buttonRule).toContain("justify-content: center");
    expect(buttonRule).toContain("height: 48px");
    expect(buttonRule).toContain("width: 48px");
    expect(buttonRule).not.toContain("flex-direction: column");
  });
});
