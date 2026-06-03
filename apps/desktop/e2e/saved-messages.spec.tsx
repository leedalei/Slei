import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SleiAppFrame } from "../src/app/SleiApp";
import { createSleiFixtures, type SleiMember } from "../src/app/fixtures";

const nodes = createSleiFixtures().nodes;
const readyRuntime = {
  loading: false,
  error: undefined,
  hasClaudeRuntimeReady: true,
  nodes,
};

const agent: SleiMember = {
  id: "agent_coda",
  name: "Coda",
  handle: "@coda",
  avatar: "CO",
  type: "agent",
  runtimeStatus: "idle",
  role: "研发团队开发工程师",
  description: "研发团队开发工程师。",
  computer: "MacBookPro M4 MAX",
  created: "20260601",
  creator: "lei lee @lei-lee",
  runtime: "ClaudeCode",
  model: "Sonnet",
  instructions: "实现功能。",
  permissions: [],
  environmentVariables: [],
  createdAgents: [],
  activity: "待命",
  capabilities: ["代码实现"],
};

const dm = {
  id: "dm:agent_coda",
  kind: "dm",
  agentId: "agent_coda",
  activeSessionId: "session-current",
  createdAt: "2026-06-01T08:00:00.000Z",
  updatedAt: "2026-06-01T08:10:00.000Z",
};

const session = {
  id: "session-current",
  conversationId: "dm:agent_coda",
  title: "修复收藏",
  status: "ready",
  createdAt: "2026-06-01T08:00:00.000Z",
  updatedAt: "2026-06-01T08:10:00.000Z",
};

describe("saved chat messages", () => {
  it("renders a save toggle beside copy and marks focused saved messages", () => {
    const html = renderToStaticMarkup(
      <SleiAppFrame
        activeChannelId="dev-team"
        activeView="chat"
        data={createSleiFixtures({
          channels: [{ id: "dev-team", name: "dev-team", description: "研发频道", unread: 0 }],
          messages: [
            {
              id: "channel-msg",
              author: "Lei",
              handle: "@lei",
              role: "human",
              time: "09:42",
              body: "请收藏这条频道消息",
              channelId: "dev-team",
            },
          ],
        })}
        focusedMessageId="channel-msg"
        locale="zh-CN"
        runtimeSetup={readyRuntime}
        savedMessages={[
          {
            id: "saved-channel-msg",
            messageId: "channel-msg",
            sourceId: "dev-team",
            sourceKind: "channel",
            savedAt: "2026-06-03T09:00:00.000Z",
          },
        ]}
      />,
    );

    expect(html).toContain('data-message-id="channel-msg"');
    expect(html).toContain("slei-message--focused");
    expect(html).toContain('aria-label="取消收藏"');
    expect(html).toContain('aria-pressed="true"');
    expect(html.indexOf('aria-label="复制"')).toBeLessThan(html.indexOf('aria-label="取消收藏"'));
  });

  it("switches the chat sidebar into a saved list with source and date metadata", () => {
    const html = renderToStaticMarkup(
      <SleiAppFrame
        activeChannelId="dev-team"
        activeView="chat"
        data={createSleiFixtures({
          channels: [{ id: "dev-team", name: "dev-team", description: "研发频道", unread: 0 }],
          conversations: [dm],
          conversationSessions: [session],
          members: [agent],
          messages: [
            {
              id: "channel-msg",
              author: "Lei",
              handle: "@lei",
              role: "human",
              time: "09:42",
              body: "来自群聊的收藏",
              channelId: "dev-team",
            },
            {
              id: "dm-msg",
              author: "Coda",
              handle: "@coda",
              role: "agent",
              time: "10:00",
              body: "来自私聊的收藏",
              channelId: "dm:agent_coda",
              sessionId: "session-current",
            },
          ],
        })}
        initialSavedPanelOpen
        locale="zh-CN"
        runtimeSetup={readyRuntime}
        savedMessages={[
          {
            id: "saved-channel-msg",
            messageId: "channel-msg",
            sourceId: "dev-team",
            sourceKind: "channel",
            savedAt: "2026-06-03T09:00:00.000Z",
          },
          {
            id: "saved-dm-msg",
            messageId: "dm-msg",
            sourceId: "dm:agent_coda",
            sourceKind: "dm",
            sessionId: "session-current",
            savedAt: "2026-06-02T10:00:00.000Z",
          },
        ]}
      />,
    );

    expect(html).not.toContain("Slei</strong><span>工作区</span>");
    expect(html).toContain("slei-saved-panel");
    expect(html).toContain("群聊 · #dev-team · 2026-06-03");
    expect(html).toContain("私聊 · Coda / 修复收藏 · 2026-06-02");
    expect(html).toContain("来自群聊的收藏");
    expect(html).toContain("来自私聊的收藏");
  });
});
