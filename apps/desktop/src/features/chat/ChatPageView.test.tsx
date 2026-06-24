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
HTMLElement.prototype.scrollIntoView ??= function scrollIntoView() {};

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

function dmSkillSlashFixture(
  initialDraft: string,
  options: { onSendMessage?: (body: string) => Promise<void> | void } = {},
) {
  const messages = createDesktopMessages("zh-CN");
  const member = {
    ...memberWithLongMentionText(),
    skills: [
      { id: "guide-create", name: "guide-create", trigger: "Create agents", path: "/tmp/guide/SKILL.md" },
      { id: "memory", name: "memory", trigger: "Remember facts", path: "/tmp/memory/SKILL.md" },
    ],
  };
  const data = createSleiFixtures({
    conversations: [{ id: "dm_agent_architect", kind: "dm", agentId: member.id, createdAt: "0", updatedAt: "0" }],
    members: [member],
  });

  return {
    element: (
      <ChatPage
        activeChannel={data.channels[0]}
        activeConversation={data.conversations[0]}
        data={data}
        initialDraft={initialDraft}
        messages={messages}
        onSendMessage={options.onSendMessage}
        profile={defaultProfile}
      />
    ),
    messages,
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

describe("ChatPage DM skill message highlight", () => {
  it("highlights only a known leading DM skill slash token", () => {
    const messages = createDesktopMessages("zh-CN");
    const member = {
      ...memberWithLongMentionText(),
      skills: [{ id: "memory", name: "memory", trigger: "Remember facts", path: "/tmp/memory/SKILL.md" }],
    };
    const data = createSleiFixtures({
      conversations: [{ id: "dm_agent_architect", kind: "dm", agentId: member.id, createdAt: "0", updatedAt: "0" }],
      members: [member],
      messages: [
        {
          id: "msg_skill",
          author: "Lei",
          role: "human",
          time: "10:00",
          body: "/memory **重点**",
          channelId: "dm_agent_architect",
        },
      ],
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

    expect(html).toContain("slei-message-skill");
    expect(html).toContain("/memory");
    expect(html).toContain("<strong>重点</strong>");
  });

  it("preserves whitespace-sensitive markdown after a highlighted DM skill token", () => {
    const messages = createDesktopMessages("zh-CN");
    const member = {
      ...memberWithLongMentionText(),
      skills: [{ id: "memory", name: "memory", trigger: "Remember facts", path: "/tmp/memory/SKILL.md" }],
    };
    const data = createSleiFixtures({
      conversations: [{ id: "dm_agent_architect", kind: "dm", agentId: member.id, createdAt: "0", updatedAt: "0" }],
      members: [member],
      messages: [
        {
          id: "msg_skill_code",
          author: "Lei",
          role: "human",
          time: "10:00",
          body: "/memory\n    code",
          channelId: "dm_agent_architect",
        },
      ],
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

    expect(html).toContain("slei-message-skill");
    expect(html).toContain("/memory");
    expect(html).toContain("<pre>");
    expect(html).toContain("<code>code");
  });

  it("does not highlight middle, unknown, leading-space, or channel slash tokens", () => {
    const messages = createDesktopMessages("zh-CN");
    const member = {
      ...memberWithLongMentionText(),
      skills: [{ id: "memory", name: "memory", trigger: "Remember facts", path: "/tmp/memory/SKILL.md" }],
    };
    const dmConversation = { id: "dm_agent_architect", kind: "dm" as const, agentId: member.id, createdAt: "0", updatedAt: "0" };

    const renderBody = (body: string, conversation = dmConversation) => {
      const data = createSleiFixtures({
        conversations: [dmConversation],
        members: [member],
        messages: [
          {
            id: `msg_${body.replace(/\W+/g, "_")}`,
            author: "Lei",
            role: "human",
            time: "10:00",
            body,
            channelId: conversation.id,
          },
        ],
      });

      return renderToStaticMarkup(
        <ChatPage
          activeChannel={data.channels[0]}
          activeConversation={conversation}
          data={data}
          messages={messages}
          profile={defaultProfile}
        />,
      );
    };

    expect(renderBody("请用 /memory")).not.toContain("slei-message-skill");
    expect(renderBody("/unknown")).not.toContain("slei-message-skill");
    expect(renderBody(" /memory")).not.toContain("slei-message-skill");

    const channelData = createSleiFixtures({
      members: [member],
      messages: [
        {
          id: "msg_channel_skill",
          author: "Lei",
          role: "human",
          time: "10:00",
          body: "/memory",
          channelId: "all",
        },
      ],
    });

    const channelHtml = renderToStaticMarkup(
      <ChatPage
        activeChannel={channelData.channels[0]}
        data={channelData}
        messages={messages}
        profile={defaultProfile}
      />,
    );

    expect(channelHtml).not.toContain("slei-message-skill");
  });
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

  it("selects a DM skill slash option with keyboard", async () => {
    const onSendMessage = vi.fn();
    const { element } = dmSkillSlashFixture("/me", { onSendMessage });
    const container = await mountChatPage(element);
    const input = container.querySelector<HTMLTextAreaElement>('[data-testid="slei-composer-input"]')!;

    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });

    expect(input.value).toBe("/memory ");
    expect(onSendMessage).not.toHaveBeenCalled();
  });

  it("moves the selected DM skill slash option with arrow keys", async () => {
    const { element } = dmSkillSlashFixture("/");
    const container = await mountChatPage(element);
    const input = container.querySelector<HTMLTextAreaElement>('[data-testid="slei-composer-input"]')!;
    const options = () => Array.from(container.querySelectorAll<HTMLButtonElement>("[data-skill-slash-option-index]"));

    expect(options()[0]?.getAttribute("aria-current")).toBe("true");
    expect(options()[1]?.getAttribute("aria-current")).toBeNull();

    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    });

    expect(options()[0]?.getAttribute("aria-current")).toBeNull();
    expect(options()[1]?.getAttribute("aria-current")).toBe("true");

    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
    });

    expect(options()[0]?.getAttribute("aria-current")).toBe("true");
    expect(options()[1]?.getAttribute("aria-current")).toBeNull();
  });

  it("selects a DM skill slash option with Tab", async () => {
    const onSendMessage = vi.fn();
    const { element } = dmSkillSlashFixture("/me", { onSendMessage });
    const container = await mountChatPage(element);
    const input = container.querySelector<HTMLTextAreaElement>('[data-testid="slei-composer-input"]')!;

    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    });

    expect(input.value).toBe("/memory ");
    expect(onSendMessage).not.toHaveBeenCalled();
  });

  it("keeps Shift+Enter available while the DM skill slash picker is active", async () => {
    const onSendMessage = vi.fn();
    const { element } = dmSkillSlashFixture("/me", { onSendMessage });
    const container = await mountChatPage(element);
    const input = container.querySelector<HTMLTextAreaElement>('[data-testid="slei-composer-input"]')!;

    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true }));
    });

    expect(input.value).toBe("/me");
    expect(container.querySelector('[data-testid="slei-skill-slash-panel"]')).not.toBeNull();
    expect(onSendMessage).not.toHaveBeenCalled();
  });

  it("clears the leading skill slash query with Escape", async () => {
    const { element } = dmSkillSlashFixture("/me");
    const container = await mountChatPage(element);
    const input = container.querySelector<HTMLTextAreaElement>('[data-testid="slei-composer-input"]')!;

    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });

    expect(input.value).toBe("");
    expect(container.querySelector('[data-testid="slei-skill-slash-panel"]')).toBeNull();
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

  it("renders linked project text and edit button in non-default channel headers", () => {
    const messages = createDesktopMessages("zh-CN");
    const data = createSleiFixtures({
      channels: [{ id: "kol-content", name: "kol-content", description: "kol-content", projectName: "kol-content", projectPaths: ["/workspace/kol-content"], unread: 0 }],
    });

    const html = renderToStaticMarkup(
      <ChatPage
        activeChannel={data.channels[0]}
        data={data}
        messages={messages}
        profile={defaultProfile}
      />,
    );

    expect(html).toContain(messages.chat.projectPrefix("/workspace/kol-content"));
    expect(html).toContain(`aria-label="${messages.chat.editProjects}"`);
    expect(html).toContain('data-testid="slei-channel-project-edit"');
  });

  it("shows an empty linked project label instead of the channel description when no project is linked", () => {
    const messages = createDesktopMessages("zh-CN");
    const data = createSleiFixtures({
      channels: [{ id: "dev-content", name: "dev-content", description: "频道", projectPaths: [], unread: 0 }],
    });

    const html = renderToStaticMarkup(
      <ChatPage
        activeChannel={data.channels[0]}
        data={data}
        messages={messages}
        profile={defaultProfile}
      />,
    );

    expect(html).toContain(messages.chat.projectPrefix(messages.chat.noLinkedProjects));
    expect(html).not.toContain(">频道</p>");
  });

  it("does not render the project edit button for the all channel", () => {
    const messages = createDesktopMessages("zh-CN");
    const data = createSleiFixtures({
      channels: [{ id: "all", name: "all", description: "默认团队频道", projectPaths: [], unread: 0 }],
    });

    const html = renderToStaticMarkup(
      <ChatPage
        activeChannel={data.channels[0]}
        data={data}
        messages={messages}
        profile={defaultProfile}
      />,
    );

    expect(html).not.toContain(`aria-label="${messages.chat.editProjects}"`);
    expect(html).not.toContain('data-testid="slei-channel-project-edit"');
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
    expect(button?.querySelector('[data-slei-icon="arrowDown"]')).not.toBeNull();
    expect(button?.className).toContain("h-8");
    expect(button?.className).toContain("px-3.5");
    expect(button?.className).toContain("border-primary");
    expect(button?.className).toContain("bg-white");
    expect(button?.className).toContain("text-primary");
    expect(button?.className).toContain("text-xs");

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
    expect(readChatPageSource()).toContain('data-testid="slei-channel-member-add-dialog"');
    expect(readChatPageSource()).toContain("DialogContent");
    expect(panelHtml.slice(0, panelHtml.indexOf('data-radix-scroll-area-viewport'))).toContain('width="18"');
    expect(panelHtml.slice(0, panelHtml.indexOf('data-radix-scroll-area-viewport'))).toContain('height="18"');
    expect(readChatPageSource()).not.toContain("absolute right-2 top-8");
    expect(html).toContain('data-slei-icon="plus"');
    expect(readChatPageSource()).toContain('data-testid="slei-channel-member-add-candidate"');
    expect(readChatPageSource()).toContain('data-testid="slei-channel-member-add-candidate-checkbox"');
    expect(readChatPageSource()).toContain('data-testid="slei-channel-member-add-candidate-description"');
    expect(readChatPageSource()).toContain("block min-w-0 max-w-full overflow-hidden text-ellipsis whitespace-nowrap");
    expect(readChatPageSource()).toContain("{member.name}</strong>");
    expect(readChatPageSource()).toContain("{member.handle}</small>");
    expect(readChatPageSource()).toContain("{member.description}");
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
    expect(panelHtml).toContain('data-slei-icon="delete"');
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
    expect(closedToggleHtml.slice(0, closedToggleHtml.indexOf("</button>"))).toContain('data-slei-icon="panelOpen"');
    expect(closedToggleHtml.slice(0, closedToggleHtml.indexOf("</button>"))).not.toContain('data-slei-icon="members"');
    expect(headerHtml).not.toContain('role="tablist"');
    expect(source).toContain('className="border-b px-4 py-2"');
    expect(source).not.toContain('aria-pressed={channelMembersOpen ? "true" : "false"}');
  });

  it("renders embedded chat tasks and files tabs with the soft variant", () => {
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

    const tabsStart = html.indexOf('data-testid="slei-channel-view-tabs"');
    const tabsHtml = html.slice(tabsStart, html.indexOf("</div>", tabsStart));

    expect(tabsStart).toBeGreaterThanOrEqual(0);
    expect(tabsHtml).toContain('data-variant="soft"');
    expect(tabsHtml).toContain(messages.shell.nav.chat);
    expect(tabsHtml).toContain(messages.chat.tasks);
    expect(tabsHtml).toContain(messages.chat.files);
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
    expect(toggleHtml.slice(0, toggleHtml.indexOf("</button>"))).toContain('data-slei-icon="panelClose"');
    expect(toggleHtml.slice(0, toggleHtml.indexOf("</button>"))).not.toContain('data-slei-icon="members"');
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

    expect(source).toContain("selectedAddIds");
    expect(source).toContain("data-testid=\"slei-channel-member-add-confirm\"");
    expect(source).toContain("addSelectedMembers");
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

  it("adds multiple selected channel members from a modal", async () => {
    const messages = createDesktopMessages("zh-CN");
    const onChannelMemberAdd = vi.fn().mockResolvedValue(undefined);
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
          id: "agent_luna",
          name: "Luna",
          handle: "@luna",
        },
      ],
    });

    const host = await mountChatPage(
      <ChatPage
        activeChannel={data.channels[0]}
        data={data}
        initialChannelMembersOpen
        messages={messages}
        onChannelMemberAdd={onChannelMemberAdd}
        profile={defaultProfile}
      />,
    );

    const addButton = host.querySelector<HTMLButtonElement>(`[aria-label="${messages.chat.addChannelMember}"]`);
    await act(async () => {
      addButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const dialog = document.body.querySelector('[data-testid="slei-channel-member-add-dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.getAttribute("role")).toBe("dialog");

    const candidateButtons = [...document.body.querySelectorAll<HTMLButtonElement>('[data-testid="slei-channel-member-add-candidate"]')];
    expect(candidateButtons).toHaveLength(2);
    await act(async () => {
      candidateButtons[0]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      candidateButtons[1]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const checkedBoxes = [...document.body.querySelectorAll('[data-testid="slei-channel-member-add-candidate-checkbox"]')]
      .filter((checkbox) => checkbox.getAttribute("data-state") === "checked");
    expect(checkedBoxes).toHaveLength(2);

    await act(async () => {
      document.body.querySelector<HTMLButtonElement>('[data-testid="slei-channel-member-add-confirm"]')?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onChannelMemberAdd).toHaveBeenCalledTimes(2);
    expect(onChannelMemberAdd).toHaveBeenNthCalledWith(1, "agent_architect");
    expect(onChannelMemberAdd).toHaveBeenNthCalledWith(2, "agent_luna");
    expect(document.body.querySelector('[data-testid="slei-channel-member-add-dialog"]')).toBeNull();
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

  it("keeps timeline message selectors and actions available on flat rows", () => {
    const messages = createDesktopMessages("zh-CN");
    const data = createSleiFixtures({
      channels: [{ id: "all", name: "all", description: "测试频道", unread: 0 }],
      messages: [
        {
          id: "msg-contract",
          author: "Lei",
          handle: "@lei",
          role: "human",
          time: "10:00",
          body: "保留消息行动作。",
          channelId: "all",
        },
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
    const messageHtml = html.slice(html.indexOf('data-message-id="msg-contract"'));
    const messageOpenTag = messageHtml.slice(0, messageHtml.indexOf(">"));

    expect(messageHtml).toContain('data-message-id="msg-contract"');
    expect(messageHtml).toContain('data-variant="flat"');
    expect(messageOpenTag).toContain("border-transparent");
    expect(messageOpenTag).toContain("bg-transparent");
    expect(messageOpenTag).toContain("hover:border-border/50");
    expect(messageOpenTag).not.toContain("bg-card");
    expect(messageOpenTag).not.toContain("bg-muted");
    expect(messageOpenTag).not.toContain("bg-primary/5");
    expect(messageOpenTag).not.toContain("shadow-");
    expect(messageOpenTag).not.toContain("hover:shadow");
    expect(messageHtml).toContain('data-slot="message-actions"');
    expect(messageHtml).toContain('data-message-thread-open="msg-contract"');
    expect(messageHtml).toContain(`aria-label="${messages.chat.copyMessage}"`);
    expect(messageHtml).toContain(`aria-label="${messages.chat.saveMessage}"`);
  });

  it("adds a border only to the focused timeline message", () => {
    const messages = createDesktopMessages("zh-CN");
    const data = createSleiFixtures({
      channels: [{ id: "all", name: "all", description: "测试频道", unread: 0 }],
      messages: [
        {
          id: "msg-focused",
          author: "Lei",
          role: "human",
          time: "10:00",
          body: "搜索定位到这一条。",
          channelId: "all",
        },
      ],
    });

    const html = renderToStaticMarkup(
      <ChatPage
        activeChannel={data.channels[0]}
        data={data}
        focusedMessageId="msg-focused"
        messages={messages}
        profile={defaultProfile}
      />,
    );
    const messageHtml = html.slice(html.indexOf('data-message-id="msg-focused"'));
    const messageOpenTag = messageHtml.slice(0, messageHtml.indexOf(">"));

    expect(messageOpenTag).toContain("data-[focused=true]:border-primary/35");
    expect(messageOpenTag).not.toContain("data-[focused=true]:bg-primary/5");
    expect(messageOpenTag).not.toContain("data-[focused=true]:ring-1");
  });

  it("renders create agent and channel cards as flat surfaces", () => {
    const messages = createDesktopMessages("zh-CN");
    const data = createSleiFixtures({
      channels: [{ id: "all", name: "all", description: "测试频道", unread: 0 }],
      messages: [
        {
          id: "msg-cards",
          author: "Yeal",
          role: "agent",
          time: "10:00",
          body: "已准备创建卡片。",
          channelId: "all",
          cards: [
            {
              id: "card_agent",
              kind: "createAgent",
              state: "pending",
              title: "创建 Coda",
              summary: "Coda · ClaudeCode / Sonnet",
              draft: { name: "Coda" },
              actionLabel: "创建",
              doneLabel: "DONE",
            },
            {
              id: "card_channel",
              kind: "createChannel",
              state: "pending",
              title: "创建 #qa",
              summary: "#qa",
              draft: { name: "qa", description: "QA 协作频道", projectPaths: [], agentIds: [] },
              actionLabel: "创建",
              doneLabel: "DONE",
            },
          ],
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

    for (const kind of ["createAgent", "createChannel"]) {
      const cardHtml = html.slice(html.indexOf(`data-card-kind="${kind}"`));
      const cardOpenTag = cardHtml.slice(0, cardHtml.indexOf(">"));

      expect(cardHtml).toContain(`data-card-kind="${kind}"`);
      expect(cardHtml).toContain('data-variant="surface"');
      expect(cardOpenTag).not.toContain("shadow-");
      expect(cardOpenTag).not.toContain("hover:shadow");
    }
  });

  it("keeps task root entry status and source message behavior on flat rows", () => {
    const messages = createDesktopMessages("zh-CN");
    const data = createSleiFixtures({
      channels: [{ id: "all", name: "all", description: "测试频道", unread: 0 }],
      messages: [
        {
          id: "msg-task-source",
          author: "Lei",
          handle: "@lei",
          role: "human",
          time: "10:00",
          body: "把这条变成任务。",
          channelId: "all",
        },
      ],
      tasks: [
        {
          id: "task-msg-task-source",
          title: "把这条变成任务。",
          owner: "Lei",
          status: "in_progress",
          channelId: "all",
          sourceMessageId: "msg-task-source",
          replies: [{ id: "root-msg-task-source", sender: "Lei", body: "把这条变成任务。" }],
        },
      ],
    });

    const html = renderToStaticMarkup(
      <ChatPage
        activeChannel={data.channels[0]}
        data={data}
        messages={messages}
        onTaskThreadOpen={() => undefined}
        profile={defaultProfile}
      />,
    );
    const taskRootHtml = html.slice(html.indexOf('data-task-root-entry="task-msg-task-source"'));
    const taskRootOpenTag = taskRootHtml.slice(0, taskRootHtml.indexOf(">"));

    expect(taskRootHtml).toContain('data-task-root-entry="task-msg-task-source"');
    expect(taskRootHtml).toContain('data-source-message-id="msg-task-source"');
    expect(taskRootHtml).toContain('data-variant="flat"');
    expect(taskRootOpenTag).toContain("bg-transparent");
    expect(taskRootOpenTag).toContain("hover:border-border/50");
    expect(taskRootOpenTag).not.toContain("shadow-");
    expect(taskRootOpenTag).not.toContain("hover:shadow");
    expect(taskRootHtml).toContain('data-task-root-entry-status');
    expect(taskRootHtml).toContain(messages.tasks.status.in_progress);
    expect(taskRootHtml).toContain('data-task-root-entry-replies');
    expect(taskRootHtml).toContain("把这条变成任务。");
  });

  it("keeps only the composer input recessed while the outer surface stays flat", async () => {
    const messages = createDesktopMessages("zh-CN");
    const onSendMessage = vi.fn().mockResolvedValue(undefined);
    const data = createSleiFixtures({
      channels: [{ id: "all", name: "all", description: "测试频道", unread: 0 }],
    });

    const host = await mountChatPage(
      <ChatPage
        activeChannel={data.channels[0]}
        data={data}
        initialDraft="保持提交行为"
        messages={messages}
        onSendMessage={onSendMessage}
        profile={defaultProfile}
      />,
    );

    expect(host.querySelector('[data-testid="slei-composer-surface"]')?.getAttribute("data-variant")).toBe("flat");
    expect(host.querySelector('[data-testid="slei-composer-surface"]')?.className).toContain("border-transparent");
    expect(host.querySelector('[data-testid="slei-composer-surface"]')?.className).not.toContain("border-border");
    expect(host.querySelector('[data-testid="slei-composer-surface"]')?.className).not.toContain("slei-shadow-inset");
    const composerInput = host.querySelector('[data-testid="slei-composer-input"]');
    const appCss = readFileSync(join(process.cwd(), "src/app/app.css"), "utf8");

    expect(composerInput?.className).toContain("slei-composer-input");
    expect(composerInput?.className).not.toContain("border-border/60");
    expect(appCss).toContain(".slei-composer-input {");
    expect(appCss).toContain("border-color: var(--slei-inset-border);");
    expect(appCss).toContain("box-shadow: var(--slei-shadow-inset-s);");
    expect(appCss).toContain(".slei-composer-input:focus-visible {");
    expect(appCss).toContain("box-shadow: var(--slei-shadow-inset-s), 0 0 0 1px");

    await act(async () => {
      host.querySelector<HTMLButtonElement>('[data-testid="slei-send-button"]')?.click();
    });

    expect(onSendMessage).toHaveBeenCalledTimes(1);
    expect(onSendMessage).toHaveBeenCalledWith("保持提交行为", {
      asTask: false,
      attachmentIds: [],
      sessionId: undefined,
    });
    expect(host.querySelector<HTMLTextAreaElement>('[data-testid="slei-composer-input"]')?.value).toBe("");
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

  it("renders channel message markdown with card foreground text for dark theme contrast", () => {
    const messages = createDesktopMessages("zh-CN");
    const data = createSleiFixtures({
      channels: [{ id: "all", name: "all", description: "测试频道", unread: 0 }],
      messages: [
        {
          id: "msg-dark-contrast",
          author: "Yeal",
          role: "agent",
          time: "14:20",
          body: "暗色模式下正文必须可读。",
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

    const messageStart = html.indexOf('data-message-id="msg-dark-contrast"');
    const markdownStart = html.indexOf("slei-markdown-message", messageStart);
    const markdownHtml = html.slice(markdownStart, html.indexOf("</section>", markdownStart));
    const appCss = readFileSync(join(process.cwd(), "src/app/app.css"), "utf8");

    expect(messageStart).toBeGreaterThanOrEqual(0);
    expect(markdownStart).toBeGreaterThan(messageStart);
    expect(markdownHtml).toContain("text-card-foreground");
    expect(markdownHtml).toContain("--slei-markdown-foreground:var(--card-foreground)");
    expect(markdownHtml).not.toContain("text-foreground");
    expect(appCss).toContain("color: var(--slei-markdown-foreground, var(--color-text-primary));");
    expect(appCss).not.toContain(".slei-markdown-message {\n  color: var(--color-text-primary);");
  });

  it("keeps task root entries visually aligned with normal transparent message rows", () => {
    const source = readFileSync(join(process.cwd(), "src/features/chat/TaskRootEntry.tsx"), "utf8");

    expect(source).toContain("bg-transparent");
    expect(source).toContain("hover:border-border/50");
    expect(source).toContain('variant="flat"');
    expect(source).not.toContain('variant="surface"');
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
