import { describe, expect, it } from "vitest";

import { renderInteractiveCard, renderInteractiveCardDialog } from "../src/features/chat/InteractiveCard";

describe("interactive cards", () => {
  it("renders pending card and editable confirmation dialog", () => {
    const card = renderInteractiveCard({
      title: "创建频道",
      state: "pending",
      action: "create_channel",
    });
    const dialog = renderInteractiveCardDialog({
      title: "创建频道",
      fieldLabel: "频道名称",
      value: "dev-team",
    });

    expect(card).toContain("等待确认");
    expect(card).toContain("创建频道");
    expect(dialog).toContain("频道名称");
    expect(dialog).toContain("确认执行");
  });
});
