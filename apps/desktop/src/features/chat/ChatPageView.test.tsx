// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createSleiFixtures, type SleiMember } from "../../test/fixtures";
import { defaultProfile } from "../../app/model";
import { createDesktopMessages } from "../../i18n";
import { ChatPage } from "./ChatPageView";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as typeof globalThis & { ResizeObserver?: typeof ResizeObserver }).ResizeObserver ??= class ResizeObserver {
  disconnect() {}
  observe() {}
  unobserve() {}
};

function memberWithLongMentionText(): SleiMember {
  return {
    id: "agent_architect",
    name: "架构师",
    handle: "@architect-with-an-intentionally-long-handle",
    avatar: "AR",
    type: "agent",
    runtimeStatus: "idle",
    role: "架构设计 Agent，负责与用户头脑风暴、梳理需求、制定技术文档与验收标准，输出清晰的架构设计方案",
    description: "负责架构设计。",
    computer: "Local",
    created: "2026-06-09",
    creator: "lei lee @lei-lee",
    runtime: "ClaudeCode",
    model: "Sonnet",
    instructions: "负责架构设计。",
    permissions: [],
    environmentVariables: [],
    createdAgents: [],
    activity: "Idle",
    capabilities: ["architecture"],
  };
}

let mountedRoot: Root | undefined;
let mountedContainer: HTMLDivElement | undefined;

async function mountChatPage(element: React.ReactElement) {
  mountedContainer = document.createElement("div");
  document.body.appendChild(mountedContainer);
  mountedRoot = createRoot(mountedContainer);
  await act(async () => {
    mountedRoot?.render(element);
  });
  await act(async () => undefined);
  return mountedContainer;
}

afterEach(async () => {
  if (mountedRoot) {
    await act(async () => {
      mountedRoot?.unmount();
    });
  }
  mountedContainer?.remove();
  mountedRoot = undefined;
  mountedContainer = undefined;
});

describe("ChatPage mention panel", () => {
  it("renders the DM skill slash picker for a leading slash draft", () => {
    const messages = createDesktopMessages("zh-CN");
    const member = memberWithLongMentionText();
    const data = createSleiFixtures({
      conversations: [{ id: "dm_agent_architect", kind: "dm", agentId: member.id, createdAt: "0", updatedAt: "0" }],
      members: [
        {
          ...member,
          skills: [{ id: "memory", name: "memory", trigger: "Remember facts", path: "/tmp/memory/SKILL.md" }],
        },
      ],
    });

    const html = renderToStaticMarkup(
      <ChatPage
        activeChannel={data.channels[0]}
        activeConversation={data.conversations[0]}
        data={data}
        initialDraft="/"
        messages={messages}
        profile={defaultProfile}
      />,
    );

    expect(html).toContain(messages.chat.chooseSkill);
    expect(html).toContain("/memory");
  });

  it("renders DM skill slash options with the expected DOM contract and click behavior", async () => {
    const messages = createDesktopMessages("zh-CN");
    const member = memberWithLongMentionText();
    const data = createSleiFixtures({
      conversations: [{ id: "dm_agent_architect", kind: "dm", agentId: member.id, createdAt: "0", updatedAt: "0" }],
      members: [
        {
          ...member,
          skills: [{ id: "memory", name: "memory", trigger: "Remember facts", path: "/tmp/memory/SKILL.md" }],
        },
      ],
    });

    const host = await mountChatPage(
      <ChatPage
        activeChannel={data.channels[0]}
        activeConversation={data.conversations[0]}
        data={data}
        initialDraft="/"
        messages={messages}
        profile={defaultProfile}
      />,
    );

    const panel = host.querySelector('[data-testid="slei-skill-slash-panel"]');
    const option = host.querySelector<HTMLButtonElement>('[data-skill-slash-option-index="0"]');

    expect(panel).not.toBeNull();
    expect(option).not.toBeNull();
    expect(option?.getAttribute("aria-current")).toBe("true");
    expect(option?.textContent).toContain("Remember facts");

    await act(async () => {
      option?.click();
    });

    expect(host.querySelector<HTMLTextAreaElement>('[data-testid="slei-composer-input"]')?.value).toBe("/memory ");
  });

  it("does not render the skill slash picker for channel drafts", async () => {
    const messages = createDesktopMessages("zh-CN");
    const member = memberWithLongMentionText();
    const data = createSleiFixtures({
      channels: [{ id: "all", name: "all", description: "默认团队频道", unread: 0 }],
      members: [
        {
          ...member,
          skills: [{ id: "memory", name: "memory", trigger: "Remember facts", path: "/tmp/memory/SKILL.md" }],
        },
      ],
    });

    const host = await mountChatPage(
      <ChatPage
        activeChannel={data.channels[0]}
        data={data}
        initialDraft="/"
        messages={messages}
        profile={defaultProfile}
      />,
    );

    expect(host.querySelector('[data-testid="slei-skill-slash-panel"]')).toBeNull();
  });

  it("renders channel titles at a size close to the hash icon", () => {
    const messages = createDesktopMessages("zh-CN");
    const data = createSleiFixtures({
      channels: [{ id: "all", name: "all", description: "默认团队频道", unread: 0 }],
    });

    const html = renderToStaticMarkup(
      <ChatPage
        activeChannel={data.channels[0]}
        data={data}
        messages={messages}
        profile={defaultProfile}
      />,
    );

    expect(html).toContain("text-xl font-semibold");
    expect(html).toContain('aria-label="# all"');
  });

  it("places the channel title copy button on the title row", () => {
    const messages = createDesktopMessages("zh-CN");
    const data = createSleiFixtures({
      channels: [{ id: "all", name: "all", description: "默认团队频道", unread: 0 }],
    });

    const html = renderToStaticMarkup(
      <ChatPage
        activeChannel={data.channels[0]}
        data={data}
        messages={messages}
        profile={defaultProfile}
      />,
    );

    const titleStart = html.indexOf('aria-label="# all"');
    const titleEnd = html.indexOf("</h1>", titleStart);
    const titleTextIndex = html.indexOf(">all</span>", titleStart);
    const copyButtonIndex = html.indexOf(`aria-label="${messages.chat.copyMessage}"`, titleStart);

    expect(titleStart).toBeGreaterThanOrEqual(0);
    expect(titleTextIndex).toBeGreaterThan(titleStart);
    expect(copyButtonIndex).toBeGreaterThan(titleTextIndex);
    expect(copyButtonIndex).toBeLessThan(titleEnd);
  });

  it("makes the full channel header draggable without marking header buttons as drag regions", () => {
    const messages = createDesktopMessages("zh-CN");
    const data = createSleiFixtures({
      channels: [{ id: "all", name: "all", description: "默认团队频道", unread: 0 }],
    });

    const html = renderToStaticMarkup(
      <ChatPage
        activeChannel={data.channels[0]}
        data={data}
        messages={messages}
        profile={defaultProfile}
      />,
    );

    const headerStart = html.indexOf('data-testid="slei-channel-header"');
    const headerEnd = html.indexOf("</header>", headerStart);
    const headerHtml = html.slice(headerStart, headerEnd);
    const copyButtonStart = headerHtml.indexOf(`aria-label="${messages.chat.copyMessage}"`);
    const membersButtonStart = headerHtml.indexOf('data-testid="slei-channel-members-header-toggle"');

    expect(headerStart).toBeGreaterThanOrEqual(0);
    expect(headerHtml).toContain('data-tauri-drag-region="deep"');
    expect(headerHtml).toContain("select-none");
    expect(copyButtonStart).toBeGreaterThanOrEqual(0);
    expect(headerHtml.slice(copyButtonStart, copyButtonStart + 220)).not.toContain("data-tauri-drag-region");
    expect(membersButtonStart).toBeGreaterThanOrEqual(0);
    expect(headerHtml.slice(membersButtonStart, membersButtonStart + 260)).not.toContain("data-tauri-drag-region");
  });

  it("keeps long message role descriptions on one truncated header row", () => {
    const messages = createDesktopMessages("zh-CN");
    const member = memberWithLongMentionText();
    const data = createSleiFixtures({
      channels: [{ id: "all", name: "all", description: "测试频道", unread: 0 }],
      members: [member],
      messages: [
        {
          id: "msg_long_role",
          author: member.name,
          handle: member.handle,
          role: "agent",
          time: "10:24",
          body: "我会检查这个交付。",
          channelId: "all",
        },
      ],
    });

    const html = renderToStaticMarkup(
      <ChatPage
        activeChannel={data.channels[0]}
        data={data}
        messages={messages}
        profile={defaultProfile}
      />,
    );

    expect(html).toContain("overflow-hidden whitespace-nowrap");
    expect(html).toContain("min-w-0 flex-1 truncate");
    expect(html).toContain("shrink-0 text-sm text-foreground");
    expect(html.match(/aria-hidden="true">｜/g)?.length).toBe(2);
  });

  it("uses the shared empty illustration for empty channel tasks and files panels", () => {
    const messages = createDesktopMessages("zh-CN");
    const data = createSleiFixtures({
      channels: [{ id: "all", name: "all", description: "默认团队频道", unread: 0 }],
      messages: [],
      tasks: [],
    });

    const tasksHtml = renderToStaticMarkup(
      <ChatPage
        activeChannel={data.channels[0]}
        data={data}
        initialChannelView="tasks"
        messages={messages}
        profile={defaultProfile}
      />,
    );
    const filesHtml = renderToStaticMarkup(
      <ChatPage
        activeChannel={data.channels[0]}
        data={data}
        initialChannelView="files"
        messages={messages}
        profile={defaultProfile}
      />,
    );

    expect(tasksHtml).toContain(messages.chat.channelTaskEmpty);
    expect(tasksHtml).toContain('data-empty-illustration="nodata"');
    expect(filesHtml).toContain(messages.chat.channelFileEmpty);
    expect(filesHtml).toContain('data-empty-illustration="nodata"');
  });

  it("uses the shared empty illustration for an empty chat timeline", () => {
    const messages = createDesktopMessages("zh-CN");
    const data = createSleiFixtures({
      channels: [{ id: "all", name: "all", description: "默认团队频道", unread: 0 }],
      messages: [],
    });

    const html = renderToStaticMarkup(
      <ChatPage
        activeChannel={data.channels[0]}
        data={data}
        messages={messages}
        profile={defaultProfile}
      />,
    );

    expect(html).toContain(messages.empty.defaultTitle.nodata);
    expect(html).toContain('data-empty-illustration="nodata"');
    expect(html).toContain('data-empty-asset="data"');
    expect(html).toContain("empty-data.png");
  });

  it("renders copy and star actions before the full message send time", () => {
    const messages = createDesktopMessages("zh-CN");
    const data = createSleiFixtures({
      channels: [{ id: "all", name: "all", description: "测试频道", unread: 0 }],
      messages: [
        {
          id: "msg_timestamp",
          author: "Lei",
          handle: "@lei",
          role: "human",
          time: "09:08",
          sentAt: "06-16 09:08:07",
          body: "带完整发送时间的消息。",
          channelId: "all",
        },
      ],
    });

    const html = renderToStaticMarkup(
      <ChatPage
        activeChannel={data.channels[0]}
        data={data}
        messages={messages}
        profile={defaultProfile}
      />,
    );

    const messageHtml = html.slice(html.indexOf('data-message-id="msg_timestamp"'));
    const timestampIndex = messageHtml.indexOf("06-16");
    const copyIndex = messageHtml.indexOf(`aria-label="${messages.chat.copyMessage}"`);
    const saveIndex = messageHtml.indexOf(`aria-label="${messages.chat.saveMessage}"`);

    expect(messageHtml).toContain('data-slot="message-actions"');
    expect(messageHtml).not.toContain("2026-06-16");
    expect(messageHtml).toContain("06-16 09:08");
    expect(messageHtml).not.toContain("09:08:07");
    expect(messageHtml).not.toContain("06-16</span><span>09:08:07");
    expect(messageHtml).toContain("flex shrink-0 items-center gap-1");
    expect(messageHtml).not.toContain("min-w-[7.5rem]");
    expect(timestampIndex).toBeGreaterThan(-1);
    expect(copyIndex).toBeGreaterThan(-1);
    expect(saveIndex).toBeGreaterThan(copyIndex);
    expect(timestampIndex).toBeGreaterThan(saveIndex);
  });

  it("keeps a bottom sentinel for post-send timeline scrolling", () => {
    const source = readChatPageSource();

    expect(source).toContain("timelineViewportRef");
    expect(source).toContain("pendingScrollToBottomRef");
    expect(source).toContain("requestAnimationFrame");
    expect(source).toContain("viewport.scrollTo({");
    expect(source).toContain("behavior: \"smooth\"");
  });

  it("scrolls to the newest message after the user sends a message", async () => {
    const requestAnimationFrame = vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    const cancelAnimationFrame = vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
    const messages = createDesktopMessages("zh-CN");
    const data = createSleiFixtures({
      channels: [{ id: "all", name: "all", description: "测试频道", unread: 0 }],
      messages: [
        { id: "msg-existing", author: "Lei", role: "human", time: "10:00", body: "已有消息", channelId: "all" },
      ],
    });

    try {
      const host = await mountChatPage(
        <ChatPage
          activeChannel={data.channels[0]}
          data={data}
          initialDraft="发送后滚到底部"
          messages={messages}
          onSendMessage={async () => undefined}
          profile={defaultProfile}
        />,
      );
      const timeline = host.querySelector<HTMLElement>('[data-testid="slei-chat-timeline"]');
      const scrollTo = vi.fn();
      setScrollMetrics(timeline, { clientHeight: 400, scrollHeight: 1000, scrollTop: 100 });
      Object.defineProperty(timeline, "scrollTo", { configurable: true, value: scrollTo });

      await act(async () => {
        host.querySelector<HTMLButtonElement>('[data-testid="slei-send-button"]')?.click();
      });

      expect(scrollTo).toHaveBeenCalledWith({ top: 1000, behavior: "smooth" });
    } finally {
      requestAnimationFrame.mockRestore();
      cancelAnimationFrame.mockRestore();
    }
  });

  it("uses the virtualizer last item when scrolling to the latest message", () => {
    const source = readChatPageSource();

    expect(source).toContain("timelineVirtualizer.scrollToIndex(timelineMessages.length - 1");
    expect(source).toContain("align: \"end\"");
    expect(source).toContain("behavior: \"smooth\"");
  });

  it("enables timeline virtualization only when there are more than 50 messages", () => {
    const source = readChatPageSource();

    expect(source).toContain("const TIMELINE_VIRTUALIZATION_THRESHOLD = 50");
    expect(source).toContain("const timelineUsesVirtualization = timelineMessages.length > TIMELINE_VIRTUALIZATION_THRESHOLD");
    expect(source).toContain("count: timelineUsesVirtualization ? timelineMessages.length : 0");
  });

  it("does not request older messages when the timeline is at the bottom", async () => {
    const requestAnimationFrame = vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    const cancelAnimationFrame = vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
    const messages = createDesktopMessages("zh-CN");
    const onOlderMessagesLoad = vi.fn();
    const data = createSleiFixtures({
      channels: [{ id: "all", name: "all", description: "测试频道", unread: 0 }],
      messages: Array.from({ length: 60 }, (_, index) => ({
        id: `msg-${index + 1}`,
        author: "Lei",
        role: "human" as const,
        time: `10:${String(index).padStart(2, "0")}`,
        body: `消息 ${index + 1}`,
        channelId: "all",
      })),
    });

    try {
      const host = await mountChatPage(
        <ChatPage
          activeChannel={data.channels[0]}
          data={data}
          messages={messages}
          onOlderMessagesLoad={onOlderMessagesLoad}
          profile={defaultProfile}
        />,
      );
      const timeline = host.querySelector<HTMLElement>('[data-testid="slei-chat-timeline"]');
      setScrollMetrics(timeline, { clientHeight: 400, scrollHeight: 3000, scrollTop: 2600 });

      await act(async () => {
        timeline?.dispatchEvent(new Event("scroll", { bubbles: true }));
      });

      expect(onOlderMessagesLoad).not.toHaveBeenCalled();
    } finally {
      requestAnimationFrame.mockRestore();
      cancelAnimationFrame.mockRestore();
    }
  });

  it("requests older messages when the user scrolls near the top", async () => {
    const messages = createDesktopMessages("zh-CN");
    const onOlderMessagesLoad = vi.fn();
    const data = createSleiFixtures({
      channels: [{ id: "all", name: "all", description: "测试频道", unread: 0 }],
      messages: Array.from({ length: 60 }, (_, index) => ({
        id: `msg-${index + 1}`,
        author: "Lei",
        role: "human" as const,
        time: `10:${String(index).padStart(2, "0")}`,
        body: `消息 ${index + 1}`,
        channelId: "all",
      })),
    });
    const host = await mountChatPage(
      <ChatPage
        activeChannel={data.channels[0]}
        data={data}
        messages={messages}
        onOlderMessagesLoad={onOlderMessagesLoad}
        profile={defaultProfile}
      />,
    );
    const timeline = host.querySelector<HTMLElement>('[data-testid="slei-chat-timeline"]');
    setScrollMetrics(timeline, { clientHeight: 400, scrollHeight: 3000, scrollTop: 32 });

    await act(async () => {
      timeline?.dispatchEvent(new Event("scroll", { bubbles: true }));
    });

    expect(onOlderMessagesLoad).toHaveBeenCalledTimes(1);
  });

  it("shows a loading status while older messages are loading", async () => {
    let resolveOlderMessages!: () => void;
    const messages = createDesktopMessages("zh-CN");
    const onOlderMessagesLoad = vi.fn(() => new Promise<void>((resolve) => {
      resolveOlderMessages = resolve;
    }));
    const data = createSleiFixtures({
      channels: [{ id: "all", name: "all", description: "测试频道", unread: 0 }],
      messages: Array.from({ length: 60 }, (_, index) => ({
        id: `msg-${index + 1}`,
        author: "Lei",
        role: "human" as const,
        time: `10:${String(index).padStart(2, "0")}`,
        body: `消息 ${index + 1}`,
        channelId: "all",
      })),
    });
    const host = await mountChatPage(
      <ChatPage
        activeChannel={data.channels[0]}
        data={data}
        messages={messages}
        onOlderMessagesLoad={onOlderMessagesLoad}
        profile={defaultProfile}
      />,
    );
    const timeline = host.querySelector<HTMLElement>('[data-testid="slei-chat-timeline"]');
    setScrollMetrics(timeline, { clientHeight: 400, scrollHeight: 3000, scrollTop: 0 });

    await act(async () => {
      timeline?.dispatchEvent(new Event("scroll", { bubbles: true }));
    });

    expect(host.querySelector('[data-testid="slei-older-messages-loading"]')?.textContent).toContain("正在加载");

    await act(async () => {
      resolveOlderMessages();
    });

    expect(host.querySelector('[data-testid="slei-older-messages-loading"]')).toBeNull();
  });

  it("preserves the viewport anchor after older messages are prepended", () => {
    const source = readChatPageSource();

    expect(source).toContain("pendingOlderMessagesScrollRestoreRef");
    expect(source).toContain("viewport.scrollTop = restore.scrollTop + delta");
  });

  it("shows a floating scroll-to-bottom button when an agent message arrives while the timeline is not at the bottom", async () => {
    const requestAnimationFrame = vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    const cancelAnimationFrame = vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
    const messages = createDesktopMessages("zh-CN");
    const baseData = createSleiFixtures({
      channels: [{ id: "all", name: "all", description: "测试频道", unread: 0 }],
      messages: [
        { id: "msg-user", author: "Lei", role: "human", time: "10:00", body: "用户消息", channelId: "all" },
      ],
    });
    const nextData = {
      ...baseData,
      messages: [
        ...baseData.messages,
        { id: "msg-agent-new", author: "Nova", role: "agent" as const, time: "10:01", body: "新的 agent 消息", channelId: "all" },
      ],
    };

    try {
      const host = await mountChatPage(
        <ChatPage
          activeChannel={baseData.channels[0]}
          data={baseData}
          messages={messages}
          profile={defaultProfile}
        />,
      );
      const timeline = host.querySelector<HTMLElement>('[data-testid="slei-chat-timeline"]');
      const scrollTo = vi.fn();
      Object.defineProperty(timeline, "scrollTo", { configurable: true, value: scrollTo });
      setScrollMetrics(timeline, { clientHeight: 400, scrollHeight: 1000, scrollTop: 100 });
      await act(async () => {
        timeline?.dispatchEvent(new Event("scroll", { bubbles: true }));
      });

      await act(async () => {
        mountedRoot?.render(
          <ChatPage
            activeChannel={nextData.channels[0]}
            data={nextData}
            messages={messages}
            profile={defaultProfile}
          />,
        );
      });

      const button = host.querySelector<HTMLButtonElement>('[data-testid="slei-scroll-to-bottom"]');
      expect(button?.textContent).toContain("滚动到底部");

      await act(async () => {
        button?.click();
      });

      expect(scrollTo).toHaveBeenCalledWith({ top: 1000, behavior: "smooth" });
      expect(host.querySelector('[data-testid="slei-scroll-to-bottom"]')).toBeNull();
    } finally {
      requestAnimationFrame.mockRestore();
      cancelAnimationFrame.mockRestore();
    }
  });

  it("shows the existing scroll-to-bottom button when the timeline is at least 200px from the bottom", async () => {
    const messages = createDesktopMessages("zh-CN");
    const data = createSleiFixtures({
      channels: [{ id: "all", name: "all", description: "测试频道", unread: 0 }],
      messages: [
        { id: "msg-1", author: "Lei", role: "human", time: "10:00", body: "第一条", channelId: "all" },
        { id: "msg-2", author: "Nova", role: "agent", time: "10:01", body: "第二条", channelId: "all" },
      ],
    });

    const host = await mountChatPage(
      <ChatPage
        activeChannel={data.channels[0]}
        data={data}
        messages={messages}
        profile={defaultProfile}
      />,
    );
    const timeline = host.querySelector<HTMLElement>('[data-testid="slei-chat-timeline"]');

    setScrollMetrics(timeline, { clientHeight: 400, scrollHeight: 1000, scrollTop: 400 });
    await act(async () => {
      timeline?.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
    const button = host.querySelector<HTMLButtonElement>('[data-testid="slei-scroll-to-bottom"]');
    expect(button?.textContent).toContain("滚动到底部");
    expect(button?.querySelector(".lucide-arrow-down")).not.toBeNull();
    expect(button?.className).toContain("h-8");
    expect(button?.className).toContain("px-3.5");
    expect(button?.className).toContain("border-primary");
    expect(button?.className).toContain("bg-white");
    expect(button?.className).toContain("text-primary");

    setScrollMetrics(timeline, { clientHeight: 400, scrollHeight: 1000, scrollTop: 401 });
    await act(async () => {
      timeline?.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
    expect(host.querySelector('[data-testid="slei-scroll-to-bottom"]')).toBeNull();
  });

  it("uses virtualized timeline rendering with an older-message load hook", () => {
    const source = readChatPageSource();

    expect(source).toContain("useVirtualizer");
    expect(source).toContain("timelineVirtualizer.measureElement");
    expect(source).toContain("onOlderMessagesLoad?.()");
  });

  it("requests older messages only from the near-top timeline scroll path", () => {
    const source = readChatPageSource();

    expect(source).toContain("HISTORY_LOAD_SCROLL_TOP_THRESHOLD_PX");
    expect(source).toContain("function requestOlderMessagesIfNearTop()");
    expect(source).toContain("viewport.scrollTop > HISTORY_LOAD_SCROLL_TOP_THRESHOLD_PX");
    expect(source).toContain("olderMessagesRequestInFlightRef.current");
    expect(source).toContain("requestOlderMessagesIfNearTop();");
    expect(source).not.toContain("timelineVirtualItems[0]?.index, timelineMessages.length, onOlderMessagesLoad");
  });

  it("defaults channel and conversation entries without stored scroll to the latest message", () => {
    const source = readChatPageSource();

    expect(source).toContain("initialTimelineScrollTargetRef");
    expect(source).toContain("const timelineScrollTarget =");
    expect(source).toContain("if (timelineUsesVirtualization && timelineMessages.length > 0)");
    expect(source).toContain("timelineVirtualizer.scrollToIndex(timelineMessages.length - 1");
    expect(source).toContain("top: viewport.scrollHeight");
    expect(source).toContain("behavior: \"smooth\"");
    expect(source).toContain("pendingScrollToBottomRef.current = true");
    expect(source).toContain("[timelineScrollTarget, effectiveChannelView, focusedMessageId]");
  });

  it("scrolls a focused message into view and removes its blink border after the timer", async () => {
    vi.useFakeTimers();
    const scrollIntoView = vi.fn();
    const focus = vi.fn();
    const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
    const originalFocus = HTMLElement.prototype.focus;
    HTMLElement.prototype.scrollIntoView = scrollIntoView;
    HTMLElement.prototype.focus = focus;
    const messages = createDesktopMessages("zh-CN");
    const data = createSleiFixtures({
      channels: [{ id: "all", name: "all", description: "测试频道", unread: 0, activeSessionId: "session-search" }],
      channelSessions: [{ id: "session-search", channelId: "all", title: "搜索会话", status: "ready", createdAt: "0", updatedAt: "0" }],
      messages: [
        {
          id: "msg-search-target",
          author: "Lei",
          role: "human",
          time: "10:24",
          body: "来自搜索结果的目标消息。",
          channelId: "all",
          sessionId: "session-search",
        },
      ],
    });

    try {
      const host = await mountChatPage(
        <ChatPage
          activeChannel={data.channels[0]}
          activeSessionId="session-search"
          data={data}
          focusedMessageId="msg-search-target"
          messages={messages}
          profile={defaultProfile}
        />,
      );

      const target = host.querySelector<HTMLElement>('[data-message-id="msg-search-target"]');
      expect(scrollIntoView).toHaveBeenCalledWith({ block: "center" });
      expect(focus).toHaveBeenCalledWith({ preventScroll: true });
      expect(target?.dataset.focused).toBe("true");
      expect(target?.classList.contains("slei-message--blink-border")).toBe(true);

      await act(async () => {
        vi.advanceTimersByTime(2300);
      });

      expect(target?.dataset.focused).toBeUndefined();
      expect(target?.classList.contains("slei-message--blink-border")).toBe(false);
    } finally {
      HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
      HTMLElement.prototype.focus = originalFocus;
      vi.useRealTimers();
    }
  });

  it("keeps mention suggestions constrained to the composer width", () => {
    const messages = createDesktopMessages("zh-CN");
    const data = createSleiFixtures({
      channels: [{ id: "all", name: "all", description: "测试频道", unread: 0 }],
      members: [memberWithLongMentionText()],
    });

    const html = renderToStaticMarkup(
      <ChatPage
        activeChannel={data.channels[0]}
        data={data}
        initialDraft="@"
        messages={messages}
        profile={defaultProfile}
      />,
    );

    expect(html).toContain('data-testid="slei-mention-panel"');
    expect(html).toContain("w-full");
    expect(html).toContain("max-w-full");
    expect(html).toContain("min-w-0 flex-1");
    expect(html).toContain("block truncate");
    expect(html).toContain("max-w-[35%] truncate");
  });

  it("renders channel members and addable agents in the member panel", () => {
    const messages = createDesktopMessages("zh-CN");
    const data = createSleiFixtures({
      channels: [{ id: "all", name: "all", description: "测试频道", unread: 0 }],
      members: [
        memberWithLongMentionText(),
        {
          ...memberWithLongMentionText(),
          id: "agent_coda",
          name: "Coda",
          handle: "@coda",
          channelReadiness: { all: "ready" },
        },
        {
          ...memberWithLongMentionText(),
          id: "agent_nova",
          name: "Nova",
          handle: "@nova",
          channelReadiness: { all: "memory_syncing" },
        },
      ],
    });

    const html = renderToStaticMarkup(
      <ChatPage
        activeChannel={data.channels[0]}
        data={data}
        initialChannelMembersOpen
        messages={messages}
        profile={defaultProfile}
      />,
    );

    expect(html).toContain('data-testid="slei-channel-member-panel"');
    const panelStart = html.lastIndexOf("<aside", html.indexOf('data-testid="slei-channel-member-panel"'));
    const panelHtml = html.slice(panelStart, html.indexOf("</aside>", panelStart));
    const panelOpenTag = panelHtml.slice(0, panelHtml.indexOf(">"));
    expect(panelOpenTag).not.toContain("absolute");
    expect(panelOpenTag).not.toContain("translate-x");
    expect(panelOpenTag).not.toContain("shadow-lg");
    expect(panelOpenTag).not.toContain("top-16");
    expect(html).not.toContain("top-[calc(4rem+1px)]");
    expect(panelHtml).toContain("w-80");
    expect(readChatPageSource()).toContain('data-testid="slei-channel-member-add-popover"');
    expect(readChatPageSource()).toContain("PopoverContent");
    expect(panelHtml.slice(0, panelHtml.indexOf('data-radix-scroll-area-viewport'))).toContain('width="18"');
    expect(panelHtml.slice(0, panelHtml.indexOf('data-radix-scroll-area-viewport'))).toContain('height="18"');
    expect(readChatPageSource()).not.toContain("absolute right-2 top-8");
    expect(html).toContain("lucide-plus");
    expect(html).toContain("Coda");
    expect(html).toContain("Nova");
    expect(panelHtml).not.toContain("已就位");
    expect(panelHtml).not.toContain("搜索群成员");
    expect(html).toContain("添加成员");
    expect(panelHtml.slice(0, panelHtml.indexOf('data-radix-scroll-area-viewport'))).toContain("频道成员(2)");
    expect(panelHtml.slice(0, panelHtml.indexOf('data-radix-scroll-area-viewport'))).not.toContain('data-slot="badge"');
    expect(panelHtml).toContain('data-testid="slei-channel-member-status-dot"');
    expect(panelHtml).toContain("bg-emerald-500");
    expect(panelHtml).toContain("bg-muted-foreground/40");
    expect(panelHtml).toContain("lucide-trash-2");
    expect(panelHtml).toContain("text-destructive");
  });

  it("renders channel view tabs below the header and member toggle in the header actions", () => {
    const messages = createDesktopMessages("zh-CN");
    const data = createSleiFixtures({
      channels: [{ id: "all", name: "all", description: "测试频道", unread: 0 }],
    });

    const html = renderToStaticMarkup(
      <ChatPage
        activeChannel={data.channels[0]}
        data={data}
        messages={messages}
        profile={defaultProfile}
      />,
    );
    const source = readChatPageSource();
    const headerHtml = html.slice(html.indexOf("<header"), html.indexOf("</header>"));
    const tabsIndex = html.indexOf('data-testid="slei-channel-view-tabs"');
    const headerEndIndex = html.indexOf("</header>");

    expect(html).not.toContain('data-testid="slei-channel-members-edge-toggle"');
    expect(html).toContain('data-testid="slei-channel-members-header-toggle"');
    expect(html).toContain('data-testid="slei-channel-view-tabs"');
    expect(tabsIndex).toBeGreaterThan(headerEndIndex);
    expect(headerHtml).not.toContain(messages.chat.newSession);
    expect(headerHtml).not.toContain(messages.chat.history);
    expect(headerHtml).not.toContain('data-testid="slei-channel-header-action-separator"');
    expect(headerHtml).toContain('data-testid="slei-channel-members-header-toggle"');
    const closedToggleHtml = headerHtml.slice(headerHtml.lastIndexOf("<button", headerHtml.indexOf('data-testid="slei-channel-members-header-toggle"')));
    expect(closedToggleHtml.slice(0, closedToggleHtml.indexOf("</button>"))).toContain("lucide-panel-right-open");
    expect(closedToggleHtml.slice(0, closedToggleHtml.indexOf("</button>"))).not.toContain("lucide-users");
    expect(headerHtml).not.toContain('role="tablist"');
    expect(source).toContain('className="border-b px-4 py-2"');
    expect(source).toContain('variant="line"');
    expect(source).not.toContain('aria-pressed={channelMembersOpen ? "true" : "false"}');
  });

  it("uses active color on the header member toggle while the member panel is expanded", () => {
    const messages = createDesktopMessages("zh-CN");
    const data = createSleiFixtures({
      channels: [{ id: "all", name: "all", description: "测试频道", unread: 0 }],
    });

    const html = renderToStaticMarkup(
      <ChatPage
        activeChannel={data.channels[0]}
        data={data}
        initialChannelMembersOpen
        messages={messages}
        profile={defaultProfile}
      />,
    );

    expect(html).toContain('aria-expanded="true"');
    const toggleTestIdIndex = html.indexOf('data-testid="slei-channel-members-header-toggle"');
    const toggleHtml = html.slice(html.lastIndexOf("<button", toggleTestIdIndex));
    expect(toggleHtml.slice(0, toggleHtml.indexOf("</button>"))).toContain("bg-primary/10 text-primary");
    expect(toggleHtml.slice(0, toggleHtml.indexOf("</button>"))).toContain("lucide-panel-right-close");
    expect(toggleHtml.slice(0, toggleHtml.indexOf("</button>"))).not.toContain("lucide-users");
  });

  it("embeds the channel member panel beside a shrinkable channel workspace", () => {
    const messages = createDesktopMessages("zh-CN");
    const data = createSleiFixtures({
      channels: [{ id: "all", name: "all", description: "测试频道", unread: 0 }],
      members: [
        {
          ...memberWithLongMentionText(),
          id: "agent_coda",
          name: "Coda",
          handle: "@coda",
          channelReadiness: { all: "ready" },
        },
      ],
    });

    const html = renderToStaticMarkup(
      <ChatPage
        activeChannel={data.channels[0]}
        data={data}
        initialChannelMembersOpen
        messages={messages}
        profile={defaultProfile}
      />,
    );

    expect(html).toContain('data-testid="slei-channel-member-panel"');
    expect(html).toContain('data-testid="slei-channel-member-panel-shell"');
    expect(html).toContain('data-testid="slei-channel-main-region"');
    expect(html).toContain('data-testid="slei-channel-workspace"');
    expect(html).toContain('data-testid="slei-channel-chat-column"');
    expect(html).toContain("grid-cols-[minmax(0,1fr)_20rem]");
    expect(html).toContain("transition-[grid-template-columns]");
    expect(html).toContain("transition-[opacity,transform]");
    expect(html).toContain("translate-x-0 opacity-100");
    expect(html).toContain("grid-rows-[minmax(0,1fr)_auto]");
    expect(html).not.toContain("pointer-events-none translate-x-full");
  });

  it("keeps the channel member panel mounted offscreen while collapsed for slide animation", () => {
    const messages = createDesktopMessages("zh-CN");
    const data = createSleiFixtures({
      channels: [{ id: "all", name: "all", description: "测试频道", unread: 0 }],
      members: [
        {
          ...memberWithLongMentionText(),
          id: "agent_coda",
          name: "Coda",
          handle: "@coda",
          channelReadiness: { all: "ready" },
        },
      ],
    });

    const html = renderToStaticMarkup(
      <ChatPage
        activeChannel={data.channels[0]}
        data={data}
        messages={messages}
        profile={defaultProfile}
      />,
    );

    expect(html).toContain('data-testid="slei-channel-member-panel-shell"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("grid-cols-[minmax(0,1fr)_0rem]");
    expect(html).toContain("pointer-events-none translate-x-full opacity-0");
  });

  it("hides the channel member panel while task or file tabs are active", () => {
    const messages = createDesktopMessages("zh-CN");
    const data = createSleiFixtures({
      channels: [{ id: "all", name: "all", description: "测试频道", unread: 0 }],
      members: [
        {
          ...memberWithLongMentionText(),
          id: "agent_coda",
          name: "Coda",
          handle: "@coda",
          channelReadiness: { all: "ready" },
        },
      ],
    });

    for (const initialChannelView of ["tasks", "files"] as const) {
      const html = renderToStaticMarkup(
        <ChatPage
          activeChannel={data.channels[0]}
          data={data}
          initialChannelMembersOpen
          initialChannelView={initialChannelView}
          messages={messages}
          profile={defaultProfile}
        />,
      );
      const toggleTestIdIndex = html.indexOf('data-testid="slei-channel-members-header-toggle"');
      const toggleHtml = html.slice(html.lastIndexOf("<button", toggleTestIdIndex), html.indexOf("</button>", toggleTestIdIndex));

      expect(html).not.toContain('data-testid="slei-channel-member-panel"');
      expect(html).toContain("grid-cols-1");
      expect(html).not.toContain("grid-cols-[minmax(0,1fr)_20rem]");
      expect(toggleHtml).toContain('aria-expanded="false"');
      expect(toggleHtml).not.toContain("bg-primary/10 text-primary");
    }
  });

  it("keeps channel member add and remove mutations behind confirmation UI", () => {
    const source = readChatPageSource();

    expect(source).toContain("confirmingAddId");
    expect(source).toContain("setConfirmingAddId(member.id)");
    expect(source).toContain("mutate(member.id, \"add\")");
    expect(source).toContain("confirmingRemoveId");
    expect(source).toContain("setConfirmingRemoveId(member.id)");
    expect(source).toContain("mutate(member.id, \"remove\")");
    expect(source).toContain("text-destructive");
  });

  it("automatically collapses the inline member panel below the compact breakpoint", async () => {
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = (() => ({
      matches: true,
      media: "(max-width: 899px)",
      onchange: null,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      dispatchEvent: () => false,
    })) as typeof window.matchMedia;
    const messages = createDesktopMessages("zh-CN");
    const data = createSleiFixtures({
      channels: [{ id: "all", name: "all", description: "测试频道", unread: 0 }],
      members: [
        {
          ...memberWithLongMentionText(),
          id: "agent_coda",
          name: "Coda",
          handle: "@coda",
          channelReadiness: { all: "ready" },
        },
      ],
    });

    try {
      const host = await mountChatPage(
        <ChatPage
          activeChannel={data.channels[0]}
          data={data}
          initialChannelMembersOpen
          messages={messages}
          profile={defaultProfile}
        />,
      );

      const panelShell = host.querySelector('[data-testid="slei-channel-member-panel-shell"]');
      expect(panelShell).not.toBeNull();
      expect(panelShell?.getAttribute("aria-hidden")).toBe("true");
      expect(host.innerHTML).toContain("grid-cols-[minmax(0,1fr)_0rem]");
      expect(host.innerHTML).toContain("pointer-events-none translate-x-full opacity-0");
      expect(host.querySelector('[data-testid="slei-channel-members-header-toggle"]')?.getAttribute("aria-expanded")).toBe("false");
    } finally {
      window.matchMedia = originalMatchMedia;
    }
  });

  it("closes the channel member add menu when the user clicks outside the panel", async () => {
    const messages = createDesktopMessages("zh-CN");
    const data = createSleiFixtures({
      channels: [{ id: "all", name: "all", description: "测试频道", unread: 0 }],
      members: [
        memberWithLongMentionText(),
        {
          ...memberWithLongMentionText(),
          id: "agent_coda",
          name: "Coda",
          handle: "@coda",
          channelReadiness: { all: "ready" },
        },
      ],
    });

    const host = await mountChatPage(
      <ChatPage
        activeChannel={data.channels[0]}
        data={data}
        initialChannelMembersOpen
        messages={messages}
        profile={defaultProfile}
      />,
    );

    const addButton = host.querySelector<HTMLButtonElement>(`[aria-label="${messages.chat.addChannelMember}"]`);
    await act(async () => {
      addButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(document.body.querySelector('[data-testid="slei-channel-member-add-popover"]')).not.toBeNull();

    await act(async () => {
      document.body.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    });

    expect(document.body.querySelector('[data-testid="slei-channel-member-add-popover"]')).toBeNull();
  });

  it("renders channel tabs without new-session or history controls", () => {
    const messages = createDesktopMessages("zh-CN");
    const data = createSleiFixtures({
      channels: [{ id: "all", name: "all", description: "测试频道", unread: 0, activeSessionId: "session:channel:all:default" }],
      channelSessions: [{ id: "session:channel:all:default", channelId: "all", title: "新会话", status: "ready", createdAt: "0", updatedAt: "0" }],
    });

    const html = renderToStaticMarkup(
      <ChatPage
        activeChannel={data.channels[0]}
        data={data}
        messages={messages}
        profile={defaultProfile}
      />,
    );

    expect(html).toContain(messages.shell.nav.chat);
    expect(html).toContain(messages.chat.tasks);
    expect(html).toContain(messages.chat.files);
    expect(html).not.toContain(messages.chat.newSession);
    expect(html).not.toContain(messages.chat.history);
    expect(readChatPageSource()).not.toContain("onChannelNewSession?.(activeChannel.id)");
  });

  it("shows all channel messages without a session history drawer", () => {
    const messages = createDesktopMessages("zh-CN");
    const data = createSleiFixtures({
      channels: [{ id: "all", name: "all", description: "测试频道", unread: 0, activeSessionId: "session-new" }],
      channelSessions: [
        { id: "session-old", channelId: "all", title: "旧会话", status: "ready", createdAt: "1", updatedAt: "1" },
        { id: "session-new", channelId: "all", title: "新会话", status: "ready", createdAt: "2", updatedAt: "2" },
      ],
      messages: [
        { id: "msg-old", author: "Lei", role: "human", time: "10:00", body: "旧消息", channelId: "all", sessionId: "session-old" },
        { id: "msg-new", author: "Lei", role: "human", time: "10:01", body: "新消息", channelId: "all", sessionId: "session-new" },
      ],
    });

    const html = renderToStaticMarkup(
      <ChatPage
        activeChannel={data.channels[0]}
        data={data}
        messages={messages}
        profile={defaultProfile}
        sessionDrawerOpen
      />,
    );

    expect(html).toContain("新消息");
    expect(html).toContain("旧消息");
    expect(html).not.toContain("旧会话");
    expect(readChatPageSource()).not.toContain("onChannelSessionSelect?.(activeChannel.id, session.id)");
  });

  it("allows direct messages to be sent as tasks", () => {
    const messages = createDesktopMessages("zh-CN");
    const member = memberWithLongMentionText();
    const data = createSleiFixtures({
      channels: [{ id: "all", name: "all", description: "测试频道", unread: 0 }],
      conversations: [{ id: "dm:agent_architect", agentId: member.id, kind: "dm", activeSessionId: "session-dm", createdAt: "0", updatedAt: "0" }],
      members: [member],
    });

    const html = renderToStaticMarkup(
      <ChatPage
        activeChannel={data.channels[0]}
        activeConversation={data.conversations[0]}
        data={data}
        messages={messages}
        profile={defaultProfile}
      />,
    );

    expect(html).toContain(messages.chat.asTask);
  });

  it("renders a message-thread action for normal timeline messages", () => {
    const messages = createDesktopMessages("zh-CN");
    const data = createSleiFixtures({
      channels: [{ id: "all", name: "all", description: "测试频道", unread: 0 }],
      messages: [
        { id: "msg-open-thread", author: "Lei", role: "human", time: "10:00", body: "可以独立开子线程的消息", channelId: "all" },
      ],
    });

    const html = renderToStaticMarkup(
      <ChatPage
        activeChannel={data.channels[0]}
        data={data}
        messages={messages}
        onMessageThreadOpen={() => undefined}
        profile={defaultProfile}
      />,
    );

    expect(html).toContain('data-message-thread-open="msg-open-thread"');
    expect(html).toContain(messages.tasks.commentThread);
  });

  it("adds breathing room above normal timeline message cards", () => {
    const messages = createDesktopMessages("zh-CN");
    const data = createSleiFixtures({
      channels: [{ id: "all", name: "all", description: "测试频道", unread: 0 }],
      messages: [
        {
          id: "msg-spaced",
          author: "Yeal",
          handle: "@yeal",
          role: "agent",
          time: "14:20",
          sentAt: "2026-06-11 14:20:53",
          body: "已准备好，可以帮助你创建成员、频道并了解 Slei 的使用方式。",
          channelId: "all",
        },
      ],
    });

    const html = renderToStaticMarkup(
      <ChatPage
        activeChannel={data.channels[0]}
        data={data}
        messages={messages}
        profile={defaultProfile}
      />,
    );

    const frameStart = html.indexOf('data-slot="timeline-message-frame"');
    const articleStart = html.indexOf('data-message-id="msg-spaced"', frameStart);
    const frameOpenStart = html.lastIndexOf("<div", frameStart);
    const frameHtml = html.slice(frameOpenStart, articleStart);

    expect(frameStart).toBeGreaterThanOrEqual(0);
    expect(frameOpenStart).toBeGreaterThanOrEqual(0);
    expect(articleStart).toBeGreaterThan(frameStart);
    expect(frameHtml).toContain("pt-3");
  });

  it("keeps task root entries visually aligned with normal messages without a border", () => {
    const source = readFileSync(join(process.cwd(), "src/features/chat/TaskRootEntry.tsx"), "utf8");

    expect(source).not.toContain("border border-primary");
  });
});

function readChatPageSource() {
  return readFileSync(join(process.cwd(), "src/features/chat/ChatPageView.tsx"), "utf8");
}

function setScrollMetrics(element: HTMLElement | null, metrics: { clientHeight: number; scrollHeight: number; scrollTop: number }) {
  if (!element) return;
  Object.defineProperty(element, "clientHeight", { configurable: true, value: metrics.clientHeight });
  Object.defineProperty(element, "scrollHeight", { configurable: true, value: metrics.scrollHeight });
  Object.defineProperty(element, "scrollTop", { configurable: true, value: metrics.scrollTop, writable: true });
}
