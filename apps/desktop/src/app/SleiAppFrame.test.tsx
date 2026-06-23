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
  window.localStorage.clear();
});

describe("SleiAppFrame appearance preferences", () => {
  it("syncs the font size preference to the document root and restores it on unmount", async () => {
    document.documentElement.style.fontSize = "13px";
    document.documentElement.style.setProperty("--slei-font-size", "13px");
    document.documentElement.style.setProperty("--text-sm", "12px");

    const container = await mount(
      <SleiAppFrame
        activeView="settings"
        appearance={{ theme: "light", fontSize: "lg" }}
        data={createSleiFixtures()}
        initialSettingsPanel="appearance"
        locale="zh-CN"
        runtimeSetup={runtimeSetup}
      />,
    );

    expect(container.querySelector("[data-font-size='lg']")).not.toBeNull();
    expect(document.documentElement.style.fontSize).toBe("16px");
    expect(document.documentElement.style.getPropertyValue("--slei-font-size")).toBe("16px");
    expect(document.documentElement.style.getPropertyValue("--text-sm")).toBe("14px");
    expect(document.documentElement.style.getPropertyValue("--text-base")).toBe("16px");

    await act(async () => {
      mountedRoot?.render(
        <SleiAppFrame
          activeView="settings"
          appearance={{ theme: "light", fontSize: "sm" }}
          data={createSleiFixtures()}
          initialSettingsPanel="appearance"
          locale="zh-CN"
          runtimeSetup={runtimeSetup}
        />,
      );
    });
    await act(async () => undefined);

    expect(document.documentElement.style.fontSize).toBe("14px");
    expect(document.documentElement.style.getPropertyValue("--slei-font-size")).toBe("14px");
    expect(document.documentElement.style.getPropertyValue("--text-sm")).toBe("12px");
    expect(document.documentElement.style.getPropertyValue("--text-base")).toBe("14px");

    await act(async () => {
      mountedRoot?.unmount();
    });
    mountedRoot = undefined;

    expect(document.documentElement.style.fontSize).toBe("13px");
    expect(document.documentElement.style.getPropertyValue("--slei-font-size")).toBe("13px");
    expect(document.documentElement.style.getPropertyValue("--text-sm")).toBe("12px");
  });

  it("updates tokens used by explicit text utility nodes", async () => {
    const container = await mount(
      <SleiAppFrame
        activeView="settings"
        appearance={{ theme: "light", fontSize: "lg" }}
        data={createSleiFixtures()}
        initialSettingsPanel="appearance"
        locale="zh-CN"
        runtimeSetup={runtimeSetup}
      />,
    );

    const description = container.querySelector<HTMLElement>("[data-testid='slei-settings-panel-header'] p");

    expect(description).not.toBeNull();
    expect(description?.className).toContain("text-sm");
    expect(document.documentElement.style.getPropertyValue("--text-sm")).toBe("14px");
  });
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
    expect(html).toContain('grid-template-columns:5.25rem minmax(0, 1fr)');
  });

  it("uses a wider left rail with the existing navigation button footprint", () => {
    const html = renderToStaticMarkup(
      <SleiAppFrame
        activeView="chat"
        data={createSleiFixtures()}
        locale="zh-CN"
        runtimeSetup={runtimeSetup}
      />,
    );

    expect(html).toContain('grid-template-columns:5.25rem var(--slei-sidebar-width, 15rem) 0.5rem minmax(0, 1fr)');
    expect(html).toContain("grid h-14 w-14 place-items-center");
  });

  it("opens primary navigation icon tooltips on the right side of the menubar", () => {
    const source = readFileSync(join(process.cwd(), "src/app/SleiAppFrame.tsx"), "utf8");
    const navSource = source.slice(source.indexOf("<nav "), source.indexOf("</nav>"));

    expect(navSource).toContain('tooltipSide="right"');
  });

  it("keeps the macOS traffic lights visually centered in the widened rail", () => {
    const tauriConfig = JSON.parse(readFileSync(join(process.cwd(), "src-tauri/tauri.conf.json"), "utf8")) as {
      app: { windows: Array<{ trafficLightPosition?: { x: number; y: number } }> };
    };

    expect(tauriConfig.app.windows[0]?.trafficLightPosition).toEqual({ x: 8, y: 18 });
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

  it("shows linked project labels for non-default channels while preserving the all channel description", () => {
    const data = createSleiFixtures({
      channels: [
        { id: "all", name: "all", description: "默认团队频道", unread: 0, activeSessionId: "session:all" },
        { id: "dev-content", name: "dev-content", description: "频道", projectPaths: [], unread: 0, activeSessionId: "session:dev" },
        { id: "kol", name: "kol", description: "频道", projectPaths: ["/workspace/kol"], unread: 0, activeSessionId: "session:kol" },
      ],
    });

    const html = renderToStaticMarkup(
      <SleiAppFrame
        activeView="chat"
        data={data}
        locale="zh-CN"
        runtimeSetup={{ ...runtimeSetup, nodes: data.nodes }}
      />,
    );

    expect(html).toContain("默认团队频道");
    expect(html).toContain("关联项目：暂无");
    expect(html).toContain("关联项目：/workspace/kol");
    expect(html).not.toContain(">频道</small>");
  });

  it("cycles channel and direct message sorting independently by name", async () => {
    const members = createDemoMembers();
    const data = createSleiFixtures({
      members,
      channels: [
        { id: "zeta", name: "zeta", description: "Zeta channel", unread: 0, activeSessionId: "session:zeta" },
        { id: "alpha", name: "alpha", description: "Alpha channel", unread: 0, activeSessionId: "session:alpha" },
        { id: "beta", name: "beta", description: "Beta channel", unread: 0, activeSessionId: "session:beta" },
      ],
      conversations: [
        { id: "dm:a1", agentId: "a1", kind: "dm", activeSessionId: "session-dm-a1", createdAt: "0", updatedAt: "0" },
        { id: "dm:a2", agentId: "a2", kind: "dm", activeSessionId: "session-dm-a2", createdAt: "0", updatedAt: "0" },
        { id: "dm:a3", agentId: "a3", kind: "dm", activeSessionId: "session-dm-a3", createdAt: "0", updatedAt: "0" },
      ],
    });
    const container = await mount(
      <SleiAppFrame
        activeView="chat"
        data={data}
        locale="zh-CN"
        runtimeSetup={{ ...runtimeSetup, nodes: data.nodes }}
      />,
    );
    const click = async (button: HTMLButtonElement) => {
      await act(async () => {
        button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
    };
    const channelSortButton = () => container.querySelector<HTMLButtonElement>('[data-sort-target="channels"]');
    const directMessageSortButton = () => container.querySelector<HTMLButtonElement>('[data-sort-target="direct-messages"]');
    const channelOrder = () => Array.from(container.querySelectorAll<HTMLElement>("[data-channel-list-item]")).map((item) => item.dataset.channelId);
    const directMessageOrder = () => Array.from(container.querySelectorAll<HTMLElement>("[data-direct-message-list-item]")).map((item) => item.dataset.conversationId);

    expect(channelOrder()).toEqual(["zeta", "alpha", "beta"]);
    expect(directMessageOrder()).toEqual(["dm:a1", "dm:a2", "dm:a3"]);
    expect(channelSortButton()?.dataset.sortState).toBe("default");
    expect(channelSortButton()?.getAttribute("aria-label")).toBe("升序");
    expect(channelSortButton()?.querySelector("[data-sort-direction]")?.getAttribute("data-sort-direction")).toBe("default");

    await click(channelSortButton()!);
    expect(channelOrder()).toEqual(["alpha", "beta", "zeta"]);
    expect(directMessageOrder()).toEqual(["dm:a1", "dm:a2", "dm:a3"]);
    expect(channelSortButton()?.dataset.sortState).toBe("asc");
    expect(channelSortButton()?.getAttribute("aria-label")).toBe("降序");
    expect(channelSortButton()?.querySelector("[data-sort-direction]")?.getAttribute("data-sort-direction")).toBe("asc");
    expect(window.localStorage.getItem("slei:sidebar-sort:channels")).toBe("asc");

    await click(channelSortButton()!);
    expect(channelOrder()).toEqual(["zeta", "beta", "alpha"]);
    expect(channelSortButton()?.dataset.sortState).toBe("desc");
    expect(channelSortButton()?.getAttribute("aria-label")).toBe("取消排序");
    expect(channelSortButton()?.querySelector("[data-sort-direction]")?.getAttribute("data-sort-direction")).toBe("desc");
    expect(window.localStorage.getItem("slei:sidebar-sort:channels")).toBe("desc");

    await click(channelSortButton()!);
    expect(channelOrder()).toEqual(["zeta", "alpha", "beta"]);
    expect(channelSortButton()?.dataset.sortState).toBe("default");
    expect(channelSortButton()?.getAttribute("aria-label")).toBe("升序");
    expect(window.localStorage.getItem("slei:sidebar-sort:channels")).toBe("default");

    await click(directMessageSortButton()!);
    expect(channelOrder()).toEqual(["zeta", "alpha", "beta"]);
    expect(directMessageOrder()).toEqual(["dm:a3", "dm:a2", "dm:a1"]);
    expect(directMessageSortButton()?.dataset.sortState).toBe("asc");
    expect(directMessageSortButton()?.getAttribute("aria-label")).toBe("降序");
    expect(directMessageSortButton()?.querySelector("[data-sort-direction]")?.getAttribute("data-sort-direction")).toBe("asc");
    expect(window.localStorage.getItem("slei:sidebar-sort:direct-messages")).toBe("asc");
  });

  it("restores channel and direct message sort preferences from frontend storage", async () => {
    window.localStorage.setItem("slei:sidebar-sort:channels", "desc");
    window.localStorage.setItem("slei:sidebar-sort:direct-messages", "asc");
    const members = createDemoMembers();
    const data = createSleiFixtures({
      members,
      channels: [
        { id: "zeta", name: "zeta", description: "Zeta channel", unread: 0, activeSessionId: "session:zeta" },
        { id: "alpha", name: "alpha", description: "Alpha channel", unread: 0, activeSessionId: "session:alpha" },
        { id: "beta", name: "beta", description: "Beta channel", unread: 0, activeSessionId: "session:beta" },
      ],
      conversations: [
        { id: "dm:a1", agentId: "a1", kind: "dm", activeSessionId: "session-dm-a1", createdAt: "0", updatedAt: "0" },
        { id: "dm:a2", agentId: "a2", kind: "dm", activeSessionId: "session-dm-a2", createdAt: "0", updatedAt: "0" },
        { id: "dm:a3", agentId: "a3", kind: "dm", activeSessionId: "session-dm-a3", createdAt: "0", updatedAt: "0" },
      ],
    });
    const container = await mount(
      <SleiAppFrame
        activeView="chat"
        data={data}
        locale="zh-CN"
        runtimeSetup={{ ...runtimeSetup, nodes: data.nodes }}
      />,
    );

    expect(Array.from(container.querySelectorAll<HTMLElement>("[data-channel-list-item]")).map((item) => item.dataset.channelId)).toEqual(["zeta", "beta", "alpha"]);
    expect(Array.from(container.querySelectorAll<HTMLElement>("[data-direct-message-list-item]")).map((item) => item.dataset.conversationId)).toEqual(["dm:a3", "dm:a2", "dm:a1"]);
    expect(container.querySelector<HTMLButtonElement>('[data-sort-target="channels"]')?.dataset.sortState).toBe("desc");
    expect(container.querySelector<HTMLButtonElement>('[data-sort-target="direct-messages"]')?.dataset.sortState).toBe("asc");
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
