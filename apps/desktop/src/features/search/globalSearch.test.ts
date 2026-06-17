import { describe, expect, it } from "vitest";

import type { GlobalSearchReceipt } from "../../lib/daemon-bridge";
import {
  GLOBAL_SEARCH_LIMITS,
  buildGlobalSearchRequest,
  createGlobalSearchSections,
  getGlobalMessageDisplayLabels,
  highlightSearchTokens,
  normalizeGlobalSearchTimeRange,
} from "./globalSearch";

describe("global search helpers", () => {
  it("returns null for empty queries so the UI can show the placeholder state", () => {
    expect(buildGlobalSearchRequest({ q: "" })).toBeNull();
    expect(buildGlobalSearchRequest({ q: "   " })).toBeNull();
  });

  it("builds daemon requests from trimmed filters and omits empty optional fields", () => {
    expect(
      buildGlobalSearchRequest({
        q: "  release notes  ",
        fromId: "  agent_1 ",
        channelId: " ",
        timeRange: "7d",
        timeZone: " Asia/Shanghai ",
      }),
    ).toEqual({
      q: "release notes",
      fromId: "agent_1",
      timeRange: "last7Days",
      timeZone: "Asia/Shanghai",
      agentLimit: GLOBAL_SEARCH_LIMITS.agents,
      channelLimit: GLOBAL_SEARCH_LIMITS.channels,
      messageLimit: GLOBAL_SEARCH_LIMITS.messages,
    });
  });

  it("normalizes supported time range aliases for the daemon API", () => {
    expect(normalizeGlobalSearchTimeRange("any")).toBe("any");
    expect(normalizeGlobalSearchTimeRange("today")).toBe("today");
    expect(normalizeGlobalSearchTimeRange("7d")).toBe("last7Days");
    expect(normalizeGlobalSearchTimeRange("30d")).toBe("last30Days");
    expect(normalizeGlobalSearchTimeRange("last7Days")).toBe("last7Days");
    expect(normalizeGlobalSearchTimeRange("last30Days")).toBe("last30Days");
  });

  it("clamps request limits to frontend maximums", () => {
    expect(
      buildGlobalSearchRequest({
        q: "status",
        agentLimit: 200,
        channelLimit: 21,
        messageLimit: 999,
      }),
    ).toMatchObject({
      agentLimit: 20,
      channelLimit: 20,
      messageLimit: 80,
    });
  });

  it("groups daemon receipt results into stable sections with totals", () => {
    const receipt: GlobalSearchReceipt = {
      query: "coda",
      totals: { agents: 2, channels: 1, messages: 3 },
      agents: [
        {
          kind: "agent",
          agentId: "agent_1",
          title: "Coda",
          subtitle: "@coda",
          avatarSeed: "coda",
          matchedFields: ["title"],
        },
      ],
      channels: [
        {
          kind: "channel",
          channelId: "channel_1",
          title: "#general",
          subtitle: "Team channel",
          matchedFields: ["title"],
        },
      ],
      messages: [
        {
          kind: "message",
          sourceKind: "channel",
          messageId: "message_1",
          channelId: "channel_1",
          authorLabel: "Coda",
          sourceLabel: "#general",
          snippet: "Coda shared a note",
          createdAt: "2026-06-17T09:00:00.000Z",
          matchedFields: ["snippet"],
        },
      ],
    };

    expect(createGlobalSearchSections(receipt).map((section) => [section.category, section.total, section.items.length])).toEqual([
      ["agents", 2, 1],
      ["channels", 1, 1],
      ["messages", 3, 1],
    ]);
  });

  it("highlights literal case-insensitive query matches without unsafe markup", () => {
    expect(highlightSearchTokens("C++ c++ C+", "c++")).toEqual([
      { text: "C++", match: true },
      { text: " ", match: false },
      { text: "c++", match: true },
      { text: " C+", match: false },
    ]);
  });

  it("highlights repeated and CJK matches while preserving plain text segments", () => {
    expect(highlightSearchTokens("搜索全局搜索和搜索结果", "搜索")).toEqual([
      { text: "搜索", match: true },
      { text: "全局", match: false },
      { text: "搜索", match: true },
      { text: "和", match: false },
      { text: "搜索", match: true },
      { text: "结果", match: false },
    ]);
  });

  it("highlights length-changing lowercase matches without empty tokens", () => {
    const tokens = highlightSearchTokens("İi", "i");

    expect(tokens).toEqual([
      { text: "İ", match: true },
      { text: "i", match: true },
    ]);
    expect(tokens.every((token) => token.text.length > 0)).toBe(true);
  });

  it("returns one unmatched part when query is empty or absent from text", () => {
    expect(highlightSearchTokens("No highlight", "")).toEqual([{ text: "No highlight", match: false }]);
    expect(highlightSearchTokens("No highlight", "missing")).toEqual([{ text: "No highlight", match: false }]);
  });

  it("trims and falls back when preparing message display labels", () => {
    expect(
      getGlobalMessageDisplayLabels({
        kind: "message",
        sourceKind: "channel",
        messageId: "message_1",
        channelId: "  channel_1  ",
        conversationId: "conversation_1",
        sessionId: "session_1",
        authorName: "  Coda  ",
        authorHandle: " @coda ",
        title: " ",
        sourceLabel: "",
        snippet: "  fallback snippet  ",
        createdAt: "2026-06-17T09:00:00.000Z",
      }),
    ).toEqual({
      title: "fallback snippet",
      subtitle: "Coda - channel_1",
      sourceLabel: "channel_1",
      authorLabel: "Coda",
    });
  });
});
