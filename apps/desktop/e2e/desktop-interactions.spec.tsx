import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { createLocalChatMessage, SleiAppFrame } from "../src/app/SleiApp";
import { createDemoMembers, createSleiFixtures } from "../src/app/fixtures";

const readyRuntime = {
  loading: false,
  error: undefined,
  hasClaudeRuntimeReady: true,
  nodes: createSleiFixtures().nodes,
};

describe("desktop interaction fixes", () => {
  it("renders the primary menu as accessible icon controls", () => {
    const html = renderToStaticMarkup(
      <SleiAppFrame activeView="chat" data={createSleiFixtures()} locale="zh-CN" runtimeSetup={readyRuntime} />,
    );

    expect(html).toContain('aria-label="聊天"');
    expect(html).toContain('data-nav-icon="chat"');
    expect(html).toContain('aria-label="设置"');
    expect(html).toContain('data-nav-icon="settings"');
    expect(html).not.toContain("<small>Chat</small>");
  });

  it("exposes a draggable sidebar splitter between context and workspace", () => {
    const html = renderToStaticMarkup(
      <SleiAppFrame activeView="chat" data={createSleiFixtures()} locale="zh-CN" runtimeSetup={readyRuntime} />,
    );

    expect(html).toContain("slei-resize-handle");
    expect(html).toContain('role="separator"');
    expect(html).toContain('aria-orientation="vertical"');
  });

  it("adds editable profile settings for display name handle and avatar", () => {
    const html = renderToStaticMarkup(
      <SleiAppFrame activeView="settings" data={createSleiFixtures()} locale="zh-CN" runtimeSetup={readyRuntime} />,
    );

    expect(html).toContain("slei-settings-page");
    expect(html).toContain("slei-settings-stack");
    expect(html).toContain("slei-profile-avatar-presets");
    expect(html).not.toContain("slei-settings-grid");
    expect(html).not.toContain("slei-profile-settings");
    expect(html).toContain("显示名称");
    expect(html).toContain("@");
    expect(html).toContain("头像");
    expect(html).toContain("像素头像选项");
    expect(html).toContain("Lei");
    expect(html).toContain("@lei");
  });

  it("creates local chat messages from the composer and rejects empty sends", () => {
    const sent = createLocalChatMessage({
      body: "  ship the composer  ",
      profile: { displayName: "Lei", handle: "@lei", avatar: "LL" },
    });

    expect(sent?.author).toBe("Lei");
    expect(sent?.body).toBe("ship the composer");
    expect(sent?.handle).toBe("@lei");
    expect(createLocalChatMessage({ body: "   ", profile: { displayName: "Lei", handle: "@lei", avatar: "LL" } })).toBeNull();
  });

  it("shows runtime status dots for idle busy and offline agents", () => {
    const members = createDemoMembers()
      .filter((member) => member.type === "agent")
      .map((member) => (member.name === "Alice" ? { ...member, runtimeStatus: "offline" as const } : member));
    const html = renderToStaticMarkup(
      <SleiAppFrame activeView="members" data={createSleiFixtures({ members })} locale="zh-CN" runtimeSetup={readyRuntime} />,
    );

    expect(html).toContain("slei-status-dot--idle");
    expect(html).toContain("slei-status-dot--busy");
    expect(html).toContain("slei-status-dot--offline");
  });
});
