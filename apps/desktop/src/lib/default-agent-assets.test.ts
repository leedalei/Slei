import { describe, expect, it } from "vitest";

import { defaultSkillContent, defaultSkillViews, renderInitialMemory } from "./default-agent-assets";

describe("default agent assets", () => {
  it("renders deterministic initial memory from canonical defaults", () => {
    const memory = renderInitialMemory({
      name: "Yeal",
      handle: "@yeal",
      profession: "引导员",
      description: "Guide",
      agentKind: "guide",
      channelIds: ["zeta", "all"],
    });

    expect(memory).toContain("# Yeal");
    expect(memory).toContain("职业：引导员");
    expect(memory).toContain("创建成员或频道时通过 guide-create Skill 生成产品交互卡");
    expect(memory).not.toContain("主频道：#all");
    expect(memory).not.toContain("已加入频道：#all、#zeta");
    expect(memory).toContain("频道信息请读取 `notes/channels.md`");
    expect(memory).toContain("## Active Context");
  });

  it("renders standard skill views and bodies", () => {
    const skills = defaultSkillViews({ handle: "@yeal", kind: "guide", workspacePath: "/tmp/yeal" });

    expect(skills.map((skill) => skill.id)).toEqual(["guide-create", "memory"]);
    expect(skills[0].path).toBe("/tmp/yeal/.claude/skills/guide-create/SKILL.md");
    expect(defaultSkillContent({ skillId: "guide-create", handle: "@yeal" })).toContain("slei_propose_interactive_card");
    expect(defaultSkillContent({ skillId: "guide-create", handle: "@yeal" })).toContain('"kind": "createChannel"');
    expect(defaultSkillContent({ skillId: "memory", handle: "@yeal" })).toContain("curated working memory, not as a chat log");
  });

  it("renders ordinary agent handoff guidance in initial memory", () => {
    const memory = renderInitialMemory({
      name: "Coda",
      handle: "@coda",
      profession: "研发执行员",
      description: "开发 Agent",
      agentKind: "agent",
      channelIds: ["all"],
    });

    expect(memory).toContain("自发判断是否需要 @ 下一位成员接手");
    expect(memory).toContain("如果无需接手，应 @ 当前用户进行验收或审阅");
  });
});
