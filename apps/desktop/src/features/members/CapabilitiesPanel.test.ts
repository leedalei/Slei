import { describe, expect, it } from "vitest";

import { renderActivityPanel } from "./ActivityPanel";
import { renderCapabilitiesPanel } from "./CapabilitiesPanel";

describe("member capabilities and activity", () => {
  it("renders workspace skills with availability and source details", () => {
    const html = renderCapabilitiesPanel({
      locale: "zh-CN",
      skills: [
        {
          name: "youdao-lobster-pr",
          source: "memory",
          description: "有道龙虾项目 PR 提交流程",
          available: true,
        },
        {
          name: "memory",
          description: "保存和检索成员记忆",
          available: false,
        },
      ],
    });

    expect(html).toContain("能力");
    expect(html).toContain("youdao-lobster-pr");
    expect(html).toContain("有道龙虾项目 PR 提交流程");
    expect(html).toContain("memory");
    expect(html).not.toContain("只读");
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
