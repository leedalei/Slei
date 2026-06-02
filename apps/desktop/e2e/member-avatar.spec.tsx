import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { createMemberAvatar } from "../src/components";
import { SleiAppFrame } from "../src/app/SleiApp";
import { createDemoMembers, createSleiFixtures } from "../src/app/fixtures";

const readyRuntime = {
  loading: false,
  error: undefined,
  hasClaudeRuntimeReady: true,
  nodes: createSleiFixtures().nodes,
};

describe("member pixel avatars", () => {
  it("generates stable local DiceBear data URI avatars from member identity", () => {
    const data = createSleiFixtures({ members: createDemoMembers() });
    const coda = data.members.find((member) => member.name === "Coda")!;
    const alice = data.members.find((member) => member.name === "Alice")!;

    expect(createMemberAvatar(coda)).toBe(createMemberAvatar(coda));
    expect(createMemberAvatar(coda)).not.toBe(createMemberAvatar(alice));
    expect(createMemberAvatar(coda)).toMatch(/^data:image\/svg\+xml/);
  });

  it("renders generated avatar images in members, chat timeline, and mention picker", () => {
    const data = createSleiFixtures({
      members: createDemoMembers(),
      messages: [
        {
          id: "m-coda",
          author: "Coda",
          handle: "@Coda",
          role: "agent",
          time: "10:15",
          body: "pixel avatar check",
          channelId: "all",
        },
      ],
    });

    const membersHtml = renderToStaticMarkup(
      <SleiAppFrame activeView="members" data={data} locale="zh-CN" runtimeSetup={readyRuntime} />,
    );
    const chatHtml = renderToStaticMarkup(
      <SleiAppFrame activeView="chat" data={data} initialChatDraft="@" locale="zh-CN" runtimeSetup={readyRuntime} />,
    );

    expect(membersHtml).toContain("slei-avatar__image");
    expect(chatHtml).toContain("slei-avatar__image");
    expect(chatHtml).toContain("pixel avatar check");
    expect(chatHtml).toContain("@Coda");
    expect(chatHtml).not.toContain("Nancy");
    expect(chatHtml).not.toContain("Jack");
  });
});
