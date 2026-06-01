import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SleiAppFrame } from "../src/app/SleiApp";
import { createSleiFixtures, type SleiMember } from "../src/app/fixtures";

const nodes = createSleiFixtures().nodes;
const agent: SleiMember = {
  id: "agent_coda",
  name: "Coda",
  handle: "@coda",
  avatar: "CO",
  avatarSeed: "agent_coda",
  type: "agent",
  runtimeStatus: "idle",
  role: "研发团队开发工程师",
  description: "真实创建的开发 Agent。",
  computer: nodes[0].name,
  nodeId: nodes[0].id,
  created: "2026-05-29T10:00:00Z",
  creator: "lei lee @lei-lee",
  runtime: "ClaudeCode",
  model: "Sonnet",
  instructions: "实现编码。",
  permissions: [],
  environmentVariables: [],
  createdAgents: [],
  activity: "待命",
  capabilities: ["代码实现"],
};

const readyRuntime = {
  loading: false,
  error: undefined,
  hasClaudeRuntimeReady: true,
  nodes,
};

const dm = {
  id: "dm:agent_coda",
  kind: "dm",
  agentId: "agent_coda",
  activeSessionId: "session-current",
  createdAt: "2026-05-29T10:00:00Z",
  updatedAt: "2026-05-29T10:00:00Z",
} as const;

const session = {
  id: "session-current",
  conversationId: "dm:agent_coda",
  title: "带附件的会话",
  status: "ready",
  createdAt: "2026-05-29T10:00:00Z",
  updatedAt: "2026-05-29T10:00:00Z",
} as const;

describe("chat attachments", () => {
  it("renders selected composer attachments and allows attachment-only sends", () => {
    const html = renderToStaticMarkup(
      <SleiAppFrame
        activeConversationId="dm:agent_coda"
        activeSessionId="session-current"
        activeView="chat"
        data={createSleiFixtures({ conversations: [dm], conversationSessions: [session], members: [agent] })}
        initialComposerAttachments={[
          {
            id: "att_image",
            name: "screen.png",
            mimeType: "image/png",
            size: 1200,
            url: "data:image/png;base64,AAA=",
          },
        ]}
        locale="zh-CN"
        runtimeSetup={readyRuntime}
      />,
    );

    expect(html).toContain("slei-attachment-chip");
    expect(html).toContain("screen.png");
    expect(html).toContain("slei-attachment-preview");
    expect(html).toContain('data-testid="slei-send-button"');
    expect(html).not.toContain('data-testid="slei-send-button" disabled=""');
  });

  it("renders sent message attachments in the timeline", () => {
    const html = renderToStaticMarkup(
      <SleiAppFrame
        activeConversationId="dm:agent_coda"
        activeSessionId="session-current"
        activeView="chat"
        data={createSleiFixtures({
          conversations: [dm],
          conversationSessions: [session],
          members: [agent],
          messages: [
            {
              id: "msg-1",
              author: "Lei",
              role: "human",
              time: "10:00",
              body: "看附件",
              channelId: "dm:agent_coda",
              sessionId: "session-current",
              attachments: [
                {
                  id: "att_file",
                  name: "notes.md",
                  mimeType: "text/markdown",
                  size: 2048,
                },
              ],
            },
          ],
        })}
        locale="zh-CN"
        runtimeSetup={readyRuntime}
      />,
    );

    expect(html).toContain("看附件");
    expect(html).toContain("slei-message-attachments");
    expect(html).toContain("notes.md");
    expect(html).toContain("2 KB");
  });
});
