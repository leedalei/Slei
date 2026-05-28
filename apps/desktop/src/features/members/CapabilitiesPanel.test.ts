import { describe, expect, it } from "vitest";

import { renderActivityPanel } from "./ActivityPanel";
import { renderCapabilitiesPanel } from "./CapabilitiesPanel";

describe("member capabilities and activity", () => {
  it("renders read-only capabilities including unavailable scan state", () => {
    const html = renderCapabilitiesPanel({
      locale: "zh-CN",
      capabilities: [
        {
          name: "youdao-lobster-pr",
          source: "Workspace Claude",
          description: "PR 提交流程",
          available: true,
        },
        {
          name: "workspace scan",
          source: "Workspace Claude",
          description: "扫描失败",
          available: false,
          error: "workspace scan timed out",
        },
      ],
    });

    expect(html).toContain("能力");
    expect(html).toContain("只读");
    expect(html).toContain("youdao-lobster-pr");
    expect(html).toContain("workspace scan timed out");
    expect(html).not.toContain("安装");
  });

  it("renders activity from existing run approval and delegation entries", () => {
    const html = renderActivityPanel({
      locale: "zh-CN",
      entries: [
        { kind: "run", title: "run_1 started" },
        { kind: "approval", title: "等待审批 Write src/main.ts" },
        { kind: "delegation", title: "Coda → Alice" },
      ],
    });

    expect(html).toContain("活动");
    expect(html).toContain("run_1 started");
    expect(html).toContain("等待审批");
    expect(html).toContain("Coda → Alice");
  });
});
