// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

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

    expect(source).toContain("timelineEndRef");
    expect(source).toContain("pendingScrollToBottomRef");
    expect(source).toContain("requestAnimationFrame");
    expect(source).toContain("scrollIntoView({ block: \"end\" })");
  });

  it("defaults channel and conversation entries without stored scroll to the latest message", () => {
    const source = readChatPageSource();

    expect(source).toContain("initialTimelineScrollTargetRef");
    expect(source).toContain("const timelineScrollTarget =");
    expect(source).toContain("pendingScrollToBottomRef.current = true");
    expect(source).toContain("[timelineScrollTarget, effectiveChannelView, focusedMessageId]");
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
    expect(readChatPageSource()).toContain('data-testid="slei-channel-member-add-menu"');
    expect(readChatPageSource()).toContain("relative flex items-center justify-between gap-2 pr-2");
    expect(panelHtml.slice(0, panelHtml.indexOf('data-radix-scroll-area-viewport'))).toContain('width="18"');
    expect(panelHtml.slice(0, panelHtml.indexOf('data-radix-scroll-area-viewport'))).toContain('height="18"');
    expect(readChatPageSource()).toContain("absolute right-2 top-8");
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
    expect(headerHtml).toContain(messages.chat.newSession);
    expect(headerHtml).toContain(messages.chat.history);
    expect(headerHtml).toContain('data-testid="slei-channel-header-action-separator"');
    expect(headerHtml).toContain('data-testid="slei-channel-members-header-toggle"');
    const closedToggleHtml = headerHtml.slice(headerHtml.lastIndexOf("<button", headerHtml.indexOf('data-testid="slei-channel-members-header-toggle"')));
    expect(closedToggleHtml.slice(0, closedToggleHtml.indexOf("</button>"))).toContain("lucide-panel-right-open");
    expect(closedToggleHtml.slice(0, closedToggleHtml.indexOf("</button>"))).not.toContain("lucide-users");
    expect(headerHtml).not.toContain('role="tablist"');
    expect(source).toContain('className="border-b px-4 py-3"');
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
    expect(html).toContain('data-testid="slei-channel-main-region"');
    expect(html).toContain('data-testid="slei-channel-workspace"');
    expect(html).toContain('data-testid="slei-channel-chat-column"');
    expect(html).toContain("grid-cols-[minmax(0,1fr)_20rem]");
    expect(html).toContain("grid-rows-[minmax(0,1fr)_auto]");
    expect(html).not.toContain("pointer-events-none translate-x-full");
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

      expect(host.querySelector('[data-testid="slei-channel-member-panel"]')).toBeNull();
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

    expect(host.querySelector('[data-testid="slei-channel-member-add-menu"]')).not.toBeNull();

    await act(async () => {
      document.body.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    });

    expect(host.querySelector('[data-testid="slei-channel-member-add-menu"]')).toBeNull();
  });

  it("renders channel tabs followed by new-session and history buttons", () => {
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
    expect(html).toContain(messages.chat.newSession);
    expect(html).toContain(messages.chat.history);
    expect(readChatPageSource()).toContain("onChannelNewSession?.(activeChannel.id)");
  });

  it("filters channel timeline and history drawer by active channel session", () => {
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
    expect(html).not.toContain("旧消息");
    expect(html).toContain("旧会话");
    expect(html).toContain("新会话");
    expect(readChatPageSource()).toContain("onChannelSessionSelect?.(activeChannel.id, session.id)");
  });
});

function readChatPageSource() {
  return readFileSync(join(process.cwd(), "src/features/chat/ChatPageView.tsx"), "utf8");
}
