import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { composerShortcutAction, createLocalChatMessage, isComposerImeComposing, SleiAppFrame } from "../src/app/SleiApp";
import { createDemoMembers, createSleiFixtures } from "../src/test/fixtures";

const readyRuntime = {
  loading: false,
  error: undefined,
  hasClaudeRuntimeReady: true,
  nodes: createSleiFixtures().nodes,
};

describe("desktop interaction fixes", () => {
  it("renders the workspace sidebar primary actions as accessible controls", () => {
    const html = renderToStaticMarkup(
      <SleiAppFrame activeView="chat" data={createSleiFixtures()} locale="zh-CN" runtimeSetup={readyRuntime} />,
    );

    expect(html).toContain('aria-label="工作区"');
    expect(html).toContain(">搜索</");
    expect(html).toContain(">任务</");
    expect(html).toContain('aria-label="打开设置菜单"');
    expect(html).not.toContain("data-nav-icon");
    expect(html).not.toContain("<small>Chat</small>");
  });

  it("exposes a draggable sidebar splitter between context and workspace", () => {
    const html = renderToStaticMarkup(
      <SleiAppFrame activeView="chat" data={createSleiFixtures()} locale="zh-CN" runtimeSetup={readyRuntime} />,
    );

    expect(html).toContain('aria-label="调整侧栏宽度"');
    expect(html).toContain('role="separator"');
    expect(html).toContain('aria-orientation="vertical"');
  });

  it("adds editable profile settings for display name handle and avatar", () => {
    const html = renderToStaticMarkup(
      <SleiAppFrame
        activeView="settings"
        data={createSleiFixtures()}
        locale="zh-CN"
        profile={{ displayName: "Lei", handle: "lei", avatar: "pixel-sun" }}
        runtimeSetup={readyRuntime}
      />,
    );

    expect(html).toContain('data-settings-panel="account"');
    expect(html).toContain('aria-label="像素头像选项"');
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

  it("does not submit or choose mentions while an IME composition is active", () => {
    expect(isComposerImeComposing({ nativeEvent: { isComposing: true } })).toBe(true);
    expect(isComposerImeComposing({ composing: true, nativeEvent: { isComposing: false } })).toBe(true);
    expect(isComposerImeComposing({ nativeEvent: { isComposing: false, keyCode: 229 } })).toBe(true);
    expect(isComposerImeComposing({ nativeEvent: { isComposing: false, which: 229 } })).toBe(true);
    expect(composerShortcutAction({ key: "Enter", composing: true })).toBe("none");
    expect(composerShortcutAction({ key: "Enter", composing: true, hasMentionTargets: true })).toBe("none");
    expect(composerShortcutAction({ key: "Tab", composing: true, hasMentionTargets: true })).toBe("none");

    expect(composerShortcutAction({ key: "Enter" })).toBe("submit");
    expect(composerShortcutAction({ key: "Enter", hasMentionTargets: true })).toBe("selectMention");
    expect(composerShortcutAction({ key: "Tab", hasMentionTargets: true })).toBe("selectMention");
    expect(composerShortcutAction({ key: "Enter", shiftKey: true })).toBe("none");
    expect(composerShortcutAction({ key: "Enter", shiftKey: true, hasMentionTargets: true })).toBe("none");
  });

  it("shows runtime status dots for idle busy and offline agents", () => {
    const members = createDemoMembers()
      .filter((member) => member.type === "agent")
      .map((member) => (member.name === "Alice" ? { ...member, runtimeStatus: "offline" as const } : member));
    const conversations = [
      { id: "dm:a1", agentId: "a1", kind: "dm" as const, activeSessionId: "session-dm-a1", createdAt: "0", updatedAt: "0" },
      { id: "dm:a3", agentId: "a3", kind: "dm" as const, activeSessionId: "session-dm-a3", createdAt: "0", updatedAt: "0" },
      { id: "dm:a4", agentId: "a4", kind: "dm" as const, activeSessionId: "session-dm-a4", createdAt: "0", updatedAt: "0" },
    ];
    const html = renderToStaticMarkup(
      <SleiAppFrame activeView="chat" data={createSleiFixtures({ conversations, members })} locale="zh-CN" runtimeSetup={readyRuntime} />,
    );

    expect(html).toContain('aria-label="idle"');
    expect(html).toContain('aria-label="busy"');
    expect(html).toContain('aria-label="offline"');
  });
});
