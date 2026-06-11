import { describe, expect, it } from "vitest";

import { renderMembersPage } from "../src/features/members/MembersPage";

describe("members and agent configuration", () => {
  it("renders grouped humans and agents with runtime and permissions", () => {
    const html = renderMembersPage({
      locale: "zh-CN",
      agents: [
        {
          name: "Coda",
          handle: "coda",
          runtimeKind: "ClaudeCode",
          model: "sonnet",
          presence: "online",
          permission: "Edit",
          workspaceOverride: "ReadOnly",
        },
      ],
      humans: [{ name: "lei lee", handle: "lei-lee" }],
    });

    expect(html).toContain("成员");
    expect(html).toContain("智能体");
    expect(html).toContain("HUMANS");
    expect(html).toContain("Coda");
    expect(html).toContain("Claude Code");
    expect(html).toContain("工作区权限：只读");
    expect(html).toContain("能力扫描暂不可用");
    expect(html).toContain("@lei-lee");
  });

  it("renders English labels", () => {
    const html = renderMembersPage({
      locale: "en-US",
      agents: [],
      humans: [{ name: "Lei Lee", handle: "lei-lee" }],
    });

    expect(html).toContain("Members");
    expect(html).toContain("No agents");
    expect(html).toContain("Humans");
  });
});
