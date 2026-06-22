import { describe, expect, it, vi } from "vitest";

import type { SleiMember } from "./types";
import {
  formatMemberCreatedDate,
  formatLocalRecordDateTime,
  formatMessageDateTime,
  formatMessageTime,
  isInternalCoordinatorMember,
  localeFromSystemLanguages,
  mentionSuggestions,
  mergeMessagePage,
  sendChatComposerMessage,
  shouldRefreshChannelMessages,
  timeZoneFromSystemValue,
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

describe("internal coordinator members", () => {
  it("identifies global and legacy channel coordinators", () => {
    expect(isInternalCoordinatorMember(agent({ id: "agent_global_coordinator", agentKind: "coordinator" }))).toBe(true);
    expect(isInternalCoordinatorMember(agent({ id: "agent_coordinator_all" }))).toBe(true);
    expect(isInternalCoordinatorMember(agent({ id: "agent_coda", agentKind: "agent" }))).toBe(false);
  });

  it("omits coordinator agents from mention suggestions", () => {
    const members = [
      agent({ id: "agent_global_coordinator", name: "Global Coordinator", handle: "@global-coordinator", agentKind: "coordinator" }),
      agent({ id: "agent_coordinator_all", name: "Channel Coordinator", handle: "@channel-coordinator" }),
      agent({ id: "agent_coda", name: "Coda", handle: "@coda", agentKind: "agent" }),
    ];

    expect(mentionSuggestions("", members).map((member) => member.id)).toEqual(["agent_coda"]);
  });
});

describe("member created date formatting", () => {
  it("formats member created time as YYYY-MM-DD", () => {
    expect(formatMemberCreatedDate("2026-05-29T07:28:51.000Z")).toBe("2026-05-29");
    expect(formatMemberCreatedDate("20260529")).toBe("2026-05-29");
  });
});

describe("channel message refresh", () => {
  it("keeps polling while the active channel has coordinator or agent pending activity", () => {
    expect(
      shouldRefreshChannelMessages(
        [
          {
            id: "coordinator-activity-msg_1",
            author: "频道协调员",
            role: "agent",
            time: "",
            body: "",
            channelId: "all",
            status: "pending",
            toolCall: "coordinator_routing",
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
