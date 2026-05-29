import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SleiAppFrame } from "../src/app/SleiApp";
import { createSleiFixtures } from "../src/app/fixtures";
import { createDaemonBridgeMock } from "../src/lib/daemon-bridge";

const data = createSleiFixtures();
const readyRuntime = {
  loading: false,
  error: undefined,
  hasClaudeRuntimeReady: true,
  nodes: data.nodes,
};

describe("settings preferences", () => {
  it("renders the settings category sidebar with icon submenu items", () => {
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
    expect(html).toContain("服务端");
    expect(html).toContain("关于");
    expect(html).toContain("账户");
    expect(html).toContain("语言与地区");
    expect(html).toContain("外观");
    expect(html).toContain("通知");
    expect(html).toContain("关于");
    expect(html).toContain('data-settings-icon="account"');
    expect(html).toContain('data-settings-icon="language-region"');
    expect(html).toContain('data-settings-icon="appearance"');
    expect(html).toContain('data-settings-icon="notifications"');
    expect(html).toContain('data-settings-icon="about"');
    expect(html).not.toContain("Runtime / 诊断");
    expect(html).not.toContain("诊断");
  });

  it("renders real language and region options", () => {
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

    expect(html).toContain("slei-language-select");
    expect(html).toContain("slei-timezone-select");
    expect(html).toContain("slei-select__control");
    expect(html).toContain("slei-select__icon");
    expect(html).toContain('option value="zh-CN"');
    expect(html).toContain('option value="en-US"');
    expect(html).toContain('option value="Asia/Shanghai"');
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
    expect(html).toContain("slei-checkbox");
    expect(html).toContain("slei-checkbox__box");
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

    expect(html).toContain("Settings");
    expect(html).toContain("Notifications");
    expect(html).toContain("Mention notifications");
    expect(html).not.toContain("个人资料");
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

    expect(appearanceHtml).toContain("slei-theme-select");
    expect(appearanceHtml).toContain("字体大小");
    expect(appearanceHtml).toContain('data-theme="dark"');
    expect(aboutHtml).toContain("桌面端版本");
    expect(aboutHtml).toContain("Daemon 版本");
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
});
