import { describe, expect, it } from "vitest";

import { createEmptySleiData } from "./empty-data";

describe("createEmptySleiData", () => {
  it("creates production data without demo defaults", () => {
    expect(createEmptySleiData()).toEqual({
      nodes: [],
      conversations: [],
      conversationSessions: [],
      channelSessions: [],
      channels: [],
      messages: [],
      tasks: [],
      members: [],
    });
  });

  it("applies explicit overrides only", () => {
    expect(
      createEmptySleiData({
        channels: [{ id: "team", name: "team", description: "Team channel", unread: 2 }],
      }).channels,
    ).toEqual([{ id: "team", name: "team", description: "Team channel", unread: 2 }]);
  });
});
