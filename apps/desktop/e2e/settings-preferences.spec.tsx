import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SleiAppFrame } from "../src/app/SleiApp";
import { SettingsPage, runSettingsFireAndForgetAction } from "../src/features/settings/SettingsPageView";
import { createDesktopMessages } from "../src/i18n";
import { createSleiFixtures } from "../src/test/fixtures";
import { createDaemonBridgeMock } from "../src/test/daemon-bridge-mock";

const data = createSleiFixtures();
const readyRuntime = {
  loading: false,
  error: undefined,
  hasClaudeRuntimeReady: true,
  nodes: data.nodes,
};

describe("settings preferences", () => {
  it("renders the settings page while the workspace sidebar stays present", () => {
    const html = renderToStaticMarkup(
      <SleiAppFrame
        activeView="settings"
        data={data}
        locale="zh-CN"
        notifications={{ mentions: true, humanReplies: false, approvals: true }}
        runtimeSetup={readyRuntime}
      />,
    );

    expect(html).toContain("个人");
    expect(html).toContain("个人资料");
    expect(html).toContain("slei-workspace-sidebar");
    expect(html).toContain('data-font-size="md"');
    expect(html).toContain("--app-font-size:15px");
    expect(html).not.toContain("Runtime / 诊断");
    expect(html).not.toContain("诊断");
  });

  it("renders real language and region selectors with semantic option values", () => {
    const html = renderToStaticMarkup(
      <SleiAppFrame
        activeView="settings"
        data={data}
        initialSettingsPanel="language-region"
        locale="zh-CN"
        notifications={{ mentions: true, humanReplies: false, approvals: true }}
        runtimeSetup={readyRuntime}
        timeZone="Asia/Shanghai"
      />,
    );

    expect(html).toContain('aria-label="语言"');
    expect(html).toContain('aria-label="时区"');
    expect(html).toContain('id="settings-select-label-language"');
    expect(html).toContain('aria-labelledby="settings-select-label-language"');
    expect(html).toContain('id="settings-select-label-timezone"');
    expect(html).toContain('aria-labelledby="settings-select-label-timezone"');
    expect(html).toContain('data-slot="select-item"');
    expect(html).toContain('data-value="zh-CN"');
    expect(html).toContain('data-value="en-US"');
    expect(html).toContain('data-value="Asia/Shanghai"');
    expect(html).toContain(">中文<");
    expect(html).toContain(">English<");
    expect(html).not.toContain("data-settings-option=");
  });

  it("renders real notification controls without diagnostics", () => {
    const html = renderToStaticMarkup(
      <SleiAppFrame
        activeView="settings"
        data={data}
        initialSettingsPanel="notifications"
        locale="zh-CN"
        notifications={{ mentions: true, humanReplies: false, approvals: true }}
        runtimeSetup={readyRuntime}
      />,
    );

    expect(html).toContain("提及通知");
    expect(html).toContain("人工回复通知");
    expect(html).toContain("审批通知");
    expect(html.match(/role="switch"/g)).toHaveLength(3);
    expect(html.match(/aria-checked="true"/g)).toHaveLength(2);
    expect(html.match(/aria-checked="false"/g)).toHaveLength(1);
    expect(html).toContain('id="settings-notification-mentions"');
    expect(html).toContain('for="settings-notification-mentions"');
    expect(html).not.toContain("Runtime / 诊断");
    expect(html).not.toContain("诊断");
  });

  it("renders English settings labels when locale is en-US", () => {
    const html = renderToStaticMarkup(
      <SleiAppFrame
        activeView="settings"
        data={data}
        initialSettingsPanel="notifications"
        locale="en-US"
        notifications={{ mentions: true, humanReplies: true, approvals: true }}
        runtimeSetup={readyRuntime}
      />,
    );

    expect(html).toContain("Notifications");
    expect(html).toContain("Mention notifications");
    expect(html).not.toContain("个人资料");
  });

  it("renders account profile controls from the explicit profile contract", () => {
    const html = renderToStaticMarkup(
      <SleiAppFrame
        activeView="settings"
        data={data}
        initialSettingsPanel="account"
        locale="zh-CN"
        notifications={{ mentions: true, humanReplies: false, approvals: true }}
        profile={{ displayName: "Lei", handle: "lei", avatar: "pixel-sun" }}
        runtimeSetup={readyRuntime}
      />,
    );

    expect(html).toContain('aria-label="编辑显示名称"');
    expect(html).toContain("Lei");
    expect(html).toContain("@lei");
    expect(html).not.toContain('aria-label="编辑@"');
    expect(html).toContain('data-settings-avatar-option="pixel-sun"');
    expect(html).toContain('aria-pressed="true"');
  });

  it("renders account profile unavailable when profile is null", () => {
    const html = renderToStaticMarkup(
      <SleiAppFrame
        activeView="settings"
        data={data}
        initialSettingsPanel="account"
        locale="zh-CN"
        profile={null}
        runtimeSetup={readyRuntime}
      />,
    );

    expect(html).toContain("账户资料暂不可用");
    expect(html).not.toContain("data-settings-avatar-option");
  });

  it("renders pending preference and save error state without preference save buttons", () => {
    const html = renderToStaticMarkup(
      <SettingsPage
        activePanel="language-region"
        appearance={{ theme: "light", fontSize: "md" }}
        locale="zh-CN"
        messages={createDesktopMessages("zh-CN")}
        nodes={data.nodes}
        notifications={{ mentions: true, humanReplies: false, approvals: true }}
        pendingPreference="locale"
        preferenceError="保存失败"
        profile={{ displayName: "Lei", handle: "lei", avatar: "pixel-sun" }}
        timeZone="Asia/Shanghai"
      />,
    );

    expect(html).toContain('data-preference-pending="locale"');
    expect(html).toContain('role="alert"');
    expect(html).toContain("保存失败");
    expect(html).toMatch(/<button(?=[^>]*aria-label="语言")(?=[^>]*disabled="")[^>]*>/);
    expect(html).toMatch(/<button(?=[^>]*aria-label="时区")(?=[^>]*disabled="")[^>]*>/);
  });

  it("renders notification pending and save error state", () => {
    const html = renderToStaticMarkup(
      <SettingsPage
        activePanel="notifications"
        appearance={{ theme: "light", fontSize: "md" }}
        locale="zh-CN"
        messages={createDesktopMessages("zh-CN")}
        nodes={data.nodes}
        notifications={{ mentions: true, humanReplies: false, approvals: true }}
        pendingPreference="notifications"
        preferenceError="保存失败"
        profile={{ displayName: "Lei", handle: "lei", avatar: "pixel-sun" }}
        timeZone="Asia/Shanghai"
      />,
    );

    expect(html).toContain('data-preference-pending="notifications"');
    expect(html).toContain('role="alert"');
    expect(html).toContain("保存失败");
    expect(html.match(/<button(?=[^>]*role="switch")(?=[^>]*disabled="")[^>]*>/g)).toHaveLength(3);
  });

  it("disables account avatar choices while any profile field is pending", () => {
    const html = renderToStaticMarkup(
      <SettingsPage
        activePanel="account"
        appearance={{ theme: "light", fontSize: "md" }}
        locale="zh-CN"
        messages={createDesktopMessages("zh-CN")}
        nodes={data.nodes}
        notifications={{ mentions: true, humanReplies: false, approvals: true }}
        pendingProfileField="displayName"
        profile={{ displayName: "Lei", handle: "lei", avatar: "pixel-sun" }}
        timeZone="Asia/Shanghai"
      />,
    );

    expect(html).toContain('data-editable-saving="true"');
    expect(html.match(/<button(?=[^>]*data-settings-avatar-option="pixel-[^"]+")(?=[^>]*disabled="")[^>]*>/g)).toHaveLength(4);
  });

  it("consumes rejected fire-and-forget settings callbacks", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);

    try {
      runSettingsFireAndForgetAction(async () => {
        throw new Error("保存失败");
      });
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("renders appearance controls and about metadata", () => {
    const appearanceHtml = renderToStaticMarkup(
      <SleiAppFrame
        activeView="settings"
        appearance={{ theme: "dark", fontSize: "lg" }}
        data={data}
        initialSettingsPanel="appearance"
        locale="zh-CN"
        runtimeSetup={readyRuntime}
      />,
    );
    const aboutHtml = renderToStaticMarkup(
      <SleiAppFrame
        activeView="settings"
        data={data}
        initialSettingsPanel="about"
        locale="zh-CN"
        runtimeSetup={readyRuntime}
      />,
    );

    expect(appearanceHtml).toContain("字体大小");
    expect(appearanceHtml).toContain('data-slei-preference-row-label');
    expect(appearanceHtml).toContain(">主题</span>");
    expect(appearanceHtml).toContain('role="group" aria-labelledby=');
    expect(appearanceHtml).not.toContain('aria-label="主题"');
    expect(appearanceHtml).toContain('data-theme="dark"');
    expect(appearanceHtml).toContain('data-font-size="lg"');
    expect(appearanceHtml).toContain("--app-font-size:16px");
    expect(appearanceHtml).toContain('data-settings-font-size-option="lg"');
    expect(appearanceHtml).toContain('data-settings-theme-option="light"');
    expect(appearanceHtml).toContain('data-settings-theme-option="dark"');
    expect(appearanceHtml).toContain(">浅色<");
    expect(appearanceHtml).toContain(">深色<");
    expect(appearanceHtml).not.toContain('data-settings-theme-option="system"');
    expect(appearanceHtml).not.toContain('data-settings-theme-option="highContrast"');
    expect(aboutHtml).toContain("桌面端版本");
    expect(aboutHtml).toContain("Daemon 版本");
  });

  it("normalizes legacy appearance themes to light", () => {
    const html = renderToStaticMarkup(
      <SleiAppFrame
        activeView="settings"
        appearance={{ theme: "highContrast", fontSize: "md" }}
        data={data}
        initialSettingsPanel="appearance"
        locale="zh-CN"
        runtimeSetup={readyRuntime}
      />,
    );

    expect(html).toContain('data-theme="light"');
    expect(html).toContain('data-settings-theme-selected="light"');
  });

  it("bridge mock persists preferences like the native bridge contract", async () => {
    const bridge = createDaemonBridgeMock({ connected: true });

    expect((await bridge.listPreferences()).preferences.locale).toBe("zh-CN");
    await bridge.updatePreferences({
      locale: "en-US",
      timeZone: "America/Los_Angeles",
      appearance: { theme: "dark", fontSize: "lg" },
      notifications: { mentions: true, humanReplies: false, approvals: true },
    });

    const receipt = await bridge.listPreferences();
    expect(receipt.preferences.locale).toBe("en-US");
    expect(receipt.preferences.timeZone).toBe("America/Los_Angeles");
    expect(receipt.preferences.appearance.theme).toBe("dark");
    expect(receipt.preferences.notifications.humanReplies).toBe(false);
  });

  it("bridge mock persists profile like the native bridge contract", async () => {
    expect((await createDaemonBridgeMock({ connected: true }).listProfile()).profile).toBeNull();
    expect((await createDaemonBridgeMock({ connected: true, profile: null }).listProfile()).profile).toBeNull();

    const bridge = createDaemonBridgeMock({
      connected: true,
      profile: { displayName: "Lei", handle: "lei", avatar: "pixel-sun" },
    });

    expect((await bridge.listProfile()).profile?.displayName).toBe("Lei");
    expect((await bridge.listProfile()).profile?.handle).toBe("lei");
    await expect(bridge.updateProfile({ displayName: "   " })).rejects.toThrow("display name is required");
    await bridge.updateProfile({ displayName: "Lei Lee", avatar: "pixel-moon" });

    const receipt = await bridge.listProfile();
    expect(receipt.profile?.displayName).toBe("Lei Lee");
    expect(receipt.profile?.handle).toBe("lei");
    expect(receipt.profile?.avatar).toBe("pixel-moon");
    await expect(bridge.updateProfile({ handle: "other" })).rejects.toThrow("handle is immutable");
    await expect(bridge.updateProfile({ handle: "" })).rejects.toThrow("handle is immutable");
  });
});
