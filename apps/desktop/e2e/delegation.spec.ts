import { describe, expect, it } from "vitest";

import { renderDelegationEntry } from "../src/features/chat/DelegationEntry";
import { renderNotificationCenter } from "../src/features/notifications/NotificationCenter";

describe("visible delegation and human attention", () => {
  it("renders public handoff chain and pending human reply state", () => {
    const entry = renderDelegationEntry({
      from: "Coda",
      to: "Alice",
      taskTitle: "调研 harness",
      pending: true,
    });

    expect(entry).toContain("Coda → Alice");
    expect(entry).toContain("调研 harness");
    expect(entry).toContain("等待回复");
    expect(entry).toContain("停止后续运行");
  });

  it("renders sanitized notifications", () => {
    const center = renderNotificationCenter({
      locale: "zh-CN",
      notifications: [{ taskTitle: "调研 harness", payload: "@lei-lee 请确认", read: false }],
    });

    expect(center).toContain("通知");
    expect(center).toContain("调研 harness");
    expect(center).toContain("@lei-lee 请确认");
  });
});
