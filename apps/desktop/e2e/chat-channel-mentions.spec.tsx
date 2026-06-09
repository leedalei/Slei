import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import {
  activeMentionQuery,
  channelDraftCreateInput,
  resetChannelDraft,
  submitChannelDraftWithFeedback,
  toggleChannelDraftAgent,
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
const searchPageSource = () => readFileSync(new URL("../src/features/search/SearchPageView.tsx", import.meta.url), "utf8");
const appFrameSource = () => readFileSync(new URL("../src/app/SleiAppFrame.tsx", import.meta.url), "utf8");

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

    expect(html).toContain('aria-label="搜索会话"');
    expect(html).toContain('data-slot="card"');
    expect(html).toContain('data-slot="input"');
    expect(html).toContain("搜索会话");
    expect(html).toContain("用户");
    expect(html).toContain("频道");
    expect(html).toContain("时间");
    expect(html).toContain("dev channel result");
    expect(html).toContain("打开会话 m2");
    expect(html).toContain("# dev-team");
    expect(html).not.toContain("默认频道消息");
    expect(searchPageSource()).toContain("stableSearchFiltersKey");
    expect(searchPageSource()).toContain("normalizeSearchFilters");
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

    expect(html).toContain('data-slot="dialog-content"');
    expect(html).toContain('role="dialog"');
    expect(html).toContain("创建频道");
    expect(html).toContain("频道名称");
    expect(html).toContain('aria-hidden="true" class="text-destructive">*</span>');
    expect(html).toContain('placeholder="请输入"');
    expect(html).toContain("关联项目");
    expect(html).toContain("取消");
    expect(html).not.toContain("slei-channel-form");
  });

  it("select agents in the create channel modal with readiness copy", () => {
    const html = renderToStaticMarkup(
      <SleiAppFrame
        activeView="chat"
        data={createSleiFixtures({ members: createDemoMembers() })}
        initialCreateChannelModalOpen
        locale="zh-CN"
        runtimeSetup={readyRuntime}
      />,
    );

    expect(html).toContain("选择 Agent");
    expect(html).toContain("@Coda");
    expect(html).toContain("@alice");
    expect(html).toContain("记忆同步中");
    expect(html).not.toContain("@lei");
  });

  it("resets canceled create channel agent selections before the next submit", () => {
    const canceledDraft = toggleChannelDraftAgent(
      { name: "old-dev", projectName: "Old Project", projectPaths: [], selectedAgentIds: [] },
      "a1",
    );
    const reopenedDraft = { ...resetChannelDraft(), name: "new-dev", projectPaths: ["/Users/lei/Slei", "/Users/lei/Website"] };

    expect(canceledDraft.selectedAgentIds).toEqual(["a1"]);
    expect(channelDraftCreateInput(reopenedDraft)).toEqual({
      name: "new-dev",
      projectName: "/Users/lei/Slei, /Users/lei/Website",
      projectPaths: ["/Users/lei/Slei", "/Users/lei/Website"],
      agentIds: [],
    });
  });

  it("keeps the channel draft and surfaces toast feedback when channel creation fails", async () => {
    const toasts: string[] = [];
    const draft = { name: "new-dev", projectName: "Slei Desktop", projectPaths: [], selectedAgentIds: ["agent_coda"] };

    const result = await submitChannelDraftWithFeedback({
      draft,
      createFailedMessage: "创建频道失败",
      createPartialFailureMessage: "频道已创建，但后续设置失败",
      channelNameRequiredMessage: "频道名称不能为空",
      onCreateFailure: (message) => toasts.push(message),
      onChannelCreate: async () => {
        throw new Error("daemon request failed: 400 Bad Request: invalid selected agent");
      },
    });

    expect(result).toEqual({ created: false, draft });
    expect(toasts).toEqual(["创建频道失败：daemon request failed: 400 Bad Request: invalid selected agent"]);
  });

  it("surfaces channel name validation feedback before calling create", async () => {
    const toasts: string[] = [];
    const create = vi.fn();

    const result = await submitChannelDraftWithFeedback({
      draft: { ...resetChannelDraft(), name: " # " },
      createFailedMessage: "创建频道失败",
      createPartialFailureMessage: "频道已创建，但后续设置失败",
      channelNameRequiredMessage: "频道名称不能为空",
      onCreateFailure: (message, type) => toasts.push(`${type}:${message}`),
      onChannelCreate: create,
    });

    expect(result.created).toBe(false);
    expect(create).not.toHaveBeenCalled();
    expect(toasts).toEqual(["error:频道名称不能为空"]);
  });

  it("refreshes channels and reports success after channel creation", async () => {
    const toasts: string[] = [];
    const logs: string[] = [];

    const result = await submitChannelDraftWithFeedback({
      draft: { ...resetChannelDraft(), name: "new-dev" },
      createFailedMessage: "创建频道失败",
      createPartialFailureMessage: "频道已创建，但后续设置失败",
      channelNameRequiredMessage: "频道名称不能为空",
      onCreateSuccess: (message) => toasts.push(message),
      createdMessage: "频道已创建，成员正在加入",
      onChannelCreate: async () => ({ channel: { id: "new-dev", name: "new-dev", description: "Slei", projectPaths: [] } }),
      onChannelRefresh: async () => [{ id: "all", name: "all", description: "默认频道", unread: 0 }, { id: "new-dev", name: "new-dev", description: "Slei", unread: 0 }],
      onLog: (message) => logs.push(message),
    });

    expect(result.created).toBe(true);
    expect(result.channelId).toBe("new-dev");
    expect(result.channels?.map((channel) => channel.id)).toEqual(["all", "new-dev"]);
    expect(toasts).toEqual(["频道已创建，成员正在加入"]);
    expect(logs).toEqual(["submit", "request-start", "request-success", "refresh-start", "refresh-success"]);
  });

  it("uses refreshed channels as partial success when create throws after daemon persisted the channel", async () => {
    const toasts: string[] = [];
    const logs: string[] = [];

    const result = await submitChannelDraftWithFeedback({
      draft: { ...resetChannelDraft(), name: "new-dev" },
      createFailedMessage: "创建频道失败",
      createPartialFailureMessage: "频道已创建，但后续设置失败",
      channelNameRequiredMessage: "频道名称不能为空",
      onCreateFailure: (message) => toasts.push(message),
      onChannelCreate: async () => {
        throw new Error("daemon request failed: 500 Internal Server Error: coordinator failed");
      },
      onChannelRefresh: async () => [{ id: "all", name: "all", description: "默认频道", unread: 0 }, { id: "new-dev", name: "new-dev", description: "Slei", unread: 0 }],
      onLog: (message) => logs.push(message),
    });

    expect(result.created).toBe(true);
    expect("partialFailure" in result ? result.partialFailure : undefined).toBe("daemon request failed: 500 Internal Server Error: coordinator failed");
    expect(result.channelId).toBe("new-dev");
    expect(toasts).toEqual(["频道已创建，但后续设置失败：daemon request failed: 500 Internal Server Error: coordinator failed"]);
    expect(logs).toEqual(["submit", "request-start", "request-failed", "refresh-start", "refresh-success"]);
  });

  it("renders channel project selection as a repeatable folder picker", () => {
    const html = renderToStaticMarkup(
      <SleiAppFrame
        activeView="chat"
        data={createSleiFixtures({ members: createDemoMembers() })}
        initialCreateChannelModalOpen
        locale="zh-CN"
        runtimeSetup={readyRuntime}
      />,
    );

    expect(html).toContain("选择项目文件夹");
    expect(html).toContain('type="file"');
    expect(html).toContain("webkitdirectory");
    expect(html).toContain("可关联多个项目文件夹");
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

    expect(html).toContain('data-testid="slei-mention-panel"');
    const mentionPanelTag = html.match(/<div\b(?=[^>]*data-testid="slei-mention-panel")[^>]*>/)?.[0] ?? "";
    expect(mentionPanelTag).toContain("max-h-[12.5rem]");
    expect(mentionPanelTag).toContain("overflow-hidden");
    const mentionPanelHtml = html.slice(html.indexOf('data-testid="slei-mention-panel"'));
    expect(mentionPanelHtml).toContain('data-slot="scroll-area"');
    expect(mentionPanelHtml).toContain("max-h-[10.5rem]");
    expect(mentionPanelHtml).toContain('data-mention-option-index="0"');
    expect(html).toContain("Coda");
    expect(html).toContain("@Coda");
    expect(html).not.toContain("回到底部");
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

  it("excludes channel coordinators from composer mention suggestions", () => {
    const data = createSleiFixtures({
      members: [
        ...createDemoMembers(),
        {
          ...createDemoMembers()[0],
          id: "agent_coordinator_all",
          name: "#all Coordinator",
          handle: "@all-coordinator",
          role: "频道协调员",
          directMessageEnabled: false,
        },
      ],
    });
    const html = renderToStaticMarkup(
      <SleiAppFrame
        activeView="chat"
        data={data}
        initialChatDraft="@all"
        locale="zh-CN"
        runtimeSetup={readyRuntime}
      />,
    );

    expect(html).not.toContain("@all-coordinator");
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
    expect(html).toContain("lucide-send");
    expect(html).not.toContain("⌕");
    expect(html).not.toContain("⌘");
    expect(html).not.toContain("⌫");
    expect(html).not.toContain("↕");
    expect(html).not.toContain("▱");
    expect(html).not.toContain("[]");
  });

  it("uses a loading icon instead of creating copy while submitting a channel", () => {
    const source = appFrameSource();

    expect(source).toContain("LoaderCircle");
    expect(source).toContain("creatingChannel ? <LoaderCircle");
    expect(source).not.toContain("createChannelCreating : input.messages.common.create");
  });

  it("centers far-left rail menu items with shadcn icon labels", () => {
    const html = renderToStaticMarkup(
      <SleiAppFrame
        activeView="chat"
        data={createSleiFixtures()}
        locale="zh-CN"
        runtimeSetup={readyRuntime}
      />,
    );

    expect(html).toContain('data-nav-icon="chat"');
    expect(html).toContain('data-slot="button"');
    expect(html).toContain("grid h-16 w-16");
    expect(html).toContain("text-[11px]");
    expect(html).not.toContain("slei-rail__button");
  });
});
