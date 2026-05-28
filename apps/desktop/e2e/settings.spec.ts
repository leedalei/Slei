import { describe, expect, it } from "vitest";

import { renderSettingsPage } from "../src/features/settings/SettingsPage";

describe("settings identity and localization", () => {
  it("renders profile and notification settings in Chinese by default", () => {
    const html = renderSettingsPage({
      locale: "zh-CN",
      profile: { nickname: "Lei Lee", handle: "lei-lee", bio: "builder" },
      notifications: { mentions: true, humanReplies: true, approvals: true },
    });

    expect(html).toContain("设置");
    expect(html).toContain("昵称");
    expect(html).toContain("@lei-lee");
    expect(html).toContain("提及通知");
    expect(html).toContain("审批通知");
  });

  it("switching locale updates every visible settings string", () => {
    const html = renderSettingsPage({
      locale: "en-US",
      profile: { nickname: "Lei Lee", handle: "lei-lee", bio: "builder" },
      notifications: { mentions: true, humanReplies: true, approvals: true },
    });

    expect(html).toContain("Settings");
    expect(html).toContain("Nickname");
    expect(html).toContain("Language");
    expect(html).toContain("Mention notifications");
    expect(html).toContain("Approval notifications");
    expect(html).not.toContain("昵称");
    expect(html).not.toContain("提及通知");
  });
});
