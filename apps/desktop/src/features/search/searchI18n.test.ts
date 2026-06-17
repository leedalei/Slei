import { describe, expect, it } from "vitest";

import { enUSMessages } from "../../i18n/messages/en-US";
import { zhCNMessages } from "../../i18n/messages/zh-CN";

describe("global search i18n", () => {
  it("exposes expanded global search labels in both locales", () => {
    for (const messages of [zhCNMessages.search, enUSMessages.search]) {
      expect(messages.title).toBeTruthy();
      expect(messages.placeholderTitle).toBeTruthy();
      expect(messages.sections.agents).toBeTruthy();
      expect(messages.sections.channels).toBeTruthy();
      expect(messages.sections.messages).toBeTruthy();
      expect(messages.filters.timeRange.last7Days).toBeTruthy();
      expect(messages.categories.message).toBeTruthy();
      expect(messages.navigation.openMessage("message_1")).toBeTruthy();
      expect(messages.resultCount(2)).toBeTruthy();
    }
  });

  it("uses Chinese copy for the Chinese global search locale", () => {
    expect(zhCNMessages.search.title).toBe("全局搜索");
    expect(zhCNMessages.search.placeholderTitle).toContain("搜索");
    expect(zhCNMessages.search.sections.messages).toBe("消息");
    expect(zhCNMessages.search.filters.timeRange.last30Days).toBe("最近 30 天");
    expect(zhCNMessages.search.navigation.openChannel("频道")).toContain("打开频道");
  });

  it("keeps compatibility keys used by the current placeholder search page", () => {
    expect(zhCNMessages.search.noResultTitle).toBeTruthy();
    expect(zhCNMessages.search.openConversation("abc")).toContain("abc");
    expect(enUSMessages.search.query).toBeTruthy();
    expect(enUSMessages.search.user).toBeTruthy();
  });
});
