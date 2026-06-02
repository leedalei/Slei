import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

import { SleiAppFrame } from "../src/app/SleiApp";
import { createSleiFixtures } from "../src/app/fixtures";
import { renderInteractiveCard, renderInteractiveCardDialog } from "../src/features/chat/InteractiveCard";

describe("interactive cards", () => {
  it("renders pending card and editable confirmation dialog", () => {
    const card = renderInteractiveCard({
      title: "创建频道",
      state: "pending",
      action: "create_channel",
    });
    const dialog = renderInteractiveCardDialog({
      title: "创建频道",
      fieldLabel: "频道名称",
      value: "dev-team",
    });

    expect(card).toContain("等待确认");
    expect(card).toContain("创建频道");
    expect(dialog).toContain("频道名称");
    expect(dialog).toContain("确认执行");
  });

  it("renders permission approval cards with one-time session and deny actions", () => {
    const html = renderToStaticMarkup(
      createElement(SleiAppFrame, {
        activeConversationId: "dm:agent_coda",
        activeView: "chat",
        data: createSleiFixtures({
          conversations: [{
            id: "dm:agent_coda",
            kind: "dm",
            agentId: "agent_coda",
            activeSessionId: "session_1",
            createdAt: "2026-06-02T08:00:00Z",
            updatedAt: "2026-06-02T08:00:00Z",
          }],
          conversationSessions: [{
            id: "session_1",
            conversationId: "dm:agent_coda",
            title: "写入授权",
            status: "ready",
            createdAt: "2026-06-02T08:00:00Z",
            updatedAt: "2026-06-02T08:00:00Z",
          }],
          members: [{
            id: "agent_coda",
            name: "Coda",
            handle: "@coda",
            avatar: "CO",
            avatarSeed: "agent_coda",
            type: "agent",
            runtimeStatus: "idle",
            role: "工程师",
            description: "工程师",
            computer: "本机设备",
            nodeId: "local-node",
            created: "2026-06-02",
            creator: "lei lee @lei-lee",
            runtime: "ClaudeCode",
            model: "Sonnet",
            instructions: "工程师",
            permissions: [],
            environmentVariables: [],
            createdAgents: [],
            activity: "待命",
            capabilities: ["ClaudeCode"],
            workspacePath: "/workspace/app",
            memoryPath: "/workspace/app/MEMORY.md",
            docsPath: "/workspace/app/docs",
          }],
          messages: [{
            id: "permission_message_perm_1",
            author: "Coda",
            role: "agent",
            time: "16:00",
            body: "",
            channelId: "dm:agent_coda",
            sessionId: "session_1",
            status: "approval",
            cards: [{
              id: "card_permission_perm_1",
              kind: "permissionApproval",
              state: "pending",
              title: "需要写入授权",
              summary: "Write /Users/lei/outside.ts",
              draft: {
                requestId: "perm_1",
                toolName: "Write",
                targetPath: "/Users/lei/outside.ts",
                sessionId: "session_1",
              },
              actionLabel: "允许一次",
              doneLabel: "已处理",
            }],
          }],
        }),
        locale: "zh-CN",
        runtimeSetup: { loading: false, hasClaudeRuntimeReady: true, nodes: createSleiFixtures().nodes },
      }),
    );

    expect(html).toContain("权限申请");
    expect(html).toContain("允许一次");
    expect(html).toContain("本会话始终允许");
    expect(html).toContain("拒绝");
    expect(html).toContain("新会话会重新申请");
  });
});
