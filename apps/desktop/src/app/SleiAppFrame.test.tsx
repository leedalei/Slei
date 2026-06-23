// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";

import { createDemoMembers, createSleiFixtures } from "../test/fixtures";
import { SleiAppFrame } from "./SleiAppFrame";
import type { SleiMessage } from "./types";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as typeof globalThis & { ResizeObserver?: typeof ResizeObserver }).ResizeObserver ??= class ResizeObserver {
  disconnect() {}
  observe() {}
  unobserve() {}
};

const runtimeSetup = {
  loading: false,
  hasClaudeRuntimeReady: true,
  nodes: [],
};

let mountedRoot: Root | undefined;
let mountedContainer: HTMLDivElement | undefined;

async function mount(element: React.ReactElement) {
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
  document.body.innerHTML = "";
});

describe("SleiAppFrame global search navigation", () => {
  it("renders search as an active far-left rail item", () => {
    const html = renderToStaticMarkup(
      <SleiAppFrame
        activeView="search"
        data={createSleiFixtures()}
        locale="en-US"
        runtimeSetup={runtimeSetup}
      />,
    );

    const navStart = html.indexOf('aria-label="Main navigation"');
    const searchIndex = html.indexOf('data-nav-icon="search"', navStart);
    const chatIndex = html.indexOf('data-nav-icon="chat"', navStart);

    expect(searchIndex).toBeGreaterThan(navStart);
    expect(chatIndex).toBeGreaterThan(searchIndex);
    expect(html.slice(Math.max(navStart, searchIndex - 500), searchIndex + 220)).toContain('aria-current="page"');
  });

  it("renders global search without the conversation sidebar", () => {
    const html = renderToStaticMarkup(
      <SleiAppFrame
        activeView="search"
        data={createSleiFixtures()}
        locale="en-US"
        runtimeSetup={runtimeSetup}
      />,
    );

    expect(html).toContain('data-active-view="search"');
    expect(html).not.toContain('class="slei-context-sidebar');
    expect(html).not.toContain('aria-label="Resize sidebar"');
    expect(html).not.toContain('data-slot="sidebar-titlebar"');
    expect(html).toContain('grid-template-columns:4.75rem minmax(0, 1fr)');
  });

  it("uses a compact left rail and navigation button footprint", () => {
    const html = renderToStaticMarkup(
      <SleiAppFrame
        activeView="chat"
        data={createSleiFixtures()}
        locale="zh-CN"
        runtimeSetup={runtimeSetup}
      />,
    );

    expect(html).toContain('grid-template-columns:4.75rem var(--slei-sidebar-width, 15rem) 0.5rem minmax(0, 1fr)');
    expect(html).toContain("grid h-14 w-14 place-items-center");
  });

  it("removes the old search button from the channel list sidebar", () => {
    const source = readFileSync(join(process.cwd(), "src/app/SleiAppFrame.tsx"), "utf8");
    const channelListSource = source.slice(source.indexOf("function ChannelList"), source.indexOf("function SavedMessagesWorkspace"));

    expect(channelListSource).not.toContain("onSearchToggle");
    expect(channelListSource).not.toContain("searchOpen");
    expect(channelListSource).not.toContain("Command K");
  });

  it("renders saved messages in the right workspace while keeping channels and DMs in the sidebar", () => {
    const members = createDemoMembers();
    const data = createSleiFixtures({
      members,
      conversations: [{ id: "dm:a1", agentId: "a1", kind: "dm", activeSessionId: "session-dm-a1", createdAt: "0", updatedAt: "0" }],
    });

    const html = renderToStaticMarkup(
      <SleiAppFrame
        activeChatWorkspace="saved"
        activeView="chat"
        data={data}
        locale="zh-CN"
        runtimeSetup={{ ...runtimeSetup, nodes: data.nodes }}
        savedMessages={[{
          id: "saved:channel:all:msg_1",
          messageId: "msg_1",
          sourceId: "all",
          sourceKind: "channel",
          savedAt: "2026-06-22T09:00:00Z",
          body: "这是一条保存消息正文",
          authorId: "a1",
          authorName: "Coda",
          messageCreatedAt: "2026-06-22T08:59:00Z",
          sourceName: "all",
          sourceLabel: "群聊 · #all",
          messageDeleted: false,
        }]}
      />,
    );

    expect(html).toContain('data-testid="slei-saved-workspace"');
    expect(html).toContain(">频道 1</");
    expect(html).toContain(">私聊 1</");
    expect(html).toContain("这是一条保存消息正文");
    expect(html).toContain("群聊 · #all");
    expect(html).toContain("Coda");
    expect(html).toContain("发送于 2026-06-22");
    expect(html).toContain("保存于 2026-06-22");
  });

  it("uses the shared empty illustration in the members navigator empty state", () => {
    const html = renderToStaticMarkup(
      <SleiAppFrame
        activeView="members"
        data={createSleiFixtures({ members: [] })}
        locale="zh-CN"
        runtimeSetup={runtimeSetup}
      />,
    );

    expect(html).toContain("暂无智能体");
    expect(html).toContain('data-empty-illustration="nodata"');
  });

  it("does not show channel readiness copy before a channel is created", async () => {
    const host = await mount(
      <SleiAppFrame
        activeView="chat"
        data={createSleiFixtures({ members: createDemoMembers() })}
        locale="zh-CN"
        runtimeSetup={runtimeSetup}
      />,
    );

    const createButton = host.querySelector('button[aria-label="创建频道"]') as HTMLButtonElement | null;
    expect(createButton).toBeTruthy();
    await act(async () => {
      createButton?.click();
    });
    await act(async () => undefined);

    expect(document.body.textContent).toContain("选择 Agent");
    expect(document.body.textContent).toContain("Coda");
    expect(document.body.textContent).not.toContain("记忆同步中");
    expect(document.body.textContent).not.toContain("记忆失败");
  });

  it("shows command execution copy for an active channel agent tool event", () => {
    const members = createDemoMembers();
    const data = createSleiFixtures({
      members,
      messages: [{
        id: "agent-activity-msg_1-a1",
        author: "Coda",
        handle: "@coda",
        role: "agent",
        time: "",
        body: "",
        channelId: "all",
        status: "running",
        sourceMessageId: "msg_1",
        activityEventKind: "tool.started",
        activityToolName: "Bash",
        toolCall: "channel_agent_reply",
      } as SleiMessage & {
        activityEventKind: string;
        activityToolName: string;
      }],
    });

    const html = renderToStaticMarkup(
      <SleiAppFrame
        activeView="chat"
        data={data}
        locale="zh-CN"
        runtimeSetup={runtimeSetup}
      />,
    );

    expect(html).toContain('data-slot="agent-activity"');
    expect(html).toContain("正在执行命令");
    expect(html).not.toContain("正在思考");
  });

  it("marks sidebar category titles as unselectable", () => {
    const members = createDemoMembers();
    const data = createSleiFixtures({
      members,
      conversations: [{ id: "dm:a1", agentId: "a1", kind: "dm", activeSessionId: "session-dm-a1", createdAt: "0", updatedAt: "0" }],
    });
    const chatHtml = renderToStaticMarkup(
      <SleiAppFrame
        activeView="chat"
        data={data}
        locale="zh-CN"
        runtimeSetup={{ ...runtimeSetup, nodes: data.nodes }}
      />,
    );
    const computersHtml = renderToStaticMarkup(
      <SleiAppFrame
        activeView="computers"
        data={data}
        locale="zh-CN"
        runtimeSetup={{ ...runtimeSetup, nodes: data.nodes }}
      />,
    );

    expect(chatHtml).toContain('data-slot="sidebar-section-title"');
    expect(chatHtml).toContain('class="select-none');
    expect(chatHtml).toContain(">频道 1</");
    expect(chatHtml).toContain(">私聊 1</");
    expect(computersHtml).toContain('data-slot="sidebar-section-title"');
    expect(computersHtml).toContain(">设备 1</");
    for (const html of [chatHtml, computersHtml]) {
      const titleMatches = html.match(/data-slot="sidebar-section-title"[^>]*class="([^"]*)"/g) ?? [];
      expect(titleMatches.length).toBeGreaterThan(0);
      expect(titleMatches.every((match) => match.includes("select-none"))).toBe(true);
    }
  });
});
