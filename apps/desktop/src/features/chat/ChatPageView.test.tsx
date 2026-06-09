import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { createSleiFixtures, type SleiMember } from "../../app/fixtures";
import { defaultProfile } from "../../app/model";
import { createDesktopMessages } from "../../i18n";
import { ChatPage } from "./ChatPageView";

function memberWithLongMentionText(): SleiMember {
  return {
    id: "agent_architect",
    name: "架构师",
    handle: "@architect-with-an-intentionally-long-handle",
    avatar: "AR",
    type: "agent",
    runtimeStatus: "idle",
    role: "架构设计 Agent，负责与用户头脑风暴、梳理需求、制定技术文档与验收标准，输出清晰的架构设计方案",
    description: "负责架构设计。",
    computer: "Local",
    created: "2026-06-09",
    creator: "lei lee @lei-lee",
    runtime: "ClaudeCode",
    model: "Sonnet",
    instructions: "负责架构设计。",
    permissions: [],
    environmentVariables: [],
    createdAgents: [],
    activity: "Idle",
    capabilities: ["architecture"],
  };
}

describe("ChatPage mention panel", () => {
  it("keeps mention suggestions constrained to the composer width", () => {
    const messages = createDesktopMessages("zh-CN");
    const data = createSleiFixtures({
      members: [memberWithLongMentionText()],
    });

    const html = renderToStaticMarkup(
      <ChatPage
        activeChannel={data.channels[0]}
        data={data}
        initialDraft="@"
        messages={messages}
        profile={defaultProfile}
      />,
    );

    expect(html).toContain('data-testid="slei-mention-panel"');
    expect(html).toContain("w-full");
    expect(html).toContain("max-w-full");
    expect(html).toContain("min-w-0 flex-1");
    expect(html).toContain("block truncate");
    expect(html).toContain("max-w-[35%] truncate");
  });
});
