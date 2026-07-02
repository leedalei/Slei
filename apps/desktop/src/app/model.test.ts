import { describe, expect, it, vi } from "vitest";

import type { SleiMember } from "./types";
import {
  activeComposerSlashQuery,
  activeSkillSlashQuery,
  agentAvatarSeedFromName,
  agentHandleFromName,
  composerCommandMatchesQuery,
  isProfileImageAvatar,
  formatMemberCreatedDate,
  formatLocalRecordDateTime,
  formatMessageDateTime,
  formatMessageTime,
  insertSkillSlash,
  leadingSkillSlashToken,
  localeFromSystemLanguages,
  mentionSuggestions,
  mergeMessagePage,
  profileAvatarImageUrl,
  removeComposerSlashQuery,
  sendChatComposerMessage,
  shouldRefreshChannelMessages,
  skillSlashSuggestions,
  timeZoneFromSystemValue,
  validateAgentDisplayName,
} from "./model";
import type { SleiMessage } from "./types";

function agent(overrides: Partial<SleiMember> = {}): SleiMember {
  return {
    id: "agent_coda",
    name: "Coda",
    handle: "@coda",
    avatar: "CO",
    type: "agent",
    runtimeStatus: "idle",
    role: "Developer",
    description: "Builds features",
    computer: "Local",
    created: "2026-06-10",
    creator: "system",
    runtime: "ClaudeCode",
    model: "Sonnet",
    instructions: "",
    permissions: [],
    environmentVariables: [],
    createdAgents: [],
    activity: "",
    capabilities: [],
    ...overrides,
  };
}

describe("mention suggestions", () => {
  it("matches members by handle and name", () => {
    const members = [
      agent({ id: "agent_coda", name: "Coda", handle: "@coda", agentKind: "agent" }),
      agent({ id: "agent_mira", name: "Mira", handle: "@mira", agentKind: "agent" }),
    ];

    expect(mentionSuggestions("co", members).map((member) => member.id)).toEqual(["agent_coda"]);
  });
});

describe("agent creation helpers", () => {
  it("generates handle directly from trimmed non-English names", () => {
    expect(agentHandleFromName(" 小红书调研员 ")).toBe("@小红书调研员");
    expect(agentHandleFromName("Architect")).toBe("@Architect");
  });

  it("validates agent display names without requiring pure English", () => {
    expect(validateAgentDisplayName("小红书调研员", [])).toBeNull();
    expect(validateAgentDisplayName("系统 架构师", [])).toBe("format");
    expect(validateAgentDisplayName("legal-researcher", [])).toBe("format");
    expect(validateAgentDisplayName("一".repeat(33), [])).toBe("length");
    expect(validateAgentDisplayName("架构师", [agent({ id: "agent_1", name: "架构师" })])).toBe("duplicate");
  });

  it("derives stable avatar seeds from names", () => {
    expect(agentAvatarSeedFromName(" 小红书调研员 ")).toBe("agent-avatar-小红书调研员");
    expect(agentAvatarSeedFromName("")).toBe("agent-avatar-new");
  });
});

describe("profile avatar image helpers", () => {
  it("recognizes only daemon profile image avatar values", () => {
    expect(isProfileImageAvatar("profile-image:" + "a".repeat(64) + ".png")).toBe(true);
    expect(isProfileImageAvatar("profile-image:abc.png")).toBe(false);
    expect(isProfileImageAvatar("pixel-sun")).toBe(false);
  });

  it("builds slei-avatar URLs for profile image avatars", () => {
    expect(profileAvatarImageUrl("profile-image:" + "b".repeat(64) + ".webp"))
      .toBe("slei-avatar:///bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.webp");
  });
});

describe("skill slash helpers", () => {
  const skills = [
    { id: "memory", name: "memory", trigger: "Remember facts", path: "/tmp/.claude/skills/memory/SKILL.md" },
    { id: "guide-create", name: "guide-create", trigger: "Create agents", path: "/tmp/.claude/skills/guide-create/SKILL.md" },
  ];

  it("detects only literal-start slash queries", () => {
    expect(activeSkillSlashQuery("/")).toEqual({ query: "", start: 0, end: 1 });
    expect(activeSkillSlashQuery("/me")).toEqual({ query: "me", start: 0, end: 3 });
    expect(activeSkillSlashQuery(" /me")).toBeNull();
    expect(activeSkillSlashQuery("hi /me")).toBeNull();
    expect(activeSkillSlashQuery("请用 /memory")).toBeNull();
    expect(activeSkillSlashQuery("/memory remember this")).toBeNull();
  });

  it("filters suggestions by skill name and id", () => {
    expect(skillSlashSuggestions("me", skills).map((skill) => skill.id)).toEqual(["memory"]);
    expect(skillSlashSuggestions("guide", skills).map((skill) => skill.id)).toEqual(["guide-create"]);
    expect(skillSlashSuggestions("", skills).map((skill) => skill.id)).toEqual(["memory", "guide-create"]);
  });

  it("inserts a selected slash skill with a trailing space", () => {
    const slash = activeSkillSlashQuery("/me");
    expect(slash).not.toBeNull();
    expect(insertSkillSlash("/me", slash!, skills[0])).toBe("/memory ");
  });

  it("inserts a selected slash skill at the active trigger position", () => {
    const slash = activeComposerSlashQuery("请记住 /me");
    expect(slash).not.toBeNull();
    expect(insertSkillSlash("请记住 /me", slash!, skills[0])).toBe("请记住 /memory ");
  });

  it("matches only known leading skill tokens", () => {
    expect(leadingSkillSlashToken("/memory remember this", skills)).toEqual({
      skill: skills[0],
      token: "/memory",
      rest: " remember this",
    });
    expect(leadingSkillSlashToken("/guide-create", skills)?.skill.id).toBe("guide-create");
    expect(leadingSkillSlashToken(" /memory", skills)).toBeNull();
    expect(leadingSkillSlashToken("please /memory", skills)).toBeNull();
    expect(leadingSkillSlashToken("/unknown", skills)).toBeNull();
  });
});

describe("composer command slash helpers", () => {
  it("detects a slash query at the start or after a literal space", () => {
    expect(activeComposerSlashQuery("/")).toEqual({ query: "", start: 0, end: 1 });
    expect(activeComposerSlashQuery("/task")).toEqual({ query: "task", start: 0, end: 5 });
    expect(activeComposerSlashQuery("/转为")).toEqual({ query: "转为", start: 0, end: 3 });
    expect(activeComposerSlashQuery("帮我 /")).toEqual({ query: "", start: 3, end: 4 });
    expect(activeComposerSlashQuery("帮我 /file")).toEqual({ query: "file", start: 3, end: 8 });
    expect(activeComposerSlashQuery("帮我 /插入")).toEqual({ query: "插入", start: 3, end: 6 });
  });

  it("does not detect urls, paths, tabs, newlines, or completed slash tokens", () => {
    expect(activeComposerSlashQuery("https://example.com/")).toBeNull();
    expect(activeComposerSlashQuery("path/to/file")).toBeNull();
    expect(activeComposerSlashQuery("帮我\t/")).toBeNull();
    expect(activeComposerSlashQuery("帮我\n/")).toBeNull();
    expect(activeComposerSlashQuery("/task now")).toBeNull();
    expect(activeComposerSlashQuery("帮我 /task now")).toBeNull();
  });

  it("removes a fixed command query while preserving previous text", () => {
    const slash = activeComposerSlashQuery("帮我 /task");
    expect(slash).not.toBeNull();
    expect(removeComposerSlashQuery("帮我 /task", slash!)).toBe("帮我 ");
  });

  it("matches fixed commands by localized title or explicit aliases", () => {
    expect(composerCommandMatchesQuery("fi", ["插入文件", "file", "fi"])).toBe(true);
    expect(composerCommandMatchesQuery("file", ["插入文件", "file", "fi"])).toBe(true);
    expect(composerCommandMatchesQuery("task", ["转为任务", "task", "todo"])).toBe(true);
    expect(composerCommandMatchesQuery("转为", ["转为任务", "task", "todo"])).toBe(true);
    expect(composerCommandMatchesQuery("memory", ["转为任务", "task", "todo"])).toBe(false);
  });
});

describe("member created date formatting", () => {
  it("formats member created time as YYYY-MM-DD", () => {
    expect(formatMemberCreatedDate("2026-05-29T07:28:51.000Z")).toBe("2026-05-29");
    expect(formatMemberCreatedDate("20260529")).toBe("2026-05-29");
  });
});

describe("channel message refresh", () => {
  it("keeps polling while the active channel has pending agent activity", () => {
    expect(
      shouldRefreshChannelMessages(
        [
          {
            id: "agent-activity-msg_1-agent_coda",
            author: "Coda",
            role: "agent",
            time: "",
            body: "",
            channelId: "all",
            status: "pending",
            toolCall: "channel_agent_reply",
          },
        ],
        "all",
      ),
    ).toBe(true);
  });

  it("does not poll inactive channels or settled channel messages", () => {
    expect(
      shouldRefreshChannelMessages(
        [
          {
            id: "msg_agent_done",
            author: "Yeal",
            role: "agent",
            time: "",
            body: "完成了",
            channelId: "all",
            status: "done",
          },
        ],
        "all",
      ),
    ).toBe(false);
    expect(
      shouldRefreshChannelMessages(
        [
          {
            id: "coordinator-activity-msg_2",
            author: "频道协调员",
            role: "agent",
            time: "",
            body: "",
            channelId: "all",
            status: "pending",
          },
        ],
        "dev",
      ),
    ).toBe(false);
  });
});

describe("system preference defaults", () => {
  it("maps system languages to supported app locales", () => {
    expect(localeFromSystemLanguages(["en-GB", "zh-CN"])).toBe("en-US");
    expect(localeFromSystemLanguages(["zh-Hans-CN", "en-US"])).toBe("zh-CN");
    expect(localeFromSystemLanguages(["fr-FR"])).toBe("zh-CN");
    expect(localeFromSystemLanguages([])).toBe("zh-CN");
  });

  it("uses IANA-like system time zones with the project fallback", () => {
    expect(timeZoneFromSystemValue("America/Los_Angeles")).toBe("America/Los_Angeles");
    expect(timeZoneFromSystemValue("Asia/Shanghai")).toBe("Asia/Shanghai");
    expect(timeZoneFromSystemValue("UTC")).toBe("Asia/Shanghai");
    expect(timeZoneFromSystemValue(undefined)).toBe("Asia/Shanghai");
  });
});

describe("message timestamp formatting", () => {
  it("renders timezone-less daemon UTC timestamps in the target device timezone", () => {
    expect(formatMessageTime("2026-06-17 06:57:00", "Asia/Shanghai")).toBe("14:57");
    expect(formatMessageDateTime("2026-06-17 06:57:00", "Asia/Shanghai")).toBe("06-17 14:57");
    expect(formatLocalRecordDateTime("2026-06-17 06:57:00", "Asia/Shanghai")).toBe("2026-06-17 14:57:00");
  });
});

describe("message page merging", () => {
  function message(id: string, channelId = "all"): SleiMessage {
    return {
      id,
      author: "Lei",
      role: "human",
      time: "",
      body: id,
      channelId,
    };
  }

  it("merges older message pages before existing messages without duplicates", () => {
    expect(mergeMessagePage([message("m3"), message("m4")], [message("m1"), message("m2"), message("m3")], "prepend", ["all"]).map((item) => item.id)).toEqual([
      "m1",
      "m2",
      "m3",
      "m4",
    ]);
  });

  it("replaces around-message windows for the target source", () => {
    expect(mergeMessagePage([message("m1"), message("dm1", "dm:agent")], [message("m10"), message("m11")], "replace", ["all"]).map((item) => item.id)).toEqual([
      "dm1",
      "m10",
      "m11",
    ]);
  });
});

describe("chat composer bridge requests", () => {
  it("forwards asTask for direct messages", async () => {
    const bridge = {
      sendConversationMessage: vi.fn().mockResolvedValue({ message: { id: "msg_1" } }),
      sendChannelMessage: vi.fn(),
    };

    await sendChatComposerMessage({
      activeChannelId: "all",
      activeConversationId: "dm:agent",
      asTask: true,
      body: "turn this into task",
      bridge,
      profile: null,
    });

    expect(bridge.sendConversationMessage).toHaveBeenCalledWith(
      "dm:agent",
      expect.objectContaining({ asTask: true }),
    );
  });
});
