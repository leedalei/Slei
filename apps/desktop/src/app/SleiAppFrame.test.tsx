// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { createDemoMembers, createSleiFixtures } from "../test/fixtures";
import { SleiAppFrame } from "./SleiAppFrame";

const runtimeSetup = {
  loading: false,
  hasClaudeRuntimeReady: true,
  nodes: [],
};

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
    expect(html).toContain('grid-template-columns:5.5rem minmax(0, 1fr)');
  });

  it("removes the old search button from the channel list sidebar", () => {
    const source = readFileSync(join(process.cwd(), "src/app/SleiAppFrame.tsx"), "utf8");
    const channelListSource = source.slice(source.indexOf("function ChannelList"), source.indexOf("function SavedMessagesPanel"));

    expect(channelListSource).not.toContain("onSearchToggle");
    expect(channelListSource).not.toContain("searchOpen");
    expect(channelListSource).not.toContain("Command K");
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
