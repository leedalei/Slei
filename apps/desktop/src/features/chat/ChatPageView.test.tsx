import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { createSleiFixtures, type SleiMember } from "../../test/fixtures";
import { defaultProfile } from "../../app/model";
import { createDesktopMessages } from "../../i18n";
import { ChatPage } from "./ChatPageView";

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
    expect(html.match(/aria-hidden="true">｜/g)?.length).toBe(1);
  });

  it("keeps a bottom sentinel for post-send timeline scrolling", () => {
    const source = readChatPageSource();

    expect(source).toContain("timelineEndRef");
    expect(source).toContain("pendingScrollToBottomRef");
    expect(source).toContain("requestAnimationFrame");
    expect(source).toContain("scrollIntoView({ block: \"end\" })");
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
    expect(html).toContain("top-[calc(4rem+1px)]");
    expect(html).toContain("w-[min(20rem,calc(100%-2rem))]");
    expect(html).toContain("transition-transform duration-200 ease-out");
    expect(html).toContain("translate-x-0");
    expect(readChatPageSource()).toContain('data-testid="slei-channel-member-add-menu"');
    expect(html).toContain("lucide-plus");
    expect(html).toContain("Coda");
    expect(html).toContain("已就位");
    expect(html).toContain("添加成员");
    expect(html).not.toContain("lucide-x");
  });

  it("moves channel member controls from the header to a right edge toggle", () => {
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

    expect(html).toContain('data-testid="slei-channel-members-edge-toggle"');
    expect(html).toContain("top-[20%]");
    expect(html).toContain("active:!translate-y-0");
    expect(html).toContain("transition-[right,background-color,color] duration-200 ease-out");
    expect(html).toContain("right-0 bg-popover text-popover-foreground");
    expect(source).not.toContain("top-1/2");
    expect(source).not.toContain("-translate-y-1/2");
    expect(source).toContain('variant={channelMembersOpen ? "outline" : "secondary"}');
    expect(source).not.toContain('aria-pressed={channelMembersOpen ? "true" : "false"}');
  });

  it("uses the lighter edge toggle background while the channel member drawer is expanded", () => {
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
    expect(html).toContain("right-[min(20rem,calc(100%-2rem))]");
    const toggleHtml = html.slice(html.indexOf('data-testid="slei-channel-members-edge-toggle"'));
    expect(toggleHtml.slice(0, toggleHtml.indexOf("</button>"))).not.toContain("bg-popover text-popover-foreground");
  });

  it("keeps the channel member panel mounted as an animated right drawer", () => {
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

    expect(html).toContain('data-testid="slei-channel-member-panel"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("translate-x-full");
    expect(html).toContain("pointer-events-none");
  });

  it("keeps channel member add and remove mutations behind confirmation UI", () => {
    const source = readChatPageSource();

    expect(source).toContain("confirmingAddId");
    expect(source).toContain("setConfirmingAddId(member.id)");
    expect(source).toContain("mutate(member.id, \"add\")");
    expect(source).toContain("confirmingRemoveId");
    expect(source).toContain("setConfirmingRemoveId(member.id)");
    expect(source).toContain("mutate(member.id, \"remove\")");
    expect(source).toContain("group-hover/member:opacity-100");
  });
});

function readChatPageSource() {
  return readFileSync(new URL("./ChatPageView.tsx", import.meta.url), "utf8");
}
